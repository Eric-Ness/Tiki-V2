use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Global state for the watcher - allows switching projects
static WATCHER_STATE: OnceLock<Arc<Mutex<WatcherState>>> = OnceLock::new();

struct WatcherState {
    current_path: Option<PathBuf>,
    stop_signal: Option<Sender<()>>,
}

/// Get or initialize the watcher state
fn get_watcher_state() -> Arc<Mutex<WatcherState>> {
    WATCHER_STATE
        .get_or_init(|| {
            Arc::new(Mutex::new(WatcherState {
                current_path: None,
                stop_signal: None,
            }))
        })
        .clone()
}

/// Switch the watcher to a new project path
pub fn switch_watch_path(app_handle: AppHandle, new_path: PathBuf) -> Result<(), String> {
    let state = get_watcher_state();

    // Stop current watcher if running
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        if let Some(stop_tx) = guard.stop_signal.take() {
            let _ = stop_tx.send(());
        }
        guard.current_path = Some(new_path.clone());
    }

    // Start new watcher in a separate thread
    std::thread::spawn(move || {
        if let Err(e) = start_watcher_internal(app_handle, new_path) {
            log::error!("Failed to start watcher for new path: {}", e);
        }
    });

    Ok(())
}

/// Events emitted to the frontend when files change
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TikiFileEvent {
    StateChanged,
    PlanChanged { issue_number: u32 },
    ReleaseChanged { version: String },
}

/// Start watching the .tiki directory for changes (initial startup)
pub fn start_watcher(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::current_dir()?;
    let tiki_path = cwd.join(".tiki");

    // Initialize state with current path
    {
        let state = get_watcher_state();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.current_path = Some(tiki_path.clone());
    }

    start_watcher_internal(app_handle, tiki_path)
}

/// Internal watcher implementation that can be restarted for different paths
fn start_watcher_internal(
    app_handle: AppHandle,
    project_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let tiki_path = project_path.join(".tiki");

    // If .tiki doesn't exist yet, wait for it
    if !tiki_path.exists() {
        log::info!("Waiting for .tiki directory to be created at {:?}...", tiki_path);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if tiki_path.exists() {
                log::info!(".tiki directory found, starting watcher");
                break;
            }
            // Check if we should stop
            let state = get_watcher_state();
            let should_stop = state
                .lock()
                .map(|guard| guard.current_path.as_ref() != Some(&project_path))
                .unwrap_or(false);
            drop(state);
            if should_stop {
                log::info!("Project path changed while waiting, stopping this watcher");
                return Ok(());
            }
        }
    }

    // Create stop channel
    let (stop_tx, stop_rx) = channel::<()>();

    // Store stop signal in state
    let state = get_watcher_state();
    if let Ok(mut guard) = state.lock() {
        guard.stop_signal = Some(stop_tx);
    }
    drop(state);

    let (tx, rx) = channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;

    watcher.watch(&tiki_path, RecursiveMode::Recursive)?;

    log::info!("Watching .tiki directory for changes: {:?}", tiki_path);

    // Leading-edge debounce: a single atomic write produces 3-5 raw notify
    // events; we coalesce them per logical target so the frontend gets one
    // reload instead of a storm. Bounded by issue/release cardinality.
    let mut last_emissions: HashMap<String, Instant> = HashMap::new();
    const DEBOUNCE: Duration = Duration::from_millis(50);

    // Process events
    loop {
        // Check for stop signal (non-blocking)
        if stop_rx.try_recv().is_ok() {
            log::info!("Received stop signal, stopping watcher for {:?}", tiki_path);
            break;
        }

        // Use recv_timeout to allow periodic stop signal checks
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if let Some(file_event) = process_event(&event) {
                    if should_emit(&mut last_emissions, &file_event, DEBOUNCE) {
                        log::info!("Tiki file changed: {:?}", file_event);
                        if let Err(e) = app_handle.emit("tiki-file-changed", file_event) {
                            log::error!("Failed to emit event: {}", e);
                        }
                    } else {
                        log::debug!("Debounced duplicate event: {:?}", file_event);
                    }
                }
            }
            Ok(Err(e)) => {
                log::error!("Watch error: {:?}", e);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Normal timeout, continue loop
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::error!("Watcher channel disconnected");
                break;
            }
        }
    }

    Ok(())
}

/// Stable debounce key per logical event target. Different targets debounce
/// independently so a fast plan write right after a state write isn't dropped.
fn debounce_key(file_event: &TikiFileEvent) -> String {
    match file_event {
        TikiFileEvent::StateChanged => "state".to_string(),
        TikiFileEvent::PlanChanged { issue_number } => format!("plan-{}", issue_number),
        TikiFileEvent::ReleaseChanged { version } => format!("release-{}", version),
    }
}

/// Leading-edge debounce check. Returns true if this event should be emitted
/// (and records the emission); false if it falls within the debounce window
/// of a prior emission for the same key.
fn should_emit(
    last_emissions: &mut HashMap<String, Instant>,
    file_event: &TikiFileEvent,
    debounce: Duration,
) -> bool {
    let key = debounce_key(file_event);
    let now = Instant::now();
    match last_emissions.get(&key) {
        Some(t) if now.duration_since(*t) < debounce => false,
        _ => {
            last_emissions.insert(key, now);
            true
        }
    }
}

/// Process a file system event and determine what Tiki event to emit
fn process_event(event: &Event) -> Option<TikiFileEvent> {
    // Only care about modify/create/remove events
    if !matches!(
        event.kind,
        notify::EventKind::Modify(_) | notify::EventKind::Create(_) | notify::EventKind::Remove(_)
    ) {
        return None;
    }

    for path in &event.paths {
        if let Some(file_name) = path.file_name() {
            let name = file_name.to_string_lossy();

            // Ignore temp files from atomic writes
            if name.ends_with(".tmp") {
                continue;
            }

            // Ignore backup directory events
            if is_in_backups_dir(path) {
                continue;
            }

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

/// Check if a path is inside the backups directory
fn is_in_backups_dir(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "backups")
}
