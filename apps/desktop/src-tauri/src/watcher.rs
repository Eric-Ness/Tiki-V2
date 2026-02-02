use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Events emitted to the frontend when files change
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TikiFileEvent {
    StateChanged,
    PlanChanged { issue_number: u32 },
    ReleaseChanged { version: String },
}

/// Start watching the .tiki directory for changes
pub fn start_watcher(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::current_dir()?;
    let tiki_path = cwd.join(".tiki");

    // If .tiki doesn't exist yet, wait for it
    if !tiki_path.exists() {
        log::info!("Waiting for .tiki directory to be created...");
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if tiki_path.exists() {
                log::info!(".tiki directory found, starting watcher");
                break;
            }
        }
    }

    let (tx, rx) = channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;

    watcher.watch(&tiki_path, RecursiveMode::Recursive)?;

    log::info!("Watching .tiki directory for changes: {:?}", tiki_path);

    // Process events
    loop {
        match rx.recv() {
            Ok(Ok(event)) => {
                if let Some(file_event) = process_event(&event) {
                    log::info!("Tiki file changed: {:?}", file_event);
                    if let Err(e) = app_handle.emit("tiki-file-changed", file_event) {
                        log::error!("Failed to emit event: {}", e);
                    }
                }
            }
            Ok(Err(e)) => {
                log::error!("Watch error: {:?}", e);
            }
            Err(e) => {
                log::error!("Channel receive error: {:?}", e);
                break;
            }
        }
    }

    Ok(())
}

/// Process a file system event and determine what Tiki event to emit
fn process_event(event: &Event) -> Option<TikiFileEvent> {
    // Only care about modify/create events
    if !matches!(
        event.kind,
        notify::EventKind::Modify(_) | notify::EventKind::Create(_)
    ) {
        return None;
    }

    for path in &event.paths {
        if let Some(file_name) = path.file_name() {
            let name = file_name.to_string_lossy();

            // Check for state.json
            if name == "state.json" {
                return Some(TikiFileEvent::StateChanged);
            }

            // Check for plan files (issue-N.json)
            if name.starts_with("issue-") && name.ends_with(".json") {
                if let Some(num_str) = name.strip_prefix("issue-").and_then(|s| s.strip_suffix(".json")) {
                    if let Ok(issue_number) = num_str.parse::<u32>() {
                        return Some(TikiFileEvent::PlanChanged { issue_number });
                    }
                }
            }

            // Check for release files
            if is_in_releases_dir(path) && name.ends_with(".json") {
                if let Some(version) = name.strip_suffix(".json") {
                    return Some(TikiFileEvent::ReleaseChanged {
                        version: version.to_string(),
                    });
                }
            }
        }
    }

    None
}

/// Check if a path is inside the releases directory
fn is_in_releases_dir(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "releases")
}
