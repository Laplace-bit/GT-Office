use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::{AppHandle, State};
use tracing::warn;
use vb_abstractions::{
    AbstractionError, TerminalCreateRequest, TerminalCwdMode, TerminalProvider, WorkspaceId,
};

use crate::app_state::{extract_rendered_debug_human_text, AppState, RenderedScreenSnapshot};
use crate::commands::settings::ai_config::{
    agent_tool_kind_from_param, augment_terminal_env_for_agent,
};
use crate::commands::task_center::write_terminal_with_submit;
use crate::terminal_debug::dev_log::{
    append_dev_log, append_dev_log_async, build_frontend_focus_log_entry,
    build_rendered_screen_parsed_log_entry, build_rendered_screen_raw_log_entry,
    resolve_terminal_debug_log_path, TerminalDebugLogKind,
};
use crate::terminal_debug::human_log::TerminalDebugHumanEntry;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFrontendFocusLogEntry {
    pub at_ms: u64,
    pub station_id: String,
    pub session_id: Option<String>,
    pub kind: String,
    pub detail: Option<String>,
}

fn parse_cwd_mode(cwd_mode: Option<String>) -> Result<TerminalCwdMode, String> {
    match cwd_mode.as_deref().unwrap_or("workspace_root") {
        "workspace_root" => Ok(TerminalCwdMode::WorkspaceRoot),
        "custom" => Ok(TerminalCwdMode::Custom),
        invalid => Err(format!(
            "TERMINAL_CWD_MODE_INVALID: unsupported cwd mode '{invalid}'"
        )),
    }
}

fn mode_label(mode: &TerminalCwdMode) -> &'static str {
    match mode {
        TerminalCwdMode::WorkspaceRoot => "workspace_root",
        TerminalCwdMode::Custom => "custom",
    }
}

fn build_terminal_create_response(
    session_id: &str,
    workspace_id: &str,
    shell: &str,
    cwd_mode: &TerminalCwdMode,
    resolved_cwd: &str,
) -> Value {
    json!({
        "sessionId": session_id,
        "workspaceId": workspace_id,
        "shell": shell,
        "cwdMode": mode_label(cwd_mode),
        "resolvedCwd": resolved_cwd
    })
}

fn build_terminal_write_response(session_id: &str, accepted: bool) -> Value {
    json!({ "sessionId": session_id, "accepted": accepted })
}

pub(crate) fn resolve_terminal_submit_sequence(submit_sequence: Option<String>) -> String {
    match submit_sequence {
        Some(value) if !value.is_empty() => value,
        _ => "\r".to_string(),
    }
}

fn build_terminal_resize_response(session_id: &str, cols: u16, rows: u16, resized: bool) -> Value {
    json!({ "sessionId": session_id, "cols": cols, "rows": rows, "resized": resized })
}

fn build_terminal_kill_response(session_id: &str, signal: &str, killed: bool) -> Value {
    json!({
        "sessionId": session_id,
        "signal": signal,
        "killed": killed
    })
}

fn build_terminal_visibility_response(session_id: &str, visible: bool, updated: bool) -> Value {
    json!({
        "sessionId": session_id,
        "visible": visible,
        "updated": updated
    })
}

fn build_terminal_snapshot_response(
    session_id: &str,
    chunk: Vec<u8>,
    max_bytes: usize,
    current_seq: u64,
) -> Value {
    let bytes = chunk.len();
    json!({
        "sessionId": session_id,
        "chunk": base64::engine::general_purpose::STANDARD.encode(chunk),
        "bytes": bytes,
        "maxBytes": max_bytes,
        "truncated": bytes >= max_bytes,
        "currentSeq": current_seq
    })
}

fn build_terminal_delta_response(
    session_id: &str,
    chunk: Vec<u8>,
    after_seq: u64,
    from_seq: Option<u64>,
    to_seq: u64,
    current_seq: u64,
    gap: bool,
    truncated: bool,
) -> Value {
    json!({
        "sessionId": session_id,
        "chunk": base64::engine::general_purpose::STANDARD.encode(chunk),
        "afterSeq": after_seq,
        "fromSeq": from_seq,
        "toSeq": to_seq,
        "currentSeq": current_seq,
        "gap": gap,
        "truncated": truncated
    })
}

