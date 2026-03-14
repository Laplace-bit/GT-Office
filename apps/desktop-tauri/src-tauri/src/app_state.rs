use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tracing::debug;
use vb_abstractions::{AllowAllPolicyEvaluator, SettingsScope, WorkspaceId, WorkspaceService};
use vb_ai_config::StoredAiConfigPreview;
use vb_git::GitService;
use vb_settings::{EffectiveSettings, JsonSettingsService, RuntimeSettings};
use vb_task::AgentToolKind;
use vb_task::TaskService;
use vb_terminal::PtyTerminalProvider;
use vb_workspace::InMemoryWorkspaceService;

use crate::daemon_bridge::DaemonBridge;
use crate::external_tool_profiles::ToolScreenProfile;
use crate::filesystem_watcher::WorkspaceWatcherRegistry;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalInteractionDispatchPhase {
    Show,
    Clear,
}

#[derive(Debug, Clone)]
pub struct ExternalReplyDispatchCandidate {
    pub session_id: String,
    pub target: ExternalReplyRelayTarget,
    pub text: String,
    pub preview_message_id: Option<String>,
    pub phase: ExternalReplyDispatchPhase,
}

fn channel_supports_preview(channel: &str) -> bool {
    channel.trim().eq_ignore_ascii_case("telegram")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalInteractionPromptKind {
    Permission,
    Menu,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalInteractionOption {
    pub label: String,
    pub submit_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalInteractionPrompt {
    pub kind: ExternalInteractionPromptKind,
    pub title: String,
    pub options: Vec<ExternalInteractionOption>,
    pub hint: Option<String>,
    start_row: u32,
    end_row: u32,
}

impl ExternalInteractionPrompt {
    pub(crate) fn signature(&self) -> String {
        let kind = match self.kind {
            ExternalInteractionPromptKind::Permission => "permission",
            ExternalInteractionPromptKind::Menu => "menu",
        };
        let options = self
            .options
            .iter()
            .map(|option| format!("{}=>{}", option.label, option.submit_text))
            .collect::<Vec<_>>()
            .join("|");
        format!(
            "{kind}\u{1f}{}\u{1f}{}\u{1f}{}",
            self.title,
            self.hint.clone().unwrap_or_default(),
            options
        )
    }

    fn contains_row(&self, row_index: u32) -> bool {
        row_index >= self.start_row && row_index <= self.end_row
    }

    fn matches_input(&self, input: &str) -> bool {
        let normalized = input.trim();
        if normalized.is_empty() {
            return false;
        }
        self.options
            .iter()
            .any(|option| option.submit_text == normalized)
    }
}

#[derive(Debug, Clone)]
pub struct ExternalInteractionDispatchCandidate {
    pub session_id: String,
    pub target: ExternalReplyRelayTarget,
    pub prompt: Option<ExternalInteractionPrompt>,
    pub message_id: Option<String>,
    pub phase: ExternalInteractionDispatchPhase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedScreenSnapshotRow {
    pub row_index: u32,
    pub text: String,
    pub trimmed_text: String,
    pub is_blank: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedScreenSnapshot {
    pub session_id: String,
    pub screen_revision: u64,
    pub captured_at_ms: u64,
    pub viewport_top: u32,
    pub viewport_height: u32,
    pub base_y: u32,
    pub cursor_row: Option<u32>,
    pub cursor_col: Option<u32>,
    #[serde(default)]
    pub rows: Vec<RenderedScreenSnapshotRow>,
}

struct ExternalReplyRelaySession {
    target: ExternalReplyRelayTarget,
    tool_kind: AgentToolKind,
    created_at_ms: u64,
    last_chunk_at_ms: u64,
    last_preview_sent_at_ms: u64,
    last_finalize_attempt_at_ms: u64,
    ended: bool,
    vt_parser: vt100::Parser,
    last_preview_text: String,
    preview_message_id: Option<String>,
    last_rendered_snapshot: Option<RenderedScreenSnapshot>,
    last_rendered_reply_text: String,
    active_interaction_prompt: Option<ExternalInteractionPrompt>,
    interaction_message_id: Option<String>,
    last_interaction_signature: Option<String>,
    permission_prompt_active: bool,
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
    mcp_directory_snapshots: Arc<Mutex<HashMap<String, Value>>>,
    ai_config_previews: Arc<Mutex<HashMap<String, StoredAiConfigPreview>>>,
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
            mcp_directory_snapshots: Arc::new(Mutex::new(HashMap::new())),
            ai_config_previews: Arc::new(Mutex::new(HashMap::new())),
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

    pub fn set_mcp_directory_snapshot(
        &self,
        workspace_id: &str,
        snapshot: Value,
    ) -> Result<(), String> {
        let mut snapshots = self.mcp_directory_snapshots.lock().map_err(|_| {
            "MCP_DIRECTORY_STATE_LOCK_POISONED: directory snapshot lock poisoned".to_string()
        })?;
        snapshots.insert(workspace_id.to_string(), snapshot);
        Ok(())
    }

    pub fn mcp_directory_snapshot(&self, workspace_id: &str) -> Result<Option<Value>, String> {
        let snapshots = self.mcp_directory_snapshots.lock().map_err(|_| {
            "MCP_DIRECTORY_STATE_LOCK_POISONED: directory snapshot lock poisoned".to_string()
        })?;
        Ok(snapshots.get(workspace_id).cloned())
    }

    pub fn clear_mcp_directory_snapshot(&self, workspace_id: &str) -> Result<(), String> {
        let mut snapshots = self.mcp_directory_snapshots.lock().map_err(|_| {
            "MCP_DIRECTORY_STATE_LOCK_POISONED: directory snapshot lock poisoned".to_string()
        })?;
        snapshots.remove(workspace_id);
        Ok(())
    }

    pub fn cache_ai_config_preview(&self, preview: StoredAiConfigPreview) -> Result<(), String> {
        let preview_id = match &preview {
            StoredAiConfigPreview::Claude(p) => p.preview_id.clone(),
            StoredAiConfigPreview::Codex(p) => p.preview_id.clone(),
            StoredAiConfigPreview::Gemini(p) => p.preview_id.clone(),
        };
        let mut previews = self.ai_config_previews.lock().map_err(|_| {
            "AI_CONFIG_PREVIEW_LOCK_POISONED: ai config preview lock poisoned".to_string()
        })?;
        previews.insert(preview_id, preview);
        Ok(())
    }

    pub fn take_ai_config_preview(
        &self,
        preview_id: &str,
    ) -> Result<Option<StoredAiConfigPreview>, String> {
        let mut previews = self.ai_config_previews.lock().map_err(|_| {
            "AI_CONFIG_PREVIEW_LOCK_POISONED: ai config preview lock poisoned".to_string()
        })?;
        Ok(previews.remove(preview_id))
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

    #[allow(dead_code)]
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
        if let Some(existing) = guard.get_mut(session_id) {
            if !existing.ended
                && existing
                    .active_interaction_prompt
                    .as_ref()
                    .is_some_and(|prompt| {
                        target
                            .injected_input
                            .as_deref()
                            .is_some_and(|input| prompt.matches_input(input))
                    })
            {
                existing.last_chunk_at_ms = now_ms;
                return Ok(());
            }
        }
        guard.insert(
            session_id.to_string(),
            ExternalReplyRelaySession {
                target,
                tool_kind: AgentToolKind::Unknown,
                created_at_ms: now_ms,
                last_chunk_at_ms: now_ms,
                last_preview_sent_at_ms: 0,
                last_finalize_attempt_at_ms: 0,
                ended: false,
                vt_parser: vt100::Parser::new(36, 120, 500),
                last_preview_text: String::new(),
                preview_message_id: None,
                last_rendered_snapshot: None,
                last_rendered_reply_text: String::new(),
                active_interaction_prompt: None,
                interaction_message_id: None,
                last_interaction_signature: None,
                permission_prompt_active: false,
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
        session.vt_parser.process(chunk);
        Ok(())
    }

    pub fn report_external_reply_rendered_screen(
        &self,
        session_id: &str,
        snapshot: RenderedScreenSnapshot,
    ) -> Result<bool, String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        let Some(session) = guard.get_mut(session_id) else {
            debug!(
                session_id = %session_id,
                screen_revision = snapshot.screen_revision,
                "ignored rendered screen snapshot without bound reply session"
            );
            return Ok(false);
        };
        if snapshot.session_id.trim() != session_id {
            debug!(
                session_id = %session_id,
                snapshot_session_id = %snapshot.session_id,
                screen_revision = snapshot.screen_revision,
                "ignored rendered screen snapshot with mismatched session id"
            );
            return Ok(false);
        }
        if let Some(previous) = session.last_rendered_snapshot.as_ref() {
            if snapshot.screen_revision <= previous.screen_revision {
                debug!(
                    session_id = %session_id,
                    current_screen_revision = snapshot.screen_revision,
                    previous_screen_revision = previous.screen_revision,
                    "ignored stale rendered screen snapshot"
                );
                return Ok(false);
            }
        }
        session.last_chunk_at_ms = snapshot.captured_at_ms.max(session.last_chunk_at_ms);
        let profile = ToolScreenProfile::from_tool_kind(session.tool_kind);
        let interaction_prompt = extract_rendered_interaction_prompt_for_tool(
            &snapshot,
            session.target.injected_input.as_deref(),
            profile,
        );
        let extracted_text = extract_rendered_reply_text_for_tool(
            &snapshot,
            session.target.injected_input.as_deref(),
            interaction_prompt.as_ref(),
            profile,
        );
        session.permission_prompt_active = interaction_prompt
            .as_ref()
            .is_some_and(|prompt| prompt.kind == ExternalInteractionPromptKind::Permission)
            || snapshot_contains_permission_prompt(&snapshot);
        session.last_rendered_reply_text =
            merge_rendered_reply_text(&session.last_rendered_reply_text, &extracted_text);
        session.active_interaction_prompt = interaction_prompt;
        session.last_rendered_snapshot = Some(snapshot);
        debug!(
            session_id = %session_id,
            profile = %profile.id(),
            reply_chars = session.last_rendered_reply_text.chars().count(),
            has_interaction_prompt = session.active_interaction_prompt.is_some(),
            permission_prompt_active = session.permission_prompt_active,
            "accepted rendered screen snapshot for external reply session"
        );
        Ok(true)
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

    pub fn mark_external_reply_preview_delivery_failed(
        &self,
        session_id: &str,
        failed_text: &str,
    ) -> Result<(), String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        let Some(session) = guard.get_mut(session_id) else {
            return Ok(());
        };
        if session.last_preview_text == failed_text {
            session.last_preview_text.clear();
            session.last_preview_sent_at_ms = 0;
        }
        Ok(())
    }

    pub fn mark_external_reply_finalize_delivered(&self, session_id: &str) -> Result<(), String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        guard.remove(session_id);
        Ok(())
    }

    pub fn set_external_reply_session_tool_kind(
        &self,
        session_id: &str,
        tool_kind: AgentToolKind,
    ) -> Result<(), String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        if let Some(session) = guard.get_mut(session_id) {
            session.tool_kind = tool_kind;
        }
        Ok(())
    }

    pub fn set_external_interaction_message_id(
        &self,
        session_id: &str,
        message_id: &str,
        signature: &str,
    ) -> Result<(), String> {
        let message_id = message_id.trim();
        if message_id.is_empty() {
            return Ok(());
        }
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        if let Some(session) = guard.get_mut(session_id) {
            session.interaction_message_id = Some(message_id.to_string());
            session.last_interaction_signature = Some(signature.to_string());
        }
        Ok(())
    }

    pub fn clear_external_interaction_message(&self, session_id: &str) -> Result<(), String> {
        let mut guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        if let Some(session) = guard.get_mut(session_id) {
            session.interaction_message_id = None;
            session.last_interaction_signature = None;
        }
        Ok(())
    }

    pub fn take_external_interaction_dispatch_candidates(
        &self,
    ) -> Result<Vec<ExternalInteractionDispatchCandidate>, String> {
        let guard = self.external_reply_sessions.lock().map_err(|_| {
            "CHANNEL_REPLY_STATE_LOCK_POISONED: reply session state lock poisoned".to_string()
        })?;
        let mut candidates = Vec::new();

        for (session_id, session) in guard.iter() {
            if let Some(prompt) = session.active_interaction_prompt.as_ref() {
                let signature = prompt.signature();
                let already_sent = session.last_interaction_signature.as_deref()
                    == Some(signature.as_str())
                    && session.interaction_message_id.is_some();
                if already_sent {
                    continue;
                }
                candidates.push(ExternalInteractionDispatchCandidate {
                    session_id: session_id.clone(),
                    target: session.target.clone(),
                    prompt: Some(prompt.clone()),
                    message_id: session.interaction_message_id.clone(),
                    phase: ExternalInteractionDispatchPhase::Show,
                });
                continue;
            }

            if session.interaction_message_id.is_some() {
                candidates.push(ExternalInteractionDispatchCandidate {
                    session_id: session_id.clone(),
                    target: session.target.clone(),
                    prompt: None,
                    message_id: session.interaction_message_id.clone(),
                    phase: ExternalInteractionDispatchPhase::Clear,
                });
            }
        }

        Ok(candidates)
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
        let mut drop_session_ids = Vec::new();

        for (session_id, session) in guard.iter_mut() {
            let normalized_text = external_reply_session_text(session);
            let has_text = !normalized_text.is_empty();
            let idle_elapsed = now_ms.saturating_sub(session.last_chunk_at_ms) >= idle_threshold_ms;
            let promptless_rendered_idle_elapsed = now_ms.saturating_sub(session.last_chunk_at_ms)
                >= idle_threshold_ms.saturating_mul(3);
            let expired = now_ms.saturating_sub(session.created_at_ms) >= max_wait_ms;
            let rendered_has_text = !session.last_rendered_reply_text.trim().is_empty();
            let rendered_ready_for_finalize =
                session
                    .last_rendered_snapshot
                    .as_ref()
                    .is_some_and(|snapshot| {
                        snapshot_has_ready_prompt_for_tool(
                            snapshot,
                            ToolScreenProfile::from_tool_kind(session.tool_kind),
                        )
                    });
            let promptless_rendered_finalize = has_text
                && rendered_has_text
                && session.last_rendered_snapshot.is_some()
                && !rendered_ready_for_finalize
                && promptless_rendered_idle_elapsed
                && session.active_interaction_prompt.is_none()
                && !session.permission_prompt_active;
            let should_finalize_with_text = has_text
                && (session.ended
                    || expired
                    || (idle_elapsed
                        && (session.last_rendered_snapshot.is_none()
                            || !rendered_has_text
                            || rendered_ready_for_finalize))
                    || promptless_rendered_finalize);
            let should_drop_without_text = !has_text
                && (session.ended
                    || expired
                    || (idle_elapsed
                        && session.last_rendered_snapshot.is_some()
                        && (!rendered_has_text || rendered_ready_for_finalize)));

            if should_drop_without_text {
                debug!(
                    session_id = %session_id,
                    profile = %ToolScreenProfile::from_tool_kind(session.tool_kind).id(),
                    has_text,
                    ended = session.ended,
                    expired,
                    idle_elapsed,
                    rendered_ready_for_finalize,
                    "external reply session reached finalize boundary"
                );
                drop_session_ids.push(session_id.clone());
                continue;
            }
            if should_finalize_with_text {
                let finalize_retry_ms = preview_throttle_ms.max(1);
                let finalize_due =
                    now_ms.saturating_sub(session.last_finalize_attempt_at_ms) >= finalize_retry_ms;
                if !finalize_due {
                    continue;
                }
                session.last_finalize_attempt_at_ms = now_ms;
                debug!(
                    session_id = %session_id,
                    profile = %ToolScreenProfile::from_tool_kind(session.tool_kind).id(),
                    final_chars = normalized_text.chars().count(),
                    promptless_rendered_finalize,
                    "queued external reply finalize candidate"
                );
                candidates.push(ExternalReplyDispatchCandidate {
                    session_id: session_id.clone(),
                    target: session.target.clone(),
                    text: normalized_text,
                    preview_message_id: session.preview_message_id.clone(),
                    phase: ExternalReplyDispatchPhase::Finalize,
                });
                continue;
            }
            if !has_text {
                continue;
            }
            let preview_enabled = channel_supports_preview(&session.target.channel)
                && (normalized_text.chars().count() >= preview_min_chars
                    || session.preview_message_id.is_some());
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
            debug!(
                session_id = %session_id,
                profile = %ToolScreenProfile::from_tool_kind(session.tool_kind).id(),
                preview_chars = normalized_text.chars().count(),
                "queued external reply preview candidate"
            );
            candidates.push(ExternalReplyDispatchCandidate {
                session_id: session_id.clone(),
                target: session.target.clone(),
                text: normalized_text,
                preview_message_id: session.preview_message_id.clone(),
                phase: ExternalReplyDispatchPhase::Preview,
            });
        }

        for session_id in drop_session_ids {
            if guard.remove(&session_id).is_some() {
                debug!(session_id = %session_id, "dropping finalized external reply session without text");
            }
        }

        Ok(candidates)
    }
}

fn external_reply_session_text(session: &ExternalReplyRelaySession) -> String {
    let rendered_text = session.last_rendered_reply_text.trim();
    if !rendered_text.is_empty() {
        return session.last_rendered_reply_text.clone();
    }
    let screen_text = session.vt_parser.screen().contents();
    let stripped = strip_ansi_escapes::strip_str(&screen_text);
    normalize_reply_text(&stripped, session.target.injected_input.as_deref())
}

fn extract_rendered_interaction_prompt(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
) -> Option<ExternalInteractionPrompt> {
    extract_rendered_interaction_prompt_for_tool(
        snapshot,
        injected_input,
        ToolScreenProfile::Generic,
    )
}

fn extract_rendered_interaction_prompt_for_tool(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    profile: ToolScreenProfile,
) -> Option<ExternalInteractionPrompt> {
    extract_rendered_permission_prompt(snapshot, injected_input, profile)
        .or_else(|| extract_rendered_menu_prompt(snapshot, injected_input, profile))
}

fn extract_rendered_permission_prompt(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    profile: ToolScreenProfile,
) -> Option<ExternalInteractionPrompt> {
    let anchor_row = find_rendered_reply_anchor_row(snapshot, injected_input, profile).unwrap_or(0);
    let mut block_rows = Vec::new();

    for row in snapshot
        .rows
        .iter()
        .filter(|row| row.row_index as usize > anchor_row)
    {
        let text = row.text.trim_end();
        if is_permission_prompt_line(text) {
            block_rows.push(row);
        }
    }

    if block_rows.is_empty() {
        return None;
    }

    let start_row = block_rows.first()?.row_index;
    let end_row = block_rows.last()?.row_index;
    let mut options = Vec::new();
    let mut hint = None;

    for row in block_rows {
        let trimmed = row.text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_lowercase().contains("esc to cancel") {
            hint = Some(trimmed.to_string());
            continue;
        }
        if let Some((submit_text, label)) = parse_numbered_option_line(trimmed) {
            options.push(ExternalInteractionOption { label, submit_text });
            continue;
        }
        let lower = trim_display_leader(trimmed).to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "yes, allow" | "yes" | "no" | "allow" | "deny"
        ) {
            options.push(ExternalInteractionOption {
                label: trim_display_leader(trimmed).to_string(),
                submit_text: lower,
            });
        }
    }

    if options.is_empty() {
        return None;
    }

    Some(ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Permission,
        title: "需要权限确认".to_string(),
        options,
        hint,
        start_row,
        end_row,
    })
}

fn extract_rendered_menu_prompt(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    profile: ToolScreenProfile,
) -> Option<ExternalInteractionPrompt> {
    let anchor_row = find_rendered_reply_anchor_row(snapshot, injected_input, profile).unwrap_or(0);
    let filtered_rows = snapshot
        .rows
        .iter()
        .filter(|row| row.row_index as usize > anchor_row)
        .collect::<Vec<_>>();
    let last_option_idx = filtered_rows
        .iter()
        .rposition(|row| parse_interaction_menu_option(&row.text).is_some())?;

    let mut option_rows = Vec::new();
    let mut cursor = last_option_idx;
    loop {
        let row = filtered_rows[cursor];
        let trimmed = row.trimmed_text.trim();
        if parse_interaction_menu_option(trimmed).is_some() {
            option_rows.push(row);
        } else if !trimmed.is_empty() {
            break;
        }
        if cursor == 0 {
            break;
        }
        cursor -= 1;
    }
    option_rows.reverse();

    let options = option_rows
        .iter()
        .filter_map(|row| parse_interaction_menu_option(&row.text))
        .collect::<Vec<_>>();
    if options.len() < 2 {
        return None;
    }
    let has_slash_option = options
        .iter()
        .any(|option| option.submit_text.trim_start().starts_with('/'));

    let option_start_row = option_rows.first()?.row_index;
    let end_row = option_rows.last()?.row_index;
    let title_info = find_menu_title_before_row(&filtered_rows, option_start_row, profile);
    if title_info.is_none() && !has_slash_option {
        return None;
    }
    let (start_row, title) = title_info
        .map(|(row, title)| (row, title))
        .unwrap_or_else(|| (option_start_row, "请选择一个操作".to_string()));

    Some(ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Menu,
        title,
        options,
        hint: None,
        start_row,
        end_row,
    })
}

fn find_menu_title_before_row(
    rows: &[&RenderedScreenSnapshotRow],
    start_row: u32,
    profile: ToolScreenProfile,
) -> Option<(u32, String)> {
    let start_index = rows.iter().position(|row| row.row_index == start_row)?;
    for row in rows[..start_index].iter().rev() {
        let trimmed = row.text.trim();
        if trimmed.is_empty()
            || is_horizontal_rule_line(trimmed)
            || is_ready_prompt_line_for_tool(trimmed, profile)
        {
            continue;
        }
        if parse_interaction_menu_option(trimmed).is_some()
            || is_permission_prompt_line(trimmed)
            || should_skip_runtime_noise_line_for_tool(trimmed, profile)
            || should_skip_tool_execution_line_for_tool(trimmed, profile)
            || should_skip_thinking_line(trimmed)
            || is_tui_status_bar_line(trimmed)
        {
            continue;
        }
        let normalized = trim_display_leader(trimmed);
        if normalized.is_empty() {
            continue;
        }
        if trimmed.starts_with("• ") || trimmed.starts_with("● ") {
            continue;
        }
        if is_probable_interaction_menu_title(normalized) {
            return Some((row.row_index, normalized.to_string()));
        }
    }
    None
}

fn is_probable_interaction_menu_title(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    lower.contains("select")
        || lower.contains("choose")
        || lower.contains("pick")
        || lower.contains("option")
        || lower.contains("command")
        || text.contains("请选择")
        || text.contains("选择")
        || text.contains("可选")
        || text.contains("命令")
        || text.contains("菜单")
}

fn parse_numbered_option_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    let without_cursor = trimmed
        .strip_prefix("› ")
        .or_else(|| trimmed.strip_prefix("❯ "))
        .unwrap_or(trimmed)
        .trim_start();
    let (prefix, rest) = without_cursor.split_once(". ")?;
    if prefix.chars().all(|ch| ch.is_ascii_digit()) {
        let label = collapse_whitespace(rest);
        if !label.is_empty() {
            return Some((prefix.to_string(), label));
        }
    }
    None
}

