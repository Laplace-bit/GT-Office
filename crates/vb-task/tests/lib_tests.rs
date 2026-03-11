use serde_json::json;
use std::{
    collections::HashMap,
    env, fs,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use vb_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelDescriptor, ChannelKind, ChannelMessageType,
    ChannelPublishRequest, ChannelRouteBinding, DispatchSender, DispatchSenderType,
    ExternalAccessPolicyMode, ExternalInboundMessage, ExternalInboundResponse,
    ExternalInboundStatus, ExternalPeerKind, TaskDispatchBatchRequest, TaskDispatchStatus,
    TaskService,
};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

static WORKSPACE_TEST_SEQ: AtomicU64 = AtomicU64::new(0);

fn new_workspace_root() -> std::path::PathBuf {
    let seq = WORKSPACE_TEST_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let path = env::temp_dir().join(format!("vb-task-test-{}-{seq}", now_ms()));
    fs::create_dir_all(&path).expect("create temp workspace");
    path
}

#[test]
fn publish_offline_target_returns_failed_ack() {
    let service = TaskService::default();
    let outcome = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "agent-1".to_string(),
        },
        sender_agent_id: Some("agent-0".to_string()),
        target_agent_ids: vec![],
        message_type: ChannelMessageType::Status,
        payload: json!({ "hello": "world" }),
        idempotency_key: None,
    });

    assert!(outcome.response.accepted_targets.is_empty());
    assert_eq!(outcome.response.failed_targets.len(), 1);
    assert_eq!(outcome.ack_events.len(), 1);
}

#[test]
fn publish_online_target_produces_sequential_messages() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: None,
        online: true,
    });

    let first = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "agent-1".to_string(),
        },
        sender_agent_id: None,
        target_agent_ids: vec![],
        message_type: ChannelMessageType::Status,
        payload: json!({}),
        idempotency_key: None,
    });
    let second = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "agent-1".to_string(),
        },
        sender_agent_id: None,
        target_agent_ids: vec![],
        message_type: ChannelMessageType::Status,
        payload: json!({}),
        idempotency_key: None,
    });

    assert_eq!(
        first.message_events[0].seq + 1,
        second.message_events[0].seq
    );
}

#[test]
fn publish_handover_to_online_target_is_accepted() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: None,
        online: true,
    });

    let outcome = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "agent-1".to_string(),
        },
        sender_agent_id: Some("agent-0".to_string()),
        target_agent_ids: vec![],
        message_type: ChannelMessageType::Handover,
        payload: json!({
            "summary": "handover summary",
            "blockers": [],
            "nextSteps": ["review output"],
        }),
        idempotency_key: None,
    });

    assert_eq!(outcome.response.accepted_targets, vec!["agent-1".to_string()]);
    assert!(outcome.response.failed_targets.is_empty());
    assert_eq!(outcome.message_events.len(), 1);
    assert_eq!(outcome.ack_events.len(), 1);
    assert!(matches!(
        outcome.message_events[0].message_type,
        ChannelMessageType::Handover
    ));
}

