use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder};
use ignore::{overrides::OverrideBuilder, WalkBuilder, WalkState};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, State};
use uuid::Uuid;
use vb_abstractions::{WorkspaceId, WorkspaceService};
use vb_daemon::protocol::SearchStartRequest;

use crate::app_state::AppState;

const MAX_LIST_ENTRIES: usize = 4000;
const MAX_SEARCH_MATCHES: usize = 500;
const MAX_FILE_SEARCH_MATCHES: usize = 120;

#[derive(Debug, Clone)]
struct SearchMatch {
    path: String,
    line: u64,
    preview: String,
}

#[derive(Debug, Clone)]
struct FileSearchMatch {
    path: String,
    name: String,
}

#[derive(Debug, Clone)]
struct SearchTicket {
    generation: Arc<AtomicU64>,
    value: u64,
}

impl SearchTicket {
    fn new(workspace_id: &str) -> Self {
        let generation = acquire_search_generation(workspace_id);
        let value = generation.fetch_add(1, Ordering::SeqCst) + 1;
        Self { generation, value }
    }

    fn is_cancelled(&self) -> bool {
        self.generation.load(Ordering::Acquire) != self.value
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSystemEntry {
    path: String,
    name: String,
    kind: String,
    size_bytes: Option<u64>,
}

fn build_fs_list_dir_response(
    workspace_id: &str,
    path: &str,
    depth: u32,
    entries: &[FileSystemEntry],
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "path": path,
        "depth": depth,
        "entries": entries
    })
}

fn build_fs_read_file_response(
    workspace_id: &str,
    path: &str,
    content: &str,
    encoding: &str,
    size_bytes: u64,
    preview_bytes: u64,
    previewable: bool,
    truncated: bool,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "path": path,
        "content": content,
        "encoding": encoding,
        "sizeBytes": size_bytes,
        "previewBytes": preview_bytes,
        "previewable": previewable,
        "truncated": truncated
    })
}

fn build_fs_write_file_response(workspace_id: &str, path: &str, bytes: usize) -> Value {
    json!({
        "workspaceId": workspace_id,
        "path": path,
        "bytes": bytes,
        "written": true
    })
}

fn build_fs_delete_response(workspace_id: &str, path: &str, kind: &str, deleted: bool) -> Value {
    json!({
        "workspaceId": workspace_id,
        "path": path,
        "kind": kind,
        "deleted": deleted
    })
}

fn build_fs_move_response(
    workspace_id: &str,
    from_path: &str,
    to_path: &str,
    kind: &str,
    moved: bool,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "fromPath": from_path,
        "toPath": to_path,
        "kind": kind,
        "moved": moved
    })
}

fn build_fs_search_text_response(
    workspace_id: &str,
    query: &str,
    glob: Option<String>,
    matches: Vec<SearchMatch>,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "query": query,
        "glob": glob,
        "matches": matches
            .into_iter()
            .map(|entry| {
                json!({
                    "path": entry.path,
                    "line": entry.line,
                    "preview": entry.preview
                })
            })
            .collect::<Vec<_>>()
    })
}

fn build_fs_search_files_response(
    workspace_id: &str,
    query: &str,
    matches: Vec<FileSearchMatch>,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "query": query,
        "matches": matches
            .into_iter()
            .map(|entry| {
                json!({
                    "path": entry.path,
                    "name": entry.name
                })
            })
            .collect::<Vec<_>>()
    })
}

fn build_fs_search_stream_start_response(workspace_id: &str, search_id: &str) -> Value {
    json!({
        "workspaceId": workspace_id,
        "searchId": search_id,
        "accepted": true
    })
}

fn build_fs_search_stream_cancel_response(search_id: &str, cancelled: bool) -> Value {
    json!({
        "searchId": search_id,
        "cancelled": cancelled
    })
}

