use super::*;
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
fn build_agent_terminal_env_sets_gto_context_variables() {
    let env = build_agent_terminal_env("ws-1", "agent_alpha", "station-1");

    assert_eq!(
        env.get("GTO_WORKSPACE_ID").map(String::as_str),
        Some("ws-1")
    );
    assert_eq!(
        env.get("GTO_AGENT_ID").map(String::as_str),
        Some("agent_alpha")
    );
    assert_eq!(
        env.get("GTO_STATION_ID").map(String::as_str),
        Some("station-1")
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
