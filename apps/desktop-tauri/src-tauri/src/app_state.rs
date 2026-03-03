use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use vb_abstractions::{AllowAllPolicyEvaluator, SettingsScope, WorkspaceId, WorkspaceService};
use vb_git::GitService;
use vb_settings::{EffectiveSettings, JsonSettingsService, RuntimeSettings};
use vb_task::TaskService;
use vb_terminal::PtyTerminalProvider;
use vb_workspace::InMemoryWorkspaceService;

use crate::daemon_bridge::DaemonBridge;
use crate::filesystem_watcher::WorkspaceWatcherRegistry;

const EXTERNAL_REPLY_BUFFER_MAX_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone)]
pub struct ExternalReplyRelayTarget {
    pub trace_id: String,
    pub channel: String,
    pub account_id: String,
    pub peer_id: String,
    pub inbound_message_id: String,
    pub workspace_id: String,
    pub target_agent_id: String,
    pub injected_input: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalReplyDispatchPhase {
    Preview,
    Finalize,
}

#[derive(Debug, Clone)]
pub struct ExternalReplyDispatchCandidate {
    pub session_id: String,
    pub target: ExternalReplyRelayTarget,
    pub text: String,
    pub preview_message_id: Option<String>,
    pub phase: ExternalReplyDispatchPhase,
}

#[derive(Debug, Clone)]
struct ExternalReplyRelaySession {
    target: ExternalReplyRelayTarget,
    created_at_ms: u64,
    last_chunk_at_ms: u64,
    last_preview_sent_at_ms: u64,
    ended: bool,
    buffer: String,
    last_preview_text: String,
    preview_message_id: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub workspace_service: InMemoryWorkspaceService,
    pub terminal_provider: PtyTerminalProvider<InMemoryWorkspaceService, AllowAllPolicyEvaluator>,
    pub git_service: GitService<InMemoryWorkspaceService>,
    pub settings_service: JsonSettingsService,
    pub task_service: TaskService,
    pub daemon_bridge: DaemonBridge,
    window_workspace_bindings: Arc<Mutex<HashMap<String, String>>>,
    workspace_watchers: WorkspaceWatcherRegistry,
    external_reply_sessions: Arc<Mutex<HashMap<String, ExternalReplyRelaySession>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let workspace_service = InMemoryWorkspaceService::new();
        let terminal_provider =
            PtyTerminalProvider::new(workspace_service.clone(), AllowAllPolicyEvaluator);
        let git_service = GitService::new(workspace_service.clone());
        let settings_service = JsonSettingsService::default();
        let task_service = TaskService::default();
        Self {
            workspace_service,
            terminal_provider,
            git_service,
            settings_service,
            task_service,
            daemon_bridge: DaemonBridge::default(),
            window_workspace_bindings: Arc::new(Mutex::new(HashMap::new())),
            workspace_watchers: WorkspaceWatcherRegistry::default(),
            external_reply_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl AppState {
    pub fn bind_window_workspace(
        &self,
        window_label: &str,
        workspace_id: &str,
    ) -> Result<(), String> {
        let mut bindings = self.window_workspace_bindings.lock().map_err(|_| {
            "WORKSPACE_STATE_LOCK_POISONED: window bindings lock poisoned".to_string()
        })?;
        bindings.insert(window_label.to_string(), workspace_id.to_string());
        Ok(())
    }

    pub fn clear_window_workspace(&self, window_label: &str) -> Result<(), String> {
        let mut bindings = self.window_workspace_bindings.lock().map_err(|_| {
            "WORKSPACE_STATE_LOCK_POISONED: window bindings lock poisoned".to_string()
        })?;
        bindings.remove(window_label);
        Ok(())
    }

    pub fn window_workspace(&self, window_label: &str) -> Result<Option<String>, String> {
        let bindings = self.window_workspace_bindings.lock().map_err(|_| {
            "WORKSPACE_STATE_LOCK_POISONED: window bindings lock poisoned".to_string()
        })?;
        Ok(bindings.get(window_label).cloned())
    }

    pub fn ensure_workspace_watcher(
        &self,
        app: &tauri::AppHandle,
        workspace_id: &str,
        root: &str,
    ) -> Result<(), String> {
        let runtime = self
            .settings_service
            .load_runtime(Some(Path::new(root)))
            .map_err(|error| error.to_string())?;
        self.workspace_watchers.ensure_workspace(
            app,
            workspace_id,
            Path::new(root),
            runtime.filesystem.watcher,
        )
    }

    pub fn remove_workspace_watcher(&self, workspace_id: &str) -> Result<(), String> {
        self.workspace_watchers.remove_workspace(workspace_id)
    }

    pub fn reload_workspace_watcher(
        &self,
        app: &tauri::AppHandle,
        workspace_id: &str,
    ) -> Result<(), String> {
        let root = self.workspace_root_path(workspace_id)?;
        let root_display = root.to_string_lossy().to_string();
        let _ = self.remove_workspace_watcher(workspace_id);
        self.ensure_workspace_watcher(app, workspace_id, &root_display)
    }

    pub fn reload_all_workspace_watchers(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let workspaces = self
            .workspace_service
            .list()
            .map_err(|error| error.to_string())?;
        for workspace in workspaces {
            let _ = self.reload_workspace_watcher(app, workspace.workspace_id.as_str());
        }
        Ok(())
    }

    pub fn workspace_root_path(&self, workspace_id: &str) -> Result<PathBuf, String> {
        let workspace_id = WorkspaceId::new(workspace_id);
        let context = self
            .workspace_service
            .get_context(&workspace_id)
            .map_err(|error| error.to_string())?;
        Ok(PathBuf::from(context.root))
    }

    pub fn load_effective_settings(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<EffectiveSettings, String> {
        let workspace_root = match workspace_id {
            Some(workspace_id) => Some(self.workspace_root_path(workspace_id)?),
            None => None,
        };
        self.settings_service
            .load_effective(workspace_root.as_deref())
            .map_err(|error| error.to_string())
    }

    pub fn load_runtime_settings(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<RuntimeSettings, String> {
        let workspace_root = match workspace_id {
            Some(workspace_id) => Some(self.workspace_root_path(workspace_id)?),
            None => None,
        };
        self.settings_service
            .load_runtime(workspace_root.as_deref())
            .map_err(|error| error.to_string())
    }

    pub fn update_settings(
        &self,
        scope: SettingsScope,
        workspace_id: Option<&str>,
        patch: &serde_json::Value,
    ) -> Result<EffectiveSettings, String> {
        let workspace_root = match workspace_id {
            Some(workspace_id) => Some(self.workspace_root_path(workspace_id)?),
            None => None,
        };
        self.settings_service
            .update(scope, workspace_root.as_deref(), patch)
            .map_err(|error| error.to_string())
    }

    pub fn reset_settings(
        &self,
        scope: SettingsScope,
        workspace_id: Option<&str>,
        keys: &[String],
    ) -> Result<EffectiveSettings, String> {
        let workspace_root = match workspace_id {
            Some(workspace_id) => Some(self.workspace_root_path(workspace_id)?),
            None => None,
        };
        self.settings_service
            .reset(scope, workspace_root.as_deref(), keys)
            .map_err(|error| error.to_string())
    }

    pub fn bind_external_reply_session(
        &self,
        session_id: &str,
        target: ExternalReplyRelayTarget,
        now_ms: u64,
    ) -> Result<(), String> {
        if session_id.trim().is_empty() {
            return Err("CHANNEL_REPLY_SESSION_INVALID: session id is required".to_string());
        }
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        guard.insert(
            session_id.to_string(),
            ExternalReplyRelaySession {
                target,
                created_at_ms: now_ms,
                last_chunk_at_ms: now_ms,
                last_preview_sent_at_ms: 0,
                ended: false,
                buffer: String::new(),
                last_preview_text: String::new(),
                preview_message_id: None,
            },
        );
        Ok(())
    }

    pub fn append_external_reply_chunk(
        &self,
        session_id: &str,
        chunk: &[u8],
        ts_ms: u64,
    ) -> Result<(), String> {
        if chunk.is_empty() {
            return Ok(());
        }
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        let Some(session) = guard.get_mut(session_id) else {
            return Ok(());
        };
        session.last_chunk_at_ms = ts_ms;
        let text = sanitize_terminal_chunk(chunk);
        if text.is_empty() {
            return Ok(());
        }
        session.buffer.push_str(&text);
        trim_utf8_tail(&mut session.buffer, EXTERNAL_REPLY_BUFFER_MAX_BYTES);
        Ok(())
    }

    pub fn mark_external_reply_session_ended(
        &self,
        session_id: &str,
        ts_ms: u64,
    ) -> Result<(), String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        if let Some(session) = guard.get_mut(session_id) {
            session.ended = true;
            session.last_chunk_at_ms = ts_ms;
        }
        Ok(())
    }

    pub fn set_external_reply_preview_message_id(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> Result<(), String> {
        let message_id = message_id.trim();
        if message_id.is_empty() {
            return Ok(());
        }
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        if let Some(session) = guard.get_mut(session_id) {
            session.preview_message_id = Some(message_id.to_string());
        }
        Ok(())
    }

    pub fn take_external_reply_dispatch_candidates(
        &self,
        now_ms: u64,
        idle_threshold_ms: u64,
        max_wait_ms: u64,
        preview_throttle_ms: u64,
        preview_min_chars: usize,
    ) -> Result<Vec<ExternalReplyDispatchCandidate>, String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        let mut candidates = Vec::new();
        let mut ready_final_session_ids = Vec::new();

        for (session_id, session) in guard.iter_mut() {
            let normalized_text =
                normalize_reply_text(&session.buffer, session.target.injected_input.as_deref());
            let has_text = !normalized_text.is_empty();
            let idle_elapsed = now_ms.saturating_sub(session.last_chunk_at_ms) >= idle_threshold_ms;
            let expired = now_ms.saturating_sub(session.created_at_ms) >= max_wait_ms;
            let should_finalize_with_text = has_text
                && (session.ended
                    || expired
                    || (session.preview_message_id.is_some() && idle_elapsed));
            let should_drop_without_text = !has_text && (session.ended || expired);

            if should_finalize_with_text || should_drop_without_text {
                ready_final_session_ids.push(session_id.clone());
                continue;
            }
            if !has_text {
                continue;
            }
            let preview_enabled = normalized_text.chars().count() >= preview_min_chars
                || session.preview_message_id.is_some();
            if !preview_enabled {
                continue;
            }
            let preview_changed = normalized_text != session.last_preview_text;
            if !preview_changed {
                continue;
            }
            let preview_due =
                now_ms.saturating_sub(session.last_preview_sent_at_ms) >= preview_throttle_ms;
            if !preview_due {
                continue;
            }
            session.last_preview_sent_at_ms = now_ms;
            session.last_preview_text = normalized_text.clone();
            candidates.push(ExternalReplyDispatchCandidate {
                session_id: session_id.clone(),
                target: session.target.clone(),
                text: normalized_text,
                preview_message_id: session.preview_message_id.clone(),
                phase: ExternalReplyDispatchPhase::Preview,
            });
        }

        for session_id in ready_final_session_ids {
            let Some(session) = guard.remove(&session_id) else {
                continue;
            };
            let normalized_text =
                normalize_reply_text(&session.buffer, session.target.injected_input.as_deref());
            if normalized_text.is_empty() {
                continue;
            }
            candidates.push(ExternalReplyDispatchCandidate {
                session_id,
                target: session.target,
                text: normalized_text,
                preview_message_id: session.preview_message_id,
                phase: ExternalReplyDispatchPhase::Finalize,
            });
        }

        Ok(candidates)
    }
}

fn trim_utf8_tail(buffer: &mut String, max_bytes: usize) {
    if buffer.len() <= max_bytes {
        return;
    }
    let mut start = buffer.len().saturating_sub(max_bytes);
    while start < buffer.len() && !buffer.is_char_boundary(start) {
        start += 1;
    }
    if start >= buffer.len() {
        buffer.clear();
        return;
    }
    *buffer = buffer[start..].to_string();
}

fn sanitize_terminal_chunk(chunk: &[u8]) -> String {
    let raw = String::from_utf8_lossy(chunk);
    strip_ansi_sequences(&raw)
}

fn strip_ansi_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    let _ = chars.next();
                    for next in chars.by_ref() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                    continue;
                }
                Some(']') => {
                    let _ = chars.next();
                    let mut prev_escape = false;
                    for next in chars.by_ref() {
                        if next == '\u{7}' {
                            break;
                        }
                        if prev_escape && next == '\\' {
                            break;
                        }
                        prev_escape = next == '\u{1b}';
                    }
                    continue;
                }
                _ => continue,
            }
        }
        if ch == '\r' {
            output.push('\n');
            continue;
        }
        if ch == '\u{8}' {
            let _ = output.pop();
            continue;
        }
        if ch.is_control() && ch != '\n' && ch != '\t' {
            continue;
        }
        output.push(ch);
    }
    output
}

