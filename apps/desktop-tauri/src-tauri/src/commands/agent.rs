use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use vb_abstractions::{WorkspaceId, WorkspaceService};
use vb_agent::{
    default_agent_workdir, default_prompt_content, normalize_agent_slug, prompt_file_name_for_tool,
    prompt_file_relative_path, AgentProfile, AgentRepository, AgentRole, AgentRoleScope,
    AgentState, CreateAgentInput, GLOBAL_ROLE_WORKSPACE_ID, UpdateAgentInput,
};
use vb_storage::{SqliteAgentRepository, SqliteStorage};

use crate::app_state::AppState;

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

fn resolve_agent_repository(app: &AppHandle) -> Result<SqliteAgentRepository, String> {
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

fn seed_agent_defaults(repo: &SqliteAgentRepository, workspace_id: &str) -> Result<(), String> {
    repo.seed_defaults(GLOBAL_ROLE_WORKSPACE_ID)
        .map_err(to_command_error)?;
    repo.seed_defaults(workspace_id).map_err(to_command_error)
}

fn parse_agent_state(value: Option<String>) -> Result<AgentState, String> {
    match value.as_deref() {
        None => Ok(AgentState::Ready),
        Some("ready") => Ok(AgentState::Ready),
        Some("paused") => Ok(AgentState::Paused),
        Some("blocked") => Ok(AgentState::Blocked),
        Some("terminated") => Ok(AgentState::Terminated),
        Some(other) => Err(format!("AGENT_STATE_INVALID: {other}")),
    }
}

fn parse_role_scope(value: Option<&str>) -> AgentRoleScope {
    match value {
        Some("global") => AgentRoleScope::Global,
        _ => AgentRoleScope::Workspace,
    }
}

fn role_scope_workspace_id(scope: &AgentRoleScope, workspace_id: &str) -> String {
    match scope {
        AgentRoleScope::Global => GLOBAL_ROLE_WORKSPACE_ID.to_string(),
        AgentRoleScope::Workspace => workspace_id.to_string(),
    }
}

fn normalize_relative_workdir(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .replace('\\', "/")
        .replace("/./", "/")
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() || normalized == "." {
        return None;
    }
    if normalized.starts_with('/') || normalized.starts_with('~') || normalized.contains(':') {
        return None;
    }
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    if segments.is_empty() || segments.iter().any(|segment| *segment == "..") {
        return None;
    }
    Some(segments.join("/"))
}

fn resolve_agent_tool(tool: Option<String>) -> String {
    let normalized = tool.unwrap_or_else(|| "codex".to_string());
    let lowered = normalized.trim().to_ascii_lowercase();
    if lowered.contains("claude") {
        "claude".to_string()
    } else if lowered.contains("gemini") {
        "gemini".to_string()
    } else {
        "codex".to_string()
    }
}

fn resolve_agent_workdir(name: &str, workdir: Option<String>, custom_workdir: bool) -> Result<(String, bool), String> {
    let default_workdir = default_agent_workdir(name);
    let requested = workdir
        .and_then(|value| normalize_relative_workdir(value.as_str()))
        .unwrap_or_else(|| default_workdir.clone());
    if !requested.starts_with(".gtoffice/") && !custom_workdir {
        return Ok((default_workdir, false));
    }
    if custom_workdir {
        return Ok((requested.clone(), requested != default_workdir));
    }
    Ok((default_workdir, false))
}

fn ensure_path_within_workspace(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_relative_workdir(relative_path)
        .ok_or_else(|| "AGENT_WORKDIR_INVALID".to_string())?;
    let joined = workspace_root.join(&normalized);
    let canonical_base = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let canonical_joined_parent = joined
        .parent()
        .unwrap_or(workspace_root)
        .canonicalize()
        .unwrap_or_else(|_| joined.parent().unwrap_or(workspace_root).to_path_buf());
    if !canonical_joined_parent.starts_with(&canonical_base) {
        return Err("AGENT_WORKDIR_OUTSIDE_WORKSPACE".to_string());
    }
    Ok(joined)
}

fn write_prompt_file(
    workspace_root: &Path,
    agent_name: &str,
    workdir: &str,
    tool: &str,
    prompt_content: Option<String>,
) -> Result<Option<(String, String)>, String> {
    let Some(file_name) = prompt_file_name_for_tool(tool) else {
        return Ok(None);
    };
    let relative_path = prompt_file_relative_path(workdir, tool)
        .ok_or_else(|| "AGENT_PROMPT_PATH_INVALID".to_string())?;
    let workdir_path = ensure_path_within_workspace(workspace_root, workdir)?;
    std::fs::create_dir_all(&workdir_path)
        .map_err(|error| format!("AGENT_WORKDIR_CREATE_FAILED: {error}"))?;
    let content = prompt_content
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_prompt_content(agent_name, tool));
    std::fs::write(workdir_path.join(file_name), content)
        .map_err(|error| format!("AGENT_PROMPT_WRITE_FAILED: {error}"))?;
    Ok(Some((file_name.to_string(), relative_path)))
}

