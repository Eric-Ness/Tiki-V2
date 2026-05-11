//! Integration tests pinning the legacy state-format compatibility shims in
//! `state.rs`. Every fixture under `tests/fixtures/` represents a historical
//! or current shape of `.tiki/state.json`. The tests load each fixture,
//! deserialize through `TikiState`, serialize back to JSON, re-parse, and
//! assert canonical fields are preserved.
//!
//! The point is *not* to test serde itself — it's to lock down the behavior
//! of `RawIssueContext`, `RawOldPhases`, `RawPhaseArrayItem`,
//! `deserialize_lenient_phase`, `deserialize_lenient_phases`, and the custom
//! `Deserialize for IssueContext` impl. When someone removes one of those
//! shims in a future refactor, these tests must catch the regression.

use std::path::PathBuf;

use tiki_desktop_lib::state::{
    PhaseProgressStatus, PipelineStep, TikiState, WorkContext, WorkStatus,
};

fn fixture_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push(name);
    p
}

fn load(name: &str) -> TikiState {
    let path = fixture_path(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {}", path.display(), e));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("failed to parse {}: {}", path.display(), e))
}

/// Round-trip a fixture: deserialize, re-serialize, re-deserialize. Returns
/// the final TikiState so individual tests can make further assertions.
fn round_trip(name: &str) -> TikiState {
    let original = load(name);
    let serialized = serde_json::to_string(&original)
        .unwrap_or_else(|e| panic!("failed to re-serialize {}: {}", name, e));
    serde_json::from_str(&serialized)
        .unwrap_or_else(|e| panic!("failed to re-parse round-tripped {}: {}", name, e))
}

fn expect_issue<'a>(state: &'a TikiState, key: &str) -> &'a tiki_desktop_lib::state::IssueContext {
    let work = state
        .active_work
        .get(key)
        .unwrap_or_else(|| panic!("missing activeWork key: {}", key));
    match work {
        WorkContext::Issue(ctx) => ctx,
        _ => panic!("expected Issue at {}", key),
    }
}

#[test]
fn legacy_flat_format_normalizes_issue_number_and_started_at() {
    // The legacy format stored issueNumber + title at top level and used
    // startedAt instead of createdAt. The custom Deserialize impl in
    // state.rs should fold both into the canonical IssueRef and created_at.
    let state = round_trip("legacy-flat.json");
    let ctx = expect_issue(&state, "issue:42");
    assert_eq!(ctx.issue.number, 42, "issueNumber should populate issue.number");
    assert_eq!(
        ctx.issue.title.as_deref(),
        Some("Legacy flat-format issue"),
        "top-level title should populate issue.title"
    );
    assert_eq!(ctx.status, WorkStatus::Executing);
    assert_eq!(ctx.pipeline_step, Some(PipelineStep::Execute));
    assert_eq!(
        ctx.created_at, "2025-12-01T10:00:00.000Z",
        "startedAt should normalize to created_at"
    );
}

#[test]
fn legacy_phases_object_normalizes_into_phase_progress() {
    // Old format: phases: { total, completed, current: { number, status } }
    // The deserialize_lenient_phases shim should turn this into a
    // canonical PhaseProgress.
    let state = round_trip("legacy-phases-object.json");
    let ctx = expect_issue(&state, "issue:55");
    let phase = ctx
        .phase
        .as_ref()
        .expect("legacy phases-object should derive a PhaseProgress");
    assert_eq!(phase.total, 4, "phases.total preserved");
    assert_eq!(phase.current, 3, "phases.current.number preserved");
    assert_eq!(
        phase.status,
        PhaseProgressStatus::Executing,
        "current phase status preserved"
    );
}

#[test]
fn legacy_phases_array_derives_current_and_total() {
    // Issue #66 style: phases is an array of {id, title, status} and
    // currentPhase + totalPhases are at the top level. Should normalize.
    let state = round_trip("legacy-phases-array.json");
    let ctx = expect_issue(&state, "issue:66");
    let phase = ctx
        .phase
        .as_ref()
        .expect("array phases + flat currentPhase/totalPhases should yield PhaseProgress");
    assert_eq!(phase.current, 2, "currentPhase preserved");
    assert_eq!(phase.total, 3, "totalPhases preserved");
    assert_eq!(phase.status, PhaseProgressStatus::Executing);
}

#[test]
fn canonical_current_format_round_trips_intact() {
    let state = round_trip("canonical-current.json");
    let ctx = expect_issue(&state, "issue:100");
    assert_eq!(ctx.issue.number, 100);
    assert_eq!(ctx.issue.title.as_deref(), Some("Canonical current-format issue"));
    assert_eq!(ctx.issue.state.as_deref(), Some("OPEN"));
    assert_eq!(
        ctx.issue.url.as_deref(),
        Some("https://github.com/Eric-Ness/Tiki-V2/issues/100")
    );
    assert_eq!(ctx.status, WorkStatus::Executing);
    assert_eq!(ctx.pipeline_step, Some(PipelineStep::Execute));
    let phase = ctx.phase.as_ref().expect("phase preserved");
    assert_eq!(phase.current, 2);
    assert_eq!(phase.total, 4);
    assert_eq!(phase.status, PhaseProgressStatus::Executing);
    assert_eq!(ctx.audit_passed, Some(true));

    let history = state.history.as_ref().expect("history block preserved");
    let last = history.last_completed_issue.as_ref().expect("lastCompletedIssue");
    assert_eq!(last.number, 99);
}

#[test]
fn parallel_execution_field_preserved() {
    let state = round_trip("with-parallel-execution.json");
    let ctx = expect_issue(&state, "issue:110");
    let pe = ctx
        .parallel_execution
        .as_ref()
        .expect("parallelExecution field should be preserved");
    assert_eq!(pe.phases, vec![1, 2, 3]);
    assert_eq!(pe.completed_in_group, vec![1]);
    assert_eq!(pe.total_in_group, 3);
    assert_eq!(pe.started_at, "2026-05-05T14:00:00.000Z");
}

#[test]
fn parent_release_field_preserved_on_child_issue() {
    let state = round_trip("with-parent-release.json");

    // The release entry itself.
    let release = state
        .active_work
        .get("release:v0.3.0")
        .expect("release entry present");
    match release {
        WorkContext::Release(r) => {
            assert_eq!(r.release.version, "v0.3.0");
            assert_eq!(r.release.issues, vec![144, 145, 146]);
            assert_eq!(r.release.current_issue, Some(145));
            assert_eq!(r.release.completed_issues, vec![144]);
        }
        _ => panic!("release:v0.3.0 should be a Release"),
    }

    // The child issue.
    let ctx = expect_issue(&state, "issue:145");
    assert_eq!(
        ctx.parent_release.as_deref(),
        Some("v0.3.0"),
        "parentRelease must persist through round-trip"
    );
    let phase = ctx.phase.as_ref().expect("phase preserved");
    assert_eq!(phase.current, 3);
    assert_eq!(phase.total, 5);
}

#[test]
fn every_fixture_round_trips_without_panic() {
    // Smoke test: load + reserialize every fixture. If any one of them
    // fails to deserialize cleanly, this fails loudly. Acts as an
    // index — adding a new fixture but forgetting to register it in
    // FIXTURES below will leave the new file silently untested.
    const FIXTURES: &[&str] = &[
        "legacy-flat.json",
        "legacy-phases-object.json",
        "legacy-phases-array.json",
        "canonical-current.json",
        "with-parallel-execution.json",
        "with-parent-release.json",
    ];
    for fx in FIXTURES {
        let _ = round_trip(fx);
    }
}
