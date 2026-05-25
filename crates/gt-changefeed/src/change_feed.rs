use std::collections::HashMap;

use crate::types::{GitStatusSnapshot, SessionActivityItem, SessionActivityKind};

pub struct SessionChangeFeed {
    last_snapshots: HashMap<String, GitStatusSnapshot>,
}

impl SessionChangeFeed {
    pub fn new() -> Self {
        Self {
            last_snapshots: HashMap::new(),
        }
    }

    pub fn on_git_updated(&mut self, snapshot: &GitStatusSnapshot) -> Vec<SessionActivityItem> {
        let mut items = Vec::new();
        if !snapshot.available {
            self.last_snapshots.remove(&snapshot.workspace_id);
            return items;
        }
        let ws_id = &snapshot.workspace_id;
        if let Some(prev) = self.last_snapshots.get(ws_id) {
            if prev.revision >= snapshot.revision {
                return items;
            }
            if prev.branch != snapshot.branch {
                items.push(SessionActivityItem {
                    workspace_id: ws_id.clone(),
                    kind: SessionActivityKind::BranchSwitched,
                    detail: format!("{} → {}", prev.branch, snapshot.branch),
                    revision: snapshot.revision,
                });
            }
            if snapshot.ahead > prev.ahead {
                let new_commits = snapshot.ahead - prev.ahead;
                items.push(SessionActivityItem {
                    workspace_id: ws_id.clone(),
                    kind: SessionActivityKind::NewCommits,
                    detail: format!("{} new commit{}", new_commits, if new_commits > 1 { "s" } else { "" }),
                    revision: snapshot.revision,
                });
            }
            if prev.staged_files != snapshot.staged_files
                || prev.unstaged_files != snapshot.unstaged_files
                || prev.untracked_files != snapshot.untracked_files
            {
                items.push(SessionActivityItem {
                    workspace_id: ws_id.clone(),
                    kind: SessionActivityKind::FilesChanged,
                    detail: format!(
                        "staged:{} unstaged:{} untracked:{}",
                        snapshot.staged_files, snapshot.unstaged_files, snapshot.untracked_files
                    ),
                    revision: snapshot.revision,
                });
            }
            if prev.dirty != snapshot.dirty {
                items.push(SessionActivityItem {
                    workspace_id: ws_id.clone(),
                    kind: SessionActivityKind::DirtyChanged,
                    detail: if snapshot.dirty { "working tree dirty".to_string() } else { "working tree clean".to_string() },
                    revision: snapshot.revision,
                });
            }
        }
        self.last_snapshots.insert(ws_id.clone(), snapshot.clone());
        items
    }

    pub fn last_snapshot(&self, workspace_id: &str) -> Option<&GitStatusSnapshot> {
        self.last_snapshots.get(workspace_id)
    }

    pub fn clear(&mut self, workspace_id: &str) {
        self.last_snapshots.remove(workspace_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SessionActivityKind;

    fn make_snapshot(ws: &str, branch: &str, ahead: u32, revision: u64) -> GitStatusSnapshot {
        GitStatusSnapshot {
            workspace_id: ws.to_string(),
            available: true,
            branch: branch.to_string(),
            dirty: false,
            ahead,
            behind: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            revision,
        }
    }

    #[test]
    fn test_first_update_no_diff() {
        let mut feed = SessionChangeFeed::new();
        let items = feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        assert!(items.is_empty());
        assert!(feed.last_snapshot("ws1").is_some());
    }

    #[test]
    fn test_unavailable_clears_snapshot() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let items = feed.on_git_updated(&GitStatusSnapshot::unavailable("ws1"));
        assert!(items.is_empty());
        assert!(feed.last_snapshot("ws1").is_none());
    }

    #[test]
    fn test_branch_switch_detected() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let items = feed.on_git_updated(&make_snapshot("ws1", "feature", 0, 2));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, SessionActivityKind::BranchSwitched);
        assert!(items[0].detail.contains("main → feature"));
    }

    #[test]
    fn test_new_commits_detected() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let items = feed.on_git_updated(&make_snapshot("ws1", "main", 3, 2));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, SessionActivityKind::NewCommits);
        assert!(items[0].detail.contains("3 new commits"));
    }

    #[test]
    fn test_files_changed_detected() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let mut next = make_snapshot("ws1", "main", 0, 2);
        next.staged_files = 2;
        next.untracked_files = 1;
        let items = feed.on_git_updated(&next);
        assert!(items.iter().any(|i| i.kind == SessionActivityKind::FilesChanged));
    }

    #[test]
    fn test_dirty_change_detected() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let mut next = make_snapshot("ws1", "main", 0, 2);
        next.dirty = true;
        let items = feed.on_git_updated(&next);
        assert!(items.iter().any(|i| i.kind == SessionActivityKind::DirtyChanged));
    }

    #[test]
    fn test_same_revision_no_events() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let items = feed.on_git_updated(&make_snapshot("ws1", "feature", 5, 1));
        assert!(items.is_empty());
    }

    #[test]
    fn test_older_revision_ignored() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 5));
        let items = feed.on_git_updated(&make_snapshot("ws1", "feature", 3, 3));
        assert!(items.is_empty());
    }

    #[test]
    fn test_multiple_workspaces_independent() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        feed.on_git_updated(&make_snapshot("ws2", "main", 0, 1));
        let items = feed.on_git_updated(&make_snapshot("ws1", "feature", 0, 2));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].workspace_id, "ws1");
    }

    #[test]
    fn test_clear_removes_snapshot() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        feed.clear("ws1");
        assert!(feed.last_snapshot("ws1").is_none());
    }

    #[test]
    fn test_no_change_no_events() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let items = feed.on_git_updated(&make_snapshot("ws1", "main", 0, 2));
        assert!(items.is_empty());
    }

    #[test]
    fn test_multiple_changes_single_update() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&make_snapshot("ws1", "main", 0, 1));
        let mut next = make_snapshot("ws1", "feature", 2, 2);
        next.dirty = true;
        next.staged_files = 1;
        let items = feed.on_git_updated(&next);
        assert_eq!(items.len(), 4);
    }
}