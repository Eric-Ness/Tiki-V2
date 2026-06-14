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

// ─── Git write layer (#283) ──────────────────────────────────────────────────
//
// Net-new mutating git operations. Every spawn routes through
// `super::hidden_command("git")` (the only sanctioned raw-Command site) and sets
// `.current_dir(project_path)` unconditionally, mirroring the read-only error
// mapping above: `ErrorKind::NotFound` → "Git is not installed"; non-zero exit →
// the stderr surfaced in a message.

/// Initialize a new git repository at `project_path` with `main` as the default
/// branch (`git init -b main`). If the running git is too old to accept `-b`,
/// falls back to repointing HEAD at `refs/heads/main` via `git symbolic-ref`.
#[tauri::command]
pub fn git_init(project_path: String) -> Result<(), String> {
    let mut cmd = hidden_command("git");
    cmd.args(["init", "-b", "main"]);
    cmd.current_dir(&project_path);

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !output.status.success() {
        // Fallback for git too old to support `init -b <branch>`: init plain,
        // then point HEAD at refs/heads/main.
        let mut init_cmd = hidden_command("git");
        init_cmd.arg("init");
        init_cmd.current_dir(&project_path);
        let init_output = init_cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Git is not installed. Please install Git.".to_string()
            } else {
                format!("Failed to run git: {}", e)
            }
        })?;
        if !init_output.status.success() {
            let stderr = String::from_utf8_lossy(&init_output.stderr);
            return Err(format!("Failed to initialize git repository: {}", stderr));
        }

        let mut sym_cmd = hidden_command("git");
        sym_cmd.args(["symbolic-ref", "HEAD", "refs/heads/main"]);
        sym_cmd.current_dir(&project_path);
        let sym_output = sym_cmd.output().map_err(|e| format!("Failed to run git: {}", e))?;
        if !sym_output.status.success() {
            let stderr = String::from_utf8_lossy(&sym_output.stderr);
            return Err(format!("Failed to set default branch to main: {}", stderr));
        }
    }

    Ok(())
}

/// Add a git remote named `name` pointing at `url` (`git remote add <name> <url>`).
#[tauri::command]
pub fn git_add_remote(project_path: String, name: String, url: String) -> Result<(), String> {
    let mut cmd = hidden_command("git");
    cmd.args(["remote", "add", &name, &url]);
    cmd.current_dir(&project_path);

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
        return Err(format!("Failed to add git remote: {}", stderr));
    }

    Ok(())
}

/// Stage all changes (`git add -A`) and create a commit with `message`
/// (`git commit -m <message>`). Returns `Err` on failure; callers decide whether
/// a failed commit is fatal (e.g. an empty tree producing "nothing to commit").
#[tauri::command]
pub fn git_commit_all(project_path: String, message: String) -> Result<(), String> {
    let mut add_cmd = hidden_command("git");
    add_cmd.args(["add", "-A"]);
    add_cmd.current_dir(&project_path);

    let add_output = add_cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        if stderr.contains("not a git repository") {
            return Err("Not in a git repository.".to_string());
        }
        return Err(format!("Failed to stage changes: {}", stderr));
    }

    let mut commit_cmd = hidden_command("git");
    commit_cmd.args(["commit", "-m", &message]);
    commit_cmd.current_dir(&project_path);

    let commit_output = commit_cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("Failed to commit: {}", stderr));
    }

    Ok(())
}

/// Get the URL of the `origin` remote (`git remote get-url origin`).
/// Returns `Ok(None)` when there is no such remote; `Err` on a real failure
/// (e.g. git missing, not a repository).
#[tauri::command]
pub fn git_remote_get(project_path: String) -> Result<Option<String>, String> {
    let mut cmd = hidden_command("git");
    cmd.args(["remote", "get-url", "origin"]);
    cmd.current_dir(&project_path);

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed. Please install Git.".to_string()
        } else {
            format!("Failed to run git: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lower = stderr.to_lowercase();
        // No origin remote configured → treat as "no remote", not an error.
        if lower.contains("no such remote") || lower.contains("not found") {
            return Ok(None);
        }
        if lower.contains("not a git repository") {
            return Err("Not in a git repository.".to_string());
        }
        return Err(format!("Failed to get remote url: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Build a fresh, unique temp directory per test (OS temp dir +
    /// nanosecond suffix) to avoid collisions across parallel runs. The OS
    /// reclaims temp space; we don't clean up explicitly.
    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tiki-git-{}-{}", label, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn git_init_creates_dot_git_directory() {
        let dir = make_temp_dir("init");
        let path = dir.to_string_lossy().to_string();

        git_init(path).expect("git_init should succeed");

        assert!(
            dir.join(".git").is_dir(),
            "expected a .git directory under {}",
            dir.display()
        );
    }

    #[test]
    fn git_add_remote_then_get_round_trips() {
        let dir = make_temp_dir("remote-roundtrip");
        let path = dir.to_string_lossy().to_string();
        let url = "https://github.com/example/repo.git".to_string();

        git_init(path.clone()).expect("git_init should succeed");
        git_add_remote(path.clone(), "origin".to_string(), url.clone())
            .expect("git_add_remote should succeed");

        let got = git_remote_get(path).expect("git_remote_get should succeed");
        assert_eq!(got, Some(url));
    }

    #[test]
    fn git_remote_get_returns_none_when_no_remote() {
        let dir = make_temp_dir("remote-none");
        let path = dir.to_string_lossy().to_string();

        git_init(path.clone()).expect("git_init should succeed");

        let got = git_remote_get(path).expect("git_remote_get should succeed");
        assert_eq!(got, None);
    }
}
