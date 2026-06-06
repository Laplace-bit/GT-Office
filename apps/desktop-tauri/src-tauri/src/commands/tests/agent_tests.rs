use std::{fs, path::PathBuf};

use crate::app_state::AppState;
use gt_abstractions::WorkspaceService;
use gt_agent::{AgentProfile, AgentRepository, AgentState};
use gt_storage::{SqliteAgentRepository, SqliteStorage};
use gt_task::{ChannelRouteBinding, ExternalPeerKind, TaskService};
use uuid::Uuid;

use super::{
    agent_create_with_repo, agent_delete_with_repo, agent_prompt_read_with_repo,
    agent_update_with_repo,
    binding_cleanup::{
        apply_direct_agent_binding_cleanup, collect_direct_agent_binding_dependencies,
        DirectBindingCleanupMode,
    },
    normalize_relative_workdir, parse_agent_state, parse_role_scope, parse_role_status,
    read_prompt_file, resolve_agent_tool, resolve_prompt_file_name,
    resolve_update_agent_prompt_file_name, resolve_update_agent_tool, role_scope_workspace_id,
    seed_agent_defaults, should_write_prompt_file_on_update, write_prompt_file, AgentCreateRequest,
    AgentDeleteRequest, AgentPromptReadRequest, AgentUpdateRequest,
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

struct AgentCommandFixture {
    _temp_dir: TempDir,
    state: AppState,
    repo: SqliteAgentRepository,
    workspace_id: String,
    workspace_root: PathBuf,
    role_id: String,
}

impl AgentCommandFixture {
    fn create() -> Self {
        let temp_dir = TempDir::create();
        let workspace_root = temp_dir.path().join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).expect("create workspace root");

        let state = AppState::default();
        let workspace_id = state
            .workspace_service
            .open(&workspace_root)
            .expect("open workspace")
            .workspace_id
            .to_string();
        let repo = SqliteAgentRepository::new(
            SqliteStorage::new(temp_dir.path().join("agent-tests.db"))
                .expect("create test storage"),
        );
        repo.ensure_schema().expect("ensure agent schema");
        seed_agent_defaults(&repo, &workspace_id).expect("seed agent defaults");
        let role_id = repo
            .list_roles(&workspace_id)
            .expect("list roles")
            .into_iter()
            .find(|role| role.role_key == "generator")
            .expect("generator role")
            .id;

        Self {
            _temp_dir: temp_dir,
            state,
            repo,
            workspace_id,
            workspace_root,
            role_id,
        }
    }

    fn create_request(&self, name: &str) -> AgentCreateRequest {
        AgentCreateRequest {
            workspace_id: self.workspace_id.clone(),
            agent_id: None,
            name: name.to_string(),
            role_id: self.role_id.clone(),
            tool: Some("codex".to_string()),
            workdir: Some(".".to_string()),
            custom_workdir: Some(false),
            employee_no: None,
            state: Some("ready".to_string()),
            prompt_enabled: Some(false),
            prompt_file_name: None,
            prompt_content: None,
            launch_command: None,
        }
    }
}

#[test]
fn agent_create_succeeds_with_readonly_existing_root_prompt_when_content_is_unchanged() {
    let fixture = AgentCommandFixture::create();
    let prompt_path = fixture.workspace_root.join("AGENTS.md");
    let prompt_content = "# shared workspace prompt\n".to_string();
    fs::write(&prompt_path, &prompt_content).expect("write shared prompt");
    let mut readonly_permissions = fs::metadata(&prompt_path)
        .expect("stat prompt")
        .permissions();
    readonly_permissions.set_readonly(true);
    fs::set_permissions(&prompt_path, readonly_permissions).expect("set readonly prompt");

    let mut request = fixture.create_request("Readonly Prompt Agent");
    request.prompt_enabled = Some(true);
    request.prompt_content = Some(prompt_content.clone());

    let response = agent_create_with_repo(request, &fixture.repo, &fixture.workspace_root);

    let mut writable_permissions = fs::metadata(&prompt_path)
        .expect("stat readonly prompt")
        .permissions();
    writable_permissions.set_readonly(false);
    fs::set_permissions(&prompt_path, writable_permissions).expect("restore prompt permissions");

    let response = response.expect("create agent with unchanged prompt");
    let agent_id = response["agent"]["id"]
        .as_str()
        .expect("response agent id")
        .to_string();
    let agents = fixture
        .repo
        .list_agents(&fixture.workspace_id)
        .expect("list agents after create");
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, agent_id);
    assert_eq!(agents[0].workdir.as_deref(), Some("."));
    assert_eq!(
        fs::read_to_string(&prompt_path).expect("read shared prompt"),
        prompt_content
    );
}

