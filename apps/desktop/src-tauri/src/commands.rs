use crate::fs_utils::{self, BackupInfo};
use crate::state::{
    DiagnosticsReport, ReleaseCheck, TikiPlan, TikiRelease, TikiReleaseStatus, TikiState,
    WorkContext, WorkStatus,
};
use crate::watcher;
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Framework command files embedded at compile time. The bundled framework
/// version always matches the desktop binary (kept in sync by version-bump.mjs),
/// so a single binary contains everything needed to install or refresh a
/// project's `.claude/commands/tiki/` directory offline.
static FRAMEWORK_COMMANDS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../packages/framework/commands");

/// Framework scripts embedded at compile time (state.mjs / reconcile-state.mjs /
/// mark-audited.mjs / run-hook.mjs). Installed into `<project>/.claude/tiki/scripts/`
/// so command bodies and the reconciler hook can run them in any project, not just
/// the monorepo (#251 / epic #244).
static FRAMEWORK_SCRIPTS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../packages/framework/scripts");

/// Action to apply to a work item via `update_work_status`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkAction {
    Pause,
    Reset,
    Remove,
}

/// Metadata for a research doc parsed from its YAML front-matter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchDocMeta {
    pub filename: String,
    pub topic: String,
    pub tags: Vec<String>,
    pub issues: Vec<u32>,
    pub created: String,
}

/// Mutate state.json for a single work entry: pause it, reset it to pending,
/// or remove it from `activeWork`. Used by sidebar quick actions on stale items.
#[tauri::command]
pub fn update_work_status(
    work_id: String,
    action: WorkAction,
    tiki_path: Option<String>,
) -> Result<(), String> {
    let path = resolve_tiki_path(tiki_path)?;
    let state_file = path.join("state.json");

    let mut state = fs_utils::read_json_resilient::<TikiState>(&state_file)?
        .ok_or_else(|| "state.json not found".to_string())?;

    match action {
        WorkAction::Remove => {
            state.active_work.remove(&work_id);
        }
        WorkAction::Pause | WorkAction::Reset => {
            let entry = state
                .active_work
                .get_mut(&work_id)
                .ok_or_else(|| "work item not found".to_string())?;
            match entry {
                WorkContext::Issue(ctx) => {
                    match action {
                        WorkAction::Pause => {
                            ctx.status = WorkStatus::Paused;
                        }
                        WorkAction::Reset => {
                            ctx.status = WorkStatus::Pending;
                            ctx.phase = None;
                        }
                        WorkAction::Remove => unreachable!(),
                    }
                    ctx.last_activity = Some(chrono::Utc::now().to_rfc3339());
                }
                WorkContext::Release(_) => {
                    return Err("cannot pause or reset a release entry".to_string());
                }
            }
        }
    }

    let content = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs_utils::atomic_write(&state_file, &content)?;
    Ok(())
}

/// Compare two version strings by semver segments numerically.
fn cmp_semver(a: &str, b: &str) -> Ordering {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let pa = parse(a);
    let pb = parse(b);
    for i in 0..3 {
        let sa = pa.get(i).copied().unwrap_or(0);
        let sb = pb.get(i).copied().unwrap_or(0);
        match sa.cmp(&sb) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

/// Get the path to the .tiki directory in the current working directory
#[tauri::command]
pub fn get_tiki_path() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let tiki_path = cwd.join(".tiki");
    Ok(tiki_path.to_string_lossy().to_string())
}

/// Read and return the current Tiki state.
///
/// Uses `fs_utils::read_json_resilient` to absorb transient races against
/// atomic writes by the framework (state.json is rewritten on every pipeline
/// transition, and the watcher fires reads during the rename window).
#[tauri::command]
pub fn get_state(tiki_path: Option<String>) -> Result<Option<TikiState>, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let state_file = path.join("state.json");
    fs_utils::read_json_resilient::<TikiState>(&state_file)
}

/// Read and return a plan for a specific issue.
///
/// Uses the same resilient read as `get_state` since plan files are rewritten
/// between phases by `/tiki:execute` and reads can race those writes.
#[tauri::command]
pub fn get_plan(issue_number: u32, tiki_path: Option<String>) -> Result<Option<TikiPlan>, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let plan_file = path.join("plans").join(format!("issue-{}.json", issue_number));
    fs_utils::read_json_resilient::<TikiPlan>(&plan_file)
}

/// Save a plan to `.tiki/plans/issue-N.json` via atomic write.
///
/// Accepts the plan as `serde_json::Value` rather than the typed `TikiPlan`
/// struct because the frontend sends camelCase JSON and we just want to
/// pass it through. This avoids type-name mismatch issues with the lenient
/// serde deserializers used on the read side.
#[tauri::command]
pub fn save_plan(
    issue_number: u32,
    plan: serde_json::Value,
    tiki_path: Option<String>,
) -> Result<(), String> {
    let path = resolve_tiki_path(tiki_path)?;
    let plans_dir = path.join("plans");
    std::fs::create_dir_all(&plans_dir)
        .map_err(|e| format!("Failed to create plans directory: {}", e))?;
    let plan_file = plans_dir.join(format!("issue-{}.json", issue_number));
    let content = serde_json::to_string_pretty(&plan)
        .map_err(|e| format!("Failed to serialize plan: {}", e))?;
    fs_utils::atomic_write(&plan_file, &content)
}

