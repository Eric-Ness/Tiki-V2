/**
 * Terminal viewport-sync helpers (#254).
 *
 * The desktop terminal could leave its bottom row (the shell/Claude Code input
 * prompt) painted *below* the visible viewport after output settled — only a
 * keystroke would snap it back. Root cause: the output path writes to xterm but
 * never re-pins the viewport to the bottom, whereas xterm's `scrollOnUserInput`
 * (default true) does on every keystroke. This module holds the small, pure
 * decision logic so it can be unit-tested without a live xterm/WebView.
 */

/**
 * True when the viewport is parked at the buffer's bottom (no scrollback
 * offset), i.e. the user is NOT scrolled up reading history.
 *
 * `viewportY` is the buffer line at the top of the viewport; `baseY` is the top
 * line of the bottom-most screen. They are equal when pinned to the bottom. We
 * use `>=` defensively — `viewportY` can never legitimately exceed `baseY`, but
 * a `>=` comparison can't be tripped by a transient off-by-one during a resize.
 */
export function isViewportAtBottom(viewportY: number, baseY: number): boolean {
  return viewportY >= baseY;
}
