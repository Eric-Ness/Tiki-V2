//! Typed Tauri IPC for state.json mutations.
//!
//! Issue #144: framework command files (execute.md, yolo.md, ship.md, ...)
//! used to instruct Claude to mutate `.tiki/state.json` via long prose
//! "you MUST write this JSON" blocks. That contract was enforced only by
//! prompt obedience — when Claude drifted the schema, the desktop app desynced.
//!
//! This module exposes a single typed Tauri command, `state_transition`,
//! that:
//!
//! 1. Reads `.tiki/state.json` (resilient against atomic-write races).
//! 2. Looks up (or creates) the work entry for `work_id` (e.g. `"issue:42"`,
//!    `"release:v1.2"`).
//! 3. Validates the requested status transition against
//!    [`is_legal_transition`].
//! 4. Applies the new status / pipelineStep / phase / parallelExecution /
//!    parentRelease fields and bumps `lastActivity`.
//! 5. Atomically writes the result back via [`fs_utils::atomic_write`].
//!
//! The matching Node CLI shim lives in
//! `packages/framework/scripts/state.mjs` — it implements the same
//! validation in JavaScript so framework commands invoked via Claude Code's
//! Bash tool (which has no direct Tauri IPC access) can drive the same shape.
//!
//! ## Backward compatibility
//!
//! This command is *additive*. The legacy "Claude writes raw JSON to
//! state.json" path is still fully supported — the lenient serde shims in
//! `state.rs` (`RawIssueContext`, `RawOldPhases`, etc.) continue to absorb
//! drifted formats from older framework versions. Removing those shims is
//! deliberately out of scope (separate issue).

