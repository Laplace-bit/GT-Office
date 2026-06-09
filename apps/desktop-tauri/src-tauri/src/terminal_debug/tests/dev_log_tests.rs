use crate::app_state::{RenderedScreenSnapshot, RenderedScreenSnapshotRow};
use crate::terminal_debug::dev_log::{
    build_frontend_focus_log_entry, build_rendered_screen_parsed_log_entry,
    build_rendered_screen_raw_log_entry, should_write_terminal_debug_log_for_build,
    TerminalDebugLogKind,
};
use crate::terminal_debug::human_log::TerminalDebugHumanEntry;
use gt_task::AgentToolKind;

#[test]
fn terminal_debug_log_kind_file_names_match_contract() {
    assert_eq!(TerminalDebugLogKind::Raw.file_name(), "raw.log");
    assert_eq!(TerminalDebugLogKind::Parsed.file_name(), "parsed.log");
    assert_eq!(
        TerminalDebugLogKind::FrontendFocus.file_name(),
        "frontend-focus.log"
    );
}

#[test]
fn terminal_debug_log_build_gate_keeps_frontend_focus_in_release() {
    assert!(should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Raw,
        true
    ));
    assert!(should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Parsed,
        true
    ));
    assert!(!should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Raw,
        false
    ));
    assert!(!should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::Parsed,
        false
    ));
    assert!(should_write_terminal_debug_log_for_build(
        TerminalDebugLogKind::FrontendFocus,
        false
    ));
}

#[test]
fn raw_log_entry_includes_session_revision_tool_capture_and_rows() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "session-1".to_string(),
        screen_revision: 9,
        captured_at_ms: 1234,
        viewport_top: 0,
        viewport_height: 2,
        base_y: 0,
        cursor_row: Some(1),
        cursor_col: Some(4),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "first row".to_string(),
                trimmed_text: "first row".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "second row".to_string(),
                trimmed_text: "second row".to_string(),
                is_blank: false,
            },
        ],
    };

    let entry =
        build_rendered_screen_raw_log_entry("session-1", 9, AgentToolKind::Codex, &snapshot);

    assert!(entry
        .starts_with("[session=session-1] [screenRevision=9] [tool=Codex] [capturedAtMs=1234]"));
    assert!(entry.contains("\nfirst row\nsecond row\n\n"));
}

#[test]
fn parsed_log_entry_renders_none_or_human_entries() {
    assert_eq!(
        build_rendered_screen_parsed_log_entry("session-1", 1, &[]),
        "[session=session-1] [screenRevision=1]\n[none]\n\n"
    );

    let entries = vec![
        TerminalDebugHumanEntry {
            at_ms: 10,
            text: "hello".to_string(),
        },
        TerminalDebugHumanEntry {
            at_ms: 20,
            text: "world".to_string(),
        },
    ];
    let entry = build_rendered_screen_parsed_log_entry("session-2", 3, &entries);
    assert_eq!(
        entry,
        "[session=session-2] [screenRevision=3]\n- [10] hello\n- [20] world\n\n"
    );
}

#[test]
fn frontend_focus_log_entry_uses_defaults_for_optional_fields() {
    assert_eq!(
        build_frontend_focus_log_entry(42, None, "station-1", None, "focus", None),
        "[atMs=42] [workspace=none] [station=station-1] [session=none] [kind=focus]\n[none]\n\n"
    );
    assert_eq!(
        build_frontend_focus_log_entry(
            43,
            Some("workspace-2"),
            "station-2",
            Some("session-2"),
            "blur",
            Some("lost focus")
        ),
        "[atMs=43] [workspace=workspace-2] [station=station-2] [session=session-2] [kind=blur]\nlost focus\n\n"
    );
}
