use serde_json::json;
use std::{
    collections::HashMap,
    env, fs,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use gt_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelDescriptor, ChannelKind, ChannelMessageType,
    ChannelPublishRequest, ChannelRouteBinding, DispatchSender, DispatchSenderType,
    ExternalAccessPolicyMode, ExternalInboundMessage, ExternalInboundResponse,
    ExternalInboundStatus, ExternalPeerKind, TaskDispatchBatchRequest, TaskDispatchStatus,
    TaskService, TaskThreadState,
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
    let path = env::temp_dir().join(format!("gt-task-test-{}-{seq}", now_ms()));
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
        provider_session: None,
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
        provider_session: None,
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

    assert_eq!(
        outcome.response.accepted_targets,
        vec!["agent-1".to_string()]
    );
    assert!(outcome.response.failed_targets.is_empty());
    assert_eq!(outcome.message_events.len(), 1);
    assert_eq!(outcome.ack_events.len(), 1);
    assert!(matches!(
        outcome.message_events[0].message_type,
        ChannelMessageType::Handover
    ));
}

#[test]
fn list_messages_returns_recent_filtered_inbox() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
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
    service.register_runtime(AgentRuntimeRegistration {
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

    let _ = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "manager".to_string(),
        },
        sender_agent_id: Some("worker".to_string()),
        target_agent_ids: vec!["manager".to_string()],
        message_type: ChannelMessageType::Status,
        payload: json!({ "taskId": "task-1", "detail": "ONLINE: yes" }),
        idempotency_key: None,
    });

    let inbox = service.list_messages("ws-1", Some("manager"), None, Some("task-1"), 20);
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].target_agent_id, "manager");
    assert_eq!(inbox[0].sender_agent_id.as_deref(), Some("worker"));
    assert_eq!(inbox[0].payload["detail"], json!("ONLINE: yes"));
}

