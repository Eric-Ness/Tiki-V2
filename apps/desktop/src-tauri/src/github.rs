use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

/// Create a Command that suppresses console window creation on Windows.
/// On non-Windows platforms, this is identical to `Command::new()`.
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

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

// ─── Pull Request Types ───────────────────────────────────────────────────────

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
        return Err(format!("gh pr list failed: {}", stderr));
    }

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
        return Err(format!("gh pr view failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse PR detail: {}", e))
}

// ─── CLI Check Commands ───────────────────────────────────────────────────────

/// Check if Claude CLI is installed and accessible
/// Returns Ok(true) if installed, Ok(false) if not installed
#[tauri::command]
pub fn check_claude_cli() -> Result<bool, String> {
    // On Windows, we need to run through cmd.exe to find .cmd files in PATH
    #[cfg(target_os = "windows")]
    let output = hidden_command("cmd")
        .args(["/C", "claude", "--version"])
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = hidden_command("claude")
        .args(["--version"])
        .output();

    match output {
        Ok(result) => Ok(result.status.success()),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err(format!("Failed to check Claude CLI: {}", e))
            }
        }
    }
}

/// Check if gh CLI is authenticated
/// Returns Ok(true) if authenticated, Ok(false) if not authenticated,
/// Err if gh CLI is not installed
#[tauri::command]
pub fn check_gh_auth() -> Result<bool, String> {
    let output = hidden_command("gh")
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

/// A GitHub release fetched from gh CLI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub is_draft: bool,
    pub is_prerelease: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Fetch GitHub releases from a repository
/// - limit: Maximum number of releases to fetch. Defaults to 20
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn fetch_github_releases(
    limit: Option<u32>,
    project_path: Option<String>,
) -> Result<Vec<GitHubRelease>, String> {
    let limit_val = limit.unwrap_or(20);

    let mut cmd = hidden_command("gh");
    cmd.args([
        "release",
        "list",
        "--json",
        "tagName,name,isDraft,isPrerelease,publishedAt",
        "--limit",
        &limit_val.to_string(),
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
        if stderr.contains("not a git repository") || stderr.contains("no git remotes") {
            return Err(
                "Not in a GitHub repository. Please open a project with a GitHub remote."
                    .to_string(),
            );
        }
        return Err(format!("Failed to fetch releases: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse releases: {}", e))
}

/// A simple label structure for fetching available labels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelInfo {
    pub name: String,
    pub color: String,
}

/// Fetch available labels from a repository
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn fetch_github_labels(project_path: Option<String>) -> Result<Vec<LabelInfo>, String> {
    let mut cmd = hidden_command("gh");
    cmd.args(["label", "list", "--json", "name,color", "--limit", "100"]);

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
        return Err(format!("Failed to fetch labels: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse labels: {}", e))
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
    let mut cmd = hidden_command("gh");
    cmd.args([
        "issue",
        "view",
        &number.to_string(),
        "--json",
        "number,title,body,state,labels,url,createdAt,updatedAt",
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
        return Err(format!("Failed to fetch issue: {}", stderr));
    }

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
        return Err(format!("Failed to fetch comments: {}", stderr));
    }

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

    // Use the claude CLI to enhance the description
    // Pipe the prompt via stdin to avoid shell metacharacter issues

    #[cfg(target_os = "windows")]
    let mut child = hidden_command("cmd")
        .args(["/C", "claude", "-p"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Please install it from https://github.com/anthropics/claude-code and ensure it's in your PATH.".to_string()
            } else {
                format!("Failed to run Claude CLI: {}. Make sure Claude CLI is properly installed and configured.", e)
            }
        })?;

    #[cfg(not(target_os = "windows"))]
    let mut child = hidden_command("claude")
        .args(["-p"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Please install it from https://github.com/anthropics/claude-code and ensure it's in your PATH.".to_string()
            } else {
                format!("Failed to run Claude CLI: {}. Make sure Claude CLI is properly installed and configured.", e)
            }
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

/// Get the current git branch name
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn get_current_branch(project_path: Option<String>) -> Result<String, String> {
    let mut cmd = hidden_command("git");
    cmd.args(["rev-parse", "--abbrev-ref", "HEAD"]);

    if let Some(path) = project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not a git repository") {
            return Err("Not in a git repository.".to_string());
        }
        return Err(format!("Failed to get current branch: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

/// List all git branches (local)
/// - project_path: Optional path to the project directory. If not provided, uses current working directory.
#[tauri::command]
pub fn list_git_branches(project_path: Option<String>) -> Result<Vec<String>, String> {
    let mut cmd = hidden_command("git");
    cmd.args(["branch", "--format=%(refname:short)"]);

    if let Some(path) = project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not a git repository") {
            return Err("Not in a git repository.".to_string());
        }
        return Err(format!("Failed to list branches: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let branches: Vec<String> = stdout
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(branches)
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