fn search_generation_registry() -> &'static Mutex<HashMap<String, Arc<AtomicU64>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicU64>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn acquire_search_generation(workspace_id: &str) -> Arc<AtomicU64> {
    let registry = search_generation_registry();
    match registry.lock() {
        Ok(mut guard) => guard
            .entry(workspace_id.to_string())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone(),
        Err(_) => Arc::new(AtomicU64::new(0)),
    }
}

fn try_claim_slot(counter: &AtomicUsize, max_matches: usize) -> bool {
    let mut current = counter.load(Ordering::Relaxed);
    loop {
        if current >= max_matches {
            return false;
        }
        match counter.compare_exchange_weak(
            current,
            current + 1,
            Ordering::AcqRel,
            Ordering::Relaxed,
        ) {
            Ok(_) => return true,
            Err(next) => current = next,
        }
    }
}

fn resolve_workspace_root(state: &AppState, workspace_id: &str) -> Result<PathBuf, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let context = state
        .workspace_service
        .get_context(&workspace_id)
        .map_err(|error| error.to_string())?;
    let root = PathBuf::from(context.root);
    root.canonicalize()
        .map_err(|error| format!("FS_PATH_INVALID: workspace root is not accessible: {error}"))
}

fn is_likely_binary(content: &[u8]) -> bool {
    if content.is_empty() {
        return false;
    }

    if content.contains(&0) {
        return true;
    }

    let sample_len = content.len().min(1024);
    let control_bytes = content
        .iter()
        .take(sample_len)
        .filter(|byte| (**byte < 0x09) || (**byte > 0x0D && **byte < 0x20))
        .count();

    control_bytes * 100 / sample_len > 30
}

fn read_file_with_limit(
    workspace_id: &str,
    path: &str,
    target: &Path,
    max_bytes: usize,
) -> Result<Value, String> {
    let metadata = target
        .metadata()
        .map_err(|error| format!("FS_READ_FAILED: metadata read failed: {error}"))?;
    let size_bytes = metadata.len();

    let mut file = fs::File::open(target)
        .map_err(|error| format!("FS_READ_FAILED: unable to open file: {error}"))?;
    let mut preview = Vec::with_capacity(max_bytes + 1);
    file.by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut preview)
        .map_err(|error| format!("FS_READ_FAILED: unable to read preview bytes: {error}"))?;

    let truncated = preview.len() > max_bytes || size_bytes > max_bytes as u64;
    if preview.len() > max_bytes {
        preview.truncate(max_bytes);
    }
    let preview_bytes = preview.len() as u64;

    if is_likely_binary(&preview) {
        return Ok(build_fs_read_file_response(
            workspace_id,
            path,
            "",
            "binary",
            size_bytes,
            preview_bytes,
            false,
            truncated,
        ));
    }

    let content = String::from_utf8_lossy(&preview).to_string();
    Ok(build_fs_read_file_response(
        workspace_id,
        path,
        content.as_str(),
        "utf-8",
        size_bytes,
        preview_bytes,
        true,
        truncated,
    ))
}

fn sanitize_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Ok(PathBuf::from("."));
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return Err(format!(
            "FS_PATH_INVALID: absolute path is not allowed '{}'",
            candidate.display()
        ));
    }
    if candidate
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err(format!(
            "FS_PATH_INVALID: parent traversal is not allowed '{}'",
            candidate.display()
        ));
    }

    Ok(candidate)
}

