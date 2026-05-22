use serde::{Deserialize, Serialize};

use super::{hidden_command, run_gh_with_retry, GitHubLabel};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrAuthor {
    pub login: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrStatusCheck {
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default)]
    pub details_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequest {
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub head_ref_name: String,
    #[serde(default)]
    pub base_ref_name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub author: Option<GitHubPrAuthor>,
    #[serde(default)]
    pub labels: Vec<GitHubLabel>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub status_check_rollup: Vec<GitHubPrStatusCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrFile {
    pub path: String,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrReview {
    #[serde(default)]
    pub author: Option<GitHubPrAuthor>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrDetail {
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub head_ref_name: String,
    #[serde(default)]
    pub base_ref_name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub author: Option<GitHubPrAuthor>,
    #[serde(default)]
    pub labels: Vec<GitHubLabel>,
    #[serde(default)]
    pub status_check_rollup: Vec<GitHubPrStatusCheck>,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
    #[serde(default)]
    pub commits: serde_json::Value,
    #[serde(default)]
    pub files: Vec<GitHubPrFile>,
    #[serde(default)]
    pub reviews: Vec<GitHubPrReview>,
}

// ─── Pull Request Commands ────────────────────────────────────────────────────

/// Fetch GitHub pull requests from a repository
/// - state_filter: Filter by PR state ("open", "closed", "merged", "all"). Defaults to "open"
/// - limit: Maximum number of PRs to fetch. Defaults to 30
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn fetch_github_prs(
    state_filter: Option<String>,
    limit: Option<u32>,
    project_path: Option<String>,
) -> Result<Vec<GitHubPullRequest>, String> {
    let filter = state_filter.unwrap_or_else(|| "open".to_string());
    let pr_limit = limit.unwrap_or(30);

    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "pr",
            "list",
            "--json",
            "number,title,state,headRefName,baseRefName,url,isDraft,reviewDecision,statusCheckRollup,labels,body,author",
            "--state",
            &filter,
            "--limit",
            &pr_limit.to_string(),
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();

    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }

    serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse PR list: {}", e))
}

/// Fetch detailed information about a single GitHub pull request
/// - number: The PR number to fetch
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn fetch_github_pr_detail(
    number: u32,
    project_path: Option<String>,
) -> Result<GitHubPrDetail, String> {
    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "number,title,body,state,headRefName,baseRefName,url,isDraft,reviewDecision,statusCheckRollup,labels,author,additions,deletions,commits,files,reviews",
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse PR detail: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_pull_request_with_camel_case_refs() {
        // Mirrors `gh pr list --json number,title,state,headRefName,baseRefName,...`.
        let payload = serde_json::json!({
            "number": 42,
            "title": "Add feature",
            "state": "OPEN",
            "headRefName": "feature/add",
            "baseRefName": "main",
            "url": "https://github.com/owner/repo/pull/42",
            "isDraft": false,
            "reviewDecision": "APPROVED",
            "author": { "login": "octocat" },
            "labels": [
                { "id": "L_1", "name": "enhancement", "color": "a2eeef" }
            ],
            "body": "Implements the feature.",
            "statusCheckRollup": [
                {
                    "name": "build",
                    "status": "COMPLETED",
                    "conclusion": "SUCCESS",
                    "detailsUrl": "https://github.com/owner/repo/actions/runs/1"
                }
            ]
        });

        let pr: GitHubPullRequest = serde_json::from_value(payload).unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.title, "Add feature");
        // camelCase renames: headRefName/baseRefName/isDraft/reviewDecision.
        assert_eq!(pr.head_ref_name, "feature/add");
        assert_eq!(pr.base_ref_name, "main");
        assert!(!pr.is_draft);
        assert_eq!(pr.review_decision.as_deref(), Some("APPROVED"));
        assert_eq!(pr.author.as_ref().unwrap().login, "octocat");
        assert_eq!(pr.labels.len(), 1);
        assert_eq!(pr.labels[0].name, "enhancement");
        assert_eq!(pr.status_check_rollup.len(), 1);
        assert_eq!(pr.status_check_rollup[0].conclusion.as_deref(), Some("SUCCESS"));
        assert_eq!(
            pr.status_check_rollup[0].details_url.as_deref(),
            Some("https://github.com/owner/repo/actions/runs/1")
        );
    }

    #[test]
    fn deserializes_pull_request_with_defaults() {
        // Only the two non-defaulted fields are required.
        let payload = serde_json::json!({ "number": 7, "title": "Minimal" });
        let pr: GitHubPullRequest = serde_json::from_value(payload).unwrap();
        assert_eq!(pr.number, 7);
        assert_eq!(pr.state, "");
        assert_eq!(pr.head_ref_name, "");
        assert!(!pr.is_draft);
        assert!(pr.author.is_none());
        assert!(pr.labels.is_empty());
        assert!(pr.status_check_rollup.is_empty());
    }

    #[test]
    fn deserializes_pr_detail_with_files_and_reviews() {
        // Mirrors `gh pr view --json ...,additions,deletions,commits,files,reviews`.
        let payload = serde_json::json!({
            "number": 99,
            "title": "Big change",
            "body": "Detailed body.",
            "state": "MERGED",
            "headRefName": "big/change",
            "baseRefName": "main",
            "url": "https://github.com/owner/repo/pull/99",
            "isDraft": false,
            "reviewDecision": "APPROVED",
            "author": { "login": "dev" },
            "labels": [],
            "statusCheckRollup": [],
            "additions": 120,
            "deletions": 30,
            "commits": [{ "oid": "abc123" }],
            "files": [
                { "path": "src/lib.rs", "additions": 10, "deletions": 2 },
                { "path": "README.md" }
            ],
            "reviews": [
                { "author": { "login": "reviewer" }, "state": "APPROVED", "body": "LGTM" }
            ]
        });

        let detail: GitHubPrDetail = serde_json::from_value(payload).unwrap();
        assert_eq!(detail.number, 99);
        assert_eq!(detail.state, "MERGED");
        assert_eq!(detail.head_ref_name, "big/change");
        assert_eq!(detail.additions, 120);
        assert_eq!(detail.deletions, 30);
        assert!(detail.commits.is_array());
        assert_eq!(detail.files.len(), 2);
        assert_eq!(detail.files[0].path, "src/lib.rs");
        assert_eq!(detail.files[0].additions, 10);
        // File without additions/deletions defaults to 0.
        assert_eq!(detail.files[1].additions, 0);
        assert_eq!(detail.reviews.len(), 1);
        assert_eq!(detail.reviews[0].author.as_ref().unwrap().login, "reviewer");
        assert_eq!(detail.reviews[0].state, "APPROVED");
    }
}