fn normalize_reply_text(input: &str, injected_input: Option<&str>) -> String {
    let mut lines = Vec::new();
    let mut blank_count = 0usize;
    for line in input.lines() {
        let trimmed_end = line.trim_end();
        if should_skip_external_reply_line(trimmed_end) {
            continue;
        }
        if should_skip_cli_prompt_line(trimmed_end) {
            continue;
        }
        if should_skip_runtime_noise_line(trimmed_end) {
            continue;
        }
        if is_echo_of_injected_line(trimmed_end, injected_input) {
            continue;
        }
        if trimmed_end.is_empty() {
            blank_count += 1;
            if blank_count > 1 {
                continue;
            }
            lines.push(String::new());
            continue;
        }
        blank_count = 0;
        lines.push(trimmed_end.to_string());
    }
    while lines.first().map(|line| line.is_empty()).unwrap_or(false) {
        let _ = lines.remove(0);
    }
    while lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        let _ = lines.pop();
    }
    let normalized = lines.join("\n");
    let suppressed = suppress_injected_input_echo(&normalized, injected_input);
    extract_last_assistant_block(&suppressed).unwrap_or(suppressed)
}

fn should_skip_external_reply_line(line: &str) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("[vb-task] assigned task_")
        || normalized.contains("echo '[vb-task] assigned task_")
}

