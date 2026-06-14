import { describe, it, expect } from "vitest";
import {
  greenfieldReadiness,
  type GreenfieldReport,
  type GreenfieldAction,
} from "../greenfieldReadiness";

/** A report with every check failing; tests override single fields to flip rows. */
function allFalse(overrides: Partial<GreenfieldReport> = {}): GreenfieldReport {
  return {
    frameworkInstalled: false,
    stateSeeded: false,
    isGitRepo: false,
    hasRemote: false,
    ghAuthenticated: false,
    hasGitignore: false,
    ...overrides,
  };
}

/** A report with every check passing. */
function allTrue(overrides: Partial<GreenfieldReport> = {}): GreenfieldReport {
  return {
    frameworkInstalled: true,
    stateSeeded: true,
    isGitRepo: true,
    hasRemote: true,
    ghAuthenticated: true,
    hasGitignore: true,
    ...overrides,
  };
}

/** Expected action per row id (one place to keep the mapping verified). */
const ACTION_BY_ID: Record<string, GreenfieldAction> = {
  framework: "installFramework",
  state: "seedState",
  gitRepo: "gitInit",
  remote: "createRemote",
  ghAuth: "ghAuthLogin",
  gitignore: "createGitignore",
};

const HANDOFF_IDS = ["remote", "ghAuth"];

describe("greenfieldReadiness", () => {
  it("maps an all-false report to 6 'fix' rows with the correct action each", () => {
    const rows = greenfieldReadiness(allFalse());
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.status).toBe("fix");
      expect(r.action).toBe(ACTION_BY_ID[r.id]);
    }
  });

  it("flags the two handoff rows (createRemote, ghAuthLogin) with handoff:true", () => {
    const rows = greenfieldReadiness(allFalse());
    const handoffRows = rows.filter((r) => r.handoff === true);
    expect(handoffRows.map((r) => r.action).sort()).toEqual(
      ["createRemote", "ghAuthLogin"].sort()
    );
    // Every non-handoff fix row must NOT carry handoff:true.
    for (const r of rows) {
      if (!HANDOFF_IDS.includes(r.id)) {
        expect(r.handoff).toBeUndefined();
      }
    }
  });

  it("preserves the fixed row order: framework, state, gitRepo, remote, ghAuth, gitignore", () => {
    const rows = greenfieldReadiness(allFalse());
    expect(rows.map((r) => r.id)).toEqual([
      "framework",
      "state",
      "gitRepo",
      "remote",
      "ghAuth",
      "gitignore",
    ]);
  });

  it("maps an all-true report to 6 'pass' rows with no action", () => {
    const rows = greenfieldReadiness(allTrue());
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.status).toBe("pass");
      expect(r.action).toBeUndefined();
      expect(r.handoff).toBeUndefined();
    }
  });

  it("splits a mixed report (framework+state pass, rest fix) correctly", () => {
    const rows = greenfieldReadiness(
      allFalse({ frameworkInstalled: true, stateSeeded: true })
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.framework.status).toBe("pass");
    expect(byId.framework.action).toBeUndefined();
    expect(byId.state.status).toBe("pass");
    expect(byId.state.action).toBeUndefined();

    expect(byId.gitRepo.status).toBe("fix");
    expect(byId.gitRepo.action).toBe("gitInit");
    expect(byId.remote.status).toBe("fix");
    expect(byId.remote.action).toBe("createRemote");
    expect(byId.remote.handoff).toBe(true);
    expect(byId.ghAuth.status).toBe("fix");
    expect(byId.ghAuth.action).toBe("ghAuthLogin");
    expect(byId.ghAuth.handoff).toBe(true);
    expect(byId.gitignore.status).toBe("fix");
    expect(byId.gitignore.action).toBe("createGitignore");
  });
});
