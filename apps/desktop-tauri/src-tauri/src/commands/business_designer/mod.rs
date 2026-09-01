use gt_task::{
    ChannelMessageEvent, ChannelMessageType, DispatchSender, DispatchSenderType, TaskAttachment,
    TaskDispatchBatchRequest, TaskDispatchBatchResponse,
};
use rfd::FileDialog;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Emitter, State};

use crate::{app_state::AppState, commands::task_center::write_terminal_with_submit};

pub(crate) mod agent_station;
mod code_gen_prompt;
mod completeness_rules;
mod gap_rules;
mod ui_refs;

const DESIGNER_SCHEMA_VERSION: u32 = 1;
const DOCS_ROOT_RELATIVE: &str = ".gtoffice/docs";
const DOCUMENTS_DIR: &str = "documents";
const TEMPLATES_DIR: &str = "templates";
const DEFAULT_DOC_STATUS: &str = "draft";
const PATCHES_DIR: &str = "patches";
const AGENT_REQUEST_HASH_OFFSET: u64 = 0xcbf29ce484222325;
const AGENT_REQUEST_HASH_PRIME: u64 = 0x100000001b3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// A machine-detected unmet sanity rule, anchored to its host block.
///
/// `key` is the semantic fingerprint used for before/after comparisons.
/// `id` is a snapshot-friendly hash of that key; callers must not persist it
/// as the gap's long-lived identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerGap {
    pub id: String,
    pub key: String,
    pub code: String,
    pub block_id: String,
    pub layer: DesignerGapLayer,
    pub severity: DesignerGapSeverity,
    pub message: String,
    pub fixable_by_agent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locator: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerGapLayer {
    Intra,
    Inter,
    Completeness,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerGapSeverity {
    Info,
    Warning,
    Error,
}

/// One rule firing — pass or fail. The full run is the audit trail of
/// "every machine-checked thing about this graph."
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerRuleRun {
    pub kind: String,
    pub code: String,
    pub block_id: String,
    pub passed: bool,
    pub gap_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerEdgeRelation {
    DependsOn,
    Produces,
    Consumes,
    Uses,
    Extends,
    NavigatesTo,
    ParticipatesIn,
}

/// An edge derived from payload references. v1 does not let users hand-draw
/// edges — broken refs surface as `dangling-ref` gaps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerDerivedEdge {
    pub from_block_id: String,
    pub to_block_id: String,
    pub relation: DesignerEdgeRelation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_field: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerGraphProjection {
    pub links: Vec<DesignerDerivedEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerAgentTaskTarget {
    pub host_block_id: String,
    pub scope: DesignerAgentTaskScope,
    pub gap_codes: Vec<String>,
    pub target_gap_keys: Vec<String>,
    pub target_gaps: Vec<DesignerGap>,
    pub context_gaps: Vec<DesignerGap>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesignerAgentTaskScope {
    Single,
    Block,
}

impl DesignerAgentTaskScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Block => "block",
        }
    }
}

/// Three-tier verdict for an applied patch: which target gaps actually went
/// away, which survived, and which new gaps the patch *introduced*. The verdict
/// comes from rerunning [`gap_rules::run_all`] before and after — the model
/// cannot self-evaluate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerGapResolution {
    pub target_gap_keys: Vec<String>,
    pub resolved: Vec<String>,
    pub unresolved: Vec<String>,
    pub incidental_resolved: Vec<String>,
    pub introduced: Vec<DesignerGap>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerDocumentSummary {
    pub document_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub block_count: usize,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDocumentsResponse {
    pub workspace_id: String,
    pub docs_root: String,
    pub scaffold_initialized: bool,
    pub repo_initialized: bool,
    pub documents: Vec<DesignerDocumentSummary>,
    pub diagnostics: Vec<DesignerDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitDocsRepoResponse {
    pub workspace_id: String,
    pub docs_root: String,
    pub scaffold_created: bool,
    pub repo_initialized: bool,
    pub git_initialized: bool,
    pub templates_written: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ScaffoldResult {
    pub scaffold_created: bool,
    pub templates_written: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerGeneratedPaths {
    pub readme: String,
    pub agent_brief: String,
    pub agent_input: String,
    pub preview_html: String,
    #[serde(default = "default_code_gen_prompt_path")]
    pub code_gen_prompt: String,
}

fn default_code_gen_prompt_path() -> String {
    "generated/code-gen-prompt.md".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerManifest {
    pub schema_version: u32,
    pub document_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub entry: String,
    pub generated: DesignerGeneratedPaths,
    pub tags: Vec<String>,
    pub status: String,
    /// v1: per-block 2D coordinates for the graph canvas.
    /// `None` on legacy documents — UI computes a grid layout on first render.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<HashMap<String, DesignerLayoutPosition>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerLayoutPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerBlockLink {
    pub target_block_id: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerBlock {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub order: u32,
    pub payload: Value,
    #[serde(default)]
    pub links: Vec<DesignerBlockLink>,
    #[serde(default)]
    pub validation: Vec<DesignerDiagnostic>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerDesignGraph {
    pub schema_version: u32,
    pub document_id: String,
    pub revision: String,
    pub title: String,
    pub blocks: Vec<DesignerBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerDocumentDetail {
    pub workspace_id: String,
    pub docs_root: String,
    pub manifest: DesignerManifest,
    pub design: DesignerDesignGraph,
    pub diagnostics: Vec<DesignerDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCompileResult {
    pub workspace_id: String,
    pub document_id: String,
    pub revision: String,
    pub generated: DesignerGeneratedPaths,
    pub files: Vec<String>,
    pub diagnostics: Vec<DesignerDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCheckpointResult {
    pub workspace_id: String,
    pub document_id: String,
    pub commit: Option<String>,
    pub committed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerDiffEntry {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerDiffResult {
    pub workspace_id: String,
    pub document_id: Option<String>,
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub entries: Vec<DesignerDiffEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCheckpointEntry {
    pub commit: String,
    pub short_commit: String,
    pub authored_at: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCheckpointHistoryResult {
    pub workspace_id: String,
    pub document_id: Option<String>,
    pub entries: Vec<DesignerCheckpointEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerPatchBlock {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub order: Option<u32>,
    pub payload: Value,
    #[serde(default)]
    pub links: Vec<DesignerBlockLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum DesignerPatchOperation {
    #[serde(rename = "addBlock")]
    Add {
        #[serde(default)]
        after_block_id: Option<String>,
        block: DesignerPatchBlock,
    },
    #[serde(rename = "updateBlock")]
    Update {
        block_id: String,
        patch: DesignerPatchBlockUpdate,
    },
    #[serde(rename = "deleteBlock")]
    Delete { block_id: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerPatchBlockUpdate {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub order: Option<u32>,
    #[serde(default)]
    pub payload: Option<Value>,
    #[serde(default)]
    pub links: Option<Vec<DesignerBlockLink>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerAgentPatch {
    pub schema_version: u32,
    pub document_id: String,
    pub base_revision: String,
    pub summary: String,
    #[serde(default)]
    pub changes: Vec<DesignerPatchOperation>,
    #[serde(default)]
    pub open_questions: Vec<String>,
    /// v1: host block this patch is anchored to. `apply_agent_patch` rejects
    /// any change outside this block and rejects add/delete operations.
    pub host_block_id: String,
    /// v1: gap codes the Agent was told to fix. Used to compute the
    /// resolved/unresolved verdict after applying the patch.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gap_codes: Vec<String>,
    /// v1: exact target gap fingerprints captured at preview/dispatch time.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_gap_keys: Vec<String>,
    /// v1: completion scope as recorded at dispatch time.
    /// `"single"` = one gap, `"block"` = all gaps in host block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<DesignerAgentTaskScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerPatchPreviewChange {
    pub op: String,
    pub block_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    pub destructive: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerPatchValidationResult {
    pub workspace_id: String,
    pub document_id: String,
    pub patch_path: Option<String>,
    pub patch: DesignerAgentPatch,
    pub diagnostics: Vec<DesignerDiagnostic>,
    pub changes: Vec<DesignerPatchPreviewChange>,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerRecoveredAgentPatchResult {
    pub workspace_id: String,
    pub document_id: String,
    pub task_id: String,
    pub source_message_id: String,
    pub source_agent_id: String,
    pub source_message_type: String,
    pub validation: DesignerPatchValidationResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerPatchApplyResult {
    pub workspace_id: String,
    pub document_id: String,
    pub applied_revision: String,
    pub patch_path: String,
    pub accepted_changes: Vec<usize>,
    pub skipped_changes: Vec<usize>,
    pub detail: DesignerDocumentDetail,
    pub diagnostics: Vec<DesignerDiagnostic>,
    /// v1: three-tier verdict — driven by rerunning `gap_rules`, not by the model.
    pub gap_resolution: DesignerGapResolution,
    /// v1: gaps after applying the patch, ready for the UI to render.
    pub gaps: Vec<DesignerGap>,
    /// v1: full rule run audit trail.
    pub rules_run: Vec<DesignerRuleRun>,
    /// v1: graph projection after applying the patch.
    pub graph_projection: DesignerGraphProjection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerExportResult {
    pub workspace_id: String,
    pub document_id: String,
    pub format: String,
    pub suggested_file_name: String,
    pub mime_type: String,
    pub content: String,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCodingTask {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub acceptance_refs: Vec<String>,
    pub contract_refs: Vec<String>,
    pub risk_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCodingHandoffPreview {
    pub workspace_id: String,
    pub document_id: String,
    pub title: String,
    pub revision: String,
    pub request: TaskDispatchBatchRequest,
    pub tasks: Vec<DesignerCodingTask>,
    pub attachments: Vec<TaskAttachment>,
    pub diagnostics: Vec<DesignerDiagnostic>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCodingHandoffDispatchRequest {
    pub workspace_id: String,
    pub document_id: String,
    pub target_agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerCodingHandoffDispatchResult {
    pub workspace_id: String,
    pub document_id: String,
    pub preview: DesignerCodingHandoffPreview,
    pub dispatch: TaskDispatchBatchResponse,
}

/// Request to dispatch a v1 host-anchored Agent completion.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerAgentCompletionRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub target_agent_ids: Vec<String>,
    pub host_block_id: String,
    /// v1: gap codes the Agent should fix. `apply_agent_patch_at` later
    /// re-runs gap rules and reports resolved/unresolved/introduced.
    #[serde(default)]
    pub gap_codes: Vec<String>,
    /// v1: `"single"` (one gap) or `"block"` (all gaps in host).
    #[serde(default)]
    pub scope: Option<DesignerAgentTaskScope>,
    pub base_revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesignerAgentCompletionResult {
    pub workspace_id: String,
    pub document_id: String,
    pub request_id: String,
    pub dispatch: TaskDispatchBatchResponse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DesignerFreeformCompletionScenario {
    BriefToDesign,
    CompleteEntity,
    CompleteFlow,
    CompleteApiContract,
    ExpandCanvas,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerRevertToCheckpointRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub checkpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerAgentTaskPreviewCommandRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    #[serde(default)]
    pub selected_block_ids: Vec<String>,
    pub provider: String,
    pub host_block_id: String,
    #[serde(default)]
    pub gap_codes: Vec<String>,
    pub scope: DesignerAgentTaskScope,
    pub base_revision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerMockAgentCompletionCommandRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub host_block_id: String,
    #[serde(default)]
    pub gap_codes: Vec<String>,
    pub scope: DesignerAgentTaskScope,
    pub base_revision: String,
    #[serde(default)]
    pub selected_block_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerValidateAgentPatchCommandRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub patch: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerRecoverAgentPatchCommandRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignerApplyAgentPatchCommandRequest {
    pub trace_id: Option<String>,
    pub workspace_id: String,
    pub document_id: String,
    pub patch: Value,
    pub accepted_change_indices: Option<Vec<usize>>,
}

#[tauri::command]
pub fn business_designer_list_documents(
    workspace_id: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        "listing business designer documents"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(list_documents_at(&workspace_id, &workspace_root)?)
        .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_init_docs_repo(
    workspace_id: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        "initializing business designer docs repository"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let docs_root = docs_root_for(&workspace_root);
    let scaffold = ensure_docs_scaffold_at(&docs_root)?;
    let git_initialized = ensure_docs_git_repository(&docs_root)?;
    let response = InitDocsRepoResponse {
        workspace_id,
        docs_root: relative_docs_root(),
        scaffold_created: scaffold.scaffold_created,
        repo_initialized: docs_root.join(".git").is_dir(),
        git_initialized,
        templates_written: scaffold.templates_written,
    };
    serde_json::to_value(response)
        .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_create_document(
    workspace_id: String,
    document_id: String,
    title: String,
    module: Option<String>,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        "creating business designer document"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(create_document_at(
        &workspace_id,
        &workspace_root,
        &document_id,
        &title,
        module.as_deref(),
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_read_document(
    workspace_id: String,
    document_id: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        "reading business designer document"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(read_document_at(
        &workspace_id,
        &workspace_root,
        &document_id,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_save_document(
    workspace_id: String,
    detail: DesignerDocumentDetail,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %detail.manifest.document_id,
        revision = %detail.design.revision,
        "saving business designer document"
    );
    if detail.workspace_id != workspace_id {
        return Err(
            "BUSINESS_DESIGNER_INVALID_PARAMS: detail.workspaceId must match workspaceId"
                .to_string(),
        );
    }
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(save_document_at(&workspace_id, &workspace_root, detail)?)
        .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_validate_document(
    workspace_id: String,
    document_id: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        "validating business designer document"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    validate_document_at(&workspace_id, &workspace_root, &document_id)
}

pub(crate) fn validate_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
) -> Result<Value, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let diagnostics = validate_design(&detail.manifest, &detail.design);
    let rule_result = gap_rules::run_all(&detail.design);
    let completeness =
        completeness_rules::run_completeness(&detail.design, &rule_result.derived_edges);
    let mut gaps = rule_result.gaps.clone();
    gaps.extend(completeness);
    serde_json::to_value(json!({
        "schemaVersion": DESIGNER_SCHEMA_VERSION,
        "workspaceId": workspace_id,
        "documentId": detail.manifest.document_id,
        "revision": detail.design.revision,
        "diagnostics": diagnostics,
        "gaps": gaps,
        "rulesRun": rule_result.rules_run,
        "graphProjection": graph_projection_from_run(&rule_result),
    }))
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_compile_document(
    workspace_id: String,
    document_id: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        "compiling business designer document"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(compile_document_at(
        &workspace_id,
        &workspace_root,
        &document_id,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_create_checkpoint(
    workspace_id: String,
    document_id: String,
    message: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        "creating business designer checkpoint"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(create_checkpoint_at(
        &workspace_id,
        &workspace_root,
        &document_id,
        &message,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_diff_checkpoint(
    workspace_id: String,
    document_id: Option<String>,
    base: Option<String>,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = document_id.as_deref(),
        base = base.as_deref(),
        "diffing business designer checkpoint"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(diff_checkpoint_at(
        &workspace_id,
        &workspace_root,
        document_id.as_deref(),
        base.as_deref(),
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_compare_checkpoints(
    workspace_id: String,
    document_id: Option<String>,
    base: String,
    head: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = document_id.as_deref(),
        base = %base,
        head = %head,
        "comparing business designer checkpoints"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(compare_checkpoints_at(
        &workspace_id,
        &workspace_root,
        document_id.as_deref(),
        &base,
        &head,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_list_checkpoints(
    workspace_id: String,
    document_id: Option<String>,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = document_id.as_deref(),
        "listing business designer checkpoints"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(list_checkpoints_at(
        &workspace_id,
        &workspace_root,
        document_id.as_deref(),
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_preview_agent_task(
    request: DesignerAgentTaskPreviewCommandRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        host_block_id = %request.host_block_id,
        gap_codes = ?request.gap_codes,
        scope = ?request.scope,
        "previewing business designer agent task"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(preview_agent_task_at(AgentTaskPreviewRequest {
        workspace_id: &workspace_id,
        workspace_root: &workspace_root,
        document_id: &request.document_id,
        selected_block_ids: request.selected_block_ids,
        provider: &request.provider,
        host_block_id: &request.host_block_id,
        gap_codes: request.gap_codes,
        scope: request.scope,
        base_revision: &request.base_revision,
    })?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

pub(crate) struct AgentTaskPreviewRequest<'a> {
    pub workspace_id: &'a str,
    pub workspace_root: &'a Path,
    pub document_id: &'a str,
    pub selected_block_ids: Vec<String>,
    pub provider: &'a str,
    pub host_block_id: &'a str,
    pub gap_codes: Vec<String>,
    pub scope: DesignerAgentTaskScope,
    pub base_revision: &'a str,
}

pub(crate) fn preview_agent_task_at(request: AgentTaskPreviewRequest<'_>) -> Result<Value, String> {
    let detail = read_document_at(
        request.workspace_id,
        request.workspace_root,
        request.document_id,
    )?;
    if request.base_revision != detail.design.revision {
        return Err(format!(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: baseRevision '{}' does not match current revision '{}'",
            request.base_revision, detail.design.revision
        ));
    }
    let rule_run = gap_rules::run_all(&detail.design);
    let target = resolve_agent_task_target(
        &detail,
        &rule_run,
        Some(request.host_block_id),
        request.gap_codes,
        Some(request.scope),
    )?;
    let host_block = detail
        .design
        .blocks
        .iter()
        .find(|block| block.id == target.host_block_id);
    let adjacency = rule_run
        .derived_edges
        .iter()
        .filter(|edge| {
            edge.from_block_id == target.host_block_id || edge.to_block_id == target.host_block_id
        })
        .cloned()
        .collect::<Vec<_>>();
    let status = if target.target_gaps.is_empty() {
        "no_agent_fixable_gaps"
    } else {
        "ready"
    };
    let request_id = build_agent_task_request_id(&detail, &target);
    Ok(json!({
        "workspaceId": request.workspace_id,
        "documentId": detail.manifest.document_id,
        "requestId": request_id,
        "provider": request.provider,
        "status": status,
        "schemaVersion": DESIGNER_SCHEMA_VERSION,
        "selectedBlockIds": request.selected_block_ids,
        "revision": detail.design.revision,
        "contextPath": format!("{DOCS_ROOT_RELATIVE}/{DOCUMENTS_DIR}/{}/design.json", detail.manifest.document_id),
        "outputContract": "directDesignFileEdit",
        "lifecycle": "preview -> validate -> confirm -> dispatch -> agent edits design files -> workspace reloads -> validate -> compile -> checkpoint",
        "hostBlockId": target.host_block_id,
        "gapCodes": target.gap_codes,
        "targetGapKeys": target.target_gap_keys,
        "scope": target.scope,
        "targetGaps": target.target_gaps,
        "contextGaps": target.context_gaps,
        "hostBlock": host_block,
        "adjacency": adjacency,
    }))
}

#[tauri::command]
pub fn business_designer_run_agent_completion(
    request: DesignerAgentCompletionRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        host_block_id = %request.host_block_id,
        gap_codes = ?request.gap_codes,
        target_agent_ids = ?request.target_agent_ids,
        "dispatching business designer agent completion"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let target_agent_ids = normalize_target_agent_ids(request.target_agent_ids)?;
    let detail = read_document_at(&workspace_id, &workspace_root, &request.document_id)?;
    if request.base_revision != detail.design.revision {
        return Err(format!(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: baseRevision '{}' does not match current revision '{}'",
            request.base_revision, detail.design.revision
        ));
    }
    let rule_run = gap_rules::run_all(&detail.design);
    let target = resolve_agent_task_target(
        &detail,
        &rule_run,
        Some(&request.host_block_id),
        request.gap_codes.clone(),
        request.scope,
    )?;
    assert_agent_task_has_target_gaps(&target)?;
    let request_id = build_agent_task_request_id(&detail, &target);
    let markdown = render_design_completion_markdown_with_host(
        &detail,
        &target.host_block_id,
        &target.gap_codes,
        &target.target_gap_keys,
        target.scope,
    );
    let attachments = requirement_package_attachments(&detail);
    let dispatch_request = TaskDispatchBatchRequest {
        workspace_id: workspace_id.clone(),
        sender: DispatchSender {
            sender_type: DispatchSenderType::Human,
            agent_id: None,
        },
        targets: target_agent_ids,
        title: format!("Agent completion: {}", detail.manifest.title),
        markdown,
        attachments,
        submit_sequences: std::collections::HashMap::new(),
    };
    let outcome = state.task_service.dispatch_batch(
        &dispatch_request,
        &workspace_root,
        |session_id, command, submit_sequence| {
            write_terminal_with_submit(state.inner(), session_id, command, submit_sequence)
        },
    );
    for event in &outcome.progress_events {
        let _ = app.emit("task/dispatch_progress", event);
    }
    for event in &outcome.message_events {
        let _ = app.emit("channel/message", event);
    }
    for event in &outcome.ack_events {
        let _ = app.emit("channel/ack", event);
    }
    crate::commands::tool_adapter::bind_task_wait_reply_sessions(
        state.inner(),
        &dispatch_request,
        &outcome.response.results,
    );
    serde_json::to_value(DesignerAgentCompletionResult {
        workspace_id,
        document_id: detail.manifest.document_id.clone(),
        request_id,
        dispatch: outcome.response,
    })
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

/// v1: deterministic mock-provider entry point used by the inspector
/// "Let Agent fix" button when the user has selected the `mock` provider.
/// Synthesizes a host-anchored patch from the rule engine and validates it
/// in one call — no terminal session, no real CLI dispatch.
#[tauri::command]
pub fn business_designer_run_mock_agent_completion(
    request: DesignerMockAgentCompletionCommandRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        host_block_id = %request.host_block_id,
        gap_codes = ?request.gap_codes,
        "running business designer mock agent completion"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(run_mock_agent_completion_at(MockAgentCompletionRequest {
        workspace_id: &workspace_id,
        workspace_root: &workspace_root,
        document_id: &request.document_id,
        host_block_id: &request.host_block_id,
        gap_codes: request.gap_codes,
        scope: Some(request.scope),
        base_revision: &request.base_revision,
        selected_block_ids: &request.selected_block_ids,
    })?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

pub(crate) struct MockAgentCompletionRequest<'a> {
    pub workspace_id: &'a str,
    pub workspace_root: &'a Path,
    pub document_id: &'a str,
    pub host_block_id: &'a str,
    pub gap_codes: Vec<String>,
    pub scope: Option<DesignerAgentTaskScope>,
    pub base_revision: &'a str,
    pub selected_block_ids: &'a [String],
}

pub(crate) fn run_mock_agent_completion_at(
    request: MockAgentCompletionRequest<'_>,
) -> Result<DesignerPatchValidationResult, String> {
    let detail = read_document_at(
        request.workspace_id,
        request.workspace_root,
        request.document_id,
    )?;
    if request.base_revision != detail.design.revision {
        return Err(format!(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: baseRevision '{}' does not match current revision '{}'",
            request.base_revision, detail.design.revision
        ));
    }
    let run = gap_rules::run_all(&detail.design);
    let target = resolve_agent_task_target(
        &detail,
        &run,
        Some(request.host_block_id),
        request.gap_codes,
        request.scope,
    )?;
    assert_agent_task_has_target_gaps(&target)?;
    let patch =
        build_mock_agent_patch_for_host(&detail, "mock", request.selected_block_ids, &target);
    validate_agent_patch_at(
        request.workspace_id,
        request.workspace_root,
        request.document_id,
        serde_json::to_value(&patch)
            .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))?,
        Some("agent-preview"),
    )
}

#[tauri::command]
pub fn business_designer_validate_agent_patch(
    request: DesignerValidateAgentPatchCommandRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        "validating business designer agent patch"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(validate_agent_patch_at(
        &workspace_id,
        &workspace_root,
        &request.document_id,
        request.patch,
        None,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_recover_agent_patch_from_task(
    request: DesignerRecoverAgentPatchCommandRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        task_id = %request.task_id,
        "recovering business designer agent patch from task"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(recover_agent_patch_from_task_at(
        &workspace_id,
        &workspace_root,
        &request.document_id,
        &request.task_id,
        state.inner(),
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_apply_agent_patch(
    request: DesignerApplyAgentPatchCommandRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %request.workspace_id,
        document_id = %request.document_id,
        accepted_change_indices = ?request.accepted_change_indices,
        "applying business designer agent patch"
    );
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(apply_agent_patch_at(
        &workspace_id,
        &workspace_root,
        &request.document_id,
        request.patch,
        request.accepted_change_indices,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_export_document(
    workspace_id: String,
    document_id: String,
    format: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        format = %format,
        "exporting business designer document"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(export_document_at(
        &workspace_id,
        &workspace_root,
        &document_id,
        &format,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_export_document_to_file(
    workspace_id: String,
    document_id: String,
    format: String,
    trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    tracing::info!(
        trace_id = trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %document_id,
        format = %format,
        "exporting business designer document to file"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(export_document_to_file_at(
        &workspace_id,
        &workspace_root,
        &document_id,
        &format,
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_revert_to_checkpoint(
    request: DesignerRevertToCheckpointRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    tracing::info!(
        trace_id = request.trace_id.as_deref(),
        workspace_id = %workspace_id,
        document_id = %request.document_id,
        checkpoint = %request.checkpoint,
        "reverting business designer document to checkpoint"
    );
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let detail = revert_document_to_checkpoint_at(
        &workspace_id,
        &workspace_root,
        &request.document_id,
        &request.checkpoint,
    )?;
    serde_json::to_value(detail)
        .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_preview_coding_handoff(
    workspace_id: String,
    document_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    serde_json::to_value(preview_coding_handoff_at(
        &workspace_id,
        &workspace_root,
        &document_id,
        Vec::new(),
    )?)
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

#[tauri::command]
pub fn business_designer_dispatch_coding_handoff(
    request: DesignerCodingHandoffDispatchRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = normalize_workspace_id(&request.workspace_id)?;
    let workspace_root = resolve_workspace_root(state.inner(), &workspace_id)?;
    let target_agent_ids = normalize_target_agent_ids(request.target_agent_ids)?;
    let preview = preview_coding_handoff_at(
        &workspace_id,
        &workspace_root,
        &request.document_id,
        target_agent_ids,
    )?;
    let outcome = state.task_service.dispatch_batch(
        &preview.request,
        &workspace_root,
        |session_id, command, submit_sequence| {
            write_terminal_with_submit(state.inner(), session_id, command, submit_sequence)
        },
    );
    for event in &outcome.progress_events {
        let _ = app.emit("task/dispatch_progress", event);
    }
    for event in &outcome.message_events {
        let _ = app.emit("channel/message", event);
    }
    for event in &outcome.ack_events {
        let _ = app.emit("channel/ack", event);
    }
    crate::commands::tool_adapter::bind_task_wait_reply_sessions(
        state.inner(),
        &preview.request,
        &outcome.response.results,
    );

    serde_json::to_value(DesignerCodingHandoffDispatchResult {
        workspace_id,
        document_id: preview.document_id.clone(),
        preview,
        dispatch: outcome.response,
    })
    .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

fn normalize_workspace_id(workspace_id: &str) -> Result<String, String> {
    let trimmed = workspace_id.trim();
    if trimmed.is_empty() {
        return Err("BUSINESS_DESIGNER_INVALID_PARAMS: workspaceId is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_target_agent_ids(target_agent_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for value in target_agent_ids {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > 128
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.contains('\0')
        {
            return Err(format!(
                "BUSINESS_DESIGNER_HANDOFF_TARGET_INVALID: invalid target agent id '{trimmed}'"
            ));
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    if normalized.is_empty() {
        return Err(
            "BUSINESS_DESIGNER_HANDOFF_TARGET_INVALID: targetAgentIds must not be empty"
                .to_string(),
        );
    }
    Ok(normalized)
}

fn normalize_task_id(task_id: &str) -> Result<String, String> {
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Err("BUSINESS_DESIGNER_INVALID_PARAMS: taskId is required".to_string());
    }
    if trimmed.len() > 128
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err(format!(
            "BUSINESS_DESIGNER_INVALID_PARAMS: invalid taskId '{trimmed}'"
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_git_revision(revision: &str) -> Result<String, String> {
    let trimmed = revision.trim();
    if trimmed.is_empty() {
        return Err("BUSINESS_DESIGNER_INVALID_PARAMS: git revision is required".to_string());
    }
    if trimmed.len() > 80
        || trimmed.starts_with('-')
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/'))
    {
        return Err(format!(
            "BUSINESS_DESIGNER_INVALID_PARAMS: invalid git revision '{trimmed}'"
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_document_id(document_id: &str) -> Result<String, String> {
    let trimmed = document_id.trim();
    if trimmed.is_empty() {
        return Err("BUSINESS_DESIGNER_INVALID_PARAMS: documentId is required".to_string());
    }
    if trimmed.len() > 96
        || trimmed.starts_with('.')
        || trimmed
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    {
        return Err(format!(
            "BUSINESS_DESIGNER_INVALID_DOCUMENT_ID: invalid documentId '{trimmed}'"
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_title(title: &str) -> Result<String, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("BUSINESS_DESIGNER_INVALID_PARAMS: title is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_workspace_root(state: &AppState, workspace_id: &str) -> Result<PathBuf, String> {
    state
        .workspace_root_path(workspace_id)?
        .canonicalize()
        .map_err(|error| {
            format!(
                "BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}"
            )
        })
}

fn docs_root_for(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".gtoffice").join("docs")
}

fn document_root_for(docs_root: &Path, document_id: &str) -> Result<PathBuf, String> {
    let document_id = normalize_document_id(document_id)?;
    Ok(docs_root.join(DOCUMENTS_DIR).join(document_id))
}

fn relative_docs_root() -> String {
    DOCS_ROOT_RELATIVE.to_string()
}

fn now_iso_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| format!("unix_ms_{}", duration.as_millis()))
        .unwrap_or_else(|_| "unix_ms_0".to_string())
}

fn default_generated_paths() -> DesignerGeneratedPaths {
    DesignerGeneratedPaths {
        readme: "README.md".to_string(),
        agent_brief: "generated/agent-brief.md".to_string(),
        agent_input: "generated/agent-input.json".to_string(),
        preview_html: "generated/preview.html".to_string(),
        code_gen_prompt: "generated/code-gen-prompt.md".to_string(),
    }
}

fn initial_blocks(timestamp: &str) -> Vec<DesignerBlock> {
    vec![
        DesignerBlock {
            id: "overview".to_string(),
            kind: "text".to_string(),
            title: "目标和范围".to_string(),
            order: 10,
            payload: json!({
                "markdown": "描述业务目标、范围和不做什么。"
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.to_string(),
        },
        DesignerBlock {
            id: "domain-model".to_string(),
            kind: "entityModel".to_string(),
            title: "核心实体".to_string(),
            order: 20,
            payload: json!({
                "entityName": "",
                "fields": []
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.to_string(),
        },
        DesignerBlock {
            id: "api-contract".to_string(),
            kind: "apiContract".to_string(),
            title: "API / 事件契约".to_string(),
            order: 30,
            payload: json!({
                "endpoints": [],
                "events": []
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.to_string(),
        },
        DesignerBlock {
            id: "acceptance".to_string(),
            kind: "acceptanceCriteria".to_string(),
            title: "验收标准".to_string(),
            order: 90,
            payload: json!({
                "criteria": []
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.to_string(),
        },
        DesignerBlock {
            id: "agent-instructions".to_string(),
            kind: "agentInstruction".to_string(),
            title: "Agent 编码简报".to_string(),
            order: 100,
            payload: json!({
                "instructions": "按现有架构边界实现，先读代码和契约，再小步验证。"
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.to_string(),
        },
    ]
}

fn create_manifest(
    document_id: &str,
    title: &str,
    module: Option<&str>,
    timestamp: &str,
) -> DesignerManifest {
    DesignerManifest {
        schema_version: DESIGNER_SCHEMA_VERSION,
        document_id: document_id.to_string(),
        title: title.to_string(),
        module: module
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        entry: "design.json".to_string(),
        generated: default_generated_paths(),
        tags: Vec::new(),
        status: DEFAULT_DOC_STATUS.to_string(),
        layout: None,
    }
}

fn create_design_graph(document_id: &str, title: &str, timestamp: &str) -> DesignerDesignGraph {
    DesignerDesignGraph {
        schema_version: DESIGNER_SCHEMA_VERSION,
        document_id: document_id.to_string(),
        revision: timestamp.to_string(),
        title: title.to_string(),
        blocks: initial_blocks(timestamp),
    }
}

pub(crate) fn create_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    title: &str,
    module: Option<&str>,
) -> Result<DesignerDocumentDetail, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_id = normalize_document_id(document_id)?;
    let title = normalize_title(title)?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    ensure_docs_scaffold_at(&docs_root)?;

    let document_root = document_root_for(&docs_root, &document_id)?;
    if document_root.exists() {
        return Err(format!(
            "BUSINESS_DESIGNER_DOCUMENT_EXISTS: document '{document_id}' already exists"
        ));
    }

    fs::create_dir_all(document_root.join("blocks")).map_err(|error| {
        format!("BUSINESS_DESIGNER_CREATE_FAILED: unable to create blocks directory: {error}")
    })?;
    fs::create_dir_all(document_root.join("generated")).map_err(|error| {
        format!("BUSINESS_DESIGNER_CREATE_FAILED: unable to create generated directory: {error}")
    })?;
    fs::create_dir_all(document_root.join("patches")).map_err(|error| {
        format!("BUSINESS_DESIGNER_CREATE_FAILED: unable to create patches directory: {error}")
    })?;

    let timestamp = now_iso_timestamp();
    let manifest = create_manifest(&document_id, &title, module, &timestamp);
    let design = create_design_graph(&document_id, &title, &timestamp);
    atomic_write_json(&document_root.join("manifest.json"), &manifest)?;
    atomic_write_json(&document_root.join("design.json"), &design)?;
    write_block_files(&document_root, &design.blocks)?;
    update_docs_index(&docs_root)?;

    let detail = DesignerDocumentDetail {
        workspace_id: workspace_id.to_string(),
        docs_root: relative_docs_root(),
        diagnostics: validate_design(&manifest, &design),
        manifest,
        design,
    };
    Ok(detail)
}

pub(crate) fn read_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
) -> Result<DesignerDocumentDetail, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_id = normalize_document_id(document_id)?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    let document_root = document_root_for(&docs_root, &document_id)?;
    if !document_root.is_dir() {
        return Err(format!(
            "BUSINESS_DESIGNER_DOCUMENT_NOT_FOUND: document '{document_id}' does not exist"
        ));
    }

    let manifest: DesignerManifest = read_json_file(&document_root.join("manifest.json"))?;
    let mut design: DesignerDesignGraph = read_json_file(&document_root.join(&manifest.entry))?;
    design
        .blocks
        .sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    let diagnostics = validate_design(&manifest, &design);
    Ok(DesignerDocumentDetail {
        workspace_id: workspace_id.to_string(),
        docs_root: relative_docs_root(),
        manifest,
        design,
        diagnostics,
    })
}

pub(crate) fn save_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    mut detail: DesignerDocumentDetail,
) -> Result<DesignerDocumentDetail, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_id = normalize_document_id(&detail.manifest.document_id)?;
    if detail.design.document_id != document_id {
        return Err(
            "BUSINESS_DESIGNER_INVALID_PARAMS: design.documentId must match manifest.documentId"
                .to_string(),
        );
    }

    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    ensure_docs_scaffold_at(&docs_root)?;
    let document_root = document_root_for(&docs_root, &document_id)?;
    fs::create_dir_all(document_root.join("blocks")).map_err(|error| {
        format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to create blocks directory: {error}")
    })?;
    fs::create_dir_all(document_root.join("generated")).map_err(|error| {
        format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to create generated directory: {error}")
    })?;
    fs::create_dir_all(document_root.join("patches")).map_err(|error| {
        format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to create patches directory: {error}")
    })?;

    let timestamp = now_iso_timestamp();
    detail.manifest.schema_version = DESIGNER_SCHEMA_VERSION;
    detail.manifest.document_id = document_id.clone();
    detail.manifest.title = normalize_title(&detail.manifest.title)?;
    detail.manifest.updated_at = timestamp.clone();
    detail.manifest.entry = "design.json".to_string();
    detail.manifest.generated = default_generated_paths();
    let status = detail.manifest.status.trim().to_string();
    detail.manifest.status = if status.is_empty() {
        DEFAULT_DOC_STATUS.to_string()
    } else {
        status
    };

    detail.design.schema_version = DESIGNER_SCHEMA_VERSION;
    detail.design.document_id = document_id.clone();
    detail.design.title = detail.manifest.title.clone();
    detail.design.revision = timestamp.clone();
    detail
        .design
        .blocks
        .sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    for block in &mut detail.design.blocks {
        block.id = normalize_document_id(&block.id)?;
        block.title = block.title.trim().to_string();
        block.updated_at = timestamp.clone();
    }
    let block_ids = detail
        .design
        .blocks
        .iter()
        .map(|block| block.id.clone())
        .collect::<HashSet<_>>();
    if let Some(layout) = detail.manifest.layout.as_mut() {
        layout.retain(|block_id, _| block_ids.contains(block_id));
    }
    for block in &mut detail.design.blocks {
        block.links.clear();
    }

    let diagnostics = validate_design(&detail.manifest, &detail.design);
    if diagnostics.iter().any(|item| item.severity == "error") {
        detail.diagnostics = diagnostics;
        return Ok(detail);
    }

    atomic_write_json(&document_root.join("manifest.json"), &detail.manifest)?;
    atomic_write_json(&document_root.join("design.json"), &detail.design)?;
    write_block_files(&document_root, &detail.design.blocks)?;
    update_docs_index(&docs_root)?;

    read_document_at(workspace_id, &workspace_root, &document_id)
}

pub(crate) fn compile_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
) -> Result<DesignerCompileResult, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let diagnostics = validate_design(&detail.manifest, &detail.design);
    let document_id = detail.manifest.document_id.clone();
    let generated = detail.manifest.generated.clone();
    let mut files = Vec::new();
    if diagnostics.iter().any(|item| item.severity == "error") {
        return Ok(DesignerCompileResult {
            workspace_id: workspace_id.to_string(),
            document_id,
            revision: detail.design.revision,
            generated,
            files,
            diagnostics,
        });
    }

    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    let document_root = document_root_for(&docs_root, &document_id)?;
    ensure_inside_workspace(&workspace_root, &document_root)?;
    fs::create_dir_all(document_root.join("generated")).map_err(|error| {
        format!("BUSINESS_DESIGNER_COMPILE_FAILED: unable to create generated directory: {error}")
    })?;

    let readme_path = document_root.join(&generated.readme);
    let agent_brief_path = document_root.join(&generated.agent_brief);
    let agent_input_path = document_root.join(&generated.agent_input);
    let preview_html_path = document_root.join(&generated.preview_html);
    let contracts_path = document_root.join("generated/contracts.md");
    let acceptance_path = document_root.join("generated/acceptance.md");
    let code_gen_prompt_path = document_root.join(&generated.code_gen_prompt);

    atomic_write_text(&readme_path, &render_readme(&detail))?;
    atomic_write_text(&agent_brief_path, &render_agent_brief(&detail))?;
    atomic_write_json(&agent_input_path, &render_agent_input(&detail))?;
    atomic_write_text(&preview_html_path, &render_preview_html(&detail))?;
    atomic_write_text(&contracts_path, &render_contracts(&detail))?;
    atomic_write_text(&acceptance_path, &render_acceptance(&detail))?;
    atomic_write_text(
        &code_gen_prompt_path,
        &code_gen_prompt::render_code_gen_prompt(&detail),
    )?;

    files.push(generated.readme.clone());
    files.push(generated.agent_brief.clone());
    files.push(generated.agent_input.clone());
    files.push(generated.preview_html.clone());
    files.push("generated/contracts.md".to_string());
    files.push("generated/acceptance.md".to_string());
    files.push(generated.code_gen_prompt.clone());

    Ok(DesignerCompileResult {
        workspace_id: workspace_id.to_string(),
        document_id,
        revision: detail.design.revision,
        generated,
        files,
        diagnostics,
    })
}

pub(crate) fn create_checkpoint_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    message: &str,
) -> Result<DesignerCheckpointResult, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_id = normalize_document_id(document_id)?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    ensure_docs_scaffold_at(&docs_root)?;
    ensure_docs_git_repository(&docs_root)?;

    let detail = read_document_at(workspace_id, &workspace_root, &document_id)?;
    let default_message = format!(
        "designer: checkpoint {} {}",
        detail.manifest.title, detail.design.revision
    );
    let message = if message.trim().is_empty() {
        default_message
    } else {
        message.trim().to_string()
    };

    run_git(&docs_root, &["add", "-A"])?;
    let status = git_status_entries(&docs_root, None)?;
    if status.is_empty() {
        return Ok(DesignerCheckpointResult {
            workspace_id: workspace_id.to_string(),
            document_id,
            commit: None,
            committed: false,
            message,
        });
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&docs_root)
        .arg("-c")
        .arg("user.name=GT Office")
        .arg("-c")
        .arg("user.email=gt-office@local")
        .arg("commit")
        .arg("-m")
        .arg(&message)
        .output()
        .map_err(|error| {
            format!("BUSINESS_DESIGNER_GIT_UNAVAILABLE: unable to run git commit: {error}")
        })?;
    if !output.status.success() {
        return Err(format!(
            "BUSINESS_DESIGNER_CHECKPOINT_FAILED: {}",
            command_stderr(&output.stderr)
        ));
    }

    let commit = run_git(&docs_root, &["rev-parse", "HEAD"])?;
    Ok(DesignerCheckpointResult {
        workspace_id: workspace_id.to_string(),
        document_id,
        commit: Some(String::from_utf8_lossy(&commit).trim().to_string()),
        committed: true,
        message,
    })
}

pub(crate) fn diff_checkpoint_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: Option<&str>,
    base: Option<&str>,
) -> Result<DesignerDiffResult, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    let normalized_document_id = document_id
        .map(normalize_document_id)
        .transpose()?
        .filter(|value| !value.is_empty());
    if !docs_root.join(".git").is_dir() {
        return Ok(DesignerDiffResult {
            workspace_id: workspace_id.to_string(),
            document_id: normalized_document_id,
            base: base.map(str::to_string),
            head: None,
            entries: Vec::new(),
        });
    }

    let pathspec = normalized_document_id
        .as_ref()
        .map(|id| format!("{DOCUMENTS_DIR}/{id}"));
    let entries = if let Some(base) = base.map(str::trim).filter(|value| !value.is_empty()) {
        git_diff_entries(&docs_root, base, pathspec.as_deref())?
    } else {
        git_status_entries(&docs_root, pathspec.as_deref())?
    };

    Ok(DesignerDiffResult {
        workspace_id: workspace_id.to_string(),
        document_id: normalized_document_id,
        base: base.map(str::to_string),
        head: None,
        entries,
    })
}

pub(crate) fn compare_checkpoints_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: Option<&str>,
    base: &str,
    head: &str,
) -> Result<DesignerDiffResult, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    let normalized_document_id = document_id
        .map(normalize_document_id)
        .transpose()?
        .filter(|value| !value.is_empty());
    let base = normalize_git_revision(base)?;
    let head = normalize_git_revision(head)?;
    if !docs_root.join(".git").is_dir() {
        return Ok(DesignerDiffResult {
            workspace_id: workspace_id.to_string(),
            document_id: normalized_document_id,
            base: Some(base),
            head: Some(head),
            entries: Vec::new(),
        });
    }

    let pathspec = normalized_document_id
        .as_ref()
        .map(|id| format!("{DOCUMENTS_DIR}/{id}"));
    let entries = git_diff_between_entries(&docs_root, &base, &head, pathspec.as_deref())?;

    Ok(DesignerDiffResult {
        workspace_id: workspace_id.to_string(),
        document_id: normalized_document_id,
        base: Some(base),
        head: Some(head),
        entries,
    })
}

pub(crate) fn revert_document_to_checkpoint_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    checkpoint: &str,
) -> Result<DesignerDocumentDetail, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_id = normalize_document_id(document_id)?;
    let checkpoint = normalize_git_revision(checkpoint)?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    ensure_docs_scaffold_at(&docs_root)?;
    ensure_docs_git_repository(&docs_root)?;
    let pathspec = format!("{DOCUMENTS_DIR}/{document_id}");
    run_git(&docs_root, &["checkout", &checkpoint, "--", &pathspec])?;
    read_document_at(workspace_id, &workspace_root, &document_id)
}

pub(crate) fn list_checkpoints_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: Option<&str>,
) -> Result<DesignerCheckpointHistoryResult, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;
    let normalized_document_id = document_id.map(normalize_document_id).transpose()?;
    if !docs_root.join(".git").is_dir() {
        return Ok(DesignerCheckpointHistoryResult {
            workspace_id: workspace_id.to_string(),
            document_id: normalized_document_id,
            entries: Vec::new(),
        });
    }

    let pathspec = normalized_document_id
        .as_ref()
        .map(|id| format!("{DOCUMENTS_DIR}/{id}"));
    let log_result = if let Some(pathspec) = pathspec.as_deref() {
        run_git(
            &docs_root,
            &[
                "log",
                "--pretty=format:%H%x1f%h%x1f%cI%x1f%s",
                "--max-count=50",
                "--",
                pathspec,
            ],
        )
    } else {
        run_git(
            &docs_root,
            &[
                "log",
                "--pretty=format:%H%x1f%h%x1f%cI%x1f%s",
                "--max-count=50",
            ],
        )
    };
    let stdout = match log_result {
        Ok(stdout) => stdout,
        Err(error) if is_empty_git_log_error(&error) => Vec::new(),
        Err(error) => return Err(error),
    };
    let text = String::from_utf8_lossy(&stdout);
    let entries = text
        .lines()
        .filter_map(parse_checkpoint_log_line)
        .collect::<Vec<_>>();
    Ok(DesignerCheckpointHistoryResult {
        workspace_id: workspace_id.to_string(),
        document_id: normalized_document_id,
        entries,
    })
}

fn is_empty_git_log_error(error: &str) -> bool {
    error.contains("does not have any commits yet")
        || error.contains("your current branch")
        || error.contains("unknown revision or path not in the working tree")
}

fn graph_projection_from_run(run: &gap_rules::GapRunResult) -> DesignerGraphProjection {
    DesignerGraphProjection {
        links: run.derived_edges.clone(),
    }
}

fn resolve_agent_task_target(
    detail: &DesignerDocumentDetail,
    run: &gap_rules::GapRunResult,
    host_block_id: Option<&str>,
    gap_codes: Vec<String>,
    scope: Option<DesignerAgentTaskScope>,
) -> Result<DesignerAgentTaskTarget, String> {
    let host = host_block_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: hostBlockId is required for v1 agent tasks"
                .to_string()
        })?;
    if !detail.design.blocks.iter().any(|block| block.id == host) {
        return Err(format!(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: host block '{host}' was not found"
        ));
    }
    let scope = scope.unwrap_or(if gap_codes.is_empty() {
        DesignerAgentTaskScope::Block
    } else {
        DesignerAgentTaskScope::Single
    });

    let requested_codes = gap_codes
        .iter()
        .map(|code| code.trim())
        .filter(|code| !code.is_empty())
        .collect::<HashSet<_>>();

    let host_gaps = run
        .gaps
        .iter()
        .filter(|gap| gap.block_id == host)
        .cloned()
        .collect::<Vec<_>>();
    let target_gaps = host_gaps
        .iter()
        .filter(|gap| {
            if scope == DesignerAgentTaskScope::Single || !requested_codes.is_empty() {
                requested_codes.contains(gap.code.as_str())
            } else {
                true
            }
        })
        .filter(|gap| gap.fixable_by_agent)
        .cloned()
        .collect::<Vec<_>>();

    if (scope == DesignerAgentTaskScope::Single || !requested_codes.is_empty())
        && target_gaps.is_empty()
    {
        return Err(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: target gaps were not found or are not agent-fixable"
                .to_string(),
        );
    }

    let target_gap_keys = target_gaps
        .iter()
        .map(|gap| gap.key.clone())
        .collect::<Vec<_>>();
    let gap_codes = if requested_codes.is_empty() {
        target_gaps
            .iter()
            .map(|gap| gap.code.clone())
            .collect::<Vec<_>>()
    } else {
        gap_codes
            .into_iter()
            .map(|code| code.trim().to_string())
            .filter(|code| !code.is_empty())
            .collect::<Vec<_>>()
    };
    let target_key_set = target_gap_keys
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let context_gaps = host_gaps
        .into_iter()
        .filter(|gap| !target_key_set.contains(gap.key.as_str()))
        .collect::<Vec<_>>();

    Ok(DesignerAgentTaskTarget {
        host_block_id: host.to_string(),
        scope,
        gap_codes,
        target_gap_keys,
        target_gaps,
        context_gaps,
    })
}

fn assert_agent_task_has_target_gaps(target: &DesignerAgentTaskTarget) -> Result<(), String> {
    if target.target_gaps.is_empty() {
        return Err(
            "BUSINESS_DESIGNER_AGENT_TASK_INVALID: dispatch requires at least one agent-fixable target gap"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn validate_agent_patch_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    patch_value: Value,
    archive_prefix: Option<&str>,
) -> Result<DesignerPatchValidationResult, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let patch: DesignerAgentPatch = serde_json::from_value(patch_value).map_err(|error| {
        format!("BUSINESS_DESIGNER_PATCH_PARSE_FAILED: unable to parse agent patch: {error}")
    })?;
    let (diagnostics, changes) = validate_agent_patch_against_detail(&detail, &patch);
    let valid = !diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error");
    let patch_path = if let Some(prefix) = archive_prefix {
        Some(archive_agent_patch(
            workspace_root,
            &detail.manifest.document_id,
            &patch,
            prefix,
        )?)
    } else {
        None
    };
    Ok(DesignerPatchValidationResult {
        workspace_id: workspace_id.to_string(),
        document_id: detail.manifest.document_id,
        patch_path,
        patch,
        diagnostics,
        changes,
        valid,
    })
}

pub(crate) fn recover_agent_patch_from_task_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    task_id: &str,
    state: &AppState,
) -> Result<DesignerRecoveredAgentPatchResult, String> {
    let normalized_task_id = normalize_task_id(task_id)?;
    let thread = state
        .task_service
        .get_task_thread(workspace_id, &normalized_task_id)
        .ok_or_else(|| {
            format!("BUSINESS_DESIGNER_AGENT_PATCH_NOT_FOUND: task '{normalized_task_id}' was not found")
        })?;

    for message in thread.messages.iter().rev() {
        if !is_agent_reply_message(message) {
            continue;
        }
        let Some(raw_text) = extract_message_text(&message.payload) else {
            continue;
        };
        let Some(patch_value) = extract_json_patch_value(&raw_text) else {
            continue;
        };
        let validation = validate_agent_patch_at(
            workspace_id,
            workspace_root,
            document_id,
            patch_value,
            Some("task-recovered"),
        )?;
        return Ok(DesignerRecoveredAgentPatchResult {
            workspace_id: workspace_id.to_string(),
            document_id: validation.document_id.clone(),
            task_id: normalized_task_id,
            source_message_id: message.message_id.clone(),
            source_agent_id: message
                .sender_agent_id
                .clone()
                .unwrap_or_else(|| message.target_agent_id.clone()),
            source_message_type: channel_message_type_label(&message.message_type).to_string(),
            validation,
        });
    }

    Err(format!(
        "BUSINESS_DESIGNER_AGENT_PATCH_NOT_FOUND: no valid JSON patch found in task '{normalized_task_id}' replies"
    ))
}

pub(crate) fn apply_agent_patch_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    patch_value: Value,
    accepted_change_indices: Option<Vec<usize>>,
) -> Result<DesignerPatchApplyResult, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let patch: DesignerAgentPatch = serde_json::from_value(patch_value).map_err(|error| {
        format!("BUSINESS_DESIGNER_PATCH_PARSE_FAILED: unable to parse agent patch: {error}")
    })?;
    let (diagnostics, _) = validate_agent_patch_against_detail(&detail, &patch);
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error")
    {
        return Err(format!(
            "BUSINESS_DESIGNER_PATCH_INVALID: {}",
            diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == "error")
                .map(|diagnostic| diagnostic.message.as_str())
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }

    // Snapshot gaps BEFORE applying so the three-tier verdict (resolved /
    // unresolved / introduced) is computed from rule output, not the model.
    let before_run = gap_rules::run_all(&detail.design);

    let accepted = accepted_change_indices.unwrap_or_else(|| (0..patch.changes.len()).collect());
    let accepted_set = accepted.iter().copied().collect::<HashSet<_>>();
    let skipped_changes = (0..patch.changes.len())
        .filter(|index| !accepted_set.contains(index))
        .collect::<Vec<_>>();
    let timestamp = now_iso_timestamp();
    let mut next_detail = detail.clone();
    for (index, change) in patch.changes.iter().enumerate() {
        if accepted_set.contains(&index) {
            apply_patch_operation(&mut next_detail.design, change, &timestamp)?;
        }
    }
    next_detail.manifest.status = "needsReview".to_string();
    let saved_detail = save_document_at(workspace_id, workspace_root, next_detail)?;

    let after_run = gap_rules::run_all(&saved_detail.design);
    let resolution = compute_gap_resolution(&before_run, &after_run, &patch);
    let graph_projection = graph_projection_from_run(&after_run);

    let patch_path = archive_agent_patch(
        workspace_root,
        &saved_detail.manifest.document_id,
        &patch,
        "applied",
    )?;

    Ok(DesignerPatchApplyResult {
        workspace_id: workspace_id.to_string(),
        document_id: saved_detail.manifest.document_id.clone(),
        applied_revision: saved_detail.design.revision.clone(),
        patch_path,
        accepted_changes: accepted,
        skipped_changes,
        detail: saved_detail,
        diagnostics,
        gap_resolution: resolution,
        gaps: after_run.gaps,
        rules_run: after_run.rules_run,
        graph_projection,
    })
}

/// Returns Some(message) when a patch operation does NOT respect the host
/// constraint. v1 anchored patches only update the host block.
fn host_anchor_violation(host: &str, change: &DesignerPatchOperation) -> Option<String> {
    match change {
        DesignerPatchOperation::Update { block_id, .. } => {
            if block_id == host {
                None
            } else {
                Some(format!(
                    "Change targets block '{block_id}' but patch host is '{host}'"
                ))
            }
        }
        DesignerPatchOperation::Add { .. } => {
            Some("v1 anchored patches cannot add blocks".to_string())
        }
        DesignerPatchOperation::Delete { .. } => {
            Some("v1 anchored patches cannot delete blocks".to_string())
        }
    }
}

/// Compute the resolved/unresolved/introduced verdict from before-and-after
/// rule runs. Gap keys, not ids, are the semantic comparison unit.
fn compute_gap_resolution(
    before: &gap_rules::GapRunResult,
    after: &gap_rules::GapRunResult,
    patch: &DesignerAgentPatch,
) -> DesignerGapResolution {
    let target_keys: HashSet<String> = if patch.target_gap_keys.is_empty() {
        let target_codes: HashSet<&str> = patch.gap_codes.iter().map(String::as_str).collect();
        before
            .gaps
            .iter()
            .filter(|gap| gap.block_id == patch.host_block_id)
            .filter(|gap| target_codes.is_empty() || target_codes.contains(gap.code.as_str()))
            .filter(|gap| gap.fixable_by_agent)
            .map(|gap| gap.key.clone())
            .collect()
    } else {
        patch.target_gap_keys.iter().cloned().collect()
    };

    let before_all_keys: HashSet<&str> = before.gaps.iter().map(|g| g.key.as_str()).collect();
    let after_keys: HashSet<&str> = after.gaps.iter().map(|g| g.key.as_str()).collect();

    let mut resolved: Vec<String> = target_keys
        .iter()
        .filter(|key| !after_keys.contains(key.as_str()))
        .cloned()
        .collect();
    let mut unresolved: Vec<String> = target_keys
        .iter()
        .filter(|key| after_keys.contains(key.as_str()))
        .cloned()
        .collect();
    let mut incidental_resolved: Vec<String> = before_all_keys
        .iter()
        .filter(|key| !target_keys.contains(**key))
        .filter(|key| !after_keys.contains(**key))
        .map(|key| (*key).to_string())
        .collect();
    let mut introduced: Vec<DesignerGap> = after
        .gaps
        .iter()
        .filter(|gap| !before_all_keys.contains(gap.key.as_str()))
        .cloned()
        .collect();
    let mut target_gap_keys: Vec<String> = target_keys.into_iter().collect();

    target_gap_keys.sort();
    resolved.sort();
    unresolved.sort();
    incidental_resolved.sort();
    introduced.sort_by(|a, b| a.key.cmp(&b.key));

    DesignerGapResolution {
        target_gap_keys,
        resolved,
        unresolved,
        incidental_resolved,
        introduced,
    }
}

pub(crate) fn export_document_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    format: &str,
) -> Result<DesignerExportResult, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let format = normalize_export_format(format)?;
    let compiled = compile_document_at(workspace_id, workspace_root, &detail.manifest.document_id)?;
    if compiled
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error")
    {
        return Err("BUSINESS_DESIGNER_EXPORT_INVALID: document has validation errors".to_string());
    }
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let document_root = document_root_for(
        &docs_root_for(&workspace_root),
        &detail.manifest.document_id,
    )?;
    let (source_path, suggested_file_name, mime_type, content) = match format.as_str() {
        "markdown" => {
            let path = document_root.join("README.md");
            (
                "README.md".to_string(),
                format!("{}-requirements.md", detail.manifest.document_id),
                "text/markdown".to_string(),
                fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "BUSINESS_DESIGNER_EXPORT_FAILED: unable to read '{}': {error}",
                        path.display()
                    )
                })?,
            )
        }
        "html" => {
            let path = document_root.join(&detail.manifest.generated.preview_html);
            (
                detail.manifest.generated.preview_html.clone(),
                format!("{}-preview.html", detail.manifest.document_id),
                "text/html".to_string(),
                fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "BUSINESS_DESIGNER_EXPORT_FAILED: unable to read '{}': {error}",
                        path.display()
                    )
                })?,
            )
        }
        "json" => (
            "design.json".to_string(),
            format!("{}-design.json", detail.manifest.document_id),
            "application/json".to_string(),
            stable_json_string(&detail.design)?,
        ),
        "agentBundle" => (
            "generated/agent-input.json".to_string(),
            format!("{}-agent-bundle.json", detail.manifest.document_id),
            "application/json".to_string(),
            stable_json_string(&json!({
                "schemaVersion": DESIGNER_SCHEMA_VERSION,
                "manifest": detail.manifest,
                "design": detail.design,
                "agentInput": render_agent_input(&detail),
                "agentBrief": render_agent_brief(&detail),
                "acceptance": render_acceptance(&detail),
                "contracts": render_contracts(&detail),
            }))?,
        ),
        "codeGenPrompt" => {
            let path = document_root.join(&detail.manifest.generated.code_gen_prompt);
            (
                detail.manifest.generated.code_gen_prompt.clone(),
                format!("{}-code-gen-prompt.md", detail.manifest.document_id),
                "text/markdown".to_string(),
                fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "BUSINESS_DESIGNER_EXPORT_FAILED: unable to read '{}': {error}",
                        path.display()
                    )
                })?,
            )
        }
        _ => unreachable!("normalize_export_format restricts format"),
    };
    Ok(DesignerExportResult {
        workspace_id: workspace_id.to_string(),
        document_id: detail.manifest.document_id,
        format,
        suggested_file_name,
        mime_type,
        content,
        source_path,
        saved_path: None,
        cancelled: None,
    })
}

pub(crate) fn export_document_to_file_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    format: &str,
) -> Result<DesignerExportResult, String> {
    let mut export = export_document_at(workspace_id, workspace_root, document_id, format)?;
    let extension = export_extension(&export.format);
    let target_path = FileDialog::new()
        .set_file_name(&export.suggested_file_name)
        .add_filter(export_filter_label(&export.format), &[extension])
        .save_file();

    let Some(target_path) = target_path else {
        export.cancelled = Some(true);
        return Ok(export);
    };

    fs::write(&target_path, export.content.as_bytes()).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_EXPORT_WRITE_FAILED: unable to write '{}': {error}",
            target_path.display()
        )
    })?;
    export.saved_path = Some(target_path.to_string_lossy().to_string());
    export.cancelled = Some(false);
    Ok(export)
}

pub(crate) fn preview_coding_handoff_at(
    workspace_id: &str,
    workspace_root: &Path,
    document_id: &str,
    target_agent_ids: Vec<String>,
) -> Result<DesignerCodingHandoffPreview, String> {
    let detail = read_document_at(workspace_id, workspace_root, document_id)?;
    let compiled = compile_document_at(workspace_id, workspace_root, &detail.manifest.document_id)?;
    let diagnostics = compiled.diagnostics.clone();
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error")
    {
        return Err(
            "BUSINESS_DESIGNER_HANDOFF_INVALID: document has validation errors".to_string(),
        );
    }
    let title = format!("Implement {}", detail.manifest.title);
    let tasks = build_coding_tasks(&detail);
    let attachments = requirement_package_attachments(&detail);
    let markdown = render_coding_handoff_markdown(&detail, &tasks);
    let request = TaskDispatchBatchRequest {
        workspace_id: workspace_id.to_string(),
        sender: DispatchSender {
            sender_type: DispatchSenderType::Human,
            agent_id: None,
        },
        targets: target_agent_ids,
        title: title.clone(),
        markdown,
        attachments: attachments.clone(),
        submit_sequences: HashMap::new(),
    };

    Ok(DesignerCodingHandoffPreview {
        workspace_id: workspace_id.to_string(),
        document_id: detail.manifest.document_id.clone(),
        title,
        revision: detail.design.revision,
        request,
        tasks,
        attachments,
        diagnostics,
    })
}

fn validate_design(
    manifest: &DesignerManifest,
    design: &DesignerDesignGraph,
) -> Vec<DesignerDiagnostic> {
    let mut diagnostics = Vec::new();
    if manifest.schema_version != DESIGNER_SCHEMA_VERSION {
        diagnostics.push(diagnostic(
            "schema_version_mismatch",
            "error",
            format!(
                "Manifest schemaVersion must be {DESIGNER_SCHEMA_VERSION}, got {}",
                manifest.schema_version
            ),
            Some("manifest.json".to_string()),
        ));
    }
    if design.schema_version != DESIGNER_SCHEMA_VERSION {
        diagnostics.push(diagnostic(
            "design_schema_version_mismatch",
            "error",
            format!(
                "Design schemaVersion must be {DESIGNER_SCHEMA_VERSION}, got {}",
                design.schema_version
            ),
            Some("design.json".to_string()),
        ));
    }
    if manifest.document_id != design.document_id {
        diagnostics.push(diagnostic(
            "document_id_mismatch",
            "error",
            "Manifest documentId must match design documentId",
            Some("design.json".to_string()),
        ));
    }
    if manifest.title.trim().is_empty() || design.title.trim().is_empty() {
        diagnostics.push(diagnostic(
            "title_required",
            "error",
            "Document title is required",
            Some("manifest.json".to_string()),
        ));
    }
    if design.blocks.is_empty() {
        diagnostics.push(diagnostic(
            "blocks_required",
            "error",
            "Document must contain at least one design block",
            Some("design.json#/blocks".to_string()),
        ));
    }

    let mut seen_ids = HashSet::new();
    let mut has_acceptance = false;
    let mut has_agent_instruction = false;
    for block in &design.blocks {
        if block.id.trim().is_empty() {
            diagnostics.push(diagnostic(
                "block_id_required",
                "error",
                "Block id is required",
                Some(format!("blocks/{}", block.order)),
            ));
        } else if normalize_document_id(&block.id).is_err() {
            diagnostics.push(diagnostic(
                "block_id_invalid",
                "error",
                format!(
                    "Block id '{}' can only use letters, numbers, '-' and '_'",
                    block.id
                ),
                Some(format!("blocks/{}.json", block.id)),
            ));
        } else if !seen_ids.insert(block.id.clone()) {
            diagnostics.push(diagnostic(
                "block_id_duplicate",
                "error",
                format!("Block id '{}' is duplicated", block.id),
                Some(format!("blocks/{}.json", block.id)),
            ));
        }

        if !is_supported_block_kind(&block.kind) {
            diagnostics.push(diagnostic(
                "block_kind_unknown",
                "warning",
                format!(
                    "Block kind '{}' is not part of the current designer schema",
                    block.kind
                ),
                Some(format!("blocks/{}.json", block.id)),
            ));
        }
        if block.title.trim().is_empty() {
            diagnostics.push(diagnostic(
                "block_title_required",
                "warning",
                format!("Block '{}' should have a visible title", block.id),
                Some(format!("blocks/{}.json", block.id)),
            ));
        }
        if !block.payload.is_object() {
            diagnostics.push(diagnostic(
                "block_payload_object",
                "warning",
                format!("Block '{}' payload should be a JSON object", block.id),
                Some(format!("blocks/{}.json", block.id)),
            ));
        }

        match block.kind.as_str() {
            "acceptanceCriteria" => {
                has_acceptance = true;
                if !payload_list_has_values(&block.payload, "criteria") {
                    diagnostics.push(diagnostic(
                        "acceptance_criteria_empty",
                        "warning",
                        "Acceptance criteria should contain at least one item",
                        Some(format!("blocks/{}.json", block.id)),
                    ));
                }
            }
            "agentInstruction" => {
                has_agent_instruction = true;
                if payload_string(&block.payload, "instructions").is_none() {
                    diagnostics.push(diagnostic(
                        "agent_instruction_empty",
                        "warning",
                        "Agent instruction block should include instructions",
                        Some(format!("blocks/{}.json", block.id)),
                    ));
                }
            }
            "text" if payload_string(&block.payload, "markdown").is_none() => {
                diagnostics.push(diagnostic(
                    "text_markdown_empty",
                    "warning",
                    "Text block should include markdown",
                    Some(format!("blocks/{}.json", block.id)),
                ));
            }
            _ => {}
        }
    }

    if !has_acceptance {
        diagnostics.push(diagnostic(
            "acceptance_block_missing",
            "warning",
            "Add an acceptance criteria block before handing work to an agent",
            Some("design.json#/blocks".to_string()),
        ));
    }
    if !has_agent_instruction {
        diagnostics.push(diagnostic(
            "agent_instruction_missing",
            "warning",
            "Add an agent instruction block before handing work to an agent",
            Some("design.json#/blocks".to_string()),
        ));
    }

    diagnostics
}

fn validate_agent_patch_against_detail(
    detail: &DesignerDocumentDetail,
    patch: &DesignerAgentPatch,
) -> (Vec<DesignerDiagnostic>, Vec<DesignerPatchPreviewChange>) {
    let mut diagnostics = Vec::new();
    let mut changes = Vec::new();
    if patch.schema_version != DESIGNER_SCHEMA_VERSION {
        diagnostics.push(diagnostic(
            "patch_schema_version_mismatch",
            "error",
            format!(
                "Patch schemaVersion must be {DESIGNER_SCHEMA_VERSION}, got {}",
                patch.schema_version
            ),
            Some("patch.schemaVersion".to_string()),
        ));
    }
    if patch.document_id != detail.manifest.document_id {
        diagnostics.push(diagnostic(
            "patch_document_id_mismatch",
            "error",
            "Patch documentId must match the selected document",
            Some("patch.documentId".to_string()),
        ));
    }
    if patch.base_revision != detail.design.revision {
        diagnostics.push(diagnostic(
            "patch_base_revision_stale",
            "error",
            format!(
                "Patch baseRevision '{}' does not match current revision '{}'",
                patch.base_revision, detail.design.revision
            ),
            Some("patch.baseRevision".to_string()),
        ));
    }
    if patch.changes.is_empty() && patch.open_questions.is_empty() {
        diagnostics.push(diagnostic(
            "patch_empty",
            "warning",
            "Patch contains no changes or open questions",
            Some("patch.changes".to_string()),
        ));
    }
    if patch.host_block_id.trim().is_empty() {
        diagnostics.push(diagnostic(
            "patch_host_block_required",
            "error",
            "Patch hostBlockId is required for v1 anchored patches",
            Some("patch.hostBlockId".to_string()),
        ));
    }

    let block_ids = detail
        .design
        .blocks
        .iter()
        .map(|block| block.id.as_str())
        .collect::<HashSet<_>>();
    if !patch.host_block_id.trim().is_empty() && !block_ids.contains(patch.host_block_id.as_str()) {
        diagnostics.push(diagnostic(
            "patch_host_block_missing",
            "error",
            format!("Patch hostBlockId '{}' does not exist", patch.host_block_id),
            Some("patch.hostBlockId".to_string()),
        ));
    }
    let active_run = gap_rules::run_all(&detail.design);
    if !patch.target_gap_keys.is_empty() {
        let active_keys = active_run
            .gaps
            .iter()
            .filter(|gap| gap.block_id == patch.host_block_id)
            .filter(|gap| gap.fixable_by_agent)
            .map(|gap| gap.key.as_str())
            .collect::<HashSet<_>>();
        for key in &patch.target_gap_keys {
            if !active_keys.contains(key.as_str()) {
                diagnostics.push(diagnostic(
                    "patch_target_gap_invalid",
                    "error",
                    format!("Target gap key '{key}' is not an active agent-fixable gap on the host block"),
                    Some("patch.targetGapKeys".to_string()),
                ));
            }
        }
    }
    let mut new_block_ids = HashSet::new();
    for (index, change) in patch.changes.iter().enumerate() {
        if let Some(violation) = host_anchor_violation(&patch.host_block_id, change) {
            diagnostics.push(diagnostic(
                "patch_host_block_mismatch",
                "error",
                violation,
                Some(format!("patch.changes[{index}]")),
            ));
        }
        match change {
            DesignerPatchOperation::Add {
                after_block_id,
                block,
            } => {
                validate_patch_block(block, index, &mut diagnostics);
                if block_ids.contains(block.id.as_str()) || !new_block_ids.insert(block.id.clone())
                {
                    diagnostics.push(diagnostic(
                        "patch_add_block_id_conflict",
                        "error",
                        format!("Patch adds duplicate block id '{}'", block.id),
                        Some(format!("patch.changes[{index}].block.id")),
                    ));
                }
                if let Some(after_block_id) = after_block_id.as_deref() {
                    if !block_ids.contains(after_block_id)
                        && !new_block_ids.contains(after_block_id)
                    {
                        diagnostics.push(diagnostic(
                            "patch_after_block_missing",
                            "error",
                            format!("afterBlockId '{after_block_id}' does not exist"),
                            Some(format!("patch.changes[{index}].afterBlockId")),
                        ));
                    }
                }
                changes.push(DesignerPatchPreviewChange {
                    op: "addBlock".to_string(),
                    block_id: block.id.clone(),
                    title: Some(block.title.clone()),
                    kind: Some(block.kind.clone()),
                    destructive: false,
                    summary: format!("Add {} block '{}'", block.kind, block.title),
                });
            }
            DesignerPatchOperation::Update { block_id, patch } => {
                if !block_ids.contains(block_id.as_str()) {
                    diagnostics.push(diagnostic(
                        "patch_update_block_missing",
                        "error",
                        format!("Patch updates missing block '{block_id}'"),
                        Some(format!("patch.changes[{index}].blockId")),
                    ));
                }
                if let Some(kind) = patch.kind.as_deref() {
                    if !is_supported_block_kind(kind) {
                        diagnostics.push(diagnostic(
                            "patch_block_kind_unknown",
                            "error",
                            format!("Patch uses unsupported block kind '{kind}'"),
                            Some(format!("patch.changes[{index}].patch.kind")),
                        ));
                    }
                }
                if patch
                    .payload
                    .as_ref()
                    .is_some_and(|payload| !payload.is_object())
                {
                    diagnostics.push(diagnostic(
                        "patch_payload_object",
                        "error",
                        "Patch payload must be a JSON object",
                        Some(format!("patch.changes[{index}].patch.payload")),
                    ));
                }
                if patch.links.is_some() {
                    diagnostics.push(diagnostic(
                        "patch_links_not_allowed",
                        "error",
                        "v1 anchored patches cannot modify semantic links; graph edges are derived by validation",
                        Some(format!("patch.changes[{index}].patch.links")),
                    ));
                }
                changes.push(DesignerPatchPreviewChange {
                    op: "updateBlock".to_string(),
                    block_id: block_id.clone(),
                    title: patch.title.clone(),
                    kind: patch.kind.clone(),
                    destructive: false,
                    summary: format!("Update block '{block_id}'"),
                });
            }
            DesignerPatchOperation::Delete { block_id } => {
                if !block_ids.contains(block_id.as_str()) {
                    diagnostics.push(diagnostic(
                        "patch_delete_block_missing",
                        "error",
                        format!("Patch deletes missing block '{block_id}'"),
                        Some(format!("patch.changes[{index}].blockId")),
                    ));
                }
                changes.push(DesignerPatchPreviewChange {
                    op: "deleteBlock".to_string(),
                    block_id: block_id.clone(),
                    title: None,
                    kind: None,
                    destructive: true,
                    summary: format!("Delete block '{block_id}'"),
                });
            }
        }
    }
    (diagnostics, changes)
}

fn is_agent_reply_message(message: &ChannelMessageEvent) -> bool {
    matches!(
        message.message_type,
        ChannelMessageType::Status | ChannelMessageType::Handover
    ) || message.sender_agent_id.is_some()
}

fn channel_message_type_label(message_type: &ChannelMessageType) -> &'static str {
    match message_type {
        ChannelMessageType::TaskInstruction => "taskInstruction",
        ChannelMessageType::Status => "status",
        ChannelMessageType::Handover => "handover",
    }
}

fn extract_message_text(payload: &Value) -> Option<String> {
    for key in [
        "detail", "summary", "markdown", "text", "content", "message", "body",
    ] {
        if let Some(value) = payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(value.to_string());
        }
    }
    if let Some(patch) = payload.get("patch") {
        return Some(patch.to_string());
    }
    payload.as_str().map(str::to_string)
}

fn extract_json_patch_value(raw_text: &str) -> Option<Value> {
    for candidate in json_candidates(raw_text) {
        if let Ok(value) = serde_json::from_str::<Value>(&candidate) {
            if looks_like_agent_patch(&value) {
                return Some(value);
            }
        }
    }
    None
}

fn json_candidates(raw_text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let trimmed = raw_text.trim();
    if !trimmed.is_empty() {
        candidates.push(trimmed.to_string());
    }

    let mut search_from = 0;
    while let Some(start_rel) = raw_text[search_from..].find("```") {
        let fence_start = search_from + start_rel + 3;
        let after_start = &raw_text[fence_start..];
        let content_start = after_start
            .find('\n')
            .map(|offset| fence_start + offset + 1)
            .unwrap_or(fence_start);
        if let Some(end_rel) = raw_text[content_start..].find("```") {
            let content = raw_text[content_start..content_start + end_rel].trim();
            if !content.is_empty() {
                candidates.push(content.to_string());
            }
            search_from = content_start + end_rel + 3;
        } else {
            break;
        }
    }

    if let (Some(start), Some(end)) = (raw_text.find('{'), raw_text.rfind('}')) {
        if start < end {
            candidates.push(raw_text[start..=end].trim().to_string());
        }
    }
    candidates
}

fn looks_like_agent_patch(value: &Value) -> bool {
    value.get("schemaVersion").is_some()
        && value.get("documentId").is_some()
        && value.get("baseRevision").is_some()
        && value.get("changes").is_some()
}

fn validate_patch_block(
    block: &DesignerPatchBlock,
    index: usize,
    diagnostics: &mut Vec<DesignerDiagnostic>,
) {
    if normalize_document_id(&block.id).is_err() {
        diagnostics.push(diagnostic(
            "patch_block_id_invalid",
            "error",
            format!("Patch block id '{}' is invalid", block.id),
            Some(format!("patch.changes[{index}].block.id")),
        ));
    }
    if !is_supported_block_kind(&block.kind) {
        diagnostics.push(diagnostic(
            "patch_block_kind_unknown",
            "error",
            format!("Patch uses unsupported block kind '{}'", block.kind),
            Some(format!("patch.changes[{index}].block.kind")),
        ));
    }
    if block.title.trim().is_empty() {
        diagnostics.push(diagnostic(
            "patch_block_title_required",
            "error",
            "Patch block title is required",
            Some(format!("patch.changes[{index}].block.title")),
        ));
    }
    if !block.payload.is_object() {
        diagnostics.push(diagnostic(
            "patch_block_payload_object",
            "error",
            "Patch block payload must be a JSON object",
            Some(format!("patch.changes[{index}].block.payload")),
        ));
    }
}

fn apply_patch_operation(
    design: &mut DesignerDesignGraph,
    change: &DesignerPatchOperation,
    timestamp: &str,
) -> Result<(), String> {
    match change {
        DesignerPatchOperation::Add {
            after_block_id,
            block,
        } => {
            let mut next_block = patch_block_to_block(block, timestamp);
            if next_block.order == 0 {
                next_block.order = next_block_order(&design.blocks);
            }
            let insert_at = after_block_id
                .as_ref()
                .and_then(|id| design.blocks.iter().position(|block| &block.id == id))
                .map(|position| position + 1)
                .unwrap_or(design.blocks.len());
            design.blocks.insert(insert_at, next_block);
        }
        DesignerPatchOperation::Update { block_id, patch } => {
            let block = design
                .blocks
                .iter_mut()
                .find(|block| block.id == *block_id)
                .ok_or_else(|| {
                    format!("BUSINESS_DESIGNER_PATCH_INVALID: missing block '{block_id}'")
                })?;
            if let Some(kind) = patch.kind.as_deref() {
                block.kind = kind.to_string();
            }
            if let Some(title) = patch.title.as_deref() {
                block.title = title.trim().to_string();
            }
            if let Some(order) = patch.order {
                block.order = order;
            }
            if let Some(payload) = patch.payload.clone() {
                block.payload = payload;
            }
            block.updated_at = timestamp.to_string();
        }
        DesignerPatchOperation::Delete { block_id } => {
            design.blocks.retain(|block| block.id != *block_id);
        }
    }
    design.revision = timestamp.to_string();
    design
        .blocks
        .sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    Ok(())
}

fn patch_block_to_block(block: &DesignerPatchBlock, timestamp: &str) -> DesignerBlock {
    DesignerBlock {
        id: block.id.clone(),
        kind: block.kind.clone(),
        title: block.title.trim().to_string(),
        order: block.order.unwrap_or(0),
        payload: block.payload.clone(),
        links: block.links.clone(),
        validation: Vec::new(),
        updated_at: timestamp.to_string(),
    }
}

fn next_block_order(blocks: &[DesignerBlock]) -> u32 {
    blocks
        .iter()
        .map(|block| block.order)
        .max()
        .unwrap_or(0)
        .saturating_add(10)
}

/// v1: deterministic mock patch keyed off `(host_block_id, gap_codes)`. Each
/// supported gap has a hand-coded fix; the patch never wanders off-host.
fn build_mock_agent_patch_for_host(
    detail: &DesignerDocumentDetail,
    provider: &str,
    _selected_block_ids: &[String],
    target: &DesignerAgentTaskTarget,
) -> DesignerAgentPatch {
    let host = target.host_block_id.as_str();
    if let Some(host_block) = detail.design.blocks.iter().find(|b| b.id == host) {
        let candidate_codes = target
            .target_gaps
            .iter()
            .map(|gap| gap.code.clone())
            .collect::<Vec<_>>();

        if let Some(update) = mock_payload_patch_for_host(host_block, &candidate_codes) {
            return DesignerAgentPatch {
                schema_version: DESIGNER_SCHEMA_VERSION,
                document_id: detail.manifest.document_id.clone(),
                base_revision: detail.design.revision.clone(),
                summary: format!(
                    "{provider} mock fix for host '{host}' ({} gap{})",
                    candidate_codes.len(),
                    if candidate_codes.len() == 1 { "" } else { "s" }
                ),
                changes: vec![DesignerPatchOperation::Update {
                    block_id: host.to_string(),
                    patch: update,
                }],
                open_questions: Vec::new(),
                host_block_id: host.to_string(),
                gap_codes: target.gap_codes.clone(),
                target_gap_keys: target.target_gap_keys.clone(),
                scope: Some(target.scope),
            };
        }
    }

    DesignerAgentPatch {
        schema_version: DESIGNER_SCHEMA_VERSION,
        document_id: detail.manifest.document_id.clone(),
        base_revision: detail.design.revision.clone(),
        summary: format!("{provider} mock found no agent-fixable changes for host '{host}'"),
        changes: Vec::new(),
        open_questions: vec![
            "此块没有可由 Agent 自动处理的缺口，或 mock provider 尚未支持这些 gap。".to_string(),
        ],
        host_block_id: host.to_string(),
        gap_codes: target.gap_codes.clone(),
        target_gap_keys: target.target_gap_keys.clone(),
        scope: Some(target.scope),
    }
}

/// Mock fixer table — small per-rule transforms that produce a valid payload
/// given the host block's existing payload + the unmet codes. Returns `None`
/// when no transform applies (caller falls back to the legacy mock).
fn mock_payload_patch_for_host(
    host: &DesignerBlock,
    codes: &[String],
) -> Option<DesignerPatchBlockUpdate> {
    if codes.is_empty() {
        return None;
    }
    let mut payload = host.payload.clone();
    let obj = payload.as_object_mut()?;
    let mut applied_any = false;

    let touched = |code: &str| codes.iter().any(|c| c == code);

    match host.kind.as_str() {
        "entityModel" => {
            // entityName fallback
            if !obj
                .get("entityName")
                .and_then(Value::as_str)
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
            {
                obj.insert("entityName".to_string(), Value::String(host.title.clone()));
            }
            let entity_name = obj
                .get("entityName")
                .and_then(Value::as_str)
                .unwrap_or(host.title.as_str())
                .to_string();
            let fields = obj
                .entry("fields")
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()?;

            if touched("no-fields") && fields.is_empty() {
                fields.push(json!({
                    "name": "id",
                    "type": "string",
                    "description": format!("{entity_name} 主键"),
                    "isPrimaryKey": true,
                }));
                applied_any = true;
            }

            if touched("no-pk") {
                let has_pk = fields.iter().any(|f| {
                    f.get("isPrimaryKey")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                });
                if !has_pk {
                    fields.insert(
                        0,
                        json!({
                            "name": "id",
                            "type": "string",
                            "description": format!("{entity_name} 主键"),
                            "isPrimaryKey": true,
                        }),
                    );
                    applied_any = true;
                }
            }

            if touched("field-no-type") {
                for field in fields.iter_mut() {
                    let needs = field
                        .get("type")
                        .and_then(Value::as_str)
                        .map(|s| s.trim().is_empty())
                        .unwrap_or(true);
                    if needs {
                        if let Some(map) = field.as_object_mut() {
                            map.insert("type".to_string(), Value::String("string".to_string()));
                            applied_any = true;
                        }
                    }
                }
            }

            if touched("enum-no-values") {
                for field in fields.iter_mut() {
                    let is_enum = field
                        .get("type")
                        .and_then(Value::as_str)
                        .map(|s| s.eq_ignore_ascii_case("enum"))
                        .unwrap_or(false);
                    if !is_enum {
                        continue;
                    }
                    let needs = field
                        .get("values")
                        .and_then(Value::as_array)
                        .map(|a| a.is_empty())
                        .unwrap_or(true);
                    if needs {
                        if let Some(map) = field.as_object_mut() {
                            map.insert(
                                "values".to_string(),
                                json!(["draft", "active", "archived"]),
                            );
                            applied_any = true;
                        }
                    }
                }
            }
        }
        "businessFlow" => {
            let states_initial = obj
                .get("states")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .is_empty();
            if touched("no-states") && states_initial {
                obj.insert(
                    "states".to_string(),
                    json!([
                        {"name": "draft", "initial": true},
                        {"name": "active"},
                        {"name": "done", "terminal": true},
                    ]),
                );
                applied_any = true;
            }
            if touched("no-transitions") {
                let has_t = obj
                    .get("transitions")
                    .and_then(Value::as_array)
                    .map(|a| !a.is_empty())
                    .unwrap_or(false);
                if !has_t {
                    obj.insert(
                        "transitions".to_string(),
                        json!([
                            {"from": "draft", "to": "active"},
                            {"from": "active", "to": "done"},
                        ]),
                    );
                    applied_any = true;
                }
            }
            if touched("no-terminal") {
                if let Some(states) = obj.get_mut("states").and_then(Value::as_array_mut) {
                    let any_terminal = states
                        .iter()
                        .any(|s| s.get("terminal").and_then(Value::as_bool).unwrap_or(false));
                    if !any_terminal {
                        if let Some(last) = states.last_mut() {
                            if let Some(map) = last.as_object_mut() {
                                map.insert("terminal".to_string(), Value::Bool(true));
                                applied_any = true;
                            }
                        }
                    }
                }
            }
        }
        "apiContract" => {
            let endpoints_empty = obj
                .get("endpoints")
                .and_then(Value::as_array)
                .map(|a| a.is_empty())
                .unwrap_or(true);
            if touched("no-endpoints") && endpoints_empty {
                obj.insert(
                    "endpoints".to_string(),
                    json!([
                        {
                            "method": "GET",
                            "path": format!("/{}", host.id),
                            "response": "Object",
                            "errors": ["NOT_FOUND", "INTERNAL_ERROR"],
                        }
                    ]),
                );
                applied_any = true;
            }
            if let Some(endpoints) = obj.get_mut("endpoints").and_then(Value::as_array_mut) {
                for endpoint in endpoints.iter_mut() {
                    if let Some(map) = endpoint.as_object_mut() {
                        if touched("endpoint-no-path") {
                            let needs = map
                                .get("path")
                                .and_then(Value::as_str)
                                .map(|s| s.trim().is_empty())
                                .unwrap_or(true);
                            if needs {
                                map.insert(
                                    "path".to_string(),
                                    Value::String(format!("/{}", host.id)),
                                );
                                applied_any = true;
                            }
                        }
                        if touched("endpoint-no-method") {
                            let needs = map
                                .get("method")
                                .and_then(Value::as_str)
                                .map(|s| s.trim().is_empty())
                                .unwrap_or(true);
                            if needs {
                                map.insert("method".to_string(), Value::String("GET".to_string()));
                                applied_any = true;
                            }
                        }
                        if touched("no-response") {
                            let needs = map.get("response").map(is_empty_value).unwrap_or(true)
                                && map.get("responseShape").map(is_empty_value).unwrap_or(true);
                            if needs {
                                map.insert(
                                    "response".to_string(),
                                    Value::String("Object".to_string()),
                                );
                                applied_any = true;
                            }
                        }
                        if touched("no-errors") {
                            let needs = map
                                .get("errors")
                                .and_then(Value::as_array)
                                .map(|a| a.is_empty())
                                .unwrap_or(true)
                                && map
                                    .get("errorCodes")
                                    .and_then(Value::as_array)
                                    .map(|a| a.is_empty())
                                    .unwrap_or(true);
                            if needs {
                                map.insert(
                                    "errors".to_string(),
                                    json!(["NOT_FOUND", "INTERNAL_ERROR"]),
                                );
                                applied_any = true;
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }

    if !applied_any {
        return None;
    }

    Some(DesignerPatchBlockUpdate {
        kind: None,
        title: None,
        order: None,
        payload: Some(payload),
        links: None,
    })
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

fn archive_agent_patch(
    workspace_root: &Path,
    document_id: &str,
    patch: &DesignerAgentPatch,
    prefix: &str,
) -> Result<String, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    let document_root = document_root_for(&docs_root, document_id)?;
    ensure_inside_workspace(&workspace_root, &document_root)?;
    let patches_dir = document_root.join(PATCHES_DIR);
    fs::create_dir_all(&patches_dir).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_PATCH_ARCHIVE_FAILED: unable to create patches directory: {error}"
        )
    })?;
    let safe_prefix = normalize_archive_prefix(prefix);
    let file_name = format!("agent-patch-{safe_prefix}-{}.json", now_iso_timestamp());
    let path = patches_dir.join(&file_name);
    atomic_write_json(&path, patch)?;
    Ok(format!(
        "{DOCUMENTS_DIR}/{document_id}/{PATCHES_DIR}/{file_name}"
    ))
}

fn normalize_archive_prefix(prefix: &str) -> String {
    let normalized = prefix
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if normalized.is_empty() {
        "patch".to_string()
    } else {
        normalized
    }
}

fn normalize_export_format(format: &str) -> Result<String, String> {
    match format.trim() {
        "markdown" | "md" => Ok("markdown".to_string()),
        "html" => Ok("html".to_string()),
        "json" | "designJson" => Ok("json".to_string()),
        "agentBundle" | "agent-bundle" => Ok("agentBundle".to_string()),
        "codeGenPrompt" | "code-gen-prompt" => Ok("codeGenPrompt".to_string()),
        other => Err(format!(
            "BUSINESS_DESIGNER_EXPORT_FORMAT_UNSUPPORTED: unsupported export format '{other}'"
        )),
    }
}

fn export_extension(format: &str) -> &'static str {
    match format {
        "markdown" | "codeGenPrompt" => "md",
        "html" => "html",
        "json" | "agentBundle" => "json",
        _ => "txt",
    }
}

fn export_filter_label(format: &str) -> &'static str {
    match format {
        "markdown" => "Markdown",
        "html" => "HTML",
        "json" | "agentBundle" => "JSON",
        "codeGenPrompt" => "Markdown",
        _ => "Text",
    }
}

pub(crate) fn list_documents_at(
    workspace_id: &str,
    workspace_root: &Path,
) -> Result<ListDocumentsResponse, String> {
    let workspace_root = workspace_root.canonicalize().map_err(|error| {
        format!("BUSINESS_DESIGNER_WORKSPACE_INVALID: workspace root is not accessible: {error}")
    })?;
    let docs_root = docs_root_for(&workspace_root);
    ensure_inside_workspace(&workspace_root, &docs_root)?;

    if !docs_root.exists() {
        return Ok(ListDocumentsResponse {
            workspace_id: workspace_id.to_string(),
            docs_root: relative_docs_root(),
            scaffold_initialized: false,
            repo_initialized: false,
            documents: Vec::new(),
            diagnostics: Vec::new(),
        });
    }

    let documents_dir = docs_root.join(DOCUMENTS_DIR);
    let (documents, diagnostics) = read_document_summaries(&documents_dir)?;
    Ok(ListDocumentsResponse {
        workspace_id: workspace_id.to_string(),
        docs_root: relative_docs_root(),
        scaffold_initialized: documents_dir.is_dir(),
        repo_initialized: docs_root.join(".git").is_dir(),
        documents,
        diagnostics,
    })
}

pub(crate) fn ensure_docs_scaffold_at(docs_root: &Path) -> Result<ScaffoldResult, String> {
    let existed = docs_root.exists();
    fs::create_dir_all(docs_root.join(DOCUMENTS_DIR)).map_err(|error| {
        format!("BUSINESS_DESIGNER_INIT_FAILED: unable to create documents directory: {error}")
    })?;
    fs::create_dir_all(docs_root.join(TEMPLATES_DIR)).map_err(|error| {
        format!("BUSINESS_DESIGNER_INIT_FAILED: unable to create templates directory: {error}")
    })?;

    let mut templates_written = false;
    templates_written |= write_if_missing(&docs_root.join("index.json"), &docs_index_template())?;
    templates_written |= write_if_missing(
        &docs_root
            .join(TEMPLATES_DIR)
            .join("business-module.template.json"),
        &business_module_template(),
    )?;
    templates_written |= write_if_missing(
        &docs_root
            .join(TEMPLATES_DIR)
            .join("agent-brief.template.json"),
        &agent_brief_template(),
    )?;

    Ok(ScaffoldResult {
        scaffold_created: !existed,
        templates_written,
    })
}

fn ensure_docs_git_repository(docs_root: &Path) -> Result<bool, String> {
    if docs_root.join(".git").is_dir() {
        return Ok(false);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(docs_root)
        .arg("init")
        .output()
        .map_err(|error| {
            format!("BUSINESS_DESIGNER_GIT_UNAVAILABLE: unable to run git init: {error}")
        })?;

    if output.status.success() {
        return Ok(true);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "BUSINESS_DESIGNER_GIT_INIT_FAILED: {}",
        if stderr.is_empty() {
            "git init failed without stderr".to_string()
        } else {
            stderr
        }
    ))
}

fn write_if_missing(path: &Path, content: &str) -> Result<bool, String> {
    if path.exists() {
        return Ok(false);
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            format!(
                "BUSINESS_DESIGNER_INIT_FAILED: unable to create '{}': {error}",
                path.display()
            )
        })?;
    file.write_all(content.as_bytes()).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_INIT_FAILED: unable to write '{}': {error}",
            path.display()
        )
    })?;
    Ok(true)
}

fn ensure_inside_workspace(workspace_root: &Path, target: &Path) -> Result<(), String> {
    if target.starts_with(workspace_root) {
        return Ok(());
    }
    Err(format!(
        "BUSINESS_DESIGNER_PATH_OUTSIDE_WORKSPACE: '{}' is outside workspace '{}'",
        target.display(),
        workspace_root.display()
    ))
}

fn read_document_summaries(
    documents_dir: &Path,
) -> Result<(Vec<DesignerDocumentSummary>, Vec<DesignerDiagnostic>), String> {
    if !documents_dir.exists() {
        return Ok((Vec::new(), Vec::new()));
    }
    if !documents_dir.is_dir() {
        return Err(format!(
            "BUSINESS_DESIGNER_DOCS_INVALID: '{}' is not a directory",
            documents_dir.display()
        ));
    }

    let mut documents = Vec::new();
    let mut diagnostics = Vec::new();
    for entry in fs::read_dir(documents_dir).map_err(|error| {
        format!("BUSINESS_DESIGNER_LIST_FAILED: unable to read documents directory: {error}")
    })? {
        let entry = entry.map_err(|error| {
            format!("BUSINESS_DESIGNER_LIST_FAILED: invalid dir entry: {error}")
        })?;
        let file_type = entry.file_type().map_err(|error| {
            format!("BUSINESS_DESIGNER_LIST_FAILED: unable to read entry metadata: {error}")
        })?;
        if !file_type.is_dir() {
            continue;
        }

        match read_document_summary(&entry.path()) {
            Ok(Some(summary)) => documents.push(summary),
            Ok(None) => {}
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    documents.sort_by(|a, b| a.document_id.cmp(&b.document_id));
    diagnostics.sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.code.cmp(&b.code)));
    Ok((documents, diagnostics))
}

fn read_document_summary(
    document_dir: &Path,
) -> Result<Option<DesignerDocumentSummary>, DesignerDiagnostic> {
    let manifest_path = document_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| DesignerDiagnostic {
        code: "manifest_read_failed".to_string(),
        severity: "error".to_string(),
        message: format!("Unable to read manifest: {error}"),
        path: Some(display_path(&manifest_path)),
    })?;
    let manifest: Value =
        serde_json::from_str(&manifest_text).map_err(|error| DesignerDiagnostic {
            code: "manifest_parse_failed".to_string(),
            severity: "error".to_string(),
            message: format!("Unable to parse manifest JSON: {error}"),
            path: Some(display_path(&manifest_path)),
        })?;

    let fallback_id = document_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("untitled")
        .to_string();
    let document_id = read_string_field(&manifest, "documentId").unwrap_or(fallback_id);
    let title = read_string_field(&manifest, "title").unwrap_or_else(|| document_id.clone());
    let status = read_string_field(&manifest, "status").unwrap_or_else(|| "draft".to_string());
    let module = read_string_field(&manifest, "module");
    let updated_at = read_string_field(&manifest, "updatedAt");
    let tags = manifest
        .get("tags")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(Some(DesignerDocumentSummary {
        document_id,
        title,
        module,
        status,
        path: document_dir
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| format!("{DOCUMENTS_DIR}/{name}"))
            .unwrap_or_else(|| DOCUMENTS_DIR.to_string()),
        updated_at,
        block_count: count_document_blocks(document_dir),
        tags,
    }))
}

fn read_string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn count_document_blocks(document_dir: &Path) -> usize {
    let design_path = document_dir.join("design.json");
    if let Ok(text) = fs::read_to_string(&design_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            if let Some(blocks) = value.get("blocks").and_then(Value::as_array) {
                return blocks.len();
            }
        }
    }

    let blocks_dir = document_dir.join("blocks");
    fs::read_dir(blocks_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .count()
        })
        .unwrap_or(0)
}

fn read_json_file<T>(path: &Path) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let text = fs::read_to_string(path).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_READ_FAILED: unable to read '{}': {error}",
            path.display()
        )
    })?;
    serde_json::from_str(&text).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_PARSE_FAILED: unable to parse '{}': {error}",
            path.display()
        )
    })
}

fn write_block_files(document_root: &Path, blocks: &[DesignerBlock]) -> Result<(), String> {
    let blocks_dir = document_root.join("blocks");
    fs::create_dir_all(&blocks_dir).map_err(|error| {
        format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to create blocks directory: {error}")
    })?;
    let active_files = blocks
        .iter()
        .map(|block| format!("{}.json", block.id))
        .collect::<HashSet<_>>();
    for entry in fs::read_dir(&blocks_dir).map_err(|error| {
        format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to read blocks directory: {error}")
    })? {
        let entry = entry.map_err(|error| {
            format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to inspect block file: {error}")
        })?;
        if !entry
            .file_type()
            .map_err(|error| {
                format!("BUSINESS_DESIGNER_SAVE_FAILED: unable to inspect block file type: {error}")
            })?
            .is_file()
        {
            continue;
        }
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.ends_with(".json") && !active_files.contains(file_name.as_ref()) {
            fs::remove_file(entry.path()).map_err(|error| {
                format!(
                    "BUSINESS_DESIGNER_SAVE_FAILED: unable to remove stale block file '{}': {error}",
                    entry.path().display()
                )
            })?;
        }
    }
    for block in blocks {
        atomic_write_json(&blocks_dir.join(format!("{}.json", block.id)), block)?;
    }
    Ok(())
}

fn update_docs_index(docs_root: &Path) -> Result<(), String> {
    let documents_dir = docs_root.join(DOCUMENTS_DIR);
    let (documents, _) = read_document_summaries(&documents_dir)?;
    let index_documents = documents
        .into_iter()
        .map(|document| {
            json!({
                "documentId": document.document_id,
                "title": document.title,
                "module": document.module,
                "status": document.status,
                "path": document.path,
                "updatedAt": document.updated_at,
                "blockCount": document.block_count,
                "tags": document.tags,
            })
        })
        .collect::<Vec<_>>();
    atomic_write_json(
        &docs_root.join("index.json"),
        &json!({
            "schemaVersion": DESIGNER_SCHEMA_VERSION,
            "documents": index_documents,
        }),
    )
}

fn atomic_write_json<T>(path: &Path, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    atomic_write_text(path, &stable_json_string(value)?)
}

fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "BUSINESS_DESIGNER_WRITE_FAILED: '{}' does not have a parent directory",
            path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_WRITE_FAILED: unable to create '{}': {error}",
            parent.display()
        )
    })?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "BUSINESS_DESIGNER_WRITE_FAILED: invalid file name '{}'",
                path.display()
            )
        })?;
    let temp_path = parent.join(format!(".{file_name}.tmp"));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "BUSINESS_DESIGNER_WRITE_FAILED: unable to open '{}': {error}",
                    temp_path.display()
                )
            })?;
        file.write_all(content.as_bytes()).map_err(|error| {
            format!(
                "BUSINESS_DESIGNER_WRITE_FAILED: unable to write '{}': {error}",
                temp_path.display()
            )
        })?;
        file.sync_all().map_err(|error| {
            format!(
                "BUSINESS_DESIGNER_WRITE_FAILED: unable to sync '{}': {error}",
                temp_path.display()
            )
        })?;
    }
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "BUSINESS_DESIGNER_WRITE_FAILED: unable to replace '{}': {error}",
            path.display()
        )
    })
}

fn stable_json_string<T>(value: &T) -> Result<String, String>
where
    T: Serialize,
{
    serde_json::to_string_pretty(value)
        .map(|json| format!("{json}\n"))
        .map_err(|error| format!("BUSINESS_DESIGNER_SERIALIZE_FAILED: {error}"))
}

fn build_agent_task_request_id(
    detail: &DesignerDocumentDetail,
    target: &DesignerAgentTaskTarget,
) -> String {
    let mut hash = AGENT_REQUEST_HASH_OFFSET;
    feed_agent_request_hash_part(&mut hash, &detail.manifest.document_id);
    feed_agent_request_hash_part(&mut hash, &detail.design.revision);
    feed_agent_request_hash_part(&mut hash, &target.host_block_id);
    feed_agent_request_hash_part(&mut hash, target.scope.as_str());
    for key in &target.target_gap_keys {
        feed_agent_request_hash_part(&mut hash, key);
    }
    for code in &target.gap_codes {
        feed_agent_request_hash_part(&mut hash, code);
    }
    format!("bdreq_{hash:016x}")
}

fn feed_agent_request_hash_part(hash: &mut u64, value: &str) {
    for byte in value.as_bytes() {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(AGENT_REQUEST_HASH_PRIME);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(AGENT_REQUEST_HASH_PRIME);
}

fn render_readme(detail: &DesignerDocumentDetail) -> String {
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", detail.manifest.title));
    if let Some(module) = detail.manifest.module.as_deref() {
        output.push_str(&format!("- Module: {module}\n"));
    }
    output.push_str(&format!(
        "- Document ID: {}\n- Revision: {}\n- Status: {}\n\n",
        detail.manifest.document_id, detail.design.revision, detail.manifest.status
    ));
    for block in sorted_blocks(&detail.design.blocks) {
        output.push_str(&format!(
            "## {}\n\n{}\n\n",
            block.title,
            render_block_markdown(block)
        ));
    }
    output
}

fn render_agent_brief(detail: &DesignerDocumentDetail) -> String {
    let mut output = String::new();
    output.push_str(&format!("# Agent Brief: {}\n\n", detail.manifest.title));
    output.push_str("## Context\n\n");
    output.push_str(&format!(
        "- Workspace document: {}\n- Revision: {}\n- Contract: DesignerAgentPatch\n\n",
        detail.manifest.document_id, detail.design.revision
    ));
    output.push_str("## Instructions\n\n");
    for block in sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|block| block.kind == "agentInstruction")
    {
        output.push_str(&format!(
            "### {}\n\n{}\n\n",
            block.title,
            render_block_markdown(block)
        ));
    }
    output.push_str("## Required Acceptance\n\n");
    for block in sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|block| block.kind == "acceptanceCriteria")
    {
        output.push_str(&render_block_markdown(block));
        output.push('\n');
    }
    output
}

fn render_contracts(detail: &DesignerDocumentDetail) -> String {
    let mut output = String::new();
    output.push_str(&format!("# Contracts: {}\n\n", detail.manifest.title));
    for block in sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|block| {
            matches!(
                block.kind.as_str(),
                "apiContract" | "dataContract" | "entityModel"
            )
        })
    {
        output.push_str(&format!(
            "## {}\n\n{}\n\n",
            block.title,
            render_block_markdown(block)
        ));
    }
    if output.trim() == format!("# Contracts: {}", detail.manifest.title) {
        output.push_str("No contract blocks are defined yet.\n");
    }
    output
}

fn render_acceptance(detail: &DesignerDocumentDetail) -> String {
    let mut output = String::new();
    output.push_str(&format!("# Acceptance: {}\n\n", detail.manifest.title));
    for block in sorted_blocks(&detail.design.blocks)
        .into_iter()
        .filter(|block| block.kind == "acceptanceCriteria")
    {
        output.push_str(&format!(
            "## {}\n\n{}\n\n",
            block.title,
            render_block_markdown(block)
        ));
    }
    output
}

fn build_coding_tasks(detail: &DesignerDocumentDetail) -> Vec<DesignerCodingTask> {
    let blocks = sorted_blocks(&detail.design.blocks);
    let has_contracts = blocks.iter().any(|block| {
        matches!(
            block.kind.as_str(),
            "apiContract" | "dataContract" | "entityModel"
        )
    });
    let has_acceptance = blocks
        .iter()
        .any(|block| block.kind == "acceptanceCriteria");
    let risk_refs = blocks
        .iter()
        .filter(|block| matches!(block.kind.as_str(), "openQuestions" | "riskReview"))
        .map(|block| block.id.clone())
        .collect::<Vec<_>>();

    vec![
        DesignerCodingTask {
            id: "implementation-plan".to_string(),
            title: "Map the requirement package to concrete code changes".to_string(),
            markdown: "Inspect the linked requirement package, identify the affected modules, and keep implementation inside existing feature/module boundaries.".to_string(),
            acceptance_refs: acceptance_block_ids(detail),
            contract_refs: if has_contracts {
                contract_block_ids(detail)
            } else {
                Vec::new()
            },
            risk_refs: risk_refs.clone(),
        },
        DesignerCodingTask {
            id: "implementation".to_string(),
            title: "Implement the requested behavior".to_string(),
            markdown: "Make the smallest cohesive code changes required by the business design. Preserve existing architecture, typed contracts, workspace path safety, and native desktop interaction boundaries.".to_string(),
            acceptance_refs: if has_acceptance {
                acceptance_block_ids(detail)
            } else {
                Vec::new()
            },
            contract_refs: contract_block_ids(detail),
            risk_refs: risk_refs.clone(),
        },
        DesignerCodingTask {
            id: "verification".to_string(),
            title: "Verify and report evidence".to_string(),
            markdown: "Run the narrowest meaningful validation for the implementation, then report changed files, commands, results, and any unresolved open questions.".to_string(),
            acceptance_refs: acceptance_block_ids(detail),
            contract_refs: Vec::new(),
            risk_refs,
        },
    ]
}

fn render_coding_handoff_markdown(
    detail: &DesignerDocumentDetail,
    tasks: &[DesignerCodingTask],
) -> String {
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", detail.manifest.title));
    output.push_str("You are receiving a GT Office Business Designer coding handoff.\n\n");
    output.push_str("## Requirement Package\n\n");
    output.push_str(&format!(
        "- Document ID: `{}`\n- Revision: `{}`\n- README: `.gtoffice/docs/documents/{}/README.md`\n- Agent brief: `.gtoffice/docs/documents/{}/{}`\n- Agent input JSON: `.gtoffice/docs/documents/{}/{}`\n\n",
        detail.manifest.document_id,
        detail.design.revision,
        detail.manifest.document_id,
        detail.manifest.document_id,
        detail.manifest.generated.agent_brief,
        detail.manifest.document_id,
        detail.manifest.generated.agent_input,
    ));
    output.push_str("## Operating Rules\n\n");
    output.push_str("- Treat the requirement package as the source of truth.\n");
    output
        .push_str("- Do not modify `.gtoffice/docs` requirement files unless explicitly asked.\n");
    output.push_str("- Keep commands and file writes inside the workspace.\n");
    output.push_str("- Preserve existing module boundaries and desktop native-feel behavior.\n");
    output
        .push_str("- Report validation evidence and unresolved questions before handing over.\n\n");
    output.push_str("## Task Breakdown\n\n");
    for task in tasks {
        output.push_str(&format!("### {}\n\n{}\n\n", task.title, task.markdown));
        output.push_str(&format_refs("Acceptance refs", &task.acceptance_refs));
        output.push_str(&format_refs("Contract refs", &task.contract_refs));
        output.push_str(&format_refs("Risk/open-question refs", &task.risk_refs));
        output.push('\n');
    }
    output.push_str("## Agent Brief\n\n");
    output.push_str(&render_agent_brief(detail));
    output
}

fn format_refs(label: &str, refs: &[String]) -> String {
    if refs.is_empty() {
        format!("- {label}: none\n")
    } else {
        format!("- {label}: `{}`\n", refs.join("`, `"))
    }
}

/// Render the instruction typed into the agent's terminal for a v1
/// host-anchored Agent completion. The agent returns a typed patch; it must not
/// edit files directly.
fn render_design_completion_markdown_with_host(
    detail: &DesignerDocumentDetail,
    host_block_id: &str,
    gap_codes: &[String],
    target_gap_keys: &[String],
    scope: DesignerAgentTaskScope,
) -> String {
    let design_path = format!(
        "{}/documents/{}/design.json",
        detail.docs_root, detail.manifest.document_id
    );
    let brief_summary = detail
        .design
        .blocks
        .iter()
        .find(|block| block.kind == "text")
        .map(|block| {
            block
                .payload
                .get("markdown")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        })
        .unwrap_or("");
    let mut output = String::new();
    output.push_str(&format!(
        "# Agent completion: {}\n\n",
        detail.manifest.title
    ));
    output.push_str(
        "You are editing a GT Office Business Designer document through the CLI Agent.\n\n",
    );
    output.push_str("## Your task\n\n");
    output.push_str(
        "Edit the Business Designer document files directly. The GT Office workbench is only the \
         visual control surface; it will reload and validate the files after you save them.\n\n",
    );
    output.push_str("## Design file\n\n");
    output.push_str(&format!("- Path: `{}`\n", design_path));
    output.push_str(&format!(
        "- Document ID: `{}`\n",
        detail.manifest.document_id
    ));
    output.push_str(&format!("- Revision: `{}`\n\n", detail.design.revision));
    output.push_str("### Document shape\n\n");
    output.push_str(
        "```json\n{\n  \"schemaVersion\": 1,\n  \"documentId\": \"<id>\",\n  \"revision\": \
         \"<keep as-is>\",\n  \"title\": \"<title>\",\n  \"blocks\": [\n    {\n      \"id\": \
         \"<stable id>\",\n      \"kind\": \"text|entityModel|apiContract|acceptanceCriteria|\
         openQuestions|...\",\n      \"title\": \"<section title>\",\n      \"order\": <integer>,\
         \n      \"payload\": { ... per kind ... },\n      \"links\": [],\n      \"validation\": [],\
         \n      \"updatedAt\": \"<iso timestamp>\"\n    }\n  ]\n}\n```\n\n",
    );
    output.push_str("### Block kinds & payloads\n\n");
    output.push_str(
        "- `text`: `{ \"markdown\": \"...\" }`\n\
         - `entityModel`: `{ \"entityName\": \"Order\", \"fields\": [{ \"name\": \"id\", \"type\": \
         \"string\", \"required\": true, \"description\": \"\" }] }`\n\
         - `apiContract`: `{ \"endpoints\": [{ \"method\": \"POST\", \"path\": \"/orders\", \
         \"responseShape\": \"Order\", \"errors\": [] }] }`\n\
         - `businessFlow`: `{ \"states\": [{ \"name\": \"Draft\" }], \"transitions\": [] }`\n\n",
    );
    output.push_str("## Brief\n\n");
    if brief_summary.trim().is_empty() {
        output.push_str(
            "_(The user has not written a brief yet. Infer the goal from the document \
                         title and any existing blocks, and propose a starting brief plus the \
                         structured blocks it implies.)_\n\n",
        );
    } else {
        output.push_str(brief_summary.trim());
        output.push_str("\n\n");
    }
    output.push_str("## Operating rules\n\n");
    output.push_str(
        "- Edit only files inside the Business Designer document directory for this document.\n",
    );
    output.push_str("- The primary file to edit is the `Design file` path above.\n");
    output.push_str("- Do not edit application source code, tests, build scripts, dependencies, or repository configuration.\n");
    output.push_str("- Keep JSON valid and readable.\n");
    output.push_str("- Do not return a `DesignerAgentPatch`; save the file changes instead.\n");
    output.push_str("- When done, reply with a concise summary of changed files and remaining human-review items.\n");
    output.push_str("- `schemaVersion` must remain 1.\n");
    output.push_str(&format!(
        "- `documentId` must be `{}`.\n",
        detail.manifest.document_id
    ));
    output.push_str(&format!(
        "- `baseRevision` must be `{}`.\n",
        detail.design.revision
    ));
    output.push_str("- Do not add `requestId` to design files; it is dispatch metadata.\n");
    output.push_str(&format!(
        "- Focus changes on host block `{host_block_id}`.\n"
    ));
    output.push_str(&format!("- `scope` must be `{}`.\n", scope.as_str()));
    if gap_codes.is_empty() {
        output.push_str("- `gapCodes` must contain the target gaps from this task.\n");
    } else {
        output.push_str(&format!(
            "- `gapCodes` must be exactly: `{}`.\n",
            gap_codes.join(", ")
        ));
    }
    if target_gap_keys.is_empty() {
        output.push_str("- `targetGapKeys` must be an empty array.\n");
    } else {
        output.push_str(&format!(
            "- `targetGapKeys` must be exactly: `{}`.\n",
            target_gap_keys.join(", ")
        ));
    }
    output.push_str("- Prefer updating the host block. Add adjacent design blocks only when they are necessary to complete the selected gap.\n");
    output.push_str("- Do not hand-author `links`; graph edges are derived by validation.\n");
    output.push_str(
        "- If you cannot safely fix the target gaps, leave the file unchanged and explain what human decision is missing.\n",
    );
    output
}

/// Standard requirement-package attachments shared by both the in-place design
/// completion and the coding handoff: the human-facing overview plus the
/// machine-readable brief/input so the receiving agent has full context.
fn requirement_package_attachments(detail: &DesignerDocumentDetail) -> Vec<TaskAttachment> {
    vec![
        TaskAttachment {
            path: format!("documents/{}/README.md", detail.manifest.document_id),
            name: "Business Designer README".to_string(),
            category: "requirement".to_string(),
        },
        TaskAttachment {
            path: format!(
                "documents/{}/{}",
                detail.manifest.document_id, detail.manifest.generated.agent_brief
            ),
            name: "Agent brief".to_string(),
            category: "agent-brief".to_string(),
        },
        TaskAttachment {
            path: format!(
                "documents/{}/{}",
                detail.manifest.document_id, detail.manifest.generated.agent_input
            ),
            name: "Agent input".to_string(),
            category: "agent-input".to_string(),
        },
    ]
}

fn acceptance_block_ids(detail: &DesignerDocumentDetail) -> Vec<String> {
    detail
        .design
        .blocks
        .iter()
        .filter(|block| block.kind == "acceptanceCriteria")
        .map(|block| block.id.clone())
        .collect()
}

fn contract_block_ids(detail: &DesignerDocumentDetail) -> Vec<String> {
    detail
        .design
        .blocks
        .iter()
        .filter(|block| {
            matches!(
                block.kind.as_str(),
                "apiContract" | "dataContract" | "entityModel"
            )
        })
        .map(|block| block.id.clone())
        .collect()
}

fn render_agent_input(detail: &DesignerDocumentDetail) -> Value {
    let blocks = sorted_blocks(&detail.design.blocks)
        .into_iter()
        .map(|block| {
            json!({
                "id": block.id,
                "kind": block.kind,
                "title": block.title,
                "order": block.order,
                "payload": block.payload,
                "links": block.links,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "schemaVersion": DESIGNER_SCHEMA_VERSION,
        "documentId": detail.manifest.document_id,
        "title": detail.manifest.title,
        "module": detail.manifest.module,
        "revision": detail.design.revision,
        "status": detail.manifest.status,
        "blocks": blocks,
        "outputContract": "DesignerAgentPatch",
    })
}

fn render_preview_html(detail: &DesignerDocumentDetail) -> String {
    let mut body = String::new();
    body.push_str(&format!(
        "<h1>{}</h1><p class=\"meta\">{} · {}</p>",
        html_escape(&detail.manifest.title),
        html_escape(&detail.manifest.document_id),
        html_escape(&detail.design.revision)
    ));
    for block in sorted_blocks(&detail.design.blocks) {
        body.push_str(&format!(
            "<section><div class=\"kind\">{}</div><h2>{}</h2><pre>{}</pre></section>",
            html_escape(&block.kind),
            html_escape(&block.title),
            html_escape(&render_block_markdown(block))
        ));
    }
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{}</title>
  <style>
    :root {{ color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 2rem; line-height: 1.5; }}
    .meta, .kind {{ color: color-mix(in srgb, CanvasText 55%, transparent); }}
    section {{ border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); padding-block: 1rem; }}
    pre {{ white-space: pre-wrap; font: inherit; }}
  </style>
</head>
<body>{body}</body>
</html>
"#,
        html_escape(&detail.manifest.title)
    )
}

fn render_block_markdown(block: &DesignerBlock) -> String {
    match block.kind.as_str() {
        "text" => payload_string(&block.payload, "markdown").unwrap_or_else(|| "{}".to_string()),
        "agentInstruction" => {
            payload_string(&block.payload, "instructions").unwrap_or_else(|| "{}".to_string())
        }
        "acceptanceCriteria" => render_payload_list(&block.payload, "criteria"),
        "openQuestions" => render_payload_list(&block.payload, "questions"),
        "entityModel" => render_entity_model(&block.payload),
        "apiContract" => render_api_contract(&block.payload),
        "uiScreen" => render_ui_screen_markdown(&block.payload),
        "dataContract" => render_data_contract_markdown(&block.payload),
        _ => stable_json_string(&block.payload).unwrap_or_else(|_| "{}\n".to_string()),
    }
}

/// Render a `uiScreen` block: heading + route + the HTML body in a fenced block.
fn render_ui_screen_markdown(payload: &Value) -> String {
    let name = payload_string(payload, "screenName").unwrap_or_default();
    let route = payload_string(payload, "route").unwrap_or_default();
    let html = payload_string(payload, "html").unwrap_or_default();
    let mut out = String::new();
    if !name.is_empty() {
        out.push_str(&format!("### {name}\n\n"));
    }
    if !route.is_empty() {
        out.push_str(&format!("- Route: `{route}`\n\n"));
    }
    if !html.is_empty() {
        out.push_str("```html\n");
        out.push_str(&html);
        out.push_str("\n```\n");
    }
    out
}

/// Render a `dataContract` block: the schema (object or string) in a json fence.
fn render_data_contract_markdown(payload: &Value) -> String {
    let Some(schema) = payload.get("schema") else {
        return String::new();
    };
    let pretty = match schema {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| "{}".to_string()),
    };
    format!("```json\n{pretty}\n```\n")
}

fn render_payload_list(payload: &Value, key: &str) -> String {
    match payload.get(key).and_then(Value::as_array) {
        Some(items) if !items.is_empty() => items
            .iter()
            .filter_map(Value::as_str)
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => "_No items yet._".to_string(),
    }
}

fn render_entity_model(payload: &Value) -> String {
    let entity_name = payload_string(payload, "entityName").unwrap_or_else(|| "Entity".to_string());
    let mut output = format!("Entity: {entity_name}\n");
    if let Some(fields) = payload.get("fields").and_then(Value::as_array) {
        for field in fields {
            if let Some(name) = read_string_field(field, "name") {
                let field_type =
                    read_string_field(field, "type").unwrap_or_else(|| "unknown".to_string());
                output.push_str(&format!("- {name}: {field_type}\n"));
            }
        }
    }
    output
}

fn render_api_contract(payload: &Value) -> String {
    let mut output = String::new();
    if let Some(endpoints) = payload.get("endpoints").and_then(Value::as_array) {
        output.push_str("Endpoints:\n");
        for endpoint in endpoints {
            if let Some(path) = read_string_field(endpoint, "path") {
                let method =
                    read_string_field(endpoint, "method").unwrap_or_else(|| "GET".to_string());
                output.push_str(&format!("- {method} {path}\n"));
            }
        }
    }
    if let Some(events) = payload.get("events").and_then(Value::as_array) {
        output.push_str("Events:\n");
        for event in events {
            if let Some(name) = event
                .as_str()
                .or_else(|| event.get("name").and_then(Value::as_str))
            {
                output.push_str(&format!("- {name}\n"));
            }
        }
    }
    if output.trim().is_empty() {
        "_No API contract yet._".to_string()
    } else {
        output
    }
}

fn sorted_blocks(blocks: &[DesignerBlock]) -> Vec<&DesignerBlock> {
    let mut sorted = blocks.iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    sorted
}

fn diagnostic(
    code: &str,
    severity: &str,
    message: impl Into<String>,
    path: Option<String>,
) -> DesignerDiagnostic {
    DesignerDiagnostic {
        code: code.to_string(),
        severity: severity.to_string(),
        message: message.into(),
        path,
    }
}

fn is_supported_block_kind(kind: &str) -> bool {
    matches!(
        kind,
        "text"
            | "glossary"
            | "entityModel"
            | "businessFlow"
            | "ruleTable"
            | "pseudocode"
            | "objectModel"
            | "apiContract"
            | "dataContract"
            | "uiWorkflow"
            | "uiScreen"
            | "technicalStack"
            | "nonFunctional"
            | "acceptanceCriteria"
            | "openQuestions"
            | "agentInstruction"
            | "decisionRecord"
    )
}

fn payload_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn payload_list_has_values(payload: &Value, key: &str) -> bool {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .any(|item| item.as_str().is_some_and(|value| !value.trim().is_empty()))
        })
        .unwrap_or(false)
}

fn run_git(docs_root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(docs_root)
        .args(args)
        .output()
        .map_err(|error| {
            format!(
                "BUSINESS_DESIGNER_GIT_UNAVAILABLE: unable to run git {}: {error}",
                args.join(" ")
            )
        })?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(format!(
            "BUSINESS_DESIGNER_GIT_FAILED: git {} failed: {}",
            args.join(" "),
            command_stderr(&output.stderr)
        ))
    }
}

fn git_status_entries(
    docs_root: &Path,
    pathspec: Option<&str>,
) -> Result<Vec<DesignerDiffEntry>, String> {
    let mut args = vec!["status", "--porcelain", "--"];
    if let Some(pathspec) = pathspec {
        args.push(pathspec);
    }
    let stdout = run_git(docs_root, &args)?;
    let text = String::from_utf8_lossy(&stdout);
    Ok(text
        .lines()
        .filter_map(parse_status_line)
        .collect::<Vec<_>>())
}

fn git_diff_entries(
    docs_root: &Path,
    base: &str,
    pathspec: Option<&str>,
) -> Result<Vec<DesignerDiffEntry>, String> {
    let mut args = vec!["diff", "--name-status", base, "--"];
    if let Some(pathspec) = pathspec {
        args.push(pathspec);
    }
    let stdout = run_git(docs_root, &args)?;
    let text = String::from_utf8_lossy(&stdout);
    Ok(text.lines().filter_map(parse_name_status_line).collect())
}

fn git_diff_between_entries(
    docs_root: &Path,
    base: &str,
    head: &str,
    pathspec: Option<&str>,
) -> Result<Vec<DesignerDiffEntry>, String> {
    let mut args = vec!["diff", "--name-status", base, head, "--"];
    if let Some(pathspec) = pathspec {
        args.push(pathspec);
    }
    let stdout = run_git(docs_root, &args)?;
    let text = String::from_utf8_lossy(&stdout);
    Ok(text.lines().filter_map(parse_name_status_line).collect())
}

fn parse_status_line(line: &str) -> Option<DesignerDiffEntry> {
    if line.len() < 4 {
        return None;
    }
    let status = line.get(0..2)?.trim().to_string();
    let path = line.get(3..)?.trim();
    let path = path.split(" -> ").last().unwrap_or(path).trim();
    Some(DesignerDiffEntry {
        status: if status.is_empty() {
            "?".to_string()
        } else {
            status
        },
        path: path.to_string(),
    })
}

fn parse_name_status_line(line: &str) -> Option<DesignerDiffEntry> {
    let mut parts = line.split('\t');
    let status = parts.next()?.trim();
    let path = parts.next_back().or_else(|| parts.next())?.trim();
    if status.is_empty() || path.is_empty() {
        return None;
    }
    Some(DesignerDiffEntry {
        status: status.to_string(),
        path: path.to_string(),
    })
}

fn parse_checkpoint_log_line(line: &str) -> Option<DesignerCheckpointEntry> {
    let mut parts = line.split('\x1f');
    let commit = parts.next()?.trim();
    let short_commit = parts.next()?.trim();
    let authored_at = parts.next()?.trim();
    let summary = parts.next()?.trim();
    if commit.is_empty() {
        return None;
    }
    Some(DesignerCheckpointEntry {
        commit: commit.to_string(),
        short_commit: short_commit.to_string(),
        authored_at: authored_at.to_string(),
        summary: summary.to_string(),
    })
}

fn command_stderr(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr).trim().to_string();
    if text.is_empty() {
        "command failed without stderr".to_string()
    } else {
        text
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn docs_index_template() -> String {
    format!("{{\n  \"schemaVersion\": {DESIGNER_SCHEMA_VERSION},\n  \"documents\": []\n}}\n")
}

fn business_module_template() -> String {
    format!(
        r#"{{
  "schemaVersion": {DESIGNER_SCHEMA_VERSION},
  "templateId": "business-module",
  "title": "Business Module",
  "blockKinds": [
    "text",
    "glossary",
    "entityModel",
    "businessFlow",
    "apiContract",
    "acceptanceCriteria",
    "agentInstruction",
    "openQuestions"
  ]
}}
"#
    )
}

fn agent_brief_template() -> String {
    format!(
        r#"{{
  "schemaVersion": {DESIGNER_SCHEMA_VERSION},
  "templateId": "agent-brief",
  "title": "Agent Brief",
  "blockKinds": [
    "text",
    "technicalStack",
    "apiContract",
    "acceptanceCriteria",
    "agentInstruction",
    "decisionRecord"
  ]
}}
"#
    )
}

#[cfg(test)]
#[path = "tests/mod_tests.rs"]
mod tests;
