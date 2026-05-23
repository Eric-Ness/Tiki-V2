import { describe, expect, it } from "vitest";
import { isViewportAtBottom } from "../viewportSync";

describe("isViewportAtBottom", () => {
  it("is true when parked at the bottom (viewportY === baseY)", () => {
    expect(isViewportAtBottom(0, 0)).toBe(true);
    expect(isViewportAtBottom(42, 42)).toBe(true);
  });

  it("is false when scrolled up to read history (viewportY < baseY)", () => {
    expect(isViewportAtBottom(0, 5)).toBe(false);
    expect(isViewportAtBottom(98, 100)).toBe(false);
  });

  it("treats an over-shot viewportY as at-bottom (defensive >=)", () => {
    // viewportY can't legitimately exceed baseY, but a transient off-by-one
    // during a resize must not be read as 'scrolled up' (which would suppress
    // the re-pin and re-strand the bottom row — the #254 regression).
    expect(isViewportAtBottom(11, 10)).toBe(true);
  });
});