fn read_prompt_file(
    workspace_root: &Path,
    agent: &AgentProfile,
) -> Result<(String, Option<String>, Option<String>), String> {
    let Some(relative_path) = agent.prompt_file_relative_path.as_deref() else {
        return Ok((String::new(), None, None));
    };
    let Some(file_name) = agent.prompt_file_name.clone() else {
        return Ok((String::new(), None, None));
    };
    let absolute_path = ensure_path_within_workspace(workspace_root, relative_path)?;
    let content = std::fs::read_to_string(&absolute_path)
        .unwrap_or_else(|_| default_prompt_content(agent.name.as_str(), agent.tool.as_str()));
    Ok((content, Some(file_name), Some(relative_path.to_string())))
}

fn find_agent(repo: &SqliteAgentRepository, workspace_id: &str, agent_id: &str) -> Result<AgentProfile, String> {
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
    Ok(json!({ "roles": roles }))
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
    let role_workspace_id = role_scope_workspace_id(&scope, &request.workspace_id);
    let existing = request
        .role_id
        .as_deref()
        .and_then(|role_id| {
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
        id: request.role_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        workspace_id: role_workspace_id.clone(),
        role_key,
        role_name: request.role_name.trim().to_string(),
        department_id: String::new(),
        scope: scope.clone(),
        charter_path: existing.as_ref().and_then(|role| role.charter_path.clone()),
        policy_json: existing.as_ref().and_then(|role| role.policy_json.clone()),
        version: existing.as_ref().map_or(1, |role| role.version + 1),
        status: existing
            .as_ref()
            .map_or(vb_agent::RoleStatus::Active, |role| role.status.clone()),
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
    let deleted = repo
        .delete_role(&role_workspace_id, &request.role_id)
        .map_err(to_command_error)?;
    Ok(json!({ "deleted": deleted }))
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
    pub prompt_content: Option<String>,
}

#[tauri::command]
pub fn agent_create(
    request: AgentCreateRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let agent_state = parse_agent_state(request.state)?;
    let tool = resolve_agent_tool(request.tool);
    let name = request.name.trim().to_string();
    let (workdir, custom_workdir) =
        resolve_agent_workdir(name.as_str(), request.workdir, request.custom_workdir.unwrap_or(false))?;
    let workspace_root = get_workspace_root(state.inner(), &request.workspace_id)?;

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
    };

    let agent = repo.create_agent(input).map_err(to_command_error)?;
    write_prompt_file(
        &workspace_root,
        name.as_str(),
        workdir.as_str(),
        tool.as_str(),
        request.prompt_content,
    )?;
    let refreshed = find_agent(&repo, &request.workspace_id, &agent.id)?;
    let _ =
        crate::mcp_bridge::refresh_directory_snapshot(&app, state.inner(), &request.workspace_id);
    Ok(json!({ "agent": refreshed }))
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
    pub prompt_content: Option<String>,
}

#[tauri::command]
pub fn agent_update(
    request: AgentUpdateRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    seed_agent_defaults(&repo, &request.workspace_id)?;
    let agent_state = parse_agent_state(request.state)?;
    let tool = resolve_agent_tool(request.tool);
    let name = request.name.trim().to_string();
    let (workdir, custom_workdir) =
        resolve_agent_workdir(name.as_str(), request.workdir, request.custom_workdir.unwrap_or(false))?;
    let workspace_root = get_workspace_root(state.inner(), &request.workspace_id)?;

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
    };

    let agent = repo.update_agent(input).map_err(to_command_error)?;
    write_prompt_file(
        &workspace_root,
        name.as_str(),
        workdir.as_str(),
        tool.as_str(),
        request.prompt_content,
    )?;
    let refreshed = find_agent(&repo, &request.workspace_id, &agent.id)?;
    let _ =
        crate::mcp_bridge::refresh_directory_snapshot(&app, state.inner(), &request.workspace_id);
    Ok(json!({ "agent": refreshed }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeleteRequest {
    pub workspace_id: String,
    pub agent_id: String,
}

#[tauri::command]
pub fn agent_delete(
    request: AgentDeleteRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    let deleted = repo
        .delete_agent(&request.workspace_id, &request.agent_id)
        .map_err(to_command_error)?;
    let _ =
        crate::mcp_bridge::refresh_directory_snapshot(&app, state.inner(), &request.workspace_id);
    Ok(json!({ "deleted": deleted }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptReadRequest {
    pub workspace_id: String,
    pub agent_id: String,
}

#[tauri::command]
pub fn agent_prompt_read(
    request: AgentPromptReadRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    ensure_workspace_exists(&state, &request.workspace_id)?;
    let repo = resolve_agent_repository(&app)?;
    repo.ensure_schema().map_err(to_command_error)?;
    let workspace_root = get_workspace_root(state.inner(), &request.workspace_id)?;
    let agent = find_agent(&repo, &request.workspace_id, &request.agent_id)?;
    let (prompt_content, prompt_file_name, prompt_file_relative_path) =
        read_prompt_file(&workspace_root, &agent)?;
    Ok(json!({
        "promptContent": prompt_content,
        "promptFileName": prompt_file_name,
        "promptFileRelativePath": prompt_file_relative_path,
    }))
}