fn resolve_target_path(
    root: &Path,
    relative: &str,
    must_exist: bool,
    expect_dir: Option<bool>,
) -> Result<PathBuf, String> {
    let relative_path = sanitize_relative_path(relative)?;
    let joined = root.join(relative_path);

    if must_exist {
        let canonical = joined
            .canonicalize()
            .map_err(|error| format!("FS_PATH_INVALID: path is not accessible: {error}"))?;
        if !canonical.starts_with(root) {
            return Err(format!(
                "FS_PATH_OUTSIDE_WORKSPACE: '{}' is outside workspace '{}'",
                canonical.display(),
                root.display()
            ));
        }
        if let Some(expect_dir) = expect_dir {
            let metadata = canonical
                .metadata()
                .map_err(|error| format!("FS_PATH_INVALID: metadata read failed: {error}"))?;
            if metadata.is_dir() != expect_dir {
                return Err(if expect_dir {
                    "FS_PATH_INVALID: expected directory".to_string()
                } else {
                    "FS_PATH_INVALID: expected file".to_string()
                });
            }
        }
        return Ok(canonical);
    }

    // For non-existing paths, find the nearest existing ancestor to validate
    // that the path stays within the workspace boundary.
    let mut check_path = joined.as_path();
    loop {
        if check_path.exists() {
            let canonical_ancestor = check_path.canonicalize().map_err(|error| {
                format!("FS_PATH_INVALID: ancestor path is not accessible: {error}")
            })?;
            if !canonical_ancestor.starts_with(root) {
                return Err(format!(
                    "FS_PATH_OUTSIDE_WORKSPACE: '{}' is outside workspace '{}'",
                    canonical_ancestor.display(),
                    root.display()
                ));
            }
            break;
        }
        match check_path.parent() {
            Some(parent) => check_path = parent,
            None => {
                // Reached filesystem root without finding existing ancestor
                return Err("FS_PATH_INVALID: no valid ancestor found".to_string());
            }
        }
    }

    Ok(joined)
}

