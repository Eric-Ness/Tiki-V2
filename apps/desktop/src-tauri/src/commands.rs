use crate::fs_utils::{self, BackupInfo};
use crate::state::{
    DiagnosticsReport, ReleaseCheck, TikiPlan, TikiRelease, TikiReleaseStatus, TikiState,
    UnverifiedCriterion, WorkContext, WorkStatus,
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
///
/// Falls back to `plans/archive/issue-N.json` when the active plan is absent
/// (#266): once an issue ships, `ship.md` moves its plan into `archive/`, so a
/// lookup that only checked `plans/` returned `None` and the dependency-graph
/// node panel's success-criteria checklist (#257) went empty for completed
/// issues. The archived plan retains `phases[].status` + `successCriteria` +
/// `coverageMatrix`, so the checklist renders all-verified with no UI change.
/// Active plan wins when both exist (the live one is authoritative). Same
/// "look in archive too" pattern as `load_tiki_releases` `include_archived`
/// (#255/#258) and `read_release_changelog`.
#[tauri::command]
pub fn get_plan(issue_number: u32, tiki_path: Option<String>) -> Result<Option<TikiPlan>, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let plans_dir = path.join("plans");
    let plan_file = plans_dir.join(format!("issue-{}.json", issue_number));
    if let Some(plan) = fs_utils::read_json_resilient::<TikiPlan>(&plan_file)? {
        return Ok(Some(plan));
    }

    let archived_file = plans_dir
        .join("archive")
        .join(format!("issue-{}.json", issue_number));
    fs_utils::read_json_resilient::<TikiPlan>(&archived_file)
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

    // tiki_path points at <project>/.tiki, so project-level checks (settings.json,
    // .claude/ scripts and commands) live in its parent.
    let project_root = path.parent();

    Ok(DiagnosticsReport {
        framework_version,
        state_valid,
        schema_version,
        active_work_count,
        release_checks,
        recent_releases_missing_json,
        reconciler_hook_installed: project_root.map(reconciler_hook_installed).unwrap_or(false),
        unresolved_script_paths: project_root
            .map(compute_unresolved_script_paths)
            .unwrap_or_default(),
        copy_install_detected: project_root
            .map(|p| p.join(".claude").join("commands").join("tiki").is_dir())
            .unwrap_or(false),
        unverified_shipped_criteria: compute_unverified_shipped_criteria(&path),
    })
}

/// Stems that mark a success-criterion description as plausibly visual/manual.
/// CANONICAL list — kept identical to the Node mirror in
/// `scripts/check-release-readiness.mjs` and documented in
/// `.tiki/research/visual-sc-surfacing.md`. Matched as lowercase substrings
/// (dependency-free; the `regex` crate is intentionally NOT a dependency).
const VISUAL_SC_STEMS: [&str; 25] = [
    "render", "display", "look", "visual", "blink", "flicker", "fram", "snapp", "animat", "button",
    "panel", "badge", "color", "colour", "icon", "layout", "screen", "pixel", "scroll", "hover",
    "theme", "css", "styl", "tauri:dev", "eyes",
];

/// `category` values (lowercased) that are inherently visual/manual.
const VISUAL_SC_CATEGORIES: [&str; 4] = ["visual", "manual", "ux", "ui"];

/// Whether a success criterion is plausibly visual/manual (the #281 heuristic):
/// its lowercased `category` is one of {visual, manual, ux, ui}, OR its
/// lowercased `description` contains any canonical stem. Heuristic by design —
/// over-flagging an automated SC is a minor annoyance (it's an info checklist,
/// never a blocker). Keep IDENTICAL to the Node mirror.
fn is_visual_criterion(category: Option<&str>, description: &str) -> bool {
    if let Some(cat) = category {
        let cat = cat.to_lowercase();
        if VISUAL_SC_CATEGORIES.contains(&cat.as_str()) {
            return true;
        }
    }
    let desc = description.to_lowercase();
    VISUAL_SC_STEMS.iter().any(|stem| desc.contains(stem))
}

/// Scan `<tiki>/plans/archive/issue-<N>.json` for success criteria left
/// `verified:false` that look visual/manual (`is_visual_criterion`). These ship
/// un-flipped because only a human can confirm them in `tauri:dev`/the installer
/// (#281). Returns `{issue, id, description}` sorted by (issue, id).
///
/// Defensive: a single unreadable / unparseable / mis-named file is skipped — the
/// whole scan never fails (diagnostics must work on a degraded workspace). The
/// issue number is parsed from the filename (`issue-42.json` => 42); a file whose
/// stem is not `issue-<digits>` is ignored.
fn compute_unverified_shipped_criteria(tiki_path: &Path) -> Vec<UnverifiedCriterion> {
    let archive_dir = tiki_path.join("plans").join("archive");
    let entries = match std::fs::read_dir(&archive_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut out: Vec<UnverifiedCriterion> = Vec::new();
    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Parse the issue number from `issue-<N>.json`.
        let issue = match file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|stem| stem.strip_prefix("issue-"))
            .and_then(|n| n.parse::<u32>().ok())
        {
            Some(n) => n,
            None => continue,
        };

        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let criteria = match value.get("successCriteria").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => continue,
        };
        for sc in criteria {
            // Only criteria explicitly left verified:false (not absent/true).
            if sc.get("verified").and_then(|v| v.as_bool()) != Some(false) {
                continue;
            }
            let description = sc
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let category = sc.get("category").and_then(|v| v.as_str());
            if !is_visual_criterion(category, description) {
                continue;
            }
            let id = sc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            out.push(UnverifiedCriterion {
                issue,
                id,
                description: description.to_string(),
            });
        }
    }

    out.sort_by(|a, b| a.issue.cmp(&b.issue).then_with(|| a.id.cmp(&b.id)));
    out
}