fn should_skip_runtime_noise_line(line: &str) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }
    if normalized
        .strip_suffix('%')
        .is_some_and(|prefix| !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit()))
    {
        return true;
    }
    let lower = normalized.to_ascii_lowercase();
    if lower.contains("esc to interrupt") {
        return true;
    }
    if lower.contains("implement {feature}") {
        return true;
    }
    if lower.starts_with("› ") && normalized.chars().count() <= 3 {
        return true;
    }
    if lower.starts_with("• working") || lower.starts_with("working (") {
        return true;
    }
    if lower.contains("gpt-") && lower.contains("·") && lower.contains("% left") {
        return true;
    }
    looks_like_spinner_fragment(normalized)
}

fn looks_like_spinner_fragment(line: &str) -> bool {
    let stripped = line
        .trim_start_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '•' | '◦' | '›' | '>' | '|' | '.')
        })
        .trim();
    if stripped.is_empty() {
        return true;
    }
    if stripped.len() <= 2 && stripped.chars().all(|ch| ch.is_ascii_digit()) {
        return true;
    }
    if !stripped.is_ascii() {
        return false;
    }
    if stripped.len() <= 8
        && stripped
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return true;
    }
    let token = stripped.to_ascii_lowercase();
    matches!(
        token.as_str(),
        "w" | "wo"
            | "wor"
            | "work"
            | "worki"
            | "workin"
            | "working"
            | "o"
            | "or"
            | "r"
            | "rk"
            | "k"
            | "ki"
            | "i"
            | "in"
            | "n"
            | "ng"
            | "g"
            | "wng"
            | "wog"
            | "wlen"
            | "lent"
    )
}

