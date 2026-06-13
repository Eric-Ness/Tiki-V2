use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Main Tiki state structure matching state.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiState {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub active_work: HashMap<String, WorkContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<History>,
}

fn default_schema_version() -> u32 {
    1
}

/// A single work context (issue or release)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkContext {
    #[serde(rename = "issue")]
    Issue(IssueContext),
    #[serde(rename = "release")]
    Release(ReleaseContext),
}

/// Context for working on a single issue (canonical format).
/// Custom Deserialize handles both new (nested issue/phase/createdAt) and
/// old flat format (issueNumber/title/startedAt/phases).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueContext {
    pub issue: IssueRef,
    pub status: WorkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_step: Option<PipelineStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_history: Option<Vec<PipelineStepRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<PhaseProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallel_execution: Option<ParallelExecution>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_passed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yolo: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_release: Option<String>,
}

// --- Raw helper structs for deserializing both old and new formats ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssueContext {
    // New format: nested issue object
    #[serde(default)]
    issue: Option<IssueRef>,
    // Old format: flat issue number
    #[serde(default, alias = "issueNumber")]
    issue_number: Option<u32>,
    // Old format: title at root level
    #[serde(default)]
    title: Option<String>,

    status: WorkStatus,

    #[serde(default)]
    pipeline_step: Option<PipelineStep>,

    // New format: flat phase progress (lenient: skip if unparseable)
    #[serde(default, deserialize_with = "deserialize_lenient_phase")]
    phase: Option<PhaseProgress>,
    // Parallel phase execution group (optional, only set during multi-phase parallel groups)
    #[serde(default)]
    parallel_execution: Option<ParallelExecution>,
    // Old/array format: phases as object or array (lenient: skip if unparseable)
    #[serde(default, deserialize_with = "deserialize_lenient_phases")]
    phases: Option<RawPhasesVariant>,

    // Flat phase fields (issue #66 style: currentPhase/totalPhases at top level)
    #[serde(default)]
    current_phase: Option<u32>,
    #[serde(default)]
    total_phases: Option<u32>,

    // New format timestamp
    #[serde(default)]
    created_at: Option<String>,
    // Old format timestamp
    #[serde(default)]
    started_at: Option<String>,

    #[serde(default)]
    last_activity: Option<String>,
    #[serde(default)]
    audit_passed: Option<bool>,
    #[serde(default)]
    yolo: Option<bool>,
    #[serde(default)]
    commit: Option<String>,
    #[serde(default)]
    parent_release: Option<String>,
    #[serde(default)]
    pipeline_history: Option<Vec<PipelineStepRecord>>,
}

/// Leniently deserialize phase progress — returns None if unparseable instead of erroring
fn deserialize_lenient_phase<'de, D>(deserializer: D) -> Result<Option<PhaseProgress>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|v| serde_json::from_value(v).ok()))
}

/// Leniently deserialize phases — handles both old object format and array format
fn deserialize_lenient_phases<'de, D>(deserializer: D) -> Result<Option<RawPhasesVariant>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(v) => {
            // Try old object format first
            if let Ok(old) = serde_json::from_value::<RawOldPhases>(v.clone()) {
                return Ok(Some(RawPhasesVariant::OldObject(old)));
            }
            // Try array format (issue #66 style)
            if let Ok(arr) = serde_json::from_value::<Vec<RawPhaseArrayItem>>(v) {
                return Ok(Some(RawPhasesVariant::Array(arr)));
            }
            Ok(None)
        }
    }
}

/// Phases can be either the old object format or the new array format
enum RawPhasesVariant {
    OldObject(RawOldPhases),
    Array(Vec<RawPhaseArrayItem>),
}

/// Array format phase item (issue #66 style: [{id, title, status}, ...])
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct RawPhaseArrayItem {
    #[serde(alias = "id")]
    number: u32,
    #[serde(default)]
    title: Option<String>,
    #[serde(default = "default_phase_status_pending")]
    status: PhaseStatus,
}

fn default_phase_status_pending() -> PhaseStatus {
    PhaseStatus::Pending
}

/// Old format: phases object with nested current
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct RawOldPhases {
    total: u32,
    #[serde(default)]
    completed: Option<u32>,
    #[serde(default)]
    current: Option<RawOldCurrentPhase>,
}

/// Old format: current phase as an object
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct RawOldCurrentPhase {
    number: u32,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: PhaseProgressStatus,
}

impl Default for PhaseProgressStatus {
    fn default() -> Self {
        PhaseProgressStatus::Pending
    }
}

impl<'de> Deserialize<'de> for IssueContext {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawIssueContext::deserialize(deserializer)?;

        // Normalize issue info: prefer nested object, fall back to flat fields
        let issue = raw.issue.unwrap_or_else(|| IssueRef {
            number: raw.issue_number.unwrap_or(0),
            title: raw.title.clone(),
            body: None,
            state: None,
            labels: None,
            label_details: None,
            url: None,
            created_at: None,
            updated_at: None,
        });

