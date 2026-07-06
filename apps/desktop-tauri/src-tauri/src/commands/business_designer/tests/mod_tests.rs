use std::{
    collections::HashMap,
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
    export_document_at, list_checkpoints_at, list_documents_at, preview_agent_task_at,
    preview_coding_handoff_at, read_document_at, recover_agent_patch_from_task_at,
    render_design_completion_markdown_with_host, run_mock_agent_completion_at, save_document_at,
    validate_agent_patch_at, validate_document_at, AgentTaskPreviewRequest,
    DesignerAgentTaskPreviewCommandRequest, DesignerAgentTaskScope,
    DesignerApplyAgentPatchCommandRequest, DesignerBlock, DesignerBlockLink,
    DesignerFreeformCompletionProvider, DesignerFreeformCompletionRun,
    DesignerFreeformCompletionRunStatus, DesignerFreeformCompletionScenario,
    DesignerLayoutPosition, DesignerMockAgentCompletionCommandRequest,
    DesignerRecoverAgentPatchCommandRequest, DesignerValidateAgentPatchCommandRequest,
    MockAgentCompletionRequest, is_supported_block_kind, render_block_markdown,
};

#[path = "gap_rules_tests.rs"]
mod gap_rules_tests;

#[path = "completeness_rules_tests.rs"]
mod completeness_rules_tests;

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

