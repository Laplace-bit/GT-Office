use std::path::{Path, PathBuf};

use gt_abstractions::{WorkspaceId, WorkspaceService};
use gt_agent::{
    default_agent_workdir, normalize_agent_slug, prompt_file_name_for_tool, AgentProfile,
    AgentRepository, AgentRole, AgentRoleScope, AgentState, CreateAgentInput, UpdateAgentInput,
    DEFAULT_ROLES, GLOBAL_ROLE_WORKSPACE_ID,
};
use gt_storage::{SqliteAgentRepository, SqliteStorage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::app_state::AppState;

pub(crate) mod binding_cleanup;

use binding_cleanup::{
    apply_direct_agent_binding_cleanup, collect_direct_agent_binding_dependencies,
    DirectBindingCleanupMode,
};

fn to_command_error(error: impl ToString) -> String {
    error.to_string()
}

fn ensure_workspace_exists(state: &AppState, workspace_id: &str) -> Result<(), String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .workspace_service
        .get_context(&workspace_id)
        .map(|_| ())
        .map_err(to_command_error)
}

fn get_workspace_root(state: &AppState, workspace_id: &str) -> Result<PathBuf, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let context = state
        .workspace_service
        .get_context(&workspace_id)
        .map_err(to_command_error)?;
    Ok(PathBuf::from(context.root))
}

fn resolve_agent_repository<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<SqliteAgentRepository, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    let db_path = base_dir.join("gtoffice.db");
    let storage = SqliteStorage::new(db_path).map_err(to_command_error)?;
    Ok(SqliteAgentRepository::new(storage))
}

pub(crate) fn seed_agent_defaults(
    repo: &SqliteAgentRepository,
    workspace_id: &str,
) -> Result<(), String> {
    repo.seed_defaults(GLOBAL_ROLE_WORKSPACE_ID)
        .map_err(to_command_error)?;
    repo.seed_defaults(workspace_id).map_err(to_command_error)
}

pub(crate) fn parse_agent_state(value: Option<String>) -> Result<AgentState, String> {
    match value.as_deref().map(str::trim) {
        None => Ok(AgentState::Ready),
        Some("ready") => Ok(AgentState::Ready),
        Some("paused") => Ok(AgentState::Paused),
        Some("blocked") => Ok(AgentState::Blocked),
        Some("terminated") => Ok(AgentState::Terminated),
        Some(other) => Err(format!("AGENT_STATE_INVALID: {other}")),
    }
}

pub(crate) fn parse_role_scope(value: Option<&str>) -> AgentRoleScope {
    match value.map(str::trim) {
        Some("global") => AgentRoleScope::Global,
        _ => AgentRoleScope::Workspace,
    }
}

pub(crate) fn parse_role_status(value: Option<String>) -> Result<gt_agent::RoleStatus, String> {
    match value.as_deref().map(str::trim) {
        None => Ok(gt_agent::RoleStatus::Active),
        Some("active") => Ok(gt_agent::RoleStatus::Active),
        Some("deprecated") => Ok(gt_agent::RoleStatus::Deprecated),
        Some("disabled") => Ok(gt_agent::RoleStatus::Disabled),
        Some(other) => Err(format!("AGENT_ROLE_STATUS_INVALID: {other}")),
    }
}

fn parse_direct_binding_cleanup_mode(
    value: Option<&str>,
    replacement_agent_id: Option<&str>,
) -> Result<Option<DirectBindingCleanupMode>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    match value {
        "reject" => Ok(None),
        "disable" => Ok(Some(DirectBindingCleanupMode::Disable)),
        "delete" => Ok(Some(DirectBindingCleanupMode::Delete)),
        "rebind" => {
            let replacement_agent_id = replacement_agent_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "CHANNEL_BINDING_REPLACEMENT_AGENT_INVALID: replacementAgentId is required"
                        .to_string()
                })?;
            if replacement_agent_id.starts_with("role:") {
                return Err(
                    "CHANNEL_BINDING_REPLACEMENT_AGENT_INVALID: replacementAgentId must be a direct agent id"
                        .to_string(),
                );
            }
            Ok(Some(DirectBindingCleanupMode::Rebind {
                replacement_agent_id: replacement_agent_id.to_string(),
            }))
        }
        other => Err(format!("AGENT_DELETE_CLEANUP_MODE_INVALID: {other}")),
    }
}

