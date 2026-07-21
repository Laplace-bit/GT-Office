use super::{
    align_route_with_resolved_workspace, build_external_content_preview, build_external_title,
    channel_supports_external_reply, claude_print_stream_json_args, codex_event_text,
    find_command_in_dir, migrate_legacy_wechat_access_policies, normalize_account_id,
    normalize_executable_path, nvm_bin_dirs, parse_external_interaction_callback,
    resolve_cli_candidate, runtime_supports_structured_relay, split_text_for_channel,
    summarize_external_text, truncate_text_for_channel, validate_binding_target_selector,
    AgentRuntimeRegistration, AgentToolKind, PersistedChannelAccessPolicy,
    PersistedChannelStateFile, PersistedRouteBindingRecord,
};
use gt_agent::{AgentRepository, AgentScope, AgentState, CreateAgentInput};
use gt_storage::{SqliteAgentRepository, SqliteStorage};
use gt_task::{
    ChannelRouteBinding, ExternalInboundMessage, ExternalPeerKind, ExternalRouteResolution,
};
use std::path::PathBuf;
use std::{collections::HashSet, fs};
use uuid::Uuid;

use crate::app_state::{AppState, ExternalInteractionAction};

fn sample_runtime(
    tool_kind: AgentToolKind,
    resolved_cwd: Option<&str>,
) -> AgentRuntimeRegistration {
    AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-01".to_string(),
        station_id: "agent-01".to_string(),
        role_key: Some("analyst".to_string()),
        session_id: "ts-1".to_string(),
        tool_kind,
        resolved_cwd: resolved_cwd.map(str::to_string),
        submit_sequence: Some("\r".to_string()),
        provider_session: None,
        online: true,
    }
}

#[test]
fn claude_print_stream_json_args_include_verbose() {
    let args = claude_print_stream_json_args();

    assert_eq!(args[0], "-p");
    assert!(args.contains(&"--output-format"));
    assert!(args.contains(&"stream-json"));
    assert!(args.contains(&"--verbose"));
    assert!(args.contains(&"--include-partial-messages"));
}

#[test]
fn parse_interaction_callback_accepts_terminal_option_select() {
    let message = ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_kind: ExternalPeerKind::Direct,
        peer_id: "peer-1".to_string(),
        sender_id: "sender-1".to_string(),
        sender_name: None,
        message_id: "callback-cbq-1".to_string(),
        text: "gto-select:3".to_string(),
        idempotency_key: Some("telegram-callback-cbq-1".to_string()),
        workspace_id_hint: None,
        target_agent_id_hint: None,
        metadata: serde_json::json!({
            "callback_query": {
                "id": "cbq-1",
                "data": "gto-select:3",
                "message": { "message_id": 42 }
            }
        }),
    };

    let parsed = parse_external_interaction_callback(&message).expect("select callback");
    assert_eq!(parsed.0, "42");
    assert_eq!(parsed.1, ExternalInteractionAction::SelectOption(2));
}

fn temp_agent_repo(label: &str) -> SqliteAgentRepository {
    let db_path = std::env::temp_dir().join(format!(
        "gtoffice-channel-binding-target-{label}-{}.db",
        Uuid::new_v4()
    ));
    let storage = SqliteStorage::new(&db_path).expect("create sqlite storage");
    let repo = SqliteAgentRepository::new(storage);
    repo.ensure_schema().expect("ensure schema");
    repo
}

fn seed_workspace_agent(repo: &SqliteAgentRepository, workspace_id: &str, agent_id: &str) {
    repo.seed_defaults(gt_agent::GLOBAL_ROLE_WORKSPACE_ID)
        .expect("seed global roles");
    repo.seed_defaults(workspace_id)
        .expect("seed workspace roles");
    let role_id = repo
        .list_roles(workspace_id)
        .expect("list roles")
        .into_iter()
        .find(|role| role.role_key == "analyst")
        .expect("analyst role")
        .id;
    repo.create_agent(CreateAgentInput {
        workspace_id: workspace_id.to_string(),
        agent_id: Some(agent_id.to_string()),
        name: "Agent Analyst".to_string(),
        role_id,
        tool: "codex".to_string(),
        workdir: Some(".gtoffice/agent-analyst".to_string()),
        custom_workdir: false,
        scope: AgentScope::Station,
        employee_no: None,
        state: AgentState::Ready,
        launch_command: None,
        order_index: None,
    })
    .expect("create agent");
}

