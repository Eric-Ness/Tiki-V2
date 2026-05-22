use std::process::Command;

use super::hidden_command;

// ─── CLI Check Commands ───────────────────────────────────────────────────────

/// A resolved, verified way to invoke the Claude CLI on this machine.
///
/// Windows GUI apps inherit `explorer.exe`'s *login-time* PATH, so a `claude`
/// installed (or PATH-registered) after the last login is invisible to the
/// Tauri process even though a fresh terminal finds it. Probing known install
/// locations in addition to PATH works around that staleness, and capturing the
/// concrete invocation here means the availability check and the enhance
/// command always run the *same* resolved binary.
#[derive(Clone)]
pub(crate) struct ClaudeCli {
    /// Program to spawn — `cmd` when reaching `claude` through PATH or a `.cmd`
    /// shim on Windows, otherwise the absolute path to the executable.
    pub(crate) program: String,
    /// Args that must precede the caller's own (`["/C", "claude"]` for the shim).
    prefix_args: Vec<String>,
}

impl ClaudeCli {
    /// A `Command` pre-loaded with the launcher + prefix args; append your own.
    pub(crate) fn command(&self) -> Command {
        let mut cmd = hidden_command(&self.program);
        cmd.args(&self.prefix_args);
        cmd
    }
}

/// Build a `ClaudeCli` for a concrete file path, picking the right launcher:
/// `.cmd`/`.bat` shims must go through `cmd /C`, real executables run directly.
fn claude_at_path(path: String) -> ClaudeCli {
    #[cfg(target_os = "windows")]
    {
        let lower = path.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            return ClaudeCli {
                program: "cmd".to_string(),
                prefix_args: vec!["/C".to_string(), path],
            };
        }
    }
    ClaudeCli {
        program: path,
        prefix_args: Vec::new(),
    }
}

/// Candidate Claude CLI invocations to try, in priority order: whatever is on
/// PATH first, then known per-user install locations that actually exist on disk.
fn claude_candidates() -> Vec<ClaudeCli> {
    let mut candidates = Vec::new();

    // 1. Whatever is on PATH — the happy path for a normally-launched process.
    #[cfg(target_os = "windows")]
    candidates.push(ClaudeCli {
        program: "cmd".to_string(),
        prefix_args: vec!["/C".to_string(), "claude".to_string()],
    });
    #[cfg(not(target_os = "windows"))]
    candidates.push(ClaudeCli {
        program: "claude".to_string(),
        prefix_args: Vec::new(),
    });

    // 2. Known install locations — covers Windows GUI PATH staleness and
    //    per-user installs that never made it onto the login PATH.
    #[cfg(target_os = "windows")]
    let known: Vec<String> = {
        let mut v = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            v.push(format!("{appdata}\\npm\\claude.cmd")); // npm -g
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            v.push(format!("{home}\\.local\\bin\\claude.exe")); // native installer
            v.push(format!("{home}\\.claude\\local\\claude.exe")); // legacy local install
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            v.push(format!("{local}\\Programs\\claude\\claude.exe"));
        }
        v
    };
    #[cfg(not(target_os = "windows"))]
    let known: Vec<String> = {
        let mut v = Vec::new();
        if let Ok(home) = std::env::var("HOME") {
            v.push(format!("{home}/.local/bin/claude"));
            v.push(format!("{home}/.claude/local/claude"));
            v.push(format!("{home}/.npm-global/bin/claude"));
        }
        v.push("/usr/local/bin/claude".to_string());
        v.push("/opt/homebrew/bin/claude".to_string());
        v
    };

    for path in known {
        if std::path::Path::new(&path).exists() {
            candidates.push(claude_at_path(path));
        }
    }

    candidates
}

/// Resolve a Claude CLI invocation that actually runs, or `None` if `claude`
/// can't be found on PATH or in any known install location.
pub(crate) fn resolve_claude_cli() -> Option<ClaudeCli> {
    claude_candidates().into_iter().find(|cli| {
        cli.command()
            .arg("--version")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    })
}

/// Check if Claude CLI is installed and accessible.
/// Returns `Ok(true)` if a working `claude` was found (on PATH or in a known
/// install location), `Ok(false)` otherwise.
#[tauri::command]
pub fn check_claude_cli() -> Result<bool, String> {
    Ok(resolve_claude_cli().is_some())
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
