use crate::state::{TikiPlan, TikiState};
use std::path::PathBuf;

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
