use super::{
    build_terminal_create_response, build_terminal_delta_response, build_terminal_kill_response,
    build_terminal_report_rendered_screen_response, build_terminal_resize_response,
    build_terminal_snapshot_response, build_terminal_visibility_response,
    build_terminal_write_response, parse_cwd_mode, resolve_terminal_submit_sequence,
};
use crate::terminal_debug::dev_log::{
    build_frontend_focus_log_entry, should_write_terminal_debug_log_for_build,
    TerminalDebugLogKind,
};
use crate::commands::task_center::build_terminal_submit_chunks;
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
fn resolve_terminal_submit_sequence_defaults_to_carriage_return() {
    assert_eq!(resolve_terminal_submit_sequence(None), "\r");
    assert_eq!(resolve_terminal_submit_sequence(Some(String::new())), "\r");
    assert_eq!(
        resolve_terminal_submit_sequence(Some("\x1b[13~".to_string())),
        "\x1b[13~"
    );
}

#[test]
fn build_terminal_submit_chunks_skips_empty_command_but_keeps_submit_bytes() {
    assert_eq!(
        build_terminal_submit_chunks("", "\r"),
        vec!["\r".to_string(), "\r".to_string()]
    );
    assert_eq!(
        build_terminal_submit_chunks("/status", "\x1b[13~"),
        vec![
            "/status".to_string(),
            "\x1b[13~".to_string(),
            "\r".to_string(),
        ]
    );
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

#[test]
fn terminal_report_rendered_screen_response_keeps_contract_fields() {
    let payload =
        build_terminal_report_rendered_screen_response("ts-1", 12, true, Some("稳定正文"), &[]);
    assert_eq!(payload["sessionId"], "ts-1");
    assert_eq!(payload["screenRevision"], 12);
    assert_eq!(payload["accepted"], true);
    assert_eq!(payload["humanText"], "稳定正文");
    assert_eq!(payload["humanEventCount"], 0);
}

#[test]
fn frontend_focus_terminal_debug_log_persists_in_release_builds() {
    assert!(should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::FrontendFocus,
        false
    ));
    assert!(!should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Raw,
        false
    ));
    assert!(!should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Parsed,
        false
    ));
}

#[test]
fn frontend_focus_log_entry_keeps_contract_fields() {
    let entry = build_frontend_focus_log_entry(
        1_717_171_717,
        "station-a",
        Some("session-a"),
        "pointerdown",
        Some("active=0"),
    );
    assert!(entry.contains("[station=station-a]"));
    assert!(entry.contains("[session=session-a]"));
    assert!(entry.contains("[kind=pointerdown]"));
    assert!(entry.contains("active=0"));
}
