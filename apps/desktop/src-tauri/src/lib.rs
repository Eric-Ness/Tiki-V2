mod commands;
mod github;
mod state;
mod terminal;
mod watcher;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::select_project_directory,
            commands::validate_tiki_directory,
            commands::switch_project,
            github::check_gh_auth,
            github::fetch_github_issues,
            github::fetch_github_releases,
            terminal::commands::create_terminal,
            terminal::commands::write_terminal,
            terminal::commands::resize_terminal,
            terminal::commands::destroy_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
