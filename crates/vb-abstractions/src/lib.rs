use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use thiserror::Error;

pub type AbstractionResult<T> = Result<T, AbstractionError>;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AbstractionError {
    #[error("workspace not found: {workspace_id}")]
    WorkspaceNotFound { workspace_id: String },
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
    #[error("access denied: {message}")]
    AccessDenied { message: String },
    #[error("conflict: {message}")]
    Conflict { message: String },
    #[error("internal error: {message}")]
    Internal { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WorkspaceId(String);

impl WorkspaceId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for WorkspaceId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for WorkspaceId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl fmt::Display for WorkspaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub root: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePermissions {
    pub allow_terminal: bool,
    pub allow_git: bool,
    pub allow_file_read: bool,
    pub allow_file_write: bool,
}

impl Default for WorkspacePermissions {
    fn default() -> Self {
        Self {
            allow_terminal: true,
            allow_git: true,
            allow_file_read: true,
            allow_file_write: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalCwdMode {
    WorkspaceRoot,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub workspace_id: WorkspaceId,
    pub root: String,
    pub permissions: WorkspacePermissions,
    pub terminal_default_cwd: TerminalCwdMode,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionSnapshot {
    pub windows: Vec<Value>,
    pub tabs: Vec<Value>,
    pub terminals: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateRequest {
    pub workspace_id: WorkspaceId,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cwd_mode: TerminalCwdMode,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub session_id: String,
    pub workspace_id: WorkspaceId,
    pub resolved_cwd: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitStatusFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFile {
    pub path: String,
    pub staged: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingsScope {
    User,
    Workspace,
    Session,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub values: Value,
    pub sources: Value,
}

pub trait WorkspaceScopedService: Send + Sync {
    fn workspace_id(&self) -> &WorkspaceId;
}

pub trait WorkspaceService: Send + Sync {
    fn list(&self) -> AbstractionResult<Vec<WorkspaceSummary>>;
    fn open(&self, path: &Path) -> AbstractionResult<WorkspaceSummary>;
    fn close(&self, workspace_id: &WorkspaceId) -> AbstractionResult<bool>;
    fn switch_active(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceId>;
    fn get_context(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceContext>;
    fn restore_session(
        &self,
        workspace_id: &WorkspaceId,
    ) -> AbstractionResult<WorkspaceSessionSnapshot>;
}

pub trait TerminalProvider: Send + Sync {
    fn create_session(&self, request: TerminalCreateRequest) -> AbstractionResult<TerminalSession>;
}

pub trait GitProvider: Send + Sync {
    fn status(&self, workspace_id: &WorkspaceId) -> AbstractionResult<GitStatusSummary>;
}

pub trait SettingsStore: Send + Sync {
    fn load_effective(
        &self,
        workspace_id: Option<&WorkspaceId>,
    ) -> AbstractionResult<SettingsSnapshot>;
}

pub trait CommandPolicyEvaluator: Send + Sync {
    fn can_access_path(&self, workspace_id: &WorkspaceId, path: &Path) -> bool;
}

#[derive(Clone, Default)]
pub struct MockTerminalProvider {
    counter: Arc<RwLock<u64>>,
}

impl TerminalProvider for MockTerminalProvider {
    fn create_session(&self, request: TerminalCreateRequest) -> AbstractionResult<TerminalSession> {
        let mut counter = self
            .counter
            .write()
            .map_err(|_| AbstractionError::Internal {
                message: "terminal provider lock poisoned".to_string(),
            })?;
        *counter += 1;
        let sequence = *counter;
        let session_id = format!("term:{}:{sequence}", request.workspace_id);

        Ok(TerminalSession {
            session_id,
            workspace_id: request.workspace_id,
            resolved_cwd: request
                .cwd
                .unwrap_or_else(|| "<workspace_root>".to_string()),
        })
    }
}

#[derive(Clone, Default)]
pub struct MockGitProvider {
    statuses: Arc<RwLock<HashMap<WorkspaceId, GitStatusSummary>>>,
}

impl MockGitProvider {
    pub fn seed(
        &self,
        workspace_id: WorkspaceId,
        status: GitStatusSummary,
    ) -> AbstractionResult<()> {
        let mut statuses = self
            .statuses
            .write()
            .map_err(|_| AbstractionError::Internal {
                message: "git provider lock poisoned".to_string(),
            })?;
        statuses.insert(workspace_id, status);
        Ok(())
    }
}

impl GitProvider for MockGitProvider {
    fn status(&self, workspace_id: &WorkspaceId) -> AbstractionResult<GitStatusSummary> {
        let statuses = self
            .statuses
            .read()
            .map_err(|_| AbstractionError::Internal {
                message: "git provider lock poisoned".to_string(),
            })?;
        Ok(statuses
            .get(workspace_id)
            .cloned()
            .unwrap_or_else(|| GitStatusSummary {
                branch: "main".to_string(),
                ..GitStatusSummary::default()
            }))
    }
}

#[derive(Clone, Default)]
pub struct MockSettingsStore {
    user_values: Arc<RwLock<Value>>,
    workspace_values: Arc<RwLock<HashMap<WorkspaceId, Value>>>,
}

impl MockSettingsStore {
    pub fn set_user_values(&self, value: Value) -> AbstractionResult<()> {
        let mut user_values = self
            .user_values
            .write()
            .map_err(|_| AbstractionError::Internal {
                message: "settings store lock poisoned".to_string(),
            })?;
        *user_values = value;
        Ok(())
    }

    pub fn set_workspace_values(
        &self,
        workspace_id: WorkspaceId,
        value: Value,
    ) -> AbstractionResult<()> {
        let mut workspace_values =
            self.workspace_values
                .write()
                .map_err(|_| AbstractionError::Internal {
                    message: "settings store lock poisoned".to_string(),
                })?;
        workspace_values.insert(workspace_id, value);
        Ok(())
    }
}

impl SettingsStore for MockSettingsStore {
    fn load_effective(
        &self,
        workspace_id: Option<&WorkspaceId>,
    ) -> AbstractionResult<SettingsSnapshot> {
        let user_values = self
            .user_values
            .read()
            .map_err(|_| AbstractionError::Internal {
                message: "settings store lock poisoned".to_string(),
            })?;
        let workspace_values =
            self.workspace_values
                .read()
                .map_err(|_| AbstractionError::Internal {
                    message: "settings store lock poisoned".to_string(),
                })?;

        let workspace = workspace_id
            .and_then(|id| workspace_values.get(id))
            .cloned()
            .unwrap_or_else(|| json!({}));

        Ok(SettingsSnapshot {
            values: json!({
                "user": user_values.clone(),
                "workspace": workspace
            }),
            sources: json!({
                "user": "in-memory",
                "workspace": "in-memory"
            }),
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct AllowAllPolicyEvaluator;

impl CommandPolicyEvaluator for AllowAllPolicyEvaluator {
    fn can_access_path(&self, _workspace_id: &WorkspaceId, _path: &Path) -> bool {
        true
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceBinding {
    workspace_id: WorkspaceId,
    pub root: PathBuf,
}

impl WorkspaceBinding {
    pub fn new(workspace_id: WorkspaceId, root: PathBuf) -> Self {
        Self { workspace_id, root }
    }
}

impl WorkspaceScopedService for WorkspaceBinding {
    fn workspace_id(&self) -> &WorkspaceId {
        &self.workspace_id
    }
}
