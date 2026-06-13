# Architecture Review — June 2026

> Produced 2026-06-12 from a full-codebase deep dive (docs, state system, Rust backend,
> React frontend, framework commands) plus an archaeology pass over ~63 bug-relevant
> GitHub issues. This document is the persistent record of the diagnosis and the
> prioritized worklist. Issues filed from it should reference it rather than restate it.
>
> Status of work items is tracked in GitHub issues, not here. This doc records *why*.

## 1. What Tiki is, structurally

Tiki is a state machine whose **executor is an LLM**. The pipeline
(GET→REVIEW→PLAN→AUDIT→EXECUTE→SHIP) is defined in ~3,000 lines of markdown prose that
Claude reads and follows. State lives in `.tiki/state.json`, mutated through a Node shim
(`state.mjs`) with a mirrored Rust IPC implementation; a Tauri desktop app watches the
files and renders them; GitHub holds the work itself. Every recurring sync problem traces
back to the fact that the component driving state transitions is probabilistic and has no
compiler.

A telling signal: the test suite contains **eight separate regex-based source-scan "guard
tests"** (freshRefGuard, releaseArchiveLoad, transitions-parity, mutation-parity,
command-transition-coverage, commands-sync, plugin-distribution,
release-readiness-guard). Each pins a bug class that already bit once. Guards accumulating
at this rate means the bugs are structural — each guard is a fence around a hole the
architecture keeps re-digging.

## 2. Root-cause diagnosis (six causes, ranked by pain explained)

### 2.1 State is *reported*, not *derived* (the original sin)

