import { describe, expect, it } from "vitest";
import { formatMatchCount, isNoMatch } from "../TerminalSearch";

describe("formatMatchCount", () => {
  it("returns empty string for empty query", () => {
    expect(formatMatchCount(false, "")).toBe("");
    expect(formatMatchCount(true, "")).toBe("");
  });

  it("returns empty string for whitespace-only query", () => {
    expect(formatMatchCount(false, "   ")).toBe("");
    expect(formatMatchCount(true, "\t\n ")).toBe("");
  });

  it("returns 'No results' when query is non-empty and not found", () => {
    expect(formatMatchCount(false, "error")).toBe("No results");
  });

  it("returns 'Match found' when found is true", () => {
    expect(formatMatchCount(true, "error")).toBe("Match found");
  });
});

describe("isNoMatch", () => {
  it("returns false for empty query regardless of found", () => {
    expect(isNoMatch(true, "")).toBe(false);
    expect(isNoMatch(false, "")).toBe(false);
  });

  it("returns false for whitespace-only query", () => {
    expect(isNoMatch(false, "   ")).toBe(false);
    expect(isNoMatch(false, "\t\n")).toBe(false);
  });

  it("returns false when found is true", () => {
    expect(isNoMatch(true, "error")).toBe(false);
  });

  it("returns true when query is non-empty and not found", () => {
    expect(isNoMatch(false, "error")).toBe(true);
  });
});