fn build_terminal_report_rendered_screen_response(
    session_id: &str,
    screen_revision: u64,
    accepted: bool,
    human_text: Option<&str>,
    human_entries: &[TerminalDebugHumanEntry],
) -> Value {
    json!({
        "sessionId": session_id,
        "screenRevision": screen_revision,
        "accepted": accepted,
        "humanText": human_text,
        "humanEntries": human_entries,
        "humanEventCount": human_entries.len()
    })
}

fn build_terminal_debug_append_frontend_focus_log_response(
    station_id: &str,
    session_id: Option<&str>,
    kind: &str,
    log_path: &str,
) -> Value {
    json!({
        "stationId": station_id,
        "sessionId": session_id,
        "kind": kind,
        "accepted": true,
        "logPath": log_path,
    })
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

#[tauri::command]
pub fn terminal_create(
    workspace_id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cwd_mode: Option<String>,
    env: Option<BTreeMap<String, String>>,
    agent_tool_kind: Option<String>,
    inject_provider_env: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let cwd_mode = parse_cwd_mode(cwd_mode)?;
    let shell_name = shell.unwrap_or_else(|| "auto".to_string());
    let tool_kind = agent_tool_kind_from_param(agent_tool_kind.clone());
    let env = augment_terminal_env_for_agent(
        &app,
        state.inner(),
        &workspace_id,
        tool_kind,
        inject_provider_env.unwrap_or(true),
        env.unwrap_or_default(),
    )?;
    let request = TerminalCreateRequest {
        workspace_id: WorkspaceId::new(workspace_id.clone()),
        shell: Some(shell_name.clone()),
        cwd,
        cwd_mode: cwd_mode.clone(),
        env,
        agent_tool_kind,
    };
    let session = state
        .terminal_provider
        .create_session(request)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_create_response(
        &session.session_id,
        session.workspace_id.as_str(),
        &shell_name,
        &cwd_mode,
        &session.resolved_cwd,
    ))
}

#[tauri::command]
pub fn terminal_write(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let accepted = state
        .terminal_provider
        .write_session(&session_id, &input)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_write_response(&session_id, accepted))
}

#[tauri::command]
pub fn terminal_write_with_submit(
    session_id: String,
    input: String,
    submit_sequence: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let submit_sequence = resolve_terminal_submit_sequence(submit_sequence);
    write_terminal_with_submit(state.inner(), &session_id, &input, &submit_sequence)?;
    Ok(build_terminal_write_response(&session_id, true))
}

#[tauri::command]
pub fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let resized = state
        .terminal_provider
        .resize_session(&session_id, cols, rows)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_resize_response(
        &session_id,
        cols,
        rows,
        resized,
    ))
}

#[tauri::command]
pub fn terminal_kill(
    session_id: String,
    signal: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let killed = state
        .terminal_provider
        .kill_session(&session_id)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_kill_response(
        &session_id,
        signal.as_deref().unwrap_or("TERM"),
        killed,
    ))
}

#[tauri::command]
pub fn terminal_set_visibility(
    session_id: String,
    visible: bool,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let updated = state
        .terminal_provider
        .set_session_visibility(&session_id, visible)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_visibility_response(
        &session_id,
        visible,
        updated,
    ))
}

#[tauri::command]
pub fn terminal_read_snapshot(
    session_id: String,
    max_bytes: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let max_bytes = max_bytes.unwrap_or(262_144).clamp(1, 2_097_152) as usize;
    let snapshot = state
        .terminal_provider
        .read_session_snapshot(&session_id, max_bytes)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_snapshot_response(
        &session_id,
        snapshot.chunk,
        max_bytes,
        snapshot.current_seq,
    ))
}

#[tauri::command]
pub fn terminal_read_delta(
    session_id: String,
    after_seq: u64,
    max_bytes: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let max_bytes = max_bytes.unwrap_or(262_144).clamp(1, 2_097_152) as usize;
    let delta = state
        .terminal_provider
        .read_session_delta(&session_id, after_seq, max_bytes)
        .map_err(to_terminal_error)?;
    Ok(build_terminal_delta_response(
        &session_id,
        delta.chunk,
        after_seq,
        delta.from_seq,
        delta.to_seq,
        delta.current_seq,
        delta.gap,
        delta.truncated,
    ))
}

