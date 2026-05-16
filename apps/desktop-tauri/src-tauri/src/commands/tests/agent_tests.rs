use std::{fs, path::PathBuf};

use gt_agent::{AgentProfile, AgentState};
use gt_task::{ChannelRouteBinding, ExternalPeerKind, TaskService};
use uuid::Uuid;

use super::{
    binding_cleanup::{
        apply_direct_agent_binding_cleanup, collect_direct_agent_binding_dependencies,
        DirectBindingCleanupMode,
    },
    parse_agent_state, parse_role_scope, parse_role_status, read_prompt_file, resolve_agent_tool,
    resolve_prompt_file_name, resolve_update_agent_prompt_file_name, resolve_update_agent_tool,
    role_scope_workspace_id, should_write_prompt_file_on_update, write_prompt_file,
};

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn create() -> Self {
        let path = std::env::temp_dir().join(format!("gtoffice-agent-cmd-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &PathBuf {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn existing_agent_helpers_still_normalize_defaults() {
    assert_eq!(parse_agent_state(None).unwrap().as_str(), "ready");
    assert_eq!(
        resolve_agent_tool(Some("Claude Code".to_string())),
        "claude"
    );
    assert_eq!(parse_role_scope(Some("global")).as_str(), "global");
    assert_eq!(
        role_scope_workspace_id(&parse_role_scope(None), "ws-1"),
        "ws-1"
    );
}

#[test]
fn parses_role_status_values_for_cli_surface() {
    assert_eq!(parse_role_status(None).unwrap().as_str(), "active");
    assert_eq!(
        parse_role_status(Some("deprecated".to_string()))
            .unwrap()
            .as_str(),
        "deprecated"
    );
    assert_eq!(
        parse_role_status(Some("disabled".to_string()))
            .unwrap()
            .as_str(),
        "disabled"
    );
}

#[test]
fn rejects_unsupported_role_status_values() {
    assert_eq!(
        parse_role_status(Some("archived".to_string())).unwrap_err(),
        "AGENT_ROLE_STATUS_INVALID: archived"
    );
}

#[test]
fn update_preserves_existing_tool_when_request_omits_it() {
    assert_eq!(resolve_update_agent_tool("Claude Code", None), "claude");
    assert_eq!(
        resolve_update_agent_tool("Gemini CLI", Some("   ".to_string())),
        "gemini"
    );
}

#[test]
fn update_uses_requested_tool_when_present() {
    assert_eq!(
        resolve_update_agent_tool("Claude Code", Some("Codex CLI".to_string())),
        "codex"
    );
}

#[test]
fn update_preserves_existing_prompt_file_name_when_request_omits_it() {
    assert_eq!(
        resolve_update_agent_prompt_file_name(Some("GEMINI.md"), None),
        Some("GEMINI.md".to_string())
    );
    assert_eq!(
        resolve_update_agent_prompt_file_name(Some("CLAUDE.md"), Some("   ")),
        Some("CLAUDE.md".to_string())
    );
}

#[test]
fn update_uses_requested_prompt_file_name_when_present() {
    assert_eq!(
        resolve_update_agent_prompt_file_name(Some("CLAUDE.md"), Some("AGENTS.md")),
        Some("AGENTS.md".to_string())
    );
}

#[test]
fn update_skips_prompt_write_when_prompt_inputs_are_omitted() {
    assert!(!should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("GEMINI.md"),
        None,
        None,
    ));
    assert!(!should_write_prompt_file_on_update(
        "Gemini CLI",
        Some("   "),
        Some("GEMINI.md"),
        Some("   "),
        Some("   "),
    ));
}

#[test]
fn update_requires_prompt_write_for_explicit_content_or_prompt_file_override() {
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("CLAUDE.md"),
        None,
        Some("updated prompt"),
    ));
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("CLAUDE.md"),
        Some("AGENTS.md"),
        None,
    ));
}

#[test]
fn update_requires_prompt_write_when_tool_changes_prompt_file_name() {
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        Some("Gemini CLI"),
        Some("CLAUDE.md"),
        None,
        None,
    ));
    assert!(!should_write_prompt_file_on_update(
        "Claude Code",
        Some("claude"),
        Some("CLAUDE.md"),
        None,
        None,
    ));
}

#[test]
fn update_omitting_prompt_inputs_does_not_overwrite_existing_custom_prompt_file() {
    let temp_dir = TempDir::create();
    let workspace_root = temp_dir.path().clone();
    let workdir = ".gtoffice/agent-alpha";
    fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
    let custom_prompt_path = workspace_root.join(workdir).join("GEMINI.md");

    write_prompt_file(
        &workspace_root,
        "Agent Alpha",
        workdir,
        "claude",
        Some("GEMINI.md"),
        Some("custom prompt".to_string()),
        None,
    )
    .unwrap();

    let initial_content = fs::read_to_string(&custom_prompt_path).unwrap();
    assert_eq!(initial_content, "custom prompt");

    if should_write_prompt_file_on_update("Claude Code", None, Some("GEMINI.md"), None, None) {
        write_prompt_file(
            &workspace_root,
            "Agent Alpha",
            workdir,
            "claude",
            Some("GEMINI.md"),
            None,
            None,
        )
        .unwrap();
    }

    assert_eq!(
        fs::read_to_string(custom_prompt_path).unwrap(),
        "custom prompt"
    );
}

