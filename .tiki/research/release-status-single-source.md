---
topic: release-status-single-source
tags: [releases, status, doctor, location, desktop]
issues: [276]
created: 2026-06-13T16:50:00Z
---

# Release status: location is the sole truth (#276)

REVIEW map, verified vs code 2026-06-13.

## Principle adopted
Location (`releases/` vs `releases/archive/`) is the SOLE source of the `archived` truth. The JSON `status` field is KEPT but must AGREE with location (archived ⟹ status "shipped"); it never independently drives a lifecycle decision. This kills the dual-encoding *conflict* (they can't disagree once enforced) without the churn of removing a required field everywhere.

## Read/write sites (the surface)

WRITES:
- `ReleaseDialog.tsx:146` — create/edit defaults `status:"active"`. CORRECT for a live (non-archived) release; leave it.
- Rust `save_tiki_release` (commands.rs:385-410) — blind serializer; no normalization. Leave.
- `release.md:869-875` ship teardown — already INSTRUCTS setting status→"shipped" on archive (prose, LLM-remembered → the v0.9.0/#258 footgun when dropped).

READS (lifecycle decisions):
- `releaseDisplayStatus.ts:isReleaseCompleted()` — `archived OR status===shipped OR status===completed`. The status disjuncts are the footgun-fallback. Since #259 made `archived` always survive IPC (Rust stamps it from location on every load), the status fallback is dead weight on the desktop path AND the exact place a stale status could mislead. → **Phase 1: drop the status disjuncts; archived-only.**
- `tiki_doctor` archivedButActive (commands.rs:905-912) = `r.archived && status==Active` — info-only, true for ~all archived by design. → **Phase 2: reframe to actionable + auto-fix.**
- `check-release-readiness.mjs:39` — reads def from either location, ignores status. → **Phase 3: warn when an archived def's status ≠ shipped.**
- `reconcile-state.mjs` release teardown (#271) — location-based, ignores status. Leave.

## Schema note
There is NO JSON schema for the release DEF file (state.schema.json covers release WORK entries, not the `.tiki/releases/<v>.json` def). `TikiReleaseStatus{Active,Completed,Shipped,NotPlanned}` is desktop-only (Rust state.rs:627 + frontend tikiReleasesStore.ts:8). So no schema-parity work here; this is a behavior+doctor fix.

## Plan (3 independent phases — disjoint files, parallelizable)

1. **Desktop UI location-only** — `releaseDisplayStatus.ts isReleaseCompleted` → `Boolean(release.archived)` only (drop status disjuncts). Update `releaseDisplayStatus.test.ts` (the "fallback to status" cases become "archived is the only signal"; a shipped release that is NOT archived — which shouldn't exist — is now correctly NOT completed). Audit no OTHER desktop code branches on `status` for a decision (badges/gating). Files: releaseDisplayStatus.ts + its test only.
2. **Doctor auto-fix** — new Rust command `normalize_archived_releases(tiki_path)` that rewrites every `releases/archive/<v>.json` whose status≠shipped to `status:"shipped"` (atomic write; returns count fixed). Reframe `archivedButActive`: keep computing it but in `diagnosticsSummary.ts` surface it as an ACTIONABLE finding (offer Fix) only when count>0 AND make the DiagnosticsPanel show a "Normalize" button that invokes the command then reloads. cargo test (normalizes a stale-active archived def, leaves shipped ones) + vitest for the summary. Files: state.rs/commands.rs (command + register in invoke_handler), diagnosticsSummary.ts, DiagnosticsPanel.tsx, their tests.
3. **Gate** — `check-release-readiness.mjs`: when validating a release whose def is in `archive/`, warn (soft, non-zero only if you want hard) if its status ≠ "shipped" — the v0.9.0 footgun catch. Add a `--fix`? No — keep the gate read-only; it flags, the doctor fixes. Framework test in check-release-readiness.test.mjs. Files: check-release-readiness.mjs + its test. (check-release-readiness.mjs is NOT referenced by command bodies at runtime — it's a CI/release gate — but it IS in the canonical scripts dir, so if edited, dogfood regen may be needed; verify via plugin-distribution parity at the final gate.)

## Tests to keep green
- commands.rs: load_tiki_releases_marks_archived_by_location_not_status (1225), tiki_release_archived_survives_serialization (1262, #259 guard), tiki_doctor_flags_archived_but_active_release (1396 — may need updating if the finding semantics change; keep it asserting the COMPUTE is correct, adjust only the summary-level interpretation in diagnosticsSummary.test.ts).
- frontend: releaseDisplayStatus.test.ts (phase 1 updates), releaseArchiveLoad.test.ts (includeArchived guard — untouched), diagnosticsSummary.test.ts (phase 2 updates).
- framework: check-release-readiness.test.mjs (phase 3 adds a case).