#[test]
fn dispatch_batch_writes_files_and_emits_events() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: None,
        online: true,
    });
    let workspace_root = new_workspace_root();

    let outcome = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Human,
                agent_id: None,
            },
            targets: vec!["agent-1".to_string()],
            title: "Batch Task".to_string(),
            markdown: "- [ ] do it".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |session_id, _command, _submit_sequence| {
            assert_eq!(session_id, "ts-1");
            Ok(())
        },
    );

    assert_eq!(outcome.response.results.len(), 1);
    assert_eq!(outcome.response.results[0].status, TaskDispatchStatus::Sent);
    assert_eq!(outcome.message_events.len(), 1);
    assert_eq!(outcome.ack_events.len(), 1);

    let task_file_path = outcome.response.results[0]
        .task_file_path
        .as_ref()
        .expect("task file path");
    let abs_path = workspace_root.join(task_file_path);
    assert!(abs_path.exists());

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn dispatch_batch_terminal_command_appends_real_crlf_enter() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: None,
        online: true,
    });
    let workspace_root = new_workspace_root();
    let mut written_commands: Vec<String> = Vec::new();
    let mut written_submit_sequences: Vec<String> = Vec::new();

    let _outcome = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Human,
                agent_id: None,
            },
            targets: vec!["agent-1".to_string()],
            title: "Newline".to_string(),
            markdown: "- [ ] check newline".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_session_id, command, submit_sequence| {
            written_commands.push(command.to_string());
            written_submit_sequences.push(submit_sequence.to_string());
            Ok(())
        },
    );

    assert_eq!(written_commands.len(), 1);
    assert_eq!(written_submit_sequences.len(), 1);
    assert!(
        !written_commands[0].ends_with('\r') && !written_commands[0].ends_with('\n'),
        "dispatch command should not contain submit control characters"
    );
    assert!(
        !written_commands[0].contains("\\r"),
        "dispatch command must not include literal backslash-r"
    );
    assert!(
        !written_commands[0].contains("\\n"),
        "dispatch command must not include literal backslash-n"
    );
    assert_eq!(written_submit_sequences[0], "\r");

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn dispatch_batch_honors_target_submit_sequence_override() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: None,
        online: true,
    });
    let workspace_root = new_workspace_root();
    let mut written_submit_sequences: Vec<String> = Vec::new();
    let mut submit_sequences = HashMap::new();
    submit_sequences.insert("agent-1".to_string(), "\r".to_string());

    let _outcome = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Human,
                agent_id: None,
            },
            targets: vec!["agent-1".to_string()],
            title: "Submit override".to_string(),
            markdown: "- [ ] check submit override".to_string(),
            attachments: vec![],
            submit_sequences,
        },
        &workspace_root,
        |_session_id, _command, submit_sequence| {
            written_submit_sequences.push(submit_sequence.to_string());
            Ok(())
        },
    );

    assert_eq!(written_submit_sequences.len(), 1);
    assert_eq!(written_submit_sequences[0], "\r");

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn dispatch_batch_runtime_lf_submit_is_canonicalized_to_cr() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-1".to_string(),
        station_id: "agent-1".to_string(),
        role_key: None,
        session_id: "ts-1".to_string(),
        tool_kind: AgentToolKind::default(),
        resolved_cwd: None,
        submit_sequence: Some("\n".to_string()),
        online: true,
    });
    let workspace_root = new_workspace_root();
    let mut written_submit_sequences: Vec<String> = Vec::new();

    let _outcome = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Human,
                agent_id: None,
            },
            targets: vec!["agent-1".to_string()],
            title: "Runtime LF".to_string(),
            markdown: "hello".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_session_id, _command, submit_sequence| {
            written_submit_sequences.push(submit_sequence.to_string());
            Ok(())
        },
    );

    assert_eq!(written_submit_sequences.len(), 1);
    assert_eq!(written_submit_sequences[0], "\r");

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn resolve_external_route_prefers_specific_binding() {
    let service = TaskService::default();
    let generic_binding = ChannelRouteBinding {
        workspace_id: "ws-default".to_string(),
        channel: "telegram".to_string(),
        account_id: None,
        peer_kind: None,
        peer_pattern: None,
        target_agent_id: "manager".to_string(),
        priority: 0,
        created_at_ms: None,
        bot_name: None,
    };
    let specific_binding = ChannelRouteBinding {
        workspace_id: "ws-alpha".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("prod".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: Some("user-*".to_string()),
        target_agent_id: "assistant-a".to_string(),
        priority: 10,
        created_at_ms: None,
        bot_name: None,
    };
    service.upsert_route_binding(generic_binding);
    service.upsert_route_binding(specific_binding);

    let resolved = service.resolve_external_route(&ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "prod".to_string(),
        peer_kind: ExternalPeerKind::Direct,
        peer_id: "user-001".to_string(),
        sender_id: "user-001".to_string(),
        sender_name: None,
        message_id: "msg-1".to_string(),
        text: "hello".to_string(),
        idempotency_key: None,
        workspace_id_hint: None,
        target_agent_id_hint: None,
        metadata: json!({}),
    });

    let route = resolved.expect("route");
    assert_eq!(route.workspace_id, "ws-alpha");
    assert_eq!(route.target_agent_id, "assistant-a");
    assert_eq!(route.matched_by, "binding.peer");
}

#[test]
fn external_access_policy_pairing_then_allowlist() {
    let service = TaskService::default();
    service.set_external_access_policy("feishu", "default", ExternalAccessPolicyMode::Pairing);
    let allowed_before = service.is_external_allowed("feishu", "default", "alice");
    assert!(!allowed_before);

    let (code, created, expires_at_ms) =
        service.ensure_external_pairing("feishu", "default", "alice");
    assert!(created);
    assert_eq!(code.len(), 8);
    assert!(expires_at_ms > now_ms());

    let approved = service.approve_external_access("feishu", "default", "alice");
    assert!(approved);
    let allowed_after = service.is_external_allowed("feishu", "default", "alice");
    assert!(allowed_after);
}

#[test]
fn external_idempotency_cache_roundtrip() {
    let service = TaskService::default();
    let key = "telegram:default:user-1:msg-1".to_string();
    let response = ExternalInboundResponse {
        trace_id: "trace-1".to_string(),
        status: ExternalInboundStatus::Dispatched,
        idempotent_hit: false,
        workspace_id: Some("ws-1".to_string()),
        target_agent_id: Some("agent-1".to_string()),
        task_id: Some("task-1".to_string()),
        pairing_code: None,
        detail: None,
    };
    service.store_external_idempotency(key.clone(), response.clone());
    let loaded = service
        .check_external_idempotency(&key)
        .expect("cached response");
    assert_eq!(loaded.trace_id, response.trace_id);
    assert_eq!(loaded.task_id, response.task_id);
}
