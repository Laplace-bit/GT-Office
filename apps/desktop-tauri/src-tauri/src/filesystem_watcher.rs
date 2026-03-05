use notify::{
    event::ModifyKind, Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use vb_settings::FilesystemWatcherSettings;

struct WorkspaceWatcher {
    #[allow(dead_code)]
    root: PathBuf,
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
    #[allow(dead_code)]
    settings: FilesystemWatcherSettings,
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
        let workspace_id_for_callback = workspace_id.to_string();
        let root_for_callback = canonical_root.clone();
        let settings_for_callback = settings.clone();
        let app_handle = app.clone();

        let mut watcher =
            notify::recommended_watcher(move |result: Result<Event, notify::Error>| match result {
                Ok(event) => emit_filesystem_changed(
                    &app_handle,
                    workspace_id_for_callback.as_str(),
                    root_for_callback.as_path(),
                    &settings_for_callback,
                    event,
                ),
                Err(error) => {
                    let _ = app_handle.emit(
                        "filesystem/watch_error",
                        serde_json::json!({
                            "workspaceId": workspace_id_for_callback.as_str(),
                            "detail": error.to_string(),
                        }),
                    );
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

fn emit_filesystem_changed(
    app: &AppHandle,
    workspace_id: &str,
    root: &Path,
    settings: &FilesystemWatcherSettings,
    event: Event,
) {
    let Some(kind) = map_event_kind(&event.kind) else {
        return;
    };
    let paths = normalize_event_paths(root, &event.paths, settings);
    if paths.is_empty() {
        return;
    }

    let payload = FilesystemChangedPayload {
        workspace_id: workspace_id.to_string(),
        kind: kind.to_string(),
        paths,
        ts_ms: now_ts_ms(),
    };
    let _ = app.emit("filesystem/changed", payload);
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

#[cfg(test)]
#[path = "filesystem_watcher_tests.rs"]
mod tests;
