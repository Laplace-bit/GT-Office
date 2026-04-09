use gt_settings::FilesystemWatcherSettings;
use notify::{
    event::ModifyKind, Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError, Sender},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const WATCH_EVENT_DEBOUNCE_MS: u64 = 64;
const WATCH_EVENT_KIND_ORDER: [&str; 5] = ["removed", "renamed", "created", "modified", "other"];

enum WatchBatchMessage {
    Event(Event),
    Error(String),
}

struct WorkspaceWatcher {
    #[allow(dead_code)]
    root: PathBuf,
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
    #[allow(dead_code)]
    settings: FilesystemWatcherSettings,
    #[allow(dead_code)]
    event_tx: Sender<WatchBatchMessage>,
}

#[derive(Clone, Default)]
pub struct WorkspaceWatcherRegistry {
    watchers: Arc<Mutex<HashMap<String, WorkspaceWatcher>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemChangedPayload {
    workspace_id: String,
    kind: String,
    paths: Vec<String>,
    ts_ms: u64,
}

#[derive(Default)]
struct PendingWatchEvents {
    paths_by_kind: HashMap<&'static str, HashSet<String>>,
    errors: Vec<String>,
    git_refresh_required: bool,
}

impl WorkspaceWatcherRegistry {
    pub fn ensure_workspace(
        &self,
        app: &AppHandle,
        workspace_id: &str,
        root: &Path,
        settings: FilesystemWatcherSettings,
    ) -> Result<(), String> {
        let canonical_root = root.canonicalize().map_err(|error| {
            format!("FS_WATCHER_INIT_FAILED: unable to canonicalize workspace root: {error}")
        })?;

        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| "FS_WATCHER_INIT_FAILED: watcher lock poisoned".to_string())?;
        if watchers.contains_key(workspace_id) {
            return Ok(());
        }

        let workspace_id_value = workspace_id.to_string();
        let event_tx = spawn_watch_batcher(
            app.clone(),
            workspace_id.to_string(),
            canonical_root.clone(),
            settings.clone(),
        );
        let event_tx_for_callback = event_tx.clone();

        let mut watcher =
            notify::recommended_watcher(move |result: Result<Event, notify::Error>| match result {
                Ok(event) => {
                    let _ = event_tx_for_callback.send(WatchBatchMessage::Event(event));
                }
                Err(error) => {
                    let _ = event_tx_for_callback.send(WatchBatchMessage::Error(error.to_string()));
                }
            })
            .map_err(|error| {
                format!("FS_WATCHER_INIT_FAILED: unable to create watcher: {error}")
            })?;

        watcher
            .configure(
                Config::default().with_poll_interval(std::time::Duration::from_millis(
                    settings.poll_interval_ms,
                )),
            )
            .map_err(|error| {
                format!("FS_WATCHER_INIT_FAILED: unable to configure watcher: {error}")
            })?;

        watcher
            .watch(canonical_root.as_path(), RecursiveMode::Recursive)
            .map_err(|error| {
                format!("FS_WATCHER_INIT_FAILED: unable to watch workspace root: {error}")
            })?;

        watchers.insert(
            workspace_id_value,
            WorkspaceWatcher {
                root: canonical_root,
                watcher,
                settings,
                event_tx,
            },
        );
        Ok(())
    }

    pub fn remove_workspace(&self, workspace_id: &str) -> Result<(), String> {
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| "FS_WATCHER_CLOSE_FAILED: watcher lock poisoned".to_string())?;
        watchers.remove(workspace_id);
        Ok(())
    }
}

fn spawn_watch_batcher(
    app: AppHandle,
    workspace_id: String,
    root: PathBuf,
    settings: FilesystemWatcherSettings,
) -> Sender<WatchBatchMessage> {
    let (tx, rx) = mpsc::channel::<WatchBatchMessage>();
    std::thread::spawn(move || {
        let mut pending = PendingWatchEvents::default();
        loop {
            match rx.recv() {
                Ok(message) => {
                    accumulate_watch_batch_message(
                        root.as_path(),
                        &settings,
                        message,
                        &mut pending,
                    );
                }
                Err(_) => {
                    flush_pending_watch_events(&app, workspace_id.as_str(), &mut pending);
                    return;
                }
            }

            loop {
                match rx.recv_timeout(Duration::from_millis(WATCH_EVENT_DEBOUNCE_MS)) {
                    Ok(message) => accumulate_watch_batch_message(
                        root.as_path(),
                        &settings,
                        message,
                        &mut pending,
                    ),
                    Err(RecvTimeoutError::Timeout) => {
                        flush_pending_watch_events(&app, workspace_id.as_str(), &mut pending);
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        flush_pending_watch_events(&app, workspace_id.as_str(), &mut pending);
                        return;
                    }
                }
            }
        }
    });
    tx
}