#[test]
fn agent_create_rolls_back_when_prompt_write_fails() {
    let fixture = AgentCommandFixture::create();
    let prompt_directory = fixture.workspace_root.join("AGENTS.md");
    fs::create_dir_all(&prompt_directory).expect("create prompt directory collision");

    let mut request = fixture.create_request("Broken Prompt Agent");
    request.prompt_enabled = Some(true);
    request.prompt_content = Some("prompt".to_string());

    let error = agent_create_with_repo(request, &fixture.repo, &fixture.workspace_root)
        .expect_err("create should fail when prompt path is unreadable");
    assert!(error.starts_with("AGENT_PROMPT_READ_FAILED:"));
    assert!(fixture
        .repo
        .list_agents(&fixture.workspace_id)
        .expect("list agents after failed create")
        .is_empty());
}

#[test]
fn agent_update_moves_prompt_file_and_prompt_read_returns_latest_content() {
    let fixture = AgentCommandFixture::create();
    let mut create_request = fixture.create_request("Prompt Update Agent");
    create_request.tool = Some("codex".to_string());
    create_request.workdir = Some(".gtoffice/research".to_string());
    create_request.custom_workdir = Some(true);
    create_request.prompt_enabled = Some(true);
    create_request.prompt_content = Some("original prompt".to_string());

    let create_response =
        agent_create_with_repo(create_request, &fixture.repo, &fixture.workspace_root)
            .expect("create agent for update");
    let agent_id = create_response["agent"]["id"]
        .as_str()
        .expect("created agent id")
        .to_string();
    let original_prompt_path = fixture.workspace_root.join(".gtoffice/research/AGENTS.md");
    assert_eq!(
        fs::read_to_string(&original_prompt_path).expect("read original prompt"),
        "original prompt"
    );

    let update_response = agent_update_with_repo(
        AgentUpdateRequest {
            workspace_id: fixture.workspace_id.clone(),
            agent_id: agent_id.clone(),
            name: "Prompt Update Agent".to_string(),
            role_id: fixture.role_id.clone(),
            tool: Some("claude".to_string()),
            workdir: Some(".gtoffice/research".to_string()),
            custom_workdir: Some(true),
            employee_no: None,
            state: Some("ready".to_string()),
            prompt_enabled: Some(true),
            prompt_file_name: None,
            prompt_content: Some("updated prompt".to_string()),
            launch_command: Some("claude".to_string()),
        },
        &fixture.repo,
        &fixture.workspace_root,
    )
    .expect("update agent prompt");

    assert_eq!(
        update_response["agent"]["launchCommand"].as_str(),
        Some("claude")
    );
    assert!(!original_prompt_path.exists());
    let updated_prompt_path = fixture.workspace_root.join(".gtoffice/research/CLAUDE.md");
    assert_eq!(
        fs::read_to_string(&updated_prompt_path).expect("read updated prompt"),
        "updated prompt"
    );

    let prompt_read_response = agent_prompt_read_with_repo(
        AgentPromptReadRequest {
            workspace_id: fixture.workspace_id.clone(),
            agent_id: agent_id.clone(),
        },
        &fixture.repo,
        &fixture.workspace_root,
    )
    .expect("read prompt after update");
    assert_eq!(
        prompt_read_response["promptFileName"].as_str(),
        Some("CLAUDE.md")
    );
    assert_eq!(
        prompt_read_response["promptFileRelativePath"].as_str(),
        Some(".gtoffice/research/CLAUDE.md")
    );
    assert_eq!(
        prompt_read_response["promptContent"].as_str(),
        Some("updated prompt")
    );
}

#[test]
fn agent_delete_removes_agent_record() {
    let fixture = AgentCommandFixture::create();
    let create_response = agent_create_with_repo(
        fixture.create_request("Delete Agent"),
        &fixture.repo,
        &fixture.workspace_root,
    )
    .expect("create agent for delete");
    let agent_id = create_response["agent"]["id"]
        .as_str()
        .expect("created agent id")
        .to_string();

    let delete_response = agent_delete_with_repo(
        AgentDeleteRequest {
            workspace_id: fixture.workspace_id.clone(),
            agent_id: agent_id.clone(),
            cleanup_mode: None,
            replacement_agent_id: None,
        },
        &fixture.state,
        &fixture.repo,
        || Ok(()),
    )
    .expect("delete agent");

    assert_eq!(delete_response["deleted"].as_bool(), Some(true));
    assert!(fixture
        .repo
        .list_agents(&fixture.workspace_id)
        .expect("list agents after delete")
        .is_empty());
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
        resolve_update_agent_tool("Codex CLI", Some("   ".to_string())),
        "codex"
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
        resolve_update_agent_prompt_file_name("Claude Code", None, Some("AGENTS.md"), None),
        Some("AGENTS.md".to_string())
    );
    assert_eq!(
        resolve_update_agent_prompt_file_name("Claude Code", None, Some("CLAUDE.md"), Some("   ")),
        Some("CLAUDE.md".to_string())
    );
}