pub(crate) fn role_scope_workspace_id(scope: &AgentRoleScope, workspace_id: &str) -> String {
    match scope {
        AgentRoleScope::Global => GLOBAL_ROLE_WORKSPACE_ID.to_string(),
        AgentRoleScope::Workspace => workspace_id.to_string(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestorableSystemRoleSummary {
    role_id: String,
    role_key: String,
    role_name: String,
}

pub(crate) fn normalize_relative_workdir(value: &str) -> Option<String> {
    let normalized = value.trim().replace('\\', "/").replace("/./", "/");
    if normalized.starts_with('/') || normalized.starts_with('~') || normalized.contains(':') {
        return None;
    }
    let normalized = normalized.trim_matches('/').to_string();
    if normalized.is_empty() || normalized == "." {
        return Some(".".to_string());
    }
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    if segments.is_empty() || segments.contains(&"..") {
        return None;
    }
    Some(segments.join("/"))
}

pub(crate) fn resolve_agent_tool(tool: Option<String>) -> String {
    let normalized = tool.unwrap_or_else(|| "codex".to_string());
    let lowered = normalized.trim().to_ascii_lowercase();
    if lowered.contains("claude") {
        "claude".to_string()
    } else {
        "codex".to_string()
    }
}

pub(crate) fn resolve_update_agent_tool(
    existing_tool: &str,
    requested_tool: Option<String>,
) -> String {
    match requested_tool
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(_) => resolve_agent_tool(requested_tool),
        None => resolve_agent_tool(Some(existing_tool.to_string())),
    }
}

pub(crate) fn resolve_update_agent_prompt_file_name(
    existing_tool: &str,
    requested_tool: Option<&str>,
    existing_prompt_file_name: Option<&str>,
    requested_prompt_file_name: Option<&str>,
) -> Option<String> {
    if let Some(requested_file_name) = requested_prompt_file_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(requested_file_name.to_string());
    }

    let resolved_existing_tool = resolve_agent_tool(Some(existing_tool.to_string()));
    let resolved_requested_tool = requested_tool
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| resolve_agent_tool(Some(value.to_string())))
        .unwrap_or_else(|| resolved_existing_tool.clone());
    let existing_default = prompt_file_name_for_tool(resolved_existing_tool.as_str());

    match existing_prompt_file_name {
        Some(existing_file_name) if Some(existing_file_name) != existing_default => {
            Some(existing_file_name.to_string())
        }
        _ => prompt_file_name_for_tool(resolved_requested_tool.as_str()).map(str::to_string),
    }
}

pub(crate) fn should_write_prompt_file_on_update(
    existing_tool: &str,
    requested_tool: Option<&str>,
    _existing_prompt_file_name: Option<&str>,
    requested_prompt_file_name: Option<&str>,
    prompt_content: Option<&str>,
    prompt_enabled: bool,
) -> bool {
    if !prompt_enabled {
        return false;
    }

    let requested_tool = requested_tool
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let requested_prompt_file_name = requested_prompt_file_name
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if prompt_content.is_some() || requested_prompt_file_name.is_some() {
        return true;
    }

    let Some(requested_tool) = requested_tool else {
        return false;
    };

    let resolved_existing_tool = resolve_agent_tool(Some(existing_tool.to_string()));
    let resolved_requested_tool = resolve_agent_tool(Some(requested_tool.to_string()));
    resolved_existing_tool != resolved_requested_tool
}

fn resolve_agent_workdir(
    name: &str,
    workdir: Option<String>,
    custom_workdir: bool,
) -> Result<(String, bool), String> {
    let default_workdir = default_agent_workdir(name);
    if custom_workdir {
        let requested = workdir
            .as_deref()
            .and_then(normalize_relative_workdir)
            .ok_or_else(|| "AGENT_WORKDIR_INVALID".to_string())?;
        if requested == default_workdir {
            return Ok((default_workdir, false));
        }
        return Ok((requested, true));
    }
    Ok((default_workdir, false))
}

fn ensure_path_within_workspace(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_relative_workdir(relative_path)
        .ok_or_else(|| "AGENT_WORKDIR_INVALID".to_string())?;
    let joined = workspace_root.join(&normalized);
    let canonical_base = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let mut existing_ancestor = joined.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor.parent().unwrap_or(workspace_root);
        if existing_ancestor == workspace_root {
            break;
        }
    }
    let canonical_existing_ancestor = existing_ancestor
        .canonicalize()
        .unwrap_or_else(|_| existing_ancestor.to_path_buf());
    if !canonical_existing_ancestor.starts_with(&canonical_base) {
        return Err("AGENT_WORKDIR_OUTSIDE_WORKSPACE".to_string());
    }
    Ok(joined)
}

