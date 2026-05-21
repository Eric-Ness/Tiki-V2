import { describe, it, expect } from "vitest";
import {
  deriveCriteriaChecklist,
  criteriaChecklistProgress,
  type ChecklistPlanLike,
} from "../criteriaVerification";

function mkPlan(overrides: Partial<ChecklistPlanLike> = {}): ChecklistPlanLike {
  return {
    successCriteria: [],
    phases: [],
    coverageMatrix: {},
    ...overrides,
  };
}

describe("deriveCriteriaChecklist", () => {
  it("returns [] for a null plan", () => {
    expect(deriveCriteriaChecklist(null)).toEqual([]);
  });

  it("marks a criterion verified when all covering phases are completed", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "works" }],
      phases: [
        { number: 1, status: "completed" },
        { number: 2, status: "completed" },
      ],
      coverageMatrix: { SC1: [1, 2] },
    });
    const rows = deriveCriteriaChecklist(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(true);
    expect(rows[0].coveringPhases).toEqual([1, 2]);
  });

  it("leaves a criterion unverified on partial completion", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "works" }],
      phases: [
        { number: 1, status: "completed" },
        { number: 2, status: "executing" },
      ],
      coverageMatrix: { SC1: [1, 2] },
    });
    expect(deriveCriteriaChecklist(plan)[0].verified).toBe(false);
  });

  it("leaves a criterion unverified when absent from the coverage matrix", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "uncovered" }],
      phases: [{ number: 1, status: "completed" }],
      coverageMatrix: {},
    });
    const rows = deriveCriteriaChecklist(plan);
    expect(rows[0].verified).toBe(false);
    expect(rows[0].coveringPhases).toEqual([]);
  });

  it("leaves a criterion unverified when its coverage entry is empty", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "empty coverage" }],
      phases: [{ number: 1, status: "completed" }],
      coverageMatrix: { SC1: [] },
    });
    expect(deriveCriteriaChecklist(plan)[0].verified).toBe(false);
  });

  it("does not count skipped phases as completed", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "x" }],
      phases: [{ number: 1, status: "skipped" }],
      coverageMatrix: { SC1: [1] },
    });
    expect(deriveCriteriaChecklist(plan)[0].verified).toBe(false);
  });

  it("does not verify when a covering phase number is missing from phases", () => {
    const plan = mkPlan({
      successCriteria: [{ id: "SC1", description: "x" }],
      phases: [{ number: 1, status: "completed" }],
      coverageMatrix: { SC1: [1, 2] },
    });
    expect(deriveCriteriaChecklist(plan)[0].verified).toBe(false);
  });
});

describe("criteriaChecklistProgress", () => {
  it("counts verified vs total", () => {
    const plan = mkPlan({
      successCriteria: [
        { id: "SC1", description: "a" },
        { id: "SC2", description: "b" },
        { id: "SC3", description: "c" },
      ],
      phases: [
        { number: 1, status: "completed" },
        { number: 2, status: "completed" },
        { number: 3, status: "pending" },
      ],
      coverageMatrix: { SC1: [1], SC2: [2], SC3: [3] },
    });
    expect(criteriaChecklistProgress(plan)).toEqual({ verified: 2, total: 3 });
  });

  it("returns 0/0 for null", () => {
    expect(criteriaChecklistProgress(null)).toEqual({ verified: 0, total: 0 });
  });
});
