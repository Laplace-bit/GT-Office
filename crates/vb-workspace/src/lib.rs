use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use uuid::Uuid;
use vb_abstractions::{
    AbstractionError, AbstractionResult, TerminalCwdMode, WorkspaceContext, WorkspaceId,
    WorkspacePermissions, WorkspaceService, WorkspaceSessionSnapshot, WorkspaceSummary,
};

pub fn module_name() -> &'static str {
    "vb-workspace"
}

#[derive(Debug, Clone)]
struct WorkspaceRecord {
    workspace_id: WorkspaceId,
    name: String,
    root: PathBuf,
}

#[derive(Debug, Default)]
struct WorkspaceState {
    by_id: HashMap<WorkspaceId, WorkspaceRecord>,
    by_root: HashMap<PathBuf, WorkspaceId>,
    active_workspace_id: Option<WorkspaceId>,
}

#[derive(Clone, Default)]
pub struct InMemoryWorkspaceService {
    state: Arc<RwLock<WorkspaceState>>,
}

impl InMemoryWorkspaceService {
    pub fn new() -> Self {
        Self::default()
    }

    fn canonicalize_workspace_root(path: &Path) -> AbstractionResult<PathBuf> {
        if path.as_os_str().is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "workspace path cannot be empty".to_string(),
            });
        }

        let metadata = path
            .metadata()
            .map_err(|err| AbstractionError::InvalidArgument {
                message: format!("workspace path is not accessible: {err}"),
            })?;
        if !metadata.is_dir() {
            return Err(AbstractionError::InvalidArgument {
                message: "workspace path must be a directory".to_string(),
            });
        }

        path.canonicalize()
            .map_err(|err| AbstractionError::Internal {
                message: format!("failed to canonicalize workspace path: {err}"),
            })
    }

    fn workspace_name_from_root(root: &Path) -> String {
        root.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| root.to_string_lossy().to_string())
    }

    fn summary_from_record(
        record: &WorkspaceRecord,
        active_workspace_id: Option<&WorkspaceId>,
    ) -> WorkspaceSummary {
        WorkspaceSummary {
            workspace_id: record.workspace_id.clone(),
            name: record.name.clone(),
            root: record.root.to_string_lossy().to_string(),
            active: active_workspace_id
                .map(|active| active == &record.workspace_id)
                .unwrap_or(false),
        }
    }
}

impl WorkspaceService for InMemoryWorkspaceService {
    fn list(&self) -> AbstractionResult<Vec<WorkspaceSummary>> {
        let state = self.state.read().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;

        let active_workspace_id = state.active_workspace_id.as_ref();
        let mut workspaces = state
            .by_id
            .values()
            .map(|record| Self::summary_from_record(record, active_workspace_id))
            .collect::<Vec<_>>();
        workspaces.sort_by(|left, right| left.root.cmp(&right.root));
        Ok(workspaces)
    }

    fn open(&self, path: &Path) -> AbstractionResult<WorkspaceSummary> {
        let canonical_root = Self::canonicalize_workspace_root(path)?;
        let mut state = self.state.write().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;

        if let Some(existing_workspace_id) = state.by_root.get(&canonical_root).cloned() {
            state.active_workspace_id = Some(existing_workspace_id.clone());
            let record = state.by_id.get(&existing_workspace_id).ok_or_else(|| {
                AbstractionError::Internal {
                    message: "workspace state is inconsistent".to_string(),
                }
            })?;
            return Ok(Self::summary_from_record(
                record,
                state.active_workspace_id.as_ref(),
            ));
        }

        let workspace_id = WorkspaceId::new(format!("ws:{}", Uuid::new_v4()));
        let record = WorkspaceRecord {
            workspace_id: workspace_id.clone(),
            name: Self::workspace_name_from_root(&canonical_root),
            root: canonical_root.clone(),
        };
        state.by_root.insert(canonical_root, workspace_id.clone());
        state.by_id.insert(workspace_id.clone(), record.clone());
        state.active_workspace_id = Some(workspace_id);

        Ok(Self::summary_from_record(
            &record,
            state.active_workspace_id.as_ref(),
        ))
    }