#[test]
fn update_preserves_existing_prompt_file_override_through_prompt_read_and_write() {
    let temp_dir = TempDir::create();
    let workspace_root = temp_dir.path().clone();
    let workdir = ".gtoffice/agent-alpha";
    fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();

    write_prompt_file(
        &workspace_root,
        "Agent Alpha",
        workdir,
        "claude",
        Some("GEMINI.md"),
        Some("custom prompt".to_string()),
        None,
    )
    .unwrap();

    let agent = AgentProfile {
        id: "agent-1".to_string(),
        workspace_id: "ws-1".to_string(),
        name: "Agent Alpha".to_string(),
        role_id: "role-1".to_string(),
        tool: "Claude Code".to_string(),
        workdir: Some(workdir.to_string()),
        custom_workdir: false,
        state: AgentState::Ready,
        employee_no: None,
        policy_snapshot_id: None,
        prompt_file_name: Some("CLAUDE.md".to_string()),
        prompt_file_relative_path: Some(format!("{workdir}/CLAUDE.md")),
        launch_command: None,
        order_index: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    };

    let (_, existing_prompt_file_name, _) = read_prompt_file(&workspace_root, &agent).unwrap();
    let resolved_prompt_file_name =
        resolve_update_agent_prompt_file_name(existing_prompt_file_name.as_deref(), None);

    write_prompt_file(
        &workspace_root,
        "Agent Alpha",
        workdir,
        "claude",
        resolved_prompt_file_name.as_deref(),
        Some("updated prompt".to_string()),
        None,
    )
    .unwrap();

    let gemini_path = workspace_root.join(workdir).join("GEMINI.md");
    assert_eq!(fs::read_to_string(gemini_path).unwrap(), "updated prompt");
}

#[test]
fn accepts_supported_prompt_file_name_overrides() {
    assert_eq!(
        resolve_prompt_file_name("claude", None).unwrap(),
        Some("CLAUDE.md".to_string())
    );
    assert_eq!(
        resolve_prompt_file_name("codex", Some("AGENTS.md")).unwrap(),
        Some("AGENTS.md".to_string())
    );
    assert_eq!(
        resolve_prompt_file_name("gemini", Some(" GEMINI.md ")).unwrap(),
        Some("GEMINI.md".to_string())
    );
}

#[test]
fn rejects_unsupported_prompt_file_name_overrides() {
    assert_eq!(
        resolve_prompt_file_name("codex", Some("README.md")).unwrap_err(),
        "AGENT_PROMPT_FILE_INVALID: README.md"
    );
}

#[test]
fn collect_direct_agent_binding_dependencies_ignores_roles_and_other_workspaces() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-1".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-1".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-1".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: Some("manager-*".to_string()),
        target_agent_id: "role:manager".to_string(),
        priority: 90,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-2".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-1".to_string(),
        priority: 80,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let bindings = collect_direct_agent_binding_dependencies(&service, "ws-1", "agent-1");

    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].target_agent_id, "agent-1");
    assert_eq!(bindings[0].workspace_id, "ws-1");
}

#[test]
fn apply_direct_agent_binding_cleanup_can_disable_and_rebind_matches() {
    let service = TaskService::default();
    let original = ChannelRouteBinding {
        workspace_id: "ws-1".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-1".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    };
    service.upsert_route_binding(original.clone());

    let disabled = apply_direct_agent_binding_cleanup(
        &service,
        "ws-1",
        "agent-1",
        DirectBindingCleanupMode::Disable,
    )
    .expect("disable cleanup");
    assert_eq!(disabled.matched_count, 1);

    let after_disable = service.list_route_bindings(Some("ws-1"));
    assert_eq!(after_disable.len(), 1);
    assert!(!after_disable[0].enabled);

    service.upsert_route_binding(original);
    let rebound = apply_direct_agent_binding_cleanup(
        &service,
        "ws-1",
        "agent-1",
        DirectBindingCleanupMode::Rebind {
            replacement_agent_id: "agent-2".to_string(),
        },
    )
    .expect("rebind cleanup");
    assert_eq!(rebound.matched_count, 1);

    let after_rebind = service.list_route_bindings(Some("ws-1"));
    assert_eq!(after_rebind.len(), 1);
    assert_eq!(after_rebind[0].target_agent_id, "agent-2");
    assert!(after_rebind[0].enabled);
}