Correct state depends on the LLM remembering to emit `state.mjs transition` at ~11
distinct points across the pipeline. Skip any one and the kanban freezes. The v0.7.5
investigation (#244) proved this empirically — worktrees, drift, and the watcher were all
exonerated; the freezes were always a forgotten transition call.

The reconciler (#244/#245–249) is the right instinct but is a backstop bolted onto a
report-based architecture, deliberately limited by its safety contract:

- **Cannot create entries** — a dropped GET leaves the issue invisible forever. This is
  why #268 (plugin installs) is fatal rather than self-healing.
- **Cannot heal GET/REVIEW** (no distinguishing artifact), **cannot heal SHIP/completed**
  (only history membership counts — and appending history is itself an LLM-remembered
  step), **skips `release:*` entries entirely**.
- Runs only on Stop/SubagentStop hooks, so there is always a mid-turn freeze window.

The truth hierarchy is inverted: durable artifacts (plan file exists, `audited:true`,
`phases[].status`, archived locations, git commits, closed GitHub issues) already encode
nearly the entire pipeline position. `state.json` could be a projection of them; instead
it is an independent parallel record kept in sync by discipline.

### 2.2 The same truth is encoded in 3–4 places, kept in sync by regex

- **Transition table**: three copies (transitions.ts "canonical", state.mjs LEGAL map,
  Rust match arms), synced by a test that regex-parses both source files. The TS
  `canTransition()` declared canonical is itself never validated against the mirrors.
- **state.json shape**: four sources of truth (JSON schema, TS types, Rust structs, React
  component types), with *live documented drift*: Rust `PhaseProgressStatus` missing
  `skipped` plus two alias variants; React `PhaseStatus` has `running` but not `skipped`;
  Rust maintains two different phase-status enums (state.json vs plan.json).
- **Command files**: byte-identical mirrors in `packages/framework/commands/` and
  `.claude/commands/tiki/`, synced by another scan test.
- **Mutation semantics**: state_transition.rs vs state.mjs, validated by fixture parity.

Every new field is a four-file change where forgetting one produces silent runtime
divergence, not a build error. The #259 `skip_serializing` bug was exactly this class.

### 2.3 Lenient deserialization hides corruption instead of surfacing it

Rust accepts old flat formats, object-or-array phases, three alias spellings of
`executing`, and converts parse failures to `None` via `.ok()`. Missing files return
`Ok(None)`; corrupt JSON is logged-and-skipped. Bad state doesn't crash — it renders a
stale kanban, discovered days later. There is no schemaVersion migration path, so the
leniency must stay forever, and every lenient branch is a silent divergence point.

### 2.4 Dual encoding of lifecycle status: a field *and* a location

Releases and plans encode "shipped" twice — a `status` field inside the JSON and the
directory the file sits in (`releases/` vs `releases/archive/`). These have disagreed
repeatedly (#142, #143, #255→#258→#259, recurred in the v0.9.0 finalize). The codebase
settled on "location is truth, ignore the field" — but the field is still written, still
read by anything that doesn't know the rule, and the release gate needed special-case
logic for it. A field that must never be trusted is worse than no field.

### 2.5 Distribution is three products sharing one set of hard-coded paths

Command bodies hard-code `node .claude/tiki/scripts/state.mjs`. Resolves in the dogfood
repo (committed) and desktop installs (install.js copies). **Dead on plugin-only installs
(#268)** — `${CLAUDE_PLUGIN_ROOT}` cannot expand in slash-command bodies (per #251's own
red-team), so every transition throws, and per 2.1 nothing can heal it. The yolo.md
direct-JSON fallback writes a legacy-shape blob, unvalidated.

### 2.6 The shim doesn't cover the mutation surface

Four acknowledged direct-JSON bypasses: `parallelExecution`, `successCriteria[].verified`,
`phase.healAttempts[]`, and release.md wave tracking (`currentIssues[]`,
`completedBranches[]`). Each is an unvalidated raw write performed by an LLM following
prose — the exact thing state.mjs exists to prevent.

Causes 2.1 + 2.5 + 2.6 compound: the LLM must remember to call a script, at a path that
may not exist, and for some fields must bypass the script entirely. The reconciler then
reverse-engineers what should have happened — but only for entries that got created at
all.

Smaller contributors: watcher `emit()` failures logged-and-dropped; frontend reload
failures swallowed with no toast or stale indicator; `version-bump.mjs` writes 5 files
non-atomically with no lock; 10-second lock-steal can lose a write if two processes die in
sequence.

## 3. Empirical bug taxonomy (from the issue tracker)

| Bug class | Count | Status |
|---|---|---|
| LLM-forgot-transition (report-not-reconcile) | 8 | Closed by #244 reconciler — **except entry creation** (#268 exploits this) |
| Format / type-mirror / serialization drift | 8 | Instances fixed; the mirroring persists by design |
| UI wiring gaps (dead paths, mis-routed dispatch, missing capability) | 7 | Mostly fixed; kanban backward-drag (#130→#267) still open |
| Watcher / file races / reload flags | 6 | Genuinely closed (re-verified during #244) |
| Multi-surface status divergence | 5 | Closed via deriveDisplayStatus() (#222) |
| Windows shell/process environment | 5 | Fixed case-by-case; nothing pins shell-out hygiene |
| Archive-location vs stale status field | 4 | Defended by convention + gate, not structure; recurred v0.9.0 |
| Path-resolution / distribution channel | 4 | **Only class with an open member: #268** |
| Terminal keyboard/clipboard conflicts | 4 | Fixed; #155→#169→#171 chain was fix-induced |
| Sorting/parsing vs real data | 3 | Fixed; shared comparator declined twice |
| Fresh-ref render loops | 3 | Pinned by freshRefGuard; each occurrence evaded the prior guard |

**~⅓ of all bugs were second occurrences.** Chains: #36→#121, #31→#180, #25→#71,
#120→#148, #210→#212, #54→#57, #255→#258→#259, #130→#267, and the state-freeze reported
under ≥12 numbers (#50, #54, #55, #57, #78, #124, #127, #128, #134, #143, #196, #211)
before #244 found the real cause.

### The five-era state-sync saga

1. **Feb — "the LLM writes it wrong"**: prose CRITICAL instructions, JSON templates
   (#20/#52/#53). #57 found serde silently dropping fields across 4 mirrored type
   representations — "the frontend code added in those fixes was correct, but the data
   never reached it."
2. **May 8–13 — plumbing audit**: watcher races, tikiPath threading, archive split, and
   #147's discovery that release JSON had no framework writer at all.
3. **May 18 — worktree theory (#211)**: real, fixed… freezes continued.
4. **May 21–22 — the true double diagnosis**: #218 fixed the read side (single
   deriveDisplayStatus selector); #244 fixed the write side and empirically exonerated
   every earlier theory. #247 found some drops weren't forgetfulness: audit.md's
   frontmatter lacked the Bash tool — the command *couldn't* run its own transition.
5. **June — #268, the interaction bug**: two individually-correct red-teamed decisions
   (#251's project-relative paths; #245's no-entry-creation) intersect to make plugin
   installs both broken and unhealable. Mature-system bugs live in the seams between
   correct components.

### Meta-patterns

1. **"Fix the instance, decline the abstraction."** #125 asked for a path-join helper →
   got a substitution; #120 offered shared semver → declined → #148; #212 proposed an
   ESLint fresh-ref rule → never built → third strike near #223. Everywhere a real
   abstraction or guard *was* built, the class stopped recurring. The tracker is a
   controlled experiment with a clear result.
2. **Tests guard the artifact, not the behavior** — every major escape went through this
   gap. #244: coverage test grepped that the transition string exists in markdown, not
   that it executes. #259: Rust test asserted the in-memory struct, JS test asserted the
   flag was passed; neither serialized a TikiRelease and checked the key survived IPC.
   #268: distribution tests verify files exist in the package, not that paths resolve in
   a plugin-only layout. Process variant: #258 shipped a misdiagnosis direct-to-main
   because it skipped REVIEW/PLAN/AUDIT.
3. **Silent failure amplifies everything**: no error boundary (#210), swallowed catch
   (#140), snap-back-without-toast (#267), lenient deserialization (#57).
4. **Interactive/visual success criteria routinely ship unverified** (#254, #263 SC4,
   #264 SC3/SC5) and pile up silently.

The three structural fixes shipped so far — #57 (type alignment), #218/#222 (read-side
SSOT), #244 (write-side reconcile) — each stopped their class dead. The architecture
responds to structural fixes.

## 4. The worklist

### Tier 1 — structural (stop re-digging the holes)

1. **Fix #268** (plugin script distribution): SessionStart script-copy +
   `tiki_doctor` unresolved-script-path check + plugin-layout *behavioral* dist test.
   → **Epic 1**
2. **Promote the reconciler from backstop to primary**:
   a. entry creation under a narrow bootstrap rule (active non-archived plan with no
      activeWork entry) — closes the GET hole, makes #268-class failures self-healing;
   b. derive SHIP/completed from closed GitHub issue + archived plan;
   c. reconcile `release:*` entries from child states + release def.
   → **Epic 1**
3. **Intent journal** (`.tiki/journal.ndjson`): each command's first action appends one
   line ({ts, workId, step, event}); reconciler reconstructs state from journal +
   artifacts; state.json becomes a projection; imperative transitions become an
   optimization, not a correctness requirement. The only item that *ends* the freeze
   class rather than shrinking it. → **Epic 1**
4. **Schema-first codegen**: generate TS (json-schema-to-typescript) and Rust (typify)
   from `packages/shared/schemas/`; delete hand-written duplicates and React-local
   copies. Retires the 4-way drift class including live enum mismatches. → Epic 2
5. **Close the shim mutation-surface gaps**: state.mjs flags for parallelExecution +
   release wave fields; a plan.mjs helper for criteria/phase writes; ajv validation at
   write time; delete every "direct JSON write acknowledged" paragraph. → Epic 2
6. **Kill the dual status encoding**: stop writing `status` into release/plan defs;
   doctor + gate flag *and auto-fix* archived defs with status≠shipped. → Epic 2

### Tier 2 — hardening and observability

7. **Behavior-not-artifact testing principle**: serde round-trip test per IPC struct
   (generalize #259's test); plugin-only-layout test that actually invokes state.mjs;
   runtime drop-resilience extended to GET-entry creation. → Epic 3
8. **Build the three declined abstractions**: shared compareSemver in @tiki/shared;
   single path-join/resolve_tiki_path helper (also closes E21); ESLint fresh-ref rule.
   → Epic 3
9. **Generate kanban wiring from transitions.ts**: ALLOWED_MOVES, isValidTransition, the
   drag-dispatch switch, and the backend table are four hand-maintained lists
   (#130→#267); derive or parity-test them; toast on undispatchable drags. → Epic 3
10. **Windows shell-out hygiene wrapper** + source-scan test banning raw Command::new
    outside it (closes the #36/#121/#31/#180/#65 class). → Epic 3
11. **Visual-SC pending-verification surfacing**: readiness gate warns on unverified
    visual SCs in shipped plans; desktop surfaces the pending list. → Epic 3
12. Versioned migration replacing lenient-forever deserialization (schemaVersion exists;
    migrate-once then parse strictly; surface failures via recovery dialog).
13. Frontend error surfacing: toast on watcher-reload failure; stale-data badge; watcher
    health indicator.
14. Expand tiki_doctor into repair (script paths, hooks installed, stale-active archived
    defs, version parity, orphaned lock, journal/state divergence) with per-finding Fix
    buttons.
15. Pipeline integration test harness: fixture repo driving state.mjs through the full
    transition sequence, reconciler with deliberately dropped transitions, plan-schema
    round-trips, readiness gate.
16. CI parity: Windows job in pr.yml (E43); `pnpm build` (tsc -b) in PR CI.
17. Hygiene: E19 (read_json_resilient in load_tiki_releases), version-bump under the
    state lock, watcher heartbeat.

### Tier 3 — product gaps (file individually when wanted)

18. Resolve multi-context design questions (TIKI_CONTEXT env var; stale-context cleanup;
    concurrency limit) — open since 2026-02-02.
19. Backward kanban transitions: wire real transitions with confirm, or visibly refuse.
20. `tiki init` / onboarding (create .tiki, hooks.json, gh auth check, reconciler hook,
    doctor run).
21. Custom-command discovery UI; research front-matter `updated`/`status` + validation
    (E34/E47).
22. Documentation truth pass (E65): rewrite DESIGN.md as ARCHITECTURE.md or archive it;
    CLAUDE.md + CHANGELOG canonical.
23. UX keepers from the E-list: E12 (terminal staleness), E66 (skeletons), E6 (sidebar
    staleness). Formally close E4, E20, E29–E30, E33, E36, E46–E48 as noise.

### Process recommendations

- Bug fixes touching state/serialization/distribution go through at least REVIEW+AUDIT
  (the #258→#259 escape was a direct-to-main shortcut).
- File one epic at a time, ship it, then file the next (the #244 pattern). Do not
  bulk-file this list — that is how E1–E68 went stale.

## 5. Epic plan

- **Epic 1 — Distribution + self-healing** (filed 2026-06-12): #268 fixes, reconciler
  bootstrap + SHIP/release derivation, intent journal. Anchor: #268.
- **Epic 2 — Kill the mirrors** (file when Epic 1 ships): items 4–6.
- **Epic 3 — Guards that test behavior** (file after Epic 2): items 7–11.
- Tier 2 remainder and Tier 3 filed individually as capacity allows.