fn should_skip_cli_prompt_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("› ")
        || trimmed.starts_with("❯ ")
        || trimmed.starts_with("$ ")
        || trimmed == ">"
}

fn normalize_prompt_prefixed_line(line: &str) -> &str {
    line.trim_start_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, '>' | '$' | '%' | '#' | '❯' | '›' | '•' | '◦' | '|')
    })
    .trim()
}

fn is_echo_of_injected_line(line: &str, injected_input: Option<&str>) -> bool {
    let Some(injected) = injected_input
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    normalize_prompt_prefixed_line(line) == injected
}

fn extract_last_assistant_block(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut start: Option<usize> = None;
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("• ") && !trimmed.to_ascii_lowercase().starts_with("• working") {
            start = Some(idx);
        }
    }
    let start = start?;
    let mut result = Vec::new();
    result.push(lines[start].trim_end().to_string());
    for line in lines.iter().skip(start + 1) {
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            if result.last().is_some_and(|last| !last.is_empty()) {
                result.push(String::new());
            }
            continue;
        }
        if should_skip_runtime_noise_line(trimmed) {
            continue;
        }
        if trimmed.starts_with("› ")
            || trimmed.starts_with("◦ ")
            || trimmed.starts_with("> ")
            || trimmed.starts_with("❯ ")
            || trimmed.starts_with("$ ")
            || trimmed.starts_with("# ")
        {
            // CLI/TUI prompt or transient marker can be interleaved in stream output;
            // skip it instead of terminating the assistant block early.
            continue;
        }
        if trimmed.starts_with("• ") {
            if !trimmed.to_ascii_lowercase().starts_with("• working") {
                break;
            }
            continue;
        }
        result.push(line.trim_end().to_string());
    }
    while result
        .first()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        let _ = result.remove(0);
    }
    while result
        .last()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        let _ = result.pop();
    }
    let joined = result.join("\n").trim().to_string();
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn suppress_injected_input_echo(text: &str, injected_input: Option<&str>) -> String {
    let Some(injected) = injected_input
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return text.to_string();
    };
    let normalized = text.trim();
    if normalized == injected {
        return String::new();
    }
    if let Some(tail) = normalized.strip_prefix(injected) {
        let tail = tail.trim_start_matches('\n').trim().to_string();
        return tail;
    }
    let mut lines = normalized.lines();
    if let Some(first_line) = lines.next() {
        let first_normalized = first_line
            .trim_start_matches(|ch: char| {
                ch.is_whitespace() || matches!(ch, '>' | '$' | '%' | '#' | '❯' | '›')
            })
            .trim();
        if first_normalized == injected {
            let tail = lines.collect::<Vec<_>>().join("\n").trim().to_string();
            return tail;
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_reply_text, sanitize_terminal_chunk, should_skip_cli_prompt_line,
        should_skip_external_reply_line, should_skip_runtime_noise_line, AppState,
        ExternalReplyDispatchPhase, ExternalReplyRelayTarget,
    };

    fn now_ms_for_test(value: u64) -> u64 {
        value
    }

    #[test]
    fn sanitize_terminal_chunk_strips_ansi() {
        let text = sanitize_terminal_chunk(b"\x1b[31mhello\x1b[0m\r\nworld");
        assert_eq!(text, "hello\n\nworld");
    }

    #[test]
    fn normalize_reply_text_collapses_blank_lines() {
        let normalized = normalize_reply_text("\n\nhello\n\n\nworld\n\n", None);
        assert_eq!(normalized, "hello\n\nworld");
    }

    #[test]
    fn normalize_reply_text_skips_vb_task_assignment_lines() {
        let normalized = normalize_reply_text(
            "echo '[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md'\n\
[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md\n\
agent output line",
            None,
        );
        assert_eq!(normalized, "agent output line");
    }

    #[test]
    fn should_skip_external_reply_line_only_for_vb_task_markers() {
        assert!(should_skip_external_reply_line(
            "echo '[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md'"
        ));
        assert!(should_skip_external_reply_line(
            "[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md"
        ));
        assert!(!should_skip_external_reply_line("plain agent response"));
    }

    #[test]
    fn normalize_reply_text_suppresses_injected_input_echo() {
        let only_echo = normalize_reply_text("hello world", Some("hello world"));
        assert_eq!(only_echo, "");

        let with_tail = normalize_reply_text("hello world\nresult line", Some("hello world"));
        assert_eq!(with_tail, "result line");

        let with_prompt_prefix =
            normalize_reply_text("> hello world\nagent response", Some("hello world"));
        assert_eq!(with_prompt_prefix, "agent response");
    }

    #[test]
    fn normalize_reply_text_skips_runtime_noise_lines() {
        let normalized = normalize_reply_text(
            "› hi\n\
• Working (0s • esc to interrupt)\n\
› Implement {feature}\n\
gpt-5.3-codex · gpt-5.3-codex medium · /mnt/c/personal/vbCode · main · 100% left\n\
◦\n\
Wo\n\
• 哈哈哈 😄\n\
  在的，你想先从哪个任务开始？",
            Some("hi"),
        );
        assert_eq!(normalized, "• 哈哈哈 😄\n在的，你想先从哪个任务开始？");
    }

    #[test]
    fn should_skip_runtime_noise_line_filters_status_and_spinner() {
        assert!(should_skip_runtime_noise_line(
            "• Working (0s • esc to interrupt)"
        ));
        assert!(should_skip_runtime_noise_line(
            "gpt-5.3-codex · gpt-5.3-codex medium · /tmp · 100% left"
        ));
        assert!(should_skip_runtime_noise_line("› Implement {feature}"));
        assert!(should_skip_runtime_noise_line("Wo"));
        assert!(should_skip_runtime_noise_line("Wng1"));
        assert!(should_skip_runtime_noise_line("100%"));
        assert!(should_skip_runtime_noise_line("Wng"));
        assert!(should_skip_runtime_noise_line("Wog"));
        assert!(!should_skip_runtime_noise_line("• 哈哈哈 😄"));
    }

    #[test]
    fn should_skip_cli_prompt_lines() {
        assert!(should_skip_cli_prompt_line(
            "› Find and fix a bug in @filename"
        ));
        assert!(should_skip_cli_prompt_line("❯ hi"));
        assert!(should_skip_cli_prompt_line("$ ls"));
        assert!(!should_skip_cli_prompt_line("• 我在，直接说你想做的事。"));
    }

    #[test]
    fn normalize_reply_text_extracts_last_assistant_block() {
        let normalized = normalize_reply_text(
            "› Write tests for @filename\n\
› 👻\n\
› Write tests for @filename\n\
Wng1\n\
Wog\n\
• 我在，直接说你想做的事。\n\
› Write tests for @filename\n\
wlen\n\
› Write tests for @filename",
            Some("Write tests for @filename"),
        );
        assert_eq!(normalized, "• 我在，直接说你想做的事。");
    }

    #[test]
    fn normalize_reply_text_keeps_multiline_block_with_interleaved_prompts() {
        let normalized = normalize_reply_text(
            "• 在快与慢之间，找回生活的节奏\n\
\n\
› hi\n\
  城市里的每一天都很快。\n\
  但真正重要的东西，往往生长得很慢。\n\
› Write tests for @filename\n\
  人生不是短跑，而是一场漫长而值得认真走完的旅程。",
            Some("hi"),
        );
        assert_eq!(
            normalized,
            "• 在快与慢之间，找回生活的节奏\n\n城市里的每一天都很快。\n但真正重要的东西，往往生长得很慢。\n人生不是短跑，而是一场漫长而值得认真走完的旅程。"
        );
    }

    #[test]
    fn external_reply_flush_is_single_shot_after_idle() {
        let state = AppState::default();
        let target = ExternalReplyRelayTarget {
            trace_id: "trace_1".to_string(),
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_id: "12345".to_string(),
            inbound_message_id: "m1".to_string(),
            workspace_id: "ws".to_string(),
            target_agent_id: "agent-1".to_string(),
            injected_input: None,
        };
        state
            .bind_external_reply_session("s1", target, now_ms_for_test(1_000))
            .expect("bind session");
        state
            .append_external_reply_chunk("s1", b"hello", now_ms_for_test(1_100))
            .expect("append chunk");

        let none_ready = state
            .take_external_reply_dispatch_candidates(
                now_ms_for_test(2_000),
                1_000,
                10_000,
                200,
                usize::MAX,
            )
            .expect("take candidates");
        assert!(none_ready.is_empty());

        let ready = state
            .take_external_reply_dispatch_candidates(
                now_ms_for_test(2_200),
                1_000,
                10_000,
                200,
                usize::MAX,
            )
            .expect("take candidates");
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].phase, ExternalReplyDispatchPhase::Finalize);
        assert_eq!(ready[0].text, "hello");

        let already_taken = state
            .take_external_reply_dispatch_candidates(
                now_ms_for_test(3_500),
                1_000,
                10_000,
                200,
                usize::MAX,
            )
            .expect("take candidates");
        assert!(already_taken.is_empty());
    }

    #[test]
    fn external_reply_binding_kept_when_no_output_yet() {
        let state = AppState::default();
        let target = ExternalReplyRelayTarget {
            trace_id: "trace_2".to_string(),
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_id: "12345".to_string(),
            inbound_message_id: "m2".to_string(),
            workspace_id: "ws".to_string(),
            target_agent_id: "agent-2".to_string(),
            injected_input: None,
        };
        state
            .bind_external_reply_session("s2", target, now_ms_for_test(1_000))
            .expect("bind session");

        let none_ready = state
            .take_external_reply_dispatch_candidates(
                now_ms_for_test(4_000),
                1_000,
                10_000,
                200,
                usize::MAX,
            )
            .expect("take candidates");
        assert!(none_ready.is_empty());

        state
            .append_external_reply_chunk("s2", b"later reply", now_ms_for_test(4_100))
            .expect("append chunk");
        let ready = state
            .take_external_reply_dispatch_candidates(
                now_ms_for_test(5_200),
                1_000,
                10_000,
                200,
                usize::MAX,
            )
            .expect("take candidates");
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].phase, ExternalReplyDispatchPhase::Finalize);
        assert_eq!(ready[0].text, "later reply");
    }

    #[test]
    fn external_reply_dispatch_emits_preview_then_finalize() {
        let state = AppState::default();
        let target = ExternalReplyRelayTarget {
            trace_id: "trace_3".to_string(),
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_id: "12345".to_string(),
            inbound_message_id: "m3".to_string(),
            workspace_id: "ws".to_string(),
            target_agent_id: "agent-3".to_string(),
            injected_input: None,
        };
        state
            .bind_external_reply_session("s3", target, now_ms_for_test(1_000))
            .expect("bind session");
        state
            .append_external_reply_chunk(
                "s3",
                b"this is a long enough preview text",
                now_ms_for_test(1_100),
            )
            .expect("append chunk");

        let preview = state
            .take_external_reply_dispatch_candidates(now_ms_for_test(2_200), 5_000, 20_000, 200, 10)
            .expect("take preview candidates");
        assert_eq!(preview.len(), 1);
        assert_eq!(preview[0].phase, ExternalReplyDispatchPhase::Preview);
        assert!(preview[0].preview_message_id.is_none());

        state
            .set_external_reply_preview_message_id("s3", "msg_telegram_preview")
            .expect("set preview message");
        state
            .mark_external_reply_session_ended("s3", now_ms_for_test(2_500))
            .expect("mark ended");

        let final_candidates = state
            .take_external_reply_dispatch_candidates(now_ms_for_test(2_700), 5_000, 20_000, 200, 10)
            .expect("take final candidates");
        assert_eq!(final_candidates.len(), 1);
        assert_eq!(
            final_candidates[0].phase,
            ExternalReplyDispatchPhase::Finalize
        );
        assert_eq!(
            final_candidates[0].preview_message_id.as_deref(),
            Some("msg_telegram_preview")
        );
    }
}