fn collect_list_entries(
    workspace_root: &Path,
    current_dir: &Path,
    max_depth: u32,
    entries: &mut Vec<FileSystemEntry>,
    remaining: &mut usize,
) -> Result<(), String> {
    if *remaining == 0 {
        return Ok(());
    }

    let dir_entries = fs::read_dir(current_dir)
        .map_err(|error| format!("FS_LIST_FAILED: unable to read directory: {error}"))?;

    for entry in dir_entries {
        if *remaining == 0 {
            break;
        }
        let entry = entry
            .map_err(|error| format!("FS_LIST_FAILED: unable to read directory entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("FS_LIST_FAILED: file type read failed: {error}"))?;
        let is_dir = file_type.is_dir();
        let kind = if is_dir { "dir" } else { "file" };
        let relative_path = path
            .strip_prefix(workspace_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(FileSystemEntry {
            path: relative_path,
            name: entry.file_name().to_string_lossy().to_string(),
            kind: kind.to_string(),
            size_bytes: None,
        });
        *remaining -= 1;

        if is_dir && max_depth > 1 {
            collect_list_entries(workspace_root, &path, max_depth - 1, entries, remaining)?;
        }
    }

    Ok(())
}

fn search_text_matches(
    workspace_root: &Path,
    query: &str,
    glob: Option<&str>,
    max_matches: usize,
    search_ticket: SearchTicket,
) -> Result<Vec<SearchMatch>, String> {
    let available_threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(2, 16);
    let mut walk_builder = WalkBuilder::new(workspace_root);
    walk_builder
        .standard_filters(true)
        .hidden(true)
        .git_ignore(true)
        .threads(available_threads);

    if let Some(pattern) = glob.map(str::trim).filter(|value| !value.is_empty()) {
        let mut overrides = OverrideBuilder::new(workspace_root);
        overrides
            .add(pattern)
            .map_err(|error| format!("FS_SEARCH_INVALID: invalid glob pattern: {error}"))?;
        let overrides = overrides
            .build()
            .map_err(|error| format!("FS_SEARCH_INVALID: invalid glob override: {error}"))?;
        walk_builder.overrides(overrides);
    }

    let matcher_probe = RegexMatcherBuilder::new()
        .fixed_strings(true)
        .line_terminator(Some(b'\n'))
        .build(query)
        .map_err(|error| format!("FS_SEARCH_INVALID: invalid query: {error}"))?;
    drop(matcher_probe);

    let query_owned = query.to_string();
    let workspace_root = workspace_root.to_path_buf();
    let matches = Arc::new(Mutex::new(Vec::<SearchMatch>::new()));
    let match_count = Arc::new(AtomicUsize::new(0));
    let parallel_walker = walk_builder.build_parallel();

    parallel_walker.run(|| {
        let matcher = match RegexMatcherBuilder::new()
            .fixed_strings(true)
            .line_terminator(Some(b'\n'))
            .build(query_owned.as_str())
        {
            Ok(matcher) => matcher,
            Err(_) => return Box::new(|_| WalkState::Quit),
        };
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .build();
        let matches = Arc::clone(&matches);
        let match_count = Arc::clone(&match_count);
        let workspace_root = workspace_root.clone();
        let search_ticket = search_ticket.clone();

        Box::new(move |entry| {
            if search_ticket.is_cancelled() {
                return WalkState::Quit;
            }
            if match_count.load(Ordering::Relaxed) >= max_matches {
                return WalkState::Quit;
            }

            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => return WalkState::Continue,
            };
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }

            let path = entry.path().to_path_buf();
            let rel_path = path
                .strip_prefix(&workspace_root)
                .unwrap_or(path.as_path())
                .to_string_lossy()
                .replace('\\', "/");
            let rel_path_for_sink = rel_path.clone();
            let mut sink = UTF8(|line_no: u64, line: &str| {
                if search_ticket.is_cancelled() {
                    return Ok(false);
                }
                if !try_claim_slot(match_count.as_ref(), max_matches) {
                    return Ok(false);
                }
                if let Ok(mut guard) = matches.lock() {
                    guard.push(SearchMatch {
                        path: rel_path_for_sink.clone(),
                        line: line_no,
                        preview: line.trim_end().to_string(),
                    });
                }
                Ok(!search_ticket.is_cancelled()
                    && match_count.load(Ordering::Relaxed) < max_matches)
            });

            if searcher.search_path(&matcher, &path, &mut sink).is_err() {
                return WalkState::Continue;
            }
            if search_ticket.is_cancelled() || match_count.load(Ordering::Relaxed) >= max_matches {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let mut collected = match matches.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    collected.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.preview.cmp(&right.preview))
    });
    collected.truncate(max_matches);
    Ok(collected)
}

fn search_file_matches(
    workspace_root: &Path,
    query: &str,
    max_matches: usize,
    search_ticket: SearchTicket,
) -> Result<Vec<FileSearchMatch>, String> {
    let available_threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(2, 16);
    let mut walk_builder = WalkBuilder::new(workspace_root);
    walk_builder
        .standard_filters(true)
        .hidden(true)
        .git_ignore(true)
        .threads(available_threads);

    let query_lower = query.to_lowercase();
    let workspace_root = workspace_root.to_path_buf();
    let matches = Arc::new(Mutex::new(Vec::<FileSearchMatch>::new()));
    let match_count = Arc::new(AtomicUsize::new(0));
    let parallel_walker = walk_builder.build_parallel();

    parallel_walker.run(|| {
        let query_lower = query_lower.clone();
        let matches = Arc::clone(&matches);
        let match_count = Arc::clone(&match_count);
        let workspace_root = workspace_root.clone();
        let search_ticket = search_ticket.clone();

        Box::new(move |entry| {
            if search_ticket.is_cancelled() {
                return WalkState::Quit;
            }
            if match_count.load(Ordering::Relaxed) >= max_matches {
                return WalkState::Quit;
            }

            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => return WalkState::Continue,
            };
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }

            let path = entry.path().to_path_buf();
            let rel_path = path
                .strip_prefix(&workspace_root)
                .unwrap_or(path.as_path())
                .to_string_lossy()
                .replace('\\', "/");
            let name = entry.file_name().to_string_lossy().to_string();
            let search_text = format!("{} {}", rel_path.to_lowercase(), name.to_lowercase());
            if !search_text.contains(&query_lower) {
                return WalkState::Continue;
            }
            if !try_claim_slot(match_count.as_ref(), max_matches) {
                return WalkState::Quit;
            }
            if let Ok(mut guard) = matches.lock() {
                guard.push(FileSearchMatch {
                    path: rel_path,
                    name,
                });
            }

            if search_ticket.is_cancelled() || match_count.load(Ordering::Relaxed) >= max_matches {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let mut collected = match matches.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    collected.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.name.cmp(&right.name))
    });
    collected.truncate(max_matches);
    Ok(collected)
}

#[tauri::command]
pub fn fs_list_dir(
    workspace_id: String,
    path: String,
    depth: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let target = resolve_target_path(&root, &path, true, Some(true))?;
    let max_depth = depth.unwrap_or(1).clamp(1, 8);
    let mut entries = Vec::new();
    let mut remaining = MAX_LIST_ENTRIES;
    collect_list_entries(&root, &target, max_depth, &mut entries, &mut remaining)?;

    Ok(build_fs_list_dir_response(
        workspace_id.as_str(),
        path.as_str(),
        max_depth,
        &entries,
    ))
}

#[tauri::command]
pub fn fs_read_file(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let runtime = state.load_runtime_settings(Some(workspace_id.as_str()))?;
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let target = resolve_target_path(&root, &path, true, Some(false))?;
    read_file_with_limit(
        workspace_id.as_str(),
        path.as_str(),
        &target,
        runtime.filesystem.preview.max_bytes,
    )
}

#[tauri::command]
pub fn fs_read_file_full(
    workspace_id: String,
    path: String,
    limit_bytes: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let runtime = state.load_runtime_settings(Some(workspace_id.as_str()))?;
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let target = resolve_target_path(&root, &path, true, Some(false))?;
    let preview_max_bytes = runtime.filesystem.preview.max_bytes;
    let full_read_default_max_bytes = runtime.filesystem.preview.full_read_default_max_bytes;
    let full_read_hard_max_bytes = runtime.filesystem.preview.full_read_hard_max_bytes;
    let resolved_limit = limit_bytes
        .unwrap_or(full_read_default_max_bytes as u64)
        .clamp(preview_max_bytes as u64, full_read_hard_max_bytes as u64)
        as usize;
    read_file_with_limit(
        workspace_id.as_str(),
        path.as_str(),
        &target,
        resolved_limit,
    )
}

#[tauri::command]
pub fn fs_write_file(
    workspace_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let target = resolve_target_path(&root, &path, false, None)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("FS_WRITE_FAILED: unable to create parent directory: {error}")
        })?;
    }
    fs::write(&target, content.as_bytes())
        .map_err(|error| format!("FS_WRITE_FAILED: unable to write file: {error}"))?;

    Ok(build_fs_write_file_response(
        workspace_id.as_str(),
        path.as_str(),
        content.len(),
    ))
}