/// Open a native folder picker dialog and return the selected path
#[tauri::command]
pub fn select_project_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Project Directory")
        .blocking_pick_folder();

    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

/// Check if the given path contains a .tiki folder (is a valid Tiki project)
#[tauri::command]
pub fn validate_tiki_directory(path: String) -> Result<bool, String> {
    let project_path = PathBuf::from(&path);
    let tiki_path = project_path.join(".tiki");
    Ok(tiki_path.exists() && tiki_path.is_dir())
}

/// Switch the file watcher to a new project directory
#[tauri::command]
pub fn switch_project(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let project_path = PathBuf::from(&path);

    // Validate the path has a .tiki directory
    let tiki_path = project_path.join(".tiki");
    if !tiki_path.exists() || !tiki_path.is_dir() {
        return Err("Invalid project path: no .tiki directory found".to_string());
    }

    // Switch the watcher to the new path
    watcher::switch_watch_path(app, project_path)?;

    log::info!("Switched to project: {}", path);
    Ok(())
}

/// Load all Tiki releases from .tiki/releases/.
///
/// `include_archived` (default false) controls whether `releases/archive/*.json` is also
/// scanned. Since #255 the sidebar passes true so SHIPPED releases stay visible and carry
/// the location-derived `archived` flag (gated/styled as completed rather than hidden — this
/// superseded #142's hide-on-ship behavior); the watcher reload (#258) and the Dependency
/// Graph likewise pass true so every consumer sees the full historical view consistently.
#[tauri::command]
pub fn load_tiki_releases(
    tiki_path: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<TikiRelease>, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let releases_dir = path.join("releases");

    if !releases_dir.exists() {
        return Ok(Vec::new());
    }

    let mut releases = Vec::new();
    read_release_dir(&releases_dir, &mut releases, false);

    if include_archived.unwrap_or(false) {
        let archive_dir = releases_dir.join("archive");
        if archive_dir.exists() {
            read_release_dir(&archive_dir, &mut releases, true);
        }
    }

    // Sort by version (descending, semver-aware)
    releases.sort_by(|a, b| cmp_semver(&b.version, &a.version));

    // Parity check: warn (don't fail) if changelog count outruns JSON count, so
    // missing release records surface in logs instead of going unnoticed for
    // months. Considers both top-level and archive/ so the count is honest
    // regardless of where shipped JSONs live.
    check_release_json_parity(&releases_dir);

    Ok(releases)
}

/// Scan a releases directory for `v*-changelog.md` and `v*.json` filenames and
/// emit a warn log if any changelog lacks a matching JSON in either the
/// top-level directory or `archive/`. Pure observability — does not alter
/// `load_tiki_releases`'s return value.
fn check_release_json_parity(releases_dir: &Path) {
    use std::collections::HashSet;

    let mut changelog_versions: HashSet<String> = HashSet::new();
    let mut json_versions: HashSet<String> = HashSet::new();

    if let Ok(entries) = std::fs::read_dir(releases_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if let Some(v) = name_str.strip_suffix("-changelog.md") {
                changelog_versions.insert(v.to_string());
            } else if let Some(v) = name_str.strip_suffix(".json") {
                json_versions.insert(v.to_string());
            }
        }
    }

    let archive_dir = releases_dir.join("archive");
    if archive_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&archive_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if let Some(v) = name_str.strip_suffix(".json") {
                    json_versions.insert(v.to_string());
                }
            }
        }
    }

    let mut missing: Vec<String> = changelog_versions
        .difference(&json_versions)
        .cloned()
        .collect();
    missing.sort();

    if !missing.is_empty() {
        log::warn!(
            "release JSON gap in {:?}: {} changelog(s) without matching JSON: {:?}",
            releases_dir,
            missing.len(),
            missing
        );
    }
}

/// Read `*.json` files from a single releases directory and parse each into a
/// `TikiRelease`, pushing successful parses onto `out`. Parse failures are logged
/// at warn level; the function does not abort on a single bad file. Symlinks and
/// non-JSON entries are skipped. The `archive/` subdirectory itself is skipped
/// when scanning the top-level `releases/` directory (it's traversed separately
/// only when `include_archived` is true).
///
/// `archived` is stamped onto every record read from `dir` — pass `true` for the
/// `archive/` subdirectory so completed releases carry the derived completed-signal
/// (the JSON's own `status` is unreliable; see `TikiRelease::archived`).
fn read_release_dir(dir: &Path, out: &mut Vec<TikiRelease>, archived: bool) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to read releases dir {:?}: {}", dir, e);
            return;
        }
    };

    for entry in entries.flatten() {
        let file_path = entry.path();
        if !file_path.extension().map_or(false, |ext| ext == "json") {
            continue;
        }
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read release file {:?}: {}", file_path, e);
                continue;
            }
        };
        match serde_json::from_str::<TikiRelease>(&content) {
            Ok(mut release) => {
                release.archived = archived;
                out.push(release);
            }
            Err(e) => {
                log::warn!("Failed to parse release file {:?}: {}", file_path, e);
            }
        }
    }
}

