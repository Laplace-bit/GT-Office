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
            let should_finalize_with_text = has_text && (session.ended || expired || idle_elapsed);
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
    // First convert to string, preserving \r for proper handling
    let raw_text = String::from_utf8_lossy(chunk);
    // Strip ANSI escapes (note: strip_ansi_escapes silently drops \r via VTE parser)
    // So we need to handle \r before stripping, or use a different approach
    // Let's normalize \r first, then strip ANSI
    let normalized_cr = normalize_carriage_returns(&raw_text);
    let stripped = strip_ansi_escapes::strip_str(&normalized_cr);
    normalize_terminal_text(&stripped)
}

/// Pre-process carriage returns before ANSI stripping.
/// This is necessary because strip_ansi_escapes uses VTE parser which silently
/// drops \r characters, preventing us from handling terminal overwrites correctly.
fn normalize_carriage_returns(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            // Check if \n follows (standard line ending \r\n)
            if chars.peek() == Some(&'\n') {
                // \r\n is a standard line ending, just convert to \n
                output.push('\n');
                let _ = chars.next();
            } else {
                // Lone \r clears the current line (for terminal overwriting)
                if let Some(last_newline_pos) = output.rfind('\n') {
                    output.truncate(last_newline_pos + 1);
                } else {
                    output.clear();
                }
            }
        } else {
            output.push(ch);
        }
    }
    output
}

/// Normalize raw terminal text after ANSI escape sequences have been stripped.
///
/// 1. Backspace (BS, 0x08) → pop previous character (terminal overwrite emulation)
/// 2. Strip remaining control characters except LF and TAB
/// Note: CR handling is done in normalize_carriage_returns before ANSI stripping
fn normalize_terminal_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '\u{8}' => {
                // Backspace: remove the last character (terminal overwrite emulation)
                let _ = output.pop();
            }
            c if c.is_control() && c != '\n' && c != '\t' => {
                // Drop all other control characters
            }
            c => output.push(c),
        }
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
        if should_skip_startup_banner_line(trimmed_end) {
            continue;
        }
        if should_skip_log_prefix_line(trimmed_end) {
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
    // Terminal percentage indicator (e.g. "100%")
    if normalized
        .strip_suffix('%')
        .is_some_and(|prefix| !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit()))
    {
        return true;
    }
    let lower = normalized.to_ascii_lowercase();
    // Agent status/working indicators (tool-agnostic)
    if lower.contains("esc to interrupt") {
        return true;
    }
    if lower.contains("implement {feature}") {
        return true;
    }
    if lower.starts_with("• working") || lower.starts_with("working (") {
        return true;
    }
    // Empty prompt marker (e.g. just "› " with nothing after)
    if lower.starts_with("› ") && normalized.chars().count() <= 3 {
        return true;
    }
    // Menu items with status bar on same line (e.g., "› Command    model · quality · /path")
    // These lines contain both a menu prompt and a status bar
    if normalized.contains('›') && normalized.matches('·').count() >= 2 {
        // Check if there's a path segment after the dots
        if let Some(after_prompt) = normalized.split('›').nth(1) {
            if after_prompt.contains('·') {
                let segments: Vec<&str> = after_prompt.split('·').map(str::trim).collect();
                let has_path = segments.iter().any(|seg| {
                    seg.starts_with('/')
                        || seg.starts_with('~')
                        || seg.starts_with("C:\\")
                        || seg.starts_with("c:\\")
                });
                if has_path {
                    return true;
                }
            }
        }
    }
    // Generic status words that appear alone with punctuation (terminal status indicators)
    // Only match when they appear as standalone status messages, not as part of content
    if matches!(
        lower.as_str(),
        "ready." | "done." | "complete." | "completed." | "finished." | "ok." | "success."
    ) {
        return true;
    }
    // Help hints and usage tips
    if lower.starts_with("type ") && (lower.contains("help") || lower.contains("for more")) {
        return true;
    }
    if lower.contains("press ") && (lower.contains("to ") || lower.contains("for ")) {
        return true;
    }
    // Generalized TUI status bar detection (works across Codex CLI, Claude
    // Code, Gemini CLI, and any ratatui/ink/blessed-based TUI agent)
    if is_tui_status_bar_line(normalized) {
        return true;
    }
    is_known_spinner_token(normalized)
}

