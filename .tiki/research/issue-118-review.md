# REVIEW — Issue #118: Stale Work Detection and Cleanup

## Success Criteria

1. Any `activeWork` entry with `status` not in `{'paused', 'completed', 'failed', 'shipping'}` and whose `lastActivity` (or `createdAt` as fallback) is older than the configured staleness threshold is marked stale in the frontend.
2. A warning indicator (icon + muted/dimmed CSS class) is visible on stale `WorkProgressCard` items in the sidebar "Active Work" section.
3. The stale timestamp is displayed on the card in human-readable relative form (e.g. "last activity 3h ago").
4. A toast notification fires once per newly-detected stale item (not on every poll tick): `"Issue #N has been executing for 26h with no activity"` — type `'warning'`.
5. Three quick actions are available on stale cards: **Pause** (sets `status: paused`), **Reset to pending** (sets `status: pending`, clears `phase`), and **Remove** (removes the key from `activeWork`). All three modify state.json directly via a new `update_work_status` IPC command.
6. A "Staleness Threshold" setting (in hours, default 24) is persisted in `settingsStore` under a new `workflow.stalenessThresholdHours` field and wired to a number input in `SettingsPage`.
7. Stale detection runs at app startup and on a 5-minute frontend interval. It does not run in Rust.

## Key Code Touchpoints

**State shape**
- `apps/desktop/src-tauri/src/state.rs` — `IssueContext.last_activity: Option<String>`. `WorkStatus` enum includes `Paused`.
- `apps/desktop/src/components/work/WorkCard.tsx` — frontend `IssueContext`/`ReleaseContext` types mirror Rust.
- `apps/desktop/src/stores/tikiStateStore.ts` — Zustand store with `activeWork: Record<string, WorkContext>`.

**Active Work UI**
- `apps/desktop/src/components/sidebar/StateSection.tsx` — renders WorkProgressCard for each activeWork entry.
- `apps/desktop/src/components/sidebar/WorkProgressCard.tsx` — primary card; add stale class, warning icon, relative timestamp, action buttons.

**Toast system** (already exists from #84)
- `apps/desktop/src/stores/toastStore.ts` — `addToast(message, 'warning', duration?)`. Respects `settings.notifications.enabled`.

**Settings**
- `apps/desktop/src/stores/settingsStore.ts` — `WorkflowSettings` interface; `updateWorkflow` action; persists via zustand/persist.
- `apps/desktop/src/components/settings/SettingsPage.tsx` — Workflow section is the natural home.

**IPC / Rust mutation (new work)**
- `apps/desktop/src-tauri/src/commands.rs` — add `update_work_status` (read → mutate → atomic_write).
- `apps/desktop/src-tauri/src/fs_utils.rs` — atomic_write and read_json_resilient already exist.

**Timer pattern reference**
- `apps/desktop/src/components/sidebar/ClaudeUsageSection.tsx` — 60-second setInterval inside useEffect.
- `apps/desktop/src/hooks/useElapsedTimer.ts` — 1-second timer hook pattern.

## Dependencies and Risks

- Toast system: ready (no scope-creep).
- Settings persistence: backward-compatible by adding default in initialState spread.
- New IPC command: must use atomic_write for state.json mutation. Low risk if implemented carefully.
- Toast deduplication: keep a `Set<string>` of already-notified work IDs, reset when item becomes non-stale.
- Concurrency: detection is read-only frontend; mutation goes through Rust atomic_write — same primitive used for releases.

## Open Questions / Decisions

1. **Stale detection logic location** → Custom hook `useStaleWorkDetection(activeWork, thresholdHours)`.
2. **Quick actions IPC** → New Rust IPC `update_work_status({workId, action: 'pause' | 'reset' | 'remove'})`.
3. **Remove action** → Include with a confirmation dialog (similar to Kanban ship-confirmation pattern).
4. **Action button placement** → Inline buttons revealed on hover (CSS `:hover` reveal).

## Out of Scope

- Modifying framework commands (`execute.md`, `ship.md`) — they already write `lastActivity`.
- Dedicated "stale work" panel — sidebar card treatment is sufficient.
- Per-work-item custom thresholds — single global setting.
- Native OS notifications — toast satisfies the requirement.

## Essential Files

- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/fs_utils.rs`
- `apps/desktop/src/components/work/WorkCard.tsx`
- `apps/desktop/src/stores/tikiStateStore.ts`
- `apps/desktop/src/stores/settingsStore.ts`
- `apps/desktop/src/stores/toastStore.ts`
- `apps/desktop/src/components/sidebar/WorkProgressCard.tsx`
- `apps/desktop/src/components/sidebar/StateSection.tsx`
- `apps/desktop/src/components/settings/SettingsPage.tsx`
- `apps/desktop/src/hooks/useElapsedTimer.ts`
- `apps/desktop/src/App.tsx`
