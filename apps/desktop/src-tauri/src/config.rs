// ===========================================================================
// .tiki/config.json — read/save with validation + unknown-key warnings
// ===========================================================================
//
// Extracted from commands.rs (#235). Mirrors
// `packages/shared/schemas/config.schema.json` and
// `packages/shared/src/types/config.ts`. Optional fields use
// `#[serde(default)]`; each object level captures unrecognized keys via a
// `#[serde(flatten)] extra` map so we can report them as WARNINGS (not hard
// errors). A genuine type mismatch still fails deserialization → save rejects.

use crate::commands::resolve_tiki_path;
use crate::fs_utils;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Test-running behavior during EXECUTE and SHIP.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TestsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, rename = "runOnEachPhase", skip_serializing_if = "Option::is_none")]
    pub run_on_each_phase: Option<bool>,
    #[serde(default, rename = "runBeforeShip", skip_serializing_if = "Option::is_none")]
    pub run_before_ship: Option<bool>,
    #[serde(default, rename = "timeoutSeconds", skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Opt-in auto-heal loop for failed phase verification.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutoHealConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, rename = "maxAttempts", skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Parallel phase execution (EXECUTE).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParallelConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Workflow behavior for the GET -> SHIP pipeline.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tests: Option<TestsConfig>,
    #[serde(default, rename = "autoHeal", skip_serializing_if = "Option::is_none")]
    pub auto_heal: Option<AutoHealConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallel: Option<ParallelConfig>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Changelog generation customization (RELEASE).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChangelogConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<HashMap<String, String>>,
    #[serde(default, rename = "includeCommitHashes", skip_serializing_if = "Option::is_none")]
    pub include_commit_hashes: Option<bool>,
    #[serde(default, rename = "includeAuthors", skip_serializing_if = "Option::is_none")]
    pub include_authors: Option<bool>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Project-level Tiki configuration (`.tiki/config.json`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TikiConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<WorkflowConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<ChangelogConfig>,
    #[serde(default, rename = "backupRetention", skip_serializing_if = "Option::is_none")]
    pub backup_retention: Option<u64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Config plus the unknown-key warnings collected while parsing it.
#[derive(Debug, Clone, Serialize)]
pub struct ConfigReadResult {
    pub config: TikiConfig,
    pub warnings: Vec<String>,
}

/// Recursively collect dot-paths for every unrecognized key captured by a
/// `#[serde(flatten)] extra` map. These are reported as warnings, never errors.
fn collect_config_warnings(config: &TikiConfig) -> Vec<String> {
    let mut warnings = Vec::new();

    for k in config.extra.keys() {
        warnings.push(k.clone());
    }

    if let Some(wf) = &config.workflow {
        for k in wf.extra.keys() {
            warnings.push(format!("workflow.{}", k));
        }
        if let Some(t) = &wf.tests {
            for k in t.extra.keys() {
                warnings.push(format!("workflow.tests.{}", k));
            }
        }
        if let Some(h) = &wf.auto_heal {
            for k in h.extra.keys() {
                warnings.push(format!("workflow.autoHeal.{}", k));
            }
        }
        if let Some(p) = &wf.parallel {
            for k in p.extra.keys() {
                warnings.push(format!("workflow.parallel.{}", k));
            }
        }
    }

    if let Some(cl) = &config.changelog {
        for k in cl.extra.keys() {
            warnings.push(format!("changelog.{}", k));
        }
    }

    warnings.sort();
    warnings
}

/// Read `.tiki/config.json`. A missing file returns the default (empty) config
/// with no error. Returns the parsed config plus a list of unknown-key warning
/// dot-paths (e.g. `workflow.tests.typo`).
#[tauri::command]
pub fn read_tiki_config(tiki_path: Option<String>) -> Result<ConfigReadResult, String> {
    let path = resolve_tiki_path(tiki_path)?;
    let config_file = path.join("config.json");

    let config = fs_utils::read_json_resilient::<TikiConfig>(&config_file)?
        .unwrap_or_default();
    let warnings = collect_config_warnings(&config);

    Ok(ConfigReadResult { config, warnings })
}

/// Validate and save `.tiki/config.json` via atomic write.
///
/// The incoming JSON is round-tripped through the typed `TikiConfig` struct: a
/// genuine type mismatch (e.g. `enabled: "yes"`) fails deserialization and the
/// save is rejected. Unknown keys do NOT block the save — they are preserved
/// (via the `extra` flatten maps) and returned as warnings so a forward-compat
/// config still round-trips.
#[tauri::command]
pub fn save_tiki_config(
    config: serde_json::Value,
    tiki_path: Option<String>,
) -> Result<ConfigReadResult, String> {
    // Validate by deserializing into the typed struct; type errors reject here.
    let parsed: TikiConfig = serde_json::from_value(config)
        .map_err(|e| format!("Invalid config: {}", e))?;

    let warnings = collect_config_warnings(&parsed);

    let path = resolve_tiki_path(tiki_path)?;
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create .tiki directory: {}", e))?;
    let config_file = path.join("config.json");

    let content = serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs_utils::atomic_write(&config_file, &content)?;

    Ok(ConfigReadResult {
        config: parsed,
        warnings,
    })
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn parses_full_config() {
        let json = serde_json::json!({
            "workflow": {
                "tests": {
                    "enabled": true,
                    "command": null,
                    "runOnEachPhase": false,
                    "runBeforeShip": true,
                    "timeoutSeconds": 300
                },
                "autoHeal": {
                    "enabled": false,
                    "maxAttempts": 3,
                    "categories": ["build-error", "type-error", "test-failure", "lint-error"]
                },
                "parallel": { "enabled": true }
            },
            "changelog": {
                "template": ".tiki/changelog-template.md",
                "categories": { "feat": "New Features" },
                "includeCommitHashes": false,
                "includeAuthors": false
            },
            "backupRetention": 10
        });
        let cfg: TikiConfig = serde_json::from_value(json).expect("should parse");
        let wf = cfg.workflow.expect("workflow present");
        assert_eq!(wf.tests.unwrap().timeout_seconds, Some(300));
        assert_eq!(wf.auto_heal.unwrap().max_attempts, Some(3));
        assert_eq!(wf.parallel.unwrap().enabled, Some(true));
        assert_eq!(cfg.backup_retention, Some(10));
        assert!(collect_config_warnings(&serde_json::from_value::<TikiConfig>(
            serde_json::json!({"workflow":{"tests":{"enabled":true}}})
        ).unwrap()).is_empty());
    }

    #[test]
    fn parses_empty_config() {
        let cfg: TikiConfig = serde_json::from_value(serde_json::json!({})).expect("parse");
        assert!(cfg.workflow.is_none());
        assert!(collect_config_warnings(&cfg).is_empty());
    }

    #[test]
    fn parses_partial_config() {
        let cfg: TikiConfig =
            serde_json::from_value(serde_json::json!({"backupRetention": 5})).expect("parse");
        assert_eq!(cfg.backup_retention, Some(5));
        assert!(cfg.workflow.is_none());
    }

    #[test]
    fn collects_unknown_keys_as_warnings() {
        let json = serde_json::json!({
            "workflow": {
                "tests": { "enabled": true, "typoField": 1 },
                "bogusSection": {}
            },
            "topLevelUnknown": "x"
        });
        let cfg: TikiConfig = serde_json::from_value(json).expect("unknown keys do not fail parse");
        let warnings = collect_config_warnings(&cfg);
        assert!(warnings.contains(&"workflow.tests.typoField".to_string()));
        assert!(warnings.contains(&"workflow.bogusSection".to_string()));
        assert!(warnings.contains(&"topLevelUnknown".to_string()));
    }

    #[test]
    fn rejects_type_mismatch() {
        let json = serde_json::json!({
            "workflow": { "tests": { "enabled": "yes" } }
        });
        let result: Result<TikiConfig, _> = serde_json::from_value(json);
        assert!(result.is_err(), "string in a bool field must fail to parse");
    }

    #[test]
    fn unknown_keys_round_trip_through_serialization() {
        let json = serde_json::json!({
            "workflow": { "tests": { "enabled": true, "futureFlag": true } }
        });
        let cfg: TikiConfig = serde_json::from_value(json).expect("parse");
        let out = serde_json::to_value(&cfg).expect("serialize");
        // The unknown key is preserved (forward-compat), not silently dropped.
        assert_eq!(out["workflow"]["tests"]["futureFlag"], serde_json::json!(true));
    }
}