fn parse_slash_command_option_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    let without_cursor = trimmed
        .strip_prefix("› ")
        .or_else(|| trimmed.strip_prefix("❯ "))
        .unwrap_or(trimmed)
        .trim_start();
    let command_end = without_cursor
        .char_indices()
        .skip(1)
        .find_map(|(idx, ch)| if ch.is_whitespace() { Some(idx) } else { None })
        .unwrap_or(without_cursor.len());
    let command = without_cursor[..command_end].trim();
    if !command.starts_with('/') || command.len() < 2 {
        return None;
    }
    let label = collapse_whitespace(without_cursor);
    if label.is_empty() {
        return None;
    }
    Some((command.to_string(), label))
}

fn parse_interaction_menu_option(line: &str) -> Option<ExternalInteractionOption> {
    if let Some((submit_text, label)) = parse_numbered_option_line(line) {
        return Some(ExternalInteractionOption { label, submit_text });
    }
    if let Some((submit_text, label)) = parse_slash_command_option_line(line) {
        return Some(ExternalInteractionOption { label, submit_text });
    }
    None
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_rendered_reply_text(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    interaction_prompt: Option<&ExternalInteractionPrompt>,
) -> String {
    extract_rendered_reply_text_for_tool(
        snapshot,
        injected_input,
        interaction_prompt,
        ToolScreenProfile::Generic,
    )
}

fn extract_rendered_reply_text_for_tool(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    interaction_prompt: Option<&ExternalInteractionPrompt>,
    profile: ToolScreenProfile,
) -> String {
    let mut islands: Vec<Vec<String>> = Vec::new();
    let mut current_island: Vec<String> = Vec::new();
    let cursor_row = snapshot.cursor_row.map(|value| value as usize);
    let anchor_row = extend_wrapped_injected_anchor_row(
        snapshot,
        find_rendered_reply_anchor_row(snapshot, injected_input, profile),
        injected_input,
    );
    let mut in_tool_block = false;
    let mut in_permission_block = false;

    for row in &snapshot.rows {
        let row_index = row.row_index as usize;
        if anchor_row.is_some_and(|anchor| row_index <= anchor) {
            continue;
        }
        if interaction_prompt.is_some_and(|prompt| prompt.contains_row(row.row_index)) {
            if !current_island.is_empty() {
                islands.push(current_island);
                current_island = Vec::new();
            }
            continue;
        }
        let text = row.text.trim_end();
        let trimmed = row.trimmed_text.trim();

        if row.is_blank || trimmed.is_empty() {
            if in_tool_block {
                in_tool_block = false;
                continue;
            }
            if in_permission_block {
                in_permission_block = false;
                continue;
            }
            if !current_island.is_empty()
                && !current_island.last().is_some_and(|line| line.is_empty())
            {
                current_island.push(String::new());
            }
            continue;
        }

        if in_tool_block {
            let trimmed_start = text.trim_start();
            let is_assistant_marker = profile
                .assistant_markers()
                .iter()
                .any(|marker| trimmed_start.starts_with(marker));
            if is_assistant_marker && !should_skip_tool_execution_line_for_tool(text, profile) {
                in_tool_block = false;
            } else {
                continue;
            }
        }

        if in_permission_block {
            continue;
        }

        if is_permission_prompt_line(text) {
            if !current_island.is_empty() {
                islands.push(current_island);
                current_island = Vec::new();
            }
            in_permission_block = true;
            continue;
        }

        if is_tool_block_start_line(text) {
            if !current_island.is_empty() {
                islands.push(current_island);
                current_island = Vec::new();
            }
            in_tool_block = true;
            continue;
        }

        let in_cursor_tail = cursor_row.is_some_and(|cursor| row_index >= cursor);
        let is_noise = in_cursor_tail
            || is_echo_of_injected_line(text, injected_input)
            || should_skip_external_reply_line(text)
            || should_skip_thinking_line(text)
            || should_skip_tool_execution_line_for_tool(text, profile)
            || should_skip_runtime_noise_line_for_tool(text, profile)
            || is_tui_status_bar_line(text)
            || should_skip_cli_prompt_line_for_tool(text, profile)
            || should_skip_startup_banner_line_for_tool(text, profile)
            || should_skip_log_prefix_line(text)
            || is_interleaved_prompt_line(trimmed);

        if is_noise {
            if !current_island.is_empty() {
                islands.push(current_island);
                current_island = Vec::new();
            }
            continue;
        }

        current_island.push(text.to_string());
    }

    if !current_island.is_empty() {
        islands.push(current_island);
    }

    let best_island = if let Some(best) = pick_best_rendered_reply_island(&islands, profile) {
        best
    } else {
        return String::new();
    };

    let joined = best_island.join("\n");
    suppress_injected_input_echo(joined.trim_end(), injected_input)
}

fn merge_rendered_reply_text(existing: &str, candidate: &str) -> String {
    let existing = existing.trim_end_matches('\n');
    let candidate = candidate.trim_end_matches('\n');
    if candidate.trim().is_empty() {
        return existing.to_string();
    }
    if existing.trim().is_empty() {
        return candidate.to_string();
    }
    if existing == candidate || existing.contains(candidate) {
        return existing.to_string();
    }
    if candidate.contains(existing) {
        return candidate.to_string();
    }

    let existing_lines: Vec<&str> = existing.lines().collect();
    let candidate_lines: Vec<&str> = candidate.lines().collect();
    let max_overlap = existing_lines.len().min(candidate_lines.len());
    for overlap in (1..=max_overlap).rev() {
        if existing_lines[existing_lines.len() - overlap..] == candidate_lines[..overlap] {
            let mut merged = existing_lines
                .iter()
                .map(|line| (*line).to_string())
                .collect::<Vec<_>>();
            merged.extend(
                candidate_lines[overlap..]
                    .iter()
                    .map(|line| (*line).to_string()),
            );
            return merged.join("\n");
        }
    }

    format!("{existing}\n{candidate}")
}

fn snapshot_contains_permission_prompt(snapshot: &RenderedScreenSnapshot) -> bool {
    snapshot
        .rows
        .iter()
        .any(|row| is_permission_prompt_line(&row.text))
}

fn snapshot_has_ready_prompt(snapshot: &RenderedScreenSnapshot) -> bool {
    snapshot_has_ready_prompt_for_tool(snapshot, ToolScreenProfile::Generic)
}

fn snapshot_has_ready_prompt_for_tool(
    snapshot: &RenderedScreenSnapshot,
    profile: ToolScreenProfile,
) -> bool {
    let mut inspected = 0usize;
    for row in snapshot.rows.iter().rev() {
        let trimmed = row.text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if is_permission_prompt_line(trimmed) {
            return false;
        }
        if is_ready_prompt_line_for_tool(trimmed, profile) {
            return true;
        }
        if is_editor_mode_line(trimmed) || is_horizontal_rule_line(trimmed) {
            continue;
        }
        inspected += 1;
        if inspected >= 4 {
            break;
        }
    }
    false
}

fn find_rendered_reply_anchor_row(
    snapshot: &RenderedScreenSnapshot,
    injected_input: Option<&str>,
    profile: ToolScreenProfile,
) -> Option<usize> {
    if let Some(injected) = injected_input
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        for row in snapshot.rows.iter().rev() {
            let text = row.text.trim_end();
            if is_echo_of_injected_line(text, Some(injected)) {
                return Some(row.row_index as usize);
            }
        }
        let normalized_injected = collapse_whitespace(injected);
        for row in snapshot.rows.iter().rev() {
            let text = row.text.trim_end();
            let normalized_line = collapse_whitespace(normalize_prompt_prefixed_line(text));
            if normalized_line.is_empty()
                || is_placeholder_prompt_content_for_tool(&normalized_line, profile)
            {
                continue;
            }
            if normalized_injected.starts_with(&normalized_line) {
                return Some(row.row_index as usize);
            }
        }
    }

    snapshot.rows.iter().rev().find_map(|row| {
        let text = row.text.trim_end();
        if is_prompt_anchor_line_for_tool(text, profile) {
            Some(row.row_index as usize)
        } else {
            None
        }
    })
}