use crate::fs_utils;
use crate::state::{
    IssueContext, IssueRef, ParallelExecution, PhaseProgress, PipelineStep,
    ReleaseContext, ReleaseRef, TikiState, WorkContext, WorkStatus,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Input for a state transition. Marshalled from the frontend (or the CLI
/// shim, which produces the same JSON shape).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionInput {
    /// Stable key identifying the work item, e.g. `"issue:42"` or `"release:v1.2"`.
    pub work_id: String,
    /// Target status. Validated against [`is_legal_transition`] when the
    /// entry already exists.
    pub to_status: WorkStatus,
    /// Optional pipeline step to record alongside the status change.
    #[serde(default)]
    pub to_step: Option<PipelineStep>,
    /// Optional phase progress payload (current / total / status).
    #[serde(default)]
    pub phase: Option<PhaseProgress>,
    /// Optional parallel-execution group payload (set when starting a
    /// parallel group, cleared when the group finishes).
    #[serde(default)]
    pub parallel_execution: Option<ParallelExecution>,
    /// If set, attach `parentRelease` to the issue entry (only honored for
    /// `WorkContext::Issue`).
    #[serde(default)]
    pub parent_release: Option<String>,
    /// When creating a NEW issue entry (typical for the GET step), pass the
    /// `IssueRef` here. Ignored for existing entries.
    #[serde(default)]
    pub issue: Option<IssueRef>,
    /// When creating a NEW release entry, pass the `ReleaseRef` here.
    /// Ignored for existing entries.
    #[serde(default)]
    pub release: Option<ReleaseRef>,
    /// Override the .tiki path. Defaults to `<cwd>/.tiki`.
    #[serde(default)]
    pub tiki_path: Option<String>,
}

/// Is moving from `from` → `to` a legal status transition?
///
/// The state machine is intentionally permissive: it rejects only the
/// transitions that would clearly corrupt the model (e.g. resurrecting a
/// `Completed` item back to `Executing`). It allows the recovery paths used
/// by `<auto-heal>` and the manual pause/resume flows.
///
/// Canonical table: `packages/shared/src/types/transitions.ts`. This file
/// mirrors that table and must be kept in sync with the JS shim at
/// `packages/framework/scripts/state.mjs`.
pub fn is_legal_transition(from: &WorkStatus, to: &WorkStatus) -> bool {
    use WorkStatus::*;

    // Same-state transitions are always allowed (idempotent re-write of
    // current status with new metadata, e.g. parallel group updates while
    // status stays "executing").
    if from == to {
        return true;
    }

    match (from, to) {
        // From pending: any forward step or a pause/fail.
        (Pending, Reviewing) | (Pending, Planning) | (Pending, Executing)
        | (Pending, Paused) | (Pending, Failed) => true,

        // From reviewing: continue forward or pause/fail.
        (Reviewing, Planning) | (Reviewing, Executing) | (Reviewing, Paused)
        | (Reviewing, Failed) => true,

        // From planning: into execution or pause/fail.
        (Planning, Executing) | (Planning, Paused) | (Planning, Failed) => true,

        // From executing: forward to shipping, or pause/fail/retry. The
        // (Executing, Completed) arm is the short-circuit path that bypasses
        // the SHIP pipeline step.
        (Executing, Shipping) | (Executing, Paused) | (Executing, Failed) | (Executing, Completed) => true,

        // From shipping: terminal or fail.
        (Shipping, Completed) | (Shipping, Failed) => true,

        // From paused: rewind to any earlier active state. This is the
        // "fix and resume" path documented in pause-conditions.
        (Paused, Pending) | (Paused, Reviewing) | (Paused, Planning)
        | (Paused, Executing) | (Paused, Shipping) => true,

        // From failed: any recovery path. <auto-heal> and the manual recovery
        // options need this to be open.
        (Failed, Pending) | (Failed, Reviewing) | (Failed, Planning)
        | (Failed, Executing) => true,

        // Completed is terminal. Nothing escapes it.
        (Completed, _) => false,

        // Anything not listed is illegal.
        _ => false,
    }
}

/// Mutate `state` to apply `input`. Creates a new entry if the work_id is
/// not yet present; otherwise validates the transition is legal before
/// touching the existing entry.
///
/// Returns the human-readable error if validation fails or the work_id is
/// malformed.
pub fn apply_transition(state: &mut TikiState, input: TransitionInput) -> Result<(), String> {
    // Decide whether this is an issue or release based on the work_id prefix.
    let is_issue = input.work_id.starts_with("issue:");
    let is_release = input.work_id.starts_with("release:");
    if !is_issue && !is_release {
        return Err(format!(
            "invalid work_id '{}': must start with 'issue:' or 'release:'",
            input.work_id
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // If the entry exists, check the transition is legal first.
    if let Some(existing) = state.active_work.get(&input.work_id) {
        let from = match existing {
            WorkContext::Issue(ctx) => &ctx.status,
            WorkContext::Release(ctx) => &ctx.status,
        };
        if !is_legal_transition(from, &input.to_status) {
            return Err(format!(
                "illegal transition for {}: {:?} -> {:?}",
                input.work_id, from, input.to_status
            ));
        }
    }

    // Insert or update the entry.
    let existing = state.active_work.remove(&input.work_id);

    let new_entry: WorkContext = if is_issue {
        let mut ctx = match existing {
            Some(WorkContext::Issue(c)) => c,
            Some(WorkContext::Release(_)) => {
                return Err(format!(
                    "work_id '{}' was previously a release, cannot retype as issue",
                    input.work_id
                ));
            }
            None => {
                // Fresh entry — require an IssueRef payload to seed the issue
                // field. This is the GET-step case.
                let issue_ref = input.issue.clone().ok_or_else(|| {
                    format!(
                        "creating new entry {} requires an 'issue' payload",
                        input.work_id
                    )
                })?;
                IssueContext {
                    issue: issue_ref,
                    status: input.to_status.clone(),
                    pipeline_step: input.to_step.clone(),
                    pipeline_history: None,
                    phase: None,
                    parallel_execution: None,
                    created_at: now.clone(),
                    last_activity: Some(now.clone()),
                    audit_passed: None,
                    yolo: None,
                    commit: None,
                    parent_release: input.parent_release.clone(),
                }
            }
        };

        // Apply the transition to the (possibly fresh) IssueContext.
        ctx.status = input.to_status.clone();
        if input.to_step.is_some() {
            ctx.pipeline_step = input.to_step.clone();
        }
        if input.phase.is_some() {
            ctx.phase = input.phase.clone();
        }
        // Parallel execution: set or clear explicitly via the input. We can't
        // distinguish "no change" from "clear" with Option<...> alone, so the
        // convention is: callers that want to clear pass null in the JSON,
        // which deserializes to `Some(None)` only with a wrapper. For now,
        // we treat a present input as "set"; a separate clear path is the
        // caller's responsibility (write a follow-up transition with no
        // parallel_execution and ctx.parallel_execution stays unless we
        // explicitly clear via the new field). To keep behavior simple:
        // if the new status is Shipping or Completed, clear the field.
        if input.parallel_execution.is_some() {
            ctx.parallel_execution = input.parallel_execution.clone();
        }
        if matches!(input.to_status, WorkStatus::Shipping | WorkStatus::Completed) {
            ctx.parallel_execution = None;
        }
        // parentRelease: only set if the input explicitly carries one. Never
        // overwrite an existing parent_release with None — preservation is
        // the contract per ship.md.
        if input.parent_release.is_some() {
            ctx.parent_release = input.parent_release.clone();
        }
        ctx.last_activity = Some(now.clone());
        WorkContext::Issue(ctx)
    } else {
        // Release branch.
        let mut ctx = match existing {
            Some(WorkContext::Release(c)) => c,
            Some(WorkContext::Issue(_)) => {
                return Err(format!(
                    "work_id '{}' was previously an issue, cannot retype as release",
                    input.work_id
                ));
            }
            None => {
                let release_ref = input.release.clone().ok_or_else(|| {
                    format!(
                        "creating new entry {} requires a 'release' payload",
                        input.work_id
                    )
                })?;
                ReleaseContext {
                    release: release_ref,
                    status: input.to_status.clone(),
                    pipeline_step: input.to_step.clone(),
                    created_at: now.clone(),
                    last_activity: Some(now.clone()),
                }
            }
        };
        ctx.status = input.to_status.clone();
        if input.to_step.is_some() {
            ctx.pipeline_step = input.to_step.clone();
        }
        ctx.last_activity = Some(now.clone());
        WorkContext::Release(ctx)
    };

    state.active_work.insert(input.work_id.clone(), new_entry);
    Ok(())
}

/// Resolve the `.tiki/` directory for this transition. Mirrors the helper in
/// `commands.rs` but private so we don't add cross-module visibility.
fn resolve_tiki_path(tiki_path: Option<String>) -> Result<PathBuf, String> {
    match tiki_path {
        Some(p) => Ok(PathBuf::from(p)),
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            Ok(cwd.join(".tiki"))
        }
    }
}

/// Tauri command: apply a typed state transition and persist it atomically.
///
/// Returns the updated `TikiState` so the frontend can refresh its caches
/// without a separate `get_state` round-trip.
#[tauri::command]
pub fn state_transition(input: TransitionInput) -> Result<TikiState, String> {
    let path = resolve_tiki_path(input.tiki_path.clone())?;
    let state_file = path.join("state.json");

    // Read the existing state, or initialize a fresh one if missing.
    let mut state = fs_utils::read_json_resilient::<TikiState>(&state_file)?
        .unwrap_or_else(|| TikiState {
            schema_version: 1,
            active_work: HashMap::new(),
            history: None,
        });

    apply_transition(&mut state, input)?;

    // Persist atomically so the watcher doesn't see partial JSON.
    let content = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs_utils::atomic_write(&state_file, &content)?;

    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{IssueContext, IssueRef, PhaseProgress, PhaseProgressStatus};

    fn fresh_state() -> TikiState {
        TikiState {
            schema_version: 1,
            active_work: HashMap::new(),
            history: None,
        }
    }

    fn issue_ref(n: u32) -> IssueRef {
        IssueRef {
            number: n,
            title: Some(format!("Issue {}", n)),
            body: None,
            state: None,
            labels: None,
            label_details: None,
            url: None,
            created_at: None,
            updated_at: None,
        }
    }

    /// Forge an existing IssueContext in `state` at the requested status. We
    /// can't call `apply_transition` to set up arbitrary fixture states
    /// because the from→to validation would reject some setups, so we insert
    /// the entry directly.
    fn seed_issue(state: &mut TikiState, num: u32, status: WorkStatus, parent: Option<&str>) {
        let ctx = IssueContext {
            issue: issue_ref(num),
            status,
            pipeline_step: None,
            pipeline_history: None,
            phase: None,
            parallel_execution: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_activity: Some("2026-01-01T00:00:00Z".to_string()),
            audit_passed: None,
            yolo: None,
            commit: None,
            parent_release: parent.map(|s| s.to_string()),
        };
        state
            .active_work
            .insert(format!("issue:{}", num), WorkContext::Issue(ctx));
    }

    #[test]
    fn test_legal_transitions() {
        // Each pair must be accepted.
        let legal = [
            (WorkStatus::Pending, WorkStatus::Reviewing),
            (WorkStatus::Reviewing, WorkStatus::Planning),
            (WorkStatus::Planning, WorkStatus::Executing),
            (WorkStatus::Executing, WorkStatus::Shipping),
            (WorkStatus::Shipping, WorkStatus::Completed),
            (WorkStatus::Executing, WorkStatus::Executing), // idempotent
        ];
        for (from, to) in legal {
            assert!(
                is_legal_transition(&from, &to),
                "expected {:?} -> {:?} to be legal",
                from,
                to
            );
        }
    }

    #[test]
    fn test_illegal_transitions() {
        let illegal = [
            (WorkStatus::Completed, WorkStatus::Executing),
            (WorkStatus::Completed, WorkStatus::Pending),
            (WorkStatus::Completed, WorkStatus::Reviewing),
            (WorkStatus::Completed, WorkStatus::Failed),
            // Skipping the lifecycle backwards from shipping to pending is
            // disallowed — the recovery path goes through `failed`.
            (WorkStatus::Shipping, WorkStatus::Pending),
            (WorkStatus::Shipping, WorkStatus::Reviewing),
        ];
        for (from, to) in illegal {
            assert!(
                !is_legal_transition(&from, &to),
                "expected {:?} -> {:?} to be illegal",
                from,
                to
            );
        }
    }

    #[test]
    fn test_paused_recovery() {
        // Pausing then resuming back into any active state must work.
        assert!(is_legal_transition(&WorkStatus::Paused, &WorkStatus::Executing));
        assert!(is_legal_transition(&WorkStatus::Paused, &WorkStatus::Planning));
        assert!(is_legal_transition(&WorkStatus::Paused, &WorkStatus::Shipping));
    }

    #[test]
    fn test_failed_recovery() {
        // Failed -> Executing is the retry path. Failed -> Pending is the
        // "start over" path. Both must be legal. Failed -> Shipping is now
        // an illegal path per the canonical table in
        // packages/shared/src/types/transitions.ts.
        assert!(is_legal_transition(&WorkStatus::Failed, &WorkStatus::Executing));
        assert!(is_legal_transition(&WorkStatus::Failed, &WorkStatus::Pending));
        assert!(!is_legal_transition(&WorkStatus::Failed, &WorkStatus::Shipping));
    }

    #[test]
    fn test_executing_to_completed() {
        // Short-circuit path that bypasses the SHIP pipeline step.
        assert!(is_legal_transition(&WorkStatus::Executing, &WorkStatus::Completed));
    }

    #[test]
    fn test_parent_release_preserved() {
        // Seed an issue with parentRelease and ship it. The entry must stay
        // in active_work with status=Completed and parent_release intact.
        let mut state = fresh_state();
        seed_issue(&mut state, 42, WorkStatus::Shipping, Some("v0.3.0"));

        let input = TransitionInput {
            work_id: "issue:42".to_string(),
            to_status: WorkStatus::Completed,
            to_step: Some(PipelineStep::Ship),
            phase: None,
            parallel_execution: None,
            parent_release: None, // do NOT pass one — preservation must come from the existing entry
            issue: None,
            release: None,
            tiki_path: None,
        };

        apply_transition(&mut state, input).expect("transition should succeed");
        let entry = state.active_work.get("issue:42").expect("entry preserved");
        match entry {
            WorkContext::Issue(ctx) => {
                assert_eq!(ctx.status, WorkStatus::Completed);
                assert_eq!(ctx.parent_release.as_deref(), Some("v0.3.0"));
                assert_eq!(ctx.pipeline_step, Some(PipelineStep::Ship));
            }
            _ => panic!("entry should remain an Issue"),
        }
    }

    #[test]
    fn test_creates_new_entry() {
        // Empty state + transition for a fresh issue must create the entry
        // from the supplied IssueRef payload.
        let mut state = fresh_state();
        let input = TransitionInput {
            work_id: "issue:99".to_string(),
            to_status: WorkStatus::Pending,
            to_step: Some(PipelineStep::Get),
            phase: None,
            parallel_execution: None,
            parent_release: Some("v0.3.0".to_string()),
            issue: Some(issue_ref(99)),
            release: None,
            tiki_path: None,
        };
        apply_transition(&mut state, input).expect("fresh create");
        let entry = state.active_work.get("issue:99").expect("entry created");
        match entry {
            WorkContext::Issue(ctx) => {
                assert_eq!(ctx.issue.number, 99);
                assert_eq!(ctx.status, WorkStatus::Pending);
                assert_eq!(ctx.pipeline_step, Some(PipelineStep::Get));
                assert_eq!(ctx.parent_release.as_deref(), Some("v0.3.0"));
                assert!(ctx.last_activity.is_some());
            }
            _ => panic!("expected an Issue entry"),
        }
    }

    #[test]
    fn test_last_activity_bumped() {
        let mut state = fresh_state();
        seed_issue(&mut state, 7, WorkStatus::Pending, None);
        let original_last = match state.active_work.get("issue:7").unwrap() {
            WorkContext::Issue(c) => c.last_activity.clone(),
            _ => unreachable!(),
        };

        let input = TransitionInput {
            work_id: "issue:7".to_string(),
            to_status: WorkStatus::Reviewing,
            to_step: Some(PipelineStep::Review),
            phase: None,
            parallel_execution: None,
            parent_release: None,
            issue: None,
            release: None,
            tiki_path: None,
        };
        apply_transition(&mut state, input).unwrap();
        let new_last = match state.active_work.get("issue:7").unwrap() {
            WorkContext::Issue(c) => c.last_activity.clone(),
            _ => unreachable!(),
        };
        assert_ne!(original_last, new_last, "last_activity should be bumped");
    }

    #[test]
    fn test_phase_progress_set() {
        // Apply a transition that sets phase progress. Verify it's stored.
        let mut state = fresh_state();
        seed_issue(&mut state, 1, WorkStatus::Planning, None);
        let input = TransitionInput {
            work_id: "issue:1".to_string(),
            to_status: WorkStatus::Executing,
            to_step: Some(PipelineStep::Execute),
            phase: Some(PhaseProgress {
                current: 2,
                total: 5,
                status: PhaseProgressStatus::Executing,
            }),
            parallel_execution: None,
            parent_release: None,
            issue: None,
            release: None,
            tiki_path: None,
        };
        apply_transition(&mut state, input).unwrap();
        match state.active_work.get("issue:1").unwrap() {
            WorkContext::Issue(c) => {
                let p = c.phase.as_ref().expect("phase should be set");
                assert_eq!(p.current, 2);
                assert_eq!(p.total, 5);
                assert_eq!(p.status, PhaseProgressStatus::Executing);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_rejects_illegal_transition_with_existing_entry() {
        // Seed a Completed entry. Attempt to push it back to Executing — must error.
        let mut state = fresh_state();
        seed_issue(&mut state, 5, WorkStatus::Completed, None);
        let input = TransitionInput {
            work_id: "issue:5".to_string(),
            to_status: WorkStatus::Executing,
            to_step: None,
            phase: None,
            parallel_execution: None,
            parent_release: None,
            issue: None,
            release: None,
            tiki_path: None,
        };
        let err = apply_transition(&mut state, input).expect_err("must reject");
        assert!(
            err.contains("illegal transition"),
            "error should mention illegal transition, got: {}",
            err
        );
    }

    #[test]
    fn test_invalid_work_id() {
        let mut state = fresh_state();
        let input = TransitionInput {
            work_id: "garbage:9".to_string(),
            to_status: WorkStatus::Pending,
            to_step: None,
            phase: None,
            parallel_execution: None,
            parent_release: None,
            issue: None,
            release: None,
            tiki_path: None,
        };
        let err = apply_transition(&mut state, input).expect_err("must reject");
        assert!(err.contains("invalid work_id"));
    }
}
