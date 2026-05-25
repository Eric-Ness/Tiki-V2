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
 * genuine drift — invalid state, history↔JSON parity gaps, or a missing reconciler
 * hook. `archivedButActive` is the NORMAL resting state for every shipped release
 * (the ship teardown moves a release into archive/ without flipping `status`;
 * #259 made the file location, not `status`, the source of truth), so it is
 * surfaced as a neutral `info` finding and must never, on its own, make the panel
 * report warnings.
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
}

/** Severity of a single finding row in the panel. */
export type FindingLevel = "pass" | "warn" | "info";

export interface Finding {
  level: FindingLevel;
  message: string;
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

  const missing = report.recentReleasesMissingJson;
  if (missing.length > 0) {
    warnings.push({
      level: "warn",
      message: `${missing.length} release(s) in history have no definition file: ${missing.join(", ")}`,
    });
  } else {
    passes.push({ level: "pass", message: "All recent releases have a definition file" });
  }

  if (!report.reconcilerHookInstalled) {
    warnings.push({ level: "warn", message: "Reconciler hook not installed" });
  } else {
    passes.push({ level: "pass", message: "Reconciler hook installed" });
  }

  // --- Informational (never flips status) ---
  const archivedButActive = report.releaseChecks.filter((c) => c.archivedButActive).length;
  if (archivedButActive > 0) {
    infos.push({
      level: "info",
      message: `${archivedButActive} archived release(s) retain an "active" status (expected)`,
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