/// One-shot fixer for the `archivedButActive` residue (#276): scan
/// `<tiki>/releases/archive/*.json` and, for every def whose `status` is not
/// already `"shipped"`, rewrite it with `status:"shipped"` while preserving ALL
/// other fields verbatim. Returns the count of files actually rewritten.
///
/// Location (`archive/`) is the sole source of the "completed" truth (#259); this
/// command only reconciles the cosmetic `status` field on disk so status-field
/// readers (e.g. `check-release-readiness.mjs`) don't get misled. We edit a parsed
/// `serde_json::Value` rather than round-tripping through `TikiRelease` so no
/// unmodeled fields are dropped. Atomic write via `fs_utils::atomic_write`.
///
/// A single unreadable / unparseable / non-object file is skipped (logged at warn),
/// never failing the whole operation. `tiki_path` defaults to `<cwd>/.tiki`.
#[tauri::command]
pub fn normalize_archived_releases(tiki_path: Option<String>) -> Result<usize, String> {
    let path = match tiki_path {
        Some(p) => PathBuf::from(p),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            cwd.join(".tiki")
        }
    };

    let archive_dir = path.join("releases").join("archive");
    if !archive_dir.exists() {
        return Ok(0);
    }

    let entries = match std::fs::read_dir(&archive_dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to read archive dir {:?}: {}", archive_dir, e);
            return Ok(0);
        }
    };

    let mut fixed = 0usize;
    for entry in entries.flatten() {
        let file_path = entry.path();
        if !file_path.extension().map_or(false, |ext| ext == "json") {
            continue;
        }

        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read archived release {:?}: {}", file_path, e);
                continue;
            }
        };

        let mut value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Failed to parse archived release {:?}: {}", file_path, e);
                continue;
            }
        };

        let obj = match value.as_object_mut() {
            Some(o) => o,
            None => {
                log::warn!("Archived release {:?} is not a JSON object; skipping", file_path);
                continue;
            }
        };

        // Already shipped? leave the file byte-for-byte untouched.
        let already_shipped = obj
            .get("status")
            .and_then(|s| s.as_str())
            .map(|s| s == "shipped")
            .unwrap_or(false);
        if already_shipped {
            continue;
        }

        obj.insert(
            "status".to_string(),
            serde_json::Value::String("shipped".to_string()),
        );

        let serialized = match serde_json::to_string_pretty(&value) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to serialize archived release {:?}: {}", file_path, e);
                continue;
            }
        };

        if let Err(e) = fs_utils::atomic_write(&file_path, &serialized) {
            log::warn!("Failed to rewrite archived release {:?}: {}", file_path, e);
            continue;
        }
        fixed += 1;
    }

    Ok(fixed)
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

/// The script floor every Tiki install needs at `.claude/tiki/scripts/`, no
/// matter the distribution channel. Plugin-only installs serve command bodies
/// from the plugin, so there are no local command files to scan — but those
/// bodies still invoke these project-relative scripts (#268).
const CANONICAL_TIKI_SCRIPTS: [&str; 4] = [
    "state.mjs",
    "reconcile-state.mjs",
    "run-hook.mjs",
    "mark-audited.mjs",
];

/// Project-relative script paths that Tiki command bodies depend on but that
/// do not exist under `project_root` (#268 Fix B). Always checks the canonical
/// floor (`CANONICAL_TIKI_SCRIPTS` at `.claude/tiki/scripts/`); additionally,
/// on a copy install (`.claude/commands/tiki/` present) scans each installed
/// command file for `node .claude/...mjs` invocations and checks those too.
/// Returns deduped, sorted, forward-slash paths (stable for the frontend
/// across OSes). Read failures are skipped — empty/partial, never Err/panic.
fn compute_unresolved_script_paths(project_root: &Path) -> Vec<String> {
    use std::collections::BTreeSet;

    // BTreeSet gives dedupe + sorted order for free.
    let mut missing: BTreeSet<String> = BTreeSet::new();

    let scripts_dir = project_root.join(".claude").join("tiki").join("scripts");
    for name in CANONICAL_TIKI_SCRIPTS {
        if !scripts_dir.join(name).exists() {
            missing.insert(format!(".claude/tiki/scripts/{}", name));
        }
    }

    // Copy-install channel: also honor whatever the installed command bodies
    // actually invoke (e.g. project-specific extras beyond the floor).
    let commands_dir = project_root.join(".claude").join("commands").join("tiki");
    if let Ok(entries) = std::fs::read_dir(&commands_dir) {
        for entry in entries.flatten() {
            let file = entry.path();
            if file.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&file) {
                for rel in extract_script_invocations(&content) {
                    // Forward-slash relative paths join fine on Windows too.
                    if !project_root.join(&rel).exists() {
                        missing.insert(rel);
                    }
                }
            }
        }
    }

    missing.into_iter().collect()
}

