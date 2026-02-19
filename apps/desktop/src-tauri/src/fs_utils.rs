use std::path::{Path, PathBuf};

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
fn cleanup_old_backups(backups_dir: &Path, retention: usize) {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(backups_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if name.starts_with("state.") && name.ends_with(".json") {
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
            } else if path.extension().map_or(false, |ext| ext == "tmp") {
                log::info!("Removing stale temp file: {:?}", path);
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}