#[test]
fn update_uses_requested_prompt_file_name_when_present() {
    assert_eq!(
        resolve_update_agent_prompt_file_name(
            "Claude Code",
            None,
            Some("CLAUDE.md"),
            Some("AGENTS.md"),
        ),
        Some("AGENTS.md".to_string())
    );
}

#[test]
fn update_uses_new_default_prompt_file_name_when_tool_changes() {
    assert_eq!(
        resolve_update_agent_prompt_file_name(
            "Claude Code",
            Some("Codex CLI"),
            Some("CLAUDE.md"),
            None
        ),
        Some("AGENTS.md".to_string())
    );
}

#[test]
fn update_skips_prompt_write_when_prompt_inputs_are_omitted() {
    assert!(!should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("AGENTS.md"),
        None,
        None,
        true,
    ));
    assert!(!should_write_prompt_file_on_update(
        "Codex CLI",
        Some("   "),
        Some("AGENTS.md"),
        Some("   "),
        None,
        true,
    ));
}

#[test]
fn update_does_not_write_prompt_file_when_prompt_is_disabled() {
    assert!(!should_write_prompt_file_on_update(
        "Claude Code",
        Some("Codex CLI"),
        Some("CLAUDE.md"),
        None,
        Some("updated prompt"),
        false,
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
        true,
    ));
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("CLAUDE.md"),
        Some("AGENTS.md"),
        None,
        true,
    ));
}

#[test]
fn update_requires_prompt_write_when_tool_changes_prompt_file_name() {
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        Some("Codex CLI"),
        Some("CLAUDE.md"),
        None,
        None,
        true,
    ));
    assert!(!should_write_prompt_file_on_update(
        "Claude Code",
        Some("claude"),
        Some("CLAUDE.md"),
        None,
        None,
        true,
    ));
    assert!(should_write_prompt_file_on_update(
        "Claude Code",
        None,
        Some("CLAUDE.md"),
        None,
        Some(""),
        true,
    ));
}

#[test]
fn update_omitting_prompt_inputs_does_not_overwrite_existing_custom_prompt_file() {
    let temp_dir = TempDir::create();
    let workspace_root = temp_dir.path().clone();
    let workdir = ".gtoffice/agent-alpha";
    fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
    let agents_prompt_path = workspace_root.join(workdir).join("AGENTS.md");

    write_prompt_file(
        &workspace_root,
        workdir,
        "claude",
        Some("AGENTS.md"),
        Some("custom prompt".to_string()),
    )
    .unwrap();

    let initial_content = fs::read_to_string(&agents_prompt_path).unwrap();
    assert_eq!(initial_content, "custom prompt");

    if should_write_prompt_file_on_update("Claude Code", None, Some("AGENTS.md"), None, None, true)
    {
        write_prompt_file(&workspace_root, workdir, "claude", Some("AGENTS.md"), None).unwrap();
    }

    assert_eq!(
        fs::read_to_string(agents_prompt_path).unwrap(),
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
        workdir,
        "claude",
        Some("AGENTS.md"),
        Some("custom prompt".to_string()),
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
    let resolved_prompt_file_name = resolve_update_agent_prompt_file_name(
        agent.tool.as_str(),
        None,
        existing_prompt_file_name.as_deref(),
        None,
    );

    write_prompt_file(
        &workspace_root,
        workdir,
        "claude",
        resolved_prompt_file_name.as_deref(),
        Some("updated prompt".to_string()),
    )
    .unwrap();

    let agents_prompt_path = workspace_root.join(workdir).join("AGENTS.md");
    assert_eq!(
        fs::read_to_string(agents_prompt_path).unwrap(),
        "updated prompt"
    );
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
}

#[test]
fn rejects_unsupported_prompt_file_name_overrides() {
    assert_eq!(
        resolve_prompt_file_name("codex", Some("README.md")).unwrap_err(),
        "AGENT_PROMPT_FILE_INVALID: README.md"
    );
}

#[test]
fn normalize_relative_workdir_accepts_workspace_root_and_rejects_absolute_paths() {
    assert_eq!(normalize_relative_workdir("."), Some(".".to_string()));
    assert_eq!(normalize_relative_workdir(""), Some(".".to_string()));
    assert_eq!(
        normalize_relative_workdir("nested/agent"),
        Some("nested/agent".to_string())
    );
    assert_eq!(normalize_relative_workdir("/tmp/agent"), None);
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
