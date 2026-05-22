use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Stdio;

use super::{hidden_command, resolve_claude_cli, run_gh_with_retry};

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

/// Fetch GitHub issues from a repository
/// - state: Filter by issue state ("open", "closed", "all"). Defaults to "open"
/// - limit: Maximum number of issues to fetch. Defaults to 30
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn fetch_github_issues(
    state: Option<String>,
    limit: Option<u32>,
    project_path: Option<String>,
) -> Result<Vec<GitHubIssue>, String> {
    let state_filter = state.unwrap_or_else(|| "open".to_string());
    let limit_val = limit.unwrap_or(30);

    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "issue",
            "list",
            "--json",
            "number,title,body,state,labels,url,createdAt,updatedAt",
            "--state",
            &state_filter,
            "--limit",
            &limit_val.to_string(),
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse issues: {}", e))
}

/// Create a new GitHub issue
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn create_github_issue(
    title: String,
    body: Option<String>,
    labels: Vec<String>,
    project_path: Option<String>,
) -> Result<GitHubIssue, String> {
    let mut args = vec![
        "issue".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title,
    ];

    if let Some(body_text) = body {
        args.push("--body".to_string());
        args.push(body_text);
    }

    for label in labels {
        args.push("--label".to_string());
        args.push(label);
    }

    let mut cmd = hidden_command("gh");
    cmd.args(&args);

    if let Some(ref path) = project_path {
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
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not logged in") || stderr.contains("authentication") {
            return Err(
                "Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string(),
            );
        }
        if stderr.contains("not a git repository") || stderr.contains("no git remotes") {
            return Err(
                "Not in a GitHub repository. Please open a project with a GitHub remote."
                    .to_string(),
            );
        }
        return Err(format!("Failed to create issue: {}", stderr));
    }

    // gh issue create outputs the issue URL on success
    // Parse the issue number from the URL and fetch full issue data
    let stdout = String::from_utf8_lossy(&output.stdout);
    let issue_url = stdout.trim();

    // Extract issue number from URL (e.g., "https://github.com/owner/repo/issues/123")
    let issue_number: u32 = issue_url
        .rsplit('/')
        .next()
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| format!("Failed to parse issue number from URL: {}", issue_url))?;

    // Fetch the created issue using gh issue view
    fetch_github_issue_by_number(issue_number, project_path)
}

/// Fetch a single GitHub issue by number
#[tauri::command]
pub fn fetch_github_issue_by_number(
    number: u32,
    project_path: Option<String>,
) -> Result<GitHubIssue, String> {
    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "issue",
            "view",
            &number.to_string(),
            "--json",
            "number,title,body,state,labels,url,createdAt,updatedAt",
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse issue: {}", e))
}

/// A GitHub user (comment author)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCommentAuthor {
    pub login: String,
}

/// A GitHub issue comment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubComment {
    pub id: String,
    pub author: GitHubCommentAuthor,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

/// Fetch comments for a GitHub issue
/// Uses `gh issue view` with --comments and --json to fetch comments
#[tauri::command]
pub fn fetch_issue_comments(
    number: u32,
    project_path: Option<String>,
) -> Result<Vec<GitHubComment>, String> {
    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "issue",
            "view",
            &number.to_string(),
            "--json",
            "comments",
            "--jq",
            ".comments",
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(vec![]);
    }

    serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse comments: {}", e))
}

/// Post a comment on a GitHub issue
#[tauri::command]
pub fn post_issue_comment(
    number: u32,
    body: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let mut cmd = hidden_command("gh");
    cmd.args([
        "issue",
        "comment",
        &number.to_string(),
        "--body",
        &body,
    ]);

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
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not logged in") || stderr.contains("authentication") {
            return Err(
                "Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string(),
            );
        }
        return Err(format!("Failed to post comment: {}", stderr));
    }

    Ok(())
}

