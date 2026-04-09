use super::{
    allow_workspace_asset_scope, build_window_active_response, build_workspace_close_response,
    build_workspace_open_response, build_workspace_restore_response,
    build_workspace_switch_response,
};
use gt_abstractions::WorkspaceSessionSnapshot;
use gt_agent::{AgentRepository, AgentState, DEFAULT_DEPARTMENTS, GLOBAL_ROLE_WORKSPACE_ID};
use gt_storage::{
    AiConfigAuditLogInput, SavedClaudeProviderInput, SqliteAgentRepository,
    SqliteAiConfigRepository, SqliteStorage,
};
use serde_json::json;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{test::mock_app, Manager};
use uuid::Uuid;

#[test]
fn window_active_response_contains_workspace_id() {
    let payload = build_window_active_response("main", Some("ws-1".to_string()));
    assert_eq!(payload["windowLabel"], "main");
    assert_eq!(payload["workspaceId"], "ws-1");
}

#[test]
fn window_active_response_uses_null_when_unbound() {
    let payload = build_window_active_response("main", None);
    assert_eq!(payload["windowLabel"], "main");
    assert!(payload["workspaceId"].is_null());
}

#[test]
fn workspace_open_response_keeps_contract_fields() {
    let payload = build_workspace_open_response("ws-1", "repo", "/tmp/repo");
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["name"], "repo");
    assert_eq!(payload["root"], "/tmp/repo");
}

#[test]
fn workspace_close_response_keeps_contract_fields() {
    let payload = build_workspace_close_response("ws-1", true);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["closed"], true);
}

#[test]
fn workspace_restore_response_keeps_contract_fields() {
    let payload = build_workspace_restore_response(
        "ws-1",
        &WorkspaceSessionSnapshot {
            windows: vec![json!({"id":"w1"})],
            tabs: vec![json!({"id":"t1"})],
            terminals: vec![json!({"id":"p1"})],
        },
    );
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["windows"][0]["id"], "w1");
    assert_eq!(payload["tabs"][0]["id"], "t1");
    assert_eq!(payload["terminals"][0]["id"], "p1");
}

#[test]
fn workspace_switch_response_keeps_contract_fields() {
    let payload = build_workspace_switch_response("ws-2");
    assert_eq!(payload["activeWorkspaceId"], "ws-2");
}

#[test]
fn workspace_asset_scope_allows_files_outside_home_after_workspace_open() {
    let app = mock_app();
    let unique = Uuid::new_v4().to_string();
    let workspace_root = std::env::temp_dir().join(format!("gtoffice-workspace-{unique}"));
    let nested_dir = workspace_root.join("nested");
    let nested_file = nested_dir.join("image.png");

    fs::create_dir_all(&nested_dir).expect("create workspace dir");
    fs::write(&nested_file, b"test").expect("create workspace file");

    assert!(!app.asset_protocol_scope().is_allowed(&nested_file));

    allow_workspace_asset_scope(app.handle(), workspace_root.as_path()).expect("allow asset scope");

    assert!(app.asset_protocol_scope().is_allowed(&nested_file));

    fs::remove_dir_all(&workspace_root).expect("remove workspace dir");
}

struct WorkspaceResetFixture {
    storage: SqliteStorage,
    workspace_id: String,
    other_workspace_id: String,
    workspace_root: std::path::PathBuf,
    other_workspace_root: std::path::PathBuf,
    agent_repo: SqliteAgentRepository,
    ai_repo: SqliteAiConfigRepository,
}

