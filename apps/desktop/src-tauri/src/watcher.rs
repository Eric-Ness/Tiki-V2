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
    ResearchChanged { filename: String },
}

/// Start watching the .tiki directory for changes (initial startup)
pub fn start_watcher(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::current_dir()?;

    // current_path holds the project ROOT (start_watcher_internal appends
    // `.tiki` itself). switch_watch_path stores the project root too, so the
    // supersede check can compare like-for-like — previously start_watcher
    // stored `cwd/.tiki`, which then became `cwd/.tiki/.tiki` and never matched
    // a real directory (#224).
    {
        let state = get_watcher_state();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.current_path = Some(cwd.clone());
    }

    start_watcher_internal(app_handle, cwd)
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

    // Trailing-edge debounce: a single atomic write produces 3-5 raw notify
    // events, and a burst of rapid state.mjs writes (e.g. a release teardown
    // doing remove + append-history back-to-back) produces several writes in
    // quick succession. We coalesce per logical target and emit only AFTER
    // writes for that target go quiet for `DEBOUNCE`, so the frontend always
    // receives the FINAL state of a burst instead of freezing on an
    // intermediate write (issue #220). Bounded by issue/release cardinality.
    let mut pending: HashMap<String, (TikiFileEvent, Instant)> = HashMap::new();
    const DEBOUNCE: Duration = Duration::from_millis(100);
    // Poll often enough to flush quiet targets promptly while still checking
    // the stop signal regularly.
    const POLL: Duration = Duration::from_millis(50);

    // Process events
    loop {
        // Check for stop signal (non-blocking)
        if stop_rx.try_recv().is_ok() {
            log::info!("Received stop signal, stopping watcher for {:?}", tiki_path);
            break;
        }

        // Self-terminate if a newer switch_watch_path has superseded us. The
        // stop_signal hand-off races with thread startup (a switch fired right
        // after launch can run before this thread stored its stop_signal), so
        // we ALSO consult the authoritative current_path here. This guarantees
        // only the active project's watcher survives — fixing the
        // startup-restore "wrong .tiki" race (#224).
        {
            let state = get_watcher_state();
            let superseded = state
                .lock()
                .map(|guard| is_superseded(guard.current_path.as_ref(), &project_path))
                .unwrap_or(false);
            drop(state);
            if superseded {
                log::info!("Watcher for {:?} superseded by a project switch; stopping", project_path);
                break;
            }
        }

        // Use recv_timeout to allow periodic stop-signal checks and to wake the
        // loop so pending events can be flushed even when no new event arrives.
        match rx.recv_timeout(POLL) {
            Ok(Ok(event)) => {
                if let Some(file_event) = process_event(&event) {
                    // Record/refresh this target's pending event; emission is
                    // deferred until the target goes quiet (trailing edge).
                    let key = debounce_key(&file_event);
                    pending.insert(key, (file_event, Instant::now()));
                }
            }
            Ok(Err(e)) => {
                log::error!("Watch error: {:?}", e);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Normal timeout, fall through to the flush below.
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::error!("Watcher channel disconnected");
                break;
            }
        }

        // Emit any target that has been quiet for at least DEBOUNCE.
        flush_quiet_events(&mut pending, DEBOUNCE, &app_handle);
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
        TikiFileEvent::ResearchChanged { filename } => format!("research-{}", filename),
    }
}

/// Trailing-edge readiness check (pure, testable). Returns the keys whose last
/// raw notify activity is at least `debounce` before `now` — these targets have
/// gone quiet, so their final coalesced state is ready to emit.
fn quiet_keys(
    pending: &HashMap<String, (TikiFileEvent, Instant)>,
    now: Instant,
    debounce: Duration,
) -> Vec<String> {
    let mut keys = Vec::new();
    for (key, (_event, last)) in pending.iter() {
        if now.duration_since(*last) >= debounce {
            keys.push(key.clone());
        }
    }
    keys
}