#[tauri::command]
pub fn fs_delete(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Err("FS_DELETE_INVALID: cannot delete workspace root".to_string());
    }

    let root = resolve_workspace_root(&state, &workspace_id)?;
    let target = resolve_target_path(&root, trimmed, true, None)?;
    let metadata = target
        .metadata()
        .map_err(|error| format!("FS_DELETE_FAILED: metadata read failed: {error}"))?;
    let kind = if metadata.is_dir() { "dir" } else { "file" };

    if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("FS_DELETE_FAILED: unable to delete directory: {error}"))?;
    } else {
        fs::remove_file(&target)
            .map_err(|error| format!("FS_DELETE_FAILED: unable to delete file: {error}"))?;
    }

    Ok(build_fs_delete_response(
        workspace_id.as_str(),
        trimmed,
        kind,
        true,
    ))
}

#[tauri::command]
pub fn fs_move(
    workspace_id: String,
    from_path: String,
    to_path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let from_trimmed = from_path.trim();
    let to_trimmed = to_path.trim();
    if from_trimmed.is_empty() || from_trimmed == "." {
        return Err("FS_MOVE_INVALID: source path cannot be workspace root".to_string());
    }
    if to_trimmed.is_empty() || to_trimmed == "." {
        return Err("FS_MOVE_INVALID: target path cannot be workspace root".to_string());
    }

    let root = resolve_workspace_root(&state, &workspace_id)?;
    let source = resolve_target_path(&root, from_trimmed, true, None)?;
    let target = resolve_target_path(&root, to_trimmed, false, None)?;

    if source == target {
        let metadata = source
            .metadata()
            .map_err(|error| format!("FS_MOVE_FAILED: metadata read failed: {error}"))?;
        let kind = if metadata.is_dir() { "dir" } else { "file" };
        return Ok(build_fs_move_response(
            workspace_id.as_str(),
            from_trimmed,
            to_trimmed,
            kind,
            false,
        ));
    }

    if target.exists() {
        return Err(format!(
            "FS_MOVE_CONFLICT: target path already exists '{}'",
            to_trimmed
        ));
    }

    let metadata = source
        .metadata()
        .map_err(|error| format!("FS_MOVE_FAILED: metadata read failed: {error}"))?;
    let kind = if metadata.is_dir() { "dir" } else { "file" };

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("FS_MOVE_FAILED: unable to create target parent: {error}"))?;
    }

    fs::rename(&source, &target)
        .map_err(|error| format!("FS_MOVE_FAILED: unable to move path: {error}"))?;

    Ok(build_fs_move_response(
        workspace_id.as_str(),
        from_trimmed,
        to_trimmed,
        kind,
        true,
    ))
}

