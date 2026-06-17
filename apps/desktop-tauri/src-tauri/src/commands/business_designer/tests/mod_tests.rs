use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use gt_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelDescriptor, ChannelKind, ChannelMessageType,
    ChannelPublishRequest,
};
use serde_json::json;

use crate::app_state::AppState;

use super::{
    apply_agent_patch_at, compare_checkpoints_at, compile_document_at, create_checkpoint_at,
    create_document_at, diff_checkpoint_at, ensure_docs_git_repository, ensure_docs_scaffold_at,
    export_document_at, list_checkpoints_at, list_documents_at, preview_coding_handoff_at,
    read_document_at, recover_agent_patch_from_task_at, run_agent_completion_at, save_document_at,
    validate_agent_patch_at,
};

struct TempWorkspace {
    root: PathBuf,
}

impl TempWorkspace {
    fn new(name: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("gto-business-designer-{name}-{unique}"));
        fs::create_dir_all(&root).expect("create temp workspace");
        Self { root }
    }

    fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn list_documents_reports_uninitialized_scaffold() {
    let temp = TempWorkspace::new("uninitialized");
    let response = list_documents_at("ws-1", temp.root()).expect("list documents");

    assert_eq!(response.workspace_id, "ws-1");
    assert_eq!(response.docs_root, ".gtoffice/docs");
    assert!(!response.scaffold_initialized);
    assert!(!response.repo_initialized);
    assert!(response.documents.is_empty());
    assert!(response.diagnostics.is_empty());
}

#[test]
fn ensure_docs_scaffold_writes_base_directories_and_templates() {
    let temp = TempWorkspace::new("scaffold");
    let docs_root = temp.root().join(".gtoffice").join("docs");

    let first = ensure_docs_scaffold_at(&docs_root).expect("first scaffold");
    let second = ensure_docs_scaffold_at(&docs_root).expect("second scaffold");

    assert!(first.scaffold_created);
    assert!(first.templates_written);
    assert!(!second.scaffold_created);
    assert!(!second.templates_written);
    assert!(docs_root.join("documents").is_dir());
    assert!(docs_root
        .join("templates/business-module.template.json")
        .is_file());
    assert!(docs_root
        .join("templates/agent-brief.template.json")
        .is_file());
    assert!(docs_root.join("index.json").is_file());
}

#[test]
fn list_documents_reads_manifest_and_block_count() {
    let temp = TempWorkspace::new("manifest");
    let docs_root = temp.root().join(".gtoffice").join("docs");
    ensure_docs_scaffold_at(&docs_root).expect("scaffold");
    let document_root = docs_root.join("documents/order-system");
    fs::create_dir_all(&document_root).expect("create document root");
    fs::write(
        document_root.join("manifest.json"),
        r#"{
  "schemaVersion": 1,
  "documentId": "order-system",
  "title": "Order System",
  "module": "commerce",
  "status": "draft",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "tags": ["order", "commerce"]
}"#,
    )
    .expect("write manifest");
    fs::write(
        document_root.join("design.json"),
        r#"{"schemaVersion":1,"blocks":[{"id":"overview"},{"id":"api"}]}"#,
    )
    .expect("write design");

    let response = list_documents_at("ws-1", temp.root()).expect("list documents");

    assert!(response.scaffold_initialized);
    assert_eq!(response.documents.len(), 1);
    let summary = &response.documents[0];
    assert_eq!(summary.document_id, "order-system");
    assert_eq!(summary.title, "Order System");
    assert_eq!(summary.module.as_deref(), Some("commerce"));
    assert_eq!(summary.path, "documents/order-system");
    assert_eq!(summary.block_count, 2);
    assert_eq!(summary.tags, vec!["order", "commerce"]);
    assert!(response.diagnostics.is_empty());
}

#[test]
fn list_documents_returns_manifest_parse_diagnostic() {
    let temp = TempWorkspace::new("diagnostic");
    let docs_root = temp.root().join(".gtoffice").join("docs");
    ensure_docs_scaffold_at(&docs_root).expect("scaffold");
    let document_root = docs_root.join("documents/broken");
    fs::create_dir_all(&document_root).expect("create document root");
    fs::write(document_root.join("manifest.json"), "{not-json").expect("write manifest");

    let response = list_documents_at("ws-1", temp.root()).expect("list documents");

    assert!(response.documents.is_empty());
    assert_eq!(response.diagnostics.len(), 1);
    assert_eq!(response.diagnostics[0].code, "manifest_parse_failed");
    assert_eq!(response.diagnostics[0].severity, "error");
}

