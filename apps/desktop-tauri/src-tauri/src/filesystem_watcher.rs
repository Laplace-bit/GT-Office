use gt_abstractions::WorkspaceId;
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
use tokio_util::sync::CancellationToken;

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
    cancel: CancellationToken,
}

#[derive(Default)]
struct WorkspaceWatcherRegistryState {
    watchers: HashMap<String, WorkspaceWatcher>,
    pending: HashMap<String, PendingWorkspaceWatcher>,
    next_generation: u64,
}

struct PendingWorkspaceWatcher {
    generation: u64,
    cancel: CancellationToken,
}

impl WorkspaceWatcherRegistryState {
    fn reserve_pending(&mut self, workspace_id: &str, cancel: CancellationToken) -> Option<u64> {
        if self.watchers.contains_key(workspace_id) || self.pending.contains_key(workspace_id) {
            return None;
        }
        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        self.pending.insert(
            workspace_id.to_string(),
            PendingWorkspaceWatcher { generation, cancel },
        );
        Some(generation)
    }

    fn pending_is_current(&self, workspace_id: &str, generation: u64) -> bool {
        self.pending
            .get(workspace_id)
            .is_some_and(|pending| pending.generation == generation)
    }

    fn take_pending_if_current(
        &mut self,
        workspace_id: &str,
        generation: u64,
    ) -> Option<PendingWorkspaceWatcher> {
        if !self.pending_is_current(workspace_id, generation) {
            return None;
        }
        self.pending.remove(workspace_id)
    }

    fn cancel_pending(&mut self, workspace_id: &str) {
        if let Some(pending) = self.pending.remove(workspace_id) {
            pending.cancel.cancel();
        }
    }

    fn cancel_pending_if_current(&mut self, workspace_id: &str, generation: u64) {
        if let Some(pending) = self.take_pending_if_current(workspace_id, generation) {
            pending.cancel.cancel();
        }
    }
}

#[derive(Clone, Default)]
pub struct WorkspaceWatcherRegistry {
    inner: Arc<Mutex<WorkspaceWatcherRegistryState>>,
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
    repository_cache_invalidation_required: bool,
}

impl PendingWatchEvents {
    fn clear(&mut self) {
        self.paths_by_kind.clear();
        self.errors.clear();
        self.git_refresh_required = false;
        self.repository_cache_invalidation_required = false;
    }
}

