---
topic: desktop-performance
tags: [performance, desktop, bundle, terminal, react, zustand]
issues: [263, 264]
created: 2026-05-25T00:00:00.000Z
---

# Desktop performance investigation (2026-05-25)

Five sub-agents profiled the Tauri desktop for sluggishness; findings were then
**verified against the code** by the parent. Many "render storm" claims did NOT
survive verification — recorded here so they aren't re-chased.

## REJECTED claims (verified false / overstated)

- **`getActiveProject()` selector causes a re-render storm** — FALSE. `projectsStore.ts:87` returns `projects.find(...)`, the existing array element = a **stable reference**. Zustand re-renders only on `Object.is` change of the return value. `projectsStore` only mutates on add/remove/switch/framework-stamp (rare user actions), and is a *separate* store from the watcher-driven `tikiStateStore`. Not a hot path.
- **3 separate Zustand `set()` in `syncTikiStateStore` = 3× renders** — OVERSTATED. React **19.2** (`apps/desktop/package.json`) auto-batches; the 3 sets collapse to ~1 render even in the async watcher callback. Batching is a micro-win only.
- **`IssuesSection` `visibleIssueNumbers` "1-line memo fix"** — INEFFECTIVE alone. `IssueCard`'s `memo` is *also* broken by an inline `onClick={() => …}` arrow and a fresh `workProgress` object per card (`IssuesSection.tsx:355-367`). Fixing only the array yields nothing; restoring memo needs all three stabilized.
- **`manualChunks` alone = faster startup** — MARGINAL for Tauri (loads from local disk, no network). The real cold-start win is deferring *eval* via `React.lazy` + a first-visit render gate, not just splitting.

## CONFIRMED real bottlenecks

### #263 — cold start / bundle
- `apps/desktop/vite.config.ts` is bare (`{ plugins: [react()] }`): no `manualChunks`, no `React.lazy` anywhere. Single ~1.5MB chunk; Vite warns >500KB.
- `App.tsx` eagerly imports ReactFlow+dagre, xterm, framer-motion, the `detail/` barrel (react-markdown + rehype-highlight + highlight.js), dnd-kit, Settings, DependencyGraph.
- **All 4 views are always mounted** and toggled via a `hidden` CSS class (`App.tsx:367-385`, `activeView` from `useLayoutStore`). So `React.lazy` alone won't defer them — a hidden-but-mounted view still pulls its chunk. **Fix = `React.lazy` + render `null` until the view is first visited** (terminal MUST stay always-mounted to keep PTYs alive). Also `React.lazy` the detail `MarkdownRenderer` (loads only when a markdown detail opens). Add `manualChunks` for vendor splitting on top.

### #264 — terminal latency
- **Per-terminal global listener**: each `useTerminal` (`useTerminal.ts:64`) calls `listen("terminal-output", …)` filtering by id → N terminals = N wake-ups per output event. Fix: one app-level listener dispatching to `Map<id, cb>`.
- **PTY reader sleep floor**: `terminal/pty.rs` (~line 350) sleeps 10ms on `WouldBlock`; flush interval also 10ms → up to ~10ms echo delay (perceptible for fast typists). Fix: shorter sleep / poll, guard against CPU spin.
- **Per-keystroke `invoke("write_terminal")`** (`useTerminal.ts:106`): minor (paste already batched); optional micro-batch. Rust output side already coalesces 10ms/64KB.
- Success is interactive ("feels snappy") — needs hands-on `tauri:dev`, can't be fully auto-verified.

## Lower-priority real-but-marginal (deferred)
- Hot-path `console.log` in `useTikiFileSync.ts:63,70` + `App.tsx` loadState (fires per watcher event; `Object.keys(activeWork)` allocates). Cheap to strip; low impact.
- `check_release_json_parity` runs inside `load_tiki_releases` (`commands.rs:263`) on every `releaseChanged` (2 extra dir scans) — but releaseChanged is infrequent.
- `bumpDetailRefresh()` fires unconditionally on every `stateChanged` (`useTikiFileSync.ts:76`) → `get_plan` refetch for the open issue even when an unrelated issue changed. Gate to the open issue if pursued.

## Method note
Sub-agents are excellent at LOCATING patterns but their perf conclusions hinged on framework specifics (Zustand `Object.is` on return values, React 19 auto-batching, `.find()` ref stability) that flip the verdict. **Verify each claim against the code before fixing.**
