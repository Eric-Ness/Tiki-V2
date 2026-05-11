use serde::de::DeserializeOwned;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Read and JSON-parse a file with retry tolerance for atomic-write races.
///
/// Returns `Ok(None)` immediately if the path doesn't exist (the legitimate
/// missing-file case — fresh project, plan not yet written, etc.).
///
/// If the path exists at entry, attempts up to 3 reads with 25ms backoff. The
/// retry covers transient failures during atomic writes:
/// - File momentarily missing between Windows MoveFileEx steps
/// - ERROR_SHARING_VIOLATION while a writer holds the file
/// - Partial JSON observable in unusual filesystem states
///
/// Worst-case added latency is ~50ms in the racy path; zero in the common
/// success path.
pub fn read_json_resilient<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }

    const MAX_ATTEMPTS: u32 = 3;
    const RETRY_DELAY: Duration = Duration::from_millis(25);

    let mut last_err: Option<String> = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<T>(&content) {
                Ok(parsed) => return Ok(Some(parsed)),
                Err(e) => {
                    log::warn!(
                        "read_json_resilient parse error on {:?} attempt {}: {}",
                        path,
                        attempt,
                        e
                    );
                    last_err = Some(format!("parse error (attempt {}): {}", attempt, e));
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                log::warn!(
                    "read_json_resilient: {:?} disappeared mid-read on attempt {}",
                    path,
                    attempt
                );
                last_err = Some(format!("file disappeared mid-read (attempt {})", attempt));
            }
            Err(e) => {
                log::warn!(
                    "read_json_resilient read error on {:?} attempt {}: {}",
                    path,
                    attempt,
                    e
                );
                last_err = Some(format!("read error (attempt {}): {}", attempt, e));
            }
        }
        if attempt < MAX_ATTEMPTS {
            std::thread::sleep(RETRY_DELAY);
        }
    }
    Err(last_err.unwrap_or_else(|| "unknown error".to_string()))
}

/// Atomically write content to a file by writing to a `.tmp` sibling first,
/// then renaming. This prevents readers from seeing partial/corrupt JSON.
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");

    // Write to temp file
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp file {:?}: {}", tmp_path, e))?;

    // Atomic rename (overwrites target on Windows via MoveFileEx internally)
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to rename {:?} -> {:?}: {}", tmp_path, path, e))?;

    Ok(())
}

const DEFAULT_BACKUP_RETENTION: usize = 10;

/// Back up state.json to `.tiki/backups/state.{timestamp}.json`.
/// Creates the backups directory if needed. Returns the backup file path.
pub fn backup_state(tiki_path: &Path) -> Result<PathBuf, String> {
    let state_file = tiki_path.join("state.json");
    if !state_file.exists() {
        return Err("state.json does not exist, nothing to back up".to_string());
    }

    let backups_dir = tiki_path.join("backups");
    if !backups_dir.exists() {
        std::fs::create_dir_all(&backups_dir)
            .map_err(|e| format!("Failed to create backups directory: {}", e))?;
    }

    // Timestamp with colons replaced by hyphens for filesystem safety
    let now = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let backup_name = format!("state.{}.json", now);
    let backup_path = backups_dir.join(&backup_name);

    std::fs::copy(&state_file, &backup_path)
        .map_err(|e| format!("Failed to copy state to backup: {}", e))?;

    log::info!("Backed up state.json to {:?}", backup_path);

    // Enforce retention limit
    let retention = read_backup_retention(tiki_path);
    cleanup_old_backups(&backups_dir, retention);

    Ok(backup_path)
}

/// Read backup retention count from `.tiki/config.json`, defaulting to 10.
fn read_backup_retention(tiki_path: &Path) -> usize {
    let config_path = tiki_path.join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(n) = val.get("backupRetention").and_then(|v| v.as_u64()) {
                return n as usize;
            }
        }
    }
    DEFAULT_BACKUP_RETENTION
}

