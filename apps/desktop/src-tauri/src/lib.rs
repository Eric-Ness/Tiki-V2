mod commands;
mod state;
mod watcher;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize logging in debug mode
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start file watcher for .tiki directory
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = watcher::start_watcher(app_handle) {
                    log::error!("Failed to start file watcher: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_plan,
            commands::get_tiki_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
