use crate::fs_utils::{self, BackupInfo};
use crate::state::{TikiPlan, TikiRelease, TikiState};
use crate::watcher;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// Get the path to the .tiki directory in the current working directory
#[tauri::command]
pub fn get_tiki_path() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let tiki_path = cwd.join(".tiki");
    Ok(tiki_path.to_string_lossy().to_string())
}

/// Read and return the current Tiki state
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

    if !state_file.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&state_file).map_err(|e| e.to_string())?;

    let state: TikiState = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(state))
}

/// Read and return a plan for a specific issue
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

    if !plan_file.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&plan_file).map_err(|e| e.to_string())?;

    let plan: TikiPlan = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(plan))
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

    // Collect directories to scan: top-level releases + archive subdirectory
    let mut dirs_to_scan = vec![releases_dir.clone()];
    let archive_dir = releases_dir.join("archive");
    if archive_dir.exists() {
        dirs_to_scan.push(archive_dir);
    }

    for dir in dirs_to_scan {
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

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
    }

    // Sort by version (descending)
    releases.sort_by(|a, b| b.version.cmp(&a.version));

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
