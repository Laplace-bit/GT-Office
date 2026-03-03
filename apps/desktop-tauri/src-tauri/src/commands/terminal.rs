use base64::Engine;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::State;
use vb_abstractions::{
    AbstractionError, TerminalCreateRequest, TerminalCwdMode, TerminalProvider, WorkspaceId,
};

use crate::app_state::AppState;

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
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let cwd_mode = parse_cwd_mode(cwd_mode)?;
    let shell_name = shell.unwrap_or_else(|| "auto".to_string());
    let request = TerminalCreateRequest {
        workspace_id: WorkspaceId::new(workspace_id.clone()),
        shell: Some(shell_name.clone()),
        cwd,
        cwd_mode: cwd_mode.clone(),
        env: BTreeMap::new(),
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

#[cfg(test)]
mod tests {
    use super::{
        build_terminal_create_response, build_terminal_delta_response,
        build_terminal_kill_response, build_terminal_resize_response,
        build_terminal_snapshot_response, build_terminal_visibility_response,
        build_terminal_write_response, parse_cwd_mode,
    };
    use vb_abstractions::TerminalCwdMode;

    #[test]
    fn parse_cwd_mode_supports_workspace_root() {
        let parsed = parse_cwd_mode(Some("workspace_root".to_string())).expect("mode");
        assert_eq!(parsed, TerminalCwdMode::WorkspaceRoot);
    }

    #[test]
    fn parse_cwd_mode_supports_custom() {
        let parsed = parse_cwd_mode(Some("custom".to_string())).expect("mode");
        assert_eq!(parsed, TerminalCwdMode::Custom);
    }

    #[test]
    fn parse_cwd_mode_rejects_invalid_value() {
        let err = parse_cwd_mode(Some("invalid".to_string())).expect_err("invalid mode");
        assert!(err.contains("TERMINAL_CWD_MODE_INVALID"));
    }

    #[test]
    fn terminal_create_response_keeps_contract_fields() {
        let payload = build_terminal_create_response(
            "ts-1",
            "ws-1",
            "bash",
            &TerminalCwdMode::WorkspaceRoot,
            "/repo",
        );
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["shell"], "bash");
        assert_eq!(payload["cwdMode"], "workspace_root");
        assert_eq!(payload["resolvedCwd"], "/repo");
    }

    #[test]
    fn terminal_write_response_keeps_contract_fields() {
        let payload = build_terminal_write_response("ts-1", true);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["accepted"], true);
    }

    #[test]
    fn terminal_resize_response_keeps_contract_fields() {
        let payload = build_terminal_resize_response("ts-1", 120, 40, true);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["cols"], 120);
        assert_eq!(payload["rows"], 40);
        assert_eq!(payload["resized"], true);
    }

    #[test]
    fn terminal_kill_response_keeps_contract_fields() {
        let payload = build_terminal_kill_response("ts-1", "TERM", true);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["signal"], "TERM");
        assert_eq!(payload["killed"], true);
    }

    #[test]
    fn terminal_visibility_response_keeps_contract_fields() {
        let payload = build_terminal_visibility_response("ts-1", true, true);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["visible"], true);
        assert_eq!(payload["updated"], true);
    }

    #[test]
    fn terminal_snapshot_response_keeps_contract_fields() {
        let payload = build_terminal_snapshot_response("ts-1", b"abc".to_vec(), 4, 9);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["bytes"], 3);
        assert_eq!(payload["maxBytes"], 4);
        assert_eq!(payload["truncated"], false);
        assert_eq!(payload["currentSeq"], 9);
        assert!(payload["chunk"].as_str().unwrap_or_default().len() > 0);
    }

    #[test]
    fn terminal_delta_response_keeps_contract_fields() {
        let payload =
            build_terminal_delta_response("ts-1", b"abc".to_vec(), 2, Some(3), 5, 5, false, false);
        assert_eq!(payload["sessionId"], "ts-1");
        assert_eq!(payload["afterSeq"], 2);
        assert_eq!(payload["fromSeq"], 3);
        assert_eq!(payload["toSeq"], 5);
        assert_eq!(payload["currentSeq"], 5);
        assert_eq!(payload["gap"], false);
        assert_eq!(payload["truncated"], false);
        assert!(payload["chunk"].as_str().unwrap_or_default().len() > 0);
    }
}