/// Save a Tiki release to .tiki/releases/{version}.json
#[tauri::command]
pub fn save_tiki_release(release: TikiRelease, tiki_path: Option<String>) -> Result<(), String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let releases_dir = path.join("releases");

    // Create releases directory if it doesn't exist
    if !releases_dir.exists() {
        std::fs::create_dir_all(&releases_dir).map_err(|e| e.to_string())?;
    }

    // Sanitize version for filename (replace special chars)
    let safe_version = release.version.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let file_path = releases_dir.join(format!("{}.json", safe_version));

    let content = serde_json::to_string_pretty(&release).map_err(|e| e.to_string())?;
    fs_utils::atomic_write(&file_path, &content)?;

    log::info!("Saved release {} to {:?}", release.version, file_path);
    Ok(())
}

/// Read a release's changelog markdown (`{version}-changelog.md`) from
/// `.tiki/releases/`, falling back to `releases/archive/`.
///
/// Returns `Ok(None)` when neither file exists — older releases legitimately have
/// no changelog, so absence is not an error. The local file is preferred over the
/// GitHub release body because it is instant/offline and present immediately after
/// ship (it survives the archive->CI-publish gap, and the GitHub body is generated
/// from it anyway).
#[tauri::command]
pub fn read_release_changelog(
    version: String,
    tiki_path: Option<String>,
) -> Result<Option<String>, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let releases_dir = path.join("releases");
    // Sanitize identically to save_tiki_release so the filename matches on disk.
    let safe_version = version.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let file_name = format!("{}-changelog.md", safe_version);

    for candidate in [
        releases_dir.join(&file_name),
        releases_dir.join("archive").join(&file_name),
    ] {
        if candidate.exists() {
            return std::fs::read_to_string(&candidate)
                .map(Some)
                .map_err(|e| format!("Failed to read changelog {:?}: {}", candidate, e));
        }
    }

    Ok(None)
}

/// Delete a Tiki release file
#[tauri::command]
pub fn delete_tiki_release(version: String, tiki_path: Option<String>) -> Result<(), String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let releases_dir = path.join("releases");
    let safe_version = version.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let file_path = releases_dir.join(format!("{}.json", safe_version));

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
        log::info!("Deleted release {} from {:?}", version, file_path);
    }

    Ok(())
}

/// List all research docs in `.tiki/research/` with metadata parsed from their
/// YAML front-matter. Returns an empty Vec if the directory doesn't exist —
/// research is an optional Tiki feature.
///
/// Uses a simple line-based YAML parser rather than pulling in `serde_yaml`
/// because the front-matter shape is fixed and tiny.
#[tauri::command]
pub fn list_research_docs(tiki_path: Option<String>) -> Result<Vec<ResearchDocMeta>, String> {
    let path = resolve_tiki_path(tiki_path)?;
    let research_dir = path.join("research");

    if !research_dir.exists() {
        return Ok(Vec::new());
    }

    let mut docs = Vec::new();
    let entries = std::fs::read_dir(&research_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if !file_path.extension().map_or(false, |ext| ext == "md") {
            continue;
        }

        let filename = match file_path.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };

        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read research doc {:?}: {}", file_path, e);
                continue;
            }
        };

        match parse_research_front_matter(&filename, &content) {
            Some(meta) => docs.push(meta),
            None => {
                log::warn!("Skipping research doc with no front-matter: {}", filename);
            }
        }
    }

    // Sort by created descending (ISO 8601 strings sort chronologically).
    docs.sort_by(|a, b| b.created.cmp(&a.created));

    Ok(docs)
}

/// Read the raw contents of a single research doc.
///
/// Validates the filename to prevent path traversal: must end in `.md` and
/// must not contain path separators or parent-dir components.
#[tauri::command]
pub fn read_research_doc(
    filename: String,
    tiki_path: Option<String>,
) -> Result<String, String> {
    if !filename.ends_with(".md")
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Err("invalid filename".to_string());
    }

    let path = resolve_tiki_path(tiki_path)?;
    let file_path = path.join("research").join(&filename);

    if !file_path.exists() {
        return Err("file not found".to_string());
    }

    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

/// Parse the YAML front-matter from a research doc. Returns None if the file
/// has no front-matter block. Missing fields are filled with sensible defaults
/// and a warning is logged.
fn parse_research_front_matter(filename: &str, content: &str) -> Option<ResearchDocMeta> {
    let mut lines = content.lines();

    // First non-empty content must be the opening `---`.
    let opener = lines.next()?;
    if opener.trim() != "---" {
        return None;
    }

    let mut topic: Option<String> = None;
    let mut created: Option<String> = None;
    let mut tags: Vec<String> = Vec::new();
    let mut issues: Vec<u32> = Vec::new();
    let mut found_close = false;

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            found_close = true;
            break;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let (key, value) = match trimmed.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };

        match key {
            "topic" => topic = Some(value.trim_matches('"').trim_matches('\'').to_string()),
            "created" => created = Some(value.trim_matches('"').trim_matches('\'').to_string()),
            "tags" => {
                tags = parse_yaml_list(value);
            }
            "issues" => {
                issues = parse_yaml_list(value)
                    .into_iter()
                    .filter_map(|s| s.parse::<u32>().ok())
                    .collect();
            }
            _ => {}
        }
    }

    if !found_close {
        return None;
    }

    let topic = topic.unwrap_or_else(|| {
        log::warn!("Research doc {} missing 'topic' front-matter", filename);
        filename.strip_suffix(".md").unwrap_or(filename).to_string()
    });
    let created = created.unwrap_or_else(|| {
        log::warn!("Research doc {} missing 'created' front-matter", filename);
        String::new()
    });

    Some(ResearchDocMeta {
        filename: filename.to_string(),
        topic,
        tags,
        issues,
        created,
    })
}