#[test]
fn create_document_writes_manifest_design_blocks_and_index() {
    let temp = TempWorkspace::new("create");

    let detail = create_document_at(
        "ws-1",
        temp.root(),
        "order-system",
        "Order System",
        Some("commerce"),
    )
    .expect("create document");

    let document_root = temp.root().join(".gtoffice/docs/documents/order-system");
    assert_eq!(detail.manifest.document_id, "order-system");
    assert_eq!(detail.manifest.module.as_deref(), Some("commerce"));
    assert!(document_root.join("manifest.json").is_file());
    assert!(document_root.join("design.json").is_file());
    assert!(document_root.join("blocks/overview.json").is_file());
    assert!(temp.root().join(".gtoffice/docs/index.json").is_file());

    let list = list_documents_at("ws-1", temp.root()).expect("list documents");
    assert_eq!(list.documents.len(), 1);
    assert_eq!(list.documents[0].block_count, detail.design.blocks.len());
}

#[test]
fn read_and_save_document_round_trip_blocks() {
    let temp = TempWorkspace::new("save");
    let mut detail = create_document_at("ws-1", temp.root(), "billing", "Billing", None)
        .expect("create document");
    detail.design.blocks[0].title = "业务目标".to_string();
    detail.design.blocks[0].payload = json!({
        "markdown": "Billing handles invoices and payments."
    });

    let saved = save_document_at("ws-1", temp.root(), detail).expect("save document");
    let read_back = read_document_at("ws-1", temp.root(), "billing").expect("read document");

    assert_eq!(saved.manifest.title, "Billing");
    assert_eq!(read_back.design.blocks[0].title, "业务目标");
    assert_eq!(
        read_back.design.blocks[0]
            .payload
            .get("markdown")
            .and_then(|value| value.as_str()),
        Some("Billing handles invoices and payments.")
    );
}

#[test]
fn save_document_returns_validation_errors_without_writing_invalid_graph() {
    let temp = TempWorkspace::new("invalid-save");
    let mut detail =
        create_document_at("ws-1", temp.root(), "crm", "CRM", None).expect("create document");
    detail.design.document_id = "other".to_string();

    let error = save_document_at("ws-1", temp.root(), detail).expect_err("invalid save");
    assert!(error.contains("design.documentId must match manifest.documentId"));
}

#[test]
fn compile_document_writes_markdown_agent_input_and_preview() {
    let temp = TempWorkspace::new("compile");
    let mut detail = create_document_at("ws-1", temp.root(), "inventory", "Inventory", None)
        .expect("create document");
    if let Some(block) = detail
        .design
        .blocks
        .iter_mut()
        .find(|block| block.kind == "acceptanceCriteria")
    {
        block.payload =
            json!({ "criteria": ["Given stock exists, when reserved, then quantity decreases."] });
    }
    save_document_at("ws-1", temp.root(), detail).expect("save document");

    let compiled = compile_document_at("ws-1", temp.root(), "inventory").expect("compile");
    let document_root = temp.root().join(".gtoffice/docs/documents/inventory");

    assert!(compiled.files.contains(&"README.md".to_string()));
    assert!(compiled
        .files
        .contains(&"generated/agent-input.json".to_string()));
    assert!(document_root.join("README.md").is_file());
    assert!(document_root.join("generated/agent-brief.md").is_file());
    assert!(document_root.join("generated/agent-input.json").is_file());
    assert!(document_root.join("generated/preview.html").is_file());
}

#[test]
fn checkpoint_commits_docs_repo_and_diff_reports_later_changes() {
    let temp = TempWorkspace::new("checkpoint");
    create_document_at("ws-1", temp.root(), "workflow", "Workflow", None).expect("create document");
    compile_document_at("ws-1", temp.root(), "workflow").expect("compile");

    let checkpoint = create_checkpoint_at(
        "ws-1",
        temp.root(),
        "workflow",
        "designer: checkpoint workflow",
    )
    .expect("checkpoint");

    assert!(checkpoint.committed);
    assert!(checkpoint.commit.is_some());

    let mut detail = read_document_at("ws-1", temp.root(), "workflow").expect("read document");
    detail.design.blocks[0].payload = json!({ "markdown": "Updated workflow scope." });
    save_document_at("ws-1", temp.root(), detail).expect("save document");

    let diff = diff_checkpoint_at("ws-1", temp.root(), Some("workflow"), None).expect("diff");
    assert!(diff
        .entries
        .iter()
        .any(|entry| entry.path == "documents/workflow/design.json"));
}