    fn close(&self, workspace_id: &WorkspaceId) -> AbstractionResult<bool> {
        let mut state = self.state.write().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;
        let removed = state.by_id.remove(workspace_id).ok_or_else(|| {
            AbstractionError::WorkspaceNotFound {
                workspace_id: workspace_id.to_string(),
            }
        })?;

        state.by_root.remove(&removed.root);
        if state.active_workspace_id.as_ref() == Some(workspace_id) {
            state.active_workspace_id = state.by_id.keys().next().cloned();
        }
        Ok(true)
    }

    fn switch_active(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceId> {
        let mut state = self.state.write().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;
        if !state.by_id.contains_key(workspace_id) {
            return Err(AbstractionError::WorkspaceNotFound {
                workspace_id: workspace_id.to_string(),
            });
        }

        state.active_workspace_id = Some(workspace_id.clone());
        Ok(workspace_id.clone())
    }

    fn get_context(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceContext> {
        let state = self.state.read().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;
        let record =
            state
                .by_id
                .get(workspace_id)
                .ok_or_else(|| AbstractionError::WorkspaceNotFound {
                    workspace_id: workspace_id.to_string(),
                })?;

        Ok(WorkspaceContext {
            workspace_id: record.workspace_id.clone(),
            root: record.root.to_string_lossy().to_string(),
            permissions: WorkspacePermissions::default(),
            terminal_default_cwd: TerminalCwdMode::WorkspaceRoot,
        })
    }

    fn restore_session(
        &self,
        workspace_id: &WorkspaceId,
    ) -> AbstractionResult<WorkspaceSessionSnapshot> {
        let state = self.state.read().map_err(|_| AbstractionError::Internal {
            message: "workspace state lock poisoned".to_string(),
        })?;
        if !state.by_id.contains_key(workspace_id) {
            return Err(AbstractionError::WorkspaceNotFound {
                workspace_id: workspace_id.to_string(),
            });
        }

        Ok(WorkspaceSessionSnapshot::default())
    }
}

#[cfg(test)]
mod tests {
    use super::InMemoryWorkspaceService;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;
    use vb_abstractions::{TerminalCwdMode, WorkspaceService};

    struct TempWorkspaceDir {
        path: PathBuf,
    }

    impl TempWorkspaceDir {
        fn create() -> Self {
            let path = std::env::temp_dir().join(format!("gtoffice-ws-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("failed to create temporary workspace directory");
            Self { path }
        }
    }

    impl Drop for TempWorkspaceDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn open_then_list_returns_workspace() {
        let tmp = TempWorkspaceDir::create();
        let service = InMemoryWorkspaceService::new();

        let opened = service.open(&tmp.path).expect("open workspace");
        let listed = service.list().expect("list workspaces");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].workspace_id, opened.workspace_id);
        assert!(listed[0].active);
    }

    #[test]
    fn open_same_directory_is_deduplicated() {
        let tmp = TempWorkspaceDir::create();
        let service = InMemoryWorkspaceService::new();

        let first = service.open(&tmp.path).expect("first open");
        let nested = tmp.path.join(".");
        let second = service.open(&nested).expect("second open");

        assert_eq!(first.workspace_id, second.workspace_id);
        assert_eq!(service.list().expect("list").len(), 1);
    }

    #[test]
    fn get_context_returns_workspace_root_default_cwd() {
        let tmp = TempWorkspaceDir::create();
        let service = InMemoryWorkspaceService::new();
        let opened = service.open(&tmp.path).expect("open workspace");

        let context = service
            .get_context(&opened.workspace_id)
            .expect("get context");
        assert_eq!(context.workspace_id, opened.workspace_id);
        assert_eq!(context.terminal_default_cwd, TerminalCwdMode::WorkspaceRoot);
        assert!(!context.root.is_empty());
    }
}
