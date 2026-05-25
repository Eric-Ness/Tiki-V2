---
topic: tiki-doctor-diagnostics
tags: [diagnostics, tauri, rust, releases, reconciler]
issues: [261, 262]
created: 2026-05-24T22:42:00.000Z
---

# Tiki Doctor — `.tiki/` health diagnostics

Read-only inspection of the `.tiki/` workspace surfaced in-app, deliberately
targeting the drift class fixed in #259 (archived release still says
`status:"active"`). #261 = backend command; #262 = Settings panel.

## Reusable building blocks already in the codebase

The backend is mostly **assembly** — three of five checks have working code:

| Check | Existing code to reuse | Location |
|-------|------------------------|----------|
| `frameworkVersion` | `read_framework_version()` — reads `.tiki/.framework-version`, trims, `Ok(None)` if absent | `commands.rs:816` |
| `releaseChecks` / `archivedButActive` | `read_release_dir(dir, out, archived)` stamps `archived` by **directory location** (`archive/` ⇒ `true`); `TikiRelease.archived` is `#[serde(default, skip_serializing)]` (derived, never persisted). `archivedButActive = archived && status=="active"` | `commands.rs:329`, `state.rs` `TikiRelease` |
| `recentReleasesMissingJson` | `check_release_json_parity()` is structurally ~80% of this — but it compares **changelogs↔JSON**, not **state-history↔JSON**. Adapt: collect `state.json` `history.recentReleases[].version`, diff against the union of `releases/*.json` + `releases/archive/*.json` | `commands.rs:272` |
| `reconcilerHookInstalled` | `reconcile_groups(settings, event)` test helper — scans `hooks[event][].hooks[].command` for `"reconcile-state.mjs"`. **Currently trapped in `#[cfg(test)]`** — lift to a real fn | `commands.rs:846` |
| `stateValid` + `schemaVersion` + `activeWorkCount` | parse `.tiki/state.json` → `TikiState` (`state.rs:8`); `stateValid` = parse Ok, `schemaVersion` from field, `activeWorkCount = activeWork.len()` | `state.rs` |

## Conventions to follow

- **Struct shape:** `#[derive(Debug, Clone, Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]` (uniform across `state.rs`). `DiagnosticsReport` + nested `ReleaseCheck` belong in `state.rs`.
- **Command shape:** `#[tauri::command] pub fn tiki_doctor(tiki_path: Option<String>) -> Result<DiagnosticsReport, String>`. Default `tiki_path` to `cwd/.tiki` exactly like `load_tiki_releases` (commands.rs:232-238).
- **Registration:** add to `invoke_handler` (Tauri `generate_handler!`).
- **Read-only:** no `atomic_write`, no `state.mjs`. Pure inspection.
- **Test infra exists:** `temp_tiki_with_releases()` (commands.rs:922) already builds a `.tiki` with an `archive/` file that deliberately keeps `status:"active"` — drop-in for the `archivedButActive` assertion. `temp_project()` + `read_settings()` cover the hook-detection test.

## Real drift in THIS repo (live-test expectations)

As of 2026-05-24 (post-v0.8.2), running the doctor on this repo should report:

- `frameworkVersion: "0.8.2"`, `stateValid: true`, `schemaVersion: 1`.
- `reconcilerHookInstalled: true` — `.claude/settings.json` registers `reconcile-state.mjs` under **both** `Stop` and `SubagentStop`.
- `recentReleasesMissingJson: ["v0.6.7","v0.7.5","v0.7.6","v0.7.8"]` — these 4 are in `state.json` `history.recentReleases` but have **no** JSON in `releases/` or `releases/archive/`. (Note: v0.7.4 shipped but isn't even in `recentReleases`, so this check won't catch it — a separate gap.)
- `archivedButActive` — every shipped release in `archive/` keeps `status:"active"` by design (ship `mv`s without flipping status), so this will be `true` for ALL archived releases. **Design decision for #262's summary:** archived `status:"active"` is EXPECTED, not drift — the panel should only flag it as a finding when the count is anomalous, or reframe the finding. Revisit during #262 review.

## Frontend mirror (#262)

Desktop does **not** import `@tiki/shared` at runtime — mirror `DiagnosticsReport`
as a local TS type (same pattern as `deriveCriteriaVerification`, release types).
Pure `diagnosticsSummary.ts` reduces report → `healthy | warnings` + findings list,
unit-tested with vitest; panel handles loading/error/empty.

## 2026-05-24 findings (#262 review)

**Template:** `WorkflowConfigSection.tsx` is a near-exact analog — copy its shape:
- `tikiPath = activeProject ? \`${activeProject.path}/.tiki\` : undefined` via `useProjectsStore((s) => s.getActiveProject())`.
- `invoke<DiagnosticsReport>("tiki_doctor", { tikiPath })` inside a `useCallback load()` with `loading`/`loadError` state + `useEffect(() => void load(), [load])`. The **Refresh button just calls `load()` again** — no new mechanism.
- Markup reuses existing CSS classes: `settings-section`, `settings-section-header` (`<h3>` + button), `settings-hint`, `settings-row`. No new global CSS needed beyond panel-specific bits.

**File placement (matches repo conventions):**
- Pure helper → `apps/desktop/src/utils/diagnosticsSummary.ts`; test → `apps/desktop/src/utils/__tests__/diagnosticsSummary.test.ts` (mirrors `criteriaVerification.ts` + its test).
- Component → `apps/desktop/src/components/settings/DiagnosticsPanel.tsx` (+ `.css`); **export from the `index.ts` barrel** (currently exports `SettingsPage`, `WorkflowConfigSection`).
- Mount in `SettingsPage.tsx` next to `<WorkflowConfigSection />` (line 256).

**Frontend `DiagnosticsReport` mirror (camelCase, matches Rust serde):**
`{ frameworkVersion: string | null; stateValid: boolean; schemaVersion: number | null; activeWorkCount: number; releaseChecks: { version: string; location: "active" | "archive"; status: string; archivedButActive: boolean }[]; recentReleasesMissingJson: string[]; reconcilerHookInstalled: boolean }`

**KEY DECISION — `archivedButActive` is NOT a warning.** It is `true` for ALL ~38 archived releases by design. `diagnosticsSummary` must flip top-level `status` to `"warnings"` ONLY for genuine drift:
- `stateValid === false` (serious)
- `recentReleasesMissingJson.length > 0` (history↔JSON parity gap)
- `reconcilerHookInstalled === false` (config gap)

`archivedButActive` may appear as an **informational/neutral** finding (e.g. "N archived releases retain an 'active' status (expected)") but must not, by itself, make the panel show warnings. Encode this in the vitest: a report whose only "issue" is archivedButActive must summarize to `healthy`.

**Visual SC caveat:** the running installed v0.8.2 binary lacks `tiki_doctor` — the user must verify via `pnpm tauri:dev` (which rebuilds the Rust backend from source, so the command IS present there), NOT the installed app.