fn extend_wrapped_injected_anchor_row(
    snapshot: &RenderedScreenSnapshot,
    anchor_row: Option<usize>,
    injected_input: Option<&str>,
) -> Option<usize> {
    let Some(anchor_row) = anchor_row else {
        return None;
    };
    let Some(injected) = injected_input
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Some(anchor_row);
    };
    let normalized_injected = collapse_whitespace(injected);
    if normalized_injected.is_empty() {
        return Some(anchor_row);
    }

    let mut consumed = String::new();
    let mut last_anchor_row = anchor_row;
    for row in snapshot
        .rows
        .iter()
        .filter(|row| row.row_index as usize >= anchor_row)
    {
        let segment = if row.row_index as usize == anchor_row {
            collapse_whitespace(normalize_prompt_prefixed_line(row.text.trim_end()))
        } else {
            collapse_whitespace(row.text.trim())
        };
        if segment.is_empty() {
            break;
        }
        let (candidate, matches) = if consumed.is_empty() {
            let exact = segment.clone();
            (exact.clone(), normalized_injected.starts_with(&exact))
        } else {
            let compact = format!("{consumed}{segment}");
            if normalized_injected.starts_with(&compact) {
                (compact, true)
            } else {
                let spaced = format!("{consumed} {segment}");
                (spaced.clone(), normalized_injected.starts_with(&spaced))
            }
        };
        if matches {
            consumed = candidate;
            last_anchor_row = row.row_index as usize;
            if consumed == normalized_injected {
                break;
            }
            continue;
        }
        break;
    }
    Some(last_anchor_row)
}

