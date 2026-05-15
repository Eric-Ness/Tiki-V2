import { describe, it, expect } from "vitest";
import { deriveSummaryRows } from "../detail/PhaseSummaries";
import type { EditorPlan } from "../detail/PlanEditor";

function mkPlan(overrides: Partial<EditorPlan> = {}): EditorPlan {
  return {
    schemaVersion: 1,
    issue: { number: 1, title: "X" },
    createdAt: "2026-05-15T00:00:00Z",
    successCriteria: [],
    phases: [],
    coverageMatrix: {},
    ...overrides,
  };
}

describe("deriveSummaryRows", () => {
  it("returns empty array when plan is null", () => {
    expect(deriveSummaryRows(null)).toEqual([]);
  });

  it("filters out phases without a summary", () => {
    const plan = mkPlan({
      phases: [
        {
          number: 1,
          title: "A",
          status: "completed",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
          summary: "done",
        },
        {
          number: 2,
          title: "B",
          status: "pending",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
        },
        {
          number: 3,
          title: "C",
          status: "completed",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
          summary: "   ", // whitespace-only
        },
      ],
    });
    const rows = deriveSummaryRows(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe(1);
  });

  it("sorts by phase number ascending", () => {
    const plan = mkPlan({
      phases: [
        {
          number: 3,
          title: "C",
          status: "completed",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
          summary: "three",
        },
        {
          number: 1,
          title: "A",
          status: "completed",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
          summary: "one",
        },
        {
          number: 2,
          title: "B",
          status: "completed",
          content: "",
          verification: [],
          files: [],
          addressesCriteria: [],
          dependencies: [],
          summary: "two",
        },
      ],
    });
    const rows = deriveSummaryRows(plan);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });
});