#[test]
fn dispatch_batch_includes_managed_mcp_reply_instruction_for_agent_sender() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
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
    let workspace_root = new_workspace_root();
    let mut written_command = String::new();

    let outcome = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Need reply".to_string(),
            markdown: "请回复我一句确认消息。".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_, command, _| {
            written_command = command.to_string();
            Ok(())
        },
    );

    assert!(written_command.contains("gto agent reply-status"));
    assert!(written_command.contains("--target-agent-id"));
    assert!(written_command.contains("manager"));
    assert!(written_command.contains("GT Office Reply"));
    assert!(written_command.contains("<your reply text>"));
    assert!(written_command.contains("<summary>"));
    assert_eq!(outcome.response.results[0].task_file_path, None);
    assert!(!workspace_root.join(".gtoffice/tasks").exists());

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn dispatch_batch_sends_raw_markdown_and_emits_events() {
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
        provider_session: None,
        online: true,
    });
    let workspace_root = new_workspace_root();
    let mut written_command = String::new();

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
        |session_id, command, _submit_sequence| {
            assert_eq!(session_id, "ts-1");
            written_command = command.to_string();
            Ok(())
        },
    );

    assert_eq!(outcome.response.results.len(), 1);
    assert_eq!(outcome.response.results[0].status, TaskDispatchStatus::Sent);
    assert_eq!(outcome.message_events.len(), 1);
    assert_eq!(outcome.ack_events.len(), 1);
    assert_eq!(written_command, "- [ ] do it");
    assert_eq!(outcome.response.results[0].task_file_path, None);
    assert!(!workspace_root.join(".gtoffice/tasks").exists());

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
        provider_session: None,
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
        provider_session: None,
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
        provider_session: None,
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
fn list_task_threads_groups_messages_by_task_and_tracks_latest_state() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
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
    service.register_runtime(AgentRuntimeRegistration {
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

    let workspace_root = new_workspace_root();
    let dispatch = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Review API contract".to_string(),
            markdown: "Check the new API contract and reply with blockers.".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_, _, _| Ok(()),
    );
    let task_id = dispatch.response.results[0].task_id.clone();

    let _ = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "manager".to_string(),
        },
        sender_agent_id: Some("worker".to_string()),
        target_agent_ids: vec!["manager".to_string()],
        message_type: ChannelMessageType::Status,
        payload: json!({
            "taskId": task_id,
            "detail": "Blocked on product answer",
        }),
        idempotency_key: None,
    });

    let threads = service.list_task_threads("ws-1", Some("manager"), 20);

    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].task_id, dispatch.response.results[0].task_id);
    assert_eq!(threads[0].title, "Review API contract");
    assert_eq!(threads[0].state, TaskThreadState::Replied);
    assert_eq!(threads[0].latest_message_type, ChannelMessageType::Status);
    assert_eq!(threads[0].latest_sender_agent_id.as_deref(), Some("worker"));

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn get_task_thread_returns_chronological_messages_for_task() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
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
    service.register_runtime(AgentRuntimeRegistration {
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

    let workspace_root = new_workspace_root();
    let dispatch = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Prepare handover".to_string(),
            markdown: "Summarize the implementation status.".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_, _, _| Ok(()),
    );
    let task_id = dispatch.response.results[0].task_id.clone();

    let _ = service.publish(&ChannelPublishRequest {
        workspace_id: "ws-1".to_string(),
        channel: ChannelDescriptor {
            kind: ChannelKind::Direct,
            id: "manager".to_string(),
        },
        sender_agent_id: Some("worker".to_string()),
        target_agent_ids: vec!["manager".to_string()],
        message_type: ChannelMessageType::Handover,
        payload: json!({
            "taskId": task_id,
            "summary": "Handover ready",
            "nextSteps": ["review diff"],
            "blockers": [],
        }),
        idempotency_key: None,
    });

    let thread = service
        .get_task_thread("ws-1", dispatch.response.results[0].task_id.as_str())
        .expect("thread should exist");

    assert_eq!(thread.summary.task_id, dispatch.response.results[0].task_id);
    assert_eq!(thread.summary.title, "Prepare handover");
    assert_eq!(thread.summary.state, TaskThreadState::HandedOver);
    assert_eq!(thread.messages.len(), 2);
    assert_eq!(thread.messages[0].message_type, ChannelMessageType::TaskInstruction);
    assert_eq!(thread.messages[1].message_type, ChannelMessageType::Handover);
    assert_eq!(
        thread.messages[0].payload.get("taskId").and_then(|value| value.as_str()),
        Some(dispatch.response.results[0].task_id.as_str()),
    );
    assert_eq!(
        thread.messages[1].payload.get("taskId").and_then(|value| value.as_str()),
        Some(dispatch.response.results[0].task_id.as_str()),
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[test]
fn unregister_runtime_purges_agent_message_threads_by_default() {
    let service = TaskService::default();
    service.register_runtime(AgentRuntimeRegistration {
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
    service.register_runtime(AgentRuntimeRegistration {
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

    let workspace_root = new_workspace_root();
    let dispatch = service.dispatch_batch(
        &TaskDispatchBatchRequest {
            workspace_id: "ws-1".to_string(),
            sender: DispatchSender {
                sender_type: DispatchSenderType::Agent,
                agent_id: Some("manager".to_string()),
            },
            targets: vec!["worker".to_string()],
            title: "Temporary task".to_string(),
            markdown: "This task should disappear when worker closes.".to_string(),
            attachments: vec![],
            submit_sequences: HashMap::new(),
        },
        &workspace_root,
        |_, _, _| Ok(()),
    );

    assert_eq!(service.list_task_threads("ws-1", Some("worker"), 20).len(), 1);
    assert!(service.unregister_runtime("ws-1", "worker"));
    assert!(service.list_task_threads("ws-1", Some("worker"), 20).is_empty());
    assert!(service
        .get_task_thread("ws-1", dispatch.response.results[0].task_id.as_str())
        .is_none());

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
        enabled: true,
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
        enabled: true,
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
fn resolve_external_route_in_workspace_ignores_other_workspace_matches() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-old".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "role:build".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-current".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "role:manager".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let inbound = ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
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
    };

    let resolved = service
        .resolve_external_route_in_workspace("ws-current", &inbound)
        .expect("workspace-scoped route");
    assert_eq!(resolved.workspace_id, "ws-current");
    assert_eq!(resolved.target_agent_id, "role:manager");
    assert_eq!(resolved.matched_by, "binding.account");
}

#[test]
fn resolve_external_route_preferring_workspace_breaks_same_score_ties() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-old".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "role:build".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-current".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "role:manager".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let inbound = ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
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
    };

    let resolved = service
        .resolve_external_route_preferring_workspace("ws-current", &inbound)
        .expect("preferred route");
    assert_eq!(resolved.workspace_id, "ws-current");
    assert_eq!(resolved.target_agent_id, "role:manager");
}

#[test]
fn resolve_external_route_preferring_workspace_does_not_override_higher_score_match() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-current".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "role:manager".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-other".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: Some("user-*".to_string()),
        target_agent_id: "assistant-a".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let inbound = ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
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
    };

    let resolved = service
        .resolve_external_route_preferring_workspace("ws-current", &inbound)
        .expect("higher score route");
    assert_eq!(resolved.workspace_id, "ws-other");
    assert_eq!(resolved.target_agent_id, "assistant-a");
    assert_eq!(resolved.matched_by, "binding.peer");
}

#[test]
fn resolve_external_route_skips_disabled_bindings() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-default".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-disabled".to_string(),
        priority: 200,
        created_at_ms: None,
        bot_name: None,
        enabled: false,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-default".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-live".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let resolved = service.resolve_external_route(&ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
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
    assert_eq!(route.target_agent_id, "agent-live");
}

#[test]
fn resolve_external_route_returns_none_when_only_match_is_disabled() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-default".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-disabled".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: false,
    });

    let resolved = service.resolve_external_route(&ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
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

    assert!(resolved.is_none());
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

#[test]
fn external_idempotency_cache_can_be_cleared_after_route_changes() {
    let service = TaskService::default();
    let key = "telegram:default:user-1:msg-2".to_string();
    let response = ExternalInboundResponse {
        trace_id: "trace-2".to_string(),
        status: ExternalInboundStatus::Dispatched,
        idempotent_hit: false,
        workspace_id: Some("ws-1".to_string()),
        target_agent_id: Some("agent-before".to_string()),
        task_id: Some("task-2".to_string()),
        pairing_code: None,
        detail: None,
    };
    service.store_external_idempotency(key.clone(), response);
    assert!(service.check_external_idempotency(&key).is_some());

    service.clear_external_idempotency_cache();

    assert!(service.check_external_idempotency(&key).is_none());
}
