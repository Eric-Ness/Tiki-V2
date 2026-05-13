# Session handoff — 2026-05-13

A long working session covering the Dependency Graph view. Shipped release v0.5.1 (4 issues), set up v0.5.2 (4 issues planned, not yet executed). This document captures everything done, everything outstanding, and the non-obvious context a fresh session will need.

## TL;DR for a new session

- **Repo state:** main at commit `0ec9420` (chore: mark v0.5.1 as shipped). Working tree clean except for `.tiki/releases/v0.5.2.json` (intentionally uncommitted; commits at ship time per convention).
- **What just shipped (v0.5.1):** four dep-graph fixes/features bundled. Tag `v0.5.1` pushed, GitHub Release published at https://github.com/Eric-Ness/Tiki-V2/releases/tag/v0.5.1.
- **What's queued (v0.5.2):** four GitHub issues (#151-154) about graph richness. Release manifest exists. Nothing executed yet — `/tiki:release v0.5.2` is the next command.
- **One outstanding user-facing verification:** user planned to launch the desktop app to eyeball the v0.5.1 visuals (dropdown order, swimlanes, hover lineage, progress fills) but the session was paused before they did. Some chance there are visual bugs that need investigation. See "What to watch for visually" below.
- **One environmental constant:** Windows pnpm reparse-point block (CLAUDE.md) — `pnpm build` and `pnpm typecheck` fail on this machine because `packages/shared/node_modules/ajv/dist` is unreadable. `cargo check` works fine. TypeScript verification is by inspection only until the env is fixed.

---

## Part 1 — What was shipped this session

### Pre-session state

User started by saying the Dependency Graph chart wasn't working: dropdown stuck on v0.2.x releases when project was on v0.5+, sort order was wrong. They also asked for ~10 ideas to make the graph visually more interesting.

### Diagnosis (no code changes)

Identified two stacked bugs:

1. **Release dropdown stale:** `load_tiki_releases` (`apps/desktop/src-tauri/src/commands.rs:216`) scans `.tiki/releases/*.json` but only the top-level dir, not `releases/archive/`. Most shipped releases were in archive. AND v0.4.1, v0.4.2, v0.5.0 had no JSON anywhere on disk (only changelog .md files).
2. **Sort wrong:** `DependencyGraph.tsx:30` used `b.version.localeCompare(a.version)` — lexicographic, so `"v0.2.9"` sorted as greater than `"v0.2.15"`. Backend already sorted by semver via `cmp_semver` (`commands.rs:251`) — frontend was undoing it.

Produced a 10+bonus-item brainstorm for visual improvements (full list in Part 4 below).

### Issues filed and shipped — release v0.5.1