/// Detect TUI status bar lines by structural pattern.
///
/// CLI agent TUIs (Codex, Claude Code, Gemini CLI, etc.) render status bars
/// that share a common structural pattern: segments separated by middle-dot
/// (`·`) containing model info, paths, and resource indicators. This detector
/// is tool-agnostic — it looks for the structural signature rather than
/// specific tool names.
///
/// Matched patterns include:
/// - `gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project · 100%…`
/// - `claude-sonnet-4 · /home/user/project · 95% left`
/// - `gemini-2.5-pro · medium · ~/workspace · 42% left`
/// - `gpt-5.3-codex · gpt-5.3-codex xhigh · /mnt/…` (model + quality + path)
fn is_tui_status_bar_line(line: &str) -> bool {
    let trimmed = line.trim();
    // Must contain at least 2 middle-dot separators (3+ segments)
    let dot_count = trimmed.matches('·').count();
    if dot_count < 2 {
        return false;
    }
    let segments: Vec<&str> = trimmed.split('·').map(str::trim).collect();
    let has_path_segment = segments.iter().any(|seg| {
        let s = seg.trim();
        s.starts_with('/')
            || s.starts_with('~')
            || s.starts_with("C:\\")
            || s.starts_with("c:\\")
            || s.contains("/.")
            || s.contains("/org/")
    });
    let has_resource_segment = segments.iter().any(|seg| {
        let s = seg.trim().to_ascii_lowercase();
        s.contains("% left")
            || s.ends_with('%')
            || s.ends_with("%…")
            || s.ends_with("% remaining")
            || s.contains("tokens")
            || s.contains("context")
    });

    // Check for model name patterns (common in AI CLI tools)
    let has_model_segment = segments.iter().any(|seg| {
        let s = seg.trim().to_ascii_lowercase();
        // Model names often contain: gpt, claude, gemini, codex, sonnet, opus, haiku
        // or quality indicators: high, medium, low, xhigh
        s.contains("gpt")
            || s.contains("claude")
            || s.contains("gemini")
            || s.contains("codex")
            || s.contains("sonnet")
            || s.contains("opus")
            || s.contains("haiku")
            || s == "high"
            || s == "medium"
            || s == "low"
            || s == "xhigh"
            || s.contains("xhigh")
    });

    // A status bar line typically has:
    // 1. Path + resource indicator, OR
    // 2. Path + model name (common pattern: "model · quality · /path"), OR
    // 3. 3+ segments with path (very likely status bar)
    has_path_segment && (has_resource_segment || has_model_segment || dot_count >= 3)
}

/// Detect TUI-padded content fragments.
///
/// NOTE: Currently unused. TUI-padded lines often contain legitimate response
/// content that was cursor-positioned by the TUI framework. We keep this
/// function for potential future use with additional context-aware heuristics.
#[allow(dead_code)]
fn is_tui_padded_fragment(line: &str) -> bool {
    let total_len = line.len();
    let trimmed = line.trim_start();
    let leading_spaces = total_len - trimmed.len();
    if leading_spaces < 20 {
        return false;
    }
    let content_chars = trimmed.trim_end().chars().count();
    // TUI padding: lots of whitespace, small content fragment
    // (content shorter than leading whitespace, and reasonably small)
    content_chars > 0 && content_chars < leading_spaces && content_chars < 80
}

/// Skip startup banners, version info, and initialization messages.
///
/// CLI tools and agents often output startup information that should not be
/// included in the response to external channels. This function detects:
/// - Version information (e.g., "v1.0.0", "version 2.3.4")
/// - Tool name banners (e.g., "Claude Code", "Gemini CLI")
/// - Initialization messages (e.g., "Initializing...", "Loading model...")
/// - Connection status (e.g., "Connected to API", "Authenticating...")
/// - Configuration messages (e.g., "Configuration loaded", "Settings applied")
fn should_skip_startup_banner_line(line: &str) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }
    let lower = normalized.to_ascii_lowercase();

    // Version patterns: "v1.0.0", "version 2.3", "ver 1.2"
    if lower.starts_with("v") && lower.chars().nth(1).map_or(false, |c| c.is_ascii_digit()) {
        return true;
    }
    if lower.starts_with("version ") || lower.starts_with("ver ") {
        return true;
    }

    // Initialization and loading messages
    if lower.starts_with("initializing") || lower.starts_with("loading") {
        return true;
    }
    if lower.starts_with("starting") && !lower.contains("task") {
        return true;
    }

    // Connection and authentication status
    if lower.starts_with("connected") || lower.starts_with("authenticating") {
        return true;
    }
    if lower.starts_with("connecting to") || lower.starts_with("authenticated") {
        return true;
    }

    // Configuration messages
    if lower.contains("configuration") && (lower.contains("loaded") || lower.contains("applied")) {
        return true;
    }
    if lower.contains("settings") && (lower.contains("loaded") || lower.contains("applied")) {
        return true;
    }

    // Welcome messages and banners (but avoid false positives with actual content)
    if lower.starts_with("welcome to") || lower.starts_with("welcome!") {
        return true;
    }

    // Tool initialization complete messages
    if matches!(lower.as_str(), "ready." | "initialized." | "started.") {
        return true;
    }

    false
}

