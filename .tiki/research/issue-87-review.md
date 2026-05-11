---
topic: terminal-search-addon-wireup
tags: [terminal, xterm, frontend, ux, keyboard]
issues: [87]
created: 2026-05-11T19:35:00.000Z
---

# Issue #87 Review: Terminal Search (Find in Buffer)

## 1. Success Criteria

**Search bar appearance and location**
- Absolute-positioned overlay anchored to the top-right of the active `.terminal-split-leaf` (scoped to that terminal instance, not global).
- Contains: text input, Previous match button (up-arrow), Next match button (down-arrow), match count label ("3 of 12" / "No results"), X close button.

**Keyboard bindings**
- Ctrl+F (while terminal is focused) opens the bar and focuses the input.
- Escape (while input is focused) closes the bar and returns focus to xterm.
- Enter advances to next match; Shift+Enter to previous.
- F3 / Shift+F3 mirror Enter / Shift+Enter when bar is open.

**Search behavior**
- Case-insensitive by default.
- Search-as-you-type (with ~150ms debounce for large scrollback).
- Empty query → no highlights, empty count.
- No matches → "No results" label, no-match visual state on input.
- Searches full scrollback, not just viewport.

**Multiple terminals**
- Each `Terminal` component owns its own `SearchAddon` ref and `isSearchOpen` state.
- Split panes / tabs are independently scoped via local state inside `Terminal.tsx`.

**Edge cases**
- Empty scrollback handled gracefully.
- 10,000+ line scrollback handled by incremental search in the addon.

---

## 2. Current State Survey

### Terminal component location

Files under `apps/desktop/src/components/terminal/`:
- `TerminalPane.tsx` → tab management
- `TerminalTabs.tsx` → tab bar
- `TerminalSplit.tsx` → recursive split tree renderer
- `Terminal.tsx` → leaf component owning one xterm.js instance
- `useTerminal.ts` → PTY IPC hook

**Where the xterm instance is created:** `Terminal.tsx` line 193 inside a `requestAnimationFrame` callback within the initialization `useEffect`.

**Currently loaded addons (line 204–205):**
```ts
xterm.loadAddon(fitAddon);      // FitAddon from @xterm/addon-fit
xterm.loadAddon(webLinksAddon); // WebLinksAddon from @xterm/addon-web-links
```

Stored as refs: `xtermRef` (line 85), `fitAddonRef` (line 86). `searchAddonRef` follows the same pattern.

**Custom key event handler:** Lines 229–259 in `Terminal.tsx`. Currently intercepts Ctrl+Shift+C (copy), Ctrl+Shift+V/Ctrl+V (paste). All other keys pass through to the shell. Ctrl+F is currently sent as `\x06` to the shell.

### Existing xterm version

`apps/desktop/package.json` line 34: `"xterm": "^5.3.0"`. Note: `Terminal.tsx` imports `Terminal` from the unscoped `"xterm"` package while addons import from the scoped `@xterm/*` namespace. This is the standard v5 migration pattern.

Already-installed addons:
- `@xterm/addon-fit`: `^0.11.0`
- `@xterm/addon-web-links`: `^0.12.0`

Target install: `@xterm/addon-search@^0.15.0` (or `^0.16.0`) — same version tier as the working fit/web-links.

### Keyboard shortcut conflict analysis

Global `keydown` listeners:
| File | Handled keys |
|------|--------------|
| `App.tsx` (line 348) | Ctrl+K, Ctrl+/, Ctrl+1/2/3, Ctrl+, |
| `TerminalPane.tsx` (line 94) | Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+H, Ctrl+Shift+\ |
| `ContextMenu.tsx` (line 207) | Escape (close menus) |

**Ctrl+F is unclaimed.** No Tauri menu binding exists (`tauri.conf.json` has no `menu` section). Correct interception point: `attachCustomKeyEventHandler` in `Terminal.tsx` (return `false` for Ctrl+F).

### Multiple terminal tabs / splits

`TerminalStore` tracks `tabsByProject` and `activeTabByProject`. Each tab has a recursive `SplitTreeNode`. Each leaf renders one `<Terminal terminalId={...} />`. Search state and addon ref live inside `Terminal.tsx` → automatic per-leaf scoping.

