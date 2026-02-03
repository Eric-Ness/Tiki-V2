use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Main Tiki state structure matching state.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiState {
    pub schema_version: u32,
    pub active_work: HashMap<String, WorkContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<History>,
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

/// Context for working on a single issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueContext {
    pub issue: IssueRef,
    pub status: WorkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<PhaseProgress>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_passed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yolo: Option<bool>,
}

/// Reference to a GitHub issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRef {
    pub number: u32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Phase progress tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseProgress {
    pub total: u32,
    pub current: u32,
    pub status: PhaseProgressStatus,
}

/// Status of the current phase
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PhaseProgressStatus {
    Pending,
    Running,
    Executing,
    Completed,
    Failed,
}

/// Context for working on a release
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseContext {
    pub version: String,
    pub issues: Vec<u32>,
    pub status: WorkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_issue: Option<u32>,
    pub completed_issues: Vec<u32>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
}

/// Status of a work context
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    Pending,
    Planning,
    Executing,
    Paused,
    Completed,
    Failed,
    Shipping,
}

/// History tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_completed_issue: Option<CompletedIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_completed_release: Option<CompletedRelease>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedIssue {
    pub number: u32,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedRelease {
    pub version: String,
    pub completed_at: String,
}

/// Plan structure matching plan.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikiPlan {
    pub issue: IssueInfo,
    pub created_at: String,
    pub success_criteria: Vec<SuccessCriterion>,
    pub phases: Vec<Phase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_matrix: Option<HashMap<String, Vec<u32>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueInfo {
    pub number: u32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessCriterion {
    pub id: String,
    pub category: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase {
    pub number: u32,
    pub title: String,
    pub status: PhaseStatus,
    pub content: String,
    pub verification: Vec<String>,
    pub addresses_criteria: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
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
    #[serde(rename = "in_progress")]
    InProgress,
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