fn is_prompt_anchor_line(line: &str) -> bool {
    is_prompt_anchor_line_for_tool(line, ToolScreenProfile::Generic)
}

fn is_prompt_anchor_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    if is_shell_prompt_line(line) {
        return true;
    }
    let trimmed = line.trim_start();
    for prefix in profile.prompt_prefixes() {
        if let Some(after) = trimmed.strip_prefix(prefix) {
            let after = after.trim();
            if !after.is_empty() && !is_placeholder_prompt_content_for_tool(after, profile) {
                return true;
            }
        }
    }
    false
}

fn is_ready_prompt_line(line: &str) -> bool {
    is_ready_prompt_line_for_tool(line, ToolScreenProfile::Generic)
}

fn is_ready_prompt_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    let trimmed = line.trim();
    if is_shell_prompt_line(trimmed) {
        return true;
    }
    if matches!(trimmed, "›" | "❯" | "$" | ">") {
        return true;
    }
    let trimmed_start = line.trim_start();
    for prefix in profile.prompt_prefixes() {
        if let Some(after) = trimmed_start.strip_prefix(prefix) {
            if is_placeholder_prompt_content_for_tool(after.trim(), profile) {
                return true;
            }
        }
    }
    false
}

fn is_editor_mode_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.eq_ignore_ascii_case("-- insert --")
        || trimmed.eq_ignore_ascii_case("-- normal --")
        || trimmed.eq_ignore_ascii_case("-- visual --")
}

