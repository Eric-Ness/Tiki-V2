use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageStats {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub last_computed_date: String,
    #[serde(default)]
    pub daily_activity: Vec<DailyActivity>,
    #[serde(default)]
    pub daily_model_tokens: Vec<DailyModelTokens>,
    #[serde(default)]
    pub model_usage: HashMap<String, ModelUsage>,
    #[serde(default)]
    pub total_sessions: u64,
    #[serde(default)]
    pub total_messages: u64,
    #[serde(default)]
    pub first_session_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    #[serde(default)]
    pub message_count: u64,
    #[serde(default)]
    pub session_count: u64,
    #[serde(default)]
    pub tool_call_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyModelTokens {
    pub date: String,
    #[serde(default)]
    pub tokens_by_model: HashMap<String, u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub web_search_requests: u64,
    #[serde(default)]
    pub cost_usd: f64,
}

fn get_stats_cache_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("stats-cache.json"))
}

#[tauri::command]
pub fn get_claude_usage() -> Result<Option<ClaudeUsageStats>, String> {
    let path = match get_stats_cache_path() {
        Some(p) => p,
        None => return Ok(None),
    };

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stats: ClaudeUsageStats = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(stats))
}