#[tauri::command]
pub fn terminal_report_rendered_screen(
    snapshot: RenderedScreenSnapshot,
    tool_kind: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let resolved_tool_kind = agent_tool_kind_from_param(tool_kind);
    let accepted =
        state.report_external_reply_rendered_screen(&snapshot.session_id, snapshot.clone())?;
    let human_text = extract_rendered_debug_human_text(&snapshot, resolved_tool_kind);
    let human_log = state.update_terminal_debug_human_log(
        &snapshot.session_id,
        snapshot.captured_at_ms,
        &human_text,
    )?;
    append_dev_log_async(
        app.clone(),
        TerminalDebugLogKind::Raw,
        build_rendered_screen_raw_log_entry(
            &snapshot.session_id,
            snapshot.screen_revision,
            resolved_tool_kind,
            &snapshot,
        ),
    );
    append_dev_log_async(
        app.clone(),
        TerminalDebugLogKind::Parsed,
        build_rendered_screen_parsed_log_entry(
            &snapshot.session_id,
            snapshot.screen_revision,
            &human_log.entries,
        ),
    );
    Ok(build_terminal_report_rendered_screen_response(
        &snapshot.session_id,
        snapshot.screen_revision,
        accepted,
        (!human_text.trim().is_empty()).then_some(human_text.as_str()),
        &human_log.entries,
    ))
}

#[tauri::command]
pub fn terminal_debug_clear_human_log(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state.clear_terminal_debug_human_log(&session_id)?;
    Ok(json!({
        "sessionId": session_id,
        "cleared": true
    }))
}

#[tauri::command]
pub fn terminal_debug_append_frontend_focus_log(
    entry: TerminalFrontendFocusLogEntry,
    app: AppHandle,
) -> Result<Value, String> {
    let log_path = resolve_terminal_debug_log_path(&app, TerminalDebugLogKind::FrontendFocus)?
        .to_string_lossy()
        .to_string();
    let content = build_frontend_focus_log_entry(
        entry.at_ms,
        &entry.station_id,
        entry.session_id.as_deref(),
        &entry.kind,
        entry.detail.as_deref(),
    );
    append_dev_log(&app, TerminalDebugLogKind::FrontendFocus, &content).map_err(|error| {
        warn!(
            station_id = %entry.station_id,
            session_id = entry.session_id.as_deref().unwrap_or("none"),
            kind = %entry.kind,
            error = %error,
            "failed to append frontend focus diagnostic log"
        );
        error
    })?;
    Ok(build_terminal_debug_append_frontend_focus_log_response(
        &entry.station_id,
        entry.session_id.as_deref(),
        &entry.kind,
        &log_path,
    ))
}

#[tauri::command]
pub fn terminal_describe_processes(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let snapshot = state
        .terminal_provider
        .describe_session_processes(&session_id)
        .map_err(to_terminal_error)?;
    serde_json::to_value(snapshot).map_err(|error| {
        format!("TERMINAL_INTERNAL: failed to serialize terminal process snapshot: {error}")
    })
}

#[tauri::command]
pub fn terminal_activate(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    // Check session exists
    if !state.terminal_provider.has_session(&session_id) {
        return Err(format!(
            "TERMINAL_NOT_FOUND: session '{}' does not exist",
            session_id
        ));
    }

    // For Phase 1, return a placeholder response
    // Full implementation requires OutputRouter integration
    Ok(json!({
        "sessionId": session_id,
        "revision": 0,
        "content": "",
        "cols": 80,
        "rows": 24,
        "cursorRow": 0,
        "cursorCol": 0,
        "scrollbackLines": 0,
        "title": null
    }))
}

#[tauri::command]
pub fn terminal_get_rendered_screen(
    session_id: String,
    _state: State<'_, AppState>,
) -> Result<Value, String> {
    // Placeholder for Phase 1
    Ok(json!({
        "sessionId": session_id,
        "revision": 0,
        "content": "",
        "cols": 80,
        "rows": 24,
        "cursorRow": 0,
        "cursorCol": 0,
        "scrollbackLines": 0,
        "title": null
    }))
}

#[tauri::command]
pub fn terminal_open_output_channel(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    // Check session exists
    if !state.terminal_provider.has_session(&session_id) {
        return Err(format!(
            "TERMINAL_NOT_FOUND: session '{}' does not exist",
            session_id
        ));
    }

    // Placeholder for Phase 1 - Binary Channel setup
    Ok(json!({
        "sessionId": session_id,
        "channelBound": true
    }))
}

#[cfg(test)]
#[path = "../tests/terminal_tests.rs"]
mod tests;