fn is_horizontal_rule_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| matches!(ch, '─' | '━' | '▪' | '·' | ' ' | '—' | '╌' | '╍'))
}

fn pick_best_rendered_reply_island(
    islands: &[Vec<String>],
    profile: ToolScreenProfile,
) -> Option<Vec<String>> {
    let mut best: Option<(i32, usize, Vec<String>)> = None;

    for (idx, island) in islands.iter().enumerate() {
        let text = island
            .iter()
            .filter(|line| !line.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        if text.is_empty() {
            continue;
        }
        let candidate = island
            .iter()
            .skip_while(|line| line.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        let candidate = candidate
            .into_iter()
            .rev()
            .skip_while(|line| line.trim().is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        let joined = text.join("\n");
        let char_count = joined.chars().count();
        let line_count = text.len();
        let has_assistant_marker = text.iter().any(|line| {
            let trimmed = line.trim_start();
            let matches_profile_marker = profile
                .assistant_markers()
                .iter()
                .any(|marker| trimmed.starts_with(marker));
            let matches_generic_marker =
                profile == ToolScreenProfile::Generic && trimmed.starts_with("● ");
            (matches_profile_marker || matches_generic_marker)
                && !trimmed.to_ascii_lowercase().starts_with("• working")
                && !trimmed.to_ascii_lowercase().starts_with("● working")
                && !is_tool_block_start_line_for_tool(trimmed, profile)
        });
        let has_cjk = joined.chars().any(is_cjk_char);
        let has_sentence_punctuation = joined.contains('。')
            || joined.contains('，')
            || joined.contains('！')
            || joined.contains('？')
            || joined.contains('.')
            || joined.contains('!')
            || joined.contains('?')
            || joined.contains(':');
        let mostly_ascii = joined.is_ascii();
        let looks_command = text.iter().all(|line| looks_like_terminal_command(line));

        let mut score = 0;
        if has_assistant_marker {
            score += 6;
        }
        if line_count >= 2 {
            score += 3;
        }
        if char_count >= 24 {
            score += 2;
        }
        if has_cjk {
            score += 2;
        }
        if has_sentence_punctuation {
            score += 1;
        }
        score += (idx as i32) * 2;
        if mostly_ascii && char_count < 12 {
            score -= 3;
        }
        if looks_command {
            score -= 5;
        }

        if score < 3 {
            continue;
        }

        let candidate_key = (score, char_count);
        if best
            .as_ref()
            .is_none_or(|(best_score, best_chars, _)| candidate_key > (*best_score, *best_chars))
        {
            best = Some((score, char_count, candidate));
        }
    }

    best.map(|(_, _, candidate)| candidate)
}

fn looks_like_terminal_command(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with("./") || trimmed.starts_with('/') || trimmed.starts_with("git ") {
        return true;
    }
    if trimmed.contains(" --") && trimmed.is_ascii() {
        return true;
    }
    if trimmed.starts_with("npm ")
        || trimmed.starts_with("pnpm ")
        || trimmed.starts_with("yarn ")
        || trimmed.starts_with("cargo ")
        || trimmed.starts_with("python ")
        || trimmed.starts_with("node ")
        || trimmed.starts_with("bash ")
        || trimmed.starts_with("sh ")
    {
        return true;
    }
    false
}

fn trim_display_leader(line: &str) -> &str {
    line.trim_start_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, '●' | '•' | '◦' | '✦' | '⎿' | '│' | '┃')
    })
    .trim()
}