        // Normalize phase: prefer new flat format, then old/array phases, then flat currentPhase/totalPhases
        let phase = raw.phase.or_else(|| {
            match raw.phases {
                Some(RawPhasesVariant::OldObject(p)) => {
                    let (current, status) = p.current.map_or(
                        (0, PhaseProgressStatus::Pending),
                        |c| (c.number, c.status),
                    );
                    Some(PhaseProgress {
                        total: p.total,
                        current,
                        status,
                    })
                }
                Some(RawPhasesVariant::Array(arr)) => {
                    let total = raw.total_phases.unwrap_or(arr.len() as u32);
                    let current = raw.current_phase.unwrap_or_else(|| {
                        // Derive current from the first executing phase, or last completed + 1
                        arr.iter()
                            .find(|p| p.status == PhaseStatus::Executing)
                            .map(|p| p.number)
                            .unwrap_or_else(|| {
                                arr.iter()
                                    .filter(|p| p.status == PhaseStatus::Completed)
                                    .map(|p| p.number)
                                    .max()
                                    .map(|n| n + 1)
                                    .unwrap_or(1)
                            })
                    });
                    // Derive status from the current phase in the array
                    let status = arr.iter()
                        .find(|p| p.number == current)
                        .map(|p| match p.status {
                            PhaseStatus::Pending => PhaseProgressStatus::Pending,
                            PhaseStatus::Executing => PhaseProgressStatus::Executing,
                            PhaseStatus::Completed => PhaseProgressStatus::Completed,
                            PhaseStatus::Failed => PhaseProgressStatus::Failed,
                            PhaseStatus::Skipped => PhaseProgressStatus::Completed,
                        })
                        .unwrap_or(PhaseProgressStatus::Pending);
                    Some(PhaseProgress { total, current, status })
                }
                None => {
                    // Fall back to flat currentPhase/totalPhases without phases array
                    match (raw.current_phase, raw.total_phases) {
                        (Some(current), Some(total)) => Some(PhaseProgress {
                            total,
                            current,
                            status: PhaseProgressStatus::Executing,
                        }),
                        _ => None,
                    }
                }
            }
        });

        // Normalize timestamp: prefer createdAt, fall back to startedAt
        let created_at = raw
            .created_at
            .or(raw.started_at)
            .unwrap_or_default();

        Ok(IssueContext {
            issue,
            status: raw.status,
            pipeline_step: raw.pipeline_step,
            pipeline_history: raw.pipeline_history,
            phase,
            parallel_execution: raw.parallel_execution,
            created_at,
            last_activity: raw.last_activity,
            audit_passed: raw.audit_passed,
            yolo: raw.yolo,
            commit: raw.commit,
            parent_release: raw.parent_release,
        })
    }
}

/// GitHub label with full metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLabelInfo {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Reference to a GitHub issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRef {
    pub number: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_details: Option<Vec<GitHubLabelInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Phase progress tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseProgress {
    pub total: u32,
    pub current: u32,
    pub status: PhaseProgressStatus,
}

/// Parallel execution tracking (optional, present only during multi-phase parallel groups).
/// When this field is set on an IssueContext, multiple phases are running concurrently
/// in separate sub-agents. When all phases in the group complete, this field is cleared
/// and execution advances to the next group/level.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelExecution {
    /// Phase numbers currently running in parallel
    pub phases: Vec<u32>,
    /// Phase numbers in this group that have already completed
    #[serde(default)]
    pub completed_in_group: Vec<u32>,
    /// Total phases in this parallel group (for progress display)
    pub total_in_group: u32,
    /// ISO timestamp when the group started
    pub started_at: String,
}

/// Status of the current phase
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PhaseProgressStatus {
    Pending,
    #[serde(alias = "running", alias = "in_progress")]
    Executing,
    Completed,
    Failed,
}

/// Context for working on a release
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseContext {
    pub release: ReleaseRef,
    pub status: WorkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_step: Option<PipelineStep>,
    #[serde(default)]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
}

/// Reference to a release
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRef {
    pub version: String,
    #[serde(default)]
    pub issues: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_issue: Option<u32>,
    #[serde(default)]
    pub completed_issues: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

/// Status of a work context
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    Pending,
    Reviewing,
    Planning,
    #[serde(alias = "running", alias = "in_progress", alias = "in-progress")]
    Executing,
    Paused,
    Completed,
    Failed,
    Shipping,
}

/// Pipeline step in the Tiki workflow
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PipelineStep {
    Get,
    Review,
    Plan,
    Audit,
    Execute,
    Ship,
}

