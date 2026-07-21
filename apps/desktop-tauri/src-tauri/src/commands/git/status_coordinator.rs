use gt_abstractions::{GitStatusSummary, WorkspaceId};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::app_state::AppState;

const DEFAULT_GIT_STATUS_DEBOUNCE_MS: u64 = 180;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpdatedPayload {
    pub workspace_id: String,
    pub available: bool,
    pub primary_repository_path: String,
    pub branch: String,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<gt_abstractions::GitStatusFile>,
    pub repositories: Vec<gt_abstractions::GitRepositorySummary>,
    pub total_changes: usize,
    pub truncated: bool,
    pub kind: gt_abstractions::GitRepositoryKind,
    pub state: gt_abstractions::GitRepositoryState,
    pub head_oid: Option<String>,
    pub expected_head_oid: Option<String>,
    pub revision: u64,
}

struct WorkspaceRefreshState {
    dirty: bool,
    scheduled: bool,
    immediate_requested: bool,
    last_fingerprint: Option<String>,
    revision: u64,
    generation: u64,
    cancel: CancellationToken,
}

impl Default for WorkspaceRefreshState {
    fn default() -> Self {
        Self {
            dirty: false,
            scheduled: false,
            immediate_requested: false,
            last_fingerprint: None,
            revision: 0,
            generation: 0,
            cancel: CancellationToken::new(),
        }
    }
}

impl WorkspaceRefreshState {
    fn request(&mut self, immediate: bool) -> bool {
        self.dirty = true;
        self.immediate_requested |= immediate;
        if self.scheduled {
            false
        } else {
            self.scheduled = true;
            true
        }
    }
}

#[derive(Clone)]
pub struct GitStatusCoordinator {
    inner: Arc<Mutex<HashMap<String, WorkspaceRefreshState>>>,
    next_generation: Arc<AtomicU64>,
}

impl Default for GitStatusCoordinator {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl GitStatusCoordinator {
    pub fn activate(&self, workspace_id: &str) -> Result<u64, String> {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let mut workspaces = self
            .inner
            .lock()
            .map_err(|_| "GIT_STATUS_COORDINATOR_LOCK_POISONED".to_string())?;
        if let Some(previous) = workspaces.remove(workspace_id) {
            previous.cancel.cancel();
        }
        workspaces.insert(
            workspace_id.to_string(),
            WorkspaceRefreshState {
                generation,
                ..WorkspaceRefreshState::default()
            },
        );
        Ok(generation)
    }

    pub fn deactivate(&self, workspace_id: &str) -> Result<(), String> {
        let mut workspaces = self
            .inner
            .lock()
            .map_err(|_| "GIT_STATUS_COORDINATOR_LOCK_POISONED".to_string())?;
        if let Some(refresh_state) = workspaces.remove(workspace_id) {
            refresh_state.cancel.cancel();
        }
        Ok(())
    }

    pub(crate) fn is_active(&self, workspace_id: &str) -> bool {
        self.inner
            .lock()
            .map(|workspaces| workspaces.contains_key(workspace_id))
            .unwrap_or(false)
    }

    pub fn schedule_refresh<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        state: &AppState,
        workspace_id: &str,
    ) {
        self.request_refresh(app, state, workspace_id, false);
    }

