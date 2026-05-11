use crate::fs_utils::{self, BackupInfo};
use crate::state::{TikiPlan, TikiRelease, TikiState, WorkContext, WorkStatus};
use crate::watcher;
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Framework command files embedded at compile time. The bundled framework
/// version always matches the desktop binary (kept in sync by version-bump.mjs),
/// so a single binary contains everything needed to install or refresh a
/// project's `.claude/commands/tiki/` directory offline.
static FRAMEWORK_COMMANDS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../packages/framework/commands");

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

/// Load all Tiki releases from .tiki/releases/
#[tauri::command]
pub fn load_tiki_releases(tiki_path: Option<String>) -> Result<Vec<TikiRelease>, String> {
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

    let entries = std::fs::read_dir(&releases_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if file_path.extension().map_or(false, |ext| ext == "json") {
            let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
            match serde_json::from_str::<TikiRelease>(&content) {
                Ok(release) => releases.push(release),
                Err(e) => {
                    log::warn!("Failed to parse release file {:?}: {}", file_path, e);
                }
            }
        }
    }

    // Sort by version (descending, semver-aware)
    releases.sort_by(|a, b| cmp_semver(&b.version, &a.version));

    Ok(releases)
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

/// Helper to resolve the .tiki path from an optional parameter
fn resolve_tiki_path(tiki_path: Option<String>) -> Result<PathBuf, String> {
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

    let version = app.package_info().version.to_string();
    let tiki_dir = project.join(".tiki");
    std::fs::create_dir_all(&tiki_dir).map_err(|e| e.to_string())?;
    std::fs::write(tiki_dir.join(".framework-version"), &version).map_err(|e| e.to_string())?;

    log::info!(
        "Installed {} framework commands to {:?} (version {})",
        installed,
        commands_dir,
        version
    );
    Ok(version)
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
