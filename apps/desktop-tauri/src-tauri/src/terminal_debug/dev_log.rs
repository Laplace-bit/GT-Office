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