fn is_cjk_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x4E00..=0x9FFF
            | 0x3400..=0x4DBF
            | 0x3040..=0x309F
            | 0x30A0..=0x30FF
            | 0xAC00..=0xD7AF
    )
}

#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
    let mut islands: Vec<Vec<String>> = Vec::new();
    let mut current_island: Vec<String> = Vec::new();

    for line in input.lines() {
        let trimmed_end = line.trim_end();
        let trimmed = trimmed_end.trim_start();

        let is_noise = is_echo_of_injected_line(trimmed_end, injected_input)
            || should_skip_external_reply_line(trimmed_end)
            || should_skip_thinking_line(trimmed_end)
            || should_skip_tool_execution_line(trimmed_end)
            || should_skip_runtime_noise_line(trimmed_end)
            || is_tui_status_bar_line(trimmed_end)
            || should_skip_cli_prompt_line(trimmed_end)
            || should_skip_startup_banner_line(trimmed_end)
            || should_skip_log_prefix_line(trimmed_end)
            || is_interleaved_prompt_line(trimmed);

        if is_noise {
            if !current_island.is_empty() {
                islands.push(current_island);
                current_island = Vec::new();
            }
        } else {
            if trimmed_end.is_empty() {
                if !current_island.is_empty() && !current_island.last().unwrap().is_empty() {
                    current_island.push(String::new());
                }
            } else {
                current_island.push(trimmed_end.to_string());
            }
        }
    }
    if !current_island.is_empty() {
        islands.push(current_island);
    }

    // Selection logic:
    // 1. Find islands that contain a proper assistant marker (• )
    let marker_island_idx = islands.iter().rposition(|isl| {
        isl.iter().any(|line| {
            let t = line.trim_start();
            t.starts_with("• ") && !t.to_ascii_lowercase().starts_with("• working")
        })
    });

    let best_island = if let Some(idx) = marker_island_idx {
        islands[idx].clone()
    } else {
        // Fallback: Take the last island that has non-blank content
        islands
            .iter()
            .rev()
            .find(|isl| isl.iter().any(|line| !line.trim().is_empty()))
            .cloned()
            .unwrap_or_default()
    };

    let mut result = best_island;
    while result.first().map_or(false, |l| l.trim().is_empty()) {
        result.remove(0);
    }
    while result.last().map_or(false, |l| l.trim().is_empty()) {
        result.pop();
    }

    let joined = result.join("\n");
    suppress_injected_input_echo(&joined, injected_input)
}

