use super::*;
use gt_agent::{AgentProfile, AgentRole, AgentRoleScope, AgentScope, AgentState, RoleStatus};
use gt_task::{DispatchSender, DispatchSenderType};
use std::{env, fs};
use uuid::Uuid;

#[test]
fn bridge_response_serializes_stable_success_envelope() {
    let response = BridgeResponse::success("req-1".to_string(), json!({ "value": 1 }));
    let value = serde_json::to_value(response).expect("bridge response should serialize");

    assert_eq!(value["ok"], json!(true));
    assert_eq!(value["data"], json!({ "value": 1 }));
    assert_eq!(value["error"], Value::Null);
    assert!(value["traceId"]
        .as_str()
        .is_some_and(|trace_id| !trace_id.is_empty()));
}

#[test]
fn bridge_response_serializes_stable_failure_envelope() {
    let response = BridgeResponse::failure(
        "req-1".to_string(),
        BridgeError::new("LOCAL_BRIDGE_AUTH_FAILED", "invalid bridge token").payload(),
    );
    let value = serde_json::to_value(response).expect("bridge response should serialize");

    assert_eq!(value["ok"], json!(false));
    assert_eq!(value["data"], Value::Null);
    assert_eq!(value["error"]["code"], json!("LOCAL_BRIDGE_AUTH_FAILED"));
    assert_eq!(value["error"]["message"], json!("invalid bridge token"));
    assert!(value["traceId"]
        .as_str()
        .is_some_and(|trace_id| !trace_id.is_empty()));
}

#[test]
fn resolve_bootstrap_role_key_prefers_agent_role_mapping() {
    let agents = vec![AgentProfile {
        id: "agent_alpha".to_string(),
        workspace_id: "ws-1".to_string(),
        name: "Alpha".to_string(),
        role_id: "role_analyst".to_string(),
        tool: "claude".to_string(),
        workdir: Some(".gtoffice/alpha".to_string()),
        custom_workdir: false,
        scope: AgentScope::Station,
        state: AgentState::Ready,
        employee_no: None,
        policy_snapshot_id: None,
        prompt_file_name: Some("CLAUDE.md".to_string()),
        prompt_file_relative_path: Some(".gtoffice/alpha/CLAUDE.md".to_string()),
        launch_command: None,
        order_index: 0,
        created_at_ms: 1,
        updated_at_ms: 1,
    }];
    let roles = vec![AgentRole {
        id: "role_analyst".to_string(),
        workspace_id: "ws-1".to_string(),
        role_key: "analyst".to_string(),
        role_name: "Analyst".to_string(),
        department_id: "dept_analysis".to_string(),
        scope: AgentRoleScope::Workspace,
        charter_path: None,
        policy_json: Some("{}".to_string()),
        version: 1,
        status: RoleStatus::Active,
        is_system: false,
        created_at_ms: 1,
        updated_at_ms: 1,
    }];

    assert_eq!(
        resolve_bootstrap_role_key("agent_alpha", &agents, &roles),
        Some("analyst".to_string())
    );
}

#[test]
fn resolve_bootstrap_role_key_falls_back_to_matching_role_key() {
    let roles = vec![AgentRole {
        id: "role_generator".to_string(),
        workspace_id: "ws-1".to_string(),
        role_key: "generator".to_string(),
        role_name: "Generator".to_string(),
        department_id: "dept_generation".to_string(),
        scope: AgentRoleScope::Global,
        charter_path: None,
        policy_json: Some("{}".to_string()),
        version: 1,
        status: RoleStatus::Active,
        is_system: true,
        created_at_ms: 1,
        updated_at_ms: 1,
    }];

    assert_eq!(
        resolve_bootstrap_role_key("generator", &[], &roles),
        Some("generator".to_string())
    );
}

#[test]
fn build_agent_terminal_env_includes_role_key_when_present() {
    let env = build_agent_terminal_env("ws-1", "agent_alpha", Some("analyst"), "station-1");

    assert_eq!(
        env.get("GTO_WORKSPACE_ID").map(String::as_str),
        Some("ws-1")
    );
    assert_eq!(
        env.get("GTO_AGENT_ID").map(String::as_str),
        Some("agent_alpha")
    );
    assert_eq!(env.get("GTO_ROLE_KEY").map(String::as_str), Some("analyst"));
    assert_eq!(
        env.get("GTO_STATION_ID").map(String::as_str),
        Some("station-1")
    );
}

#[test]
fn require_bootstrap_role_key_rejects_missing_role_key() {
    let error = require_bootstrap_role_key("agent_unknown", None)
        .expect_err("missing role key should fail");

    assert_eq!(error.code, "LOCAL_BRIDGE_INVALID_PARAMS");
    assert_eq!(
        error.message,
        "bootstrap roleKey is required for target: agent_unknown"
    );
}

