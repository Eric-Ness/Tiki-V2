/**
 * Reduce a `tiki_doctor` DiagnosticsReport to a top-level health status and a
 * list of human-readable findings for the Settings → Diagnostics panel (#262).
 *
 * The `DiagnosticsReport` / `ReleaseCheck` types are LOCAL MIRRORS of the Rust
 * structs in `apps/desktop/src-tauri/src/state.rs` (camelCase serde). The desktop
 * does not import `@tiki/shared` at runtime, so the shape is replicated here and
 * unit-tested. Keep the two in sync — a field name drift means the panel silently
 * reads `undefined`.
 *
 * Health rule (decided in #262 review): the panel shows "warnings" ONLY for
 * genuine drift — invalid state, history↔JSON parity gaps, unresolved framework
 * script paths, or a missing reconciler hook on a copy install. `archivedButActive`
 * is the NORMAL resting state for every shipped release (the ship teardown moves a
 * release into archive/ without flipping `status`; #259 made the file location, not
 * `status`, the source of truth), so it is surfaced as a neutral `info` finding and
 * must never, on its own, make the panel report warnings.
 *
 * #268 added two mirrored fields: `unresolvedScriptPaths` (framework scripts that
 * command bodies need but that don't exist on disk — the authoritative
 * install-health signal) and `copyInstallDetected` (whether `.claude/commands/tiki/`
 * exists). The reconciler-hook finding is CHANNEL-AWARE: a missing settings.json
 * hook is only a warning on a copy install; on a plugin-only install the plugin's
 * own hooks.json delivers the reconciler (the doctor cannot inspect plugin config),
 * so it is downgraded to `info`.
 *
 * #281 added the mirrored field `unverifiedShippedCriteria` — shipped success
 * criteria left `verified:false` that match the visual/manual heuristic (computed
 * in Rust; the frontend only renders them and adds a neutral `info` checklist
 * finding, never re-deriving visual-ness or flipping the top-level status).
 *
 * #301 added two GENUINE-drift rules (both `warn`, both with a Fix action):
 * a release def still in the active location whose own status says it finished
 * (`location === "active" && status !== "active"` — the REVERSE of the benign
 * `archivedButActive` residue), and the mirrored `staleActivePlans` field —
 * active-location plan files whose issue already finished per history (computed
 * in Rust with the activeWork exclusions; the frontend only renders them).
 */

/** One release file's consistency check — mirrors Rust `ReleaseCheck`. */
export interface ReleaseCheck {
  version: string;
  location: "active" | "archive";
  status: string;
  archivedButActive: boolean;
}

/** Read-only `.tiki/` health report — mirrors Rust `DiagnosticsReport`. */
export interface DiagnosticsReport {
  frameworkVersion: string | null;
  stateValid: boolean;
  schemaVersion: number | null;
  activeWorkCount: number;
  releaseChecks: ReleaseCheck[];
  recentReleasesMissingJson: string[];
  reconcilerHookInstalled: boolean;
  /**
   * Project-relative, forward-slash, sorted+deduped paths of framework scripts
   * that Tiki command bodies reference but that don't exist on disk (#268 —
   * e.g. `.claude/tiki/scripts/state.mjs` on a plugin-only install with no
   * bootstrap copy). Empty = healthy.
   */
  unresolvedScriptPaths: string[];
  /**
   * True iff `.claude/commands/tiki/` exists — marker for the copy-install
   * channel. False on plugin-only installs, where a missing settings.json
   * reconciler hook is expected (the plugin provides it).
   */
  copyInstallDetected: boolean;
  /**
   * Shipped success criteria left `verified:false` that match the visual/manual
   * heuristic, as computed by Rust `tiki_doctor` scanning archived plans (#281).
   * ALWAYS present (serde default + non-Option Vec → `[]` when empty, never
   * undefined), pre-sorted by (issue, id). The frontend only renders this list
   * and adds an `info` finding — it must NOT re-derive visual-ness. Empty = none
   * pending.
   */
  unverifiedShippedCriteria: { issue: number; id: string; description: string }[];
  /**
   * Active-location plan files (`plans/issue-N.json`) whose issue already
   * finished per `state.json` history, as computed by Rust `tiki_doctor`
   * (#301). Plans for issues currently in `activeWork` — live issues AND a
   * running release's children — are already excluded on the Rust side.
   * ALWAYS present (serde default + non-Option Vec → `[]` when empty), sorted
   * by issue. Empty = healthy.
   */
  staleActivePlans: { issue: number; planPath: string; newestTimestamp: string | null }[];
}

/** Severity of a single finding row in the panel. */
export type FindingLevel = "pass" | "warn" | "info";

export interface Finding {
  level: FindingLevel;
  message: string;
  /**
   * When set, the panel can render a Fix affordance (button) for this finding.
   * `'normalizeArchivedReleases'` (#276) rewrites stale-"active" archived release
   * defs to `status:"shipped"` via the `normalize_archived_releases` command —
   * cosmetic residue, so its finding stays `info`. The two #301 actions fix
   * GENUINE drift (their findings are `warn`): `'archiveStaleReleaseDefs'` moves
   * finished-status defs out of the active `releases/` location via
   * `archive_stale_release_defs`, and `'archiveStalePlans'` moves finished
   * issues' active plans into `plans/archive/` via `archive_stale_plans`.
   */
  action?: "normalizeArchivedReleases" | "archiveStaleReleaseDefs" | "archiveStalePlans";
}

