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

#[cfg(test)]
mod command_hygiene_guard {
    //! Source-scan guard (#36/#121): `hidden_command` (this module) must be the
    //! ONLY place that constructs a raw `std::process::Command`. Every other spawn
    //! must route through it so the Windows `CREATE_NO_WINDOW` flag is applied and
    //! no stray console window flashes. A future `Command::new(...)` elsewhere would
    //! silently bypass that hygiene — this test fails the build before it can.
    //!
    //! `native_pty_system()` / `portable_pty::CommandBuilder` (terminal/pty.rs) is a
    //! DIFFERENT type and intentionally not flagged.

    use std::fs;
    use std::path::{Path, PathBuf};

    /// The single source file allowed to construct a raw `Command` (this module).
    const ALLOWED_FILE: &str = "github/mod.rs";

    /// True if a single source line constructs a raw `std::process::Command`.
    ///
    /// Excludes:
    /// - `//`-comment lines so doc/comment mentions (e.g. the doc comment on
    ///   `hidden_command`) don't count — a leading-whitespace-trimmed line starting
    ///   with `//` is a comment;
    /// - occurrences of the token inside a Rust string literal (e.g. this guard's
    ///   own `r#"... Command::new(\"gh\") ..."#` SC3 fixtures) — judged by an odd
    ///   number of `"` characters preceding the match position.
    ///
    /// The genuine construction `let mut cmd = Command::new(program);` is bare code
    /// (zero preceding quotes) and is therefore flagged.
    fn line_constructs_command(line: &str) -> bool {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            return false;
        }
        let Some(pos) = line.find("Command::new(") else {
            return false;
        };
        // Inside a string literal if an odd number of double-quotes precede the match.
        let preceding_quotes = line[..pos].matches('"').count();
        preceding_quotes % 2 == 0
    }

    /// Recursively collect every `*.rs` file under `dir`.
    fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
        let entries = fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("failed to read dir {}: {}", dir.display(), e));
        for entry in entries {
            let entry = entry.expect("failed to read dir entry");
            let path = entry.path();
            if path.is_dir() {
                collect_rs_files(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn hidden_command_is_the_only_raw_command_constructor() {
        // CARGO_MANIFEST_DIR points at apps/desktop/src-tauri; sources live under src/.
        let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        assert!(
            src_root.is_dir(),
            "expected source root {} to exist",
            src_root.display()
        );

        let mut files = Vec::new();
        collect_rs_files(&src_root, &mut files);
        assert!(
            !files.is_empty(),
            "found no .rs files under {} — scan is misconfigured",
            src_root.display()
        );

        let mut violations: Vec<String> = Vec::new();
        for file in &files {
            // Normalize the path-relative-to-src to forward slashes for the allow-list.
            let rel = file
                .strip_prefix(&src_root)
                .unwrap_or(file)
                .to_string_lossy()
                .replace('\\', "/");
            let contents = fs::read_to_string(file)
                .unwrap_or_else(|e| panic!("failed to read {}: {}", file.display(), e));
            for (idx, line) in contents.lines().enumerate() {
                if line_constructs_command(line) && rel != ALLOWED_FILE {
                    violations.push(format!("{}:{}", rel, idx + 1));
                }
            }
        }

        assert!(
            violations.is_empty(),
            "raw `Command::new(` found outside the `hidden_command` wrapper \
             (github/mod.rs). Route the spawn through `crate::github::hidden_command(..)` \
             so the Windows CREATE_NO_WINDOW flag is applied (#36/#121). Offending sites: {:?}",
            violations
        );

        // The legitimate site MUST still exist — otherwise the guard would pass
        // vacuously if `hidden_command` were ever deleted/renamed.
        let mod_rs = src_root.join("github").join("mod.rs");
        let mod_contents = fs::read_to_string(&mod_rs).expect("failed to read github/mod.rs");
        let legit_sites = mod_contents
            .lines()
            .filter(|l| line_constructs_command(l))
            .count();
        assert_eq!(
            legit_sites, 1,
            "expected exactly one raw `Command::new(` in github/mod.rs (the hidden_command \
             definition), found {legit_sites}"
        );
    }

    /// SC3 proof: the predicate is not vacuously green — it WOULD flag a planted
    /// bypass and does NOT flag a comment that merely mentions the construction.
    #[test]
    fn predicate_flags_planted_bypass_but_not_comment() {
        // A real (planted) bypass that should be caught.
        assert!(
            line_constructs_command(r#"        let _ = Command::new("gh");"#),
            "predicate must flag a real Command::new( construction"
        );
        // A comment line that merely references it must NOT be flagged.
        assert!(
            !line_constructs_command("        // uses Command::new"),
            "predicate must not flag a //-comment mentioning Command::new"
        );
        // A comment that even contains the full `Command::new(` literal must be ignored.
        assert!(
            !line_constructs_command(r#"    /// On non-Windows platforms, identical to Command::new()."#),
            "predicate must not flag a doc-comment containing Command::new("
        );
    }
}