/// Parse a YAML inline list `[a, b, c]` into trimmed string items. Returns an
/// empty Vec if the value isn't a bracketed list (we don't support block-form
/// lists since the front-matter spec uses inline form).
fn parse_yaml_list(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    let inner = match trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        Some(s) => s,
        None => return Vec::new(),
    };

    inner
        .split(',')
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Back up state.json before a destructive operation
#[tauri::command]
pub fn backup_state(tiki_path: Option<String>) -> Result<String, String> {
    let path = resolve_tiki_path(tiki_path)?;
    let backup_path = fs_utils::backup_state(&path)?;
    Ok(backup_path.to_string_lossy().to_string())
}

/// List available state backups, newest first
#[tauri::command]
pub fn list_backups(tiki_path: Option<String>) -> Result<Vec<BackupInfo>, String> {
    let path = resolve_tiki_path(tiki_path)?;
    fs_utils::list_backup_files(&path)
}

/// Restore state.json from a backup file
#[tauri::command]
pub fn restore_backup(backup_filename: String, tiki_path: Option<String>) -> Result<(), String> {
    let path = resolve_tiki_path(tiki_path)?;
    fs_utils::restore_from_backup(&path, &backup_filename)
}

/// Restore state.json from a backup, with a pre-flight `.broken.json` safety
/// snapshot when the current state is unparseable. Used by the State
/// Recovery dialog so corrupt state is never silently overwritten.
#[tauri::command]
pub fn restore_backup_safe(
    backup_filename: String,
    tiki_path: Option<String>,
) -> Result<(), String> {
    let path = resolve_tiki_path(tiki_path)?;
    fs_utils::restore_from_backup_safe(&path, &backup_filename)
}

/// Read raw text content of a backup file in `.tiki/backups/`. The frontend
/// recovery dialog uses this to preview a backup and validate parseability
/// before offering Restore.
#[tauri::command]
pub fn read_backup_content(
    backup_filename: String,
    tiki_path: Option<String>,
) -> Result<String, String> {
    let path = resolve_tiki_path(tiki_path)?;
    fs_utils::read_backup_content(&path, &backup_filename)
}

/// Atomically write a fresh canonical state.json (`{schemaVersion: 1,
/// activeWork: {}}`). Pre-flight: snapshots the current file as
/// `state.{ts}.broken.json` if unparseable, or as a normal numbered backup
/// otherwise. Used by the Start Fresh action in the recovery dialog.
#[tauri::command]
pub fn write_fresh_state(tiki_path: Option<String>) -> Result<(), String> {
    let path = resolve_tiki_path(tiki_path)?;
    fs_utils::write_fresh_state(&path)
}

/// Helper to resolve the .tiki path from an optional parameter.
/// `pub(crate)` so the extracted `config` module can reuse it (#235).
pub(crate) fn resolve_tiki_path(tiki_path: Option<String>) -> Result<PathBuf, String> {
    match tiki_path {
        Some(p) => Ok(PathBuf::from(p)),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            Ok(cwd.join(".tiki"))
        }
    }
}

/// Install or refresh the embedded Tiki framework commands into a project's
/// `.claude/commands/tiki/` directory and stamp `<project>/.tiki/.framework-version`
/// with the desktop binary's version.
#[tauri::command]
pub fn install_framework(app: AppHandle, project_path: String) -> Result<String, String> {
    let project = PathBuf::from(&project_path);
    if !project.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
    }

    let commands_dir = project.join(".claude").join("commands").join("tiki");
    std::fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;

    let mut installed = 0;
    for file in FRAMEWORK_COMMANDS.files() {
        let name = file
            .path()
            .file_name()
            .ok_or_else(|| "embedded framework file missing name".to_string())?;
        let target = commands_dir.join(name);
        std::fs::write(&target, file.contents()).map_err(|e| e.to_string())?;
        installed += 1;
    }

    // Install the scripts the commands + reconciler hook depend on (#251).
    let scripts_dir = project.join(".claude").join("tiki").join("scripts");
    std::fs::create_dir_all(&scripts_dir).map_err(|e| e.to_string())?;
    let mut scripts_installed = 0;
    for file in FRAMEWORK_SCRIPTS.files() {
        let name = file
            .path()
            .file_name()
            .ok_or_else(|| "embedded framework script missing name".to_string())?;
        std::fs::write(scripts_dir.join(name), file.contents()).map_err(|e| e.to_string())?;
        scripts_installed += 1;
    }

    // Register the reconciler Stop/SubagentStop hooks so pipeline state self-heals
    // even when an imperative transition is dropped (epic #244).
    ensure_reconciler_hook(&project)?;

    let version = app.package_info().version.to_string();
    let tiki_dir = project.join(".tiki");
    std::fs::create_dir_all(&tiki_dir).map_err(|e| e.to_string())?;
    std::fs::write(tiki_dir.join(".framework-version"), &version).map_err(|e| e.to_string())?;

    log::info!(
        "Installed {} framework commands + {} scripts to {:?} (version {})",
        installed,
        scripts_installed,
        commands_dir,
        version
    );
    Ok(version)
}