export interface DiagnosticsSummary {
  /** "warnings" iff at least one finding is a `warn`; otherwise "healthy". */
  status: "healthy" | "warnings";
  findings: Finding[];
}

/**
 * Derive the panel summary from a report. Pure — no I/O, deterministic order:
 * warnings first (most actionable), then info, then passes.
 */
export function diagnosticsSummary(report: DiagnosticsReport): DiagnosticsSummary {
  const warnings: Finding[] = [];
  const infos: Finding[] = [];
  const passes: Finding[] = [];

  // --- Genuine drift → warnings ---
  if (!report.stateValid) {
    warnings.push({ level: "warn", message: "state.json is invalid or unreadable" });
  } else {
    passes.push({ level: "pass", message: "state.json is valid" });
  }

  // Widened by #301: the Rust check now also treats `releases/*-changelog.md`
  // stems as evidence a release shipped, so a changelog-only ghost (the v0.7.4
  // case — absent from history AND both def locations) lands here too.
  const missing = report.recentReleasesMissingJson;
  if (missing.length > 0) {
    warnings.push({
      level: "warn",
      message: `${missing.length} release(s) in history or with a changelog have no definition file: ${missing.join(", ")}`,
    });
  } else {
    passes.push({ level: "pass", message: "All recent releases have a definition file" });
  }

  // #301: a def still in the ACTIVE releases/ location whose own status says it
  // finished is genuine drift (the reverse of the benign archivedButActive
  // residue): the sidebar shows a live release that actually shipped. Fixable —
  // `archive_stale_release_defs` moves them into archive/.
  const staleDefs = report.releaseChecks.filter(
    (c) => c.location === "active" && c.status !== "active"
  );
  if (staleDefs.length > 0) {
    warnings.push({
      level: "warn",
      message: `${staleDefs.length} finished release def(s) still in the active releases/ location: ${staleDefs
        .map((c) => c.version)
        .join(", ")} — Fix moves them to archive/`,
      action: "archiveStaleReleaseDefs",
    });
  }

  // #301: an active-location plan whose issue already finished per history is
  // genuine drift (the class #300 found 118 of). Live work is already excluded
  // on the Rust side — anything here is safe to archive.
  const stalePlans = report.staleActivePlans;
  if (stalePlans.length > 0) {
    warnings.push({
      level: "warn",
      message: `${stalePlans.length} stale active plan(s) for finished issue(s): ${stalePlans
        .map((p) => `#${p.issue}`)
        .join(", ")} — Fix archives them`,
      action: "archiveStalePlans",
    });
  }

  const unresolved = report.unresolvedScriptPaths;
  if (unresolved.length > 0) {
    warnings.push({
      level: "warn",
      message: `${unresolved.length} framework script(s) missing: ${unresolved.join(", ")} — run the Tiki installer or restart the session (plugin installs bootstrap on SessionStart)`,
    });
  } else {
    passes.push({ level: "pass", message: "Framework scripts resolvable" });
  }

  // Channel-aware (#268): a missing settings.json hook is genuine drift only on a
  // copy install; plugin-only installs get the reconciler from the plugin's own
  // hooks.json, which the doctor cannot inspect.
  if (!report.reconcilerHookInstalled) {
    if (report.copyInstallDetected) {
      warnings.push({ level: "warn", message: "Reconciler hook not installed" });
    } else {
      infos.push({
        level: "info",
        message:
          "Reconciler hook not in .claude/settings.json (expected for plugin installs — the plugin provides it)",
      });
    }
  } else {
    passes.push({ level: "pass", message: "Reconciler hook installed" });
  }

  // --- Actionable residue (never flips status) ---
  // Stale-"active" archived release defs are cosmetic residue, not drift (location
  // is the source of truth since #259), so this stays an `info` and never makes the
  // panel report "warnings". When present, it carries a Fix affordance (#276): the
  // panel offers a "Normalize" button that runs `normalize_archived_releases`.
  const archivedButActive = report.releaseChecks.filter((c) => c.archivedButActive).length;
  if (archivedButActive > 0) {
    infos.push({
      level: "info",
      message: `${archivedButActive} archived release(s) carry a stale "active" status — Normalize to fix`,
      action: "normalizeArchivedReleases",
    });
  }

  // --- Pending visual-SC checklist (never flips status) ---
  // Shipped success criteria left verified:false that match the visual/manual
  // heuristic (#281). These are a checklist for the user to confirm in
  // tauri:dev/installer — purely informational, NEVER a warning.
  const unverifiedVisual = report.unverifiedShippedCriteria.length;
  if (unverifiedVisual > 0) {
    infos.push({
      level: "info",
      message: `${unverifiedVisual} shipped visual criterion(s) await verification`,
    });
  }

  // --- Neutral facts surfaced as passes ---
  if (report.frameworkVersion) {
    passes.push({ level: "pass", message: `Framework version ${report.frameworkVersion}` });
  } else {
    infos.push({ level: "info", message: "No .framework-version file" });
  }

  const findings = [...warnings, ...infos, ...passes];
  return {
    status: warnings.length > 0 ? "warnings" : "healthy",
    findings,
  };
}
