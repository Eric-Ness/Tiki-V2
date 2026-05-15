import { describe, expect, it } from "vitest";
import {
  formatReset,
  severityFor,
  type RateLimitStatus,
} from "../RateLimitIndicator";

function mkStatus(coreRemaining: number, coreLimit: number): RateLimitStatus {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  return {
    core: { limit: coreLimit, used: coreLimit - coreRemaining, remaining: coreRemaining, reset },
    search: { limit: 30, used: 0, remaining: 30, reset },
    graphql: { limit: 5000, used: 100, remaining: 4900, reset },
    fetchedAtEpoch: Math.floor(Date.now() / 1000),
  };
}

describe("RateLimitIndicator", () => {
  it("classifies a healthy core bucket (>=50% remaining) and renders the GH: <remaining>/<limit> contract", () => {
    const status = mkStatus(4500, 5000);
    expect(severityFor(status.core.remaining, status.core.limit)).toBe("healthy");
    const labelText = `GH: ${status.core.remaining}/${status.core.limit}`;
    expect(labelText).toBe("GH: 4500/5000");
  });

  it("classifies a critical core bucket when remaining < 10% of the limit", () => {
    const status = mkStatus(100, 5000);
    expect(severityFor(status.core.remaining, status.core.limit)).toBe("critical");
    expect(severityFor(499, 5000)).toBe("critical");
    expect(severityFor(500, 5000)).toBe("warn");
    expect(severityFor(2499, 5000)).toBe("warn");
    expect(severityFor(2500, 5000)).toBe("healthy");
  });

  it("formats reset times for all three buckets in the tooltip's `remaining/limit · resets in Xh Ym` shape", () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const in45min = Math.floor(now / 1000) + 45 * 60;
    const in2h30m = Math.floor(now / 1000) + (2 * 60 + 30) * 60;
    const inPast = Math.floor(now / 1000) - 60;

    expect(formatReset(in45min, now)).toBe("resets in 45m");
    expect(formatReset(in2h30m, now)).toBe("resets in 2h 30m");
    expect(formatReset(Math.floor(now / 1000) + 3 * 3600, now)).toBe("resets in 3h");
    expect(formatReset(inPast, now)).toBe("resetting now");

    const status = mkStatus(4500, 5000);
    const coreLine = `${status.core.remaining}/${status.core.limit} · ${formatReset(status.core.reset)}`;
    const searchLine = `${status.search.remaining}/${status.search.limit} · ${formatReset(status.search.reset)}`;
    const graphqlLine = `${status.graphql.remaining}/${status.graphql.limit} · ${formatReset(status.graphql.reset)}`;
    expect(coreLine).toMatch(/^4500\/5000 · resets in /);
    expect(searchLine).toMatch(/^30\/30 · resets in /);
    expect(graphqlLine).toMatch(/^4900\/5000 · resets in /);
  });
});