/// Enhance an issue description using Claude AI
/// - description: The current description text to enhance
/// - enhancement_type: One of "clarity", "technical", "simplify", "acceptance"
#[tauri::command]
pub fn enhance_issue_description(
    description: String,
    enhancement_type: String,
) -> Result<String, String> {
    let prompt = match enhancement_type.as_str() {
        "clarity" => format!(
            "Improve the clarity of this GitHub issue description. Make it clearer and easier to understand while preserving the original intent. Return ONLY the improved description text, no explanations:\n\n{}",
            description
        ),
        "technical" => format!(
            "Add technical details and implementation hints to this GitHub issue description. Include relevant technical context that would help a developer understand what needs to be done. Return ONLY the enhanced description text, no explanations:\n\n{}",
            description
        ),
        "simplify" => format!(
            "Simplify this GitHub issue description. Use simpler terms and reduce complexity while preserving all important information. Return ONLY the simplified description text, no explanations:\n\n{}",
            description
        ),
        "acceptance" => format!(
            "Add acceptance criteria to this GitHub issue description. Generate testable criteria that define when this issue is complete. Format with bullet points under an '## Acceptance Criteria' heading. Return the original description followed by the acceptance criteria, no other explanations:\n\n{}",
            description
        ),
        _ => return Err(format!("Unknown enhancement type: {}", enhancement_type)),
    };

    // Use the claude CLI to enhance the description.
    // Resolve it the same way `check_claude_cli` does — PATH plus known install
    // locations — so the button being enabled always matches what runs here.
    // Pipe the prompt via stdin to avoid shell metacharacter issues.
    let cli = resolve_claude_cli().ok_or_else(|| {
        "Claude CLI not found. Install it from https://github.com/anthropics/claude-code, \
         then make sure it's on your PATH. (Checked PATH and common install locations \
         such as the npm global directory and ~/.local/bin.)"
            .to_string()
    })?;

    let mut child = cli
        .command()
        .arg("-p")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to run Claude CLI ({}): {}. Make sure Claude CLI is properly installed and configured.",
                cli.program, e
            )
        })?;

    // Write prompt to stdin and close it
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|e| format!("Failed to write to Claude CLI stdin: {}", e))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("Failed to wait for Claude CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Claude enhancement failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

/// Close a GitHub issue
/// - number: The issue number to close
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn close_github_issue(number: u32, project_path: Option<String>) -> Result<(), String> {
    let mut cmd = hidden_command("gh");
    cmd.args(["issue", "close", &number.to_string()]);

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
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not logged in") || stderr.contains("authentication") {
            return Err(
                "Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string(),
            );
        }
        if stderr.contains("not a git repository") || stderr.contains("no git remotes") {
            return Err(
                "Not in a GitHub repository. Please open a project with a GitHub remote."
                    .to_string(),
            );
        }
        return Err(format!("Failed to close issue: {}", stderr));
    }

    Ok(())
}

/// Edit an existing GitHub issue
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn edit_github_issue(
    number: u32,
    title: Option<String>,
    body: Option<String>,
    add_labels: Vec<String>,
    remove_labels: Vec<String>,
    project_path: Option<String>,
) -> Result<(), String> {
    let mut args = vec![
        "issue".to_string(),
        "edit".to_string(),
        number.to_string(),
    ];

    if let Some(t) = title {
        args.push("--title".to_string());
        args.push(t);
    }

    if let Some(b) = body {
        args.push("--body".to_string());
        args.push(b);
    }

    for label in add_labels {
        args.push("--add-label".to_string());
        args.push(label);
    }

    for label in remove_labels {
        args.push("--remove-label".to_string());
        args.push(label);
    }

    let mut cmd = hidden_command("gh");
    cmd.args(&args);

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
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not logged in") || stderr.contains("authentication") {
            return Err(
                "Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string(),
            );
        }
        if stderr.contains("not a git repository") || stderr.contains("no git remotes") {
            return Err(
                "Not in a GitHub repository. Please open a project with a GitHub remote."
                    .to_string(),
            );
        }
        return Err(format!("Failed to edit issue: {}", stderr));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_github_issue_with_labels() {
        // Mirrors `gh issue list --json number,title,body,state,labels,url,createdAt,updatedAt`.
        let payload = serde_json::json!({
            "number": 233,
            "title": "Split github.rs",
            "body": "Refactor into a directory module.",
            "state": "OPEN",
            "labels": [
                { "id": "L_1", "name": "refactor", "color": "ededed", "description": "code cleanup" },
                { "id": "L_2", "name": "rust", "color": "dea584" }
            ],
            "url": "https://github.com/owner/repo/issues/233",
            "createdAt": "2026-05-22T10:00:00Z",
            "updatedAt": "2026-05-22T11:30:00Z"
        });

        let issue: GitHubIssue = serde_json::from_value(payload).unwrap();
        assert_eq!(issue.number, 233);
        assert_eq!(issue.title, "Split github.rs");
        assert_eq!(issue.body.as_deref(), Some("Refactor into a directory module."));
        assert_eq!(issue.state, "OPEN");
        assert_eq!(issue.labels.len(), 2);
        assert_eq!(issue.labels[0].name, "refactor");
        assert_eq!(issue.labels[0].description.as_deref(), Some("code cleanup"));
        assert!(issue.labels[1].description.is_none());
        // camelCase rename: `createdAt` -> `created_at`.
        assert_eq!(issue.created_at, "2026-05-22T10:00:00Z");
        assert_eq!(issue.updated_at, "2026-05-22T11:30:00Z");
    }

    #[test]
    fn deserializes_issue_without_body() {
        let payload = serde_json::json!({
            "number": 1,
            "title": "No body",
            "state": "CLOSED",
            "labels": [],
            "url": "https://github.com/owner/repo/issues/1",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z"
        });

        let issue: GitHubIssue = serde_json::from_value(payload).unwrap();
        assert!(issue.body.is_none());
        assert!(issue.labels.is_empty());
    }

    #[test]
    fn deserializes_issue_comment() {
        let payload = serde_json::json!({
            "id": "IC_1",
            "author": { "login": "octocat" },
            "body": "Looks good to me.",
            "createdAt": "2026-05-22T12:00:00Z",
            "url": "https://github.com/owner/repo/issues/233#issuecomment-1"
        });

        let comment: GitHubComment = serde_json::from_value(payload).unwrap();
        assert_eq!(comment.id, "IC_1");
        assert_eq!(comment.author.login, "octocat");
        assert_eq!(comment.body, "Looks good to me.");
        // camelCase rename: `createdAt` -> `created_at`.
        assert_eq!(comment.created_at, "2026-05-22T12:00:00Z");
    }
}