impl WorkspaceWatcherRegistry {
    pub fn ensure_workspace<R: tauri::Runtime, F: Fn() -> bool>(
        &self,
        app: &AppHandle<R>,
        workspace_id: &str,
        root: &Path,
        settings: FilesystemWatcherSettings,
        is_current: F,
    ) -> Result<(), String> {
        if !is_current() {
            return Ok(());
        }
        let canonical_root = match root.canonicalize() {
            Ok(root) => root,
            Err(_) if !is_current() => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "FS_WATCHER_INIT_FAILED: unable to canonicalize workspace root: {error}"
                ));
            }
        };

        let cancel = CancellationToken::new();
        let generation = {
            let mut registry = self
                .inner
                .lock()
                .map_err(|_| "FS_WATCHER_INIT_FAILED: watcher lock poisoned".to_string())?;
            let Some(generation) = registry.reserve_pending(workspace_id, cancel.clone()) else {
                return Ok(());
            };
            generation
        };

        if !is_current() {
            self.cancel_pending_workspace(workspace_id, generation);
            return Ok(());
        }

        let workspace_id_value = workspace_id.to_string();
        let event_tx = spawn_watch_batcher(
            app.clone(),
            workspace_id.to_string(),
            canonical_root.clone(),
            settings.clone(),
            cancel.clone(),
        );
        let event_tx_for_callback = event_tx.clone();
        let cancel_for_callback = cancel.clone();

        let watcher_result =
            (|| {
                let mut watcher =
                    notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
                        if cancel_for_callback.is_cancelled() {
                            return;
                        }
                        match result {
                            Ok(event) => {
                                let _ = event_tx_for_callback.send(WatchBatchMessage::Event(event));
                            }
                            Err(error) => {
                                let _ = event_tx_for_callback
                                    .send(WatchBatchMessage::Error(error.to_string()));
                            }
                        }
                    })
                    .map_err(|error| {
                        format!("FS_WATCHER_INIT_FAILED: unable to create watcher: {error}")
                    })?;

                watcher
                    .configure(Config::default().with_poll_interval(
                        std::time::Duration::from_millis(settings.poll_interval_ms),
                    ))
                    .map_err(|error| {
                        format!("FS_WATCHER_INIT_FAILED: unable to configure watcher: {error}")
                    })?;

                watcher
                    .watch(canonical_root.as_path(), RecursiveMode::Recursive)
                    .map_err(|error| {
                        format!("FS_WATCHER_INIT_FAILED: unable to watch workspace root: {error}")
                    })?;
                Ok::<_, String>(watcher)
            })();

        let watcher = match watcher_result {
            Ok(watcher) => watcher,
            Err(error) => {
                self.cancel_pending_workspace(workspace_id, generation);
                return Err(error);
            }
        };

        let mut registry = self
            .inner
            .lock()
            .map_err(|_| "FS_WATCHER_INIT_FAILED: watcher lock poisoned".to_string())?;
        if !registry.pending_is_current(workspace_id, generation) {
            cancel.cancel();
            return Ok(());
        }
        if cancel.is_cancelled() || !is_current() {
            registry.cancel_pending_if_current(workspace_id, generation);
            return Ok(());
        }
        let Some(_pending) = registry.take_pending_if_current(workspace_id, generation) else {
            cancel.cancel();
            return Ok(());
        };
        registry.watchers.insert(
            workspace_id_value,
            WorkspaceWatcher {
                root: canonical_root,
                watcher,
                settings,
                event_tx,
                cancel,
            },
        );
        Ok(())
    }

    pub fn remove_workspace(&self, workspace_id: &str) -> Result<(), String> {
        let mut registry = self
            .inner
            .lock()
            .map_err(|_| "FS_WATCHER_CLOSE_FAILED: watcher lock poisoned".to_string())?;
        registry.cancel_pending(workspace_id);
        if let Some(watcher) = registry.watchers.remove(workspace_id) {
            watcher.cancel.cancel();
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn contains_workspace_for_test(&self, workspace_id: &str) -> bool {
        self.inner
            .lock()
            .map(|registry| {
                registry.watchers.contains_key(workspace_id)
                    || registry.pending.contains_key(workspace_id)
            })
            .unwrap_or(true)
    }

    fn cancel_pending_workspace(&self, workspace_id: &str, generation: u64) {
        if let Ok(mut registry) = self.inner.lock() {
            registry.cancel_pending_if_current(workspace_id, generation);
        }
    }
}

fn spawn_watch_batcher<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    root: PathBuf,
    settings: FilesystemWatcherSettings,
    cancel: CancellationToken,
) -> Sender<WatchBatchMessage> {
    let (tx, rx) = mpsc::channel::<WatchBatchMessage>();
    std::thread::spawn(move || {
        let mut pending = PendingWatchEvents::default();
        loop {
            if cancel.is_cancelled() {
                pending.clear();
                return;
            }
            match rx.recv() {
                Ok(message) => {
                    accumulate_watch_batch_message(
                        root.as_path(),
                        &settings,
                        message,
                        &mut pending,
                    );
                }
                Err(_) => return,
            }

            loop {
                if cancel.is_cancelled() {
                    pending.clear();
                    return;
                }
                match rx.recv_timeout(Duration::from_millis(WATCH_EVENT_DEBOUNCE_MS)) {
                    Ok(message) => accumulate_watch_batch_message(
                        root.as_path(),
                        &settings,
                        message,
                        &mut pending,
                    ),
                    Err(RecvTimeoutError::Timeout) => {
                        flush_pending_watch_events(
                            &app,
                            workspace_id.as_str(),
                            &mut pending,
                            &cancel,
                        );
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
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
            if should_invalidate_repository_cache(root, &event, settings) {
                pending.git_refresh_required = true;
                pending.repository_cache_invalidation_required = true;
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

fn flush_pending_watch_events<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
    pending: &mut PendingWatchEvents,
    cancel: &CancellationToken,
) {
    if cancel.is_cancelled() {
        pending.clear();
        return;
    }
    if pending.paths_by_kind.is_empty()
        && pending.errors.is_empty()
        && !pending.git_refresh_required
        && !pending.repository_cache_invalidation_required
    {
        return;
    }

    for error in std::mem::take(&mut pending.errors) {
        if cancel.is_cancelled() {
            pending.clear();
            return;
        }
        let _ = app.emit(
            "filesystem/watch_error",
            serde_json::json!({
                "workspaceId": workspace_id,
                "detail": error,
            }),
        );
    }

    for kind in WATCH_EVENT_KIND_ORDER {
        if cancel.is_cancelled() {
            pending.clear();
            return;
        }
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
        if cancel.is_cancelled() {
            pending.clear();
            return;
        }
        let state = app.state::<crate::app_state::AppState>();
        let workspace_id_value = WorkspaceId::new(workspace_id.to_string());
        if pending.repository_cache_invalidation_required {
            let _ = state
                .git_service
                .invalidate_repository_cache(&workspace_id_value);
        }
        state
            .git_status_coordinator
            .schedule_refresh(app, state.inner(), workspace_id);
        pending.git_refresh_required = false;
        pending.repository_cache_invalidation_required = false;
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
    target.strip_prefix(root).ok().map(|relative| {
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if normalized.is_empty() || normalized == "." {
            ".".to_string()
        } else {
            normalized
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
                if is_git_metadata_path_of_interest(&relative) {
                    !is_git_path_under_ignored_parent(&relative, settings)
                } else {
                    !should_ignore_relative_path(&relative, settings)
                }
            })
            .unwrap_or(false)
    })
}

fn should_invalidate_repository_cache(
    root: &Path,
    event: &Event,
    settings: &FilesystemWatcherSettings,
) -> bool {
    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) {
        return false;
    }

    event.paths.iter().any(|path| {
        let Some(relative) = normalize_path(root, path.as_path()) else {
            return false;
        };
        if is_git_path_under_ignored_parent(&relative, settings)
            || (!relative
                .split('/')
                .any(|component| component.eq_ignore_ascii_case(".git"))
                && should_ignore_relative_path(&relative, settings))
        {
            return false;
        }
        if relative == ".gitmodules" || relative.ends_with("/.gitmodules") {
            return true;
        }
        let inside_git_dir = relative
            .split('/')
            .any(|component| component.eq_ignore_ascii_case(".git"));
        // A removed repository marker may only surface as its already-gone parent
        // directory, so folder removals conservatively invalidate discovery.
        if !inside_git_dir
            && matches!(
                event.kind,
                EventKind::Remove(notify::event::RemoveKind::Folder)
            )
        {
            return true;
        }
        if relative == ".git" || relative.ends_with("/.git") {
            return true;
        }

        if path.file_name().is_some_and(|name| name == ".git") {
            return true;
        }

        matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))
        ) && path.join(".git").exists()
    })
}

fn is_git_path_under_ignored_parent(relative: &str, settings: &FilesystemWatcherSettings) -> bool {
    let components = relative.split('/').collect::<Vec<_>>();
    let Some(git_index) = components
        .iter()
        .position(|component| component.eq_ignore_ascii_case(".git"))
    else {
        return false;
    };
    if git_index == 0 {
        return false;
    }
    should_ignore_relative_path(&components[..git_index].join("/"), settings)
}

fn is_git_metadata_path_of_interest(path: &str) -> bool {
    let normalized = path.trim_start_matches("./");
    let components = normalized.split('/').collect::<Vec<_>>();
    for index in 0..components.len() {
        if components[index] != ".git" {
            continue;
        }
        let suffix = &components[index + 1..];
        let file_name = suffix.last().copied().unwrap_or_default();
        let joined = suffix.join("/");
        if matches!(file_name, "HEAD" | "index" | "packed-refs" | "MERGE_HEAD")
            || joined == "refs"
            || joined.starts_with("refs/")
            || joined.contains("/refs/")
            || joined.starts_with("rebase-apply/")
            || joined.contains("/rebase-apply/")
            || joined.starts_with("rebase-merge/")
            || joined.contains("/rebase-merge/")
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
#[path = "tests/filesystem_watcher_tests.rs"]
mod tests;