impl WorkspaceResetFixture {
    fn create() -> Self {
        let root = std::env::temp_dir().join(format!("gtoffice-workspace-reset-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create fixture root");

        let db_path = root.join("workspace-reset.db");
        let storage = SqliteStorage::new(&db_path).expect("create sqlite storage");
        let agent_repo = SqliteAgentRepository::new(storage.clone());
        let ai_repo = SqliteAiConfigRepository::new(storage.clone());
        agent_repo.ensure_schema().expect("ensure agent schema");
        ai_repo.ensure_schema().expect("ensure ai schema");

        let workspace_id = "ws_alpha".to_string();
        let other_workspace_id = "ws_beta".to_string();
        let workspace_root = root.join("workspace-alpha");
        let other_workspace_root = root.join("workspace-beta");
        std::fs::create_dir_all(workspace_root.join(".gtoffice"))
            .expect("create target workspace dir");
        std::fs::create_dir_all(other_workspace_root.join(".gtoffice"))
            .expect("create other workspace dir");
        std::fs::write(
            workspace_root.join(".gtoffice/config.json"),
            "{\"workspace\":\"alpha\"}",
        )
        .expect("write target config");
        std::fs::write(
            workspace_root.join(".gtoffice/session.snapshot.json"),
            "{\"workspace\":\"alpha\"}",
        )
        .expect("write target snapshot");
        std::fs::write(
            other_workspace_root.join(".gtoffice/config.json"),
            "{\"workspace\":\"beta\"}",
        )
        .expect("write other config");
        std::fs::write(
            other_workspace_root.join(".gtoffice/session.snapshot.json"),
            "{\"workspace\":\"beta\"}",
        )
        .expect("write other snapshot");

        agent_repo
            .seed_defaults(GLOBAL_ROLE_WORKSPACE_ID)
            .expect("seed global defaults");
        agent_repo
            .seed_defaults(&workspace_id)
            .expect("seed target defaults");
        agent_repo
            .seed_defaults(&other_workspace_id)
            .expect("seed other defaults");

        {
            let conn = storage.open_connection().expect("open sqlite connection");
            conn.execute(
                "DELETE FROM org_departments WHERE workspace_id = ?1 AND id = ?2",
                [workspace_id.as_str(), "dept_analysis"],
            )
            .expect("delete target department to make reseed meaningful");
        }

        agent_repo
            .create_agent(gt_agent::CreateAgentInput {
                workspace_id: workspace_id.clone(),
                agent_id: Some("agent-alpha".to_string()),
                name: "Alpha".to_string(),
                role_id: "global_role_orchestrator".to_string(),
                tool: "codex".to_string(),
                workdir: Some(".gtoffice/alpha".to_string()),
                custom_workdir: false,
                employee_no: None,
                state: AgentState::Ready,
            })
            .expect("create target agent");
        agent_repo
            .create_agent(gt_agent::CreateAgentInput {
                workspace_id: other_workspace_id.clone(),
                agent_id: Some("agent-beta".to_string()),
                name: "Beta".to_string(),
                role_id: "global_role_orchestrator".to_string(),
                tool: "codex".to_string(),
                workdir: Some(".gtoffice/beta".to_string()),
                custom_workdir: false,
                employee_no: None,
                state: AgentState::Ready,
            })
            .expect("create other agent");

        ai_repo
            .upsert_saved_claude_provider(&SavedClaudeProviderInput {
                workspace_id: workspace_id.clone(),
                saved_provider_id: Some("claude-provider-alpha".to_string()),
                fingerprint: "fingerprint-alpha".to_string(),
                mode: "workspace".to_string(),
                provider_id: Some("claude".to_string()),
                provider_name: "Claude".to_string(),
                base_url: Some("https://example.com".to_string()),
                model: Some("claude-3".to_string()),
                auth_scheme: Some("bearer".to_string()),
                secret_ref: Some("secret-alpha".to_string()),
                has_secret: true,
                settings_json: Some("{}".to_string()),
                created_at_ms: 1,
                updated_at_ms: 1,
                last_applied_at_ms: 1,
            })
            .expect("create target ai config");
        ai_repo
            .upsert_saved_claude_provider(&SavedClaudeProviderInput {
                workspace_id: other_workspace_id.clone(),
                saved_provider_id: Some("claude-provider-beta".to_string()),
                fingerprint: "fingerprint-beta".to_string(),
                mode: "workspace".to_string(),
                provider_id: Some("claude".to_string()),
                provider_name: "Claude".to_string(),
                base_url: Some("https://example.com".to_string()),
                model: Some("claude-3".to_string()),
                auth_scheme: Some("bearer".to_string()),
                secret_ref: Some("secret-beta".to_string()),
                has_secret: true,
                settings_json: Some("{}".to_string()),
                created_at_ms: 1,
                updated_at_ms: 1,
                last_applied_at_ms: 1,
            })
            .expect("create other ai config");

        let audit_now_ms = now_ms();
        ai_repo
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: "audit-alpha".to_string(),
                workspace_id: workspace_id.clone(),
                agent: "agent-alpha".to_string(),
                mode: "workspace".to_string(),
                provider_id: Some("claude".to_string()),
                changed_keys_json: "[\"model\"]".to_string(),
                secret_refs_json: "[\"secret-alpha\"]".to_string(),
                confirmed_by: "tester".to_string(),
                created_at_ms: audit_now_ms,
            })
            .expect("create target audit log");
        ai_repo
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: "audit-beta".to_string(),
                workspace_id: other_workspace_id.clone(),
                agent: "agent-beta".to_string(),
                mode: "workspace".to_string(),
                provider_id: Some("claude".to_string()),
                changed_keys_json: "[\"model\"]".to_string(),
                secret_refs_json: "[\"secret-beta\"]".to_string(),
                confirmed_by: "tester".to_string(),
                created_at_ms: audit_now_ms,
            })
            .expect("create other audit log");

        Self {
            storage,
            workspace_id,
            other_workspace_id,
            workspace_root,
            other_workspace_root,
            agent_repo,
            ai_repo,
        }
    }
}

impl Drop for WorkspaceResetFixture {
    fn drop(&mut self) {
        if let Some(parent) = self.storage.path().parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }
}