fn resolve_prompt_relative_path(workdir: &str, file_name: &str) -> String {
    let normalized_workdir = workdir.trim().trim_matches('/');
    if normalized_workdir.is_empty() || normalized_workdir == "." {
        return file_name.to_string();
    }
    format!("{normalized_workdir}/{file_name}")
}

fn ordered_prompt_file_candidates(tool: &str) -> Vec<&'static str> {
    let mut candidates = Vec::new();
    if let Some(default_file_name) = prompt_file_name_for_tool(tool) {
        candidates.push(default_file_name);
    }
    for candidate in ["CLAUDE.md", "AGENTS.md"] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

pub(crate) fn resolve_prompt_file_name(
    tool: &str,
    prompt_file_name: Option<&str>,
) -> Result<Option<String>, String> {
    let default = prompt_file_name_for_tool(tool).map(str::to_string);
    match prompt_file_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => Ok(default),
        Some(file_name @ ("CLAUDE.md" | "AGENTS.md")) => Ok(Some(file_name.to_string())),
        Some(other) => Err(format!("AGENT_PROMPT_FILE_INVALID: {other}")),
    }
}

pub(crate) fn write_prompt_file(
    workspace_root: &Path,
    workdir: &str,
    tool: &str,
    prompt_file_name: Option<&str>,
    prompt_content: Option<String>,
) -> Result<Option<(String, String)>, String> {
    let Some(file_name) = resolve_prompt_file_name(tool, prompt_file_name)? else {
        return Ok(None);
    };
    let relative_path = resolve_prompt_relative_path(workdir, &file_name);
    let absolute_path = ensure_path_within_workspace(workspace_root, &relative_path)?;
    let workdir_path = absolute_path
        .parent()
        .unwrap_or(workspace_root)
        .to_path_buf();
    std::fs::create_dir_all(&workdir_path)
        .map_err(|error| format!("AGENT_WORKDIR_CREATE_FAILED: {error}"))?;
    let content = prompt_content.unwrap_or_default();
    match std::fs::read_to_string(&absolute_path) {
        Ok(existing_content) if existing_content == content => {
            return Ok(Some((file_name, relative_path)));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("AGENT_PROMPT_READ_FAILED: {error}")),
    }
    std::fs::write(&absolute_path, content)
        .map_err(|error| format!("AGENT_PROMPT_WRITE_FAILED: {error}"))?;
    Ok(Some((file_name, relative_path)))
}

fn delete_prompt_file(workspace_root: &Path, relative_path: &str) -> Result<(), String> {
    let absolute_path = ensure_path_within_workspace(workspace_root, relative_path)?;
    match std::fs::remove_file(absolute_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("AGENT_PROMPT_DELETE_FAILED: {error}")),
    }
}

pub(crate) fn read_prompt_file(
    workspace_root: &Path,
    agent: &AgentProfile,
) -> Result<(String, Option<String>, Option<String>), String> {
    if let (Some(relative_path), Some(file_name)) = (
        agent.prompt_file_relative_path.as_deref(),
        agent.prompt_file_name.clone(),
    ) {
        let absolute_path = ensure_path_within_workspace(workspace_root, relative_path)?;
        if absolute_path.exists() {
            let content = std::fs::read_to_string(&absolute_path).unwrap_or_default();
            return Ok((content, Some(file_name), Some(relative_path.to_string())));
        }
    }

    if let Some(workdir) = agent.workdir.as_deref() {
        for candidate in ordered_prompt_file_candidates(agent.tool.as_str()) {
            let relative_path = resolve_prompt_relative_path(workdir, candidate);
            let absolute_path = ensure_path_within_workspace(workspace_root, &relative_path)?;
            if !absolute_path.exists() {
                continue;
            }
            let content = std::fs::read_to_string(&absolute_path).unwrap_or_default();
            return Ok((content, Some(candidate.to_string()), Some(relative_path)));
        }
    }

    Ok((String::new(), None, None))
}

