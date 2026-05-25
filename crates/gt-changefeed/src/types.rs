use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub workspace_id: String,
    pub available: bool,
    pub branch: String,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub staged_files: u32,
    pub unstaged_files: u32,
    pub untracked_files: u32,
    pub revision: u64,
}

impl GitStatusSnapshot {
    pub fn unavailable(workspace_id: &str) -> Self {
        Self {
            workspace_id: workspace_id.to_string(),
            available: false,
            branch: String::new(),
            dirty: false,
            ahead: 0,
            behind: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            revision: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionActivityKind {
    BranchSwitched,
    NewCommits,
    FilesChanged,
    DirtyChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivityItem {
    pub workspace_id: String,
    pub kind: SessionActivityKind,
    pub detail: String,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivityEvent {
    pub items: Vec<SessionActivityItem>,
}