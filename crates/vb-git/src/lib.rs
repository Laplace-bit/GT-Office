use git2::{BranchType, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};
use tracing::{debug, instrument};
use vb_abstractions::{AbstractionError, AbstractionResult, GitStatusFile, GitStatusSummary};
use vb_abstractions::{WorkspaceId, WorkspaceService};

const MAX_STATUS_FILES: usize = 2000;
const LOG_FIELD_SEP: char = '\u{001f}';
const LOG_RECORD_SEP: char = '\u{001e}';
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Maximum line length for word-level diff computation (performance optimization)
const MAX_WORD_DIFF_LINE_LENGTH: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitDiffMode {
    Staged,
    Unstaged,
}

impl GitDiffMode {
    fn from_staged(staged: bool) -> Self {
        if staged {
            Self::Staged
        } else {
            Self::Unstaged
        }
    }
}

pub fn module_name() -> &'static str {
    "vb-git"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitEntry {
    pub commit: String,
    pub short_commit: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileEntry {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub commit: String,
    pub short_commit: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub summary: String,
    pub body: String,
    pub files: Vec<GitCommitFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub tracking: Option<String>,
    pub commit: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub stash: String,
    pub commit: String,
    pub created_at: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchResult {
    pub remote: String,
    pub prune: bool,
    pub include_tags: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub remote: String,
    pub branch: Option<String>,
    pub rebase: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub remote: String,
    pub branch: Option<String>,
    pub set_upstream: bool,
    pub force_with_lease: bool,
}

/// Represents a segment within a line for word-level diff highlighting
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSegment {
    /// Segment type: 'equal', 'insert', 'delete'
    pub kind: String,
    /// Text content of this segment
    pub value: String,
}

/// Represents a single line in a diff hunk with word-level diff support
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffLine {
    /// Line type: 'add', 'del', 'ctx' (context)
    pub kind: String,
    /// Content of the line (without +/- prefix)
    pub content: String,
    /// Old line number (None for additions)
    pub old_line: Option<u32>,
    /// New line number (None for deletions)
    pub new_line: Option<u32>,
    /// Word-level diff segments for precise highlighting (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<DiffSegment>>,
}

/// Represents a diff hunk (a contiguous block of changes)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffHunk {
    /// Header line (e.g., "@@ -1,3 +1,4 @@")
    pub header: String,
    /// Starting line in old file
    pub old_start: u32,
    /// Number of lines in old file
    pub old_lines: u32,
    /// Starting line in new file
    pub new_start: u32,
    /// Number of lines in new file
    pub new_lines: u32,
    /// Lines in this hunk
    pub lines: Vec<GitDiffLine>,
}

/// Structured diff result for high-performance rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStructured {
    /// File path
    pub path: String,
    /// Whether the file is binary
    pub is_binary: bool,
    /// Whether this is a new file
    pub is_new: bool,
    /// Whether this is a deleted file
    pub is_deleted: bool,
    /// Whether this is a renamed file
    pub is_renamed: bool,
    /// Old file path (for renames)
    pub old_path: Option<String>,
    /// Total additions count
    pub additions: u32,
    /// Total deletions count
    pub deletions: u32,
    /// Diff hunks
    pub hunks: Vec<GitDiffHunk>,
    /// Raw patch (fallback)
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitExpandedCompare {
    /// File path in the current workspace / index snapshot
    pub path: String,
    /// Previous path for renames when available
    pub old_path: Option<String>,
    /// Whether either side is binary and cannot be rendered as text
    pub is_binary: bool,
    /// Whether the left/before side exists for the selected baseline
    pub old_exists: bool,
    /// Whether the right/after side exists for the selected baseline
    pub new_exists: bool,
    /// Full diff with unchanged context lines included
    pub full_diff: Option<GitDiffStructured>,
}

enum GitSnapshotContent {
    Missing,
    Text(String),
    Binary,
}

#[derive(Clone)]
pub struct GitService<W>
where
    W: WorkspaceService + Clone,
{
    workspace_service: W,
}

impl<W> GitService<W>
where
    W: WorkspaceService + Clone,
{
    pub fn new(workspace_service: W) -> Self {
        Self { workspace_service }
    }

    fn workspace_root(&self, workspace_id: &WorkspaceId) -> AbstractionResult<PathBuf> {
        let context = self.workspace_service.get_context(workspace_id)?;
        let root = PathBuf::from(&context.root);
        if !root.exists() {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "GIT_WORKSPACE_ROOT_INVALID: workspace root does not exist '{}'",
                    root.display()
                ),
            });
        }
        Ok(root)
    }

    fn parse_porcelain_status(stdout: &str) -> GitStatusSummary {
        let mut summary = GitStatusSummary::default();

        for line in stdout.lines() {
            if let Some(rest) = line.strip_prefix("## ") {
                let mut branch = rest.to_string();
                let mut ahead = 0_u32;
                let mut behind = 0_u32;

                if let Some(value) = rest.strip_prefix("No commits yet on ") {
                    branch = value.trim().to_string();
                } else if let Some(value) = rest.strip_prefix("Initial commit on ") {
                    branch = value.trim().to_string();
                }

                if let Some((lhs, rhs)) = rest.split_once("...") {
                    branch = lhs.trim().to_string();
                    if let Some(bracket_start) = rhs.find('[') {
                        if let Some(bracket_end) = rhs[bracket_start + 1..].find(']') {
                            let inside = &rhs[bracket_start + 1..bracket_start + 1 + bracket_end];
                            for token in inside.split(',') {
                                let token = token.trim();
                                if let Some(value) = token.strip_prefix("ahead ") {
                                    ahead = value.parse::<u32>().unwrap_or(0);
                                } else if let Some(value) = token.strip_prefix("behind ") {
                                    behind = value.parse::<u32>().unwrap_or(0);
                                }
                            }
                        }
                    }
                }

                summary.branch = branch;
                summary.ahead = ahead;
                summary.behind = behind;
                continue;
            }

            if line.len() < 3 {
                continue;
            }
            if summary.files.len() >= MAX_STATUS_FILES {
                break;
            }

            let mut chars = line.chars();
            let index = chars.next().unwrap_or(' ');
            let worktree = chars.next().unwrap_or(' ');
            let raw_path = line[3..].trim();
            let path = if let Some((_, new_name)) = raw_path.split_once(" -> ") {
                new_name
            } else {
                raw_path
            };
            if path.is_empty() {
                continue;
            }

            summary.files.push(GitStatusFile {
                path: path.to_string(),
                staged: index != ' ' && index != '?',
                status: format!("{index}{worktree}").trim().to_string(),
            });
        }

        if summary.branch.is_empty() {
            summary.branch = "HEAD".to_string();
        }
        summary
    }

    fn resolve_status_string(status: Status) -> String {
        if status.is_conflicted() {
            return "UU".to_string();
        }

        let index = if status.is_index_new() {
            'A'
        } else if status.is_index_modified() {
            'M'
        } else if status.is_index_deleted() {
            'D'
        } else if status.is_index_renamed() {
            'R'
        } else if status.is_index_typechange() {
            'T'
        } else {
            ' '
        };

        let worktree = if status.is_wt_new() {
            '?'
        } else if status.is_wt_modified() {
            'M'
        } else if status.is_wt_deleted() {
            'D'
        } else if status.is_wt_renamed() {
            'R'
        } else if status.is_wt_typechange() {
            'T'
        } else {
            ' '
        };

        let compact = format!("{index}{worktree}");
        compact.trim().to_string()
    }

    fn status_with_git2(&self, root: &Path) -> AbstractionResult<GitStatusSummary> {
        let repo = Repository::discover(root).map_err(|err| AbstractionError::Internal {
            message: format!("GIT_STATUS_GIT2_FAILED: repository discovery failed: {err}"),
        })?;

        let mut summary = GitStatusSummary {
            branch: "HEAD".to_string(),
            ..GitStatusSummary::default()
        };

        if let Ok(head) = repo.head() {
            let branch_name = head.shorthand().map(ToString::to_string).or_else(|| {
                head.name()
                    .and_then(|name| name.strip_prefix("refs/heads/"))
                    .map(ToString::to_string)
            });

            if let Some(name) = branch_name {
                summary.branch = name.clone();

                if let Ok(local_branch) = repo.find_branch(&name, BranchType::Local) {
                    if let Ok(upstream_branch) = local_branch.upstream() {
                        let local_oid = local_branch.get().target();
                        let upstream_oid = upstream_branch.get().target();
                        if let (Some(local_oid), Some(upstream_oid)) = (local_oid, upstream_oid) {
                            if let Ok((ahead, behind)) =
                                repo.graph_ahead_behind(local_oid, upstream_oid)
                            {
                                summary.ahead = u32::try_from(ahead).unwrap_or(u32::MAX);
                                summary.behind = u32::try_from(behind).unwrap_or(u32::MAX);
                            }
                        }
                    }
                }
            }
        }

        let mut options = StatusOptions::new();
        options
            .include_ignored(false)
            .include_untracked(true)
            // Rename detection is expensive on large repositories and not required for
            // high-frequency status refresh. Diff/commit detail paths still resolve renames.
            .renames_head_to_index(false)
            .renames_index_to_workdir(false)
            .recurse_untracked_dirs(false);

        let statuses =
            repo.statuses(Some(&mut options))
                .map_err(|err| AbstractionError::Internal {
                    message: format!("GIT_STATUS_GIT2_FAILED: failed to read statuses: {err}"),
                })?;

        for entry in statuses.iter() {
            if summary.files.len() >= MAX_STATUS_FILES {
                break;
            }
            let status = entry.status();
            let Some(path) = entry.path() else {
                continue;
            };

            summary.files.push(GitStatusFile {
                path: path.to_string(),
                staged: status.intersects(
                    Status::INDEX_NEW
                        | Status::INDEX_MODIFIED
                        | Status::INDEX_DELETED
                        | Status::INDEX_RENAMED
                        | Status::INDEX_TYPECHANGE,
                ),
                status: Self::resolve_status_string(status),
            });
        }

        Ok(summary)
    }

    fn run_git(&self, root: &Path, args: &[&str], error_code: &str) -> AbstractionResult<String> {
        debug!(root = %root.display(), args = ?args, "running git command");
        let mut command = Command::new("git");
        configure_background_command(&mut command);
        let output = command
            .arg("-C")
            .arg(root)
            // Ensure UTF-8 output encoding
            .env("LC_ALL", "C.UTF-8")
            .env("LANG", "C.UTF-8")
            .args(args)
            .output()
            .map_err(|err| AbstractionError::Internal {
                message: format!("{error_code}: failed to run git: {err}"),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if Self::is_not_git_repository_message(&stderr) {
                return Err(AbstractionError::InvalidArgument {
                    message: "GIT_REPO_INVALID: not a git repository".to_string(),
                });
            }
            return Err(AbstractionError::Internal {
                message: format!("{error_code}: {stderr}"),
            });
        }

        // Try to decode as UTF-8, fallback to lossy conversion
        match String::from_utf8(output.stdout.clone()) {
            Ok(s) => Ok(s),
            Err(_) => {
                // Fallback: try to decode with lossy conversion
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
        }
    }

    fn list_untracked_paths(
        &self,
        root: &Path,
        paths: &[String],
        error_code: &str,
    ) -> AbstractionResult<std::collections::HashSet<String>> {
        if paths.is_empty() {
            return Ok(std::collections::HashSet::new());
        }

        let mut owned_args = vec![
            "ls-files".to_string(),
            "--others".to_string(),
            "--exclude-standard".to_string(),
            "--".to_string(),
        ];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(root, &args, error_code)?;

        Ok(output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect())
    }

    fn status_with_system_git(&self, root: &Path) -> AbstractionResult<GitStatusSummary> {
        let output = self.run_git(
            root,
            &["status", "--porcelain", "--branch"],
            "GIT_STATUS_FAILED",
        )?;
        Ok(Self::parse_porcelain_status(&output))
    }

    fn validate_relative_repo_path(path: &str) -> AbstractionResult<()> {
        let path = path.trim();
        if path.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_PATH_INVALID: path cannot be empty".to_string(),
            });
        }

        let candidate = Path::new(path);
        if candidate.is_absolute() {
            return Err(AbstractionError::InvalidArgument {
                message: format!("GIT_PATH_INVALID: absolute path is not allowed '{path}'"),
            });
        }
        if candidate
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err(AbstractionError::InvalidArgument {
                message: format!("GIT_PATH_INVALID: parent traversal is not allowed '{path}'"),
            });
        }
        Ok(())
    }

    fn validate_branch_name(&self, root: &Path, branch: &str) -> AbstractionResult<()> {
        let trimmed = branch.trim();
        if trimmed.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_BRANCH_INVALID: branch cannot be empty".to_string(),
            });
        }

        self.run_git(
            root,
            &["check-ref-format", "--branch", trimmed],
            "GIT_BRANCH_INVALID",
        )
        .map(|_| ())
    }

    fn validate_commit_id(commit: &str) -> AbstractionResult<String> {
        let trimmed = commit.trim();
        if trimmed.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_COMMIT_INVALID: commit cannot be empty".to_string(),
            });
        }

        let is_hex = trimmed.chars().all(|value| value.is_ascii_hexdigit());
        if !is_hex || trimmed.len() < 7 || trimmed.len() > 64 {
            return Err(AbstractionError::InvalidArgument {
                message: format!("GIT_COMMIT_INVALID: invalid commit id '{trimmed}'"),
            });
        }

        Ok(trimmed.to_string())
    }

    fn parse_structured_output(lines: &str, expected_fields: usize) -> Vec<Vec<String>> {
        lines
            .split(LOG_RECORD_SEP)
            .filter_map(|record| {
                let trimmed = record.trim();
                if trimmed.is_empty() {
                    return None;
                }
                let fields = trimmed
                    .split(LOG_FIELD_SEP)
                    .map(|field| field.to_string())
                    .collect::<Vec<_>>();
                if fields.len() < expected_fields {
                    return None;
                }
                Some(fields)
            })
            .collect::<Vec<_>>()
    }

    fn is_not_git_repository_message(message: &str) -> bool {
        let normalized = message.to_ascii_lowercase();
        normalized.contains("git_repo_invalid")
            || normalized.contains("not a git repository")
            || normalized.contains("must be run in a work tree")
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn status(&self, workspace_id: &WorkspaceId) -> AbstractionResult<GitStatusSummary> {
        let root = self.workspace_root(workspace_id)?;
        match self.status_with_git2(&root) {
            Ok(mut summary) => {
                if summary.branch == "HEAD" {
                    if let Ok(fallback) = self.status_with_system_git(&root) {
                        if fallback.branch != "HEAD" {
                            summary.branch = fallback.branch;
                            summary.ahead = fallback.ahead;
                            summary.behind = fallback.behind;
                        }
                    }
                }
                Ok(summary)
            }
            Err(_) => match self.status_with_system_git(&root) {
                Ok(summary) => Ok(summary),
                Err(error) => {
                    let message = error.to_string();
                    if Self::is_not_git_repository_message(&message) {
                        return Err(AbstractionError::InvalidArgument {
                            message: "GIT_REPO_INVALID: not a git repository".to_string(),
                        });
                    }
                    Err(error)
                }
            },
        }
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn init_repo(
        &self,
        workspace_id: &WorkspaceId,
        initial_branch: Option<&str>,
    ) -> AbstractionResult<String> {
        let root = self.workspace_root(workspace_id)?;
        let branch = initial_branch
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("main");
        self.validate_branch_name(&root, branch)?;

        if Repository::discover(&root).is_err() {
            self.run_git(&root, &["init", "-b", branch], "GIT_INIT_FAILED")?;
        }

        let summary = self.status(workspace_id)?;
        Ok(summary.branch)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file(
        &self,
        workspace_id: &WorkspaceId,
        path: &str,
        staged: bool,
    ) -> AbstractionResult<String> {
        Self::validate_relative_repo_path(path)?;
        let root = self.workspace_root(workspace_id)?;
        self.run_git_diff(&root, path, GitDiffMode::from_staged(staged))
    }

    /// High-performance structured diff using git2 library
    /// Returns parsed diff hunks for immediate rendering without frontend parsing
    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file_structured(
        &self,
        workspace_id: &WorkspaceId,
        path: &str,
        staged: bool,
    ) -> AbstractionResult<GitDiffStructured> {
        Self::validate_relative_repo_path(path)?;
        let root = self.workspace_root(workspace_id)?;
        let diff_mode = GitDiffMode::from_staged(staged);

        // Try git2 first for performance, fallback to git command
        match self.diff_file_with_git2(&root, path, diff_mode) {
            Ok(result) => Ok(result),
            Err(_) => {
                // Fallback to git command and parse the output
                let patch = self.run_git_diff(&root, path, diff_mode)?;
                Ok(self.parse_diff_patch(&patch, path))
            }
        }
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file_expansion(
        &self,
        workspace_id: &WorkspaceId,
        path: &str,
        old_path: Option<&str>,
        staged: bool,
    ) -> AbstractionResult<GitExpandedCompare> {
        Self::validate_relative_repo_path(path)?;
        if let Some(previous_path) = old_path {
            Self::validate_relative_repo_path(previous_path)?;
        }

        let root = self.workspace_root(workspace_id)?;
        let repo = Repository::discover(&root).map_err(|err| AbstractionError::Internal {
            message: format!("GIT_DIFF_EXPANSION_FAILED: repository discovery failed: {err}"),
        })?;

        let previous_path = old_path.unwrap_or(path);
        let before_snapshot = if staged {
            Self::read_head_snapshot(&repo, previous_path)?
        } else {
            Self::read_index_snapshot(&repo, previous_path)?
        };
        let after_snapshot = if staged {
            Self::read_index_snapshot(&repo, path)?
        } else {
            Self::read_worktree_snapshot(&root, path)?
        };

        let is_binary = matches!(before_snapshot, GitSnapshotContent::Binary)
            || matches!(after_snapshot, GitSnapshotContent::Binary);
        let old_exists = !matches!(before_snapshot, GitSnapshotContent::Missing);
        let new_exists = !matches!(after_snapshot, GitSnapshotContent::Missing);
        let full_diff = if is_binary {
            None
        } else {
            let before_text = match &before_snapshot {
                GitSnapshotContent::Text(content) => content.as_str(),
                GitSnapshotContent::Missing => "",
                GitSnapshotContent::Binary => "",
            };
            let after_text = match &after_snapshot {
                GitSnapshotContent::Text(content) => content.as_str(),
                GitSnapshotContent::Missing => "",
                GitSnapshotContent::Binary => "",
            };
            Some(Self::build_full_structured_diff(
                path,
                old_path.map(|value| value.to_string()),
                before_text,
                after_text,
                old_exists,
                new_exists,
            ))
        };

        Ok(GitExpandedCompare {
            path: path.to_string(),
            old_path: old_path.map(ToOwned::to_owned),
            is_binary,
            old_exists,
            new_exists,
            full_diff,
        })
    }

    /// Use git2 library for high-performance diff
    fn diff_file_with_git2(
        &self,
        root: &Path,
        path: &str,
        diff_mode: GitDiffMode,
    ) -> AbstractionResult<GitDiffStructured> {
        let repo = Repository::discover(root).map_err(|err| AbstractionError::Internal {
            message: format!("GIT_DIFF_GIT2_FAILED: repository discovery failed: {err}"),
        })?;

        let workdir = repo.workdir().ok_or_else(|| AbstractionError::Internal {
            message: "GIT_DIFF_GIT2_FAILED: no working directory".to_string(),
        })?;

        let target_path = Path::new(path);
        let _full_path = workdir.join(target_path);

        // Get the current HEAD tree
        let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

        // Get diff options
        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(path);
        if diff_mode == GitDiffMode::Unstaged {
            diff_opts.include_untracked(true);
            diff_opts.recurse_untracked_dirs(true);
        }
        diff_opts.context_lines(3);

        // Get the diff
        let diff = if diff_mode == GitDiffMode::Staged {
            let index = repo.index().map_err(|err| AbstractionError::Internal {
                message: format!("GIT_DIFF_GIT2_FAILED: failed to read index: {err}"),
            })?;
            if let Some(ref tree) = head_tree {
                repo.diff_tree_to_index(Some(tree), Some(&index), Some(&mut diff_opts))
            } else {
                repo.diff_tree_to_index(None, Some(&index), Some(&mut diff_opts))
            }
        } else {
            let index = repo.index().ok();
            repo.diff_index_to_workdir(index.as_ref(), Some(&mut diff_opts))
        }
        .map_err(|err| AbstractionError::Internal {
            message: format!("GIT_DIFF_GIT2_FAILED: diff creation failed: {err}"),
        })?;

        let mut result = GitDiffStructured {
            path: path.to_string(),
            is_binary: false,
            is_new: false,
            is_deleted: false,
            is_renamed: false,
            old_path: None,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
            patch: String::new(),
        };

        let mut current_hunk: Option<GitDiffHunk> = None;

        // Process the diff
        let mut additions = 0u32;
        let mut deletions = 0u32;
        let mut patch_content = String::new();

        diff.print(git2::DiffFormat::Patch, |delta, hunk, line| {
            // Capture delta info
            if let Some(new_file) = delta.new_file().path() {
                if new_file == target_path {
                    result.is_new = delta.status() == git2::Delta::Added;
                    result.is_deleted = delta.status() == git2::Delta::Deleted;
                    result.is_renamed = delta.status() == git2::Delta::Renamed;
                    if result.is_renamed {
                        result.old_path = delta
                            .old_file()
                            .path()
                            .map(|p| p.to_string_lossy().to_string());
                    }
                    result.is_binary = delta.flags().is_binary();
                }
            }

            // Capture raw patch
            if let Ok(content) = std::str::from_utf8(line.content()) {
                let prefix = match line.origin() {
                    '+' => "+",
                    '-' => "-",
                    ' ' => " ",
                    '>' | '<' | '=' => "",
                    'H' | 'F' => "",
                    _ => "",
                };
                if !prefix.is_empty() || line.origin() == 'H' || line.origin() == 'F' {
                    patch_content.push_str(prefix);
                    patch_content.push_str(content);
                }
            }

            // Process hunks
            if let Some(hunk_info) = hunk {
                let header = format!(
                    "@@ -{},{} +{},{} @@",
                    hunk_info.old_start(),
                    hunk_info.old_lines(),
                    hunk_info.new_start(),
                    hunk_info.new_lines()
                );

                // Check if we need to start a new hunk
                let is_new_hunk = current_hunk.as_ref().is_none_or(|h| h.header != header);

                if is_new_hunk {
                    // Save previous hunk
                    if let Some(prev_hunk) = current_hunk.take() {
                        result.hunks.push(prev_hunk);
                    }

                    current_hunk = Some(GitDiffHunk {
                        header: header.clone(),
                        old_start: hunk_info.old_start(),
                        old_lines: hunk_info.old_lines(),
                        new_start: hunk_info.new_start(),
                        new_lines: hunk_info.new_lines(),
                        lines: Vec::new(),
                    });
                }

                // Add line to current hunk
                if let Some(ref mut h) = current_hunk {
                    if let Ok(content) = std::str::from_utf8(line.content()) {
                        let kind = match line.origin() {
                            '+' => {
                                additions += 1;
                                "add"
                            }
                            '-' => {
                                deletions += 1;
                                "del"
                            }
                            ' ' => "ctx",
                            _ => return true,
                        };

                        h.lines.push(GitDiffLine {
                            kind: kind.to_string(),
                            content: content.trim_end_matches('\n').to_string(),
                            old_line: line.old_lineno(),
                            new_line: line.new_lineno(),
                            segments: None,
                        });
                    }
                }
            }

            true
        })
        .map_err(|err| AbstractionError::Internal {
            message: format!("GIT_DIFF_GIT2_FAILED: diff print failed: {err}"),
        })?;

        // Save last hunk
        if let Some(hunk) = current_hunk {
            result.hunks.push(hunk);
        }

        result.additions = additions;
        result.deletions = deletions;

        // Enhance with word-level diff
        Self::enhance_hunks_with_word_diff(&mut result.hunks);

        if result.hunks.is_empty() && !result.is_binary {
            let patch = self.run_git_diff(root, path, diff_mode)?;
            if patch.trim().is_empty() {
                result.patch = patch;
                return Ok(result);
            }
            return Ok(self.parse_diff_patch(&patch, path));
        }

        result.patch = patch_content;
        Ok(result)
    }

    fn run_git_diff(
        &self,
        root: &Path,
        path: &str,
        diff_mode: GitDiffMode,
    ) -> AbstractionResult<String> {
        // `git diff -- <path>` does not emit a patch for untracked worktree files until they are
        // added to the index. Synthesize a `/dev/null -> file` patch so the diff viewer can render
        // new files before staging.
        if diff_mode == GitDiffMode::Unstaged {
            if let Some(patch) = self.build_untracked_worktree_patch(root, path)? {
                return Ok(patch);
            }
        }

        let args = match diff_mode {
            GitDiffMode::Staged => vec!["diff", "--cached", "--no-ext-diff", "--", path],
            GitDiffMode::Unstaged => vec!["diff", "--no-ext-diff", "--", path],
        };
        self.run_git(root, &args, "GIT_DIFF_FAILED")
    }

    fn build_untracked_worktree_patch(
        &self,
        root: &Path,
        path: &str,
    ) -> AbstractionResult<Option<String>> {
        let requested_paths = vec![path.to_string()];
        let untracked_paths =
            self.list_untracked_paths(root, &requested_paths, "GIT_DIFF_FAILED")?;
        if !untracked_paths.contains(path) {
            return Ok(None);
        }

        let patch = match Self::read_worktree_snapshot(root, path)? {
            GitSnapshotContent::Missing => return Ok(None),
            GitSnapshotContent::Binary => Self::build_new_file_binary_patch(path),
            GitSnapshotContent::Text(content) => Self::build_new_file_text_patch(path, &content),
        };
        Ok(Some(patch))
    }

    fn build_new_file_text_patch(path: &str, content: &str) -> String {
        let mut patch = format!(
            "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
        );
        let line_count = content.lines().count();
        if line_count == 0 {
            return patch;
        }

        patch.push_str(&format!("@@ -0,0 +1,{line_count} @@\n"));
        for line in content.lines() {
            patch.push('+');
            patch.push_str(line);
            patch.push('\n');
        }
        if !content.ends_with('\n') && !content.ends_with('\r') {
            patch.push_str("\\ No newline at end of file\n");
        }
        patch
    }

    fn build_new_file_binary_patch(path: &str) -> String {
        format!(
            "diff --git a/{path} b/{path}\nnew file mode 100644\nBinary files /dev/null and b/{path} differ\n"
        )
    }

    fn read_head_snapshot(repo: &Repository, path: &str) -> AbstractionResult<GitSnapshotContent> {
        let head = match repo.head() {
            Ok(head) => head,
            Err(_) => return Ok(GitSnapshotContent::Missing),
        };
        let tree = match head.peel_to_tree() {
            Ok(tree) => tree,
            Err(_) => return Ok(GitSnapshotContent::Missing),
        };
        let entry = match tree.get_path(Path::new(path)) {
            Ok(entry) => entry,
            Err(_) => return Ok(GitSnapshotContent::Missing),
        };
        let object = entry
            .to_object(repo)
            .map_err(|err| AbstractionError::Internal {
                message: format!("GIT_DIFF_EXPANSION_FAILED: failed to resolve HEAD object: {err}"),
            })?;
        let blob = object
            .peel_to_blob()
            .map_err(|err| AbstractionError::Internal {
                message: format!("GIT_DIFF_EXPANSION_FAILED: failed to read HEAD blob: {err}"),
            })?;
        Self::decode_blob_snapshot(&blob)
    }

    fn read_index_snapshot(repo: &Repository, path: &str) -> AbstractionResult<GitSnapshotContent> {
        let index = repo.index().map_err(|err| AbstractionError::Internal {
            message: format!("GIT_DIFF_EXPANSION_FAILED: failed to read index: {err}"),
        })?;
        let Some(entry) = index.get_path(Path::new(path), 0) else {
            return Ok(GitSnapshotContent::Missing);
        };
        let blob = repo
            .find_blob(entry.id)
            .map_err(|err| AbstractionError::Internal {
                message: format!("GIT_DIFF_EXPANSION_FAILED: failed to read index blob: {err}"),
            })?;
        Self::decode_blob_snapshot(&blob)
    }

    fn read_worktree_snapshot(root: &Path, path: &str) -> AbstractionResult<GitSnapshotContent> {
        let full_path = root.join(path);
        let bytes = match std::fs::read(&full_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(GitSnapshotContent::Missing);
            }
            Err(error) => {
                return Err(AbstractionError::Internal {
                    message: format!(
                        "GIT_DIFF_EXPANSION_FAILED: failed to read worktree file '{}': {error}",
                        full_path.display()
                    ),
                });
            }
        };
        Self::decode_bytes_snapshot(&bytes)
    }

    fn decode_blob_snapshot(blob: &git2::Blob<'_>) -> AbstractionResult<GitSnapshotContent> {
        if blob.is_binary() {
            return Ok(GitSnapshotContent::Binary);
        }
        Self::decode_bytes_snapshot(blob.content())
    }

    fn decode_bytes_snapshot(bytes: &[u8]) -> AbstractionResult<GitSnapshotContent> {
        match std::str::from_utf8(bytes) {
            Ok(content) => Ok(GitSnapshotContent::Text(content.to_string())),
            Err(_) => Ok(GitSnapshotContent::Binary),
        }
    }

    fn build_full_structured_diff(
        path: &str,
        old_path: Option<String>,
        before_text: &str,
        after_text: &str,
        old_exists: bool,
        new_exists: bool,
    ) -> GitDiffStructured {
        let before_line_count = before_text.lines().count() as u32;
        let after_line_count = after_text.lines().count() as u32;
        let mut additions = 0u32;
        let mut deletions = 0u32;
        let mut old_line = if old_exists { 1 } else { 0 };
        let mut new_line = if new_exists { 1 } else { 0 };
        let mut lines = Vec::new();
        let diff = TextDiff::from_lines(before_text, after_text);

        for change in diff.iter_all_changes() {
            let content = change.value().trim_end_matches(['\r', '\n']).to_string();
            match change.tag() {
                ChangeTag::Equal => {
                    lines.push(GitDiffLine {
                        kind: "ctx".to_string(),
                        content,
                        old_line: Some(old_line),
                        new_line: Some(new_line),
                        segments: None,
                    });
                    old_line += 1;
                    new_line += 1;
                }
                ChangeTag::Delete => {
                    deletions += 1;
                    lines.push(GitDiffLine {
                        kind: "del".to_string(),
                        content,
                        old_line: Some(old_line),
                        new_line: None,
                        segments: None,
                    });
                    old_line += 1;
                }
                ChangeTag::Insert => {
                    additions += 1;
                    lines.push(GitDiffLine {
                        kind: "add".to_string(),
                        content,
                        old_line: None,
                        new_line: Some(new_line),
                        segments: None,
                    });
                    new_line += 1;
                }
            }
        }

        let mut result = GitDiffStructured {
            path: path.to_string(),
            is_binary: false,
            is_new: !old_exists && new_exists,
            is_deleted: old_exists && !new_exists,
            is_renamed: old_path.is_some(),
            old_path,
            additions,
            deletions,
            hunks: Vec::new(),
            patch: String::new(),
        };

        if additions == 0 && deletions == 0 {
            return result;
        }

        result.hunks.push(GitDiffHunk {
            header: format!(
                "@@ -{},{} +{},{} @@",
                if old_exists && before_line_count > 0 {
                    1
                } else {
                    0
                },
                before_line_count,
                if new_exists && after_line_count > 0 {
                    1
                } else {
                    0
                },
                after_line_count
            ),
            old_start: if old_exists && before_line_count > 0 {
                1
            } else {
                0
            },
            old_lines: before_line_count,
            new_start: if new_exists && after_line_count > 0 {
                1
            } else {
                0
            },
            new_lines: after_line_count,
            lines,
        });
        Self::enhance_hunks_with_word_diff(&mut result.hunks);
        result
    }

    /// Parse raw git diff patch into structured format
    fn parse_diff_patch(&self, patch: &str, path: &str) -> GitDiffStructured {
        let mut result = GitDiffStructured {
            path: path.to_string(),
            is_binary: patch.contains("Binary files") || patch.contains("GIT binary patch"),
            is_new: patch.contains("new file mode"),
            is_deleted: patch.contains("deleted file mode"),
            is_renamed: patch.contains("rename from"),
            old_path: None,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
            patch: patch.to_string(),
        };

        // Parse rename source
        if result.is_renamed {
            for line in patch.lines() {
                if let Some(old) = line.strip_prefix("rename from ") {
                    result.old_path = Some(old.trim().to_string());
                    break;
                }
            }
        }

        // Parse hunks
        let mut current_hunk: Option<GitDiffHunk> = None;
        let mut old_line: u32 = 0;
        let mut new_line: u32 = 0;

        for line in patch.lines() {
            if line.starts_with("@@") {
                // Save previous hunk
                if let Some(hunk) = current_hunk.take() {
                    result.hunks.push(hunk);
                }

                // Parse hunk header: @@ -start,count +start,count @@
                if let Some((old_info, new_info)) = Self::parse_hunk_header(line) {
                    old_line = old_info.0;
                    new_line = new_info.0;
                    current_hunk = Some(GitDiffHunk {
                        header: line.to_string(),
                        old_start: old_info.0,
                        old_lines: old_info.1,
                        new_start: new_info.0,
                        new_lines: new_info.1,
                        lines: Vec::new(),
                    });
                }
            } else if let Some(ref mut hunk) = current_hunk {
                if let Some(content) = line.strip_prefix('+') {
                    result.additions += 1;
                    hunk.lines.push(GitDiffLine {
                        kind: "add".to_string(),
                        content: content.to_string(),
                        old_line: None,
                        new_line: Some(new_line),
                        segments: None,
                    });
                    new_line += 1;
                } else if let Some(content) = line.strip_prefix('-') {
                    result.deletions += 1;
                    hunk.lines.push(GitDiffLine {
                        kind: "del".to_string(),
                        content: content.to_string(),
                        old_line: Some(old_line),
                        new_line: None,
                        segments: None,
                    });
                    old_line += 1;
                } else if let Some(content) = line.strip_prefix(' ') {
                    hunk.lines.push(GitDiffLine {
                        kind: "ctx".to_string(),
                        content: content.to_string(),
                        old_line: Some(old_line),
                        new_line: Some(new_line),
                        segments: None,
                    });
                    old_line += 1;
                    new_line += 1;
                }
            }
        }

        // Save last hunk
        if let Some(hunk) = current_hunk {
            result.hunks.push(hunk);
        }

        // Enhance with word-level diff
        Self::enhance_hunks_with_word_diff(&mut result.hunks);

        result
    }

    /// Parse hunk header to extract line numbers
    fn parse_hunk_header(line: &str) -> Option<((u32, u32), (u32, u32))> {
        // Format: @@ -start,count +start,count @@
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            return None;
        }

        let old_part = parts.get(1)?.strip_prefix('-')?;
        let new_part = parts.get(2)?.strip_prefix('+')?;

        let parse_range = |s: &str| -> (u32, u32) {
            if let Some((start, count)) = s.split_once(',') {
                (start.parse().unwrap_or(1), count.parse().unwrap_or(0))
            } else {
                (s.parse().unwrap_or(1), 1)
            }
        };

        Some((parse_range(old_part), parse_range(new_part)))
    }

    /// Compute word-level diff between two lines using the similar crate
    /// Returns segments for both old and new lines
    fn compute_word_diff(old_line: &str, new_line: &str) -> (Vec<DiffSegment>, Vec<DiffSegment>) {
        // Skip word diff for very long lines (performance optimization)
        if old_line.len() > MAX_WORD_DIFF_LINE_LENGTH || new_line.len() > MAX_WORD_DIFF_LINE_LENGTH
        {
            return (
                vec![DiffSegment {
                    kind: "delete".to_string(),
                    value: old_line.to_string(),
                }],
                vec![DiffSegment {
                    kind: "insert".to_string(),
                    value: new_line.to_string(),
                }],
            );
        }

        let diff = TextDiff::from_words(old_line, new_line);
        let mut old_segments = Vec::new();
        let mut new_segments = Vec::new();

        for change in diff.iter_all_changes() {
            let value = change.value().to_string();
            match change.tag() {
                ChangeTag::Equal => {
                    old_segments.push(DiffSegment {
                        kind: "equal".to_string(),
                        value: value.clone(),
                    });
                    new_segments.push(DiffSegment {
                        kind: "equal".to_string(),
                        value,
                    });
                }
                ChangeTag::Delete => {
                    old_segments.push(DiffSegment {
                        kind: "delete".to_string(),
                        value,
                    });
                }
                ChangeTag::Insert => {
                    new_segments.push(DiffSegment {
                        kind: "insert".to_string(),
                        value,
                    });
                }
            }
        }

        (old_segments, new_segments)
    }

    /// Post-process hunks to add word-level diff for paired add/del lines
    fn enhance_hunks_with_word_diff(hunks: &mut [GitDiffHunk]) {
        for hunk in hunks.iter_mut() {
            let lines = &mut hunk.lines;
            let mut i = 0;

            while i < lines.len() {
                // Look for consecutive del lines followed by add lines
                let del_start = i;
                let mut del_count = 0;

                // Count consecutive deletions
                while del_start + del_count < lines.len()
                    && lines[del_start + del_count].kind == "del"
                {
                    del_count += 1;
                }

                if del_count == 0 {
                    i += 1;
                    continue;
                }

                // Count consecutive additions after deletions
                let add_start = del_start + del_count;
                let mut add_count = 0;

                while add_start + add_count < lines.len()
                    && lines[add_start + add_count].kind == "add"
                {
                    add_count += 1;
                }

                // Pair deletions with additions for word-level diff
                let pair_count = del_count.min(add_count);
                for j in 0..pair_count {
                    let del_idx = del_start + j;
                    let add_idx = add_start + j;

                    let (del_segments, add_segments) =
                        Self::compute_word_diff(&lines[del_idx].content, &lines[add_idx].content);

                    lines[del_idx].segments = Some(del_segments);
                    lines[add_idx].segments = Some(add_segments);
                }

                i = add_start + add_count;
            }
        }
    }

    #[instrument(skip(self, paths), fields(workspace_id = %workspace_id, path_count = paths.len()))]
    pub fn stage(&self, workspace_id: &WorkspaceId, paths: &[String]) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Ok(0);
        }

        for path in paths {
            Self::validate_relative_repo_path(path)?;
        }

        let root = self.workspace_root(workspace_id)?;
        let mut owned_args = vec!["add".to_string(), "--".to_string()];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &args, "GIT_STAGE_FAILED")?;
        Ok(paths.len())
    }

    #[instrument(skip(self, paths), fields(workspace_id = %workspace_id, path_count = paths.len()))]
    pub fn unstage(
        &self,
        workspace_id: &WorkspaceId,
        paths: &[String],
    ) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Ok(0);
        }

        for path in paths {
            Self::validate_relative_repo_path(path)?;
        }

        let root = self.workspace_root(workspace_id)?;
        let mut owned_args = vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
        ];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &args, "GIT_UNSTAGE_FAILED")?;
        Ok(paths.len())
    }

    #[instrument(skip(self, paths), fields(workspace_id = %workspace_id, path_count = paths.len(), include_untracked = include_untracked))]
    pub fn discard(
        &self,
        workspace_id: &WorkspaceId,
        paths: &[String],
        include_untracked: bool,
    ) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_DISCARD_PATHS_REQUIRED: paths cannot be empty".to_string(),
            });
        }

        for path in paths {
            Self::validate_relative_repo_path(path)?;
        }

        let root = self.workspace_root(workspace_id)?;

        let untracked_paths = if include_untracked {
            self.list_untracked_paths(&root, paths, "GIT_DISCARD_FAILED")?
        } else {
            std::collections::HashSet::new()
        };
        let tracked_paths = paths
            .iter()
            .filter(|path| !untracked_paths.contains(*path))
            .cloned()
            .collect::<Vec<_>>();

        if !tracked_paths.is_empty() {
            let mut restore_args = vec![
                "restore".to_string(),
                "--worktree".to_string(),
                "--".to_string(),
            ];
            restore_args.extend(tracked_paths);
            let restore_refs = restore_args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_git(&root, &restore_refs, "GIT_DISCARD_FAILED")?;
        }

        if include_untracked && !untracked_paths.is_empty() {
            let mut clean_args = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
            clean_args.extend(untracked_paths.iter().cloned());
            let clean_refs = clean_args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_git(&root, &clean_refs, "GIT_DISCARD_FAILED")?;
        }

        Ok(paths.len())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn commit(&self, workspace_id: &WorkspaceId, message: &str) -> AbstractionResult<String> {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_COMMIT_MESSAGE_INVALID: message cannot be empty".to_string(),
            });
        }

        let root = self.workspace_root(workspace_id)?;
        self.run_git(
            &root,
            &["commit", "-m", trimmed, "--no-gpg-sign"],
            "GIT_COMMIT_FAILED",
        )?;

        let commit_id = self
            .run_git(&root, &["rev-parse", "HEAD"], "GIT_COMMIT_FAILED")
            .map(|stdout| stdout.trim().to_string())?;
        Ok(commit_id)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, limit = limit, skip = skip))]
    pub fn log(
        &self,
        workspace_id: &WorkspaceId,
        limit: usize,
        skip: usize,
    ) -> AbstractionResult<Vec<GitCommitEntry>> {
        let effective_limit = limit.clamp(1, 500);
        let effective_skip = skip.min(200_000);
        let root = self.workspace_root(workspace_id)?;
        let max_count = effective_limit.to_string();
        let skip_count = effective_skip.to_string();
        let output = self.run_git(
            &root,
            &[
                "log",
                "--date=iso-strict",
                "--decorate=short",
                "--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e",
                "--max-count",
                &max_count,
                "--skip",
                &skip_count,
            ],
            "GIT_LOG_FAILED",
        )?;

        let records = Self::parse_structured_output(&output, 8);
        let mut entries = Vec::with_capacity(records.len());
        for fields in records {
            let parents = fields[2]
                .split_whitespace()
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.trim().to_string())
                .collect::<Vec<_>>();
            let refs = fields[3]
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            entries.push(GitCommitEntry {
                commit: fields[0].clone(),
                short_commit: fields[1].clone(),
                parents,
                refs,
                author_name: fields[4].clone(),
                author_email: fields[5].clone(),
                authored_at: fields[6].clone(),
                summary: fields[7].clone(),
            });
        }
        Ok(entries)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, commit = commit))]
    pub fn commit_detail(
        &self,
        workspace_id: &WorkspaceId,
        commit: &str,
    ) -> AbstractionResult<GitCommitDetail> {
        let commit_id = Self::validate_commit_id(commit)?;
        let root = self.workspace_root(workspace_id)?;

        let meta_output = self.run_git(
            &root,
            &[
                "show",
                "--no-patch",
                "--date=iso-strict",
                "--decorate=short",
                "--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s",
                &commit_id,
            ],
            "GIT_COMMIT_DETAIL_FAILED",
        )?;

        let meta_fields = meta_output
            .trim()
            .split(LOG_FIELD_SEP)
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if meta_fields.len() < 8 {
            return Err(AbstractionError::Internal {
                message: "GIT_COMMIT_DETAIL_FAILED: failed to parse commit metadata".to_string(),
            });
        }

        let body = self
            .run_git(
                &root,
                &["show", "--no-patch", "--pretty=format:%b", &commit_id],
                "GIT_COMMIT_DETAIL_FAILED",
            )?
            .trim_end()
            .to_string();

        let files_output = self.run_git(
            &root,
            &[
                "show",
                "--format=",
                "--name-status",
                "--find-renames",
                "--find-copies",
                &commit_id,
            ],
            "GIT_COMMIT_DETAIL_FAILED",
        )?;

        let mut files = Vec::new();
        for line in files_output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let fields = trimmed.split('\t').collect::<Vec<_>>();
            if fields.len() < 2 {
                continue;
            }

            let raw_status = fields[0].trim();
            if raw_status.is_empty() {
                continue;
            }
            let status = raw_status
                .chars()
                .next()
                .map(|value| value.to_string())
                .unwrap_or_else(|| raw_status.to_string());

            match status.as_str() {
                "R" | "C" => {
                    if fields.len() < 3 {
                        continue;
                    }
                    let previous_path = fields[1].trim().to_string();
                    let path = fields[2].trim().to_string();
                    if path.is_empty() {
                        continue;
                    }
                    files.push(GitCommitFileEntry {
                        status,
                        path,
                        previous_path: (!previous_path.is_empty()).then_some(previous_path),
                    });
                }
                _ => {
                    let path = fields[1].trim().to_string();
                    if path.is_empty() {
                        continue;
                    }
                    files.push(GitCommitFileEntry {
                        status,
                        path,
                        previous_path: None,
                    });
                }
            }
        }

        let parents = meta_fields[2]
            .split_whitespace()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .collect::<Vec<_>>();
        let refs = meta_fields[3]
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();

        Ok(GitCommitDetail {
            commit: meta_fields[0].clone(),
            short_commit: meta_fields[1].clone(),
            parents,
            refs,
            author_name: meta_fields[4].clone(),
            author_email: meta_fields[5].clone(),
            authored_at: meta_fields[6].clone(),
            summary: meta_fields[7].clone(),
            body,
            files,
        })
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, include_remote = include_remote))]
    pub fn list_branches(
        &self,
        workspace_id: &WorkspaceId,
        include_remote: bool,
    ) -> AbstractionResult<Vec<GitBranchEntry>> {
        let root = self.workspace_root(workspace_id)?;
        let mut refs = vec!["refs/heads/"];
        if include_remote {
            refs.push("refs/remotes/");
        }

        let mut args = vec![
            "for-each-ref".to_string(),
            "--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:trackshort)\t%(objectname:short)\t%(subject)".to_string(),
        ];
        args.extend(refs.iter().map(|item| item.to_string()));
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(&root, &arg_refs, "GIT_BRANCH_LIST_FAILED")?;

        let mut entries = Vec::new();
        for line in output.lines() {
            let fields = line.split('\t').collect::<Vec<_>>();
            if fields.len() < 6 {
                continue;
            }
            let name = fields[1].trim().to_string();
            if name.is_empty() {
                continue;
            }
            entries.push(GitBranchEntry {
                name,
                current: fields[0].trim() == "*",
                upstream: (!fields[2].trim().is_empty()).then(|| fields[2].trim().to_string()),
                tracking: (!fields[3].trim().is_empty()).then(|| fields[3].trim().to_string()),
                commit: fields[4].trim().to_string(),
                summary: fields[5].trim().to_string(),
            });
        }

        Ok(entries)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, target = target, create = create))]
    pub fn checkout(
        &self,
        workspace_id: &WorkspaceId,
        target: &str,
        create: bool,
        start_point: Option<&str>,
    ) -> AbstractionResult<()> {
        let root = self.workspace_root(workspace_id)?;
        self.validate_branch_name(&root, target)?;

        let mut args = vec!["checkout".to_string()];
        if create {
            args.push("-b".to_string());
            args.push(target.trim().to_string());
            if let Some(start_point) = start_point {
                let trimmed = start_point.trim();
                if !trimmed.is_empty() {
                    args.push(trimmed.to_string());
                }
            }
        } else {
            args.push(target.trim().to_string());
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_CHECKOUT_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, branch = branch))]
    pub fn create_branch(
        &self,
        workspace_id: &WorkspaceId,
        branch: &str,
        start_point: Option<&str>,
    ) -> AbstractionResult<()> {
        let root = self.workspace_root(workspace_id)?;
        self.validate_branch_name(&root, branch)?;

        let mut args = vec!["branch".to_string(), branch.trim().to_string()];
        if let Some(start_point) = start_point {
            let trimmed = start_point.trim();
            if !trimmed.is_empty() {
                args.push(trimmed.to_string());
            }
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_BRANCH_CREATE_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, branch = branch, force = force))]
    pub fn delete_branch(
        &self,
        workspace_id: &WorkspaceId,
        branch: &str,
        force: bool,
    ) -> AbstractionResult<()> {
        let root = self.workspace_root(workspace_id)?;
        self.validate_branch_name(&root, branch)?;

        let flag = if force { "-D" } else { "-d" };
        self.run_git(
            &root,
            &["branch", flag, branch.trim()],
            "GIT_BRANCH_DELETE_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, remote = remote, prune = prune, include_tags = include_tags))]
    pub fn fetch(
        &self,
        workspace_id: &WorkspaceId,
        remote: Option<&str>,
        prune: bool,
        include_tags: bool,
    ) -> AbstractionResult<GitFetchResult> {
        let root = self.workspace_root(workspace_id)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin")
            .to_string();

        let mut args = vec!["fetch".to_string(), remote.clone()];
        if prune {
            args.push("--prune".to_string());
        }
        if include_tags {
            args.push("--tags".to_string());
        } else {
            args.push("--no-tags".to_string());
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_FETCH_FAILED")?;

        Ok(GitFetchResult {
            remote,
            prune,
            include_tags,
        })
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, remote = ?remote, branch = ?branch, rebase = rebase))]
    pub fn pull(
        &self,
        workspace_id: &WorkspaceId,
        remote: Option<&str>,
        branch: Option<&str>,
        rebase: bool,
    ) -> AbstractionResult<GitPullResult> {
        let root = self.workspace_root(workspace_id)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin")
            .to_string();

        let mut args = vec!["pull".to_string(), remote.clone()];
        if let Some(branch) = branch {
            let trimmed = branch.trim();
            if !trimmed.is_empty() {
                args.push(trimmed.to_string());
            }
        }
        if rebase {
            args.push("--rebase".to_string());
        } else {
            args.push("--no-rebase".to_string());
        }

        let branch = branch
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_PULL_FAILED")?;

        Ok(GitPullResult {
            remote,
            branch,
            rebase,
        })
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, remote = ?remote, branch = ?branch, set_upstream = set_upstream, force_with_lease = force_with_lease))]
    pub fn push(
        &self,
        workspace_id: &WorkspaceId,
        remote: Option<&str>,
        branch: Option<&str>,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> AbstractionResult<GitPushResult> {
        let root = self.workspace_root(workspace_id)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin")
            .to_string();

        let mut args = vec!["push".to_string(), remote.clone()];
        let branch = branch
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        if let Some(branch) = &branch {
            args.push(branch.clone());
        }
        if set_upstream {
            args.push("--set-upstream".to_string());
        }
        if force_with_lease {
            args.push("--force-with-lease".to_string());
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_PUSH_FAILED")?;

        Ok(GitPushResult {
            remote,
            branch,
            set_upstream,
            force_with_lease,
        })
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, include_untracked = include_untracked, keep_index = keep_index))]
    pub fn stash_push(
        &self,
        workspace_id: &WorkspaceId,
        message: Option<&str>,
        include_untracked: bool,
        keep_index: bool,
    ) -> AbstractionResult<()> {
        let root = self.workspace_root(workspace_id)?;
        let mut args = vec!["stash".to_string(), "push".to_string()];
        if include_untracked {
            args.push("--include-untracked".to_string());
        }
        if keep_index {
            args.push("--keep-index".to_string());
        }
        if let Some(message) = message {
            let trimmed = message.trim();
            if !trimmed.is_empty() {
                args.push("-m".to_string());
                args.push(trimmed.to_string());
            }
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_STASH_PUSH_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, stash = ?stash))]
    pub fn stash_pop(
        &self,
        workspace_id: &WorkspaceId,
        stash: Option<&str>,
    ) -> AbstractionResult<()> {
        let root = self.workspace_root(workspace_id)?;
        let mut args = vec!["stash".to_string(), "pop".to_string()];
        if let Some(stash) = stash {
            let trimmed = stash.trim();
            if !trimmed.is_empty() {
                args.push(trimmed.to_string());
            }
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &arg_refs, "GIT_STASH_POP_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, limit = limit))]
    pub fn stash_list(
        &self,
        workspace_id: &WorkspaceId,
        limit: usize,
    ) -> AbstractionResult<Vec<GitStashEntry>> {
        let effective_limit = limit.clamp(1, 200);
        let root = self.workspace_root(workspace_id)?;
        let max_count = effective_limit.to_string();
        let output = self.run_git(
            &root,
            &[
                "stash",
                "list",
                "--date=iso-strict",
                "--pretty=format:%gd%x1f%H%x1f%ad%x1f%s%x1e",
                "--max-count",
                &max_count,
            ],
            "GIT_STASH_LIST_FAILED",
        )?;

        let records = Self::parse_structured_output(&output, 4);
        let mut entries = Vec::with_capacity(records.len());
        for fields in records {
            entries.push(GitStashEntry {
                stash: fields[0].clone(),
                commit: fields[1].clone(),
                created_at: fields[2].clone(),
                summary: fields[3].clone(),
            });
        }
        Ok(entries)
    }
}

fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::GitService;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    use uuid::Uuid;
    use vb_abstractions::{
        AbstractionError, AbstractionResult, TerminalCwdMode, WorkspaceContext, WorkspaceId,
        WorkspacePermissions, WorkspaceService, WorkspaceSessionSnapshot, WorkspaceSummary,
    };

    #[derive(Clone)]
    struct TestWorkspaceService {
        root: PathBuf,
    }

    impl WorkspaceService for TestWorkspaceService {
        fn list(&self) -> AbstractionResult<Vec<WorkspaceSummary>> {
            Ok(vec![])
        }

        fn open(&self, _path: &Path) -> AbstractionResult<WorkspaceSummary> {
            Err(AbstractionError::Internal {
                message: "not implemented in tests".to_string(),
            })
        }

        fn close(&self, _workspace_id: &WorkspaceId) -> AbstractionResult<bool> {
            Ok(false)
        }

        fn switch_active(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceId> {
            Ok(workspace_id.clone())
        }

        fn get_context(&self, workspace_id: &WorkspaceId) -> AbstractionResult<WorkspaceContext> {
            Ok(WorkspaceContext {
                workspace_id: workspace_id.clone(),
                root: self.root.display().to_string(),
                permissions: WorkspacePermissions::default(),
                terminal_default_cwd: TerminalCwdMode::WorkspaceRoot,
            })
        }

        fn restore_session(
            &self,
            _workspace_id: &WorkspaceId,
        ) -> AbstractionResult<WorkspaceSessionSnapshot> {
            Ok(WorkspaceSessionSnapshot::default())
        }
    }

    fn run_git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .expect("git command should start");
        assert!(status.success(), "git {:?} failed with {status}", args);
    }

    fn create_temp_repo() -> (WorkspaceId, PathBuf, GitService<TestWorkspaceService>) {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("vb-git-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp repo dir should be created");

        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.name", "GT Office Test"]);
        run_git(&root, &["config", "user.email", "test@example.com"]);

        let tracked_path = root.join("tracked.txt");
        fs::write(&tracked_path, "base\n").expect("tracked file should be written");
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "init"]);

        let workspace_service = TestWorkspaceService { root: root.clone() };
        let service = GitService::new(workspace_service);
        (workspace_id, root, service)
    }

    #[test]
    fn discard_removes_untracked_files_without_breaking_tracked_restore() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "changed\n").expect("tracked file should be updated");
        fs::write(root.join("scratch.txt"), "draft\n").expect("untracked file should be created");

        service
            .discard(
                &workspace_id,
                &["tracked.txt".to_string(), "scratch.txt".to_string()],
                true,
            )
            .expect("discard should succeed");

        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("tracked file should exist"),
            "base\n"
        );
        assert!(!root.join("scratch.txt").exists());

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn diff_scopes_use_different_git_baselines_for_same_file() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "staged\n").expect("tracked file should be updated");
        run_git(&root, &["add", "tracked.txt"]);
        fs::write(root.join("tracked.txt"), "staged\nworktree\n")
            .expect("tracked file should include unstaged change");

        let staged = service
            .diff_file_structured(&workspace_id, "tracked.txt", true)
            .expect("staged diff should succeed");
        let unstaged = service
            .diff_file_structured(&workspace_id, "tracked.txt", false)
            .expect("unstaged diff should succeed");

        assert_ne!(staged.patch, unstaged.patch);
        assert!(staged.patch.contains("-base"));
        assert!(staged.patch.contains("+staged"));
        assert!(unstaged.patch.contains("+worktree"));
        assert!(!unstaged.patch.contains("-base"));

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn expanded_compare_uses_scope_aligned_full_file_snapshots() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "staged\n").expect("tracked file should be updated");
        run_git(&root, &["add", "tracked.txt"]);
        fs::write(root.join("tracked.txt"), "staged\nworktree\n")
            .expect("tracked file should include unstaged change");

        let staged = service
            .diff_file_expansion(&workspace_id, "tracked.txt", None, true)
            .expect("staged compare should succeed");
        let unstaged = service
            .diff_file_expansion(&workspace_id, "tracked.txt", None, false)
            .expect("unstaged compare should succeed");

        let staged_lines = &staged
            .full_diff
            .as_ref()
            .expect("staged full diff should exist")
            .hunks[0]
            .lines;
        let unstaged_lines = &unstaged
            .full_diff
            .as_ref()
            .expect("unstaged full diff should exist")
            .hunks[0]
            .lines;

        assert!(staged_lines
            .iter()
            .any(|line| line.kind == "del" && line.content == "base"));
        assert!(staged_lines
            .iter()
            .any(|line| line.kind == "add" && line.content == "staged"));
        assert!(unstaged_lines
            .iter()
            .any(|line| line.kind == "ctx" && line.content == "staged"));
        assert!(unstaged_lines
            .iter()
            .any(|line| line.kind == "add" && line.content == "worktree"));

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn unstaged_untracked_jsx_file_returns_new_file_diff_before_staging() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(
            root.join("Widget.jsx"),
            "export function Widget() {\n  return <div>hello</div>\n}\n",
        )
        .expect("jsx file should be written");

        let raw_patch = service
            .diff_file(&workspace_id, "Widget.jsx", false)
            .expect("unstaged raw diff should succeed");
        let structured = service
            .diff_file_structured(&workspace_id, "Widget.jsx", false)
            .expect("unstaged structured diff should succeed");

        assert!(raw_patch.contains("new file mode 100644"));
        assert!(raw_patch.contains("--- /dev/null"));
        assert!(raw_patch.contains("+++ b/Widget.jsx"));
        assert!(raw_patch.contains("+export function Widget() {"));
        assert!(structured.is_new);
        assert!(!structured.is_binary);
        assert_eq!(structured.additions, 3);
        assert_eq!(structured.deletions, 0);
        assert_eq!(structured.hunks.len(), 1);
        assert!(structured.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "add" && line.content == "  return <div>hello</div>"));

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }
}