#[test]
fn map_command_error_preserves_machine_readable_code() {
    let error = map_command_error("AGENT_NOT_FOUND: missing agent".to_string());
    let payload = error.payload();

    assert_eq!(payload.code, "AGENT_NOT_FOUND");
    assert_eq!(payload.message, "missing agent");
    assert_eq!(payload.details, None);
}

fn temp_workspace_root(label: &str) -> std::path::PathBuf {
    let root = env::temp_dir().join(format!("gto-mcp-bridge-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temp workspace");
    root
}

#[test]
fn list_task_threads_returns_task_summaries_from_task_service() {
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
    state
        .task_service
        .register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "worker".to_string(),
            station_id: "worker".to_string(),
            role_key: None,
            session_id: "ts-worker".to_string(),
            tool_kind: AgentToolKind::default(),
            resolved_cwd: None,
            submit_sequence: None,
            provider_session: None,
            online: true,
        });

    let workspace_root = temp_workspace_root("threads");
    let outcome = state.task_service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Review migration".to_string(),
            markdown: "Please review the migration.".to_string(),
            attachments: vec![],
            submit_sequences: BTreeMap::new().into_iter().collect(),
        },
        &workspace_root,
        |_, _, _| Ok(()),
    );

    let value = list_task_threads(
        &state,
        json!({
            "workspaceId": "ws-1",
            "agentId": "worker",
            "limit": 20
        }),
    )
    .expect("task threads should serialize");

    assert_eq!(
        value["threads"][0]["taskId"],
        json!(outcome.response.results[0].task_id)
    );
    assert_eq!(value["threads"][0]["title"], json!("Review migration"));
    assert_eq!(value["threads"][0]["state"], json!("open"));

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn get_task_thread_returns_full_thread_payload() {
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
    state
        .task_service
        .register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "worker".to_string(),
            station_id: "worker".to_string(),
            role_key: None,
            session_id: "ts-worker".to_string(),
            tool_kind: AgentToolKind::default(),
            resolved_cwd: None,
            submit_sequence: None,
            provider_session: None,
            online: true,
        });

    let workspace_root = temp_workspace_root("thread-detail");
    let outcome = state.task_service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Need handover".to_string(),
            markdown: "Prepare a handover.".to_string(),
            attachments: vec![],
            submit_sequences: BTreeMap::new().into_iter().collect(),
        },
        &workspace_root,
        |_, _, _| Ok(()),
    );
    let task_id = outcome.response.results[0].task_id.clone();
    let _ = state.task_service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: gt_task::ChannelDescriptor {
            kind: gt_task::ChannelKind::Direct,
            id: "manager".to_string(),
        },
        sender_agent_id: Some("worker".to_string()),
        target_agent_ids: vec!["manager".to_string()],
        message_type: gt_task::ChannelMessageType::Status,
        payload: json!({
            "taskId": task_id,
            "detail": "handover in progress"
        }),
        idempotency_key: None,
    });

    let value = get_task_thread(
        &state,
        json!({
            "workspaceId": "ws-1",
            "taskId": task_id
        }),
    )
    .expect("thread should serialize");

    assert_eq!(value["thread"]["summary"]["state"], json!("replied"));
    assert_eq!(
        value["thread"]["messages"]
            .as_array()
            .map(|items| items.len()),
        Some(2)
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn map_command_error_falls_back_to_bridge_internal_for_unstructured_errors() {
    let error = map_command_error("database unavailable".to_string());
    let payload = error.payload();

    assert_eq!(payload.code, "LOCAL_BRIDGE_INTERNAL");
    assert_eq!(payload.message, "database unavailable");
    assert_eq!(payload.details, None);
}

#[test]
fn seed_agent_defaults_makes_global_roles_visible_for_workspace_listing() {
    let db_path = std::env::temp_dir().join(format!(
        "mcp-bridge-seed-agent-defaults-{}.db",
        uuid::Uuid::new_v4()
    ));
    let storage = SqliteStorage::new(&db_path).expect("create sqlite storage");
    let repo = SqliteAgentRepository::new(storage);
    repo.ensure_schema().expect("ensure schema");

    let before = repo.list_roles("ws_alpha").expect("list roles before seed");
    assert!(
        !before.iter().any(|role| role.role_key == "evaluator"),
        "fresh database should not expose built-in global roles before seeding"
    );

    seed_agent_defaults(&repo, "ws_alpha").expect("seed defaults");

    let after = repo.list_roles("ws_alpha").expect("list roles after seed");
    assert!(
        after.iter().any(|role| {
            role.workspace_id == GLOBAL_ROLE_WORKSPACE_ID && role.role_key == "evaluator"
        }),
        "workspace role listing should include seeded global built-in roles"
    );
}
