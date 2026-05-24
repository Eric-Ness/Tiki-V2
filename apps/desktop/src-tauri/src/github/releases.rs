use serde::{Deserialize, Serialize};

use super::{hidden_command, run_gh_with_retry};

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

    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args([
            "release",
            "list",
            "--json",
            "tagName,name,isDraft,isPrerelease,publishedAt",
            "--limit",
            &limit_val.to_string(),
        ]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse releases: {}", e))
}

/// Fetch the canonical GitHub Release URL for a tag, or `None` when the release
/// is not (yet) published.
///
/// `gh release list --json` does NOT expose a `url` field — only `gh release view`
/// does — so completed releases routed to the Tiki detail view fetch their link
/// here. ANY `gh` failure (release not found during the archive->CI-publish gap,
/// auth, rate limit) collapses to `Ok(None)` so the "View on GitHub" link simply
/// doesn't render rather than surfacing an error on an otherwise-complete view.
///
/// - version: the release tag (e.g. "v0.7.7")
/// - project_path: optional project dir; sets the cwd so `gh` resolves the repo.
#[tauri::command]
pub fn fetch_github_release_url(
    version: String,
    project_path: Option<String>,
) -> Result<Option<String>, String> {
    let output = match run_gh_with_retry(|| {
        let mut cmd = hidden_command("gh");
        cmd.args(["release", "view", &version, "--json", "url"]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    }) {
        Ok(o) => o,
        Err(e) => {
            log::debug!(
                "fetch_github_release_url({}): no link (gh failed: {})",
                version,
                e
            );
            return Ok(None);
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse release url: {}", e))?;
    Ok(parsed
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_release_with_camel_case_fields() {
        // Mirrors `gh release list --json tagName,name,isDraft,isPrerelease,publishedAt`.
        let payload = serde_json::json!({
            "tagName": "v0.7.3",
            "name": "Tiki v0.7.3",
            "isDraft": false,
            "isPrerelease": false,
            "publishedAt": "2026-05-22T09:00:00Z"
        });

        let release: GitHubRelease = serde_json::from_value(payload).unwrap();
        // camelCase renames: tagName/isDraft/isPrerelease/publishedAt.
        assert_eq!(release.tag_name, "v0.7.3");
        assert_eq!(release.name.as_deref(), Some("Tiki v0.7.3"));
        assert!(!release.is_draft);
        assert!(!release.is_prerelease);
        assert_eq!(release.published_at.as_deref(), Some("2026-05-22T09:00:00Z"));
        assert!(release.url.is_none());
    }

    #[test]
    fn deserializes_draft_release_without_optional_fields() {
        let payload = serde_json::json!({
            "tagName": "v0.8.0-draft",
            "isDraft": true,
            "isPrerelease": true
        });

        let release: GitHubRelease = serde_json::from_value(payload).unwrap();
        assert_eq!(release.tag_name, "v0.8.0-draft");
        assert!(release.is_draft);
        assert!(release.is_prerelease);
        assert!(release.name.is_none());
        assert!(release.published_at.is_none());
    }
}
