use super::{
    codex_event_text, find_command_in_dir, normalize_executable_path, nvm_bin_dirs,
    resolve_cli_candidate, runtime_supports_structured_relay, split_text_for_channel,
    AgentRuntimeRegistration, AgentToolKind,
};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

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
        online: true,
    }
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