fn should_skip_runtime_noise_line(line: &str) -> bool {
    should_skip_runtime_noise_line_for_tool(line, ToolScreenProfile::Generic)
}

fn should_skip_runtime_noise_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
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
    if matches!(
        profile,
        ToolScreenProfile::Codex | ToolScreenProfile::Claude | ToolScreenProfile::Generic
    ) && (lower.starts_with("• working") || lower.starts_with("working ("))
    {
        return true;
    }
    if lower.starts_with("• model changed to ") || lower.starts_with("model changed to ") {
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
    if lower.starts_with("✻ worked for") || lower.starts_with("worked for ") {
        return true;
    }
    if lower.contains("for shortcuts") {
        return true;
    }
    if lower.contains("accept edits") || lower.contains("mcp servers") {
        return true;
    }
    if lower.contains("no sandbox") || lower.contains("/model ") {
        return true;
    }
    if lower.contains("skill conflict detected") {
        return true;
    }
    // Help hints and usage tips
    if lower.starts_with("type ") && (lower.contains("help") || lower.contains("for more")) {
        return true;
    }
    if lower.contains("press ") && (lower.contains("to ") || lower.contains("for ")) {
        return true;
    }
    // Cost/token display patterns
    if (lower.contains('$') && lower.chars().filter(|c| c.is_ascii_digit()).count() > 0)
        || (lower.contains("token") && lower.chars().filter(|c| c.is_ascii_digit()).count() > 0)
    {
        // Check if this is a standalone cost/token line
        let words: Vec<&str> = normalized.split_whitespace().collect();
        if words.len() <= 5 {
            return true;
        }
    }
    // Progress bar patterns
    let progress_chars = ['█', '▓', '░', '─', '━', '╸', '╺'];
    let progress_char_count = normalized
        .chars()
        .filter(|c| progress_chars.contains(c))
        .count();
    let total_char_count = normalized.chars().count();
    if total_char_count > 0 && progress_char_count > total_char_count / 3 {
        return true;
    }
    // Compact status patterns: [1/5], Step 2 of 4, (3/10)
    if (normalized.starts_with('[') && normalized.contains('/') && normalized.ends_with(']'))
        || (lower.starts_with("step ") && lower.contains(" of "))
        || (normalized.starts_with('(') && normalized.contains('/') && normalized.ends_with(')'))
    {
        let words: Vec<&str> = normalized.split_whitespace().collect();
        if words.len() <= 4 {
            return true;
        }
    }
    // Generalized TUI status bar detection (works across Codex CLI, Claude
    // Code, Gemini CLI, and any ratatui/ink/blessed-based TUI agent)
    if is_tui_status_bar_line(normalized) {
        return true;
    }
    is_known_spinner_token(normalized)
}

fn should_skip_tool_execution_line(line: &str) -> bool {
    should_skip_tool_execution_line_for_tool(line, ToolScreenProfile::Generic)
}

fn should_skip_tool_execution_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    let trimmed = line.trim();
    let display_trimmed = trim_display_leader(trimmed);
    // Claude Code tool markers: Read(file), Edit(file), Bash(cmd), Write(file)
    if let Some(paren_start) = display_trimmed.find('(') {
        let prefix = &display_trimmed[..paren_start];
        if prefix.chars().all(|c| c.is_ascii_alphanumeric())
            && prefix
                .chars()
                .next()
                .map_or(false, |c| c.is_ascii_uppercase())
            && display_trimmed.ends_with(')')
        {
            let known_tools = [
                "Read",
                "Edit",
                "Write",
                "Bash",
                "Glob",
                "Grep",
                "Search",
                "Replace",
                "MultiEdit",
                "TodoRead",
                "TodoWrite",
                "WebFetch",
                "WebSearch",
                "NotebookEdit",
            ];
            if known_tools.iter().any(|t| prefix == *t) {
                return true;
            }
        }
    }
    // Codex CLI tool execution display
    let lower = display_trimmed.to_ascii_lowercase();
    if matches!(
        profile,
        ToolScreenProfile::Codex | ToolScreenProfile::Claude | ToolScreenProfile::Generic
    ) && (lower.starts_with("running: ") || lower.starts_with("executing: "))
    {
        return true;
    }
    if matches!(
        profile,
        ToolScreenProfile::Codex | ToolScreenProfile::Claude | ToolScreenProfile::Generic
    ) && (lower.starts_with("• ran ") || lower.starts_with("ran "))
    {
        return true;
    }
    if lower.starts_with("└ ") {
        return true;
    }
    // Tool result markers
    if lower.starts_with("tool result") || lower.starts_with("tool output") {
        return true;
    }
    if lower.starts_with("read ")
        || lower.starts_with("reading ")
        || lower.starts_with("shell cwd was reset")
        || lower.contains("(ctrl+o to expand)")
        || lower.starts_with("bash(")
    {
        return true;
    }
    false
}

fn is_tool_block_start_line(line: &str) -> bool {
    is_tool_block_start_line_for_tool(line, ToolScreenProfile::Generic)
}

fn is_tool_block_start_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    let trimmed = trim_display_leader(line);
    if trimmed.is_empty() {
        return false;
    }
    should_skip_tool_execution_line_for_tool(trimmed, profile)
}

