use super::{get_terminal_manager, start_output_reader};
use tauri::AppHandle;

/// Create a new terminal session
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    log::info!(
        "create_terminal called: id='{}', shell={:?}, cwd={:?}",
        id,
        shell,
        cwd
    );

    // Validate id is not empty
    if id.is_empty() {
        return Err("Terminal ID cannot be empty".to_string());
    }

    // First create the session
    {
        let manager = get_terminal_manager();
        let mut guard = manager.lock().map_err(|e| format!("Lock error: {}", e))?;
        guard.create_session(id.clone(), shell, cwd)?;
    }

    // Then start the output reader thread
    start_output_reader(id.clone(), app)?;

    log::info!("Terminal '{}' created and reader started", id);
    Ok(())
}

/// Write data to a terminal session
#[tauri::command]
pub fn write_terminal(id: String, data: String) -> Result<(), String> {
    // Validate inputs
    if id.is_empty() {
        return Err("Terminal ID cannot be empty".to_string());
    }

    let manager = get_terminal_manager();
    let mut guard = manager.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = guard
        .get_session_mut(&id)
        .ok_or_else(|| format!("Terminal session '{}' not found. It may have been destroyed or exited.", id))?;
    session.write(&data)
}

/// Resize a terminal session
#[tauri::command]
pub fn resize_terminal(id: String, rows: u16, cols: u16) -> Result<(), String> {
    log::info!("resize_terminal called: id='{}', rows={}, cols={}", id, rows, cols);

    // Validate inputs
    if id.is_empty() {
        return Err("Terminal ID cannot be empty".to_string());
    }
    if rows == 0 || cols == 0 {
        return Err(format!(
            "Invalid terminal dimensions: rows={}, cols={}. Both must be greater than 0.",
            rows, cols
        ));
    }

    let manager = get_terminal_manager();
    let guard = manager.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = guard
        .get_session(&id)
        .ok_or_else(|| format!("Terminal session '{}' not found. It may have been destroyed or exited.", id))?;
    session.resize(rows, cols)?;

    log::info!("Terminal '{}' resized to {}x{}", id, cols, rows);
    Ok(())
}

/// Destroy a terminal session
#[tauri::command]
pub fn destroy_terminal(id: String) -> Result<(), String> {
    log::info!("destroy_terminal called: id='{}'", id);

    // Validate id
    if id.is_empty() {
        return Err("Terminal ID cannot be empty".to_string());
    }

    let manager = get_terminal_manager();
    let mut guard = manager.lock().map_err(|e| format!("Lock error: {}", e))?;
    guard
        .remove_session(&id)
        .ok_or_else(|| format!("Terminal session '{}' not found. It may have already been destroyed or exited.", id))?;

    log::info!("Terminal '{}' destroyed", id);
    Ok(())
}