#[test]
fn checkpoint_returns_not_committed_when_tree_is_clean() {
    let temp = TempWorkspace::new("clean-checkpoint");
    let docs_root = temp.root().join(".gtoffice/docs");
    ensure_docs_scaffold_at(&docs_root).expect("scaffold");
    ensure_docs_git_repository(&docs_root).expect("git init");
    create_document_at("ws-1", temp.root(), "clean", "Clean", None).expect("create document");
    create_checkpoint_at("ws-1", temp.root(), "clean", "designer: checkpoint clean")
        .expect("first checkpoint");

    let second = create_checkpoint_at("ws-1", temp.root(), "clean", "designer: checkpoint clean")
        .expect("second checkpoint");

    assert!(!second.committed);
    assert!(second.commit.is_none());
}

#[test]
fn checkpoint_history_lists_document_commits() {
    let temp = TempWorkspace::new("history");
    create_document_at("ws-1", temp.root(), "history-doc", "History", None)
        .expect("create document");
    create_checkpoint_at(
        "ws-1",
        temp.root(),
        "history-doc",
        "designer: checkpoint history",
    )
    .expect("checkpoint");

    let history =
        list_checkpoints_at("ws-1", temp.root(), Some("history-doc")).expect("list history");

    assert_eq!(history.document_id.as_deref(), Some("history-doc"));
    assert_eq!(history.entries.len(), 1);
    assert!(history.entries[0]
        .summary
        .contains("designer: checkpoint history"));
}

#[test]
fn compare_checkpoints_reports_document_scoped_changes() {
    let temp = TempWorkspace::new("compare-checkpoints");
    let mut detail = create_document_at("ws-1", temp.root(), "compare-doc", "Compare Doc", None)
        .expect("create document");
    let first = create_checkpoint_at(
        "ws-1",
        temp.root(),
        "compare-doc",
        "designer: checkpoint compare initial",
    )
    .expect("first checkpoint")
    .commit
    .expect("first commit");
    detail.design.blocks[0].title = "Updated overview".to_string();
    save_document_at("ws-1", temp.root(), detail).expect("save document");
    let second = create_checkpoint_at(
        "ws-1",
        temp.root(),
        "compare-doc",
        "designer: checkpoint compare updated",
    )
    .expect("second checkpoint")
    .commit
    .expect("second commit");

    let diff = compare_checkpoints_at("ws-1", temp.root(), Some("compare-doc"), &first, &second)
        .expect("compare checkpoints");

    assert_eq!(diff.base.as_deref(), Some(first.as_str()));
    assert_eq!(diff.head.as_deref(), Some(second.as_str()));
    assert!(diff
        .entries
        .iter()
        .any(|entry| entry.path == "documents/compare-doc/design.json"));
}

#[test]
fn checkpoint_history_returns_empty_for_repo_without_commits() {
    let temp = TempWorkspace::new("empty-history");
    let docs_root = temp.root().join(".gtoffice/docs");
    ensure_docs_scaffold_at(&docs_root).expect("scaffold");
    ensure_docs_git_repository(&docs_root).expect("git init");

    let history = list_checkpoints_at("ws-1", temp.root(), None).expect("list history");

    assert!(history.entries.is_empty());
}

#[test]
fn mock_agent_completion_archives_valid_patch_preview() {
    let temp = TempWorkspace::new("mock-agent");
    let detail = create_document_at("ws-1", temp.root(), "agent-doc", "Agent Doc", None)
        .expect("create document");

    let preview = run_agent_completion_at(
        "ws-1",
        temp.root(),
        "agent-doc",
        "mock",
        &[detail.design.blocks[0].id.clone()],
    )
    .expect("mock completion");

    assert!(preview.valid);
    assert_eq!(preview.patch.document_id, "agent-doc");
    assert_eq!(preview.changes.len(), 1);
    assert!(preview.patch_path.as_deref().is_some_and(|path| {
        path.starts_with("documents/agent-doc/patches/agent-patch-agent-preview-")
    }));
}

#[test]
fn validate_agent_patch_rejects_stale_base_revision() {
    let temp = TempWorkspace::new("stale-patch");
    create_document_at("ws-1", temp.root(), "stale", "Stale", None).expect("create document");
    let patch = json!({
        "schemaVersion": 1,
        "documentId": "stale",
        "baseRevision": "old-revision",
        "summary": "stale",
        "changes": [],
        "openQuestions": []
    });

    let result =
        validate_agent_patch_at("ws-1", temp.root(), "stale", patch, None).expect("validate patch");

    assert!(!result.valid);
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "patch_base_revision_stale"));
}