/// Record of a pipeline step with timing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepRecord {
    pub step: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// History tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_completed_issue: Option<CompletedIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_completed_release: Option<CompletedRelease>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent_issues: Option<Vec<CompletedIssue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent_releases: Option<Vec<CompletedReleaseRecord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedIssue {
    pub number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedRelease {
    pub version: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedReleaseRecord {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<u32>>,
    pub completed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Deserialize an optional field that may be a single string or an array of strings
fn deserialize_option_string_or_vec<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrVec {
        Str(String),
        Vec(Vec<String>),
    }

    Ok(Option::<StringOrVec>::deserialize(deserializer)?.map(|v| match v {
        StringOrVec::Str(s) => vec![s],
        StringOrVec::Vec(v) => v,
    }))
}

/// Plan structure matching plan.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiPlan {
    /// Standard format: issue object. Optional to allow old format with issueNumber.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<IssueInfo>,
    /// Old format alias: bare issue number at top level
    #[serde(default, alias = "issueNumber", skip_serializing_if = "Option::is_none")]
    pub issue_number: Option<u32>,
    /// Old format alias: bare title at top level
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    #[serde(default)]
    pub success_criteria: Option<Vec<SuccessCriterion>>,
    pub phases: Vec<Phase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_matrix: Option<HashMap<String, Vec<u32>>>,
    /// True once AUDIT passed. The on-disk artifact the state reconciler uses to
    /// distinguish AUDIT from PLAN (audit emits no other durable signal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audited: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueInfo {
    pub number: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessCriterion {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase {
    #[serde(alias = "id")]
    pub number: u32,
    #[serde(alias = "name")]
    pub title: String,
    pub status: PhaseStatus,
    #[serde(default, alias = "description", skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, deserialize_with = "deserialize_option_string_or_vec", skip_serializing_if = "Option::is_none")]
    pub verification: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addresses_criteria: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tasks: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PhaseStatus {
    Pending,
    #[serde(alias = "running", alias = "in_progress", alias = "in-progress")]
    Executing,
    Completed,
    Failed,
    Skipped,
}

/// Tiki Release - local release with associated issues
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiRelease {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub status: TikiReleaseStatus,
    pub issues: Vec<TikiReleaseIssue>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// True when this release was loaded from `releases/archive/` (i.e. shipped).
    /// Derived from file LOCATION at load time, never from the JSON: the ship
    /// teardown `mv`s a release into `archive/` without flipping `status`, so an
    /// archived file can still say `"status":"active"`.
    ///
    /// MUST stay serialized. Tauri serializes IPC command return values with this
    /// same derived `Serialize` impl, and the desktop sidebar + detail panel derive
    /// "completed" from `archived` (the on-disk `status` is unreliable). A
    /// `skip_serializing` here strips the field from the IPC payload too, so the
    /// frontend reads `undefined`, falls back to the stale `"active"` status, and
    /// every shipped release shows a stale "active" badge — the #255/#258 bug class.
    /// The persisted value is meaningless: `read_release_dir` overwrites it from the
    /// file's location on every load, so writing it to disk is inert. Guarded by
    /// `tiki_release_archived_survives_serialization` in `commands.rs`.
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiReleaseIssue {
    pub number: u32,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TikiReleaseStatus {
    Active,
    Completed,
    Shipped,
    NotPlanned,
}

/// Read-only health report for a `.tiki/` workspace, produced by the `tiki_doctor`
/// command. Surfaces drift like the #259 archived/status class so it is visible
/// in-app instead of discovered by eye. Gathered without mutating any state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    /// Contents of `.tiki/.framework-version`, or `None` if the file is absent.
    pub framework_version: Option<String>,
    /// Whether `.tiki/state.json` parses as `TikiState`.
    pub state_valid: bool,
    /// `schemaVersion` from `state.json`, or `None` if it did not parse.
    pub schema_version: Option<u32>,
    /// Number of entries in `state.json` `activeWork`.
    pub active_work_count: usize,
    /// One entry per release JSON under `releases/` and `releases/archive/`.
    pub release_checks: Vec<ReleaseCheck>,
    /// Versions in `state.json` `history.recentReleases` that have no matching
    /// JSON file in either `releases/` or `releases/archive/` (a parity gap).
    pub recent_releases_missing_json: Vec<String>,
    /// Whether `.claude/settings.json` registers `reconcile-state.mjs` in a
    /// `Stop` / `SubagentStop` hook.
    pub reconciler_hook_installed: bool,
    /// Project-relative script paths (forward-slash form, e.g.
    /// `.claude/tiki/scripts/state.mjs`) that Tiki command bodies depend on but
    /// that do not exist on disk. Empty = healthy; non-empty on plugin-only
    /// installs where the scripts were never copied (#268).
    #[serde(default)]
    pub unresolved_script_paths: Vec<String>,
    /// Whether `.claude/commands/tiki/` exists — the copy-install channel
    /// marker. The frontend uses it to judge whether a missing settings.json
    /// reconciler hook is genuine drift (copy install) or expected plugin
    /// behavior (#268).
    #[serde(default)]
    pub copy_install_detected: bool,
}

/// One release file's consistency check within a `DiagnosticsReport`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheck {
    pub version: String,
    /// `"active"` (read from `releases/`) or `"archive"` (read from `releases/archive/`).
    pub location: String,
    /// The release JSON's own `status` field, lowercased (e.g. `"active"`, `"shipped"`).
    pub status: String,
    /// `true` when a file under `archive/` still has `status: "active"`. NOTE: this is
    /// the *normal resting state* for every shipped release — the ship teardown `mv`s a
    /// release into `archive/` without flipping `status`, and #259 made the file's
    /// location (not `status`) the source of truth. So it is `true` for ALL archived
    /// releases here; it is informational, not necessarily a problem to fix.
    pub archived_but_active: bool,
}
