use gt_abstractions::{GitStatusSummary, WorkspaceId};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use tracing::warn;

use crate::app_state::AppState;

const DEFAULT_GIT_STATUS_DEBOUNCE_MS: u64 = 180;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpdatedPayload {
    pub workspace_id: String,
    pub available: bool,
    pub branch: String,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<gt_abstractions::GitStatusFile>,
    pub revision: u64,
}

#[derive(Default)]
struct WorkspaceRefreshState {
    dirty: bool,
    scheduled: bool,
    inflight: bool,
    last_fingerprint: Option<String>,
    revision: u64,
}

#[derive(Clone, Default)]
pub struct GitStatusCoordinator {
    inner: Arc<Mutex<HashMap<String, WorkspaceRefreshState>>>,
}

impl GitStatusCoordinator {
    pub fn schedule_refresh(&self, app: &AppHandle, state: &AppState, workspace_id: &str) {
        let should_spawn = {
            let mut workspaces = match self.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let refresh_state = workspaces.entry(workspace_id.to_string()).or_default();
            refresh_state.dirty = true;
            if refresh_state.scheduled || refresh_state.inflight {
                false
            } else {
                refresh_state.scheduled = true;
                true
            }
        };

        if !should_spawn {
            return;
        }

        let coordinator = self.clone();
        let app = app.clone();
        let state = state.clone();
        let workspace_id = workspace_id.to_string();
        tauri::async_runtime::spawn(async move {
            coordinator
                .run_scheduled_refresh_loop(app, state, workspace_id)
                .await;
        });
    }

    pub fn refresh_now(&self, app: &AppHandle, state: &AppState, workspace_id: &WorkspaceId) {
        let coordinator = self.clone();
        let app = app.clone();
        let state = state.clone();
        let workspace_id = workspace_id.as_str().to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = coordinator.refresh_once(&app, &state, &workspace_id).await {
                warn!(workspace_id, error = %error, "git status refresh failed");
            }
        });
    }

    async fn run_scheduled_refresh_loop(
        &self,
        app: AppHandle,
        state: AppState,
        workspace_id: String,
    ) {
        loop {
            sleep(Duration::from_millis(DEFAULT_GIT_STATUS_DEBOUNCE_MS)).await;

            {
                let mut workspaces = match self.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(refresh_state) = workspaces.get_mut(&workspace_id) else {
                    return;
                };
                refresh_state.scheduled = false;
                refresh_state.inflight = true;
                refresh_state.dirty = false;
            }

            if let Err(error) = self.refresh_once(&app, &state, &workspace_id).await {
                warn!(workspace_id, error = %error, "scheduled git status refresh failed");
            }

            let should_continue = {
                let mut workspaces = match self.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(refresh_state) = workspaces.get_mut(&workspace_id) else {
                    return;
                };
                refresh_state.inflight = false;
                if refresh_state.dirty {
                    refresh_state.scheduled = true;
                    true
                } else {
                    false
                }
            };

            if !should_continue {
                break;
            }
        }
    }

    async fn refresh_once(
        &self,
        app: &AppHandle,
        state: &AppState,
        workspace_id: &str,
    ) -> Result<(), String> {
        let status = read_git_status(state.clone(), workspace_id.to_string()).await?;
        let fingerprint = status.fingerprint();

        let next_payload = {
            let mut workspaces = self
                .inner
                .lock()
                .map_err(|_| "GIT_STATUS_COORDINATOR_LOCK_POISONED".to_string())?;
            let refresh_state = workspaces.entry(workspace_id.to_string()).or_default();
            if refresh_state.last_fingerprint.as_deref() == Some(fingerprint.as_str()) {
                None
            } else {
                refresh_state.last_fingerprint = Some(fingerprint);
                refresh_state.revision = refresh_state.revision.saturating_add(1);
                Some(status.into_payload(workspace_id.to_string(), refresh_state.revision))
            }
        };

        if let Some(payload) = next_payload {
            app.emit("git/updated", payload)
                .map_err(|error| format!("GIT_EVENT_EMIT_FAILED: {error}"))?;
        }

        Ok(())
    }
}

enum GitStatusSnapshot {
    Available(GitStatusSummary),
    Unavailable,
}

impl GitStatusSnapshot {
    fn fingerprint(&self) -> String {
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

    fn into_payload(self, workspace_id: String, revision: u64) -> GitUpdatedPayload {
        match self {
            Self::Available(summary) => GitUpdatedPayload {
                workspace_id,
                available: true,
                branch: summary.branch,
                dirty: !summary.files.is_empty(),
                ahead: summary.ahead,
                behind: summary.behind,
                files: summary.files,
                revision,
            },
            Self::Unavailable => GitUpdatedPayload {
                workspace_id,
                available: false,
                branch: String::new(),
                dirty: false,
                ahead: 0,
                behind: 0,
                files: Vec::new(),
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

fn is_not_git_repository_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("git_repo_invalid")
        || normalized.contains("not a git repository")
        || normalized.contains("must be run in a work tree")
}