fn replace_with_dangling_ref_entity(
    mut detail: super::DesignerDocumentDetail,
) -> super::DesignerDocumentDetail {
    detail.design.blocks = vec![DesignerBlock {
        id: "order".to_string(),
        kind: "entityModel".to_string(),
        title: "Order".to_string(),
        order: 10,
        payload: json!({
            "entityName": "Order",
            "fields": [
                { "name": "id", "type": "string" },
                { "name": "customer", "type": "Customer" }
            ]
        }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: detail.design.revision.clone(),
    }];
    detail
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
fn validate_document_result_carries_schema_identity() {
    let temp = TempWorkspace::new("validate-schema-identity");
    let detail = create_document_at("ws-1", temp.root(), "identity", "Identity", None)
        .expect("create document");

    let result = validate_document_at("ws-1", temp.root(), "identity").expect("validate document");

    assert_eq!(result["schemaVersion"], json!(1));
    assert_eq!(result["workspaceId"], json!("ws-1"));
    assert_eq!(result["documentId"], json!("identity"));
    assert_eq!(result["revision"], json!(detail.design.revision));
    assert!(result["diagnostics"].is_array());
    assert!(result["gaps"].is_array());
    assert!(result["rulesRun"].is_array());
    assert!(result["graphProjection"]["links"].is_array());
}

#[test]
fn document_detail_rejects_unknown_contract_fields() {
    let temp = TempWorkspace::new("document-detail-unknown-fields");
    let detail = create_document_at("ws-1", temp.root(), "strict-doc", "Strict Doc", None)
        .expect("create document");
    let mut value = serde_json::to_value(detail).expect("serialize detail");
    value["unexpectedField"] = json!(true);

    let error = serde_json::from_value::<super::DesignerDocumentDetail>(value)
        .expect_err("document detail should reject unknown fields");

    assert!(error.to_string().contains("unknown field"));
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
fn save_document_persists_entity_flow_api_crud_edits_and_layout_cleanup() {
    let temp = TempWorkspace::new("save-structured-crud");
    let mut detail =
        create_document_at("ws-1", temp.root(), "commerce", "Commerce", None).expect("create");
    let document_root = temp.root().join(".gtoffice/docs/documents/commerce");

    let timestamp = detail.design.revision.clone();
    detail.design.blocks = vec![
        DesignerBlock {
            id: "brief".to_string(),
            kind: "text".to_string(),
            title: "Brief".to_string(),
            order: 0,
            payload: json!({ "markdown": "Commerce handles orders." }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order".to_string(),
            kind: "entityModel".to_string(),
            title: "Order".to_string(),
            order: 10,
            payload: json!({
                "entityName": "Order",
                "fields": [
                    { "name": "id", "type": "string", "isPrimaryKey": true },
                    { "name": "customerEmail", "type": "string" },
                    { "name": "legacyCoupon", "type": "string" }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order-flow".to_string(),
            kind: "businessFlow".to_string(),
            title: "Order Flow".to_string(),
            order: 20,
            payload: json!({
                "states": [
                    { "name": "draft", "entity": "Order", "initial": true },
                    { "name": "review", "entity": "Order" },
                    { "name": "cancelled", "entity": "Order", "terminal": true },
                    { "name": "paid", "entity": "Order", "terminal": true }
                ],
                "transitions": [
                    { "from": "draft", "to": "review" },
                    { "from": "review", "to": "cancelled" },
                    { "from": "review", "to": "paid" }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order-api".to_string(),
            kind: "apiContract".to_string(),
            title: "Order API".to_string(),
            order: 30,
            payload: json!({
                "endpoints": [
                    {
                        "method": "POST",
                        "path": "/orders",
                        "request": "Order",
                        "response": "Order",
                        "errorCodes": ["ORDER_INVALID"]
                    },
                    {
                        "method": "DELETE",
                        "path": "/orders/legacy",
                        "request": "LegacyOrderDelete",
                        "response": "LegacyOrderDeleteResult",
                        "errorCodes": ["ORDER_LEGACY"]
                    }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "legacy-api".to_string(),
            kind: "apiContract".to_string(),
            title: "Legacy API".to_string(),
            order: 40,
            payload: json!({
                "endpoints": [
                    {
                        "method": "GET",
                        "path": "/legacy-orders",
                        "request": "LegacyOrderQuery",
                        "response": "LegacyOrderList",
                        "errorCodes": ["ORDER_LEGACY"]
                    }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp,
        },
    ];
    detail.manifest.layout = Some(HashMap::from([
        (
            "order".to_string(),
            DesignerLayoutPosition { x: 320.0, y: 120.0 },
        ),
        (
            "order-flow".to_string(),
            DesignerLayoutPosition { x: 620.0, y: 120.0 },
        ),
        (
            "order-api".to_string(),
            DesignerLayoutPosition { x: 920.0, y: 120.0 },
        ),
        (
            "legacy-api".to_string(),
            DesignerLayoutPosition {
                x: 1220.0,
                y: 120.0,
            },
        ),
    ]));
    save_document_at("ws-1", temp.root(), detail).expect("save initial document");
    assert!(document_root.join("blocks/legacy-api.json").is_file());

    let mut edited =
        read_document_at("ws-1", temp.root(), "commerce").expect("read initial document");
    let timestamp = edited.design.revision.clone();
    edited.design.blocks = vec![
        DesignerBlock {
            id: "brief".to_string(),
            kind: "text".to_string(),
            title: "Brief".to_string(),
            order: 0,
            payload: json!({ "markdown": "Commerce handles paid order operations." }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order".to_string(),
            kind: "entityModel".to_string(),
            title: "Order".to_string(),
            order: 10,
            payload: json!({
                "entityName": "Order",
                "fields": [
                    { "name": "id", "type": "string", "isPrimaryKey": true },
                    { "name": "status", "type": "OrderStatus", "description": "Current order lifecycle state" },
                    { "name": "total", "type": "decimal", "description": "Captured order amount" }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order-flow".to_string(),
            kind: "businessFlow".to_string(),
            title: "Order Fulfillment Flow".to_string(),
            order: 20,
            payload: json!({
                "states": [
                    { "name": "draft", "entity": "Order", "initial": true },
                    { "name": "approved", "entity": "Order" },
                    { "name": "paid", "entity": "Order", "terminal": true }
                ],
                "transitions": [
                    { "from": "draft", "to": "approved" },
                    { "from": "approved", "to": "paid" }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp.clone(),
        },
        DesignerBlock {
            id: "order-api".to_string(),
            kind: "apiContract".to_string(),
            title: "Order API".to_string(),
            order: 30,
            payload: json!({
                "endpoints": [
                    {
                        "method": "POST",
                        "path": "/orders",
                        "request": "CreateOrderRequest",
                        "response": "Order",
                        "errorCodes": ["ORDER_INVALID", "ORDER_DUPLICATE"]
                    },
                    {
                        "method": "GET",
                        "path": "/orders/{id}",
                        "request": "GetOrderRequest",
                        "response": "Order",
                        "errorCodes": ["ORDER_NOT_FOUND"]
                    }
                ]
            }),
            links: Vec::new(),
            validation: Vec::new(),
            updated_at: timestamp,
        },
    ];
    edited.manifest.layout = Some(HashMap::from([
        (
            "order".to_string(),
            DesignerLayoutPosition { x: 336.0, y: 144.0 },
        ),
        (
            "order-flow".to_string(),
            DesignerLayoutPosition { x: 656.0, y: 152.0 },
        ),
        (
            "order-api".to_string(),
            DesignerLayoutPosition { x: 976.0, y: 168.0 },
        ),
        (
            "legacy-api".to_string(),
            DesignerLayoutPosition {
                x: 1220.0,
                y: 120.0,
            },
        ),
    ]));

    save_document_at("ws-1", temp.root(), edited).expect("save edited document");
    let read_back = read_document_at("ws-1", temp.root(), "commerce").expect("read document");

    let order = read_back
        .design
        .blocks
        .iter()
        .find(|block| block.id == "order")
        .expect("order block");
    let fields = order.payload["fields"].as_array().expect("entity fields");
    let field_names = fields
        .iter()
        .filter_map(|field| field["name"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(field_names, vec!["id", "status", "total"]);
    assert_eq!(fields[0]["isPrimaryKey"], json!(true));
    assert!(fields.iter().all(|field| field["name"] != "customerEmail"));
    assert!(fields.iter().all(|field| field["name"] != "legacyCoupon"));

    let flow = read_back
        .design
        .blocks
        .iter()
        .find(|block| block.id == "order-flow")
        .expect("flow block");
    let states = flow.payload["states"].as_array().expect("flow states");
    let state_names = states
        .iter()
        .filter_map(|state| state["name"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(state_names, vec!["draft", "approved", "paid"]);
    assert!(states.iter().all(|state| state["entity"] == "Order"));
    assert!(states.iter().all(|state| state.get("target").is_none()));
    let transitions = flow.payload["transitions"]
        .as_array()
        .expect("flow transitions");
    assert_eq!(transitions.len(), 2);
    assert!(transitions
        .iter()
        .all(|transition| transition["from"] != "review" && transition["to"] != "cancelled"));

    let api = read_back
        .design
        .blocks
        .iter()
        .find(|block| block.id == "order-api")
        .expect("api block");
    let endpoints = api.payload["endpoints"].as_array().expect("api endpoints");
    let endpoint_paths = endpoints
        .iter()
        .filter_map(|endpoint| endpoint["path"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(endpoint_paths, vec!["/orders", "/orders/{id}"]);
    assert_eq!(
        endpoints[0]["errorCodes"],
        json!(["ORDER_INVALID", "ORDER_DUPLICATE"])
    );
    assert!(endpoints
        .iter()
        .all(|endpoint| endpoint["path"] != "/orders/legacy"));
    assert!(endpoints
        .iter()
        .all(|endpoint| endpoint.get("errors").is_none()));

    let layout = read_back.manifest.layout.expect("layout");
    assert_eq!(layout["order"].x, 336.0);
    assert_eq!(layout["order-flow"].x, 656.0);
    assert_eq!(layout["order-api"].x, 976.0);
    assert!(!layout.contains_key("legacy-api"));
    assert!(document_root.join("blocks/order.json").is_file());
    assert!(document_root.join("blocks/order-flow.json").is_file());
    assert!(document_root.join("blocks/order-api.json").is_file());
    assert!(!document_root.join("blocks/legacy-api.json").exists());

    let design_json =
        fs::read_to_string(document_root.join("design.json")).expect("read design json");
    for removed_value in [
        "customerEmail",
        "legacyCoupon",
        "cancelled",
        "/orders/legacy",
        "/legacy-orders",
        "legacy-api",
    ] {
        assert!(
            !design_json.contains(removed_value),
            "removed value {removed_value} should not remain in design.json"
        );
    }
    assert!(design_json.contains("Order Fulfillment Flow"));
    assert!(design_json.contains("/orders/{id}"));
}

#[test]
fn save_document_removes_deleted_block_layout_and_authored_links() {
    let temp = TempWorkspace::new("save-cleanup");
    let mut detail = create_document_at("ws-1", temp.root(), "cleanup", "Cleanup", None)
        .expect("create document");
    let document_root = temp.root().join(".gtoffice/docs/documents/cleanup");

    detail.manifest.layout = Some(HashMap::from([
        (
            "overview".to_string(),
            DesignerLayoutPosition { x: 1.0, y: 2.0 },
        ),
        (
            "deleted-block".to_string(),
            DesignerLayoutPosition { x: 3.0, y: 4.0 },
        ),
    ]));
    detail.design.blocks[0].links = vec![
        DesignerBlockLink {
            target_block_id: "domain-model".to_string(),
            relation: "uses".to_string(),
        },
        DesignerBlockLink {
            target_block_id: "deleted-block".to_string(),
            relation: "uses".to_string(),
        },
    ];
    fs::write(
        document_root.join("blocks/deleted-block.json"),
        r#"{"id":"deleted-block"}"#,
    )
    .expect("write stale block file");

    let saved = save_document_at("ws-1", temp.root(), detail).expect("save document");
    let read_back = read_document_at("ws-1", temp.root(), "cleanup").expect("read document");

    for detail in [&saved, &read_back] {
        let layout = detail.manifest.layout.as_ref().expect("layout retained");
        assert!(layout.contains_key("overview"));
        assert!(!layout.contains_key("deleted-block"));
        assert!(
            detail.design.blocks[0].links.is_empty(),
            "semantic links are validation-derived and must not be persisted"
        );
    }
    assert!(!document_root.join("blocks/deleted-block.json").exists());
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

    let selected_block_ids = [detail.design.blocks[1].id.clone()];
    let preview = run_mock_agent_completion_at(MockAgentCompletionRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "agent-doc",
        host_block_id: &detail.design.blocks[1].id,
        gap_codes: Vec::new(),
        scope: Some(DesignerAgentTaskScope::Block),
        base_revision: &detail.design.revision,
        selected_block_ids: &selected_block_ids,
    })
    .expect("mock completion");

    assert!(preview.valid);
    assert_eq!(preview.patch.document_id, "agent-doc");
    assert_eq!(preview.changes.len(), 1);
    assert!(preview.patch_path.as_deref().is_some_and(|path| {
        path.starts_with("documents/agent-doc/patches/agent-patch-agent-preview-")
    }));
}

#[test]
fn preview_agent_task_rejects_stale_base_revision() {
    let temp = TempWorkspace::new("stale-preview");
    create_document_at("ws-1", temp.root(), "preview-doc", "Preview Doc", None)
        .expect("create document");

    let error = preview_agent_task_at(AgentTaskPreviewRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "preview-doc",
        selected_block_ids: Vec::new(),
        provider: "mock",
        host_block_id: "overview",
        gap_codes: Vec::new(),
        scope: DesignerAgentTaskScope::Block,
        base_revision: "old-revision",
    })
    .expect_err("stale preview should be rejected");

    assert!(error.contains("baseRevision"));
}

#[test]
fn preview_agent_task_returns_noop_for_block_scope_without_agent_fixable_gaps() {
    let temp = TempWorkspace::new("noop-preview");
    let detail = create_document_at("ws-1", temp.root(), "noop-doc", "Noop Doc", None)
        .expect("create document");
    let detail = replace_with_dangling_ref_entity(detail);
    let saved = save_document_at("ws-1", temp.root(), detail).expect("save dangling-ref doc");

    let preview = preview_agent_task_at(AgentTaskPreviewRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "noop-doc",
        selected_block_ids: Vec::new(),
        provider: "mock",
        host_block_id: "order",
        gap_codes: Vec::new(),
        scope: DesignerAgentTaskScope::Block,
        base_revision: &saved.design.revision,
    })
    .expect("block preview");

    assert_eq!(preview["status"], "no_agent_fixable_gaps");
    assert!(preview["requestId"]
        .as_str()
        .is_some_and(|value| value.starts_with("bdreq_") && value.len() == 22));
    assert_eq!(
        preview["targetGaps"].as_array().expect("target gaps").len(),
        0
    );
    assert_eq!(
        preview["targetGapKeys"]
            .as_array()
            .expect("target keys")
            .len(),
        0
    );
    assert!(preview["contextGaps"]
        .as_array()
        .expect("context gaps")
        .iter()
        .any(|gap| gap["code"] == "dangling-ref" && gap["fixableByAgent"] == false));

    let preview_again = preview_agent_task_at(AgentTaskPreviewRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "noop-doc",
        selected_block_ids: Vec::new(),
        provider: "mock",
        host_block_id: "order",
        gap_codes: Vec::new(),
        scope: DesignerAgentTaskScope::Block,
        base_revision: &saved.design.revision,
    })
    .expect("repeat block preview");
    assert_eq!(preview["requestId"], preview_again["requestId"]);
}

#[test]
fn mock_agent_completion_rejects_block_scope_without_agent_fixable_gaps() {
    let temp = TempWorkspace::new("noop-completion");
    let detail = create_document_at("ws-1", temp.root(), "noop-completion-doc", "Noop", None)
        .expect("create document");
    let detail = replace_with_dangling_ref_entity(detail);
    let saved = save_document_at("ws-1", temp.root(), detail).expect("save dangling-ref doc");

    let error = run_mock_agent_completion_at(MockAgentCompletionRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "noop-completion-doc",
        host_block_id: "order",
        gap_codes: Vec::new(),
        scope: Some(DesignerAgentTaskScope::Block),
        base_revision: &saved.design.revision,
        selected_block_ids: &[],
    })
    .expect_err("completion should reject no-op block target");

    assert!(error.contains("at least one agent-fixable target gap"));
}

#[test]
fn preview_agent_task_rejects_single_scope_non_agent_fixable_gap() {
    let temp = TempWorkspace::new("non-agent-fixable-preview");
    let detail = create_document_at("ws-1", temp.root(), "manual-gap-doc", "Manual Gap", None)
        .expect("create document");
    let detail = replace_with_dangling_ref_entity(detail);
    let saved = save_document_at("ws-1", temp.root(), detail).expect("save dangling-ref doc");

    let error = preview_agent_task_at(AgentTaskPreviewRequest {
        workspace_id: "ws-1",
        workspace_root: temp.root(),
        document_id: "manual-gap-doc",
        selected_block_ids: Vec::new(),
        provider: "mock",
        host_block_id: "order",
        gap_codes: vec!["dangling-ref".to_string()],
        scope: DesignerAgentTaskScope::Single,
        base_revision: &saved.design.revision,
    })
    .expect_err("single non-agent-fixable preview should be rejected");

    assert!(error.contains("not agent-fixable"));
}

#[test]
fn preview_agent_task_command_rejects_unknown_scope() {
    let request = json!({
        "traceId": "designer-ipc-test",
        "workspaceId": "ws-1",
        "documentId": "scope-doc",
        "selectedBlockIds": [],
        "provider": "mock",
        "hostBlockId": "overview",
        "gapCodes": [],
        "scope": "everything",
        "baseRevision": "rev-1"
    });

    let error = serde_json::from_value::<DesignerAgentTaskPreviewCommandRequest>(request)
        .expect_err("unknown scope should fail serde");

    assert!(error.to_string().contains("unknown variant"));
}

#[test]
fn v1_agent_command_requests_reject_unknown_fields() {
    let preview_request = json!({
        "traceId": "designer-ipc-test-preview",
        "workspaceId": "ws-1",
        "documentId": "strict-doc",
        "selectedBlockIds": [],
        "provider": "mock",
        "hostBlockId": "overview",
        "gapCodes": [],
        "scope": "block",
        "baseRevision": "rev-1",
        "unexpectedField": true
    });
    let mock_request = json!({
        "traceId": "designer-ipc-test-mock",
        "workspaceId": "ws-1",
        "documentId": "strict-doc",
        "hostBlockId": "overview",
        "gapCodes": [],
        "scope": "block",
        "baseRevision": "rev-1",
        "selectedBlockIds": [],
        "unexpectedField": true
    });
    let validate_request = json!({
        "traceId": "designer-ipc-test-validate",
        "workspaceId": "ws-1",
        "documentId": "strict-doc",
        "patch": {},
        "unexpectedField": true
    });
    let recover_request = json!({
        "traceId": "designer-ipc-test-recover",
        "workspaceId": "ws-1",
        "documentId": "strict-doc",
        "taskId": "task-1",
        "unexpectedField": true
    });
    let apply_request = json!({
        "traceId": "designer-ipc-test-apply",
        "workspaceId": "ws-1",
        "documentId": "strict-doc",
        "patch": {},
        "acceptedChangeIndices": [],
        "unexpectedField": true
    });

    let errors = [
        serde_json::from_value::<DesignerAgentTaskPreviewCommandRequest>(preview_request)
            .expect_err("preview request should reject unknown fields"),
        serde_json::from_value::<DesignerMockAgentCompletionCommandRequest>(mock_request)
            .expect_err("mock request should reject unknown fields"),
        serde_json::from_value::<DesignerValidateAgentPatchCommandRequest>(validate_request)
            .expect_err("validate request should reject unknown fields"),
        serde_json::from_value::<DesignerRecoverAgentPatchCommandRequest>(recover_request)
            .expect_err("recover request should reject unknown fields"),
        serde_json::from_value::<DesignerApplyAgentPatchCommandRequest>(apply_request)
            .expect_err("apply request should reject unknown fields"),
    ];

    for error in errors {
        assert!(error.to_string().contains("unknown field"));
    }
}

#[test]
fn ordinary_document_commands_accept_and_log_trace_ids() {
    let source = include_str!("../mod.rs");
    let commands = [
        "business_designer_list_documents",
        "business_designer_init_docs_repo",
        "business_designer_create_document",
        "business_designer_read_document",
        "business_designer_save_document",
        "business_designer_validate_document",
        "business_designer_compile_document",
        "business_designer_create_checkpoint",
        "business_designer_diff_checkpoint",
        "business_designer_compare_checkpoints",
        "business_designer_list_checkpoints",
        "business_designer_export_document",
        "business_designer_export_document_to_file",
    ];

    for command in commands {
        let marker = format!("pub fn {command}(");
        let start = source
            .find(&marker)
            .unwrap_or_else(|| panic!("{command} exists"));
        let next_command = source[start + marker.len()..]
            .find("\n#[tauri::command]")
            .map(|offset| start + marker.len() + offset)
            .unwrap_or(source.len());
        let block = &source[start..next_command];

        assert!(
            block.contains("trace_id: Option<String>"),
            "{command} should accept trace_id"
        );
        assert!(
            block.contains("trace_id = trace_id.as_deref()"),
            "{command} should log trace_id"
        );
    }
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
        "hostBlockId": "overview",
        "gapCodes": [],
        "targetGapKeys": [],
        "scope": "block",
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
fn validate_agent_patch_rejects_unknown_contract_fields() {
    let temp = TempWorkspace::new("unknown-patch-field");
    let detail = create_document_at("ws-1", temp.root(), "unknown", "Unknown", None)
        .expect("create document");
    let patch = json!({
        "schemaVersion": 1,
        "documentId": "unknown",
        "baseRevision": detail.design.revision,
        "summary": "unknown field",
        "hostBlockId": "overview",
        "gapCodes": [],
        "targetGapKeys": [],
        "scope": "block",
        "unexpectedField": true,
        "changes": [],
        "openQuestions": ["Need more detail."]
    });

    let error = validate_agent_patch_at("ws-1", temp.root(), "unknown", patch, None)
        .expect_err("unknown field");

    assert!(error.contains("unknown field"));
}

#[test]
fn validate_agent_patch_rejects_link_changes() {
    let temp = TempWorkspace::new("patch-links");
    let detail = create_document_at("ws-1", temp.root(), "patch-links", "Patch Links", None)
        .expect("create document");
    let patch = json!({
        "schemaVersion": 1,
        "documentId": "patch-links",
        "baseRevision": detail.design.revision,
        "summary": "try to draw graph edge",
        "hostBlockId": "overview",
        "gapCodes": [],
        "targetGapKeys": [],
        "scope": "block",
        "changes": [
            {
                "op": "updateBlock",
                "blockId": "overview",
                "patch": {
                    "links": [{ "targetBlockId": "other", "relation": "uses" }]
                }
            }
        ],
        "openQuestions": []
    });

    let validation = validate_agent_patch_at("ws-1", temp.root(), "patch-links", patch, None)
        .expect("validate patch");

    assert!(!validation.valid);
    assert!(validation
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "patch_links_not_allowed"));
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
        "summary": "Update and skip",
        "hostBlockId": "overview",
        "gapCodes": [],
        "targetGapKeys": [],
        "scope": "block",
        "changes": [
            {
                "op": "updateBlock",
                "blockId": "overview",
                "patch": {
                    "title": "Updated Overview",
                    "payload": { "markdown": "Updated by agent." }
                }
            },
            {
                "op": "updateBlock",
                "blockId": "overview",
                "patch": {
                    "title": "Skipped Overview"
                }
            }
        ],
        "openQuestions": []
    });

    let applied = apply_agent_patch_at("ws-1", temp.root(), "apply-doc", patch, Some(vec![0]))
        .expect("apply patch");

    assert_eq!(applied.accepted_changes, vec![0]);
    assert_eq!(applied.skipped_changes, vec![1]);
    let overview = applied
        .detail
        .design
        .blocks
        .iter()
        .find(|block| block.id == "overview")
        .expect("overview block");
    assert_eq!(overview.title, "Updated Overview");
    assert_eq!(
        overview
            .payload
            .get("markdown")
            .and_then(|value| value.as_str()),
        Some("Updated by agent.")
    );
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
        "hostBlockId": "overview",
        "gapCodes": [],
        "targetGapKeys": [],
        "scope": "block",
        "changes": [
            {
                "op": "updateBlock",
                "blockId": "overview",
                "patch": {
                    "payload": { "markdown": "Recovered patch content." }
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
fn real_agent_prompt_guides_direct_document_edits() {
    let temp = TempWorkspace::new("agent-prompt");
    let detail = create_document_at("ws-1", temp.root(), "prompt-doc", "Prompt Doc", None)
        .expect("create document");

    let markdown = render_design_completion_markdown_with_host(
        &detail,
        "overview",
        &["no-pk".to_string()],
        &["entityModel:overview:no-pk".to_string()],
        DesignerAgentTaskScope::Single,
    );

    assert!(markdown.contains("Edit the Business Designer document files directly"));
    assert!(markdown.contains("The primary file to edit is the `Design file` path above"));
    assert!(markdown.contains("Do not return a `DesignerAgentPatch`"));
    assert!(markdown.contains("Do not add `requestId` to design files"));
    assert!(markdown.contains("Focus changes on host block `overview`"));
    assert!(markdown.contains("`targetGapKeys` must be exactly: `entityModel:overview:no-pk`"));
    assert!(markdown.contains("Do not hand-author `links`"));
    assert!(!markdown.contains("Do not edit files directly"));
    assert!(!markdown.contains("Return a single JSON object"));
    assert!(!markdown.contains("The UI will validate and present the patch"));
}

#[test]
fn freeform_provider_maps_to_agent_tool_kind_for_terminal_env() {
    assert_eq!(
        DesignerFreeformCompletionProvider::Codex.as_tool_kind(),
        AgentToolKind::Codex
    );
    assert_eq!(
        DesignerFreeformCompletionProvider::Claude.as_tool_kind(),
        AgentToolKind::Claude
    );
}

#[test]
fn freeform_prompt_guides_direct_document_edits_without_repo_validation() {
    let temp = TempWorkspace::new("freeform-prompt");
    let detail = create_document_at("ws-1", temp.root(), "freeform-doc", "Freeform Doc", None)
        .expect("create document");
    let host = detail
        .design
        .blocks
        .iter()
        .find(|block| block.id == "overview");

    let prompt = super::agent_completion_prompts::render_freeform_completion_prompt(
        super::agent_completion_prompts::FreeformPromptInput {
            detail: &detail,
            scenario: DesignerFreeformCompletionScenario::BriefToDesign,
            host_block: host,
            document_root: "/workspace/.gtoffice/docs/documents/freeform-doc",
            document_file: "/workspace/.gtoffice/docs/documents/freeform-doc/design.json",
            validation_summary: "- gaps: 0 total",
            user_prompt: Some("Prefer event-sourced language."),
        },
    );

    assert!(prompt.contains("Business Designer Freeform Completion"));
    assert!(prompt.contains("brief_to_design"));
    assert!(prompt.contains("documentRoot: /workspace/.gtoffice/docs/documents/freeform-doc"));
    assert!(prompt
        .contains("documentFile: /workspace/.gtoffice/docs/documents/freeform-doc/design.json"));
    assert!(!prompt.contains("freeform-doc.design.json"));
    assert!(prompt.contains("Do not edit application source code"));
    assert!(prompt.contains("Do not run full repository validation commands by default"));
    assert!(prompt.contains("Prefer event-sourced language."));
    assert!(!prompt.contains("DesignerAgentPatch"));
    assert!(!prompt.contains("targetGapKeys"));
}

#[test]
fn freeform_runs_are_document_local_audit_records() {
    let temp = TempWorkspace::new("freeform-runs");
    create_document_at("ws-1", temp.root(), "freeform-runs", "Freeform Runs", None)
        .expect("create document");
    let document_root = temp.root().join(".gtoffice/docs/documents/freeform-runs");
    let runs_dir = document_root.join(".agent-runs");
    fs::create_dir_all(&runs_dir).expect("create runs dir");
    let run = DesignerFreeformCompletionRun {
        request_id: "bdfree_test".to_string(),
        workspace_id: "ws-1".to_string(),
        document_id: "freeform-runs".to_string(),
        scenario: DesignerFreeformCompletionScenario::CompleteEntity,
        host_block_id: Some("overview".to_string()),
        provider: DesignerFreeformCompletionProvider::Codex,
        session_id: "terminal-1".to_string(),
        document_root: document_root.to_string_lossy().to_string(),
        checkpoint_before: "abc123".to_string(),
        status: DesignerFreeformCompletionRunStatus::Running,
        created_at: "2026-06-21T00:00:00.000Z".to_string(),
        updated_at: "2026-06-21T00:00:00.000Z".to_string(),
        user_prompt_summary: Some("Add order lifecycle fields.".to_string()),
    };
    fs::write(
        runs_dir.join("bdfree_test.json"),
        serde_json::to_string_pretty(&run).expect("serialize run"),
    )
    .expect("write run");
    fs::write(
        runs_dir.join("bdfree_test.log"),
        "Starting codex freeform completion\n[stdout]\nprogress\n",
    )
    .expect("write run log");

    let result = super::list_freeform_completion_runs_at("ws-1", temp.root(), "freeform-runs")
        .expect("list runs");

    assert_eq!(result.workspace_id, "ws-1");
    assert_eq!(result.document_id, "freeform-runs");
    assert_eq!(result.runs.len(), 1);
    assert_eq!(result.runs[0].request_id, "bdfree_test");
    assert_eq!(result.runs[0].checkpoint_before, "abc123");

    let log = super::read_freeform_completion_run_log_at(
        "ws-1",
        temp.root(),
        "freeform-runs",
        "bdfree_test",
    )
    .expect("read run log");
    assert_eq!(log.request_id, "bdfree_test");
    assert!(log.log.contains("progress"));
}

#[test]
fn freeform_run_list_reconciles_running_record_after_logged_exit() {
    let temp = TempWorkspace::new("freeform-reconcile");
    create_document_at(
        "ws-1",
        temp.root(),
        "freeform-reconcile",
        "Freeform Reconcile",
        None,
    )
    .expect("create document");
    let document_root = temp
        .root()
        .join(".gtoffice/docs/documents/freeform-reconcile");
    let runs_dir = document_root.join(".agent-runs");
    fs::create_dir_all(&runs_dir).expect("create runs dir");
    let run = DesignerFreeformCompletionRun {
        request_id: "bdfree_failed".to_string(),
        workspace_id: "ws-1".to_string(),
        document_id: "freeform-reconcile".to_string(),
        scenario: DesignerFreeformCompletionScenario::CompleteEntity,
        host_block_id: Some("overview".to_string()),
        provider: DesignerFreeformCompletionProvider::Claude,
        session_id: "headless:/usr/bin/claude".to_string(),
        document_root: document_root.to_string_lossy().to_string(),
        checkpoint_before: "abc123".to_string(),
        status: DesignerFreeformCompletionRunStatus::Running,
        created_at: "2026-06-21T00:00:00.000Z".to_string(),
        updated_at: "2026-06-21T00:00:00.000Z".to_string(),
        user_prompt_summary: Some("Complete entity fields.".to_string()),
    };
    fs::write(
        runs_dir.join("bdfree_failed.json"),
        serde_json::to_string_pretty(&run).expect("serialize run"),
    )
    .expect("write run");
    fs::write(
        runs_dir.join("bdfree_failed.log"),
        "Starting claude freeform completion\n\n[exit]\nstatus: exit status: 1\n",
    )
    .expect("write run log");

    let result = super::list_freeform_completion_runs_at("ws-1", temp.root(), "freeform-reconcile")
        .expect("list runs");

    assert_eq!(
        result.runs[0].status,
        DesignerFreeformCompletionRunStatus::Failed
    );
    let persisted = super::read_json_file::<DesignerFreeformCompletionRun>(
        &runs_dir.join("bdfree_failed.json"),
    )
    .expect("read persisted run");
    assert_eq!(
        persisted.status,
        DesignerFreeformCompletionRunStatus::Failed
    );
}

#[test]
fn freeform_log_status_inference_covers_terminal_states() {
    let temp = TempWorkspace::new("freeform-log-status");

    for (name, log, expected) in [
        (
            "completed-exit-status",
            "\n[stdout]\ndone\n\n[exit]\nstatus: exit status: 0\n",
            Some(DesignerFreeformCompletionRunStatus::Completed),
        ),
        (
            "completed-exit-code",
            "\n[exit]\nstatus: exit code: 0\n",
            Some(DesignerFreeformCompletionRunStatus::Completed),
        ),
        (
            "failed-exit-status",
            "\n[stderr]\nError: bad args\n\n[exit]\nstatus: exit status: 1\n",
            Some(DesignerFreeformCompletionRunStatus::Failed),
        ),
        (
            "failed-spawn",
            "\n[spawn failed]\nNo such file or directory\n",
            Some(DesignerFreeformCompletionRunStatus::Failed),
        ),
        (
            "failed-wait",
            "\n[wait failed]\nprocess handle failed\n",
            Some(DesignerFreeformCompletionRunStatus::Failed),
        ),
        (
            "cancelled",
            "\n[cancelled]\nterminating child process\n",
            Some(DesignerFreeformCompletionRunStatus::Cancelled),
        ),
        ("still-running", "\n[stdout]\nprogress\n", None),
        ("malformed-exit", "\n[exit]\n", None),
    ] {
        let log_path = temp.root().join(format!("{name}.log"));
        fs::write(&log_path, log).expect("write log");

        assert_eq!(
            super::infer_freeform_completion_status_from_log(&log_path),
            expected,
            "{name} should infer expected terminal status"
        );
    }
}

#[test]
fn freeform_checkpoint_before_uses_existing_head_when_checkpoint_is_clean() {
    let temp = TempWorkspace::new("freeform-clean-head");
    create_document_at(
        "ws-1",
        temp.root(),
        "freeform-clean",
        "Freeform Clean",
        None,
    )
    .expect("create document");
    let first = create_checkpoint_at(
        "ws-1",
        temp.root(),
        "freeform-clean",
        "designer: checkpoint initial",
    )
    .expect("first checkpoint")
    .commit
    .expect("first checkpoint commit");
    let clean = create_checkpoint_at(
        "ws-1",
        temp.root(),
        "freeform-clean",
        "agent-freeform:complete_entity Freeform Clean",
    )
    .expect("clean checkpoint");

    assert!(!clean.committed);
    assert!(clean.commit.is_none());
    let docs_root = temp.root().join(".gtoffice/docs");
    let checkpoint_before =
        super::checkpoint_revision_for_revert(&docs_root, &clean).expect("checkpoint revision");

    assert_eq!(checkpoint_before, first);
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

#[test]
fn ui_screen_is_supported_and_renders_html() {
    assert!(is_supported_block_kind("uiScreen"));
    let block = DesignerBlock {
        id: "screen-1".to_string(),
        kind: "uiScreen".to_string(),
        title: "Orders".to_string(),
        order: 10,
        payload: json!({ "screenName": "Orders", "route": "/orders", "html": "<section><h1>Orders</h1></section>" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    };
    let rendered = render_block_markdown(&block);
    assert!(rendered.contains("<section><h1>Orders</h1></section>"));
}

#[test]
fn data_contract_renders_object_schema() {
    let block = DesignerBlock {
        id: "dc-1".to_string(),
        kind: "dataContract".to_string(),
        title: "Order schema".to_string(),
        order: 10,
        payload: json!({ "schema": { "type": "object", "properties": { "id": { "type": "string" } } }, "format": "json-schema-draft-07" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    };
    let rendered = render_block_markdown(&block);
    assert!(rendered.contains("\"type\": \"object\""));
}

#[test]
fn code_gen_prompt_contains_four_pillars_and_output_contract() {
    let temp = TempWorkspace::new("codegen");
    let mut detail = create_document_at("ws-1", temp.root(), "orders", "Orders", None)
        .expect("create document");
    // Inject one of each pillar.
    detail.design.blocks.push(DesignerBlock {
        id: "order".to_string(),
        kind: "entityModel".to_string(),
        title: "Order".to_string(),
        order: 20,
        payload: json!({ "entityName": "Order", "fields": [{ "name": "id", "type": "string" }] }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "dc-1".to_string(),
        kind: "dataContract".to_string(),
        title: "Order schema".to_string(),
        order: 30,
        payload: json!({ "schema": { "type": "object", "properties": { "id": { "type": "string" } } } }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "screen-1".to_string(),
        kind: "uiScreen".to_string(),
        title: "Orders".to_string(),
        order: 40,
        payload: json!({ "screenName": "Orders", "html": "<section data-entity=\"order\">x</section>" }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: "2026-07-05T00:00:00Z".to_string(),
    });
    save_document_at("ws-1", temp.root(), detail).expect("save");

    let detail = read_document_at("ws-1", temp.root(), "orders").expect("read");
    let prompt = super::code_gen_prompt::render_code_gen_prompt(&detail);
    assert!(prompt.contains("Software System Implementation Specification"));
    assert!(prompt.contains("## Brief"));
    assert!(prompt.contains("## Data Schemas"));
    assert!(prompt.contains("## Business Flows"));
    assert!(prompt.contains("## UI"));
    assert!(prompt.contains("## Output Contract"));
    assert!(prompt.contains("<section data-entity=\"order\">x</section>"));
    assert!(prompt.contains("\"type\": \"object\""));
}

#[test]
fn compile_writes_code_gen_prompt() {
    let temp = TempWorkspace::new("codegen-compile");
    let detail = create_document_at("ws-1", temp.root(), "inv", "Inventory", None)
        .expect("create document");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let compiled = compile_document_at("ws-1", temp.root(), "inv").expect("compile");
    assert!(compiled.files.contains(&"generated/code-gen-prompt.md".to_string()));
    let document_root = temp.root().join(".gtoffice/docs/documents/inv");
    assert!(document_root.join("generated/code-gen-prompt.md").is_file());
}

#[test]
fn export_code_gen_prompt_format_returns_content() {
    let temp = TempWorkspace::new("codegen-export");
    let detail = create_document_at("ws-1", temp.root(), "inv", "Inventory", None)
        .expect("create document");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let exported = export_document_at("ws-1", temp.root(), "inv", "codeGenPrompt").expect("export");
    assert_eq!(exported.format, "codeGenPrompt");
    assert_eq!(exported.mime_type, "text/markdown");
    assert!(exported.content.contains("Software System Implementation Specification"));
}

#[test]
fn legacy_manifest_without_code_gen_prompt_field_deserializes() {
    // Old manifests predate the code_gen_prompt field; serde(default) must fill it.
    let temp = TempWorkspace::new("legacy");
    let detail = create_document_at("ws-1", temp.root(), "legacy", "Legacy", None).expect("create");
    save_document_at("ws-1", temp.root(), detail).expect("save");
    let document_root = temp.root().join(".gtoffice/docs/documents/legacy");
    let manifest_path = document_root.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path).unwrap();
    // Remove the codeGenPrompt key to simulate a legacy manifest predating the field.
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    if let Some(obj) = v.get_mut("generated").and_then(|g| g.as_object_mut()) {
        obj.remove("codeGenPrompt");
    }
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    let reread = read_document_at("ws-1", temp.root(), "legacy").expect("legacy manifest must deserialize");
    assert_eq!(reread.manifest.generated.code_gen_prompt, "generated/code-gen-prompt.md");
}

#[test]
fn validate_document_merges_completeness_gaps_into_gaps() {
    // Test that completeness gaps are merged into the main `gaps` array and that
    // they have `layer: "completeness"`.
    let temp = TempWorkspace::new("completeness-gaps-merge");
    let mut detail = create_document_at("ws-1", temp.root(), "orders", "Orders", None)
        .expect("create document");
    let timestamp = detail.design.revision.clone();

    // Remove any existing acceptanceCriteria or agentInstruction blocks to ensure we get those gaps.
    detail.design.blocks.retain(|b| b.kind != "acceptanceCriteria" && b.kind != "agentInstruction");

    // Add an orphan entityModel, an orphan apiContract, and an orphan businessFlow.
    detail.design.blocks.push(DesignerBlock {
        id: "orphan-entity".to_string(),
        kind: "entityModel".to_string(),
        title: "Orphan Entity".to_string(),
        order: 20,
        payload: json!({
            "entityName": "OrphanEntity",
            "fields": [{ "name": "id", "type": "string" }]
        }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: timestamp.clone(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "orphan-api".to_string(),
        kind: "apiContract".to_string(),
        title: "Orphan API".to_string(),
        order: 30,
        payload: json!({
            "endpoints": []
        }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: timestamp.clone(),
    });
    detail.design.blocks.push(DesignerBlock {
        id: "orphan-flow".to_string(),
        kind: "businessFlow".to_string(),
        title: "Orphan Flow".to_string(),
        order: 40,
        payload: json!({
            "states": [],
            "transitions": []
        }),
        links: Vec::new(),
        validation: Vec::new(),
        updated_at: timestamp.clone(),
    });

    save_document_at("ws-1", temp.root(), detail).expect("save");

    let validate_result = validate_document_at("ws-1", temp.root(), "orders")
        .expect("validate document");

    let gaps = validate_result["gaps"].as_array().expect("gaps should be an array");
    assert!(!gaps.is_empty(), "gaps should contain completeness gaps");

    let completeness_gaps: Vec<_> = gaps
        .iter()
        .filter(|gap| gap["layer"] == "completeness")
        .collect();

    assert!(!completeness_gaps.is_empty(), "should have completeness gaps");

    let codes: Vec<_> = completeness_gaps
        .iter()
        .map(|gap| gap["code"].as_str().expect("code should be string"))
        .collect();

    assert!(codes.contains(&"orphan-entity"), "codes should contain orphan-entity: {codes:?}");
    assert!(codes.contains(&"orphan-api-contract"), "codes should contain orphan-api-contract: {codes:?}");
    assert!(codes.contains(&"flow-uncovered-ui"), "codes should contain flow-uncovered-ui: {codes:?}");
    assert!(codes.contains(&"flow-unverified"), "codes should contain flow-unverified: {codes:?}");
    assert!(codes.contains(&"no-agent-instruction"), "codes should contain no-agent-instruction: {codes:?}");
}