/// Ensure the reconciler Stop/SubagentStop hooks exist in the project's
/// `.claude/settings.json` without clobbering other settings or other hooks.
/// Idempotent AND migration-aware: any prior hook entry whose command mentions
/// `reconcile-state.mjs` is removed before the canonical entry is re-added.
/// Mirrors `ensureReconcilerHook` in packages/framework/install.js.
fn ensure_reconciler_hook(project: &Path) -> Result<(), String> {
    const CMD: &str = "node .claude/tiki/scripts/reconcile-state.mjs --quiet";
    let settings_path = project.join(".claude").join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !settings.is_object() {
        settings = serde_json::json!({});
    }

    let obj = settings.as_object_mut().unwrap();
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        *hooks = serde_json::json!({});
    }
    let hooks_obj = hooks.as_object_mut().unwrap();

    for event in ["Stop", "SubagentStop"] {
        let existing = hooks_obj
            .get(event)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        // Drop any prior reconcile-state hook group (idempotent + path migration).
        let mut cleaned: Vec<serde_json::Value> = existing
            .into_iter()
            .filter(|group| {
                let mentions = group
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|inner| {
                        inner.iter().any(|h| {
                            h.get("command")
                                .and_then(|c| c.as_str())
                                .map(|c| c.contains("reconcile-state.mjs"))
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                !mentions
            })
            .collect();
        cleaned.push(serde_json::json!({
            "hooks": [ { "type": "command", "command": CMD } ]
        }));
        hooks_obj.insert(event.to_string(), serde_json::Value::Array(cleaned));
    }

    std::fs::create_dir_all(settings_path.parent().unwrap()).map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, pretty + "\n").map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the installed framework version from `<project>/.tiki/.framework-version`,
/// or `None` if the file does not exist (i.e., the project pre-dates version stamping).
#[tauri::command]
pub fn read_framework_version(project_path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(project_path)
        .join(".tiki")
        .join(".framework-version");
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(contents.trim().to_string()))
}

/// Read-only diagnostics over a `.tiki/` workspace — see `DiagnosticsReport`.
/// Reports framework version, `state.json` validity, per-release location/status
/// drift (`archivedButActive`), history↔JSON parity gaps, and reconciler-hook
/// presence. Pure inspection: mutates nothing and never returns Err for a merely
/// degraded workspace (a missing/invalid file is reported in a field, not raised).
///
/// `tiki_path` defaults to `<cwd>/.tiki` like `load_tiki_releases`.
#[tauri::command]
pub fn tiki_doctor(tiki_path: Option<String>) -> Result<DiagnosticsReport, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    // framework_version: <tiki>/.framework-version, trimmed; None if absent.
    let framework_version = {
        let fv = path.join(".framework-version");
        if fv.exists() {
            std::fs::read_to_string(&fv)
                .ok()
                .map(|s| s.trim().to_string())
        } else {
            None
        }
    };

    // state.json validity + schemaVersion + activeWork count. A read/parse failure
    // is reported as state_valid=false rather than raised — diagnostics must work
    // even on a broken workspace.
    let (state_valid, schema_version, active_work_count) = match std::fs::read_to_string(
        path.join("state.json"),
    ) {
        Ok(content) => match serde_json::from_str::<TikiState>(&content) {
            Ok(state) => (true, Some(state.schema_version), state.active_work.len()),
            Err(_) => (false, None, 0),
        },
        Err(_) => (false, None, 0),
    };

    // release_checks: reuse the location-derived loader (archive/ => archived=true),
    // so this stays consistent with how the sidebar derives "completed".
    let mut release_checks = Vec::new();
    if let Ok(releases) =
        load_tiki_releases(Some(path.to_string_lossy().to_string()), Some(true))
    {
        for r in releases {
            let location = if r.archived { "archive" } else { "active" }.to_string();
            let status = match r.status {
                TikiReleaseStatus::Active => "active",
                TikiReleaseStatus::Completed => "completed",
                TikiReleaseStatus::Shipped => "shipped",
                TikiReleaseStatus::NotPlanned => "not_planned",
            }
            .to_string();
            // archived_but_active is the expected resting state for shipped releases
            // (see ReleaseCheck doc); computed faithfully, judged by the UI (#262).
            let archived_but_active = r.archived && r.status == TikiReleaseStatus::Active;
            release_checks.push(ReleaseCheck {
                version: r.version,
                location,
                status,
                archived_but_active,
            });
        }
    }

    let recent_releases_missing_json = compute_recent_releases_missing_json(&path);

    Ok(DiagnosticsReport {
        framework_version,
        state_valid,
        schema_version,
        active_work_count,
        release_checks,
        recent_releases_missing_json,
        // tiki_path points at <project>/.tiki, so .claude/settings.json lives in its parent.
        reconciler_hook_installed: path
            .parent()
            .map(reconciler_hook_installed)
            .unwrap_or(false),
    })
}