fn is_permission_prompt_line(line: &str) -> bool {
    let trimmed = trim_display_leader(line);
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("esc to cancel")
        || lower.contains("tab to amend")
        || lower.contains("ctrl+e to explain")
    {
        return true;
    }
    if lower.contains("allow reading from") || lower.contains("allow writing to") {
        return true;
    }
    if lower.starts_with("yes, allow ") || lower == "no" {
        return true;
    }
    if let Some((prefix, rest)) = lower.split_once(". ") {
        if prefix.chars().all(|ch| ch.is_ascii_digit())
            && (rest.starts_with("yes, allow ") || rest == "no")
        {
            return true;
        }
    }
    false
}

fn should_skip_thinking_line(line: &str) -> bool {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    // Thinking/reasoning indicators
    if lower == "thinking..."
        || lower == "thinking…"
        || lower == "reasoning..."
        || lower == "reasoning…"
        || lower == "planning..."
        || lower == "planning…"
    {
        return true;
    }
    // Thinking with duration: "Thinking (3s)", "Reasoning (12s)"
    if (lower.starts_with("thinking (") || lower.starts_with("reasoning ("))
        && lower.ends_with(")")
        && lower.contains("s)")
    {
        return true;
    }
    false
}

fn should_skip_external_reply_line(line: &str) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("[vb-task] assigned task_")
        || normalized.contains("echo '[vb-task] assigned task_")
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
    should_skip_startup_banner_line_for_tool(line, ToolScreenProfile::Generic)
}

fn should_skip_startup_banner_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    let normalized = line.trim();
    if normalized.is_empty() {
        return false;
    }

    // TUI box drawing characters (banner frames)
    let box_chars = [
        '╭', '╮', '╰', '╯', '│', '─', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼',
    ];
    let box_char_count = normalized.chars().filter(|c| box_chars.contains(c)).count();
    let total_chars = normalized.chars().count();
    // If more than 30% of the line is box drawing characters, it's likely a banner frame
    if total_chars > 0 && box_char_count > total_chars * 3 / 10 {
        return true;
    }

    // Lines that start and end with box chars and contain model/config info
    if (normalized.starts_with('│') || normalized.starts_with('┃'))
        && (normalized.ends_with('│') || normalized.ends_with('┃'))
    {
        let lower = normalized.to_ascii_lowercase();
        if lower.contains("model:")
            || lower.contains("gpt-")
            || lower.contains("claude-")
            || lower.contains("gemini-")
            || lower.contains("/model to")
        {
            return true;
        }
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

    // Tip messages from CLI tools
    if lower.starts_with("tip:") || lower.starts_with("hint:") {
        return true;
    }
    if matches!(
        profile,
        ToolScreenProfile::Codex | ToolScreenProfile::Generic
    ) {
        if lower.starts_with("inference at ") && lower.contains("plan usage") {
            return true;
        }
        if lower.starts_with("heads up,") && lower.contains("limit left") {
            return true;
        }
        if lower.contains("run /status for a breakdown") {
            return true;
        }
    }

    // Model/tool name banners (e.g., ">_ OpenAI Codex (v0.110.0)")
    if (lower.contains(">_") || lower.contains("│"))
        && (lower.contains("codex") || lower.contains("claude") || lower.contains("gemini"))
    {
        return true;
    }

    // Pairing/access messages
    if lower.contains("pairing code:")
        || lower.contains("access not configured")
        || lower.contains("ask the bot owner")
        || lower.contains("your telegram user id")
    {
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
    should_skip_cli_prompt_line_for_tool(line, ToolScreenProfile::Generic)
}

fn should_skip_cli_prompt_line_for_tool(line: &str, profile: ToolScreenProfile) -> bool {
    let trimmed = line.trim_start();
    if is_shell_prompt_line(trimmed) {
        return true;
    }
    for prefix in profile.prompt_prefixes() {
        if let Some(after) = trimmed.strip_prefix(prefix) {
            let after = after.trim();
            if is_placeholder_prompt_content_for_tool(after, profile) {
                return true;
            }
        }
    }
    if trimmed == ">" || trimmed == "$" || trimmed == "›" || trimmed == "❯" {
        return true;
    }
    for prefix in profile.prompt_prefixes() {
        if let Some(after) = trimmed.strip_prefix(prefix) {
            let after = after.trim();
            if after.is_ascii() || after.is_empty() {
                return true;
            }
        }
    }
    false
}

fn is_placeholder_prompt_content(content: &str) -> bool {
    is_placeholder_prompt_content_for_tool(content, ToolScreenProfile::Generic)
}

fn is_placeholder_prompt_content_for_tool(content: &str, profile: ToolScreenProfile) -> bool {
    let lower = content.trim().to_ascii_lowercase();
    if lower.starts_with("type your message") || lower.starts_with("type a message") {
        return true;
    }
    if matches!(
        profile,
        ToolScreenProfile::Gemini | ToolScreenProfile::Generic
    ) && lower.contains("@path/to/file")
    {
        return true;
    }
    if matches!(
        profile,
        ToolScreenProfile::Codex | ToolScreenProfile::Generic
    ) && lower.starts_with("use /")
        && lower.contains("available skills")
    {
        return true;
    }
    false
}

fn is_shell_prompt_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.starts_with("PS ") && trimmed.ends_with('>')
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
/// Strategy:
/// 1. If there are `• ` markers (Claude Code style), use the LAST non-working one
/// 2. Otherwise, return the full normalized text (already filtered by line-level filters)
///
/// This makes the function work for agents that don't use `• ` markers.
fn extract_last_assistant_block(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut start: Option<usize> = None;

    // Find the LAST assistant block marker (• that's not "• working")
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("• ") && !trimmed.to_ascii_lowercase().starts_with("• working") {
            start = Some(idx);
        }
    }

    // If no `• ` marker found, return the full text (line-level filters already applied)
    let start = match start {
        Some(s) => s,
        None => {
            let trimmed = text.trim().to_string();
            return if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
        }
    };

    let mut result = Vec::new();
    result.push(lines[start].trim_end().to_string());

    for line in lines.iter().skip(start + 1) {
        let trimmed = line.trim_start();

        // Stop if we encounter a user prompt (new input)
        if trimmed.starts_with("› ") {
            let after_prompt = trimmed.strip_prefix("› ").unwrap_or("");
            if !after_prompt.trim().is_empty() {
                break;
            }
        }

        if trimmed.is_empty() {
            if result.last().is_some_and(|last| !last.is_empty()) {
                result.push(String::new());
            }
            continue;
        }

        // Skip "• Working" status lines but continue processing
        if trimmed.to_ascii_lowercase().starts_with("• working") {
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
#[path = "tests/app_state_tests.rs"]
mod tests;
