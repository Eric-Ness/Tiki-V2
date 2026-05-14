# Tiki Enhancement Ideas

**Captured:** 2026-05-11 (post v0.4.0 ship)
**Source:** Codebase deep-dive across four parallel exploration agents (frontend, Rust backend, framework, cross-cutting).
**Purpose:** Backlog of small-to-medium improvements that didn't make it into shipped releases or open GitHub issues yet. Each item is grounded in a real code observation and tagged with effort + surface.

Every item has a stable ID (`E1`, `E2`, …) so it can be referenced in conversation. Effort scale: **S** = ~1 phase / a few hours, **M** = 2–3 phases / half a day to a day, **L** = full release-sized feature.

These are *not* yet GitHub issues — they live here as a curated brainstorm until promoted. Open issues already on file (#93, #96, #97, #104, #106, #107, #110, #112, #113, #114) are intentionally not duplicated here.

---

## Already-open issues for reference (do not re-list)

| # | Title |
|---|---|
| #93 | Phase diff / change summary view |
| #96 | Batch operations on issues |
| #97 | Kanban card reordering within columns |
| #104 | Execution cost tracking per phase and issue |
| #106 | Execution history and audit log |
| #107 | Failure pattern analysis |
| #110 | GitHub API rate-limit handling |
| #112 | Project dashboard / overview |
| #113 | Cross-repository issue dependencies |
| #114 | Project templates for `.tiki/` initialization |

---

## 1. Desktop Frontend (React + TypeScript)

### Terminal

- ~~**E1. "Clear scrollback" in terminal tab context menu**~~ _(shipped v0.5.4 — #158, with Ctrl+Shift+K shortcut)_ — `TerminalTabs.tsx` lines 109–165 has Rename / Split Right / Split Down / Close but no clear-buffer. xterm exposes `xterm.clear()`. *Why:* during long EXECUTE runs the user has no UI action to wipe the buffer (shell `clear` only clears the viewport, not what TerminalSearch sees). *Effort:* S. *Surface:* `components/terminal/TerminalTabs.tsx`.

- **E2. Regex toggle in terminal search** (→ #173) — `TerminalSearch.tsx` ships with `Aa` case toggle in v0.4.0 but no regex. `SearchAddon.findNext` accepts `regex: true`. Workflow output has structured patterns (`Phase N/M`, `Error:`, `SHIP`) worth pattern-matching. *Why:* power-user muscle memory; the addon already supports it. *Effort:* S. *Surface:* `components/terminal/TerminalSearch.tsx`.

- **E3. Ctrl+= / Ctrl+- runtime font-size on the live terminal** (→ #174) — `SettingsPage.tsx` line 107 says "Terminal settings apply to new terminals only." xterm exposes `xterm.options.fontSize = n; fitAddon.fit()`. Hooking it from `attachCustomKeyEventHandler` (Terminal.tsx ~245) would apply instantly. *Why:* peer screen-share and laptop↔monitor switching currently requires a tab restart. *Effort:* S. *Surface:* `components/terminal/Terminal.tsx`.

- ~~**E4. PTY output chunk-coalescing (10ms window)**~~ _(superseded — shipped v0.5.4 as #157: PTY UTF-8 carryover + 10ms IPC coalescing)_ — `pty.rs:237–269` reads 4KB chunks and emits each as a separate Tauri event (UTF-8 lossy serialize). During `cargo build` / `pnpm install` the IPC channel saturates. Batch chunks into a `Vec<u8>` and flush on 10ms or size limit. *Why:* IPC pressure during heavy CLI output. *Effort:* M. *Surface:* `apps/desktop/src-tauri/src/terminal/pty.rs:237–269`.

### Sidebar / Active Work

- ~~**E5. Click a `WorkProgressCard` to open it in the detail panel**~~ _(shipped v0.4.1)_ — `WorkProgressCard.tsx` renders issue number/title (lines 127–134) but has no `onClick` wired to `useDetailStore.setSelectedIssue`. `IssueCard.tsx` already does this on click. *Why:* seeing "Phase 3/7" begs to be clicked; today nothing happens. *Effort:* S. *Surface:* `components/sidebar/WorkProgressCard.tsx`.

- **E6. "Last fetched N min ago" next to the Issues refresh button** — `IssuesSection.tsx` line 89 records `lastFetched` in the store but never surfaces it. Tiny `"2m ago"` label would surface data age. *Why:* after `/tiki:ship` the sidebar still shows "Open" until manual refresh — no hint about staleness. *Effort:* S. *Surface:* `components/sidebar/IssuesSection.tsx`, `stores/issuesStore.ts`.

- **E7. "Send to terminal" action button on each Active Work card** — `WorkProgressCard.tsx` has Pause/Reset/Remove, but to resume a paused issue users navigate to Terminal tab, find the right pane, and re-type `/tiki:execute <N>`. The `App.tsx:436` "Start Claude" button already uses the `invoke("write_terminal", ...)` pattern. One contextual button (current status → next step) saves the round-trip. *Why:* most common action after status-checking a card is "run the next step." *Effort:* S. *Surface:* `components/sidebar/WorkProgressCard.tsx`.

### Kanban

- ~~**E8. Per-column issue count badge**~~ _(already shipped — found at `KanbanColumn.tsx:42–50` during exploration)_ — `KanbanColumn.tsx` renders columns by title but no count. Data is in the `columns` array already. *Why:* "how many are in Execute vs Open" requires manual counting. *Effort:* S. *Surface:* `components/kanban/KanbanColumn.tsx`.

- ~~**E9. Column header turns red when any card in it has `failed` status**~~ _(shipped v0.4.1)_ — `KanbanBoard.tsx:151` routes `failed` into the Review column; card-level red badge exists but the column header looks normal. Failed work is the highest-priority signal. *Why:* time-sensitive failure indicator gets buried in a mixed-status column. *Effort:* S. *Surface:* `components/kanban/KanbanColumn.tsx`, `KanbanBoard.tsx`.

### Detail panel

- **E10. "Jump to terminal" button when an issue has active work** (→ #175) — `IssueDetail.tsx` shows the Pipeline Timeline but has no action to switch to the terminal pane running that issue. Requires storing a `workId → terminalId` association in `terminalStore`. *Why:* user opens an issue's plan to inspect, then wants live tail; today they hunt manually across tabs. *Effort:* M. *Surface:* `components/detail/IssueDetail.tsx`, `stores/terminalStore.ts`.

- **E11. Illustrated empty state for the detail panel** (→ #176) — `App.tsx:502–507` renders `<h3>Detail</h3><p>Select an issue...</p>` when nothing is selected. This is the first-open experience. A simple pipeline diagram + Ctrl+K hint would orient new users. *Why:* current empty state shows no workflow surface area or shortcut hints. *Effort:* S. *Surface:* `App.tsx:502–507`.

### Settings / Command palette / Recovery

- **E12. Show "stale" indicator on terminal tabs created before the last settings change** — Settings hint at line 107 is passive; users don't know which tabs need restarting. Store a `settingsVersion` and stamp tabs; mark older tabs with a small icon. *Why:* "why didn't my font change?" is a recurring confusion. *Effort:* M. *Surface:* `components/settings/SettingsPage.tsx`, `stores/terminalStore.ts`.

- ~~**E13. Command palette actions inherit selected-issue context**~~ _(shipped v0.4.1)_ — `useCommandActions.ts:143–163` registers `/tiki:get`, `/tiki:execute`, etc. as bare commands. When `selectedIssue` is set in `useDetailStore`, the palette should offer contextual variants: "Run tiki:execute on #42 (current issue)". `useDetailStore` is already imported, just not used here. *Why:* the natural mental model is "Ctrl+K applies to what I'm looking at." *Effort:* S. *Surface:* `hooks/useCommandActions.ts`.

- **E14. Recovery dialog: highlight the parse-failure line in the preview** (→ #177) — `StateRecoveryDialog.tsx:347–370` renders backup JSON in a `<pre>` tag. The error message at line 211 already contains line/column from serde, but the preview doesn't scroll-to or visually mark that location. Even line numbers + a yellow row highlight would dramatically help. *Why:* the whole point of preview is to spot the malformed line; dense monospace JSON without aid is sub-optimal. *Effort:* M. *Surface:* `components/recovery/StateRecoveryDialog.tsx`.

---

## 2. Desktop Backend (Rust + Tauri)

### File watcher

- **E15. Bump watcher debounce 50ms → 150–200ms** — `watcher.rs:129` debounces at 50ms. On Windows with antivirus hooks, slow renames during heavy execute phases can still fire duplicate events. Frontend reload is full-refresh anyway, so a longer debounce saves redundant IPC. *Why:* fewer IPC round-trips during active execution. *Effort:* S. *File:* `apps/desktop/src-tauri/src/watcher.rs:129`.

- **E16. Watch `.claude/commands/tiki/` for framework version drift** — `watcher.rs:55–60` only watches `.tiki/`. After `install_framework` writes to `.claude/commands/tiki/`, the UI's "framework out of date" banner only refreshes on app relaunch. Add a `FrameworkChanged` event variant + a sibling `Watcher::watch` call. *Why:* in-app framework update flow (#141) doesn't reflect itself live. *Effort:* S. *File:* `watcher.rs`, `commands.rs:install_framework`.

- **E17. Watch `.tiki/commands/` for project-custom command edits** — `process_event` in `watcher.rs` handles state/plans/releases/research but ignores `.tiki/commands/*.md` despite CLAUDE.md listing it as a first-class directory. Add a `CommandsChanged { filename: String }` variant. *Why:* enables future custom-commands UI panel; closes observability gap. *Effort:* S. *File:* `watcher.rs:200–255`.

### State & atomic writes

- ~~**E18. `atomic_write` should `fsync` the tmp file before rename**~~ _(shipped v0.4.1)_ — `fs_utils::atomic_write:68–78` writes tmp + rename, but never calls `File::sync_all()`. Power loss between write and rename can revert the file to pre-write state. One line fix; closes the durability window for state.json. *Why:* reliability for the single most critical write in the system. *Effort:* S. *File:* `apps/desktop/src-tauri/src/fs_utils.rs:68–78`.

- **E19. `load_tiki_releases` should use `read_json_resilient`** — `commands.rs:241` uses bare `fs::read_to_string` while reading `.tiki/releases/*.json` mid-traversal. If `save_tiki_release` is doing an atomic rename concurrently, a `NotFound` propagates upward. `get_state` and `get_plan` already use the resilient helper — align this path. *Why:* eliminates latent crash from concurrent write/read. *Effort:* S. *File:* `commands.rs:233–253`.

- **E20. `apply_transition` cannot explicitly clear `phase` / `parallel_execution`** — `state_transition.rs:213–229` interprets `None` as "leave alone" with no way for a caller to clear. Add an explicit `clear_phase: bool` field or wrap with `Update<T> { Keep, Clear, Set(T) }`. *Why:* callers that try to reset phase progress silently fail. *Effort:* M. *File:* `state_transition.rs:57–58, 212–229`.

- **E21. Deduplicate `resolve_tiki_path`** — `commands.rs:533` and `state_transition.rs:279` have identical private implementations. Move to `fs_utils.rs` as `pub fn`. *Why:* DRY; any future `TIKI_PATH` env-var override has one place to live. *Effort:* S. *Files:* `commands.rs:533`, `state_transition.rs:279`.

### Build & lint hygiene

- **E22. Move workspace-wide `clippy::allow` exceptions to per-site `#[allow(…)]` with TODO** — `Cargo.toml:23–27` has 4 workspace-level allows ("Remove when underlying code is cleaned up" comment, no issue numbers). Inline annotations at the affected sites with `// TODO #NNN` restore project-wide clippy coverage without blocking the refactor. *Why:* technical-debt visibility; new lints get detected. *Effort:* S. *Files:* `Cargo.toml:23–27`, `state.rs:157,175,187`, `claude_usage.rs:171`.

- **E23. Add `[profile.release]` to `Cargo.toml`** — Currently absent. Adding `lto = "fat"`, `strip = "symbols"`, `codegen-units = 1`, `panic = "abort"` typically reduces a Tauri release binary by 20–40% and improves cold-launch time. *Why:* smaller auto-update artifacts; faster startup. *Effort:* S. *File:* `apps/desktop/src-tauri/Cargo.toml`.

### Security / Tauri config

- **E24. Enable CSP in `tauri.conf.json`** — `tauri.conf.json:24–26` sets `"csp": null`. Since the frontend is a bundled React app (no remote content, no eval), a policy like `"default-src 'self' ipc: https://ipc.localhost; script-src 'self'"` adds defense-in-depth at zero functional cost. *Why:* defends against XSS if a dependency introduces one. *Effort:* S–M. *File:* `tauri.conf.json:24–26`.

---

## 3. Framework (Commands + state.mjs shim)

### state.mjs shim — close the remaining write gaps

- ~~**E25. `state.mjs remove <work-id>` subcommand**~~ _(shipped v0.5.0)_ — `ship.md:228` explicitly notes "delete the `issue:{number}` key from activeWork (direct JSON; shim does not expose deletion yet)." Add a validated, atomic `remove` subcommand so the last class of unvalidated state mutations goes through the shim. *Why:* eliminates the standalone-ship cleanup direct-JSON exception. *Effort:* S. *File:* `packages/framework/scripts/state.mjs`.

- ~~**E26. `state.mjs append-history` subcommand**~~ _(shipped v0.5.0)_ — `ship.md:231` and `release.md:168` both append directly to `history.recentIssues` / `history.recentReleases` via raw JSON. A shim subcommand that enforces the `completedIssueRecord` / `completedReleaseRecord` shapes from `state.schema.json:353–392` would close this last structural mutation gap. *Why:* history appends race with the `remove` call above when both happen in one ship. *Effort:* S. *Files:* `state.mjs`, `state.schema.json`.

- ~~**E27. `state.mjs get <work-id> [--field X]` subcommand**~~ _(shipped v0.5.0 — supports dot-path field extraction; scalars print raw, objects as JSON)_ — Commands today read state via inline `cat | jq` invocations. A `get` subcommand provides a consistent shim-managed read path, exposes `--tiki-path` for reads too, and clear-errors on missing keys. *Why:* lets command authors stop hand-rolling jq paths; opens the door for future tools to consume shim output reliably. *Effort:* S. *File:* `state.mjs`.

- ~~**E28. `state.mjs --dry-run`**~~ _(shipped v0.5.0 — also honored by `remove` and `append-history`)_ — No way to preview a transition's output without writing. Adding `--dry-run` that prints would-be entry JSON and exits 0 (or 1 on illegal transition) without touching the file would let commands and tests assert shape pre-write. *Why:* debugging a misbehaving transition currently requires writing then manually undoing. *Effort:* S. *File:* `state.mjs`.

- **E29. `state.mjs` JSON-Schema-validates output before write** — The shim builds entries through code logic but never runs the result against `state.schema.json`. Adding a post-apply validation pass (Ajv or a hand-rolled subset) would catch field drift before it hits disk. The three-mirror sync problem (TS/Rust/JS) is acknowledged at `state.mjs:50–55` as a risk. *Why:* schema validation on write is the automated backstop for that three-way drift. *Effort:* M. *Files:* `state.mjs`, `state.schema.json`.

- **E30. Extend `state.mjs transition` to accept richer GitHub issue metadata** — `get.md:29–33` documents a two-step pattern: shim sets `number`/`title`, then a follow-up direct-JSON write adds `body`/`labels`/`url`/`state`/`createdAt`/`updatedAt`. The schema declares all those fields. Add `--issue-body`, `--issue-url`, `--issue-state`, `--issue-labels` flags (or `--issue-json <path>` escape hatch). *Why:* eliminates the narrow window where state holds partial metadata — the watcher can fire between the two writes today. *Effort:* S–M. *Files:* `state.mjs`, `get.md`.

### Audit-time gap closures

- ~~**E31. AUDIT cross-checks `coverageMatrix` against `successCriteria` IDs**~~ _(shipped v0.5.0 — bidirectional check, also validates phase-number references)_ — `audit.md:22` says in prose "all success criteria have at least one phase addressing them" but this is unenforced. Schema (`plan.schema.json:74,116`) gives us structured IDs — verify every `SC*` appears as a key in `coverageMatrix` and every key references a real criterion. *Why:* silent coverage gaps reach EXECUTE today. *Effort:* S. *Files:* `audit.md`, `plan.schema.json`.

- ~~**E32. AUDIT runs Kahn's algorithm on phase `dependencies`**~~ _(shipped v0.5.0 — algorithm aligned with `execute.md`'s `<parallel-execution>` Step 2)_ — `audit.md:30` lists "no circular dependencies" but the cycle check only actually runs in `execute.md:80–92`. Running the same Kahn's pass at AUDIT surfaces cycles in seconds rather than mid-run after sub-agent dispatch. *Why:* catches cycles cheaply at plan-time. *Effort:* S. *File:* `audit.md`.

### Schemas, config, install

- **E33. Add `config.json` schema** — `execute.md` (lines 68, 352, 438), `release.md:649`, and `ship.md` each reference `.tiki/config.json` with inline JSON snippets for `workflow.parallel`, `workflow.tests`, `workflow.autoHeal`, `changelog`. No `config.schema.json` exists. A unified schema with `additionalProperties: false` would let the desktop surface config errors and `install.js` write a starter config. *Why:* four inline JSON blocks aren't guaranteed consistent across command files. *Effort:* S–M. *Files:* `packages/shared/schemas/` (new), affected command files.

- **E34. Research file frontmatter — add `updated` and `status` fields** — Current schema in `research.md:40–58` and `review.md:118–136` has only `topic`/`tags`/`issues`/`created`. No `updated` (so `execute.md:29–43` relevance-ranking has no freshness signal) and no `status` (no way to mark a doc stale without deleting). *Why:* research docs accumulate; retrieval heuristic should prefer fresh docs. *Effort:* S. *Files:* `research.md`, `review.md`, `plan.md`.

- **E35. `install.js --diff` shows what command files would change** — `install.js:37–43` blindly `cpSync` overwrites. A `--diff` mode (using Node string diff or line-count comparison) would let users review framework updates before accepting. `release.md` has the dry-run pattern to copy. *Why:* framework authors iterate command prose; users on older versions deserve a preview. *Effort:* M. *File:* `packages/framework/install.js`.

- **E36. Per-command-file version manifest stamped by install.js** — `install.js` stamps `.framework-version` but the version is a single number for all files. After manual edits, a subset of commands can be out of date silently. Stamp a manifest listing each file's `name:` frontmatter + a hash; have `/tiki:version` show per-file staleness. *Why:* partial command-file staleness is currently invisible to user and desktop app. *Effort:* M. *Files:* `install.js`, `version.md`.

---

## 4. Cross-cutting (Docs, CI, Onboarding, Hygiene)

### Documentation

- ~~**E37. `CLAUDE.md` should reference the `state.mjs` shim and the Windows pnpm reparse-point gotcha**~~ _(shipped v0.4.1; also covered E38's `pnpm build` ≠ `pnpm typecheck` note)_ — CLAUDE.md describes the Tauri state_transition command but omits the bash-callable shim entirely, despite it being the preferred write path. Also missing the Windows reparse-point note now saved to project memory — adopters on Windows hit the same wall. *Why:* prevents future agents from falling back to raw JSON writes; warns about a known env trap. *Effort:* S. *File:* `CLAUDE.md`.

- ~~**E38. `CLAUDE.md` should call out `pnpm build` ≠ `pnpm typecheck`**~~ _(shipped v0.4.1, merged into E37)_ — MEMORY notes `tsc -b` (via `pnpm build`) is stricter than `tsc --noEmit` (via `pnpm typecheck`) — discriminated-union narrowing bugs slip past typecheck. CLAUDE.md only lists typecheck. *Why:* recurring CI breakage source documented in memory. *Effort:* S. *File:* `CLAUDE.md`.

- **E39. Stamp `docs/DESIGN.md` and `docs/PLANNING-NOTES.md` with "last reviewed" dates** — Both still carry 2026-02-02 timestamps. Substantial evolution since (state_transition IPC, corruption recovery, canonical transitions). Readers can't tell which sections are current. *Why:* expectations for new contributors and external adopters. *Effort:* S. *Files:* `docs/DESIGN.md`, `docs/PLANNING-NOTES.md`.

- ~~**E40. Add `CHANGELOG.md` at repo root**~~ _(shipped v0.4.1)_ — Only changelog source today is GitHub Releases (whose body is boilerplate, see E41) plus the gitignored `.tiki/releases/*.json` archive. No linear, contributor-readable history. *Why:* standard hygiene; also enriches `/tiki:version` output. *Effort:* S. *Surface:* repo root.

### CI & releases

- ~~**E41. `release.yml` should generate a per-tag release body from the changelog file**~~ _(shipped v0.4.1)_ — `release.yml:77` ships a hardcoded `releaseBody` ("See the assets below…") for every tag. Read `.tiki/releases/vX.Y.Z-changelog.md` or `.tiki/releases/archive/vX.Y.Z.json` and call `gh release edit --notes-file ...` after the binary build. *Why:* GitHub Releases page is currently uninformative. *Effort:* S. *File:* `.github/workflows/release.yml:77`.

- **E42. `release.yml` should run `pnpm test && pnpm typecheck` before tauri-action** — Workflow goes `pnpm install → pnpm version-bump → tauri-action`. A tagged release can ship test regressions if the tag was pushed without a PR. One 3-minute gate eliminates the risk. *Why:* prevents shipping broken binaries direct-to-tag. *Effort:* S. *File:* `.github/workflows/release.yml`.

- **E43. PR workflow should include a Windows job** — `pr.yml` runs `ubuntu-22.04` only. Windows-specific code in `apps/desktop/src-tauri/src/github.rs` (`CREATE_NO_WINDOW` `#[cfg(target_os = "windows")]`) and `pty.rs` is only exercised by the release matrix. Add `windows-latest` to PR CI. *Why:* Windows is the primary target; regressions are invisible until release time. *Effort:* M. *File:* `.github/workflows/pr.yml`.

- ~~**E44. Add a test verifying Rust + JS shim transition tables match `@tiki/shared`**~~ _(shipped v0.5.0 — `transitions-parity.test.ts`; also fixed CI gap where `packages/shared` tests weren't being run at all)_ — Three copies of `VALID_TRANSITIONS` exist (TS canonical, Rust, JS shim). Only the TS copy is tested. Add a vitest or script that parses the Rust file and JS shim and asserts every legal pair matches the canonical table. Comment in `state.mjs:50–55` calls out the risk but doesn't enforce it. *Why:* "must be kept in sync" is not enforcement. *Effort:* M. *Surface:* `packages/shared/src/__tests__/transitions.test.ts` + new test file.

### Repo hygiene

- ~~**E45. `scripts/version-bump.mjs` should also bump root `package.json`**~~ _(shipped v0.5.0)_ — Root `package.json` is still `"version": "0.1.0"` after multiple release cycles. The bump script updates `tauri.conf.json`, `Cargo.toml`, `plugin.json` per README, but skips the workspace root manifest. *Why:* tooling that reads workspace version is misled; minor confusion. *Effort:* S. *Files:* `scripts/version-bump.mjs`, `package.json`.

- **E46. Mechanical enforcement of "new module → new test"** — `apps/desktop/README.md:171` prose requires a `*.test.ts` next to every new `stores/` or `components/` file, but there's no lint rule, hook, or CI step. Add a small CI script that diffs PR-added files in those dirs and fails if no sibling test was added. *Why:* prose conventions without mechanical enforcement decay. *Effort:* S–M. *File:* `.github/workflows/pr.yml`.

- **E47. Validate `.tiki/research/*.md` frontmatter at commit-time or load-time** — `commands.rs::list_research_docs` parses `ResearchDocMeta` from YAML frontmatter; missing or misspelled fields silently fail to parse, hiding the doc from the desktop UI. No schema, no validation. Add a frontmatter schema + a CI check or a runtime warning in the IPC handler. *Why:* malformed frontmatter causes silent UI gaps. *Effort:* S. *Files:* `commands.rs::list_research_docs`, `.tiki/research/`, new schema file.

- **E48. Public release notes / blog reference in README.md** — README currently has no quickstart for new users/contributors ("clone → `pnpm install` → `pnpm tauri:dev`") and no link to the latest release or roadmap. The repo just shipped v0.4.0 — surface that. *Why:* first-touch impression for anyone landing on the repo. *Effort:* S. *File:* `README.md`.

---

## 5. Desktop visual polish (added 2026-05-12)

A coherent visual-design pass on the desktop app. Each item targets a specific visual gap — color tokens that don't exist yet, missing animations on state changes, weak affordances, abrupt transitions. Most are pure CSS or single-component edits.

### Tokens & semantic color

- ~~**E49. Semantic status color tokens in `index.css`**~~ _(shipped v0.4.2)_ — Status colors (executing `#4ade80`, pending `#facc15`, paused `#60a5fa`, completed `#818cf8`, failed `#f87171`, planning `#c084fc`) are hardcoded in `WorkProgressCard.css:14–36` and re-defined ad-hoc in kanban.css, terminal.css, etc. Lift to `--status-executing`, `--status-pending`, `--status-paused`, `--status-completed`, `--status-failed`, `--status-planning`, `--status-shipping` (and `--status-reviewing`) in `:root` and `[data-theme='light']`. Components reference variables; one palette change propagates. *Why:* same colors duplicated 5+ times; light-theme variants currently missing; future palette refinement is a one-liner. *Effort:* S. *Files:* `apps/desktop/src/index.css`, `WorkProgressCard.css`, `kanban.css`, others using inline status colors.

- ~~**E50. Animated pulse on the currently-executing phase segment**~~ _(shipped v0.4.2 — refined existing animation to use --status-executing token)_ — `WorkProgressCard.tsx` renders phase-segments as flat divs; the running segment has the same visual weight as completed or pending. A subtle CSS `@keyframes` pulse (opacity 0.7 ↔ 1.0, 1.5s loop) on `.segment-running` draws the eye to active work without being noisy. *Why:* at-a-glance scanning of the sidebar should immediately surface where Tiki is doing work. *Effort:* S. *Surface:* `WorkProgressCard.css`.

### Affordance & interaction polish

- **E11 (already listed above) — Illustrated empty state for the detail panel.** Promoted to #176 in the v0.6.0 UX pack (was slotted for v0.4.2 but never shipped).

- ~~**E53. Selected-card elevation via subtle shadow**~~ _(shipped v0.4.2)_ — Selected items today (`.issue-card.selected`, `.kanban-card.selected`, soon `.work-progress-card.clickable:focus`) rely only on a subtle background shift. Add a `box-shadow: 0 0 0 2px var(--accent-color), 0 2px 6px rgba(0,0,0,0.25)` on `.selected` for clearer hierarchy. *Why:* hierarchy is hard to read in dense lists when only color shift indicates selection. *Effort:* S. *Surfaces:* `IssueCard.css`, `kanban.css`, `WorkProgressCard.css`.

- ~~**E54. Card hover state — accent-aware border shift**~~ _(shipped v0.4.2)_ — `.work-progress-card:hover` is currently `background: rgba(255, 255, 255, 0.05)` — barely perceptible in dark theme, invisible in light. Add a `border-left-color: var(--accent-color)` shift on hover (preserving status-color when present, just brightening). *Why:* hover is sub-threshold; users don't realize cards are interactive until they click. *Effort:* S. *Surfaces:* `WorkProgressCard.css`, `IssueCard.css`.

### Status visibility

- ~~**E56. Pulsing dot for "busy" terminal tabs**~~ _(shipped v0.4.2)_ — `TerminalTabs.tsx:9–25` already has a `StatusDot` with a `busy` state colored `#3b82f6`. Add a CSS `@keyframes` pulse (scale 1 ↔ 1.15, 1.5s loop) on the dot when `status === 'busy'`. *Why:* the current static dot conveys color but not motion; a pulse signals "actively running" at peripheral-vision level. *Effort:* S. *Surfaces:* `TerminalTabs.tsx`, terminal CSS.

- **E62. Shared `<StatusDot>` component used across all surfaces** — Today, only `TerminalTabs.tsx` has a `StatusDot`. `WorkProgressCard`, `IssueCard`, kanban headers, and the recovery dialog all describe status with text only. Extract `<StatusDot status="executing|pending|failed|..."/>` to `components/ui/StatusDot.tsx`, drive its color from the new E49 status tokens, and adopt it in 3–4 sites for visual consistency. *Why:* text + colored dot reads faster than text alone; reuses the E49 tokens; cohesion across the app. *Effort:* S–M. *Surfaces:* new `components/ui/StatusDot.tsx` + several consumers.

### Empty states

- **E57. Illustrated empty state for kanban "No issues" columns** — `KanbanColumn.tsx:54` renders `<div className="kanban-column-empty">No issues</div>`. Replace with a tiny inline SVG (empty-tray glyph) plus the text, styled at low opacity. *Why:* current empty state feels harsh; subtle illustration warms an otherwise-blank column without consuming significant space. *Effort:* S. *Surfaces:* `KanbanColumn.tsx`, `kanban.css`.

### Motion & accessibility

- ~~**E52. Respect `prefers-reduced-motion`**~~ _(shipped v0.4.2 — both CSS @media rule and framer-motion MotionConfig)_ — `framer-motion` animates `AnimatePresence` on Kanban cards (`KanbanColumn.tsx:56–83`), the column-count badge (`KanbanColumn.tsx:42–50`), and the Pipeline Timeline transitions. Add a top-level `useReducedMotion()` check (framer-motion exports this hook) and gate animations off when the OS preference is set. *Why:* accessibility for vestibular sensitivity; also helps low-end hardware feel snappier. *Effort:* S. *Surfaces:* `KanbanColumn.tsx`, `PipelineTimeline.tsx`, any other `motion.div` consumer.

- **E60. Smooth theme switch animation** — Toggling between dark and light theme today is instant (variables flip). Add `transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease` to `body`, `#root`, and a handful of containers in `index.css` so the change crossfades. *Why:* abrupt theme flip is jarring at high brightness; smooth transition feels more polished. *Effort:* S. *Surface:* `index.css`.

### Iconography (defer to v0.4.3+)

- **E55. Pipeline Timeline step icons replacing numbers** — `PipelineTimeline.tsx:159` shows `"1"…"6"` or `"✓"` inside step circles. Replace with step-specific SVGs (download for GET, magnifier for REVIEW, list for PLAN, clipboard for AUDIT, play for EXECUTE, paper-plane for SHIP). *Why:* immediate visual recognition; numbers are forgettable; matches modern timeline patterns in Linear/Jira. *Effort:* M. *Surface:* `PipelineTimeline.tsx`.

- **E58. Custom titlebar showing active context** — Tauri window title is static "Tiki". Use `app.set_title` from Rust (or `getCurrent().setTitle` from frontend) to dynamically show "Tiki — issue #42 executing" or "Tiki — release v0.4.2 shipping" when `activeWork` has an entry. *Why:* at-a-glance taskbar/dock signal of what Tiki is doing. *Effort:* M. *Surfaces:* `App.tsx`, Rust side via Tauri command.

- **E59. Sidebar "rail" mode — icon-only collapsed state** — Sidebar collapses fully today; an intermediate "icon rail" mode (VS Code style) would let users monitor active work via icons without sacrificing main-view space. *Why:* current options are all-or-nothing; users who want passive monitoring need an in-between. *Effort:* L. *Surface:* `App.tsx`, sidebar layout.

- **E61. Issue label color contrast — overlay fallback for mid-luminance labels** — `IssueCard.tsx:42–48` computes contrast via luminance threshold of 0.5. Mid-luminance labels (e.g., GitHub's `#fbca04`) end up unreadable either way. Add a `text-shadow: 0 0 2px rgba(0,0,0,0.5)` or a semi-transparent dark overlay when luminance is in the 0.4–0.6 ambiguous range. *Why:* certain label colors are genuinely hard to read currently. *Effort:* S. *Surface:* `IssueCard.tsx`.

---

## 6. New ideas (added 2026-05-14)

Surfaced during the 2026-05-14 backlog review (the session that triaged the open GitHub issues 10 → 4 and audited the guiding docs).

- **E63. Environment Doctor — a Settings health panel for external CLIs** — The desktop app shells out to `gh`, `git`, and `claude` but has no discovery or health layer. `check_claude_cli` (`github.rs:281`) runs `cmd /C claude --version` and reports a bare `false` on failure — which surfaces in `IssueFormModal.tsx` as a misleading **"CLI not installed"** even when Claude Code *is* installed but simply isn't on the GUI process's inherited PATH (a Windows GUI-app PATH-staleness gotcha). `enhance_issue_description` (`github.rs:719`) shells out the same way and fails for the same reason. A Settings → Environment panel should probe all three tools, show ✅ version / ⚠️ found-but-stale / ❌ missing, distinguish "not installed" from "not on PATH," and offer an explicit path-override field. *Why:* fixes a real user-visible bug (the mislabeled Enhance-with-AI button) and the whole class behind it. *Effort:* M. *Surfaces:* `github.rs` (new probe commands + path config), new `components/settings/EnvironmentPanel.tsx`, `IssueFormModal.tsx` (consume the better signal).

- **E64. Pre-tag verification gate in `release.md` + `release.yml`** — Project memory records repeated ship-without-verification regret: v0.5.6 shipped a speculative one-line fix with no A/B test; v0.5.4's tag build failed on a TS6133 unused import that reached `main` untested. E42 (run `pnpm test` in `release.yml`) is one piece, but the real fix is a **mandatory smoke-test + `pnpm build` checklist in `release.md`** that must pass before the tag is pushed, plus the CI gate. *Why:* the tool that orchestrates careful development should hold itself to the same bar; this is a recurring, memory-documented failure mode. *Effort:* S–M. *Files:* `packages/framework/commands/release.md`, `.github/workflows/release.yml`. *Supersedes/absorbs E42.*

- **E65. Rewrite or retire `docs/DESIGN.md` and `docs/PLANNING-NOTES.md`** — Both have been untouched since commit `1f9eb8f` on 2026-02-02 (~140 commits ago) and are now actively misleading: DESIGN.md's "Version History" tops out at design-draft "0.5" (not shipped v0.5.7), and its "Future versions" lists work that shipped months ago. A new contributor or future agent reading it gets day-one reality. E39 only proposes a date-stamp — insufficient. Either rewrite DESIGN.md as a current `ARCHITECTURE.md` (the four "Still Open" questions are the only salvageable forward-looking content), or demote both to `docs/archive/` and let `CLAUDE.md` + `CHANGELOG.md` be canonical. *Why:* stale guiding docs are a trap for every future reader. *Effort:* M. *Files:* `docs/DESIGN.md`, `docs/PLANNING-NOTES.md`, `CLAUDE.md` (update the Documentation section). *Supersedes E39.*

---

## Suggested implementation bundles

### v0.4.1 — "Quick wins" (4–6 hours of work, mostly S items)

A small follow-up release packaging the highest-impact / lowest-effort items. All small surface area, no architecture risk.

- **E5** Click WorkProgressCard → detail panel
- **E8** Kanban column count badge
- **E9** Kanban column header red on failed
- **E13** Command-palette inherits selected issue
- **E18** atomic_write fsync (durability win for free)
- **E37** CLAUDE.md mentions state.mjs + Windows env note
- **E40** CHANGELOG.md
- **E41** release.yml generates real release body from changelog

### v0.4.2 — "Visual polish" _(shipped 2026-05-12)_

A coherent visual-design pass. Each item is small but they compound — semantic tokens + animation + affordances + empty states together make the app feel meaningfully more polished. All S/S-M effort, no architecture risk.

- **E49** Semantic status color tokens in `index.css` (foundational — adopted by E50, E54, E62 below)
- **E50** Pulse animation on currently-executing phase segment
- **E11** Illustrated empty state for the detail panel (carries over from earlier brainstorm)
- **E53** Selected-card elevation via subtle shadow
- **E54** Card hover state — accent-aware border shift
- **E56** Pulsing dot for "busy" terminal tabs
- **E57** Illustrated empty state for kanban "No issues" columns
- **E52** Respect `prefers-reduced-motion`
- **E62** Shared `<StatusDot>` component across surfaces (depends on E49)

That's 9 items, sequenced so foundational tokens (E49) ship first and the rest layer on them. Roughly 6–8 hours of work given the env state.

### v0.5.0 — "Framework polish" _(shipped 2026-05-12)_

Theme: tighten the shim contract and close audit-time gaps. Each item builds on v0.4.0's canonical transition work.

- **E25** state.mjs `remove`
- **E26** state.mjs `append-history`
- **E27** state.mjs `get`
- **E28** state.mjs `--dry-run`
- **E31** AUDIT verifies coverageMatrix completeness
- **E32** AUDIT runs Kahn's at plan-time
- **E44** Test asserting Rust + JS shim mirror @tiki/shared (also closed CI gap where `packages/shared` tests weren't actually running)
- **E45** version-bump.mjs handles root package.json

### v0.6.0 — "UX polish" (terminal & detail panel improvements) — _scoped & filed 2026-05-14_

Theme: make the desktop feel polished and contextual. Breaks the v0.5.4–v0.5.7 single-issue reactive-bugfix streak — the first backlog-driven release since v0.5.0. All items are filed as GitHub issues.

- **E2** Regex toggle in terminal search — #173
- **E3** Ctrl+= / Ctrl+- runtime font-size — #174
- **E10** Jump-to-terminal from issue detail — #175
- **E11** Illustrated empty state for detail panel — #176
- **E14** Recovery dialog highlights parse-failure line — #177
- **#93** Phase summary view in detail panel — existing open issue; phase summaries already live in plan JSON, this is pure rendering. Folded in as the highest-value member of the bundle.

_E1 ("Clear scrollback"), originally part of this bundle, already shipped standalone as #158 in v0.5.4._

### Reliability / hygiene (no specific release — slot into above as time permits)

- **E16, E17** Watcher coverage for `.claude/commands/tiki/` and `.tiki/commands/`
- **E19** load_tiki_releases uses read_json_resilient
- **E21** Deduplicate resolve_tiki_path
- **E22** Per-site clippy allows with TODOs
- **E23** Cargo.toml [profile.release]
- **E24** Enable Tauri CSP
- **E42** release.yml runs pnpm test
- **E43** PR CI includes Windows job
- **E47** Validate research frontmatter

### Deferred / discuss before adopting

- **E4** PTY chunk-coalescing — measure first; may not matter
- **E12** Stale-tab indicator — UX-fiddly
- **E20** apply_transition clear path — needs design (boolean vs `Update<T>`)
- **E29** state.mjs schema validation — depends on a Node-friendly Ajv setup
- **E30** Richer GitHub metadata in shim — get.md two-write is currently okay; verify the watcher race actually bites
- **E33, E34** Schemas for config.json and research frontmatter — should be paired with E47
- **E36** Per-file framework version manifest — bigger than it sounds
- **E46** "New module → new test" enforcement — choice between lint vs CI step

---

## How to use this document

- Each item is a candidate, not a commitment.
- IDs (`E1`, `E2`, …) are stable. New ideas append; never renumber.
- When an item ships, mark it `~~struck through~~` and add a "shipped in vX.Y.Z" note.
- When an item is promoted to a GitHub issue, add `(→ #NNN)` next to its title.
- When an item is rejected or merged into another, mark it `_deferred_` or `_merged into E##_` and keep the ID for reference traceability.
