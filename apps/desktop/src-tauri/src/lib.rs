mod claude_usage;
mod commands;
mod fs_utils;
mod github;
mod state;
mod terminal;
mod watcher;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize logging in debug mode
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize updater plugin
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // Clean up any stale .tmp files from previous crashes
            if let Ok(cwd) = std::env::current_dir() {
                fs_utils::cleanup_stale_tmp_files(&cwd.join(".tiki"));
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
            commands::load_tiki_releases,
            commands::save_tiki_release,
            commands::delete_tiki_release,
            commands::backup_state,
            commands::list_backups,
            commands::restore_backup,
            github::check_claude_cli,
            github::check_gh_auth,
            github::fetch_github_issues,
            github::fetch_github_releases,
            github::fetch_github_labels,
            github::create_github_issue,
            github::edit_github_issue,
            github::close_github_issue,
            github::fetch_github_issue_by_number,
            github::fetch_issue_comments,
            github::post_issue_comment,
            github::enhance_issue_description,
            github::get_current_branch,
            github::list_git_branches,
            github::fetch_github_prs,
            github::fetch_github_pr_detail,
            terminal::commands::create_terminal,
            terminal::commands::write_terminal,
            terminal::commands::resize_terminal,
            terminal::commands::destroy_terminal,
            claude_usage::get_claude_usage,
            claude_usage::save_claude_session_key,
            claude_usage::has_claude_session_key,
            claude_usage::clear_claude_session_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