/// Emit (and remove) every pending event that has gone quiet for `debounce`, so
/// the frontend receives one event reflecting the FINAL state of a write burst.
fn flush_quiet_events(
    pending: &mut HashMap<String, (TikiFileEvent, Instant)>,
    debounce: Duration,
    app_handle: &AppHandle,
) {
    if pending.is_empty() {
        return;
    }
    for key in quiet_keys(pending, Instant::now(), debounce) {
        if let Some((file_event, _)) = pending.remove(&key) {
            log::info!("Tiki file changed: {:?}", file_event);
            if let Err(e) = app_handle.emit("tiki-file-changed", file_event) {
                log::error!("Failed to emit event: {}", e);
            }
        }
    }
}

/// A watcher is superseded when the authoritative `current_path` no longer
/// points at the project this watcher was started for (a newer
/// `switch_watch_path` won). `None` means no active path is recorded yet — don't
/// self-terminate. Pure and unit-testable (the threaded race-fix for #224).
fn is_superseded(current: Option<&PathBuf>, mine: &PathBuf) -> bool {
    match current {
        Some(p) => p != mine,
        None => false,
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

            // Ignore temp files from atomic writes and the state.json.lock
            // file used by the state.mjs write lock (#224).
            if name.ends_with(".tmp") || name.ends_with(".lock") {
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

            // Check for research docs (.tiki/research/*.md)
            if let Some(research_filename) = is_in_research_dir(path) {
                return Some(TikiFileEvent::ResearchChanged {
                    filename: research_filename.to_string(),
                });
            }
        }
    }

    None
}

/// Check if a path is inside the releases directory
fn is_in_releases_dir(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "releases")
}

/// Check if a path is inside the research directory and is a markdown file.
/// Returns the filename (e.g. "auth-flow.md") if so, otherwise None.
fn is_in_research_dir(path: &Path) -> Option<&str> {
    let in_research = path.components().any(|c| c.as_os_str() == "research");
    if !in_research {
        return None;
    }
    let name = path.file_name()?.to_str()?;
    if name.ends_with(".md") {
        Some(name)
    } else {
        None
    }
}

/// Check if a path is inside the backups directory
fn is_in_backups_dir(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "backups")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_keys_excludes_active_and_includes_aged() {
        let now = Instant::now();
        let debounce = Duration::from_millis(100);
        let mut pending: HashMap<String, (TikiFileEvent, Instant)> = HashMap::new();
        // Last touched 200ms ago → quiet → ready to emit.
        pending.insert(
            "state".to_string(),
            (TikiFileEvent::StateChanged, now - Duration::from_millis(200)),
        );
        // Last touched 10ms ago → burst still in flight → NOT ready.
        pending.insert(
            "plan-1".to_string(),
            (
                TikiFileEvent::PlanChanged { issue_number: 1 },
                now - Duration::from_millis(10),
            ),
        );
        let ready = quiet_keys(&pending, now, debounce);
        assert_eq!(ready, vec!["state".to_string()]);
    }

    #[test]
    fn is_superseded_detects_project_switch() {
        let a = PathBuf::from("/proj/a");
        let b = PathBuf::from("/proj/b");
        // Same path → still the active watcher, keep running.
        assert!(!is_superseded(Some(&a), &a));
        // A newer switch pointed current_path elsewhere → self-terminate.
        assert!(is_superseded(Some(&b), &a));
        // No active path recorded yet → don't self-terminate.
        assert!(!is_superseded(None, &a));
    }

    #[test]
    fn trailing_edge_emits_only_after_burst_goes_quiet() {
        // A burst overwrites the same key repeatedly; insert() keeps only the
        // LAST event + timestamp, so a single coalesced event survives — and it
        // is withheld until the target stops changing for the debounce window.
        let now = Instant::now();
        let debounce = Duration::from_millis(100);
        let mut pending: HashMap<String, (TikiFileEvent, Instant)> = HashMap::new();
        pending.insert(
            "state".to_string(),
            (TikiFileEvent::StateChanged, now - Duration::from_millis(5)),
        );
        // Still within the burst → nothing emitted yet.
        assert!(quiet_keys(&pending, now, debounce).is_empty());
        // After the target goes quiet → the final state is emitted exactly once.
        let later = now + Duration::from_millis(150);
        assert_eq!(quiet_keys(&pending, later, debounce), vec!["state".to_string()]);
    }
}
