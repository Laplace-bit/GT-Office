use super::{
    align_route_with_resolved_workspace, channel_supports_external_reply, codex_event_text,
    find_command_in_dir, gemini_event_text, migrate_legacy_wechat_access_policies,
    normalize_executable_path, nvm_bin_dirs, resolve_cli_candidate,
    runtime_supports_structured_relay, split_text_for_channel, validate_binding_target_selector,
    AgentRuntimeRegistration, AgentToolKind, PersistedChannelAccessPolicy,
    PersistedChannelStateFile, PersistedRouteBindingRecord,
};
use gt_agent::{AgentRepository, AgentState, CreateAgentInput};
use gt_storage::{SqliteAgentRepository, SqliteStorage};
use gt_task::{
    ChannelRouteBinding, ExternalInboundMessage, ExternalPeerKind, ExternalRouteResolution,
};
use std::path::PathBuf;
use std::{collections::HashSet, fs};
use uuid::Uuid;

use crate::app_state::AppState;

fn sample_runtime(
    tool_kind: AgentToolKind,
    resolved_cwd: Option<&str>,
) -> AgentRuntimeRegistration {
    AgentRuntimeRegistration {
        workspace_id: "ws-1".to_string(),
        agent_id: "agent-01".to_string(),
        station_id: "agent-01".to_string(),
        role_key: Some("product".to_string()),
        session_id: "ts-1".to_string(),
        tool_kind,
        resolved_cwd: resolved_cwd.map(str::to_string),
        submit_sequence: Some("\r".to_string()),
        provider_session: None,
        online: true,
    }
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
        .find(|role| role.role_key == "product")
        .expect("product role")
        .id;
    repo.create_agent(CreateAgentInput {
        workspace_id: workspace_id.to_string(),
        agent_id: Some(agent_id.to_string()),
        name: "Agent Product".to_string(),
        role_id,
        tool: "codex".to_string(),
        workdir: Some(".gtoffice/agent-product".to_string()),
        custom_workdir: false,
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
    assert!(runtime_supports_structured_relay(&sample_runtime(
        AgentToolKind::Gemini,
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
fn gemini_event_text_extracts_delta_from_parts() {
    let payload = serde_json::json!({
        "type": "content_delta",
        "delta": true,
        "content": {
            "parts": [
                { "text": "stream " }
            ]
        }
    });

    let parsed = gemini_event_text(&payload);
    assert_eq!(parsed, Some(("stream ".to_string(), false)));
}

#[test]
fn gemini_event_text_extracts_final_response() {
    let payload = serde_json::json!({
        "type": "result",
        "response": "hello from gemini"
    });

    let parsed = gemini_event_text(&payload);
    assert_eq!(parsed, Some(("hello from gemini".to_string(), true)));
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
    validate_binding_target_selector(&repo, "ws-1", "role:manager")
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