fn find_agent(
    repo: &SqliteAgentRepository,
    workspace_id: &str,
    agent_id: &str,
) -> Result<AgentProfile, String> {
    repo.list_agents(workspace_id)
        .map_err(to_command_error)?
        .into_iter()
        .find(|agent| agent.id == agent_id)
        .ok_or_else(|| "AGENT_NOT_FOUND".to_string())
}

#[tauri::command]
pub fn agent_department_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    repo.seed_defaults(&workspace_id)
        .map_err(to_command_error)?;
    let departments = repo
        .list_departments(&workspace_id)
        .map_err(to_command_error)?;
    Ok(json!({ "departments": departments }))
}

#[tauri::command]
pub fn agent_role_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &workspace_id)?;
    let roles = repo.list_roles(&workspace_id).map_err(to_command_error)?;
    let deleted_ids = repo
        .list_deleted_system_role_seed_ids(GLOBAL_ROLE_WORKSPACE_ID)
        .map_err(to_command_error)?;
    let restorable_system_roles = DEFAULT_ROLES
        .iter()
        .filter(|role| deleted_ids.iter().any(|id| id == role.id))
        .map(|role| RestorableSystemRoleSummary {
            role_id: role.id.to_string(),
            role_key: role.role_key.to_string(),
            role_name: role.role_name.to_string(),
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "roles": roles,
        "restorableSystemRoles": restorable_system_roles,
    }))
}