/// Versions listed in `<tiki>/state.json` `history.recentReleases` that have no
/// matching `{version}.json` in either `releases/` or `releases/archive/`. A parity
/// gap — the release shipped (it's in history) but its definition file is gone.
///
/// Distinct from `check_release_json_parity`, which compares changelogs↔JSON; this
/// compares state-history↔JSON. Returns sorted versions; empty on any read failure.
fn compute_recent_releases_missing_json(tiki_path: &Path) -> Vec<String> {
    use std::collections::HashSet;

    // History versions from state.json.
    let history_versions: Vec<String> = match std::fs::read_to_string(tiki_path.join("state.json"))
    {
        Ok(content) => match serde_json::from_str::<TikiState>(&content) {
            Ok(state) => state
                .history
                .and_then(|h| h.recent_releases)
                .map(|rs| rs.into_iter().map(|r| r.version).collect())
                .unwrap_or_default(),
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    // Set of versions that have a JSON file in releases/ or releases/archive/.
    let releases_dir = tiki_path.join("releases");
    let mut present: HashSet<String> = HashSet::new();
    for dir in [releases_dir.clone(), releases_dir.join("archive")] {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if let Some(v) = name.to_string_lossy().strip_suffix(".json") {
                    present.insert(v.to_string());
                }
            }
        }
    }

    let mut missing: Vec<String> = history_versions
        .into_iter()
        .filter(|v| !present.contains(v))
        .collect();
    missing.sort();
    missing.dedup();
    missing
}