#[tauri::command]
pub async fn fs_search_stream_start(
    workspace_id: String,
    search_id: Option<String>,
    query: String,
    glob: Option<String>,
    chunk_size: Option<u32>,
    max_results: Option<u32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Err("FS_SEARCH_INVALID: query cannot be empty".to_string());
    }

    let resolved_search_id = search_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("search_{}", Uuid::new_v4()));

    let request = SearchStartRequest {
        search_id: resolved_search_id.clone(),
        workspace_root: root.to_string_lossy().to_string(),
        query: trimmed_query.to_string(),
        glob,
        case_sensitive: Some(false),
        chunk_size: chunk_size.map(|value| value.max(1) as usize),
        max_results: max_results.map(|value| value.max(1) as usize),
    };

    let accepted_search_id = state.daemon_bridge.search_start(&app, request).await?;
    Ok(build_fs_search_stream_start_response(
        workspace_id.as_str(),
        accepted_search_id.as_str(),
    ))
}

#[tauri::command]
pub async fn fs_search_stream_cancel(
    search_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let trimmed_search_id = search_id.trim();
    if trimmed_search_id.is_empty() {
        return Err("FS_SEARCH_INVALID: search id cannot be empty".to_string());
    }
    let cancelled = state
        .daemon_bridge
        .search_cancel(&app, trimmed_search_id.to_string())
        .await?;
    Ok(build_fs_search_stream_cancel_response(
        trimmed_search_id,
        cancelled,
    ))
}

#[tauri::command]
pub async fn fs_search_text(
    workspace_id: String,
    query: String,
    glob: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Err("FS_SEARCH_INVALID: query cannot be empty".to_string());
    }
    let search_ticket = SearchTicket::new(workspace_id.as_str());
    let query_owned = trimmed_query.to_string();
    let glob_owned = glob.clone();
    let root_for_search = root.clone();

    let matches = tokio::task::spawn_blocking(move || {
        search_text_matches(
            &root_for_search,
            query_owned.as_str(),
            glob_owned.as_deref(),
            MAX_SEARCH_MATCHES,
            search_ticket,
        )
    })
    .await
    .map_err(|error| format!("FS_SEARCH_FAILED: search worker join failed: {error}"))??;

    Ok(build_fs_search_text_response(
        workspace_id.as_str(),
        query.as_str(),
        glob,
        matches,
    ))
}

