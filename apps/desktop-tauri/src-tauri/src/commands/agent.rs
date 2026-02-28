use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use vb_abstractions::{WorkspaceId, WorkspaceService};
use vb_agent::{AgentRepository, AgentState, CreateAgentInput};
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
    repo.seed_defaults(&workspace_id)
        .map_err(to_command_error)?;
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
pub struct AgentCreateRequest {
    pub workspace_id: String,
    pub agent_id: Option<String>,
    pub name: String,
    pub role_id: String,
    pub employee_no: Option<String>,
    pub state: Option<String>,
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
    repo.seed_defaults(&request.workspace_id)
        .map_err(to_command_error)?;
    let state = parse_agent_state(request.state)?;

    let input = CreateAgentInput {
        workspace_id: request.workspace_id,
        agent_id: request.agent_id,
        name: request.name,
        role_id: request.role_id,
        employee_no: request.employee_no,
        state,
    };

    let agent = repo.create_agent(input).map_err(to_command_error)?;
    Ok(json!({ "agent": agent }))
}