#[tauri::command]
pub fn agent_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    let agents = repo.list_agents(&workspace_id).map_err(to_command_error)?;
    Ok(json!({ "agents": agents }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleSaveRequest {
    pub workspace_id: String,
    pub role_id: Option<String>,
    pub role_key: Option<String>,
    pub role_name: String,
    pub scope: Option<String>,
    pub status: Option<String>,
    pub charter_path: Option<String>,
    pub policy_json: Option<String>,
}

#[tauri::command]
pub fn agent_role_save(
    request: AgentRoleSaveRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let scope = parse_role_scope(request.scope.as_deref());
    let status = parse_role_status(request.status.clone())?;
    let role_workspace_id = role_scope_workspace_id(&scope, &request.workspace_id);
    let existing = request.role_id.as_deref().and_then(|role_id| {
        repo.list_roles(&request.workspace_id)
            .ok()
            .and_then(|roles| roles.into_iter().find(|role| role.id == role_id))
    });
    let role_key = request
        .role_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| existing.as_ref().map(|role| role.role_key.clone()))
        .unwrap_or_else(|| normalize_agent_slug(request.role_name.as_str()));
    let role = AgentRole {
        id: request
            .role_id
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        workspace_id: role_workspace_id.clone(),
        role_key,
        role_name: request.role_name.trim().to_string(),
        department_id: String::new(),
        scope: scope.clone(),
        charter_path: request
            .charter_path
            .filter(|value| !value.trim().is_empty())
            .or_else(|| existing.as_ref().and_then(|role| role.charter_path.clone())),
        policy_json: request
            .policy_json
            .filter(|value| !value.trim().is_empty())
            .or_else(|| existing.as_ref().and_then(|role| role.policy_json.clone())),
        version: existing.as_ref().map_or(1, |role| role.version + 1),
        status,
        is_system: existing.as_ref().is_some_and(|role| role.is_system),
        created_at_ms: existing.as_ref().map_or(0, |role| role.created_at_ms),
        updated_at_ms: 0,
    };
    let saved = repo
        .upsert_role(&role_workspace_id, role)
        .map_err(to_command_error)?;
    Ok(json!({ "role": saved }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleDeleteRequest {
    pub workspace_id: String,
    pub role_id: String,
    pub scope: Option<String>,
}

#[tauri::command]
pub fn agent_role_delete(
    request: AgentRoleDeleteRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let scope = parse_role_scope(request.scope.as_deref());
    let role_workspace_id = role_scope_workspace_id(&scope, &request.workspace_id);
    let roles = repo
        .list_roles(&request.workspace_id)
        .map_err(to_command_error)?;
    let target_role = roles
        .iter()
        .find(|role| role.id == request.role_id && role.workspace_id == role_workspace_id)
        .cloned()
        .ok_or_else(|| {
            "AGENT_ROLE_DELETE_NOT_FOUND: roleId was not found in the requested scope".to_string()
        })?;
    let blocking_agents = repo
        .list_agents(&request.workspace_id)
        .map_err(to_command_error)?
        .into_iter()
        .filter(|agent| agent.role_id == request.role_id)
        .collect::<Vec<_>>();
    let fallback_role = roles
        .iter()
        .find(|role| {
            role.id != target_role.id
                && role.role_key == target_role.role_key
                && role.status != gt_agent::RoleStatus::Disabled
        })
        .cloned();
    if !blocking_agents.is_empty() {
        if let Some(fallback_role) = fallback_role.clone() {
            let _ = repo
                .reassign_agents_role(
                    &request.workspace_id,
                    &target_role.id,
                    &fallback_role.id,
                    &fallback_role.workspace_id,
                )
                .map_err(to_command_error)?;
        } else {
            return Ok(json!({
                "deleted": false,
                "errorCode": "AGENT_ROLE_DELETE_BLOCKED_BY_ASSIGNED_AGENTS",
                "blockingAgents": blocking_agents,
            }));
        }
    }
    let deleted = repo
        .delete_role(&role_workspace_id, &request.role_id)
        .map_err(to_command_error)?;
    Ok(json!({
        "deleted": deleted,
        "fallbackRoleId": fallback_role.as_ref().map(|role| role.id.clone()),
        "fallbackRoleName": fallback_role.as_ref().map(|role| role.role_name.clone()),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleRestoreSystemRequest {
    pub workspace_id: String,
    pub role_id: String,
}

#[tauri::command]
pub fn agent_role_restore_system(
    request: AgentRoleRestoreSystemRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let restored = repo
        .restore_system_role(GLOBAL_ROLE_WORKSPACE_ID, &request.role_id)
        .map_err(to_command_error)?;
    match restored {
        Some(role) => Ok(json!({ "role": role })),
        None => Err("AGENT_ROLE_SYSTEM_RESTORE_INVALID: roleId is not a system preset".to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateRequest {
    pub workspace_id: String,
    pub agent_id: Option<String>,
    pub name: String,
    pub role_id: String,
    pub tool: Option<String>,
    pub workdir: Option<String>,
    pub custom_workdir: Option<bool>,
    pub employee_no: Option<String>,
    pub state: Option<String>,
    pub prompt_enabled: Option<bool>,
    pub prompt_file_name: Option<String>,
    pub prompt_content: Option<String>,
    pub launch_command: Option<String>,
}

pub(crate) fn agent_create_with_repo(
    request: AgentCreateRequest,
    repo: &SqliteAgentRepository,
    workspace_root: &Path,
) -> Result<Value, String> {
    let agent_state = parse_agent_state(request.state)?;
    let tool = resolve_agent_tool(request.tool);
    let name = request.name.trim().to_string();
    let prompt_enabled = request.prompt_enabled.unwrap_or(false);
    let (workdir, custom_workdir) = resolve_agent_workdir(
        name.as_str(),
        request.workdir,
        request.custom_workdir.unwrap_or(false),
    )?;
    ensure_path_within_workspace(workspace_root, &workdir)?;

    let input = CreateAgentInput {
        workspace_id: request.workspace_id.clone(),
        agent_id: request.agent_id,
        name: name.clone(),
        role_id: request.role_id,
        tool: tool.clone(),
        workdir: Some(workdir.clone()),
        custom_workdir,
        employee_no: request.employee_no,
        state: agent_state,
        launch_command: request.launch_command,
        order_index: None,
    };

    let agent = repo.create_agent(input).map_err(to_command_error)?;
    if prompt_enabled {
        if let Err(error) = write_prompt_file(
            workspace_root,
            workdir.as_str(),
            tool.as_str(),
            request.prompt_file_name.as_deref(),
            request.prompt_content,
        ) {
            let _ = repo.delete_agent(&request.workspace_id, &agent.id);
            return Err(error);
        }
    }
    let refreshed = find_agent(repo, &request.workspace_id, &agent.id)?;
    Ok(json!({ "agent": refreshed }))
}

fn agent_create_with_context<R: tauri::Runtime>(
    request: AgentCreateRequest,
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<Value, String> {
    ensure_workspace_exists(state, &request.workspace_id)?;
    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let workspace_root = get_workspace_root(state, &request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let response = agent_create_with_repo(request, &repo, &workspace_root)?;
    let _ = crate::local_bridge::refresh_directory_snapshot(app, state, &workspace_id);
    Ok(response)
}

#[tauri::command]
pub fn agent_create(
    request: AgentCreateRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    agent_create_with_context(request, state.inner(), &app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateRequest {
    pub workspace_id: String,
    pub agent_id: String,
    pub name: String,
    pub role_id: String,
    pub tool: Option<String>,
    pub workdir: Option<String>,
    pub custom_workdir: Option<bool>,
    pub employee_no: Option<String>,
    pub state: Option<String>,
    pub prompt_enabled: Option<bool>,
    pub prompt_file_name: Option<String>,
    pub prompt_content: Option<String>,
    pub launch_command: Option<String>,
}

pub(crate) fn agent_update_with_repo(
    request: AgentUpdateRequest,
    repo: &SqliteAgentRepository,
    workspace_root: &Path,
) -> Result<Value, String> {
    let existing_agent = find_agent(repo, &request.workspace_id, &request.agent_id)?;
    let agent_state = parse_agent_state(request.state)?;
    let tool = resolve_update_agent_tool(existing_agent.tool.as_str(), request.tool.clone());
    let name = request.name.trim().to_string();
    let (workdir, custom_workdir) = resolve_agent_workdir(
        name.as_str(),
        request.workdir,
        request.custom_workdir.unwrap_or(false),
    )?;
    ensure_path_within_workspace(workspace_root, &workdir)?;
    let (existing_prompt_content, existing_prompt_file_name, existing_prompt_file_relative_path) =
        read_prompt_file(workspace_root, &existing_agent)?;
    let prompt_enabled = request
        .prompt_enabled
        .unwrap_or(existing_prompt_file_name.is_some());
    let should_write_prompt = should_write_prompt_file_on_update(
        existing_agent.tool.as_str(),
        request.tool.as_deref(),
        existing_prompt_file_name.as_deref(),
        request.prompt_file_name.as_deref(),
        request.prompt_content.as_deref(),
        prompt_enabled,
    );
    let prompt_file_name = resolve_update_agent_prompt_file_name(
        existing_agent.tool.as_str(),
        request.tool.as_deref(),
        existing_prompt_file_name.as_deref(),
        request.prompt_file_name.as_deref(),
    );
    let input = UpdateAgentInput {
        workspace_id: request.workspace_id.clone(),
        agent_id: request.agent_id.clone(),
        name: name.clone(),
        role_id: request.role_id,
        tool: tool.clone(),
        workdir: Some(workdir.clone()),
        custom_workdir,
        employee_no: request.employee_no,
        state: agent_state,
        launch_command: request.launch_command,
    };

    let agent = repo.update_agent(input).map_err(to_command_error)?;
    if !prompt_enabled {
        if let Some(existing_relative_path) = existing_prompt_file_relative_path.as_deref() {
            delete_prompt_file(workspace_root, existing_relative_path)?;
        }
    } else if should_write_prompt {
        let written = write_prompt_file(
            workspace_root,
            workdir.as_str(),
            tool.as_str(),
            prompt_file_name.as_deref(),
            request
                .prompt_content
                .or_else(|| Some(existing_prompt_content.clone())),
        )?;
        if let (Some(existing_relative_path), Some((_, written_relative_path))) = (
            existing_prompt_file_relative_path.as_deref(),
            written.as_ref(),
        ) {
            if existing_relative_path != written_relative_path {
                delete_prompt_file(workspace_root, existing_relative_path)?;
            }
        }
    }
    let refreshed = find_agent(repo, &request.workspace_id, &agent.id)?;
    Ok(json!({ "agent": refreshed }))
}

fn agent_update_with_context<R: tauri::Runtime>(
    request: AgentUpdateRequest,
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<Value, String> {
    ensure_workspace_exists(state, &request.workspace_id)?;
    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let workspace_root = get_workspace_root(state, &request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let response = agent_update_with_repo(request, &repo, &workspace_root)?;
    let _ = crate::local_bridge::refresh_directory_snapshot(app, state, &workspace_id);
    Ok(response)
}

#[tauri::command]
pub fn agent_update(
    request: AgentUpdateRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    agent_update_with_context(request, state.inner(), &app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeleteRequest {
    pub workspace_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub cleanup_mode: Option<String>,
    #[serde(default)]
    pub replacement_agent_id: Option<String>,
}

pub(crate) fn agent_delete_with_repo<F>(
    request: AgentDeleteRequest,
    state: &AppState,
    repo: &SqliteAgentRepository,
    mut persist_route_bindings: F,
) -> Result<Value, String>
where
    F: FnMut() -> Result<(), String>,
{
    let cleanup_mode = parse_direct_binding_cleanup_mode(
        request.cleanup_mode.as_deref(),
        request.replacement_agent_id.as_deref(),
    )?;
    let blocking_bindings = collect_direct_agent_binding_dependencies(
        &state.task_service,
        &request.workspace_id,
        &request.agent_id,
    );
    if !blocking_bindings.is_empty() && cleanup_mode.is_none() {
        return Ok(json!({
            "deleted": false,
            "errorCode": "AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS",
            "blockingBindings": blocking_bindings,
        }));
    }
    let binding_cleanup = if let Some(cleanup_mode) = cleanup_mode {
        if let DirectBindingCleanupMode::Rebind {
            replacement_agent_id,
        } = &cleanup_mode
        {
            if replacement_agent_id == &request.agent_id {
                return Err(
                    "CHANNEL_BINDING_REPLACEMENT_AGENT_INVALID: replacementAgentId must differ from the deleted agent"
                        .to_string(),
                );
            }
            crate::commands::tool_adapter::validate_binding_target_selector(
                repo,
                &request.workspace_id,
                replacement_agent_id,
            )?;
        }
        let cleanup = apply_direct_agent_binding_cleanup(
            &state.task_service,
            &request.workspace_id,
            &request.agent_id,
            cleanup_mode,
        )?;
        state.task_service.clear_external_idempotency_cache();
        persist_route_bindings()?;
        Some(cleanup)
    } else {
        None
    };
    let deleted = repo
        .delete_agent(&request.workspace_id, &request.agent_id)
        .map_err(to_command_error)?;
    Ok(json!({
        "deleted": deleted,
        "bindingCleanup": binding_cleanup.as_ref().map(|cleanup| json!({
            "matchedCount": cleanup.matched_count,
            "updatedCount": cleanup.updated_count,
            "deletedCount": cleanup.deleted_count,
            "disabledCount": cleanup.disabled_count,
            "reboundToAgentId": cleanup.rebound_to_agent_id,
        })),
        "blockingBindings": Value::Null,
    }))
}

fn agent_delete_with_context<R: tauri::Runtime>(
    request: AgentDeleteRequest,
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<Value, String> {
    ensure_workspace_exists(state, &request.workspace_id)?;
    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    let workspace_id = request.workspace_id.clone();
    let response = agent_delete_with_repo(request, state, &repo, || {
        crate::commands::tool_adapter::persist_route_bindings(app, state)
    })?;
    let _ = crate::local_bridge::refresh_directory_snapshot(app, state, &workspace_id);
    Ok(response)
}

#[tauri::command]
pub fn agent_delete(
    request: AgentDeleteRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    agent_delete_with_context(request, state.inner(), &app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptReadRequest {
    pub workspace_id: String,
    pub agent_id: String,
}

pub(crate) fn agent_prompt_read_with_repo(
    request: AgentPromptReadRequest,
    repo: &SqliteAgentRepository,
    workspace_root: &Path,
) -> Result<Value, String> {
    let agent = find_agent(repo, &request.workspace_id, &request.agent_id)?;
    let (prompt_content, prompt_file_name, prompt_file_relative_path) =
        read_prompt_file(workspace_root, &agent)?;
    Ok(json!({
        "promptContent": prompt_content,
        "promptFileName": prompt_file_name,
        "promptFileRelativePath": prompt_file_relative_path,
    }))
}

fn agent_prompt_read_with_context<R: tauri::Runtime>(
    request: AgentPromptReadRequest,
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<Value, String> {
    ensure_workspace_exists(state, &request.workspace_id)?;
    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    let workspace_root = get_workspace_root(state, &request.workspace_id)?;
    agent_prompt_read_with_repo(request, &repo, &workspace_root)
}

#[tauri::command]
pub fn agent_prompt_read(
    request: AgentPromptReadRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    agent_prompt_read_with_context(request, state.inner(), &app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReorderRequest {
    pub workspace_id: String,
    pub ordered_agent_ids: Vec<String>,
}

#[tauri::command]
pub fn agent_reorder(
    request: AgentReorderRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    repo.reorder_agents(&request.workspace_id, request.ordered_agent_ids)
        .map_err(to_command_error)?;
    Ok(json!({ "reordered": true }))
}