#[tauri::command]
pub async fn fs_search_files(
    workspace_id: String,
    query: String,
    max_results: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let root = resolve_workspace_root(&state, &workspace_id)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Err("FS_SEARCH_INVALID: query cannot be empty".to_string());
    }
    let search_ticket = SearchTicket::new(workspace_id.as_str());
    let query_owned = trimmed_query.to_string();
    let root_for_search = root.clone();
    let limit = max_results
        .map(|value| value.max(1) as usize)
        .unwrap_or(MAX_FILE_SEARCH_MATCHES)
        .min(MAX_SEARCH_MATCHES);

    let matches = tokio::task::spawn_blocking(move || {
        search_file_matches(&root_for_search, query_owned.as_str(), limit, search_ticket)
    })
    .await
    .map_err(|error| format!("FS_SEARCH_FAILED: search worker join failed: {error}"))??;

    Ok(build_fs_search_files_response(
        workspace_id.as_str(),
        query.as_str(),
        matches,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        build_fs_delete_response, build_fs_list_dir_response, build_fs_move_response,
        build_fs_read_file_response, build_fs_search_files_response, build_fs_search_text_response,
        build_fs_write_file_response, is_likely_binary, resolve_target_path,
        sanitize_relative_path, search_file_matches, search_text_matches, FileSearchMatch,
        FileSystemEntry, SearchMatch, SearchTicket,
    };
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    use vb_settings::{
        DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES, DEFAULT_FS_FULL_READ_HARD_MAX_BYTES,
        DEFAULT_FS_PREVIEW_MAX_BYTES,
    };

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn create() -> Self {
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("gtoffice-fs-cmd-test-{seed}"));
            fs::create_dir_all(&path).expect("failed to create temp dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn sanitize_rejects_parent_traversal() {
        let err = sanitize_relative_path("../secret").expect_err("expected invalid path");
        assert!(err.contains("parent traversal"));
    }

    #[test]
    fn resolve_existing_file_inside_workspace() {
        let tmp = TempDir::create();
        let file = tmp.path.join("a.txt");
        fs::write(&file, "hello").expect("write file");
        let canonical_root = tmp.path.canonicalize().expect("canonical root");
        let resolved = resolve_target_path(&canonical_root, "a.txt", true, Some(false))
            .expect("resolve file path");
        assert_eq!(resolved, file.canonicalize().expect("canonical file"));
    }

    #[test]
    fn resolve_rejects_absolute_path() {
        let tmp = TempDir::create();
        let canonical_root = tmp.path.canonicalize().expect("canonical root");
        let err = resolve_target_path(&canonical_root, "/etc/passwd", true, None)
            .expect_err("expected absolute path rejection");
        assert!(err.contains("absolute path"));
    }

    #[test]
    fn fs_list_dir_payload_keeps_contract_fields() {
        let payload = build_fs_list_dir_response(
            "ws-1",
            ".",
            1,
            &[FileSystemEntry {
                path: "src".to_string(),
                name: "src".to_string(),
                kind: "dir".to_string(),
                size_bytes: None,
            }],
        );
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["path"], ".");
        assert_eq!(payload["depth"], 1);
        assert_eq!(payload["entries"][0]["path"], "src");
        assert_eq!(payload["entries"][0]["kind"], "dir");
    }

    #[test]
    fn fs_read_file_payload_keeps_contract_fields() {
        let payload =
            build_fs_read_file_response("ws-1", "README.md", "hello", "utf-8", 5, 5, true, false);
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["path"], "README.md");
        assert_eq!(payload["content"], "hello");
        assert_eq!(payload["encoding"], "utf-8");
        assert_eq!(payload["sizeBytes"], 5);
        assert_eq!(payload["previewBytes"], 5);
        assert_eq!(payload["previewable"], true);
        assert_eq!(payload["truncated"], false);
    }

    #[test]
    fn fs_write_file_payload_keeps_contract_fields() {
        let payload = build_fs_write_file_response("ws-1", "README.md", 12);
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["path"], "README.md");
        assert_eq!(payload["bytes"], 12);
        assert_eq!(payload["written"], true);
    }

    #[test]
    fn fs_delete_payload_keeps_contract_fields() {
        let payload = build_fs_delete_response("ws-1", "README.md", "file", true);
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["path"], "README.md");
        assert_eq!(payload["kind"], "file");
        assert_eq!(payload["deleted"], true);
    }

    #[test]
    fn fs_move_payload_keeps_contract_fields() {
        let payload = build_fs_move_response("ws-1", "a.md", "b.md", "file", true);
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["fromPath"], "a.md");
        assert_eq!(payload["toPath"], "b.md");
        assert_eq!(payload["kind"], "file");
        assert_eq!(payload["moved"], true);
    }

    #[test]
    fn fs_search_payload_keeps_contract_fields() {
        let payload = build_fs_search_text_response(
            "ws-1",
            "workspace",
            Some("*.md".to_string()),
            vec![SearchMatch {
                path: "README.md".to_string(),
                line: 12,
                preview: "workspace model".to_string(),
            }],
        );
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["query"], "workspace");
        assert_eq!(payload["glob"], "*.md");
        assert_eq!(payload["matches"][0]["path"], "README.md");
        assert_eq!(payload["matches"][0]["line"], 12);
    }

    #[test]
    fn fs_search_files_payload_keeps_contract_fields() {
        let payload = build_fs_search_files_response(
            "ws-1",
            "task",
            vec![FileSearchMatch {
                path: "docs/task-center.md".to_string(),
                name: "task-center.md".to_string(),
            }],
        );
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["query"], "task");
        assert_eq!(payload["matches"][0]["path"], "docs/task-center.md");
        assert_eq!(payload["matches"][0]["name"], "task-center.md");
    }

    #[test]
    fn search_text_matches_finds_literal_content() {
        let tmp = TempDir::create();
        fs::write(tmp.path.join("a.txt"), "hello needle world").expect("write file");
        fs::write(tmp.path.join("b.txt"), "no hit").expect("write file");

        let matches = search_text_matches(
            &tmp.path,
            "needle",
            None,
            20,
            SearchTicket::new("test-search-literal"),
        )
        .expect("search");
        assert_eq!(matches.len(), 1);
        let first = &matches[0];
        assert_eq!(first.path, "a.txt");
        assert_eq!(first.line, 1);
    }

    #[test]
    fn search_text_matches_treats_query_as_fixed_string() {
        let tmp = TempDir::create();
        fs::write(tmp.path.join("a.txt"), "literal [abc] token").expect("write file");

        let matches = search_text_matches(
            &tmp.path,
            "[abc]",
            None,
            20,
            SearchTicket::new("test-search-fixed"),
        )
        .expect("search");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].preview, "literal [abc] token");
    }

    #[test]
    fn search_file_matches_finds_by_file_name() {
        let tmp = TempDir::create();
        fs::create_dir_all(tmp.path.join("docs")).expect("create docs dir");
        fs::create_dir_all(tmp.path.join("src")).expect("create src dir");
        fs::write(tmp.path.join("docs/task-center.md"), "# task center").expect("write file");
        fs::write(tmp.path.join("src/main.rs"), "fn main() {}").expect("write file");

        let matches = search_file_matches(
            &tmp.path,
            "task",
            20,
            SearchTicket::new("test-search-files"),
        )
        .expect("search");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "docs/task-center.md");
        assert_eq!(matches[0].name, "task-center.md");
    }

    #[test]
    fn full_read_limit_is_larger_than_preview_limit() {
        assert!(DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES > DEFAULT_FS_PREVIEW_MAX_BYTES);
        assert!(DEFAULT_FS_FULL_READ_HARD_MAX_BYTES >= DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES);
    }

    #[test]
    fn binary_detector_accepts_plain_text() {
        assert!(!is_likely_binary("workspace".as_bytes()));
    }

    #[test]
    fn binary_detector_rejects_nul_bytes() {
        assert!(is_likely_binary(&[0, 159, 146, 150]));
    }
}