fn accumulate_watch_batch_message(
    root: &Path,
    settings: &FilesystemWatcherSettings,
    message: WatchBatchMessage,
    pending: &mut PendingWatchEvents,
) {
    match message {
        WatchBatchMessage::Event(event) => {
            if should_schedule_git_refresh(root, &event.paths, settings) {
                pending.git_refresh_required = true;
            }
            let Some(kind) = map_event_kind(&event.kind) else {
                return;
            };
            let paths = normalize_event_paths(root, &event.paths, settings);
            if paths.is_empty() {
                return;
            }
            pending.paths_by_kind.entry(kind).or_default().extend(paths);
        }
        WatchBatchMessage::Error(error) => {
            pending.errors.push(error);
        }
    }
}

fn flush_pending_watch_events(
    app: &AppHandle,
    workspace_id: &str,
    pending: &mut PendingWatchEvents,
) {
    if pending.paths_by_kind.is_empty()
        && pending.errors.is_empty()
        && !pending.git_refresh_required
    {
        return;
    }

    for error in pending.errors.drain(..) {
        let _ = app.emit(
            "filesystem/watch_error",
            serde_json::json!({
                "workspaceId": workspace_id,
                "detail": error,
            }),
        );
    }

    for kind in WATCH_EVENT_KIND_ORDER {
        let Some(paths) = pending.paths_by_kind.remove(kind) else {
            continue;
        };
        if paths.is_empty() {
            continue;
        }
        let mut normalized_paths = paths.into_iter().collect::<Vec<_>>();
        normalized_paths.sort();
        let payload = FilesystemChangedPayload {
            workspace_id: workspace_id.to_string(),
            kind: kind.to_string(),
            paths: normalized_paths,
            ts_ms: now_ts_ms(),
        };
        let _ = app.emit("filesystem/changed", payload);
    }

    if pending.git_refresh_required {
        let state = app.state::<crate::app_state::AppState>();
        state
            .git_status_coordinator
            .schedule_refresh(app, state.inner(), workspace_id);
        pending.git_refresh_required = false;
    }
}

fn map_event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(modify_kind) => match modify_kind {
            ModifyKind::Name(_) => Some("renamed"),
            _ => Some("modified"),
        },
        EventKind::Remove(_) => Some("removed"),
        EventKind::Access(_) => None,
        _ => Some("other"),
    }
}

fn now_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_event_paths(
    root: &Path,
    paths: &[PathBuf],
    settings: &FilesystemWatcherSettings,
) -> Vec<String> {
    let mut deduplicated = HashSet::new();
    let mut normalized = Vec::new();

    for path in paths {
        if let Some(relative) = normalize_path(root, path.as_path()) {
            if should_ignore_relative_path(&relative, settings) {
                continue;
            }
            if deduplicated.insert(relative.clone()) {
                normalized.push(relative);
            }
        }
    }

    normalized
}

fn normalize_path(root: &Path, target: &Path) -> Option<String> {
    if target == root {
        return Some(".".to_string());
    }
    target.strip_prefix(root).ok().and_then(|relative| {
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if normalized.is_empty() || normalized == "." {
            Some(".".to_string())
        } else {
            Some(normalized)
        }
    })
}

fn should_ignore_relative_path(path: &str, settings: &FilesystemWatcherSettings) -> bool {
    if path == "." {
        return false;
    }

    let normalized = path.trim_start_matches("./");
    let file_name = normalized.rsplit('/').next().unwrap_or_default();
    if settings
        .ignored_exact_files
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(file_name))
    {
        return true;
    }
    if settings.ignored_suffixes.iter().any(|suffix| {
        file_name
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
    }) {
        return true;
    }

    normalized.split('/').any(|segment| {
        settings
            .ignored_dirs
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(segment))
    })
}

fn should_schedule_git_refresh(
    root: &Path,
    paths: &[PathBuf],
    settings: &FilesystemWatcherSettings,
) -> bool {
    paths.iter().any(|path| {
        normalize_path(root, path.as_path())
            .map(|relative| {
                is_git_metadata_path_of_interest(&relative)
                    || !should_ignore_relative_path(&relative, settings)
            })
            .unwrap_or(false)
    })
}

fn is_git_metadata_path_of_interest(path: &str) -> bool {
    let normalized = path.trim_start_matches("./");
    matches!(
        normalized,
        ".git/HEAD" | ".git/index" | ".git/packed-refs" | ".git/MERGE_HEAD"
    ) || normalized.starts_with(".git/refs/heads/")
        || normalized.starts_with(".git/rebase-apply/")
        || normalized.starts_with(".git/rebase-merge/")
}

#[cfg(test)]
#[path = "tests/filesystem_watcher_tests.rs"]
mod tests;
