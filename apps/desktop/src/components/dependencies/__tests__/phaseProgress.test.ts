import { describe, it, expect } from "vitest";
import {
  derivePhaseProgressFromPlan,
  type PhaseLike,
} from "../phaseProgress";

function phases(...statuses: string[]): PhaseLike[] {
  return statuses.map((status) => ({ status }));
}

describe("derivePhaseProgressFromPlan", () => {
  it("returns undefined for undefined phases", () => {
    expect(derivePhaseProgressFromPlan(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty array (no plan -> no indicator)", () => {
    expect(derivePhaseProgressFromPlan([])).toBeUndefined();
  });

  it("counts zero current when all phases are pending", () => {
    expect(
      derivePhaseProgressFromPlan(phases("pending", "pending", "pending")),
    ).toEqual({ current: 0, total: 3 });
  });

  it("counts completed phases as current", () => {
    expect(
      derivePhaseProgressFromPlan(
        phases("completed", "completed", "pending", "executing"),
      ),
    ).toEqual({ current: 2, total: 4 });
  });

  it("counts both completed and skipped phases as current", () => {
    expect(
      derivePhaseProgressFromPlan(
        phases("completed", "skipped", "completed", "pending"),
      ),
    ).toEqual({ current: 3, total: 4 });
  });

  it("counts all phases as current when all are completed", () => {
    expect(
      derivePhaseProgressFromPlan(phases("completed", "completed")),
    ).toEqual({ current: 2, total: 2 });
  });

  it("handles a single-phase plan that is all pending (0/1)", () => {
    expect(derivePhaseProgressFromPlan(phases("pending"))).toEqual({
      current: 0,
      total: 1,
    });
  });

  it("handles a single-phase plan that is completed (1/1)", () => {
    expect(derivePhaseProgressFromPlan(phases("completed"))).toEqual({
      current: 1,
      total: 1,
    });
  });

  it("does not count a failed phase as current", () => {
    expect(
      derivePhaseProgressFromPlan(phases("completed", "failed", "pending")),
    ).toEqual({ current: 1, total: 3 });
  });
});
