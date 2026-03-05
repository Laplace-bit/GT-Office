use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::{
    error::{DaemonError, DaemonResult},
    protocol::{DirEntryItem, ListDirRequest, ListDirResponse},
};

const DEFAULT_PAGE_SIZE: usize = 256;
const MAX_PAGE_SIZE: usize = 4096;

#[derive(Debug, Default, Clone)]
pub struct FileService;

impl FileService {
    pub fn list_dir(&self, req: &ListDirRequest) -> DaemonResult<ListDirResponse> {
        let workspace_root = canonicalize_dir(Path::new(&req.workspace_root))?;
        let target = resolve_inside_workspace(&workspace_root, &req.rel_path)?;

        let include_hidden = req.include_hidden.unwrap_or(false);
        let mut entries = Vec::new();

        for entry in fs::read_dir(&target)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();
            if !include_hidden && name.starts_with('.') {
                continue;
            }

            let path = entry.path();
            let meta = entry.metadata()?;
            let rel_path = path
                .strip_prefix(&workspace_root)
                .unwrap_or(path.as_path())
                .to_string_lossy()
                .replace('\\', "/");

            entries.push(DirEntryItem {
                name,
                rel_path,
                is_dir: meta.is_dir(),
                size: meta.len(),
                modified_ms: meta
                    .modified()
                    .ok()
                    .and_then(|ts| ts.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        let total = entries.len();
        let start = req.cursor.unwrap_or(0).min(total);
        let limit = req
            .limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let end = (start + limit).min(total);
        let next_cursor = (end < total).then_some(end);

        let page = entries[start..end].to_vec();
        Ok(ListDirResponse {
            rel_path: req.rel_path.clone(),
            entries: page,
            next_cursor,
            total,
        })
    }
}

fn canonicalize_dir(path: &Path) -> DaemonResult<PathBuf> {
    let canonical = path.canonicalize().map_err(|e| {
        DaemonError::PathDenied(format!("invalid workspace root '{}': {e}", path.display()))
    })?;
    let meta = canonical.metadata()?;
    if !meta.is_dir() {
        return Err(DaemonError::PathDenied(format!(
            "workspace root is not directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn resolve_inside_workspace(workspace_root: &Path, rel_path: &str) -> DaemonResult<PathBuf> {
    let rel = rel_path.trim();
    let joined = if rel.is_empty() || rel == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(rel)
    };

    let canonical = joined.canonicalize().map_err(|e| {
        DaemonError::PathDenied(format!("path resolve failed '{}': {e}", joined.display()))
    })?;

    if !canonical.starts_with(workspace_root) {
        return Err(DaemonError::PathDenied(format!(
            "path is outside workspace: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}