/// Skip lines with log level prefixes.
///
/// Many CLI tools output structured logs with level prefixes that should not
/// be included in responses. This function detects:
/// - Log level prefixes: [INFO], [DEBUG], [WARN], [ERROR], [STATUS], [TRACE]
/// - Timestamp prefixes: [2024-03-04 10:30:45], [10:30:45]
/// - Combined patterns: [INFO] [2024-03-04] message
fn should_skip_log_prefix_line(line: &str) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }

    // Check for log level prefixes at the start
    let lower = normalized.to_ascii_lowercase();
    if lower.starts_with("[info]")
        || lower.starts_with("[debug]")
        || lower.starts_with("[warn]")
        || lower.starts_with("[warning]")
        || lower.starts_with("[error]")
        || lower.starts_with("[status]")
        || lower.starts_with("[trace]")
        || lower.starts_with("[log]")
    {
        return true;
    }

    // Check for timestamp patterns: [YYYY-MM-DD HH:MM:SS] or [HH:MM:SS]
    if normalized.starts_with('[') {
        if let Some(end_bracket) = normalized.find(']') {
            let bracket_content = &normalized[1..end_bracket];
            // Timestamp pattern: contains digits, colons, and possibly dashes/spaces
            if bracket_content.len() >= 8
                && bracket_content
                    .chars()
                    .all(|c| c.is_ascii_digit() || matches!(c, ':' | '-' | ' ' | '.'))
            {
                return true;
            }
        }
    }

    false
}

/// Match only known terminal spinner/progress partial rendering tokens.
/// These are fragmentary text that appear during progressive rendering of
/// "Working" or similar status indicators.
///
/// IMPORTANT: This function intentionally uses a closed set of known tokens
/// rather than heuristic matching, to avoid eating legitimate short content.
fn is_known_spinner_token(line: &str) -> bool {
    let stripped = line
        .trim_start_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '•' | '◦' | '›' | '>' | '|' | '.')
        })
        .trim();
    if stripped.is_empty() {
        return true;
    }
    // Non-ASCII content is never a spinner token — this protects CJK, emoji, etc.
    if !stripped.is_ascii() {
        return false;
    }
    let token = stripped.to_ascii_lowercase();
    // Closed set: partial renderings of "Working" and known transient fragments
    matches!(
        token.as_str(),
        "w" | "wo"
            | "wor"
            | "work"
            | "worki"
            | "workin"
            | "working"
            | "wng"
            | "wog"
            | "wlen"
            | "lent"
    )
}

/// Skip lines that are purely CLI prompt markers with a command/placeholder.
/// Only skips when the prompt character is followed by content that looks like
/// a CLI command or empty prompt — not arbitrary user content.
fn should_skip_cli_prompt_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    // Bare prompt characters with no meaningful content
    if trimmed == ">" || trimmed == "$" || trimmed == "›" || trimmed == "❯" {
        return true;
    }
    // Prompt followed by a command-like token (starts with prompt char + space)
    if let Some(after) = trimmed
        .strip_prefix("› ")
        .or_else(|| trimmed.strip_prefix("❯ "))
        .or_else(|| trimmed.strip_prefix("$ "))
    {
        let after = after.trim();
        // Skip if the content after prompt looks like a typed command
        // (contains only ASCII, common CLI patterns)
        if after.is_ascii() || after.is_empty() {
            return true;
        }
    }
    false
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

/// Extract the last assistant response block from terminal output.
///
/// Assistant blocks start with a line beginning with `• ` (not `• working`).
/// Once inside a block, content is preserved faithfully. Only known TUI
/// artifacts (status bars, padded fragments) and interleaved prompts are
/// skipped to avoid eating legitimate response content.
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
        // A new assistant block marker terminates the current block
        if trimmed.starts_with("• ") {
            if !trimmed.to_ascii_lowercase().starts_with("• working") {
                break;
            }
            // "• Working" lines are status indicators, skip them
            continue;
        }
        // Skip TUI status bar lines that get interleaved during streaming
        if is_tui_status_bar_line(trimmed) {
            continue;
        }
        // Skip only pure CLI prompt lines that are clearly interleaved
        if is_interleaved_prompt_line(trimmed) {
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

/// Detect lines that are clearly interleaved CLI prompts within an assistant block.
/// Only matches patterns that are unambiguously prompt/TUI artifacts.
fn is_interleaved_prompt_line(trimmed: &str) -> bool {
    // Prompt characters followed by ASCII command text (typed commands)
    for prefix in ["› ", "❯ ", "$ ", "◦ "] {
        if let Some(after) = trimmed.strip_prefix(prefix) {
            if after.trim().is_ascii() {
                return true;
            }
        }
    }
    false
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
#[path = "app_state_tests.rs"]
mod tests;
