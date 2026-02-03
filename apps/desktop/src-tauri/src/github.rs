use serde::{Deserialize, Serialize};
use std::process::Command;

/// A GitHub label attached to an issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A GitHub issue fetched from gh CLI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: u32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Check if gh CLI is authenticated
/// Returns Ok(true) if authenticated, Ok(false) if not authenticated,
/// Err if gh CLI is not installed
#[tauri::command]
pub fn check_gh_auth() -> Result<bool, String> {
    let output = Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/".to_string()
            } else {
                format!("Failed to run gh CLI: {}", e)
            }
        })?;

    Ok(output.status.success())
}

/// Fetch GitHub issues from the current repository
/// - state: Filter by issue state ("open", "closed", "all"). Defaults to "open"
/// - limit: Maximum number of issues to fetch. Defaults to 30
#[tauri::command]
pub fn fetch_github_issues(
    state: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitHubIssue>, String> {
    let state_filter = state.unwrap_or_else(|| "open".to_string());
    let limit_val = limit.unwrap_or(30);

    let output = Command::new("gh")
        .args([
            "issue",
            "list",
            "--json",
            "number,title,body,state,labels,url,createdAt,updatedAt",
            "--state",
            &state_filter,
            "--limit",
            &limit_val.to_string(),
        ])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/".to_string()
            } else {
                format!("Failed to run gh CLI: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not logged in") || stderr.contains("authentication") {
            return Err("Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string());
        }
        if stderr.contains("not a git repository") || stderr.contains("no git remotes") {
            return Err("Not in a GitHub repository. Please open a project with a GitHub remote.".to_string());
        }
        return Err(format!("Failed to fetch issues: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse issues: {}", e))
}