    fn request_refresh<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        state: &AppState,
        workspace_id: &str,
        immediate: bool,
    ) {
        let worker = {
            let mut workspaces = match self.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(refresh_state) = workspaces.get_mut(workspace_id) else {
                return;
            };
            if refresh_state.request(immediate) {
                Some((refresh_state.generation, refresh_state.cancel.clone()))
            } else {
                None
            }
        };

        let Some((generation, cancel)) = worker else {
            return;
        };

        let coordinator = self.clone();
        let app = app.clone();
        let state = state.clone();
        let workspace_id = workspace_id.to_string();
        tauri::async_runtime::spawn(async move {
            coordinator
                .run_scheduled_refresh_loop(app, state, workspace_id, generation, cancel)
                .await;
        });
    }

    #[allow(dead_code)]
    pub fn refresh_now<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        state: &AppState,
        workspace_id: &WorkspaceId,
    ) {
        self.schedule_refresh(app, state, workspace_id.as_str());
    }

    /// Prioritize the next serialized refresh cycle for user-initiated mutations.
    /// Repeated immediate requests are coalesced into the existing workspace worker.
    pub fn refresh_immediate<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        state: &AppState,
        workspace_id: &str,
    ) {
        self.request_refresh(app, state, workspace_id, true);
    }

    async fn run_scheduled_refresh_loop<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        state: AppState,
        workspace_id: String,
        generation: u64,
        cancel: CancellationToken,
    ) {
        loop {
            let immediate = {
                let workspaces = match self.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(refresh_state) = workspaces.get(&workspace_id) else {
                    return;
                };
                if refresh_state.generation != generation || cancel.is_cancelled() {
                    return;
                }
                refresh_state.immediate_requested
            };

            if !immediate {
                tokio::select! {
                    _ = sleep(Duration::from_millis(DEFAULT_GIT_STATUS_DEBOUNCE_MS)) => {}
                    _ = cancel.cancelled() => return,
                }
            }

            {
                let mut workspaces = match self.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(refresh_state) = workspaces.get_mut(&workspace_id) else {
                    return;
                };
                if refresh_state.generation != generation || cancel.is_cancelled() {
                    return;
                }
                refresh_state.dirty = false;
                refresh_state.immediate_requested = false;
            }

            if let Err(error) = self
                .refresh_once(&app, &state, &workspace_id, generation, &cancel, immediate)
                .await
            {
                if !cancel.is_cancelled() && self.is_generation_current(&workspace_id, generation) {
                    warn!(workspace_id, error = %error, "scheduled git status refresh failed");
                }
            }

            let should_continue = {
                let mut workspaces = match self.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(refresh_state) = workspaces.get_mut(&workspace_id) else {
                    return;
                };
                if refresh_state.generation != generation || cancel.is_cancelled() {
                    return;
                }
                if refresh_state.dirty {
                    true
                } else {
                    refresh_state.scheduled = false;
                    false
                }
            };

            if !should_continue {
                break;
            }
        }
    }

    async fn refresh_once<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        state: &AppState,
        workspace_id: &str,
        generation: u64,
        cancel: &CancellationToken,
        force_emit: bool,
    ) -> Result<(), String> {
        if cancel.is_cancelled() || !self.is_generation_current(workspace_id, generation) {
            return Ok(());
        }
        let status = read_git_status(state.clone(), workspace_id.to_string()).await?;
        let fingerprint = status.fingerprint();

        let next_payload = {
            let mut workspaces = self
                .inner
                .lock()
                .map_err(|_| "GIT_STATUS_COORDINATOR_LOCK_POISONED".to_string())?;
            let Some(refresh_state) = workspaces.get_mut(workspace_id) else {
                return Ok(());
            };
            if refresh_state.generation != generation || cancel.is_cancelled() {
                return Ok(());
            }
            if !force_emit
                && refresh_state.last_fingerprint.as_deref() == Some(fingerprint.as_str())
            {
                None
            } else {
                refresh_state.last_fingerprint = Some(fingerprint);
                refresh_state.revision = refresh_state.revision.saturating_add(1);
                Some(status.into_payload(workspace_id.to_string(), refresh_state.revision))
            }
        };

        if let Some(payload) = next_payload {
            if cancel.is_cancelled() || !self.is_generation_current(workspace_id, generation) {
                return Ok(());
            }
            app.emit("git/updated", payload)
                .map_err(|error| format!("GIT_EVENT_EMIT_FAILED: {error}"))?;
        }

        Ok(())
    }

    fn is_generation_current(&self, workspace_id: &str, generation: u64) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|workspaces| {
                workspaces
                    .get(workspace_id)
                    .map(|refresh_state| refresh_state.generation == generation)
            })
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub(crate) fn request_for_test(&self, workspace_id: &str, immediate: bool) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|mut workspaces| {
                workspaces
                    .get_mut(workspace_id)
                    .map(|refresh_state| refresh_state.request(immediate))
            })
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub(crate) fn worker_slots_for_test(&self, workspace_id: &str) -> usize {
        self.inner
            .lock()
            .ok()
            .and_then(|workspaces| {
                workspaces
                    .get(workspace_id)
                    .map(|refresh_state| usize::from(refresh_state.scheduled))
            })
            .unwrap_or(0)
    }
}

pub(crate) enum GitStatusSnapshot {
    Available(GitStatusSummary),
    Unavailable,
}

impl GitStatusSnapshot {
    pub(crate) fn fingerprint(&self) -> String {
        match self {
            Self::Available(summary) => serde_json::to_string(summary).unwrap_or_else(|_| {
                format!(
                    "available:{}:{}:{}",
                    summary.branch,
                    summary.ahead,
                    summary.files.len()
                )
            }),
            Self::Unavailable => "unavailable".to_string(),
        }
    }

    pub(crate) fn into_payload(self, workspace_id: String, revision: u64) -> GitUpdatedPayload {
        match self {
            Self::Available(summary) => GitUpdatedPayload {
                workspace_id,
                available: true,
                primary_repository_path: summary.primary_repository_path,
                branch: summary.branch,
                dirty: summary.total_changes > 0 || !summary.files.is_empty(),
                ahead: summary.ahead,
                behind: summary.behind,
                files: summary.files,
                repositories: summary.repositories,
                total_changes: summary.total_changes,
                truncated: summary.truncated,
                kind: summary.kind,
                state: summary.state,
                head_oid: summary.head_oid,
                expected_head_oid: summary.expected_head_oid,
                revision,
            },
            Self::Unavailable => GitUpdatedPayload {
                workspace_id,
                available: false,
                primary_repository_path: String::new(),
                branch: String::new(),
                dirty: false,
                ahead: 0,
                behind: 0,
                files: Vec::new(),
                repositories: Vec::new(),
                total_changes: 0,
                truncated: false,
                kind: Default::default(),
                state: Default::default(),
                head_oid: None,
                expected_head_oid: None,
                revision,
            },
        }
    }
}

async fn read_git_status(
    state: AppState,
    workspace_id: String,
) -> Result<GitStatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = WorkspaceId::new(workspace_id);
        match state.git_service.status(&workspace_id) {
            Ok(summary) => Ok(GitStatusSnapshot::Available(summary)),
            Err(error) => {
                let message = error.to_string();
                if is_not_git_repository_error(&message) {
                    Ok(GitStatusSnapshot::Unavailable)
                } else {
                    Err(message)
                }
            }
        }
    })
    .await
    .map_err(|error| format!("GIT_STATUS_FAILED: git worker join failed: {error}"))?
}

pub(crate) fn is_not_git_repository_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("git_repo_invalid")
        || normalized.contains("not a git repository")
        || normalized.contains("must be run in a work tree")
}