/// Remove old backups beyond the retention limit. Keeps the newest N files.
///
/// Only prunes timestamped numbered backups (`state.YYYY-MM-DDTHH-MM-SS.json`).
/// `.broken.json` safety copies created by `restore_from_backup_safe` are
/// deliberately excluded so the user can inspect them after corruption.
fn cleanup_old_backups(backups_dir: &Path, retention: usize) {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(backups_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if is_numbered_backup(&name) {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Sort by filename descending (newest first, since timestamps sort lexicographically)
    backups.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    // Remove everything beyond the retention limit
    for old in backups.iter().skip(retention) {
        log::info!("Pruning old backup: {:?}", old);
        let _ = std::fs::remove_file(old);
    }
}

/// Returns true for filenames matching `state.<timestamp>.json` (the rotation
/// pool), where `<timestamp>` is the chrono `%Y-%m-%dT%H-%M-%S` format used by
/// `backup_state`. Excludes `state.<timestamp>.broken.json`, `state.broken.json`,
/// and any other suffixed variant. Used by `cleanup_old_backups` so safety
/// copies survive retention.
fn is_numbered_backup(name: &str) -> bool {
    if !name.starts_with("state.") || !name.ends_with(".json") {
        return false;
    }
    let middle = match name
        .strip_prefix("state.")
        .and_then(|s| s.strip_suffix(".json"))
    {
        Some(m) => m,
        None => return false,
    };
    // Middle must look like a timestamp: contain a 'T' separator and no dots
    // (a dot would indicate a sub-suffix like `.broken`).
    !middle.contains('.') && middle.contains('T') && middle.contains('-')
}

/// List available backup files, newest first.
pub fn list_backup_files(tiki_path: &Path) -> Result<Vec<BackupInfo>, String> {
    let backups_dir = tiki_path.join("backups");
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<BackupInfo> = std::fs::read_dir(&backups_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if name.starts_with("state.") && name.ends_with(".json") {
                let size = std::fs::metadata(&path).ok()?.len();
                // Extract timestamp from "state.YYYY-MM-DDTHH-MM-SS.json"
                let timestamp = name
                    .strip_prefix("state.")?
                    .strip_suffix(".json")?
                    .to_string();
                Some(BackupInfo {
                    filename: name,
                    timestamp,
                    size_bytes: size,
                })
            } else {
                None
            }
        })
        .collect();

    // Newest first
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(backups)
}

/// Restore state.json from a backup file. Creates a safety backup of current
/// state first, then atomically writes the backup content as the new state.
pub fn restore_from_backup(tiki_path: &Path, backup_filename: &str) -> Result<(), String> {
    let backup_path = tiki_path.join("backups").join(backup_filename);
    if !backup_path.exists() {
        return Err(format!("Backup file not found: {}", backup_filename));
    }

    // Safety: back up current state before overwriting
    let _ = backup_state(tiki_path);

    let content = std::fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup: {}", e))?;

    // Validate it's parseable JSON before overwriting
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Backup contains invalid JSON: {}", e))?;

    let state_path = tiki_path.join("state.json");
    atomic_write(&state_path, &content)?;

    log::info!("Restored state.json from backup: {}", backup_filename);
    Ok(())
}

/// Copy the current `state.json` to `backups/state.{ts}.broken.json` so the
/// user can inspect or recover the corrupt state later. The `.broken` suffix
/// excludes this file from `cleanup_old_backups` retention. Returns the
/// created path, or Ok(None) if state.json doesn't exist.
pub fn snapshot_broken_state(tiki_path: &Path) -> Result<Option<PathBuf>, String> {
    let state_file = tiki_path.join("state.json");
    if !state_file.exists() {
        return Ok(None);
    }

    let backups_dir = tiki_path.join("backups");
    if !backups_dir.exists() {
        std::fs::create_dir_all(&backups_dir)
            .map_err(|e| format!("Failed to create backups directory: {}", e))?;
    }

    let now = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let broken_name = format!("state.{}.broken.json", now);
    let broken_path = backups_dir.join(&broken_name);

    std::fs::copy(&state_file, &broken_path)
        .map_err(|e| format!("Failed to copy state to .broken backup: {}", e))?;

    log::info!("Snapshotted broken state to {:?}", broken_path);
    Ok(Some(broken_path))
}

/// Restore state.json from a backup, with a pre-flight safety copy that
/// names the current file `state.{ts}.broken.json` when it is unparseable.
/// If the current state IS parseable, falls back to a normal numbered backup
/// (matching the behavior of `restore_from_backup`). The `.broken.json`
/// safety copy is preserved across retention pruning.
pub fn restore_from_backup_safe(tiki_path: &Path, backup_filename: &str) -> Result<(), String> {
    let backup_path = tiki_path.join("backups").join(backup_filename);
    if !backup_path.exists() {
        return Err(format!("Backup file not found: {}", backup_filename));
    }

    // Pre-flight: snapshot the current state. If it's unparseable, name the
    // copy `.broken.json` so it's never pruned. If it IS parseable, take a
    // normal numbered backup instead.
    let state_file = tiki_path.join("state.json");
    if state_file.exists() {
        let current_content = std::fs::read_to_string(&state_file).unwrap_or_default();
        let is_parseable = serde_json::from_str::<serde_json::Value>(&current_content).is_ok();
        if !is_parseable {
            let _ = snapshot_broken_state(tiki_path);
        } else {
            let _ = backup_state(tiki_path);
        }
    }

    let content = std::fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup: {}", e))?;

    // Validate it's parseable JSON before overwriting
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Backup contains invalid JSON: {}", e))?;

    atomic_write(&state_file, &content)?;

    log::info!(
        "Safely restored state.json from backup: {} (with .broken.json snapshot if needed)",
        backup_filename
    );
    Ok(())
}

/// Write a fresh, empty canonical state.json (`{"schemaVersion": 1,
/// "activeWork": {}}`). If the current file exists, snapshot it as
/// `.broken.json` first when unparseable, or as a normal numbered backup
/// otherwise. Always atomic-writes the new content.
pub fn write_fresh_state(tiki_path: &Path) -> Result<(), String> {
    let state_file = tiki_path.join("state.json");
    if state_file.exists() {
        let current_content = std::fs::read_to_string(&state_file).unwrap_or_default();
        let is_parseable = serde_json::from_str::<serde_json::Value>(&current_content).is_ok();
        if !is_parseable {
            let _ = snapshot_broken_state(tiki_path);
        } else {
            let _ = backup_state(tiki_path);
        }
    } else if !tiki_path.exists() {
        std::fs::create_dir_all(tiki_path)
            .map_err(|e| format!("Failed to create tiki directory: {}", e))?;
    }

    let fresh = "{\n  \"schemaVersion\": 1,\n  \"activeWork\": {}\n}\n";
    atomic_write(&state_file, fresh)?;

    log::info!("Wrote fresh state.json at {:?}", state_file);
    Ok(())
}

/// Read raw text content of a backup file. Used by the frontend recovery
/// dialog to (a) preview content and (b) validate parseability before
/// offering Restore.
pub fn read_backup_content(tiki_path: &Path, backup_filename: &str) -> Result<String, String> {
    // Basic guard: disallow path traversal — only accept simple filenames.
    if backup_filename.contains('/') || backup_filename.contains('\\') {
        return Err("Invalid backup filename".to_string());
    }
    let backup_path = tiki_path.join("backups").join(backup_filename);
    if !backup_path.exists() {
        return Err(format!("Backup file not found: {}", backup_filename));
    }
    std::fs::read_to_string(&backup_path).map_err(|e| format!("Failed to read backup: {}", e))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
}

/// Remove any stale `.tmp` files in the `.tiki/` directory tree.
/// These can be left behind if the app crashes mid-write.
pub fn cleanup_stale_tmp_files(tiki_path: &Path) {
    if !tiki_path.exists() {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(tiki_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories (plans/, releases/, backups/)
                cleanup_stale_tmp_files(&path);
            } else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".tmp")) {
                log::info!("Removing stale temp file: {:?}", path);
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Build a fresh, unique temp `.tiki/` directory per test. Uses the OS
    /// temp dir + nanosecond suffix to avoid collisions across parallel
    /// test runs. Caller is responsible for cleanup (we leave the dir; the
    /// OS will recycle temp space). Returns the tiki_path.
    fn make_tiki_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tiki-recov-{}-{}", label, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_state(tiki: &Path, content: &str) {
        std::fs::write(tiki.join("state.json"), content).unwrap();
    }

    fn write_backup(tiki: &Path, filename: &str, content: &str) {
        let backups_dir = tiki.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();
        std::fs::write(backups_dir.join(filename), content).unwrap();
    }

    #[test]
    fn is_numbered_backup_accepts_timestamped_names() {
        assert!(is_numbered_backup("state.2026-05-11T16-30-00.json"));
        assert!(is_numbered_backup("state.2026-01-01T00-00-00.json"));
    }

    #[test]
    fn is_numbered_backup_rejects_broken_variants_and_others() {
        assert!(!is_numbered_backup("state.2026-05-11T16-30-00.broken.json"));
        assert!(!is_numbered_backup("state.broken.json"));
        assert!(!is_numbered_backup("other.json"));
        assert!(!is_numbered_backup("state.2026-05-11T16-30-00.txt"));
    }

    #[test]
    fn restore_from_backup_safe_succeeds_with_parseable_state() {
        let tiki = make_tiki_dir("safe-ok");
        let valid_old = r#"{"schemaVersion":1,"activeWork":{}}"#;
        let valid_new = r#"{"schemaVersion":1,"activeWork":{"issue:1":{"type":"issue","issue":{"number":1,"title":"x"},"status":"completed","createdAt":"2026-01-01T00:00:00.000Z","lastActivity":"2026-01-01T00:00:00.000Z"}}}"#;
        write_state(&tiki, valid_old);
        write_backup(&tiki, "state.2026-05-11T16-30-00.json", valid_new);

        let result = restore_from_backup_safe(&tiki, "state.2026-05-11T16-30-00.json");
        assert!(result.is_ok(), "restore failed: {:?}", result);

        let after = std::fs::read_to_string(tiki.join("state.json")).unwrap();
        assert!(
            after.contains("\"issue:1\""),
            "state.json should contain restored content; got: {}",
            after
        );
    }

    #[test]
    fn restore_from_backup_safe_leaves_broken_snapshot_for_unparseable_state() {
        let tiki = make_tiki_dir("safe-broken");
        let broken_content = "{ this is { not valid json";
        let valid_new = r#"{"schemaVersion":1,"activeWork":{}}"#;
        write_state(&tiki, broken_content);
        write_backup(&tiki, "state.2026-05-11T16-30-00.json", valid_new);

        let result = restore_from_backup_safe(&tiki, "state.2026-05-11T16-30-00.json");
        assert!(result.is_ok(), "restore failed: {:?}", result);

        // Verify a .broken.json snapshot exists in backups/
        let backups_dir = tiki.join("backups");
        let mut found_broken = false;
        for entry in std::fs::read_dir(&backups_dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".broken.json") {
                let snapshot = std::fs::read_to_string(entry.path()).unwrap();
                assert_eq!(
                    snapshot, broken_content,
                    ".broken.json snapshot should preserve original corrupt content"
                );
                found_broken = true;
            }
        }
        assert!(found_broken, ".broken.json safety copy was not created");

        // Verify state.json now holds the new content
        let after = std::fs::read_to_string(tiki.join("state.json")).unwrap();
        assert_eq!(after, valid_new);
    }

    #[test]
    fn restore_from_backup_safe_leaves_no_tmp_file_after_success() {
        // Atomic write check: state.json.tmp must NOT exist after a clean
        // restore — atomic_write renames it onto state.json.
        let tiki = make_tiki_dir("safe-atomic");
        let valid_old = r#"{"schemaVersion":1,"activeWork":{}}"#;
        let valid_new = r#"{"schemaVersion":1,"activeWork":{"a":{"type":"issue","issue":{"number":2,"title":"y"},"status":"completed","createdAt":"2026-01-01T00:00:00.000Z","lastActivity":"2026-01-01T00:00:00.000Z"}}}"#;
        write_state(&tiki, valid_old);
        write_backup(&tiki, "state.2026-05-11T16-30-00.json", valid_new);

        restore_from_backup_safe(&tiki, "state.2026-05-11T16-30-00.json").unwrap();

        let tmp_path = tiki.join("state.json.tmp");
        assert!(
            !tmp_path.exists(),
            "state.json.tmp must not exist after successful atomic write"
        );
    }

    #[test]
    fn cleanup_old_backups_preserves_broken_snapshots() {
        let tiki = make_tiki_dir("cleanup-broken");
        let backups_dir = tiki.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();

        // Create 12 timestamped backups (well over the default retention of 10)
        for i in 0..12 {
            let ts = format!("2026-05-11T16-{:02}-00", i);
            std::fs::write(
                backups_dir.join(format!("state.{}.json", ts)),
                r#"{"schemaVersion":1,"activeWork":{}}"#,
            )
            .unwrap();
        }
        // Plus a single .broken.json snapshot
        std::fs::write(
            backups_dir.join("state.2026-05-11T16-00-00.broken.json"),
            "garbage",
        )
        .unwrap();

        cleanup_old_backups(&backups_dir, 10);

        // The .broken.json file must still exist
        assert!(
            backups_dir
                .join("state.2026-05-11T16-00-00.broken.json")
                .exists(),
            ".broken.json snapshots should NOT be pruned by cleanup_old_backups"
        );

        // And we should be down to 10 timestamped backups
        let remaining_numbered: Vec<_> = std::fs::read_dir(&backups_dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                is_numbered_backup(&n)
            })
            .collect();
        assert_eq!(
            remaining_numbered.len(),
            10,
            "Expected 10 numbered backups remaining after retention prune"
        );
    }

    #[test]
    fn write_fresh_state_creates_canonical_empty_state() {
        let tiki = make_tiki_dir("fresh");
        let valid_old = r#"{"schemaVersion":1,"activeWork":{"x":{"type":"issue","issue":{"number":3,"title":"z"},"status":"executing","createdAt":"2026-01-01T00:00:00.000Z","lastActivity":"2026-01-01T00:00:00.000Z"}}}"#;
        write_state(&tiki, valid_old);

        write_fresh_state(&tiki).unwrap();

        let after = std::fs::read_to_string(tiki.join("state.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&after).unwrap();
        assert_eq!(parsed["schemaVersion"], 1);
        assert!(parsed["activeWork"].is_object());
        assert_eq!(parsed["activeWork"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn write_fresh_state_snapshots_broken_state_first() {
        let tiki = make_tiki_dir("fresh-broken");
        let broken = "not valid json {{{";
        write_state(&tiki, broken);

        write_fresh_state(&tiki).unwrap();

        let backups_dir = tiki.join("backups");
        let mut found_broken = false;
        for entry in std::fs::read_dir(&backups_dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".broken.json") {
                let snap = std::fs::read_to_string(entry.path()).unwrap();
                assert_eq!(snap, broken);
                found_broken = true;
            }
        }
        assert!(
            found_broken,
            "write_fresh_state should snapshot broken state to .broken.json first"
        );
    }

    #[test]
    fn read_backup_content_rejects_path_traversal() {
        let tiki = make_tiki_dir("traversal");
        assert!(read_backup_content(&tiki, "../../../etc/passwd").is_err());
        assert!(read_backup_content(&tiki, "subdir/file.json").is_err());
        assert!(read_backup_content(&tiki, "subdir\\file.json").is_err());
    }

    #[test]
    fn read_backup_content_returns_text() {
        let tiki = make_tiki_dir("read");
        write_backup(&tiki, "state.2026-05-11T16-30-00.json", "hello world");
        let got = read_backup_content(&tiki, "state.2026-05-11T16-30-00.json").unwrap();
        assert_eq!(got, "hello world");
    }
}
