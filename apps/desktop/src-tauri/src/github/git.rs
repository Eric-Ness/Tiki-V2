use super::hidden_command;

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
