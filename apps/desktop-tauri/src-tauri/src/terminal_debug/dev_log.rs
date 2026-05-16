use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use gt_task::AgentToolKind;
use tauri::{AppHandle, Manager};

use crate::app_state::RenderedScreenSnapshot;
use crate::terminal_debug::human_log::TerminalDebugHumanEntry;

#[derive(Debug, Clone, Copy)]
pub enum TerminalDebugLogKind {
    Raw,
    Parsed,
    FrontendFocus,
}

impl TerminalDebugLogKind {
    fn file_name(self) -> &'static str {
        match self {
            Self::Raw => "raw.log",
            Self::Parsed => "parsed.log",
            Self::FrontendFocus => "frontend-focus.log",
        }
    }
}

pub fn should_write_terminal_debug_log_for_build(
    kind: TerminalDebugLogKind,
    debug_assertions: bool,
) -> bool {
    match kind {
        TerminalDebugLogKind::Raw | TerminalDebugLogKind::Parsed => debug_assertions,
        TerminalDebugLogKind::FrontendFocus => true,
    }
}

fn should_write_terminal_debug_log(kind: TerminalDebugLogKind) -> bool {
    should_write_terminal_debug_log_for_build(kind, cfg!(debug_assertions))
}

fn resolve_terminal_debug_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(".dev-logs")
            .join("terminal-debug"));
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_DIR_FAILED: {error}"))?;
    Ok(app_data.join("terminal-debug"))
}

pub fn resolve_terminal_debug_log_path(
    app: &AppHandle,
    kind: TerminalDebugLogKind,
) -> Result<PathBuf, String> {
    Ok(resolve_terminal_debug_log_dir(app)?.join(kind.file_name()))
}

pub fn reset_dev_logs(app: &AppHandle) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    let raw_path = resolve_terminal_debug_log_path(app, TerminalDebugLogKind::Raw)?;
    let parsed_path = resolve_terminal_debug_log_path(app, TerminalDebugLogKind::Parsed)?;
    let parent = raw_path
        .parent()
        .ok_or_else(|| "TERMINAL_DEBUG_LOG_PATH_INVALID".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_RESET_FAILED: {error}"))?;
    fs::write(&raw_path, b"")
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_RESET_FAILED: {error}"))?;
    fs::write(&parsed_path, b"")
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_RESET_FAILED: {error}"))?;
    Ok(())
}

pub fn append_dev_log(
    app: &AppHandle,
    kind: TerminalDebugLogKind,
    content: &str,
) -> Result<(), String> {
    if !should_write_terminal_debug_log(kind) || content.is_empty() {
        return Ok(());
    }
    let path = resolve_terminal_debug_log_path(app, kind)?;
    let parent = path
        .parent()
        .ok_or_else(|| "TERMINAL_DEBUG_LOG_PATH_INVALID".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_APPEND_FAILED: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_APPEND_FAILED: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("TERMINAL_DEBUG_LOG_APPEND_FAILED: {error}"))?;
    Ok(())
}

pub fn append_dev_log_async(app: AppHandle, kind: TerminalDebugLogKind, content: String) {
    if !should_write_terminal_debug_log(kind) || content.is_empty() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _ = append_dev_log(&app, kind, &content);
    });
}

pub fn build_rendered_screen_raw_log_entry(
    session_id: &str,
    screen_revision: u64,
    tool_kind: AgentToolKind,
    snapshot: &RenderedScreenSnapshot,
) -> String {
    let rows = snapshot
        .rows
        .iter()
        .map(|row| row.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "[session={session_id}] [screenRevision={screen_revision}] [tool={tool_kind:?}] [capturedAtMs={}]\n{}\n\n",
        snapshot.captured_at_ms, rows
    )
}

pub fn build_rendered_screen_parsed_log_entry(
    session_id: &str,
    screen_revision: u64,
    entries: &[TerminalDebugHumanEntry],
) -> String {
    let body = if entries.is_empty() {
        "[none]".to_string()
    } else {
        entries
            .iter()
            .map(|entry| format!("- [{}] {}", entry.at_ms, entry.text))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!("[session={session_id}] [screenRevision={screen_revision}]\n{body}\n\n")
}

pub fn build_frontend_focus_log_entry(
    at_ms: u64,
    station_id: &str,
    session_id: Option<&str>,
    kind: &str,
    detail: Option<&str>,
) -> String {
    let session = session_id.unwrap_or("none");
    let detail = detail.unwrap_or("[none]");
    format!("[atMs={at_ms}] [station={station_id}] [session={session}] [kind={kind}]\n{detail}\n\n")
}

#[cfg(test)]
mod tests {
    use super::{
        build_frontend_focus_log_entry, build_rendered_screen_parsed_log_entry,
        build_rendered_screen_raw_log_entry, should_write_terminal_debug_log_for_build,
        TerminalDebugLogKind,
    };
    use crate::app_state::{RenderedScreenSnapshot, RenderedScreenSnapshotRow};
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

        assert!(entry.starts_with(
            "[session=session-1] [screenRevision=9] [tool=Codex] [capturedAtMs=1234]"
        ));
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
            build_frontend_focus_log_entry(42, "station-1", None, "focus", None),
            "[atMs=42] [station=station-1] [session=none] [kind=focus]\n[none]\n\n"
        );
        assert_eq!(
            build_frontend_focus_log_entry(
                43,
                "station-2",
                Some("session-2"),
                "blur",
                Some("lost focus")
            ),
            "[atMs=43] [station=station-2] [session=session-2] [kind=blur]\nlost focus\n\n"
        );
    }
}