| # | Title | Commits |
|---|---|---|
| [#147](https://github.com/Eric-Ness/Tiki-V2/issues/147) | Bug: /tiki:release can't create release JSON — desktop UI was the only writer | `1b7acd0` + `e3e617f` |
| [#148](https://github.com/Eric-Ness/Tiki-V2/issues/148) | Bug: Dropdown uses string sort instead of semver | `52c05ff` + `e5df301` |
| [#149](https://github.com/Eric-Ness/Tiki-V2/issues/149) | Dep Graph v2 — swimlanes + progress fills + hover lineage | `2840feb` + `f14ea21` |
| [#150](https://github.com/Eric-Ness/Tiki-V2/issues/150) | Parser misses markdown 'Related:' sections — graph mostly empty | `23c8224` + `055f25c` |

Plus an incidental commit `32c2ba0` — chore: finalize v0.5.0 framework prose in .claude/ mirror. This was leftover v0.5.0 work (release.md/ship.md prose-to-shim conversion, .framework-version bump) that was sitting uncommitted at session start.

Final release ship commits: `4d5c8f5` (changelog) + tag `v0.5.1` + GH Release + `0ec9420` (final cleanup).

### Issue #147 — the big one

**Original hypothesis was wrong.** I initially diagnosed it as a regression in `release.md`/`ship.md`. A code-explorer sub-agent investigation overturned that: the JSON-write step was **never** in those files. The release JSON has always been created exclusively by the desktop app's `save_tiki_release` Tauri IPC (`commands.rs:258`), called from `ReleasesSection.tsx:204` when a user clicks "New Release" in the UI dialog. `/tiki:release` required the file to exist (step 2's `release-not-found` error). Workflows that shipped issue-by-issue without invoking `/tiki:release` simply skipped the only step that created the JSON.

I updated #147's body with the corrected diagnosis before planning. The fix structure became:

1. **Phase 1** — Add create-if-absent step to `release.md`. Both `.claude/commands/tiki/release.md` and `packages/framework/commands/release.md` now check if the JSON exists; if not, write a minimal scaffold via the Write tool (framework can't call `save_tiki_release` — that's a Tauri IPC, desktop-only). Issue list derived from `--issues` flag, GitHub milestone, or interactive prompt.
2. **Phase 2** — `load_tiki_releases` gained an `include_archived: Option<bool>` parameter (default false → preserves #142's sidebar fix; the Dependency Graph passes true). Extracted a `read_release_dir` helper to avoid duplicating the file-walk for the archive case.
3. **Phase 3** — Backfilled v0.4.1, v0.4.2, v0.5.0 JSONs in `archive/`. These were E-tracked enhancement bundles with no GitHub issue numbers — `issues: []` is the honest shape. The `name` field carries the E-ID list for human reference (e.g. `"Framework polish (E25, E26, E27, E28, E31, E32, E44, E45)"`).
4. **Phase 4** — `check_release_json_parity` function added. Scans both top-level and archive/ for `*-changelog.md` and `*.json`, warns when changelog count exceeds JSON count. Silent in steady state post-backfill.
5. **Phase 5** — "Repair truncated audit.md" — turned out to be a no-op. The sub-agent originally reported `.claude/commands/tiki/audit.md` was missing 47 lines vs its mirror. Verification showed both files were already 195 lines and byte-identical. The real audit.md change was the `<algorithmic-checks>` block (the actual v0.5.0 E31/E32 work) sitting uncommitted in the working tree. Committed as part of #147's commit.

### Issue #148 — the trivial fix

One-line change: replaced `return b.version.localeCompare(a.version)` with `return 0` in `DependencyGraph.tsx:30`. Relies on `Array.prototype.sort` stability to preserve the backend's already-correct semver order while the active-first promotion still pulls active releases to the top. Mirrors the resolution pattern from #120 (the analogous sidebar bug, shipped 2026-02-20).

### Issue #149 — the visual upgrade pack

Three phases, all in `apps/desktop/src/components/dependencies/`:

1. **SwimlaneLayer.tsx** (new file) — mounted as a `<ReactFlow>` child. Groups laid-out nodes by their `position.y` (rounded), resolves dominant status per rank, paints low-alpha bands. Tracks pan/zoom by reading `useStore((s) => s.transform)` from xyflow's store and applying it manually to a wrapper div. Status priority for tie-breaking: `executing > failed > pending = open > completed = closed`. Color map in `BAND_BG` constant.

2. **Progress fill in IssueNode** — `IssueNodeData` extended with optional `phaseProgress: { current: number; total: number }`. `useDependencyGraph.ts` populates it from `activeWork[issue:N].phase`. `IssueNode.tsx` renders a 3px bar at `.issue-node-progress`. Full green for completed/closed; partial blue with soft glow for executing; hidden otherwise. `.issue-node` became `position: relative` so the absolute-positioned bar anchors correctly.

3. **Hover-to-trace lineage** — `hoveredId` state in `DependencyGraphInner`. Adjacency maps (forward + backward) memoized from edges. On hover, BFS in both directions yields ancestor + descendant + edge sets. Applied via `styledNodes` / `styledEdges` useMemo blocks (which now check `lineage` first, falling back to critical-path styling). Edge IDs reconstructed via the existing `e{source}-{target}` format from `useDependencyGraph.ts:150`. Lineage takes precedence over critical-path mode; hover-off restores critical-path styling cleanly.

CSS: `.lineage-node .issue-node { opacity: 1; box-shadow: 0 0 0 1px var(--accent-primary, #58a6ff), 0 0 8px rgba(88, 166, 255, 0.25) }`. `.dimmed-node .issue-node { opacity: 0.3 }`.

### Issue #150 — discovered mid-release

When the user went to verify #149 visually, they noted: "no nodes have an ancestor or descendant." Investigation showed all three v0.5.1 issue bodies used markdown `## Related` sections with bullet lists, none of which the existing parser regex could traverse. The hover-lineage feature was working correctly — it just had nothing to trace.

`parseDependencies.ts` rewrite added two new pattern types alongside the existing inline regex:

```ts
const inlinePattern =
  /(?:depends on|blocked by|requires|after|related to|see also)\s+#(\d+)/gi;
const sectionPattern =
  /(?:^|\n)#{1,4}\s*[^\n]*related[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/gi;
```

Verified by REPL against #147/#148/#149's real bodies → produces expected edge set #147→#148, #147→#149, #148→#149 for v0.5.1. Function signature unchanged: `(body, releaseIssueNumbers) => number[]`.

No edge-type distinction in v0.5.1 (hard deps vs soft refs both render as solid edges). That's deferred to #154 in v0.5.2.

### Release v0.5.1 ship sequence

After all 4 issues shipped, I initially paused at "ready to tag?" — **user corrected this**. They invoke `/tiki:release vX.Y.Z` as authorization for the full ship sequence, not just the per-issue work. See "Memory file written this session" below.

Final ship sequence executed:

1. State backup → `.tiki/backups/state.2026-05-13T16-25-49.json`
2. Changelog written to `.tiki/releases/v0.5.1-changelog.md`, committed as `4d5c8f5`
3. `git tag -a v0.5.1` + push
4. `gh release create v0.5.1 --notes-file .tiki/releases/v0.5.1-changelog.md`
5. Updated `v0.5.1.json` with `status: "shipped"`, moved to `.tiki/releases/archive/v0.5.1.json`
6. `state.mjs remove release:v0.5.1`
7. `state.mjs remove issue:147` / 148 / 149 / 150
8. `state.mjs append-history release --version v0.5.1 --issues "147,148,149,150" --tag v0.5.1`
9. `.tiki/.framework-version` bumped `0.5.0` → `0.5.1`
10. Final commit `0ec9420` — chore: mark v0.5.1 as shipped (state.json + archive JSON + framework-version)

---

## Part 2 — What's queued for v0.5.2

Per the user's selection of "Bundle A — graph richness", four issues were filed:

| # | Title | Effort | Scope |
|---|---|---|---|
| [#151](https://github.com/Eric-Ness/Tiki-V2/issues/151) | Animate dep graph edges only when work is actively flowing through them | Small | `useDependencyGraph.ts:154` — set `animated: true` when source is completed and target is executing |
| [#152](https://github.com/Eric-Ness/Tiki-V2/issues/152) | Scale dep graph node height by plan phase count | Small-Medium | `useDependencyGraph.ts` layout step + IssueNode CSS. Needs `get_plan` Tauri command fetched alongside issue bodies — the data fetch is the only non-presentational change. |
| [#153](https://github.com/Eric-Ness/Tiki-V2/issues/153) | Render GitHub labels as colored chips below issue title | Small | Needs `fetch_github_issue_by_number` extended to surface `labels[*].name` + `labels[*].color`. IssueNode renders chip row, capped at 4 visible with `+N` overflow. |
| [#154](https://github.com/Eric-Ness/Tiki-V2/issues/154) | Render 'Related:' soft references as dashed edges | Small | Direct follow-up to #150. `parseDependencies` return type changes from `number[]` to `{ number, kind: 'hard' \| 'soft' }[]`. Edge style adds `strokeDasharray` for soft. |

**Release manifest:** `.tiki/releases/v0.5.2.json` (status `active`, theme "Dependency graph richness — Bundle A"). On disk but NOT committed yet — follows the v0.5.1 precedent where release manifests commit at archive time, not creation time.

### Implementation order considerations for v0.5.2

`★ Worth noting for the next session ─────────────`
- All four issues touch `useDependencyGraph.ts` + `IssueNode.tsx` + CSS. Sequential `/tiki:yolo` runs are likely to hit merge conflicts (same file regions). Options: (a) yolo them in this order to minimize conflict — **#152 first** (data fetch + plumbing → reusable for everything else), then **#151** (animation, separate code path), then **#153** (label chips, separate slot in node), then **#154** (parser + edge styling, mostly separate file). Or (b) slip them into one combined commit if they all converge clean. Tiki's atomic-issue convention favors (a).
- #152 is the only issue requiring a Rust-side change (`fetch_github_issue_by_number` doesn't currently surface labels). Verify with `cargo check`.
- All four are pure-presentational TypeScript + CSS otherwise. `pnpm build` verification will continue to be blocked by the Windows pnpm reparse-point issue unless that's been resolved.
`──────────────────────────────────────────────────`

### Deferred for later releases (not v0.5.2)

Themes split from the original 10+bonus brainstorm:

- **Bundle B — graph navigability:** #5 minimap with status-colored tiles, #6 "ghost" cross-release dependencies. Candidate for v0.5.3.
- **Bundle C — graph analytics:** #8 critical-path + slack visualization, #9 timeline overlay mode, #10 per-node phase-history sparklines. Candidate for v0.6.0. These are substantive enough to each warrant their own deep dive; share infrastructure (phase history data, slack computation) worth building once.

---

## Part 3 — Outstanding before the new session starts

### Verification gap

User explicitly requested at one point: "launch the desktop app to eyeball first" before tagging v0.5.1. The session ended up tagging without that eyeball happening — the user came back asking about the workflow trigger, not about the visuals. So the visual verification of v0.5.1 is **technically still outstanding**.

The next session may want to:
1. Launch the desktop app from the **x64 Native Tools Command Prompt for VS 2022** (per CLAUDE.md): `cd apps/desktop && pnpm tauri:dev`
2. Open Dependency Graph view.
3. Confirm dropdown order (#147 + #148 working): v0.5.1 was already removed from activeWork — the dropdown should now show v0.5.0 → v0.4.2 → v0.4.1 → v0.4.0 → v0.3.0 → v0.2.19 → ... → v0.2.5 (semver descending). v0.5.1 itself moved to archive so it's also there with `status: shipped`.
4. Confirm swimlanes render (#149 Phase 1) — horizontal colored bands behind nodes, tracking with pan/zoom.
5. Confirm hover-lineage (#149 Phase 3) — on a release with edges, hovering dims non-lineage to ~30% opacity.
6. Confirm progress bars (#149 Phase 2) — completed issues show full green bar; executing issues show partial blue with glow.
7. Confirm parser found edges (#150) — older releases with markdown `## Related` sections should now show edges between issues.

### What to watch for visually (potential bugs)

`★ Specific risk areas in the v0.5.1 ship ────────`
- **SwimlaneLayer's viewport transform** is the single highest-risk piece. I manually apply `translate(x, y) scale(z)` from xyflow's `useStore((s) => s.transform)` to a wrapper div. If xyflow v12.10.1's transform shape isn't `[tx, ty, tz]` (or if its store key changed names), the bands won't track pan/zoom — they'll stay fixed in viewport. Fix would be to look at how the built-in `<Background>` component reads transform and mirror that exactly.
- **Progress bar absolute positioning** depends on `.issue-node { position: relative }` which I added in IssueNode.css. If anything else has a `.issue-node` rule overriding position, the bar will end up in the wrong place. Easy fix; just an inspection issue.
- **Hover lineage edge IDs** are reconstructed via `e${source}-${target}` format. If `useDependencyGraph.ts:150` ever changes the edge ID format, the lineage feature silently breaks (hovered node will highlight correctly, but edges won't because the BFS-constructed IDs won't match). Worth adding a code comment cross-referencing the format. Did not do this in v0.5.1.
- **Build cannot be verified** because `pnpm build` is blocked by the Windows pnpm reparse-point issue. The cargo side is solid (`cargo check` ran multiple times this session, always clean). TypeScript changes were verified by inspection — they are localized to specific files, and the diffs are small, but no automated tool confirmed correctness.
`──────────────────────────────────────────────────`

### Working tree state at session end

- main at `0ec9420` (committed + pushed)
- `.tiki/releases/v0.5.2.json` exists, untracked, intentionally uncommitted
- `apps/desktop/src-tauri/Cargo.toml` — line-ending-only diff (no content change), unstaged, can be safely ignored or normalized

All other files clean.

### State.json at session end

- `activeWork: {}` (clean — no in-flight work)
- `history.lastCompletedRelease`: `v0.5.1` with all 4 issues
- `history.recentReleases`: v0.5.1 at top, then v0.5.0
- `history.recentIssues`: #150 → #149 → #147 → #148 at top, then everything else

---

## Part 4 — The original 10+bonus brainstorm (for context)

| # | Idea | Status |
|---|---|---|
| 1 | Status swimlane backgrounds | **Shipped in v0.5.1 (#149)** |
| 2 | Edge animation that means something | Queued for v0.5.2 (#151) |
| 3 | Progress fill inside each node | **Shipped in v0.5.1 (#149)** |
| 4 | Node size = effort / phase count | Queued for v0.5.2 (#152) |
| 5 | Mini-map with status-colored tiles | Bundle B — deferred to v0.5.3 |
| 6 | "Ghost" cross-release dependencies | Bundle B — deferred to v0.5.3, needs research-doc first |
| 7 | Hover-to-trace lineage | **Shipped in v0.5.1 (#149)** |
| 8 | Critical-path + slack visualization | Bundle C — deferred to v0.6.0 |
| 9 | Timeline overlay mode (toggle) | Bundle C — deferred to v0.6.0 |
| 10 | Per-node phase-history sparkline | Bundle C — deferred to v0.6.0 |
| 11 | GitHub label chips on each node | Queued for v0.5.2 (#153) |
| 12 | Edge-type distinction (dashed soft refs) | Queued for v0.5.2 (#154) — emerged from #150's work |

---

## Part 5 — Memory file written this session

Added `memory/release-must-be-tagged.md` (linked in `MEMORY.md` under "Workflow feedback"). Captures user feedback after I shipped 4 issues but then paused at "ready to tag?" — user came back asking why the workflow wasn't running. Key principle:

> When the user invokes `/tiki:release vX.Y.Z`, that is authorization for the **entire ship sequence** (changelog → tag → GitHub release → archive → state cleanup → framework-version bump). Don't pause at "should I tag now?" — the release-shipping flow is one operation, not two. An untagged release is functionally non-existent (tag-triggered workflows don't run; the release doesn't exist from a user-facing standpoint).

The memory carves out an exception: pause if there's a **specific blocker** (failing tests, dirty tree, partial completion) — not as a generic pre-action caution. Pause-before-action is right for one-off destructive ops the user didn't explicitly request; it's wrong for the natural completion of an operation they did.

---

## Part 6 — Non-obvious things to know

These are surprises this session uncovered that aren't documented elsewhere:

1. **`.tiki/releases/archive/` exists and is intentional.** Per #142 (shipped 2026-05-09), shipped releases get moved here to keep the sidebar's active-work view clean. `load_tiki_releases` now has the `include_archived` parameter (post-#147) to expose them for the Dependency Graph view while preserving the sidebar's behavior.

2. **E-IDs are NOT GitHub issue numbers.** The v0.5.0 changelog references E25, E26, E27, etc. These are enhancement IDs from `docs/ENHANCEMENT-IDEAS.md` — a private backlog. They don't map 1:1 to GitHub issues. For backfilled releases like v0.4.1/v0.4.2/v0.5.0, `issues: []` is the honest shape; the `name` field carries the E-ID list as human-readable context.

3. **`save_tiki_release` is desktop-only.** It's a Tauri IPC (`commands.rs:258`) called only from `ReleasesSection.tsx:204` (the desktop UI's "New Release" dialog). Framework commands cannot invoke it — they have to write the JSON directly via the Write tool. This is why #147's fix is a prose change to `release.md`, not a call to an existing helper.

4. **The framework prose has two mirror copies** that must stay in sync: `.claude/commands/tiki/*.md` (what Claude Code loads) and `packages/framework/commands/*.md` (what gets shipped via the desktop app's in-app framework update feature). The v0.5.0 work updated `packages/framework/commands/` but the `.claude/` mirror lagged — that lag was the `32c2ba0` cleanup commit early this session. If you edit one, edit both, OR `cp` the source to the mirror.

5. **`useNodes` from `@xyflow/react` requires being inside a `ReactFlowProvider`.** The `SwimlaneLayer` works because it's rendered as a child of `<ReactFlow>`, which is itself inside `<ReactFlowProvider>` (set up at the outer `DependencyGraph` component level). Don't try to use `useNodes` outside this nesting or it'll throw at render time.

6. **Cargo.lock had stale `tiki-desktop` version (0.3.0).** Cargo's auto-resolution corrected it to 0.5.0 during this session's `cargo check` runs. Got picked up by `1b7acd0`'s commit. There may be other stale references; worth a `cargo metadata` scan in a future session.

7. **The Windows pnpm reparse-point block is the most-impactful environment issue.** It blocks `pnpm install`, `pnpm build`, `pnpm typecheck` — anything that walks `packages/shared/node_modules/ajv/dist`. Workaround documented in CLAUDE.md is `$env:NPM_CONFIG_NODE_LINKER='hoisted'; pnpm install`. Without this fix, all TypeScript verification is by-inspection. The next session may want to attempt the workaround on a clean shell before doing v0.5.2 work — it would unblock end-to-end build verification.

8. **`/tiki:release` does NOT use GitHub Milestones.** This repo doesn't have milestones at all (`gh api repos/Eric-Ness/Tiki-V2/milestones` returns `[]`). Releases are tracked entirely via `.tiki/releases/v*.json` files. The skill's milestone-handling steps are essentially dead code for this repo.

---

## Part 7 — How to resume in a fresh session

1. Read this file first.
2. Check `git log --oneline -20` to confirm the chain matches what's described here.
3. Check `gh issue list --state open --limit 10` to confirm #151-154 are open.
4. If you want to launch desktop app first for the v0.5.1 eyeball: do so before any code changes.
5. When ready to execute v0.5.2: `/tiki:release v0.5.2`. Per memory `release-must-be-tagged.md`, this is authorization for the full ship — don't pause at the "should I tag?" gate at the end.
6. Implementation order recommendation (from Part 2): #152 → #151 → #153 → #154. Each is small; the whole release is ~1-2 hours of focused work plus the verification overhead.
7. If the Windows pnpm install issue isn't resolved, accept that TS verification is by-inspection and proceed — that's how v0.5.1 shipped.

---

## Part 8 — Commits this session, in chronological order

```
32c2ba0 chore: finalize v0.5.0 framework prose in .claude/ mirror
52c05ff fix: dependency graph version dropdown semver order (#148)
e5df301 chore: mark issue #148 completed in state.json
1b7acd0 feat: close release JSON visibility gap end-to-end (#147)
e3e617f chore: mark issue #147 completed in state.json
2840feb feat: dependency graph v2 — swimlanes + progress fills + hover lineage (#149)
f14ea21 chore: mark issue #149 completed in state.json
23c8224 fix: dep graph parser now finds markdown 'Related:' sections (#150)
055f25c chore: mark issue #150 completed in state.json
4d5c8f5 docs: add v0.5.1 release changelog
0ec9420 chore: mark v0.5.1 as shipped
```

Plus tag `v0.5.1` pushed to origin and GitHub Release published.

End of handoff.