#[test]
fn runtime_supports_structured_relay_only_for_supported_tools_with_cwd() {
    assert!(runtime_supports_structured_relay(&sample_runtime(
        AgentToolKind::Claude,
        Some("/tmp/workspace")
    )));
    assert!(runtime_supports_structured_relay(&sample_runtime(
        AgentToolKind::Codex,
        Some("/tmp/workspace")
    )));
    assert!(!runtime_supports_structured_relay(&sample_runtime(
        AgentToolKind::Codex,
        None
    )));
    assert!(!runtime_supports_structured_relay(&sample_runtime(
        AgentToolKind::Shell,
        Some("/tmp/workspace")
    )));
}

#[test]
fn normalize_account_id_defaults_and_trims_channel_accounts() {
    assert_eq!(normalize_account_id(None), "default");
    assert_eq!(normalize_account_id(Some("   ")), "default");
    assert_eq!(normalize_account_id(Some(" Ops-Bot ")), "Ops-Bot");
}

#[test]
fn truncate_text_for_channel_is_character_safe() {
    assert_eq!(truncate_text_for_channel("hello", 10), "hello");
    assert_eq!(
        truncate_text_for_channel("你好世界abc", 4),
        "你好世界\n\n... [truncated]"
    );
}

#[test]
fn summarize_external_text_collapses_whitespace_and_limits_chars() {
    assert_eq!(
        summarize_external_text("  hello\n\nchannel   world  ", 30).as_deref(),
        Some("hello channel world")
    );
    assert_eq!(summarize_external_text(" \n\t ", 30), None);
    assert_eq!(
        summarize_external_text("abcdefghijkl", 5).as_deref(),
        Some("abcde...")
    );
}

#[test]
fn external_title_uses_first_non_empty_line_and_limits_length() {
    assert_eq!(
        build_external_title("\n\n  Fix channel route  \nbody"),
        "Fix channel route"
    );
    assert_eq!(build_external_title(" \n\t "), "外部通道任务");

    let long = "a".repeat(90);
    let title = build_external_title(&long);
    assert_eq!(title.chars().count(), 72);
    assert!(title.chars().all(|ch| ch == 'a'));
}

#[test]
fn external_content_preview_collapses_whitespace_and_limits_length() {
    assert_eq!(
        build_external_content_preview(" hello\nchannel   world ").as_deref(),
        Some("hello channel world")
    );
    assert_eq!(build_external_content_preview(" \n\t "), None);

    let long = "你".repeat(120);
    let preview = build_external_content_preview(&long).expect("preview");
    assert_eq!(preview.chars().count(), 99);
    assert!(preview.ends_with("..."));
}

#[test]
fn codex_event_text_extracts_completed_agent_message() {
    let payload = serde_json::json!({
        "type": "item.completed",
        "item": {
            "id": "item_0",
            "type": "agent_message",
            "text": "hello from codex"
        }
    });

    let parsed = codex_event_text(&payload);
    assert_eq!(parsed, Some(("hello from codex".to_string(), true)));
}

#[test]
fn codex_event_text_extracts_delta_text_from_updated_item() {
    let payload = serde_json::json!({
        "type": "item.updated",
        "delta": {
            "text": "stream "
        }
    });

    let parsed = codex_event_text(&payload);
    assert_eq!(parsed, Some(("stream ".to_string(), false)));
}