fn workspace_reset_command(
    _workspace_id: &str,
    _confirmation_text: &str,
) -> Result<serde_json::Value, String> {
    todo!("workspace reset command is not implemented yet");
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[test]
fn workspace_reset_rejects_invalid_confirmation() {
    let err = workspace_reset_command("ws_alpha", "WRONG")
        .expect_err("expected invalid confirmation to be rejected");
    assert!(err.contains("invalid confirmation"));
}

#[test]
fn workspace_reset_preserves_workspace_id_in_response() {
    let response = workspace_reset_command("ws_alpha", "RESET").expect("workspace reset command");
    assert_eq!(response["workspaceId"], "ws_alpha");
    assert_eq!(response["reset"], true);
}

#[test]
fn workspace_reset_command_cleans_workspace_files() {
    let fixture = WorkspaceResetFixture::create();

    assert!(fixture
        .workspace_root
        .join(".gtoffice/config.json")
        .exists());
    assert!(fixture
        .workspace_root
        .join(".gtoffice/session.snapshot.json")
        .exists());

    let response = workspace_reset_command(&fixture.workspace_id, "RESET")
        .expect("workspace reset command");

    assert_eq!(response["workspaceId"], fixture.workspace_id);
    assert!(!fixture
        .workspace_root
        .join(".gtoffice/config.json")
        .exists());
    assert!(!fixture
        .workspace_root
        .join(".gtoffice/session.snapshot.json")
        .exists());
    assert!(fixture
        .other_workspace_root
        .join(".gtoffice/config.json")
        .exists());
    assert!(fixture
        .other_workspace_root
        .join(".gtoffice/session.snapshot.json")
        .exists());
}

#[test]
fn workspace_reset_removes_workspace_rows_and_reseeds_defaults() {
    let fixture = WorkspaceResetFixture::create();

    assert_eq!(
        fixture
            .agent_repo
            .list_agents(&fixture.workspace_id)
            .expect("list target agents")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .agent_repo
            .list_departments(&fixture.workspace_id)
            .expect("list target departments before reset")
            .len(),
        DEFAULT_DEPARTMENTS.len() - 1
    );
    assert_eq!(
        fixture
            .ai_repo
            .list_saved_claude_providers(&fixture.workspace_id)
            .expect("list target ai config")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .ai_repo
            .query_audit_logs(&fixture.workspace_id, "agent-alpha", 10)
            .expect("list target audit logs")
            .len(),
        1
    );

    fixture
        .agent_repo
        .reset_workspace_state(&fixture.workspace_id)
        .expect("reset workspace agents");
    fixture
        .ai_repo
        .reset_workspace_state(&fixture.workspace_id)
        .expect("reset workspace ai config");

    assert!(fixture
        .agent_repo
        .list_agents(&fixture.workspace_id)
        .expect("list target agents after reset")
        .is_empty());
    assert!(fixture
        .agent_repo
        .list_departments(&fixture.workspace_id)
        .expect("list target departments after reset")
        .iter()
        .any(|department| department.id == "dept_analysis"));
    assert_eq!(
        fixture
            .agent_repo
            .list_departments(&fixture.workspace_id)
            .expect("list target departments after reset")
            .len(),
        DEFAULT_DEPARTMENTS.len()
    );
    assert!(fixture
        .agent_repo
        .list_roles(&fixture.workspace_id)
        .expect("list target roles after reset")
        .iter()
        .any(|role| role.id == "global_role_orchestrator"));
    assert!(fixture
        .ai_repo
        .list_saved_claude_providers(&fixture.workspace_id)
        .expect("list target ai config after reset")
        .is_empty());
    assert!(fixture
        .ai_repo
        .query_audit_logs(&fixture.workspace_id, "agent-alpha", 10)
        .expect("list target audit logs after reset")
        .is_empty());
}

#[test]
fn workspace_reset_does_not_touch_other_workspaces() {
    let fixture = WorkspaceResetFixture::create();

    assert_eq!(
        fixture
            .agent_repo
            .list_agents(&fixture.other_workspace_id)
            .expect("list other agents")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .ai_repo
            .list_saved_claude_providers(&fixture.other_workspace_id)
            .expect("list other ai config")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .ai_repo
            .query_audit_logs(&fixture.other_workspace_id, "agent-beta", 10)
            .expect("list other audit logs")
            .len(),
        1
    );

    fixture
        .agent_repo
        .reset_workspace_state(&fixture.workspace_id)
        .expect("reset target workspace agents");
    fixture
        .ai_repo
        .reset_workspace_state(&fixture.workspace_id)
        .expect("reset target workspace ai config");

    assert_eq!(
        fixture
            .agent_repo
            .list_agents(&fixture.other_workspace_id)
            .expect("list other agents after reset")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .ai_repo
            .list_saved_claude_providers(&fixture.other_workspace_id)
            .expect("list other ai config after reset")
            .len(),
        1
    );
    assert_eq!(
        fixture
            .ai_repo
            .query_audit_logs(&fixture.other_workspace_id, "agent-beta", 10)
            .expect("list other audit logs after reset")
            .len(),
        1
    );
}