/// Whether `<project>/.claude/settings.json` registers the reconciler
/// (`reconcile-state.mjs`) under a `Stop` or `SubagentStop` hook. Robust to a
/// missing or unparseable settings file — returns `false`, never errors. Mirrors
/// the `reconcile_groups` test helper's traversal but answers a yes/no question.
fn reconciler_hook_installed(project: &Path) -> bool {
    let settings_path = project.join(".claude").join("settings.json");
    let settings: serde_json::Value = match std::fs::read_to_string(&settings_path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return false,
        },
        Err(_) => return false,
    };

    ["Stop", "SubagentStop"].iter().any(|event| {
        settings["hooks"][event]
            .as_array()
            .map(|groups| {
                groups.iter().any(|g| {
                    g["hooks"]
                        .as_array()
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h["command"]
                                    .as_str()
                                    .map(|c| c.contains("reconcile-state.mjs"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tiki-hook-{}-{}", tag, nanos));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        dir
    }

    fn read_settings(project: &Path) -> serde_json::Value {
        let s = std::fs::read_to_string(project.join(".claude").join("settings.json")).unwrap();
        serde_json::from_str(&s).unwrap()
    }

    fn reconcile_groups(settings: &serde_json::Value, event: &str) -> usize {
        settings["hooks"][event]
            .as_array()
            .map(|groups| {
                groups
                    .iter()
                    .filter(|g| {
                        g["hooks"]
                            .as_array()
                            .map(|hs| {
                                hs.iter().any(|h| {
                                    h["command"]
                                        .as_str()
                                        .map(|c| c.contains("reconcile-state.mjs"))
                                        .unwrap_or(false)
                                })
                            })
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn ensure_reconciler_hook_preserves_other_settings_and_is_idempotent() {
        let project = temp_project("idem");
        // Pre-existing settings: an unrelated plugin, an OLD reconcile hook at a
        // different path, and an unrelated PreToolUse hook.
        let initial = serde_json::json!({
            "enabledPlugins": { "understand-anything@understand-anything": true },
            "hooks": {
                "Stop": [
                    { "hooks": [ { "type": "command", "command": "node packages/framework/scripts/reconcile-state.mjs --quiet" } ] }
                ],
                "PreToolUse": [
                    { "hooks": [ { "type": "command", "command": "echo unrelated" } ] }
                ]
            }
        });
        std::fs::write(
            project.join(".claude").join("settings.json"),
            serde_json::to_string_pretty(&initial).unwrap(),
        )
        .unwrap();

        // Run twice — must converge (idempotent).
        ensure_reconciler_hook(&project).unwrap();
        ensure_reconciler_hook(&project).unwrap();

        let s = read_settings(&project);
        // Unrelated settings preserved.
        assert_eq!(s["enabledPlugins"]["understand-anything@understand-anything"], serde_json::json!(true));
        assert_eq!(s["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        // Exactly one reconcile group per event (old path removed, no duplicate).
        assert_eq!(reconcile_groups(&s, "Stop"), 1);
        assert_eq!(reconcile_groups(&s, "SubagentStop"), 1);
        // New canonical path is what's present.
        let cmd = s["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        assert_eq!(cmd, "node .claude/tiki/scripts/reconcile-state.mjs --quiet");

        std::fs::remove_dir_all(&project).ok();
    }

    #[test]
    fn ensure_reconciler_hook_creates_settings_when_absent() {
        let project = temp_project("absent");
        ensure_reconciler_hook(&project).unwrap();
        let s = read_settings(&project);
        assert_eq!(reconcile_groups(&s, "Stop"), 1);
        assert_eq!(reconcile_groups(&s, "SubagentStop"), 1);
        std::fs::remove_dir_all(&project).ok();
    }

    /// Build a temp `.tiki` dir with one active release under `releases/` and one
    /// under `releases/archive/`, then return its path.
    fn temp_tiki_with_releases(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-rel-{}-{}", tag, nanos));
        let releases = tiki.join("releases");
        let archive = releases.join("archive");
        std::fs::create_dir_all(&archive).unwrap();

        // Note: the archived file deliberately still says "status":"active" —
        // this mirrors the real ship teardown, which `mv`s without flipping status.
        let live = serde_json::json!({
            "version": "v9.9.9",
            "status": "active",
            "issues": [],
            "createdAt": "2026-01-01T00:00:00.000Z"
        });
        let shipped = serde_json::json!({
            "version": "v9.9.8",
            "status": "active",
            "issues": [],
            "createdAt": "2026-01-01T00:00:00.000Z"
        });
        std::fs::write(releases.join("v9.9.9.json"), live.to_string()).unwrap();
        std::fs::write(archive.join("v9.9.8.json"), shipped.to_string()).unwrap();
        tiki
    }

    #[test]
    fn load_tiki_releases_marks_archived_by_location_not_status() {
        let tiki = temp_tiki_with_releases("archived");
        let tiki_str = tiki.to_string_lossy().to_string();

        // include_archived = true: both releases load; archived flag tracks the
        // file LOCATION, not the (stale) status field.
        let with_archive = load_tiki_releases(Some(tiki_str.clone()), Some(true)).unwrap();
        let live = with_archive.iter().find(|r| r.version == "v9.9.9").unwrap();
        let shipped = with_archive.iter().find(|r| r.version == "v9.9.8").unwrap();
        assert!(!live.archived, "top-level release must not be archived");
        assert!(shipped.archived, "archive/ release must be archived even though its status says active");
        assert_eq!(shipped.status, crate::state::TikiReleaseStatus::Active);

        // include_archived = false (the #142 sidebar behavior): archive entry hidden.
        let without_archive = load_tiki_releases(Some(tiki_str), Some(false)).unwrap();
        assert!(without_archive.iter().all(|r| r.version != "v9.9.8"));
        assert!(without_archive.iter().any(|r| r.version == "v9.9.9"));

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// REGRESSION GUARD for the #255/#258 bug class — and the one test the prior
    /// two structurally could NOT catch.
    ///
    /// The desktop derives a release's "completed" badge from `TikiRelease.archived`
    /// (the on-disk `status` stays stale "active" after the ship teardown). Tauri
    /// serializes IPC command return values with this struct's derived `Serialize`,
    /// so if `archived` is ever marked `skip_serializing` again it vanishes from the
    /// payload, the frontend reads `undefined`, and every shipped release shows a
    /// stale "active" badge.
    ///
    /// `load_tiki_releases_marks_archived_by_location_not_status` only inspects the
    /// in-memory Rust struct (before serialization), so it cannot see an IPC-strip.
    /// This test exercises the actual wire format: serialize, then assert the key
    /// survives. If this fails, the desktop's release status tracking is broken even
    /// when every other test is green — do not "fix" it by relaxing the assertion.
    #[test]
    fn tiki_release_archived_survives_serialization() {
        let release = TikiRelease {
            version: "v1.2.3".to_string(),
            name: None,
            // Archived files keep a stale "active" status — `archived` is the only
            // reliable completed-signal the frontend has.
            status: crate::state::TikiReleaseStatus::Active,
            issues: vec![],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: None,
            archived: true,
        };

        let value = serde_json::to_value(&release).expect("TikiRelease must serialize");
        assert_eq!(
            value.get("archived").and_then(|v| v.as_bool()),
            Some(true),
            "`archived` must be present in the serialized TikiRelease so it crosses \
             the Tauri IPC boundary to the frontend — the stale `status` field must \
             not become the only completed-signal the UI receives (#255/#258)"
        );
    }

    #[test]
    fn read_release_changelog_reads_top_level_then_archive_else_none() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-changelog-{}", nanos));
        let releases = tiki.join("releases");
        let archive = releases.join("archive");
        std::fs::create_dir_all(&archive).unwrap();
        std::fs::write(releases.join("v1.0.0-changelog.md"), "# v1.0.0\nlive notes").unwrap();
        std::fs::write(archive.join("v0.9.0-changelog.md"), "# v0.9.0\narchived notes").unwrap();
        let tiki_str = tiki.to_string_lossy().to_string();

        // Top-level changelog.
        let live = read_release_changelog("v1.0.0".to_string(), Some(tiki_str.clone())).unwrap();
        assert_eq!(live.as_deref(), Some("# v1.0.0\nlive notes"));
        // Archive fallback.
        let arch = read_release_changelog("v0.9.0".to_string(), Some(tiki_str.clone())).unwrap();
        assert_eq!(arch.as_deref(), Some("# v0.9.0\narchived notes"));
        // Missing changelog is Ok(None), not an error.
        let missing = read_release_changelog("v9.9.9".to_string(), Some(tiki_str)).unwrap();
        assert!(missing.is_none());

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// Phase 1 (SC1): tiki_doctor returns Ok for a valid `.tiki` and reports the
    /// framework version, state validity, schemaVersion, and activeWork count.
    /// The release/hook fields are populated in later phases.
    #[test]
    fn tiki_doctor_reports_framework_and_state_for_valid_tiki() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-doctor-basic-{}", nanos));
        std::fs::create_dir_all(&tiki).unwrap();
        std::fs::write(tiki.join(".framework-version"), "9.9.9\n").unwrap();
        let state = serde_json::json!({
            "schemaVersion": 1,
            "activeWork": {}
        });
        std::fs::write(tiki.join("state.json"), state.to_string()).unwrap();

        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        assert_eq!(report.framework_version.as_deref(), Some("9.9.9"));
        assert!(report.state_valid, "valid state.json must parse");
        assert_eq!(report.schema_version, Some(1));
        assert_eq!(report.active_work_count, 0);

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// Phase 2 (SC2): an `archive/` release whose JSON says `status:"active"` is
    /// reported with `archived_but_active = true`; the top-level release is not.
    #[test]
    fn tiki_doctor_flags_archived_but_active_release() {
        let tiki = temp_tiki_with_releases("doctor-archived");
        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();

        let shipped = report
            .release_checks
            .iter()
            .find(|c| c.version == "v9.9.8")
            .expect("archived release must appear in release_checks");
        assert_eq!(shipped.location, "archive");
        assert_eq!(shipped.status, "active");
        assert!(
            shipped.archived_but_active,
            "an archive/ file with status active must be flagged archived_but_active"
        );

        let live = report
            .release_checks
            .iter()
            .find(|c| c.version == "v9.9.9")
            .expect("top-level release must appear in release_checks");
        assert_eq!(live.location, "active");
        assert!(
            !live.archived_but_active,
            "a top-level release must not be flagged archived_but_active"
        );

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// Phase 2 (SC3): a `recentReleases` entry with no matching JSON file appears in
    /// `recent_releases_missing_json`; one with a JSON file does not.
    #[test]
    fn tiki_doctor_reports_recent_release_missing_json() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-doctor-missing-{}", nanos));
        let releases = tiki.join("releases");
        std::fs::create_dir_all(&releases).unwrap();
        // v1.0.0 has a JSON on disk; v0.9.0 is in history but has NO JSON file.
        std::fs::write(
            releases.join("v1.0.0.json"),
            serde_json::json!({
                "version": "v1.0.0", "status": "active", "issues": [],
                "createdAt": "2026-01-01T00:00:00Z"
            })
            .to_string(),
        )
        .unwrap();
        let state = serde_json::json!({
            "schemaVersion": 1,
            "activeWork": {},
            "history": {
                "recentReleases": [
                    { "version": "v1.0.0", "completedAt": "2026-01-01T00:00:00Z" },
                    { "version": "v0.9.0", "completedAt": "2026-01-01T00:00:00Z" }
                ]
            }
        });
        std::fs::write(tiki.join("state.json"), state.to_string()).unwrap();

        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        assert!(
            report
                .recent_releases_missing_json
                .contains(&"v0.9.0".to_string()),
            "v0.9.0 is in history with no JSON and must be reported, got {:?}",
            report.recent_releases_missing_json
        );
        assert!(
            !report
                .recent_releases_missing_json
                .contains(&"v1.0.0".to_string()),
            "v1.0.0 has a JSON file and must not be reported"
        );

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// Phase 3 (SC4): reconciler_hook_installed is true when a Stop OR SubagentStop
    /// hook runs reconcile-state.mjs, and false for unrelated hooks or a missing file.
    #[test]
    fn reconciler_hook_installed_detects_stop_and_subagent_hooks() {
        let reconcile_cmd = "node .claude/tiki/scripts/reconcile-state.mjs --quiet";

        // Present under Stop.
        let p1 = temp_project("recon-stop");
        std::fs::write(
            p1.join(".claude").join("settings.json"),
            serde_json::json!({
                "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": reconcile_cmd } ] } ] }
            })
            .to_string(),
        )
        .unwrap();
        assert!(reconciler_hook_installed(&p1), "Stop reconcile hook must be detected");
        std::fs::remove_dir_all(&p1).ok();

        // Present under SubagentStop only.
        let p2 = temp_project("recon-subagent");
        std::fs::write(
            p2.join(".claude").join("settings.json"),
            serde_json::json!({
                "hooks": { "SubagentStop": [ { "hooks": [ { "type": "command", "command": reconcile_cmd } ] } ] }
            })
            .to_string(),
        )
        .unwrap();
        assert!(reconciler_hook_installed(&p2), "SubagentStop reconcile hook must be detected");
        std::fs::remove_dir_all(&p2).ok();

        // Unrelated hooks only -> false.
        let p3 = temp_project("recon-unrelated");
        std::fs::write(
            p3.join(".claude").join("settings.json"),
            serde_json::json!({
                "hooks": { "PreToolUse": [ { "hooks": [ { "type": "command", "command": "echo hi" } ] } ] }
            })
            .to_string(),
        )
        .unwrap();
        assert!(!reconciler_hook_installed(&p3), "unrelated hooks must not count");
        std::fs::remove_dir_all(&p3).ok();

        // Missing settings.json entirely -> false, no panic.
        let p4 = temp_project("recon-missing");
        assert!(
            !reconciler_hook_installed(&p4),
            "absent settings.json must yield false, not error"
        );
        std::fs::remove_dir_all(&p4).ok();
    }
}