/// Extract `node .claude/...mjs` invocations from a command body. A simple
/// scan: at each literal `node .claude/`, take the token up to the next
/// whitespace / quote / backtick; keep it only if it ends with `.mjs` and does
/// not involve `CLAUDE_PLUGIN_ROOT` (those resolve outside the project).
fn extract_script_invocations(content: &str) -> Vec<String> {
    const MARKER: &str = "node .claude/";
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(idx) = content[from..].find(MARKER) {
        // Token starts right after "node " (so it begins with ".claude/").
        let start = from + idx + "node ".len();
        let rest = &content[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '`')
            .unwrap_or(rest.len());
        let token = &rest[..end];
        if token.ends_with(".mjs") && !token.contains("CLAUDE_PLUGIN_ROOT") {
            out.push(token.to_string());
        }
        from = start;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_tiki_path_returns_explicit_override() {
        let explicit = "/some/explicit/.tiki".to_string();
        let resolved = resolve_tiki_path(Some(explicit.clone())).unwrap();
        assert_eq!(resolved, PathBuf::from(explicit));
    }

    #[test]
    fn resolve_tiki_path_falls_back_to_cwd_dot_tiki() {
        let resolved = resolve_tiki_path(None).unwrap();
        let expected = std::env::current_dir().unwrap().join(".tiki");
        assert_eq!(resolved, expected);
    }

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

    /// #266: once an issue ships its plan is moved to `plans/archive/`, so a
    /// lookup that only checked `plans/` returned None and the dependency-graph
    /// success-criteria panel went empty. `get_plan` must fall back to the
    /// archive (active plan wins when both exist).
    #[test]
    fn get_plan_falls_back_to_archive_for_shipped_issues() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-getplan-{}", nanos));
        let plans = tiki.join("plans");
        let archive = plans.join("archive");
        std::fs::create_dir_all(&archive).unwrap();
        let tiki_str = tiki.to_string_lossy().to_string();

        let archived = serde_json::json!({
            "createdAt": "2026-01-01T00:00:00.000Z",
            "successCriteria": [{ "id": "SC-ARCHIVE", "description": "from archive" }],
            "phases": []
        });
        std::fs::write(archive.join("issue-42.json"), archived.to_string()).unwrap();

        // No active plan: get_plan reaches into archive/.
        let plan = get_plan(42, Some(tiki_str.clone()))
            .unwrap()
            .expect("archived plan must be returned when no active plan exists");
        assert_eq!(
            plan.success_criteria.as_ref().unwrap()[0].id,
            "SC-ARCHIVE",
            "must read the archived plan's criteria"
        );

        // Active plan wins when both exist (the live one is authoritative).
        let active = serde_json::json!({
            "createdAt": "2026-01-02T00:00:00.000Z",
            "successCriteria": [{ "id": "SC-ACTIVE", "description": "from active" }],
            "phases": []
        });
        std::fs::write(plans.join("issue-42.json"), active.to_string()).unwrap();
        let plan = get_plan(42, Some(tiki_str.clone())).unwrap().unwrap();
        assert_eq!(
            plan.success_criteria.as_ref().unwrap()[0].id,
            "SC-ACTIVE",
            "active plan must take precedence over the archived copy"
        );

        // Neither present: Ok(None), not an error.
        let none = get_plan(999, Some(tiki_str)).unwrap();
        assert!(none.is_none(), "missing plan in both locations is Ok(None)");

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

    /// #281: build a `<tiki>/plans/archive/` fixture with three archived plans and
    /// return its path. The plans exercise the visual-SC heuristic:
    ///  - issue-10: an unverified SC whose description is visual ("renders") → included
    ///  - issue-20: an unverified SC that is non-visual ("reconciler advances") → excluded
    ///  - issue-30: a visual SC but verified:true → excluded
    /// issue-10 also carries a SECOND visual unverified SC so we can pin (issue,id)
    /// ordering within a file.
    fn temp_tiki_unverified_sc_fixture(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-unverified-sc-{}-{}", tag, nanos));
        let archive = tiki.join("plans").join("archive");
        std::fs::create_dir_all(&archive).unwrap();

        // (a) visual + unverified → INCLUDED. Two SCs so ordering is checkable;
        // listed SC2-before-SC1 in the file to confirm we sort by id.
        let issue_10 = serde_json::json!({
            "successCriteria": [
                { "id": "SC2", "category": "visual", "description": "the panel renders correctly", "verified": false },
                { "id": "SC1", "category": "functionality", "description": "the badge renders correctly", "verified": false }
            ],
            "phases": []
        });
        // (b) unverified but NON-visual → EXCLUDED.
        let issue_20 = serde_json::json!({
            "successCriteria": [
                { "id": "SC1", "category": "functionality", "description": "the reconciler advances state from artifacts", "verified": false }
            ],
            "phases": []
        });
        // (c) visual but verified:true → EXCLUDED.
        let issue_30 = serde_json::json!({
            "successCriteria": [
                { "id": "SC1", "category": "visual", "description": "the layout looks right", "verified": true }
            ],
            "phases": []
        });
        std::fs::write(archive.join("issue-10.json"), issue_10.to_string()).unwrap();
        std::fs::write(archive.join("issue-20.json"), issue_20.to_string()).unwrap();
        std::fs::write(archive.join("issue-30.json"), issue_30.to_string()).unwrap();
        tiki
    }

    /// #281 (SC1/SC4): `tiki_doctor` surfaces only the unverified visual/manual SCs
    /// from archived plans, sorted by (issue, id). Non-visual unverified SCs and
    /// verified visual SCs are excluded; the issue number is parsed from the
    /// `issue-N.json` filename.
    #[test]
    fn tiki_doctor_surfaces_unverified_visual_criteria() {
        let tiki = temp_tiki_unverified_sc_fixture("doctor");
        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();

        let pending = &report.unverified_shipped_criteria;
        // Exactly the two visual unverified SCs from issue-10 — issue-20 (non-visual)
        // and issue-30 (verified) are excluded.
        assert_eq!(
            pending.len(),
            2,
            "only the two visual unverified SCs from issue-10 should surface, got: {:?}",
            pending
        );
        // Sorted by (issue, id): SC1 before SC2 even though the file lists SC2 first.
        assert_eq!(pending[0].issue, 10);
        assert_eq!(pending[0].id, "SC1");
        assert_eq!(pending[0].description, "the badge renders correctly");
        assert_eq!(pending[1].issue, 10);
        assert_eq!(pending[1].id, "SC2");
        assert_eq!(pending[1].description, "the panel renders correctly");
        // Defensive: nothing from the excluded plans leaked in.
        assert!(
            pending.iter().all(|c| c.issue == 10),
            "no criteria from the non-visual or verified plans should appear"
        );

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// #281 / #259 round-trip discipline: a `DiagnosticsReport` serializes with the
    /// `unverifiedShippedCriteria` key (camelCase) as an array, and each entry uses
    /// the camelCase `{issue, id, description}` shape the frontend mirrors. If the
    /// key is dropped/renamed at the IPC boundary the desktop reads `undefined`.
    #[test]
    fn diagnostics_report_serializes_unverified_shipped_criteria_key() {
        let tiki = temp_tiki_unverified_sc_fixture("serialize");
        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        let value = serde_json::to_value(&report).expect("DiagnosticsReport must serialize");

        let arr = value
            .get("unverifiedShippedCriteria")
            .expect("unverifiedShippedCriteria key must be present in the IPC payload")
            .as_array()
            .expect("unverifiedShippedCriteria must serialize as an array");
        assert_eq!(arr.len(), 2, "the fixture's two visual unverified SCs must serialize");
        let first = &arr[0];
        assert_eq!(first.get("issue").and_then(|v| v.as_u64()), Some(10));
        assert_eq!(first.get("id").and_then(|v| v.as_str()), Some("SC1"));
        assert!(
            first.get("description").and_then(|v| v.as_str()).is_some(),
            "each entry must carry a description field"
        );

        std::fs::remove_dir_all(&tiki).ok();
    }

    /// #276: `normalize_archived_releases` rewrites ONLY the stale-active archived
    /// def to `status:"shipped"`, returns the count fixed, and leaves the
    /// already-shipped archived def + the active-location def untouched (preserving
    /// their other fields). Location-derived completion is unaffected; this only
    /// reconciles the cosmetic on-disk `status`.
    fn temp_tiki_normalize_fixture(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tiki = std::env::temp_dir().join(format!("tiki-normalize-{}-{}", tag, nanos));
        let releases = tiki.join("releases");
        let archive = releases.join("archive");
        std::fs::create_dir_all(&archive).unwrap();

        // Stale-active archived def (the residue to fix) — note extra fields to
        // confirm they survive the rewrite.
        let stale = serde_json::json!({
            "version": "v9.9.8",
            "status": "active",
            "issues": [101, 102],
            "createdAt": "2026-01-01T00:00:00.000Z"
        });
        // Already-shipped archived def — must be left byte-equivalent.
        let shipped = serde_json::json!({
            "version": "v9.9.7",
            "status": "shipped",
            "issues": [103],
            "createdAt": "2026-01-01T00:00:00.000Z"
        });
        // Active-location def — must NOT be touched (it's a live release).
        let live = serde_json::json!({
            "version": "v9.9.9",
            "status": "active",
            "issues": [104],
            "createdAt": "2026-01-01T00:00:00.000Z"
        });
        std::fs::write(archive.join("v9.9.8.json"), stale.to_string()).unwrap();
        std::fs::write(archive.join("v9.9.7.json"), shipped.to_string()).unwrap();
        std::fs::write(releases.join("v9.9.9.json"), live.to_string()).unwrap();
        tiki
    }

    #[test]
    fn normalize_archived_releases_fixes_only_stale_active_archived_defs() {
        let tiki = temp_tiki_normalize_fixture("fix");
        let tiki_str = tiki.to_string_lossy().to_string();

        let archive = tiki.join("releases").join("archive");
        let live_path = tiki.join("releases").join("v9.9.9.json");
        let shipped_before = std::fs::read_to_string(archive.join("v9.9.7.json")).unwrap();
        let live_before = std::fs::read_to_string(&live_path).unwrap();

        let count = normalize_archived_releases(Some(tiki_str)).unwrap();
        assert_eq!(count, 1, "only the one stale-active archived def is fixed");

        // The stale def is now shipped AND kept its other fields.
        let stale_after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(archive.join("v9.9.8.json")).unwrap())
                .unwrap();
        assert_eq!(stale_after["status"], "shipped");
        assert_eq!(stale_after["version"], "v9.9.8");
        assert_eq!(stale_after["issues"], serde_json::json!([101, 102]));
        assert_eq!(stale_after["createdAt"], "2026-01-01T00:00:00.000Z");

        // The already-shipped archived def is untouched (byte-equivalent).
        let shipped_after = std::fs::read_to_string(archive.join("v9.9.7.json")).unwrap();
        assert_eq!(shipped_after, shipped_before, "shipped archived def must be untouched");

        // The active-location def is untouched (byte-equivalent) — still active.
        let live_after = std::fs::read_to_string(&live_path).unwrap();
        assert_eq!(live_after, live_before, "active-location def must not be touched");

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

    /// Creates `.claude/tiki/scripts/` under `project` with all four canonical
    /// scripts present (the healthy copy-install/script floor).
    fn write_canonical_scripts(project: &Path) {
        let scripts = project.join(".claude").join("tiki").join("scripts");
        std::fs::create_dir_all(&scripts).unwrap();
        for name in CANONICAL_TIKI_SCRIPTS {
            std::fs::write(scripts.join(name), "// stub").unwrap();
        }
    }

    /// #268 Fix B: with all four canonical scripts on disk, the unresolved
    /// list is empty.
    #[test]
    fn compute_unresolved_script_paths_empty_for_healthy_layout() {
        let project = temp_project("scripts-healthy");
        write_canonical_scripts(&project);

        let missing = compute_unresolved_script_paths(&project);
        assert!(
            missing.is_empty(),
            "all canonical scripts exist, expected empty, got {:?}",
            missing
        );
        std::fs::remove_dir_all(&project).ok();
    }

    /// #268 Fix B: a plugin-only layout (no `.claude/tiki/scripts/` at all)
    /// reports exactly the four canonical paths, sorted.
    #[test]
    fn compute_unresolved_script_paths_reports_canonical_floor_when_missing() {
        let project = temp_project("scripts-missing");

        let missing = compute_unresolved_script_paths(&project);
        assert_eq!(
            missing,
            vec![
                ".claude/tiki/scripts/mark-audited.mjs".to_string(),
                ".claude/tiki/scripts/reconcile-state.mjs".to_string(),
                ".claude/tiki/scripts/run-hook.mjs".to_string(),
                ".claude/tiki/scripts/state.mjs".to_string(),
            ],
            "missing scripts dir must yield exactly the sorted canonical floor"
        );
        std::fs::remove_dir_all(&project).ok();
    }

    /// #268 Fix B: on a copy install, invocations inside installed command
    /// bodies are checked too — an `extra.mjs` referenced by a command file but
    /// absent on disk is reported (and the present canonical floor is not).
    /// `${CLAUDE_PLUGIN_ROOT}` invocations are ignored.
    #[test]
    fn compute_unresolved_script_paths_scans_installed_command_bodies() {
        let project = temp_project("scripts-cmd-scan");
        write_canonical_scripts(&project);
        let commands = project.join(".claude").join("commands").join("tiki");
        std::fs::create_dir_all(&commands).unwrap();
        std::fs::write(
            commands.join("foo.md"),
            "Run this:\n\
             ```bash\n\
             node .claude/tiki/scripts/state.mjs transition issue:1\n\
             node .claude/tiki/scripts/extra.mjs --flag\n\
             node ${CLAUDE_PLUGIN_ROOT}/scripts/plugin-only.mjs\n\
             ```\n",
        )
        .unwrap();

        let missing = compute_unresolved_script_paths(&project);
        assert_eq!(
            missing,
            vec![".claude/tiki/scripts/extra.mjs".to_string()],
            "only the command-body extra should be unresolved"
        );
        std::fs::remove_dir_all(&project).ok();
    }

    /// #268: `copy_install_detected` is true iff `.claude/commands/tiki/`
    /// exists, and a fixture mirroring the dogfood repo layout (commands dir +
    /// full script floor) is fully healthy.
    #[test]
    fn tiki_doctor_reports_copy_install_and_unresolved_scripts() {
        // Copy-install fixture mirroring this dogfood repo: commands dir +
        // all canonical scripts + a valid .tiki.
        let copy = temp_project("doctor-copy-install");
        write_canonical_scripts(&copy);
        std::fs::create_dir_all(copy.join(".claude").join("commands").join("tiki")).unwrap();
        let tiki = copy.join(".tiki");
        std::fs::create_dir_all(&tiki).unwrap();
        std::fs::write(
            tiki.join("state.json"),
            serde_json::json!({ "schemaVersion": 1, "activeWork": {} }).to_string(),
        )
        .unwrap();

        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        assert!(
            report.copy_install_detected,
            ".claude/commands/tiki/ exists, marker must be true"
        );
        assert!(
            report.unresolved_script_paths.is_empty(),
            "full script floor present, expected empty, got {:?}",
            report.unresolved_script_paths
        );
        std::fs::remove_dir_all(&copy).ok();

        // Plugin-only fixture: no commands dir, no scripts dir.
        let plugin = temp_project("doctor-plugin-only");
        let tiki = plugin.join(".tiki");
        std::fs::create_dir_all(&tiki).unwrap();
        std::fs::write(
            tiki.join("state.json"),
            serde_json::json!({ "schemaVersion": 1, "activeWork": {} }).to_string(),
        )
        .unwrap();

        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        assert!(
            !report.copy_install_detected,
            "no .claude/commands/tiki/, marker must be false"
        );
        assert_eq!(
            report.unresolved_script_paths.len(),
            4,
            "plugin-only install must report the 4-script canonical floor, got {:?}",
            report.unresolved_script_paths
        );
        std::fs::remove_dir_all(&plugin).ok();
    }

    /// #259 lesson: any new IPC field must be proven to survive serde — Tauri
    /// serializes command returns with the same Serialize impl, so a
    /// `skip_serializing` or naming drift silently strips fields from the
    /// payload. Assert the camelCase KEYS exist in the serialized value.
    #[test]
    fn diagnostics_report_serializes_new_camel_case_keys() {
        let project = temp_project("doctor-serde");
        let tiki = project.join(".tiki");
        std::fs::create_dir_all(&tiki).unwrap();
        std::fs::write(
            tiki.join("state.json"),
            serde_json::json!({ "schemaVersion": 1, "activeWork": {} }).to_string(),
        )
        .unwrap();

        let report = tiki_doctor(Some(tiki.to_string_lossy().to_string())).unwrap();
        let value = serde_json::to_value(&report).unwrap();
        let obj = value.as_object().expect("report serializes to an object");
        assert!(
            obj.contains_key("unresolvedScriptPaths"),
            "unresolvedScriptPaths must survive serialization, got keys {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        assert!(
            obj.contains_key("copyInstallDetected"),
            "copyInstallDetected must survive serialization, got keys {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        std::fs::remove_dir_all(&project).ok();
    }
}

/// #278 — serde wire-shape guard for EVERY struct returned across the Tauri IPC
/// boundary. Generalizes the #259 `tiki_release_archived_survives_serialization`
/// lesson (one field, one struct) into a contract over the whole IPC surface.
///
/// Tauri serializes a `#[tauri::command]` return value with the type's derived
/// `Serialize` impl, so the JSON the React frontend receives IS exactly
/// `serde_json::to_value(&value)`. These tests pin that JSON:
///   - expected camelCase keys are PRESENT (a dropped/mis-renamed field fails here);
///   - `skip_serializing_if = "Option::is_none"` fields are present-when-Some and
///     ABSENT-when-None (asserted both directions);
///   - non-optional and `#[serde(default)]` fields are ALWAYS present, even at their
///     default/false value (the #259 invariant — `archived:false`,
///     `unresolvedScriptPaths:[]`);
///   - the `#[serde(tag = "type")]` `WorkContext` union emits `type:"issue"` /
///     `type:"release"`.
///
/// If a field is renamed, dropped, or re-tagged on the wire, one of these fails
/// even when every behavioral test stays green — do not relax the assertions.
#[cfg(test)]
mod ipc_serialization {
    use crate::github::{
        GitHubComment, GitHubCommentAuthor, GitHubIssue, GitHubLabel, GitHubPrAuthor,
        GitHubPrDetail, GitHubPrFile, GitHubPrReview, GitHubPrStatusCheck, GitHubPullRequest,
        GitHubRelease,
    };
    use crate::state::{
        DiagnosticsReport, IssueContext, IssueRef, Phase, PhaseProgress, PhaseProgressStatus,
        PhaseStatus, PipelineStep, ReleaseCheck, ReleaseContext, ReleaseRef, TikiPlan, TikiRelease,
        TikiReleaseIssue, TikiReleaseStatus, TikiState, UnverifiedCriterion, WorkContext,
        WorkStatus,
    };
    use serde_json::Value;
    use std::collections::HashMap;

    /// Assert every name in `keys` is a present key on the serialized object.
    fn assert_keys_present(value: &Value, keys: &[&str]) {
        let obj = value
            .as_object()
            .unwrap_or_else(|| panic!("expected a JSON object, got {value}"));
        for k in keys {
            assert!(
                obj.contains_key(*k),
                "expected camelCase key `{k}` present; got keys {:?}",
                obj.keys().collect::<Vec<_>>()
            );
        }
    }

    fn assert_key_absent(value: &Value, key: &str) {
        let obj = value.as_object().expect("expected a JSON object");
        assert!(
            !obj.contains_key(key),
            "key `{key}` must be ABSENT when None (skip_serializing_if), got {:?}",
            obj.keys().collect::<Vec<_>>()
        );
    }

    // ── TikiRelease — folds in the #259 `archived` invariant ───────────────────
    #[test]
    fn tiki_release_wire_shape() {
        // Fully populated (name/updatedAt Some).
        let full = TikiRelease {
            version: "v1.2.3".to_string(),
            name: Some("Tiki v1.2.3".to_string()),
            status: TikiReleaseStatus::Shipped,
            issues: vec![TikiReleaseIssue {
                number: 7,
                title: "thing".to_string(),
            }],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: Some("2026-01-02T00:00:00Z".to_string()),
            archived: true,
        };
        let v = serde_json::to_value(&full).unwrap();
        assert_keys_present(
            &v,
            &["version", "name", "status", "issues", "createdAt", "updatedAt", "archived"],
        );
        // Nested TikiReleaseIssue camelCase keys.
        assert_keys_present(&v["issues"][0], &["number", "title"]);

        // #259 invariant (folded): `archived` is non-Option + #[serde(default)],
        // so it MUST be present even when false — this is the exact check the old
        // `tiki_release_archived_survives_serialization` test asserted, kept here.
        let archived_false = TikiRelease {
            version: "v1.0.0".to_string(),
            name: None,
            status: TikiReleaseStatus::Active,
            issues: vec![],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: None,
            archived: false,
        };
        let v0 = serde_json::to_value(&archived_false).unwrap();
        assert_eq!(
            v0.get("archived").and_then(Value::as_bool),
            Some(false),
            "`archived` must be present in the serialized TikiRelease even when false \
             so it crosses the Tauri IPC boundary — the stale `status` must not become \
             the only completed-signal the UI receives (#255/#258/#259)"
        );
        // Mirror #259 directly: present == true when archived.
        assert_eq!(v.get("archived").and_then(Value::as_bool), Some(true));
        // skip_serializing_if Option::is_none — name/updatedAt absent when None.
        assert_key_absent(&v0, "name");
        assert_key_absent(&v0, "updatedAt");
        // snake_case enum value for status.
        assert_eq!(v0["status"], "active");
        assert_eq!(v["status"], "shipped");
    }

    // ── TikiState ──────────────────────────────────────────────────────────────
    #[test]
    fn tiki_state_wire_shape() {
        let mut active = HashMap::new();
        active.insert(
            "issue:42".to_string(),
            WorkContext::Issue(sample_issue_context(true)),
        );
        let state = TikiState {
            schema_version: 2,
            active_work: active,
            history: None,
        };
        let v = serde_json::to_value(&state).unwrap();
        // schemaVersion + activeWork always present; history absent when None.
        assert_keys_present(&v, &["schemaVersion", "activeWork"]);
        assert_key_absent(&v, "history");
        assert_eq!(v["schemaVersion"], 2);
        assert!(v["activeWork"]["issue:42"].is_object());
    }

    // ── WorkContext union (#[serde(tag = "type")]) + IssueContext ──────────────
    fn sample_issue_context(with_optionals: bool) -> IssueContext {
        IssueContext {
            issue: IssueRef {
                number: 42,
                title: Some("an issue".to_string()),
                body: None,
                state: None,
                labels: None,
                label_details: None,
                url: None,
                created_at: None,
                updated_at: None,
            },
            status: WorkStatus::Executing,
            pipeline_step: if with_optionals {
                Some(PipelineStep::Execute)
            } else {
                None
            },
            pipeline_history: None,
            phase: if with_optionals {
                Some(PhaseProgress {
                    total: 3,
                    current: 2,
                    status: PhaseProgressStatus::Executing,
                })
            } else {
                None
            },
            parallel_execution: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_activity: None,
            audit_passed: if with_optionals { Some(true) } else { None },
            yolo: None,
            commit: None,
            parent_release: None,
        }
    }

    #[test]
    fn work_context_issue_tag_and_issue_context_wire_shape() {
        let ctx = WorkContext::Issue(sample_issue_context(true));
        let v = serde_json::to_value(&ctx).unwrap();
        // #[serde(tag = "type")] discriminant.
        assert_eq!(v["type"], "issue");
        // IssueContext fields are flattened alongside `type`.
        assert_keys_present(
            &v,
            &["type", "issue", "status", "pipelineStep", "phase", "createdAt", "auditPassed"],
        );
        // Enum rename values.
        assert_eq!(v["status"], "executing"); // WorkStatus lowercase
        assert_eq!(v["pipelineStep"], "EXECUTE"); // PipelineStep SCREAMING_SNAKE_CASE
        // Nested IssueRef camelCase: present `number`/`title`, absent optionals.
        assert_keys_present(&v["issue"], &["number", "title"]);
        assert_key_absent(&v["issue"], "body");
        assert_key_absent(&v["issue"], "createdAt");
        // Nested PhaseProgress.
        assert_keys_present(&v["phase"], &["total", "current", "status"]);
    }

    #[test]
    fn issue_context_optionals_absent_when_none() {
        // Same struct, optionals = None: skip_serializing_if drops them entirely.
        let ctx = WorkContext::Issue(sample_issue_context(false));
        let v = serde_json::to_value(&ctx).unwrap();
        assert_eq!(v["type"], "issue");
        // Required survive.
        assert_keys_present(&v, &["type", "issue", "status", "createdAt"]);
        // skip_serializing_if = Option::is_none — both directions asserted vs the
        // Some-variant test above. pipelineStep/phase/auditPassed must vanish.
        assert_key_absent(&v, "pipelineStep");
        assert_key_absent(&v, "phase");
        assert_key_absent(&v, "auditPassed");
        assert_key_absent(&v, "lastActivity");
        assert_key_absent(&v, "parentRelease");
    }

    #[test]
    fn work_context_release_tag_wire_shape() {
        let ctx = WorkContext::Release(ReleaseContext {
            release: ReleaseRef {
                version: "v1.2.0".to_string(),
                issues: vec![1, 2],
                current_issue: Some(1),
                completed_issues: vec![],
                milestone: None,
            },
            status: WorkStatus::Shipping,
            pipeline_step: Some(PipelineStep::Ship),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_activity: None,
        });
        let v = serde_json::to_value(&ctx).unwrap();
        assert_eq!(v["type"], "release");
        assert_keys_present(&v, &["type", "release", "status", "pipelineStep", "createdAt"]);
        assert_keys_present(
            &v["release"],
            &["version", "issues", "currentIssue", "completedIssues"],
        );
        assert_key_absent(&v["release"], "milestone");
    }

    // ── TikiPlan + Phase ───────────────────────────────────────────────────────
    #[test]
    fn tiki_plan_and_phase_wire_shape() {
        let plan = TikiPlan {
            issue: None,
            issue_number: None,
            title: None,
            description: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            schema_version: Some(1),
            success_criteria: None,
            phases: vec![Phase {
                number: 1,
                title: "phase one".to_string(),
                status: PhaseStatus::Completed,
                content: Some("body".to_string()),
                verification: Some(vec!["check".to_string()]),
                addresses_criteria: Some(vec!["SC1".to_string()]),
                files: Some(vec!["a.rs".to_string()]),
                tasks: None,
                dependencies: Some(vec![]),
                started_at: None,
                completed_at: Some("2026-01-02T00:00:00Z".to_string()),
                summary: None,
            }],
            coverage_matrix: None,
            audited: Some(true),
            audited_at: None,
        };
        let v = serde_json::to_value(&plan).unwrap();
        // createdAt always present; phases array present; optional-None keys absent.
        assert_keys_present(&v, &["createdAt", "schemaVersion", "phases", "audited"]);
        assert_key_absent(&v, "issue");
        assert_key_absent(&v, "coverageMatrix");
        assert_key_absent(&v, "auditedAt");

        let phase = &v["phases"][0];
        assert_keys_present(
            phase,
            &[
                "number",
                "title",
                "status",
                "content",
                "verification",
                "addressesCriteria",
                "files",
                "dependencies",
                "completedAt",
            ],
        );
        assert_eq!(phase["status"], "completed"); // PhaseStatus lowercase
        // skip_serializing_if None on Phase.
        assert_key_absent(phase, "tasks");
        assert_key_absent(phase, "startedAt");
        assert_key_absent(phase, "summary");
    }

    // ── DiagnosticsReport + ReleaseCheck ───────────────────────────────────────
    #[test]
    fn diagnostics_report_and_release_check_wire_shape() {
        let report = DiagnosticsReport {
            framework_version: Some("9.9.9".to_string()),
            state_valid: true,
            schema_version: Some(1),
            active_work_count: 0,
            release_checks: vec![ReleaseCheck {
                version: "v1.0.0".to_string(),
                location: "archive".to_string(),
                status: "active".to_string(),
                archived_but_active: true,
            }],
            recent_releases_missing_json: vec![],
            reconciler_hook_installed: false,
            // #[serde(default)] empty vec — must still serialize as `[]`, not vanish.
            unresolved_script_paths: vec![],
            copy_install_detected: false,
            unverified_shipped_criteria: vec![UnverifiedCriterion {
                issue: 10,
                id: "SC1".to_string(),
                description: "the badge renders correctly".to_string(),
            }],
        };
        let v = serde_json::to_value(&report).unwrap();
        assert_keys_present(
            &v,
            &[
                "frameworkVersion",
                "stateValid",
                "schemaVersion",
                "activeWorkCount",
                "releaseChecks",
                "recentReleasesMissingJson",
                "reconcilerHookInstalled",
                "unresolvedScriptPaths",
                "copyInstallDetected",
                "unverifiedShippedCriteria",
            ],
        );
        // #[serde(default)] / non-optional: present even at default value.
        assert_eq!(
            v["unresolvedScriptPaths"],
            serde_json::json!([]),
            "unresolvedScriptPaths must serialize as [] even when empty (#268)"
        );
        assert_eq!(v["copyInstallDetected"], false);
        assert_eq!(v["reconcilerHookInstalled"], false);

        let check = &v["releaseChecks"][0];
        assert_keys_present(
            check,
            &["version", "location", "status", "archivedButActive"],
        );
        assert_eq!(check["archivedButActive"], true);

        // #281: entries carry the camelCase {issue, id, description} shape the
        // frontend mirrors.
        let crit = &v["unverifiedShippedCriteria"][0];
        assert_keys_present(crit, &["issue", "id", "description"]);
        assert_eq!(crit["issue"], 10);
        assert_eq!(crit["id"], "SC1");
    }

    // ── GitHubRelease — Some + None both directions ────────────────────────────
    #[test]
    fn github_release_optionals_both_directions() {
        // Some: name/publishedAt/url present.
        let full = GitHubRelease {
            tag_name: "v0.7.3".to_string(),
            name: Some("Tiki v0.7.3".to_string()),
            is_draft: false,
            is_prerelease: false,
            published_at: Some("2026-05-22T09:00:00Z".to_string()),
            url: Some("https://github.com/o/r/releases/tag/v0.7.3".to_string()),
        };
        let v = serde_json::to_value(&full).unwrap();
        assert_keys_present(
            &v,
            &["tagName", "name", "isDraft", "isPrerelease", "publishedAt", "url"],
        );
        assert_eq!(v["isDraft"], false);

        // None: name/publishedAt/url ABSENT (skip_serializing_if), required survive.
        let draft = GitHubRelease {
            tag_name: "v0.8.0-draft".to_string(),
            name: None,
            is_draft: true,
            is_prerelease: true,
            published_at: None,
            url: None,
        };
        let v2 = serde_json::to_value(&draft).unwrap();
        assert_keys_present(&v2, &["tagName", "isDraft", "isPrerelease"]);
        assert_key_absent(&v2, "name");
        assert_key_absent(&v2, "publishedAt");
        assert_key_absent(&v2, "url");
    }

    // ── GitHubIssue ────────────────────────────────────────────────────────────
    #[test]
    fn github_issue_wire_shape() {
        let issue = GitHubIssue {
            number: 233,
            title: "Split github.rs".to_string(),
            body: Some("Refactor.".to_string()),
            state: "OPEN".to_string(),
            labels: vec![GitHubLabel {
                id: "L_1".to_string(),
                name: "refactor".to_string(),
                color: "ededed".to_string(),
                description: Some("code cleanup".to_string()),
            }],
            url: "https://github.com/o/r/issues/233".to_string(),
            created_at: "2026-05-22T10:00:00Z".to_string(),
            updated_at: "2026-05-22T11:30:00Z".to_string(),
        };
        let v = serde_json::to_value(&issue).unwrap();
        assert_keys_present(
            &v,
            &["number", "title", "body", "state", "labels", "url", "createdAt", "updatedAt"],
        );
        // Nested GitHubLabel.
        assert_keys_present(&v["labels"][0], &["id", "name", "color", "description"]);

        // body None -> absent.
        let no_body = GitHubIssue {
            body: None,
            ..issue
        };
        let v2 = serde_json::to_value(&no_body).unwrap();
        assert_key_absent(&v2, "body");
    }

    // ── GitHubPullRequest ──────────────────────────────────────────────────────
    #[test]
    fn github_pull_request_wire_shape() {
        let pr = GitHubPullRequest {
            number: 42,
            title: "Add feature".to_string(),
            state: "OPEN".to_string(),
            head_ref_name: "feature/add".to_string(),
            base_ref_name: "main".to_string(),
            url: "https://github.com/o/r/pull/42".to_string(),
            is_draft: false,
            review_decision: Some("APPROVED".to_string()),
            author: Some(GitHubPrAuthor {
                login: "octocat".to_string(),
            }),
            labels: vec![GitHubLabel {
                id: "L_1".to_string(),
                name: "enhancement".to_string(),
                color: "a2eeef".to_string(),
                description: None,
            }],
            body: Some("Implements.".to_string()),
            status_check_rollup: vec![GitHubPrStatusCheck {
                context: None,
                name: Some("build".to_string()),
                state: None,
                status: Some("COMPLETED".to_string()),
                conclusion: Some("SUCCESS".to_string()),
                details_url: Some("https://github.com/o/r/actions/runs/1".to_string()),
            }],
        };
        let v = serde_json::to_value(&pr).unwrap();
        assert_keys_present(
            &v,
            &[
                "number",
                "title",
                "state",
                "headRefName",
                "baseRefName",
                "url",
                "isDraft",
                "reviewDecision",
                "author",
                "labels",
                "body",
                "statusCheckRollup",
            ],
        );
        assert_keys_present(&v["author"], &["login"]);
        // Nested status check camelCase (detailsUrl).
        assert_keys_present(&v["statusCheckRollup"][0], &["name", "status", "conclusion", "detailsUrl"]);
    }

    // ── GitHubPrDetail (+ nested GitHubPrFile / GitHubPrReview) ────────────────
    #[test]
    fn github_pr_detail_wire_shape() {
        let detail = GitHubPrDetail {
            number: 99,
            title: "Big change".to_string(),
            body: Some("Detailed.".to_string()),
            state: "MERGED".to_string(),
            head_ref_name: "big/change".to_string(),
            base_ref_name: "main".to_string(),
            url: "https://github.com/o/r/pull/99".to_string(),
            is_draft: false,
            review_decision: Some("APPROVED".to_string()),
            author: Some(GitHubPrAuthor {
                login: "dev".to_string(),
            }),
            labels: vec![],
            status_check_rollup: vec![],
            additions: 120,
            deletions: 30,
            commits: serde_json::json!([{ "oid": "abc123" }]),
            files: vec![GitHubPrFile {
                path: "src/lib.rs".to_string(),
                additions: 10,
                deletions: 2,
            }],
            reviews: vec![GitHubPrReview {
                author: Some(GitHubPrAuthor {
                    login: "reviewer".to_string(),
                }),
                state: "APPROVED".to_string(),
                body: Some("LGTM".to_string()),
            }],
        };
        let v = serde_json::to_value(&detail).unwrap();
        assert_keys_present(
            &v,
            &[
                "number",
                "title",
                "body",
                "state",
                "headRefName",
                "baseRefName",
                "url",
                "isDraft",
                "reviewDecision",
                "author",
                "labels",
                "statusCheckRollup",
                "additions",
                "deletions",
                "commits",
                "files",
                "reviews",
            ],
        );
        assert_keys_present(&v["files"][0], &["path", "additions", "deletions"]);
        assert_keys_present(&v["reviews"][0], &["author", "state", "body"]);
    }

    // ── GitHubComment ──────────────────────────────────────────────────────────
    #[test]
    fn github_comment_wire_shape() {
        let comment = GitHubComment {
            id: "IC_1".to_string(),
            author: GitHubCommentAuthor {
                login: "octocat".to_string(),
            },
            body: "Looks good.".to_string(),
            created_at: "2026-05-22T12:00:00Z".to_string(),
            url: "https://github.com/o/r/issues/233#issuecomment-1".to_string(),
        };
        let v = serde_json::to_value(&comment).unwrap();
        assert_keys_present(&v, &["id", "author", "body", "createdAt", "url"]);
        assert_keys_present(&v["author"], &["login"]);
    }
}