#[test]
fn normalize_executable_path_accepts_existing_executable_file() {
    let temp_dir = std::env::temp_dir().join(format!("gtoffice-channel-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let tool_path = temp_dir.join("codex");
    fs::write(&tool_path, "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tool_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tool_path, perms).unwrap();
    }

    let resolved = normalize_executable_path(tool_path.clone());
    assert_eq!(resolved, Some(tool_path));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn find_command_in_dir_matches_fake_cli_binary() {
    let temp_dir = std::env::temp_dir().join(format!("gtoffice-channel-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let tool_path = temp_dir.join(if cfg!(target_os = "windows") {
        "codex.cmd"
    } else {
        "codex"
    });
    fs::write(&tool_path, "@echo off\r\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tool_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tool_path, perms).unwrap();
    }

    let resolved = find_command_in_dir(&temp_dir, "codex");
    assert_eq!(resolved, Some(tool_path));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn nvm_bin_dirs_collects_versioned_node_bins() {
    let temp_home = std::env::temp_dir().join(format!("gtoffice-channel-test-{}", Uuid::new_v4()));
    let versions_root = temp_home.join(".nvm/versions/node");
    fs::create_dir_all(versions_root.join("v22.1.0/bin")).unwrap();
    fs::create_dir_all(versions_root.join("v20.5.0/bin")).unwrap();

    let mut dirs = nvm_bin_dirs(&temp_home);
    dirs.sort();

    assert_eq!(
        dirs,
        vec![
            PathBuf::from(&versions_root).join("v20.5.0/bin"),
            PathBuf::from(&versions_root).join("v22.1.0/bin")
        ]
    );

    let _ = fs::remove_dir_all(&temp_home);
}

#[test]
fn resolve_cli_candidate_accepts_explicit_absolute_path() {
    let temp_dir = std::env::temp_dir().join(format!("gtoffice-channel-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let tool_path = temp_dir.join("claude");
    fs::write(&tool_path, "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tool_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tool_path, perms).unwrap();
    }

    let resolved = resolve_cli_candidate(tool_path.to_string_lossy().as_ref(), "claude");
    assert_eq!(resolved, Some(tool_path));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn split_text_for_channel_keeps_full_text_across_chunks() {
    let text = "第一段\n第二段\n第三段\n第四段";
    let chunks = split_text_for_channel(text, 5);
    assert_eq!(chunks, vec!["第一段", "第二段", "第三段", "第四段"]);
    assert_eq!(chunks.join("\n"), text);
}

#[test]
fn split_text_for_channel_falls_back_to_hard_split_when_no_newline() {
    let text = "abcdefghij";
    let chunks = split_text_for_channel(text, 4);
    assert_eq!(chunks, vec!["abcd", "efgh", "ij"]);
    assert_eq!(chunks.concat(), text);
}

#[test]
fn channel_supports_external_reply_includes_feishu_telegram_and_wechat() {
    assert!(channel_supports_external_reply("telegram"));
    assert!(channel_supports_external_reply("feishu"));
    assert!(channel_supports_external_reply("wechat"));
    assert!(!channel_supports_external_reply("slack"));
}

#[test]
fn migrate_legacy_wechat_access_policies_promotes_pairing_to_open_once() {
    let mut state_file = PersistedChannelStateFile {
        route_bindings: vec![
            PersistedRouteBindingRecord {
                binding: ChannelRouteBinding {
                    workspace_id: "ws-1".to_string(),
                    channel: "wechat".to_string(),
                    account_id: Some("default".to_string()),
                    peer_kind: Some(ExternalPeerKind::Direct),
                    peer_pattern: None,
                    target_agent_id: "role:manager".to_string(),
                    priority: 100,
                    created_at_ms: None,
                    bot_name: None,
                    enabled: true,
                },
                workspace_root: None,
            },
            PersistedRouteBindingRecord {
                binding: ChannelRouteBinding {
                    workspace_id: "ws-2".to_string(),
                    channel: "telegram".to_string(),
                    account_id: Some("default".to_string()),
                    peer_kind: Some(ExternalPeerKind::Direct),
                    peer_pattern: None,
                    target_agent_id: "role:ops".to_string(),
                    priority: 100,
                    created_at_ms: None,
                    bot_name: None,
                    enabled: true,
                },
                workspace_root: None,
            },
        ],
        access_policies: vec![
            PersistedChannelAccessPolicy {
                channel: "wechat".to_string(),
                account_id: "default".to_string(),
                mode: gt_task::ExternalAccessPolicyMode::Pairing,
            },
            PersistedChannelAccessPolicy {
                channel: "telegram".to_string(),
                account_id: "default".to_string(),
                mode: gt_task::ExternalAccessPolicyMode::Pairing,
            },
        ],
        ..PersistedChannelStateFile::default()
    };

    let migrated = migrate_legacy_wechat_access_policies(
        &mut state_file,
        &HashSet::from(["default".to_string()]),
    );

    assert_eq!(migrated, vec!["default".to_string()]);
    assert_eq!(state_file.access_policies.len(), 2);
    assert_eq!(
        state_file.access_policies[0].mode,
        gt_task::ExternalAccessPolicyMode::Open
    );
    assert_eq!(
        state_file.access_policies[1].mode,
        gt_task::ExternalAccessPolicyMode::Pairing
    );
}

#[test]
fn align_route_with_resolved_workspace_rebinds_to_matching_binding_in_fallback_workspace() {
    let state = AppState::default();
    state
        .task_service
        .upsert_route_binding(ChannelRouteBinding {
            workspace_id: "ws-stale".to_string(),
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
    state
        .task_service
        .upsert_route_binding(ChannelRouteBinding {
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

    let route = align_route_with_resolved_workspace(
        &state,
        &ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_kind: ExternalPeerKind::Direct,
            peer_id: "user-1".to_string(),
            sender_id: "user-1".to_string(),
            sender_name: None,
            message_id: "msg-1".to_string(),
            text: "hello".to_string(),
            idempotency_key: None,
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: serde_json::json!({}),
        },
        &ExternalRouteResolution {
            workspace_id: "ws-stale".to_string(),
            target_agent_id: "role:build".to_string(),
            matched_by: "binding.account".to_string(),
        },
        "ws-current",
    )
    .expect("fallback workspace route");

    assert_eq!(route.workspace_id, "ws-current");
    assert_eq!(route.target_agent_id, "role:manager");
}

#[test]
fn align_route_with_resolved_workspace_rejects_cross_workspace_target_without_local_binding() {
    let state = AppState::default();
    state
        .task_service
        .upsert_route_binding(ChannelRouteBinding {
            workspace_id: "ws-stale".to_string(),
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

    let error = align_route_with_resolved_workspace(
        &state,
        &ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_kind: ExternalPeerKind::Direct,
            peer_id: "user-1".to_string(),
            sender_id: "user-1".to_string(),
            sender_name: None,
            message_id: "msg-1".to_string(),
            text: "hello".to_string(),
            idempotency_key: None,
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: serde_json::json!({}),
        },
        &ExternalRouteResolution {
            workspace_id: "ws-stale".to_string(),
            target_agent_id: "role:build".to_string(),
            matched_by: "binding.account".to_string(),
        },
        "ws-current",
    )
    .expect_err("mismatched route should fail");

    assert!(error.contains("CHANNEL_ROUTE_WORKSPACE_MISMATCH"));
}

#[test]
fn validate_binding_target_selector_accepts_existing_agent_and_role_targets() {
    let repo = temp_agent_repo("existing-agent");
    seed_workspace_agent(&repo, "ws-1", "agent-1");

    validate_binding_target_selector(&repo, "ws-1", "agent-1")
        .expect("direct agent target should be accepted");
    validate_binding_target_selector(&repo, "ws-1", "role:analyst")
        .expect("role selector should be accepted");
}

#[test]
fn validate_binding_target_selector_rejects_missing_direct_agent() {
    let repo = temp_agent_repo("missing-agent");
    repo.seed_defaults(gt_agent::GLOBAL_ROLE_WORKSPACE_ID)
        .expect("seed global roles");
    repo.seed_defaults("ws-1").expect("seed workspace roles");

    let error = validate_binding_target_selector(&repo, "ws-1", "agent-missing")
        .expect_err("missing direct target should be rejected");

    assert!(error.contains("CHANNEL_TARGET_NOT_AVAILABLE"));
}
