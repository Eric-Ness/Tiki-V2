use serde::{Deserialize, Serialize};

use super::{hidden_command, run_gh_with_retry};

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
    let output = run_gh_with_retry(move || {
        let mut cmd = hidden_command("gh");
        cmd.args(["label", "list", "--json", "name,color", "--limit", "100"]);
        if let Some(ref path) = project_path {
            cmd.current_dir(path);
        }
        cmd
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse labels: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_label_info() {
        // Mirrors `gh label list --json name,color`.
        let payload = serde_json::json!([
            { "name": "bug", "color": "d73a4a" },
            { "name": "enhancement", "color": "a2eeef" }
        ]);

        let labels: Vec<LabelInfo> = serde_json::from_value(payload).unwrap();
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].name, "bug");
        assert_eq!(labels[0].color, "d73a4a");
        assert_eq!(labels[1].name, "enhancement");
        assert_eq!(labels[1].color, "a2eeef");
    }
}
