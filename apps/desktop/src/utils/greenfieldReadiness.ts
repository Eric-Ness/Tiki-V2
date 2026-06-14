/**
 * Reduce a `check_greenfield_readiness` GreenfieldReport into a list of display
 * rows for the greenfield-setup affordance (#284). Mirrors the pure-reducer
 * pattern of `diagnosticsSummary.ts`.
 *
 * `GreenfieldReport` is a LOCAL MIRROR of the Rust struct in
 * `apps/desktop/src-tauri/src/...` (camelCase serde booleans). The desktop does
 * not import `@tiki/shared` at runtime, so the shape is replicated here and
 * unit-tested. Keep the two in sync — a field name drift means a row silently
 * reads `undefined` (falsy → an erroneous "fix").
 *
 * Phase 3 (the component) consumes the rows: a `'pass'` row needs no action; a
 * `'fix'` row carries an `action` the component dispatches. Most actions are
 * Rust invokes; the two `handoff:true` actions (`createRemote`, `ghAuthLogin`)
 * are interactive terminal handoffs, not Rust invokes.
 */

/** Greenfield readiness report — mirrors the Rust `GreenfieldReport` struct. */
export interface GreenfieldReport {
  frameworkInstalled: boolean;
  stateSeeded: boolean;
  isGitRepo: boolean;
  hasRemote: boolean;
  ghAuthenticated: boolean;
  hasGitignore: boolean;
}

/** The remediation a `'fix'` row offers. */
export type GreenfieldAction =
  | "installFramework"
  | "seedState"
  | "gitInit"
  | "createGitignore"
  | "ghAuthLogin"
  | "createRemote";

/** One readiness check rendered as a row. */
export interface GreenfieldRow {
  id: string;
  label: string;
  status: "pass" | "fix";
  /** Set on a `'fix'` row — the remediation to dispatch. Absent on `'pass'`. */
  action?: GreenfieldAction;
  /** True when `action` is an interactive terminal handoff, not a Rust invoke. */
  handoff?: boolean;
}

/**
 * Derive the readiness rows from a report. Pure — no I/O, deterministic order:
 * framework, state, git repo, remote, gh auth, .gitignore. Each field maps to
 * exactly one row: `true` → `'pass'` (no action); `false` → `'fix'` with the
 * matching action.
 */
export function greenfieldReadiness(report: GreenfieldReport): GreenfieldRow[] {
  return [
    row("framework", "Tiki framework installed", report.frameworkInstalled, "installFramework"),
    row("state", "State initialized", report.stateSeeded, "seedState"),
    row("gitRepo", "Git repository", report.isGitRepo, "gitInit"),
    row("remote", "GitHub remote", report.hasRemote, "createRemote", true),
    row("ghAuth", "GitHub CLI authenticated", report.ghAuthenticated, "ghAuthLogin", true),
    row("gitignore", ".gitignore present", report.hasGitignore, "createGitignore"),
  ];
}

/** Build a single row: pass when `ok`, otherwise a fix carrying the action. */
function row(
  id: string,
  label: string,
  ok: boolean,
  action: GreenfieldAction,
  handoff = false
): GreenfieldRow {
  if (ok) {
    return { id, label, status: "pass" };
  }
  const fix: GreenfieldRow = { id, label, status: "fix", action };
  if (handoff) {
    fix.handoff = true;
  }
  return fix;
}
