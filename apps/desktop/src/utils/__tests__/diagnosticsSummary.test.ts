import { describe, it, expect } from "vitest";
import {
  diagnosticsSummary,
  type DiagnosticsReport,
} from "../diagnosticsSummary";

/** A fully healthy report; tests override single fields to isolate each rule. */
function cleanReport(overrides: Partial<DiagnosticsReport> = {}): DiagnosticsReport {
  return {
    frameworkVersion: "0.9.0",
    stateValid: true,
    schemaVersion: 1,
    activeWorkCount: 0,
    releaseChecks: [
      { version: "v0.9.0", location: "active", status: "active", archivedButActive: false },
    ],
    recentReleasesMissingJson: [],
    reconcilerHookInstalled: true,
    unresolvedScriptPaths: [],
    copyInstallDetected: true,
    unverifiedShippedCriteria: [],
    staleActivePlans: [],
    ...overrides,
  };
}

describe("diagnosticsSummary", () => {
  it("returns 'healthy' for a fully clean report", () => {
    const s = diagnosticsSummary(cleanReport());
    expect(s.status).toBe("healthy");
    expect(s.findings.some((f) => f.level === "warn")).toBe(false);
  });

  it("stays 'healthy' when the ONLY anomaly is archivedButActive (regression guard)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        releaseChecks: [
          { version: "v0.8.2", location: "archive", status: "active", archivedButActive: true },
          { version: "v0.8.1", location: "archive", status: "active", archivedButActive: true },
        ],
      })
    );
    expect(s.status).toBe("healthy");
    // ...and it is surfaced as an informational finding, not a warning.
    const info = s.findings.find((f) => f.level === "info" && f.message.includes("archived"));
    expect(info).toBeDefined();
    expect(info?.message).toContain("2");
  });

  it("marks archivedButActive>0 as an actionable (fixable) finding while staying healthy (#276)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        releaseChecks: [
          { version: "v0.8.2", location: "archive", status: "active", archivedButActive: true },
        ],
      })
    );
    // Cosmetic residue must NOT flip the top-level status.
    expect(s.status).toBe("healthy");
    const finding = s.findings.find((f) => f.action === "normalizeArchivedReleases");
    expect(finding).toBeDefined();
    expect(finding?.level).toBe("info");
    expect(finding?.message).toContain("1");
    expect(finding?.message).toContain("Normalize");
  });

  it("has no actionable normalize finding when archivedButActive count is 0 (#276)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        releaseChecks: [
          { version: "v0.9.0", location: "archive", status: "shipped", archivedButActive: false },
        ],
      })
    );
    expect(s.findings.some((f) => f.action === "normalizeArchivedReleases")).toBe(false);
  });

  it("returns 'warnings' when recentReleasesMissingJson is non-empty", () => {
    const s = diagnosticsSummary(
      cleanReport({ recentReleasesMissingJson: ["v0.7.8", "v0.6.7"] })
    );
    expect(s.status).toBe("warnings");
    const warn = s.findings.find((f) => f.level === "warn" && f.message.includes("definition file"));
    expect(warn?.message).toContain("v0.7.8");
  });

  it("returns 'warnings' when the reconciler hook is absent on a copy install (regression pin)", () => {
    const s = diagnosticsSummary(
      cleanReport({ reconcilerHookInstalled: false, copyInstallDetected: true })
    );
    expect(s.status).toBe("warnings");
    expect(s.findings.some((f) => f.level === "warn" && f.message.includes("Reconciler"))).toBe(true);
  });

  it("stays 'healthy' when the hook is absent on a plugin-only install (#268 channel-aware)", () => {
    const s = diagnosticsSummary(
      cleanReport({ reconcilerHookInstalled: false, copyInstallDetected: false })
    );
    expect(s.status).toBe("healthy");
    const info = s.findings.find((f) => f.level === "info" && f.message.includes("Reconciler"));
    expect(info).toBeDefined();
    expect(info?.message).toContain("plugin");
  });

  it("returns 'warnings' when unresolvedScriptPaths is non-empty, listing each path (#268)", () => {
    const paths = [".claude/tiki/scripts/reconcile-state.mjs", ".claude/tiki/scripts/state.mjs"];
    const s = diagnosticsSummary(cleanReport({ unresolvedScriptPaths: paths }));
    expect(s.status).toBe("warnings");
    const warn = s.findings.find((f) => f.level === "warn" && f.message.includes("framework script"));
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("2");
    for (const p of paths) {
      expect(warn?.message).toContain(p);
    }
    // Remedy hint is part of the message.
    expect(warn?.message).toContain("restart the session");
  });

  it("surfaces a 'Framework scripts resolvable' pass when unresolvedScriptPaths is empty (#268)", () => {
    const s = diagnosticsSummary(cleanReport({ unresolvedScriptPaths: [] }));
    expect(s.status).toBe("healthy");
    expect(
      s.findings.some((f) => f.level === "pass" && f.message === "Framework scripts resolvable")
    ).toBe(true);
  });

  it("adds an info finding for unverified visual SCs but stays 'healthy' (#281)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        unverifiedShippedCriteria: [
          { issue: 263, id: "SC4", description: "the badge renders correctly" },
          { issue: 266, id: "SC2", description: "graph auto-frames on populate" },
        ],
      })
    );
    // A checklist must never flip the top-level status.
    expect(s.status).toBe("healthy");
    const info = s.findings.find(
      (f) => f.level === "info" && f.message.includes("await verification")
    );
    expect(info).toBeDefined();
    expect(info?.message).toContain("2");
  });

  it("has no pending visual-SC finding when the list is empty (#281)", () => {
    const s = diagnosticsSummary(cleanReport({ unverifiedShippedCriteria: [] }));
    expect(s.findings.some((f) => f.message.includes("await verification"))).toBe(false);
  });

  it("flags an active-location def with a finished status as warn + Fix action (#301)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        releaseChecks: [
          { version: "v0.2.15", location: "active", status: "completed", archivedButActive: false },
          { version: "v1.0.1", location: "active", status: "active", archivedButActive: false },
        ],
      })
    );
    // Genuine drift — unlike archivedButActive, this DOES flip the status.
    expect(s.status).toBe("warnings");
    const warn = s.findings.find((f) => f.action === "archiveStaleReleaseDefs");
    expect(warn).toBeDefined();
    expect(warn?.level).toBe("warn");
    expect(warn?.message).toContain("1");
    expect(warn?.message).toContain("v0.2.15");
    // The live active-status def is NOT named in the finding.
    expect(warn?.message).not.toContain("v1.0.1");
  });

  it("does not flag archived rows or active-status active-location defs (#301 healthy case)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        releaseChecks: [
          // Healthy live release.
          { version: "v1.0.1", location: "active", status: "active", archivedButActive: false },
          // Archived rows — whatever their status, rule A never fires on them.
          { version: "v0.9.0", location: "archive", status: "shipped", archivedButActive: false },
          { version: "v0.8.0", location: "archive", status: "completed", archivedButActive: false },
        ],
      })
    );
    expect(s.status).toBe("healthy");
    expect(s.findings.some((f) => f.action === "archiveStaleReleaseDefs")).toBe(false);
  });

  it("flags staleActivePlans as warn + Fix action listing the issues (#301)", () => {
    const s = diagnosticsSummary(
      cleanReport({
        staleActivePlans: [
          { issue: 104, planPath: "plans/issue-104.json", newestTimestamp: "2026-01-10T00:00:00Z" },
          { issue: 107, planPath: "plans/issue-107.json", newestTimestamp: null },
        ],
      })
    );
    expect(s.status).toBe("warnings");
    const warn = s.findings.find((f) => f.action === "archiveStalePlans");
    expect(warn).toBeDefined();
    expect(warn?.level).toBe("warn");
    expect(warn?.message).toContain("2");
    expect(warn?.message).toContain("#104");
    expect(warn?.message).toContain("#107");
  });

  it("has no stale-plan finding when staleActivePlans is empty (#301 healthy case)", () => {
    const s = diagnosticsSummary(cleanReport({ staleActivePlans: [] }));
    expect(s.status).toBe("healthy");
    expect(s.findings.some((f) => f.action === "archiveStalePlans")).toBe(false);
  });

  it("returns 'warnings' when state.json is invalid", () => {
    const s = diagnosticsSummary(cleanReport({ stateValid: false }));
    expect(s.status).toBe("warnings");
    expect(s.findings.some((f) => f.level === "warn" && f.message.includes("state.json"))).toBe(true);
  });

  it("orders findings warnings → info → pass", () => {
    const s = diagnosticsSummary(
      cleanReport({
        reconcilerHookInstalled: false,
        releaseChecks: [
          { version: "v0.8.2", location: "archive", status: "active", archivedButActive: true },
        ],
      })
    );
    const levels = s.findings.map((f) => f.level);
    const firstPass = levels.indexOf("pass");
    const lastWarn = levels.lastIndexOf("warn");
    expect(lastWarn).toBeLessThan(firstPass);
  });
});