### Theming and styling

Plain CSS with custom properties (CSS variables in `apps/desktop/src/index.css`). No Tailwind, no CSS Modules. Use:
- `var(--bg-secondary)`, `var(--bg-tertiary)`
- `var(--text-primary)`, `var(--text-secondary)`
- `var(--border-color)`

**Style reference:** `.terminal-split-controls` (`Terminal.css` lines 247–288) — absolute-positioned controls inside terminal leaf, `top: 4px; right: 4px; z-index: 10`. Search bar should use `z-index: 20` to layer above split controls. Use `position: absolute` inside `.terminal-container` (which is already `position: relative` at line 167 of `Terminal.css`).

---

## 3. Design Decisions Needed

**A. Search bar placement** → **Top-right overlay** (scoped to terminal leaf; matches VS Code/iTerm). Avoids `fitAddon.fit()` re-flow that a docked bar would trigger.

**B. F3 / Shift+F3** → **Yes, implement.** Familiar convention, no conflicts, minor addition to the custom key handler.

**C. Search-as-you-type vs. Enter** → **Search-as-you-type with 150ms debounce.** Matches browser Ctrl+F.

**D. Case-sensitive toggle / regex** → **Case-insensitive default + Aa toggle button.** Defer regex to follow-up issue (regex requires escaping when off, adds risk).

**E. Match count display** → **Separate label between input and arrows**, `var(--text-secondary)` 11px. Matches DevTools conventions.

**F. Focus handling** → Search open: focus input. Search close: call `xtermRef.current?.focus()` to restore.

---

## 4. Touch List

### New files
- `apps/desktop/src/components/terminal/TerminalSearch.tsx` — search bar React component
- `apps/desktop/src/components/terminal/TerminalSearch.css` — styling
- `apps/desktop/src/components/terminal/__tests__/terminalSearch.test.ts` — unit tests for pure helpers

### Modified files
- `apps/desktop/src/components/terminal/Terminal.tsx`
  - Import `SearchAddon` from `@xterm/addon-search`
  - Add `searchAddonRef` ref and `isSearchOpen` state
  - Instantiate + load addon in init `useEffect`
  - Intercept Ctrl+F (and F3) in `attachCustomKeyEventHandler`; return `false`
  - Render `<TerminalSearch>` inside `.terminal-container` when open
- `apps/desktop/package.json` — add `"@xterm/addon-search": "^0.15.0"` to dependencies
- `apps/desktop/src/components/ui/KeyboardShortcuts.tsx` — add Ctrl+F to Terminal group (lines 38–45)

### Type additions
None — `SearchAddon` types are self-contained.

---

## 5. Risk Register

**R1 — Ctrl+F conflict with browser/Tauri:** No native binding exists. Intercept inside xterm's `attachCustomKeyEventHandler` (return `false`). **Low risk.**

**R2 — Terminal focus loss:** Mitigated by calling `xtermRef.current?.focus()` on close. **Low risk.**

**R3 — xterm v5 vs. addon major:** Already working pattern (fit, web-links). `@xterm/addon-search@^0.15.0` follows same tier. **Low risk.**

**R4 — Performance on long scrollback:** Addon uses incremental canvas-decoration search. Debounce `onChange` at 150ms. **Medium risk** for very long sessions; acceptable.

**R5 — Per-pane search state:** Mitigated by local state in `Terminal.tsx`. Only a risk if implementation goes global.

**R6 — Layout reflow:** Eliminated by overlay design (Section 3-A).

**R7 — Mixed-namespace imports:** Existing pattern is stable. **No risk.**

---

## 6. Open Questions for PLAN

**OQ1 — Case-sensitive toggle in initial scope?** Recommend yes (small surface area).

**OQ2 — F3 / Shift+F3 bindings approved?** Recommend yes (no conflicts; standard convention).

**OQ3 — Debounce default 150ms or wait for measured perf issue?** Recommend ship with debounce included from day 1.

**OQ4 — Use framer-motion for open/close animation?** Recommend plain CSS show/hide for speed; can polish later.

**OQ5 — Update `KeyboardShortcuts.tsx` panel in this issue or separately?** Recommend bundle here — it's a one-line addition.
