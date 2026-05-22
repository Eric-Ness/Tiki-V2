use std::process::Command;

mod auth;
mod git;
mod issues;
mod labels;
mod pulls;
mod rate_limit;
mod releases;

pub use auth::*;
pub use git::*;
pub use issues::*;
pub use labels::*;
pub use pulls::*;
pub use rate_limit::*;
pub use releases::*;

/// Create a Command that suppresses console window creation on Windows.
/// On non-Windows platforms, this is identical to `Command::new()`.
pub(crate) fn hidden_command(program: &str) -> Command {
    // `mut` is only needed for the Windows-only `cmd.creation_flags(...)` call below.
    // On other platforms clippy would otherwise flag this as unused_mut under -D warnings.
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

// ─── gh CLI Error Classification ──────────────────────────────────────────────

/// Classification of a `gh` CLI failure derived purely from stderr text.
/// The wrapper layer uses this to decide between retrying (secondary rate
/// limits) and returning immediately (everything else).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GhErrorKind {
    NotAuthenticated,
    NotAGitRepo,
    /// Primary rate limit (per-hour quota for the bucket).
    RateLimitExceeded,
    /// Secondary/abuse rate limit — short-lived, retry after backoff.
    SecondaryRateLimit,
    Other,
}

/// Classify `gh` CLI stderr text. Order matters: the secondary-rate-limit
/// substring overlaps the primary one ("rate limit"), so check secondary first.
pub(crate) fn classify_gh_error(stderr: &str) -> GhErrorKind {
    let lower = stderr.to_lowercase();
    if lower.contains("secondary rate limit") || lower.contains("abuse detection") {
        return GhErrorKind::SecondaryRateLimit;
    }
    if lower.contains("rate limit") || lower.contains("x-ratelimit-remaining: 0") {
        return GhErrorKind::RateLimitExceeded;
    }
    if lower.contains("not logged in") || lower.contains("authentication") {
        return GhErrorKind::NotAuthenticated;
    }
    if lower.contains("not a git repository") || lower.contains("no git remotes") {
        return GhErrorKind::NotAGitRepo;
    }
    GhErrorKind::Other
}

/// Convert a `gh` CLI stderr payload into a user-facing error message.
/// Centralizes the error mapping previously inlined in every command.
pub(crate) fn gh_error_message(stderr: &str) -> String {
    match classify_gh_error(stderr) {
        GhErrorKind::RateLimitExceeded => {
            "GitHub API rate limit exceeded. Wait until the limit resets (the desktop footer shows the reset time) or run 'gh auth status' to verify you're authenticated (unauthenticated requests have a much lower limit).".to_string()
        }
        GhErrorKind::SecondaryRateLimit => {
            "GitHub secondary rate limit hit. The desktop will retry automatically — if you keep seeing this, slow down bulk operations.".to_string()
        }
        GhErrorKind::NotAuthenticated => {
            "Not authenticated with GitHub. Run 'gh auth login' to authenticate.".to_string()
        }
        GhErrorKind::NotAGitRepo => {
            "Not in a GitHub repository. Please open a project with a GitHub remote.".to_string()
        }
        GhErrorKind::Other => format!("gh CLI failed: {}", stderr.trim()),
    }
}

/// Retry budget for transient `gh` failures (secondary rate limit only).
/// Total worst-case wait: 2 + 4 + 8 = 14 seconds across 4 attempts.
const GH_RETRY_BACKOFF_SECS: &[u64] = &[2, 4, 8];

/// Run a `gh` command with synchronous backoff retry on secondary rate limits.
///
/// `factory` returns a fresh `Command` each call (Command isn't Clone, and
/// rebuilding via the same closure keeps args/env consistent across attempts).
///
/// Sleeps between attempts via `std::thread::sleep` — safe because Tauri
/// commands run on a worker thread, not the UI thread. Returns the first
/// successful Output, or the final error mapped through `gh_error_message`.
pub(crate) fn run_gh_with_retry<F>(mut factory: F) -> Result<std::process::Output, String>
where
    F: FnMut() -> Command,
{
    let mut last_err: String = String::new();
    let attempts = GH_RETRY_BACKOFF_SECS.len() + 1;

    for attempt in 0..attempts {
        let output = factory().output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/"
                    .to_string()
            } else {
                format!("Failed to run gh CLI: {}", e)
            }
        })?;

        if output.status.success() {
            return Ok(output);
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let kind = classify_gh_error(&stderr);

        if kind != GhErrorKind::SecondaryRateLimit {
            return Err(gh_error_message(&stderr));
        }

        last_err = stderr.into_owned();
        if let Some(delay) = GH_RETRY_BACKOFF_SECS.get(attempt) {
            log::warn!(
                "gh secondary rate limit (attempt {}/{}); sleeping {}s before retry",
                attempt + 1,
                attempts,
                delay
            );
            std::thread::sleep(std::time::Duration::from_secs(*delay));
        }
    }

    Err(gh_error_message(&last_err))
}
