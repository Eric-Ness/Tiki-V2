use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// --- Config (stored in config_dir/tiki-desktop/claude-api.json) ---

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    #[serde(default)]
    session_key: Option<String>,
    #[serde(default)]
    org_id: Option<String>,
}

fn config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("tiki-desktop").join("claude-api.json"))
}

fn load_config() -> ApiConfig {
    config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_config(config: &ApiConfig) -> Result<(), String> {
    let path = config_path().ok_or("No config directory")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

// --- API response types (serialized as camelCase to frontend) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeApiUsage {
    five_hour: Option<UsageLimit>,
    seven_day: Option<UsageLimit>,
    seven_day_opus: Option<UsageLimit>,
    seven_day_sonnet: Option<UsageLimit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimit {
    utilization: f64,
    resets_at: Option<String>,
}

// --- HTTP helpers ---

fn api_headers(session_key: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "*/*".parse().unwrap());
    h.insert("accept-language", "en-US,en;q=0.9".parse().unwrap());
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert(
        "anthropic-client-platform",
        "web_claude_ai".parse().unwrap(),
    );
    h.insert("anthropic-client-version", "1.0.0".parse().unwrap());
    h.insert("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".parse().unwrap());
    h.insert("origin", "https://claude.ai".parse().unwrap());
    h.insert(
        "referer",
        "https://claude.ai/settings/usage".parse().unwrap(),
    );
    h.insert("sec-fetch-dest", "empty".parse().unwrap());
    h.insert("sec-fetch-mode", "cors".parse().unwrap());
    h.insert("sec-fetch-site", "same-origin".parse().unwrap());
    h.insert(
        "cookie",
        format!("sessionKey={}", session_key).parse().unwrap(),
    );
    h
}

async fn resolve_org_id(
    client: &reqwest::Client,
    session_key: &str,
) -> Result<String, String> {
    let resp = client
        .get("https://claude.ai/api/organizations")
        .headers(api_headers(session_key))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Organizations API returned {}", resp.status()));
    }

    let orgs: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    orgs.first()
        .and_then(|o| o["uuid"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No organizations found".to_string())
}

fn parse_limit(v: &serde_json::Value) -> Option<UsageLimit> {
    Some(UsageLimit {
        utilization: v.get("utilization")?.as_f64()?,
        resets_at: v
            .get("resets_at")
            .and_then(|r| r.as_str())
            .map(String::from),
    })
}

// --- Tauri commands ---

#[tauri::command]
pub async fn get_claude_usage() -> Result<Option<ClaudeApiUsage>, String> {
    let mut config = load_config();
    let session_key = match &config.session_key {
        Some(k) if !k.is_empty() => k.clone(),
        _ => return Ok(None),
    };

    let client = reqwest::Client::new();

    // Resolve org ID (fetch + cache if needed)
    let org_id = match &config.org_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => {
            let id = resolve_org_id(&client, &session_key).await?;
            config.org_id = Some(id.clone());
            let _ = save_config(&config);
            id
        }
    };

    // Fetch usage
    let resp = client
        .get(format!(
            "https://claude.ai/api/organizations/{}/usage",
            org_id
        ))
        .headers(api_headers(&session_key))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Usage API returned {}", resp.status()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    Ok(Some(ClaudeApiUsage {
        five_hour: data.get("five_hour").and_then(parse_limit),
        seven_day: data.get("seven_day").and_then(parse_limit),
        seven_day_opus: data.get("seven_day_opus").and_then(parse_limit),
        seven_day_sonnet: data.get("seven_day_sonnet").and_then(parse_limit),
    }))
}

#[tauri::command]
pub fn save_claude_session_key(key: String) -> Result<(), String> {
    let mut config = load_config();
    config.session_key = Some(key);
    config.org_id = None; // Clear cached org when key changes
    save_config(&config)
}

#[tauri::command]
pub fn has_claude_session_key() -> bool {
    load_config()
        .session_key
        .map_or(false, |k| !k.is_empty())
}

#[tauri::command]
pub fn clear_claude_session_key() -> Result<(), String> {
    let mut config = load_config();
    config.session_key = None;
    config.org_id = None;
    save_config(&config)
}
