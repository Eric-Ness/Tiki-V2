---
topic: release-detail-deadend
tags: [desktop, releases, detail-view, github-cli]
issues: [255]
created: 2026-05-23T22:35:00.000Z
---

# Why completed releases (and closed issues) are detail "dead ends" (#255)

Two-investigator deep-dive (parent + code-explorer sub-agent), 2026-05-23.

## Release detail data flow
- Sidebar `ReleasesSection.tsx` builds `MergedRelease[]` from TWO sources:
  - GitHub releases via `fetch_github_releases` (Rust `github/releases.rs`, `gh release list --json tagName,name,isDraft,isPrerelease,publishedAt`). **`url` is NOT requested** → `GitHubRelease.url` is always undefined → the "View on GitHub" button in `ReleaseDetail` never renders.
  - Tiki releases via `load_tiki_releases` (`commands.rs:227-264`), which scans `.tiki/releases/*.json`. **Sidebar calls it WITHOUT `includeArchived`** (`ReleasesSection.tsx:195`) and the param defaults to `false` (the #142 "hide shipped releases" behavior).
- Click routing (`ReleasesSection.tsx:314-321`): `hasTiki ? setSelectedTikiRelease : setSelectedRelease`.
- Detail render switch: `App.tsx:401-418` → `selectedReleaseData` (GitHub) → `ReleaseDetail`; `selectedTikiReleaseData` → `TikiReleaseDetail`.

## Root cause of the release dead-end
On ship, `/tiki:release` teardown ARCHIVES the def file (`mv .tiki/releases/{v}.json → archive/{v}.json`). Then:
1. `load_tiki_releases` (no `includeArchived`) no longer returns it → `hasTiki: false`.
2. Click routes to `setSelectedRelease` → the **GitHub `ReleaseDetail`**, which is nearly empty: badge + title + tag + a `url`-gated "View on GitHub" button that never shows (url not fetched). No body, no issues, no dates. **That is the stripped-down view.**
3. Transient worse case: between archive (ship) and GitHub-release publish (CI), a completed release has neither `hasTiki` nor `hasGitHub` → it **vanishes from the sidebar** until CI finishes.

## Closed ISSUES are NOT a hard dead-end
`App.tsx:122-139` has a fallback: when a selected issue isn't in `issuesStore` (default filter `open`), it fetches via `fetch_github_issue_by_number` (state-agnostic `gh issue view`). So `IssueDetail` DOES render for closed issues; the "Close" button is hidden when closed. The gap is only MISSING FIELDS (resolution/closed_at/closed_by/milestone/assignees), not a blank view.

## Data sourcing inventory (where each #255 field lives)
- version/tag, completedAt: `history.recentReleases[]` (minimal: `{version, issues:[numbers], completedAt, tag}`) AND archived `{v}.json`.
- issues WITH titles, createdAt (→ duration): archived `.tiki/releases/archive/{v}.json` only (needs `includeArchived:true`).
- changelog/release notes: `.tiki/releases/{v}-changelog.md` (and archive/) — needs a new Rust command `read_release_changelog` (mirror `read_research_doc`/`get_plan`, return None if absent — older releases may lack it).
- GitHub release url/body: add `url`(verified field name) [+ optional `body`] to the `gh release list --json` list.
- issues' FINAL state (merged/closed): would need live `gh issue view` per issue (or reuse the PRs store like IssueDetail does).
- **status history / state transitions: NOT stored anywhere** → needs new persistence (ship teardown or archive JSON). Likely defer.
- closed-issue fields: `gh issue view --json stateReason,closedAt,closedBy,milestone,assignees` — VERIFIED `stateReason:"COMPLETED"`, `closedAt` work via gh CLI. **No GraphQL required** (the issue assumed it; not needed for these fields).

## Gotchas / risks
- **Archive-presence is the completed signal, NOT the `status` field.** Verified: just-archived `archive/v0.7.7.json` still says `"status":"active"` — the teardown `mv`s without flipping status. (Minor latent bug; older `v0.7.3.json` shows `"completed"`, so it's inconsistent. Don't gate display on `status==="completed"` for archive files.)
- **TikiReleaseDetail action buttons (Edit/Run Release/Review/Delete) are unconditional** — for a completed release these are useless or DESTRUCTIVE (Delete). Must gate on completed status before routing completed releases there.
- `includeArchived:true` loads all archive JSONs on project switch — tiny files, negligible (DependencyGraph already does this), but the array grows.

## Recommended approach (reuse-and-gate)
1. Sidebar: pass `includeArchived:true` to `load_tiki_releases` so completed releases become `hasTiki:true` and route to `TikiReleaseDetail` (fixes routing + the vanish-gap).
2. `TikiReleaseDetail`: gate action buttons on non-completed status; add completed sections (completedAt + duration, included issues, changelog body via new command, GitHub link).
3. Rust: add `url` to `fetch_github_releases`; add `read_release_changelog(version, tikiPath)` command (register in `lib.rs`).
4. Closed issues: broaden `gh issue view --json` fields (`stateReason,closedAt,closedBy,milestone,assignees`) + struct + render in `IssueDetail` when closed.
5. Defer: per-release status-history persistence; GitHub-API caching of immutable completed records.

## 2026-05-24 findings — scope LOCKED (releases-only)
User scope decision (the parked blocker) resolved: **Releases-only, SC1–SC5.**
- IN: SC1 route completed→`TikiReleaseDetail`; SC2 `read_release_changelog` body; SC3 add `url` "View on GitHub"; SC4 gate Edit/Run/Review/Delete on completed; SC5 kill the archive→CI vanish-gap (the `includeArchived:true` flip covers SC1+SC5).
- DEFERRED (not this issue): SC6 closed-issue fields (`state_reason`/`closedAt`/`closedBy`/milestone/assignees in `IssueDetail`); SC7 per-release status-history persistence (no storage exists — new work); SC8 GitHub-API caching of immutable records.
- ~3 phases, Medium, no new deps. Ready for `/tiki:plan 255`.

## 2026-05-24 findings — PLAN constraints (corrects earlier notes)
Two assumptions in the earlier sections were WRONG; verified during planning:
1. **`gh release list --json` has NO `url` field.** Valid list fields: `createdAt, isDraft, isImmutable, isLatest, isPrerelease, name, publishedAt, tagName`. The `GitHubRelease` Rust struct already declares `url: Option<String>` but it's dead (never populated). To get a release URL you MUST use `gh release view {tag} --json url` (which also exposes `body`, `author`, `apiUrl`, etc.). Plan uses a new `fetch_github_release_url(version, projectPath)` command doing `gh release view` → `Ok(None)` on failure (graceful during the archive→CI vanish-gap).
2. **`load_tiki_releases` ALREADY accepts `include_archived: Option<bool>`** (commands.rs:227) — the sidebar just never passes it (`ReleasesSection.tsx:195`). So the routing fix is a one-arg flip, NOT a new param.
3. **Completion must be derived from file LOCATION, not `status`.** Archived JSONs keep `"status":"active"`. Plan adds `archived: bool` to the `TikiRelease` struct with `#[serde(default, skip_serializing)]` — defaulted on read, NEVER persisted, set `true` only for records read from `releases/archive/` (threaded through `read_release_dir`). The merge + detail derive "completed" from `archived || status in {completed,shipped}`.
4. **Changelog body = local `.tiki/releases/{v}-changelog.md`** (top-level; fall back to `archive/`). The GitHub release `body` is generated FROM this file, but the local read is instant/offline and survives the vanish-gap, so SC2 reads local via `read_release_changelog` (→ `Ok(None)` if absent; older releases legitimately lack one).
5. **App.tsx:409 checks `selectedReleaseData` BEFORE `selectedTikiReleaseData`** — so `setSelectedTikiRelease` MUST clear `selectedRelease` or the GitHub view wins. Verify the detailStore setters are mutually exclusive (Phase 3).
Phase order: 1 Rust archived-flag → 2 Rust changelog+url commands → 3 FE sidebar route/badge → 4 FE detail enrich+gate. (plan: `.tiki/plans/issue-255.json`)

## Key files
`ReleasesSection.tsx` (195 query, 314-321 routing, 264-312 merge) · `App.tsx` (401-418 switch, 122-139 issue fallback) · `detail/TikiReleaseDetail.tsx` · `detail/ReleaseDetail.tsx` · `detail/IssueDetail.tsx` · `src-tauri/src/commands.rs` (220-264 load_tiki_releases) · `src-tauri/src/github/releases.rs` · `src-tauri/src/github/issues.rs` · `src-tauri/src/lib.rs` (command registration) · `state.rs` (440-478 history schema).