#[test]
fn apply_agent_patch_accepts_selected_changes_and_archives_patch() {
    let temp = TempWorkspace::new("apply-patch");
    let detail = create_document_at("ws-1", temp.root(), "apply-doc", "Apply Doc", None)
        .expect("create document");
    let patch = json!({
        "schemaVersion": 1,
        "documentId": "apply-doc",
        "baseRevision": detail.design.revision,
        "summary": "Add and skip",
        "changes": [
            {
                "op": "addBlock",
                "afterBlockId": "overview",
                "block": {
                    "id": "agent-question",
                    "kind": "openQuestions",
                    "title": "Agent Question",
                    "payload": { "questions": ["Need SLA?"] }
                }
            },
            {
                "op": "deleteBlock",
                "blockId": "api-contract"
            }
        ],
        "openQuestions": []
    });

    let applied = apply_agent_patch_at("ws-1", temp.root(), "apply-doc", patch, Some(vec![0]))
        .expect("apply patch");

    assert_eq!(applied.accepted_changes, vec![0]);
    assert_eq!(applied.skipped_changes, vec![1]);
    assert!(applied
        .detail
        .design
        .blocks
        .iter()
        .any(|block| block.id == "agent-question"));
    assert!(applied
        .detail
        .design
        .blocks
        .iter()
        .any(|block| block.id == "api-contract"));
    assert!(applied
        .patch_path
        .starts_with("documents/apply-doc/patches/"));
}

#[test]
fn recover_agent_patch_from_task_reads_latest_reply_json_patch() {
    let temp = TempWorkspace::new("recover-patch");
    let state = AppState::default();
    state
        .task_service
        .register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "manager".to_string(),
            station_id: "manager".to_string(),
            role_key: None,
            session_id: "ts-manager".to_string(),
            tool_kind: AgentToolKind::default(),
            resolved_cwd: None,
            submit_sequence: None,
            provider_session: None,
            online: true,
        });
    let detail = create_document_at("ws-1", temp.root(), "recover-doc", "Recover Doc", None)
        .expect("create document");
    let task_id = "task-recover-1";
    let patch = json!({
        "schemaVersion": 1,
        "documentId": "recover-doc",
        "baseRevision": detail.design.revision,
        "summary": "Recovered patch",
        "changes": [
            {
                "op": "addBlock",
                "afterBlockId": "overview",
                "block": {
                    "id": "recovered-open-question",
                    "kind": "openQuestions",
                    "title": "Recovered Question",
                    "payload": { "questions": ["Need rollout plan?"] }
                }
            }
        ],
        "openQuestions": []
    });
    let _ = state.task_service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "manager".to_string(),
        },
        sender_agent_id: Some("agent-1".to_string()),
        target_agent_ids: vec!["manager".to_string()],
        message_type: ChannelMessageType::Handover,
        payload: json!({
            "taskId": task_id,
            "summary": format!("Patch:\n```json\n{}\n```", patch)
        }),
        idempotency_key: None,
    });

    let recovered =
        recover_agent_patch_from_task_at("ws-1", temp.root(), "recover-doc", task_id, &state)
            .expect("recover patch");

    assert_eq!(recovered.task_id, task_id);
    assert_eq!(recovered.source_agent_id, "agent-1");
    assert_eq!(recovered.source_message_type, "handover");
    assert!(recovered.validation.valid);
    assert_eq!(recovered.validation.changes.len(), 1);
    assert!(recovered
        .validation
        .patch_path
        .as_deref()
        .is_some_and(|path| path.contains("agent-patch-task-recovered-")));
}

#[test]
fn export_document_returns_agent_bundle_content() {
    let temp = TempWorkspace::new("export");
    create_document_at("ws-1", temp.root(), "export-doc", "Export Doc", None)
        .expect("create document");

    let export =
        export_document_at("ws-1", temp.root(), "export-doc", "agentBundle").expect("export");

    assert_eq!(export.format, "agentBundle");
    assert_eq!(export.mime_type, "application/json");
    assert_eq!(export.suggested_file_name, "export-doc-agent-bundle.json");
    assert!(export.content.contains("\"agentBrief\""));
    assert!(export.content.contains("\"design\""));
}

#[test]
fn coding_handoff_preview_builds_task_dispatch_request() {
    let temp = TempWorkspace::new("handoff");
    create_document_at("ws-1", temp.root(), "handoff-doc", "Handoff Doc", None)
        .expect("create document");

    let preview = preview_coding_handoff_at(
        "ws-1",
        temp.root(),
        "handoff-doc",
        vec!["agent-1".to_string()],
    )
    .expect("preview handoff");

    assert_eq!(preview.workspace_id, "ws-1");
    assert_eq!(preview.document_id, "handoff-doc");
    assert_eq!(preview.request.targets, vec!["agent-1"]);
    assert!(preview
        .request
        .markdown
        .contains(".gtoffice/docs/documents/handoff-doc/generated/agent-input.json"));
    assert_eq!(preview.tasks.len(), 3);
    assert!(preview
        .attachments
        .iter()
        .any(|attachment| attachment.category == "agent-input"));
}
