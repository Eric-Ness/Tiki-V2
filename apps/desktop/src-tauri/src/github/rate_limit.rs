use serde::{Deserialize, Serialize};

use super::{gh_error_message, hidden_command};

// ─── Rate Limit Types ─────────────────────────────────────────────────────────

/// One bucket from `gh api rate_limit` (core, search, graphql, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitBucket {
    pub limit: u32,
    pub used: u32,
    pub remaining: u32,
    /// Unix epoch seconds (UTC) when this bucket resets.
    pub reset: u64,
}

/// Subset of `gh api rate_limit` exposed to the UI. The full GitHub response
/// includes ~14 buckets; only the three the desktop actually exercises are
/// surfaced (core for issue/PR/label/release fetches, search/graphql reserved
/// for future use).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitStatus {
    pub core: RateLimitBucket,
    pub search: RateLimitBucket,
    pub graphql: RateLimitBucket,
    /// Unix epoch seconds when the desktop captured this snapshot. Frontend
    /// formats to ISO via `new Date(epoch * 1000)` to avoid a Rust chrono dep.
    pub fetched_at_epoch: u64,
}

#[derive(Debug, Deserialize)]
struct GhRateLimitResponse {
    resources: GhRateLimitResources,
}

#[derive(Debug, Deserialize)]
struct GhRateLimitResources {
    core: RateLimitBucket,
    search: RateLimitBucket,
    graphql: RateLimitBucket,
}

/// Query GitHub's REST `/rate_limit` endpoint via `gh api`. Returns the three
/// buckets the desktop actually uses plus a capture timestamp.
///
/// This call itself does NOT count against the rate limit (per GitHub docs),
/// so polling it from the frontend is safe.
#[tauri::command]
pub fn fetch_rate_limit_status(project_path: Option<String>) -> Result<RateLimitStatus, String> {
    let mut cmd = hidden_command("gh");
    cmd.args(["api", "rate_limit"]);
    if let Some(path) = project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/"
                .to_string()
        } else {
            format!("Failed to run gh CLI: {}", e)
        }
    })?;

    if !output.status.success() {
        return Err(gh_error_message(&String::from_utf8_lossy(&output.stderr)));
    }

    let parsed: GhRateLimitResponse = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse rate_limit response: {}", e))?;

    Ok(RateLimitStatus {
        core: parsed.resources.core,
        search: parsed.resources.search,
        graphql: parsed.resources.graphql,
        fetched_at_epoch: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_rate_limit_response_with_buckets() {
        let payload = serde_json::json!({
            "resources": {
                "core": { "limit": 5000, "used": 12, "remaining": 4988, "reset": 1700000000u64 },
                "search": { "limit": 30, "used": 1, "remaining": 29, "reset": 1700000060u64 },
                "graphql": { "limit": 5000, "used": 0, "remaining": 5000, "reset": 1700000120u64 }
            }
        });

        let parsed: GhRateLimitResponse = serde_json::from_value(payload).unwrap();
        assert_eq!(parsed.resources.core.limit, 5000);
        assert_eq!(parsed.resources.core.used, 12);
        assert_eq!(parsed.resources.core.remaining, 4988);
        assert_eq!(parsed.resources.core.reset, 1700000000);
        assert_eq!(parsed.resources.search.remaining, 29);
        assert_eq!(parsed.resources.graphql.limit, 5000);
    }

    #[test]
    fn rate_limit_status_round_trips_camel_case() {
        let bucket = RateLimitBucket {
            limit: 5000,
            used: 100,
            remaining: 4900,
            reset: 1700000000,
        };
        let status = RateLimitStatus {
            core: bucket.clone(),
            search: bucket.clone(),
            graphql: bucket,
            fetched_at_epoch: 1700000500,
        };

        let value = serde_json::to_value(&status).unwrap();
        // camelCase rename: `fetched_at_epoch` -> `fetchedAtEpoch`.
        assert_eq!(value["fetchedAtEpoch"], 1700000500u64);
        assert_eq!(value["core"]["remaining"], 4900);

        let back: RateLimitStatus = serde_json::from_value(value).unwrap();
        assert_eq!(back.fetched_at_epoch, 1700000500);
        assert_eq!(back.core.remaining, 4900);
    }
}
