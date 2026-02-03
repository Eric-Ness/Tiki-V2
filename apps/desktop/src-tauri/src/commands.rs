use crate::state::{TikiPlan, TikiState};
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
