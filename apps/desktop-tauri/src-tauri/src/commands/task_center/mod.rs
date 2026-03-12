use serde::Deserialize;
use serde_json::{json, Value};
use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, State};
use vb_abstractions::AbstractionError;
use vb_task::{
    AgentRuntimeRegistration, ChannelAckEvent, ChannelMessageEvent, ChannelPublishRequest,
    TaskDispatchBatchRequest, TaskDispatchProgressEvent,
};

use crate::app_state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeUnregisterRequest {
    pub workspace_id: String,
    pub agent_id: String,
}

fn to_terminal_error(error: AbstractionError) -> String {
    match error {
        AbstractionError::WorkspaceNotFound { workspace_id } => {
            format!("WORKSPACE_NOT_FOUND: workspace '{workspace_id}' does not exist")
        }
        AbstractionError::InvalidArgument { message } => message,
        AbstractionError::AccessDenied { message } => message,
        AbstractionError::Conflict { message } => format!("TERMINAL_CONFLICT: {message}"),
        AbstractionError::Internal { message } => message,
    }
}

fn emit_channel_events(
    app: &AppHandle,
    message_events: &[ChannelMessageEvent],
    ack_events: &[ChannelAckEvent],
) {
    for event in message_events {
        let _ = app.emit("channel/message", event);
    }
    for event in ack_events {
        let _ = app.emit("channel/ack", event);
    }
}

fn emit_dispatch_progress_events(app: &AppHandle, events: &[TaskDispatchProgressEvent]) {
    for event in events {
        let _ = app.emit("task/dispatch_progress", event);
    }
}

pub(crate) fn write_terminal_with_submit(
    state: &AppState,
    session_id: &str,
    command: &str,
    submit_sequence: &str,
) -> Result<(), String> {
    let accepted_command = state
        .terminal_provider
        .write_session(session_id, command)
        .map_err(to_terminal_error)?;
    if !accepted_command {
        return Err("CHANNEL_DELIVERY_FAILED: terminal write rejected".to_string());
    }

    thread::sleep(Duration::from_millis(50));

    let accepted_submit = state
        .terminal_provider
        .write_session(session_id, submit_sequence)
        .map_err(to_terminal_error)?;
    if !accepted_submit {
        return Err("CHANNEL_DELIVERY_FAILED: terminal submit rejected".to_string());
    }

    thread::sleep(Duration::from_millis(50));

    let accepted_hard_submit = state
        .terminal_provider
        .write_session(session_id, "\r")
        .map_err(to_terminal_error)?;
    if accepted_hard_submit {
        Ok(())
    } else {
        Err("CHANNEL_DELIVERY_FAILED: terminal hard submit rejected".to_string())
    }
}

#[tauri::command]
pub fn task_list(scope: Option<String>) -> Result<Value, String> {
    Ok(json!({ "scope": scope.unwrap_or_else(|| "global".to_string()), "tasks": [] }))
}

#[tauri::command]
pub fn task_dispatch_batch(
    request: TaskDispatchBatchRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.workspace_id.trim().is_empty() {
        return Err("TASK_DISPATCH_INVALID: workspaceId is required".to_string());
    }
    if request.targets.is_empty() {
        return Err("TASK_DISPATCH_INVALID: targets must not be empty".to_string());
    }
    if request.markdown.trim().is_empty() {
        return Err("TASK_DISPATCH_INVALID: markdown must not be empty".to_string());
    }

    let workspace_root = state.workspace_root_path(&request.workspace_id)?;
    let outcome = state.task_service.dispatch_batch(
        &request,
        &workspace_root,
        |session_id, command, submit_sequence| {
            write_terminal_with_submit(state.inner(), session_id, command, submit_sequence)
        },
    );

    emit_dispatch_progress_events(&app, &outcome.progress_events);
    emit_channel_events(&app, &outcome.message_events, &outcome.ack_events);

    serde_json::to_value(outcome.response).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn channel_publish(
    request: ChannelPublishRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.workspace_id.trim().is_empty() {
        return Err("CHANNEL_PUBLISH_INVALID: workspaceId is required".to_string());
    }

    let outcome = state.task_service.publish(&request);
    emit_channel_events(&app, &outcome.message_events, &outcome.ack_events);
    serde_json::to_value(outcome.response).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_runtime_register(
    request: AgentRuntimeRegistration,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.workspace_id.trim().is_empty() {
        return Err("AGENT_RUNTIME_INVALID: workspaceId is required".to_string());
    }
    if request.agent_id.trim().is_empty() {
        return Err("AGENT_RUNTIME_INVALID: agentId is required".to_string());
    }
    if request.session_id.trim().is_empty() {
        return Err("AGENT_RUNTIME_INVALID: sessionId is required".to_string());
    }

    let registered = state.task_service.register_runtime(request.clone());
    let _ =
        crate::mcp_bridge::refresh_directory_snapshot(&app, state.inner(), &request.workspace_id);
    Ok(json!({
        "workspaceId": request.workspace_id,
        "agentId": request.agent_id,
        "stationId": request.station_id,
        "roleKey": request.role_key,
        "sessionId": request.session_id,
        "toolKind": request.tool_kind,
        "resolvedCwd": request.resolved_cwd,
        "submitSequence": request.submit_sequence,
        "registered": registered,
    }))
}

#[tauri::command]
pub fn agent_runtime_unregister(
    request: AgentRuntimeUnregisterRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.workspace_id.trim().is_empty() {
        return Err("AGENT_RUNTIME_INVALID: workspaceId is required".to_string());
    }
    if request.agent_id.trim().is_empty() {
        return Err("AGENT_RUNTIME_INVALID: agentId is required".to_string());
    }
    let unregistered = state
        .task_service
        .unregister_runtime(&request.workspace_id, &request.agent_id);
    let _ =
        crate::mcp_bridge::refresh_directory_snapshot(&app, state.inner(), &request.workspace_id);
    Ok(json!({
        "workspaceId": request.workspace_id,
        "agentId": request.agent_id,
        "unregistered": unregistered,
    }))
}

#[tauri::command]
pub fn changefeed_query(
    workspace_id: String,
    session_id: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "sessionId": session_id,
        "limit": limit.unwrap_or(100),
        "events": []
    }))
}
