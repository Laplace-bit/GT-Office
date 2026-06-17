use git2::{BranchType, Repository, Status, StatusOptions};
use gt_abstractions::{
    AbstractionError, AbstractionResult, ConflictFile, ConflictStatus, GitRepositorySummary,
    GitStatusFile, GitStatusSummary, MergeResult, MergeState,
};
use gt_abstractions::{WorkspaceId, WorkspaceService};
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{Instant, UNIX_EPOCH},
};
use tracing::{debug, instrument, warn};

const MAX_STATUS_FILES: usize = 2000;
const GIT_STATUS_TARGET_BUDGET_MS: u128 = 500;
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
    "gt-git"
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
pub struct GitTagEntry {
    pub name: String,
    pub oid: String,
    pub target: String,
    pub tagger: Option<String>,
    pub message: Option<String>,
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

#[derive(Debug, Clone)]
struct GitRepoContext {
    workspace_root: PathBuf,
    repo_root: PathBuf,
    workspace_relative_prefix: Option<String>,
    repository_path: String,
}

#[derive(Debug, Clone, Default)]
struct RepositoryDiscoveryCache {
    entries: Arc<Mutex<HashMap<PathBuf, Vec<GitRepoContext>>>>,
}

#[derive(Clone)]
pub struct GitService<W>
where
    W: WorkspaceService + Clone,
{
    workspace_service: W,
    git_path: Option<OsString>,
    repository_cache: RepositoryDiscoveryCache,
}

impl<W> GitService<W>
where
    W: WorkspaceService + Clone,
{
    pub fn new(workspace_service: W) -> Self {
        let git_path = build_git_command_path();
        Self {
            workspace_service,
            git_path,
            repository_cache: RepositoryDiscoveryCache::default(),
        }
    }

    pub fn invalidate_repository_cache(&self, workspace_id: &WorkspaceId) -> AbstractionResult<()> {
        let workspace_root = self.workspace_root(workspace_id)?;
        if let Ok(mut entries) = self.repository_cache.entries.lock() {
            entries.remove(&workspace_root);
        }
        Ok(())
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

    fn workspace_context(&self, workspace_id: &WorkspaceId) -> AbstractionResult<GitRepoContext> {
        let workspace_root = self.workspace_root(workspace_id)?;
        Ok(GitRepoContext {
            repo_root: workspace_root.clone(),
            workspace_root,
            workspace_relative_prefix: None,
            repository_path: String::new(),
        })
    }

    fn resolve_repo_context(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<GitRepoContext> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let normalized = repository_path.unwrap_or("").trim();
        if normalized.is_empty() {
            return self.default_repo_context(workspace_root);
        }

        if let Some(context) = self
            .discover_workspace_repositories(&workspace_root)?
            .into_iter()
            .find(|repository| repository.repository_path == normalized)
        {
            return Ok(context);
        }

        let relative = Path::new(normalized);
        if relative.is_absolute() {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "GIT_REPOSITORY_PATH_INVALID: repository path must be workspace-relative '{}'",
                    normalized
                ),
            });
        }
        for component in relative.components() {
            if !matches!(component, Component::Normal(_)) {
                return Err(AbstractionError::InvalidArgument {
                    message: format!(
                        "GIT_REPOSITORY_PATH_INVALID: repository path escapes workspace '{}'",
                        normalized
                    ),
                });
            }
        }
        let repo_root = workspace_root.join(relative);
        if !repo_root.exists() || !repo_root.is_dir() {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "GIT_REPOSITORY_PATH_INVALID: repository root does not exist '{}'",
                    normalized
                ),
            });
        }
        if !repo_root.join(".git").exists() {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "GIT_REPOSITORY_PATH_INVALID: no git repository at '{}'",
                    normalized
                ),
            });
        }
        Ok(GitRepoContext {
            workspace_root,
            repo_root,
            workspace_relative_prefix: None,
            repository_path: normalized.replace('\\', "/"),
        })
    }

    fn default_repo_context(&self, workspace_root: PathBuf) -> AbstractionResult<GitRepoContext> {
        if workspace_root.join(".git").exists() {
            return Ok(GitRepoContext {
                repo_root: workspace_root.clone(),
                workspace_root,
                workspace_relative_prefix: None,
                repository_path: String::new(),
            });
        }

        let repository = Repository::discover(&workspace_root).map_err(|_| {
            AbstractionError::InvalidArgument {
                message: "GIT_REPO_INVALID: not a git repository".to_string(),
            }
        })?;
        let repo_root = repository.workdir().map(Path::to_path_buf).ok_or_else(|| {
            AbstractionError::InvalidArgument {
                message: "GIT_REPO_INVALID: bare repositories are not supported".to_string(),
            }
        })?;
        Self::context_for_repo_root(workspace_root, repo_root)
    }

    fn context_for_repo_root(
        workspace_root: PathBuf,
        repo_root: PathBuf,
    ) -> AbstractionResult<GitRepoContext> {
        let workspace_relative_prefix =
            match Self::path_to_repo_relative(workspace_root.as_path(), repo_root.as_path()) {
                Ok(prefix) if !prefix.is_empty() => Some(prefix),
                Ok(_) => None,
                Err(_) => None,
            };
        let repository_path = if workspace_relative_prefix.is_some() {
            String::new()
        } else {
            Self::path_to_workspace_relative(repo_root.as_path(), workspace_root.as_path())?
        };

        Ok(GitRepoContext {
            workspace_root,
            repo_root,
            workspace_relative_prefix,
            repository_path,
        })
    }

    fn path_to_workspace_relative(path: &Path, workspace_root: &Path) -> AbstractionResult<String> {
        let relative = match path.strip_prefix(workspace_root) {
            Ok(relative) => relative.to_path_buf(),
            Err(_) => {
                let canonical_path =
                    std::fs::canonicalize(path).map_err(|_| AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: repository is outside workspace '{}'",
                            path.display()
                        ),
                    })?;
                let canonical_root = std::fs::canonicalize(workspace_root).map_err(|_| {
                    AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: repository is outside workspace '{}'",
                            path.display()
                        ),
                    }
                })?;
                canonical_path
                    .strip_prefix(&canonical_root)
                    .map(Path::to_path_buf)
                    .map_err(|_| AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: repository is outside workspace '{}'",
                            path.display()
                        ),
                    })?
            }
        };
        if relative.as_os_str().is_empty() {
            return Ok(String::new());
        }
        Ok(relative.to_string_lossy().replace('\\', "/"))
    }

    fn path_to_repo_relative(path: &Path, repo_root: &Path) -> AbstractionResult<String> {
        let relative = match path.strip_prefix(repo_root) {
            Ok(relative) => relative.to_path_buf(),
            Err(_) => {
                let canonical_path =
                    std::fs::canonicalize(path).map_err(|_| AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: path is outside repository '{}'",
                            path.display()
                        ),
                    })?;
                let canonical_root = std::fs::canonicalize(repo_root).map_err(|_| {
                    AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: path is outside repository '{}'",
                            path.display()
                        ),
                    }
                })?;
                canonical_path
                    .strip_prefix(&canonical_root)
                    .map(Path::to_path_buf)
                    .map_err(|_| AbstractionError::InvalidArgument {
                        message: format!(
                            "GIT_REPOSITORY_PATH_INVALID: path is outside repository '{}'",
                            path.display()
                        ),
                    })?
            }
        };
        if relative.as_os_str().is_empty() {
            return Ok(String::new());
        }
        Ok(relative.to_string_lossy().replace('\\', "/"))
    }

    fn join_workspace_relative_path(repository_path: &str, repo_relative_path: &str) -> String {
        if repository_path.is_empty() {
            return repo_relative_path.to_string();
        }
        format!("{repository_path}/{repo_relative_path}")
    }

    fn repo_relative_to_workspace_path(
        context: &GitRepoContext,
        repo_relative_path: &str,
    ) -> Option<String> {
        let normalized = repo_relative_path.trim().replace('\\', "/");
        if normalized.is_empty() {
            return None;
        }

        if let Some(prefix) = context.workspace_relative_prefix.as_deref() {
            let prefix = prefix.trim_matches('/');
            if normalized == prefix {
                return None;
            }
            let workspace_relative = normalized.strip_prefix(&format!("{prefix}/"))?;
            if workspace_relative.is_empty() {
                return None;
            }
            Some(workspace_relative.to_string())
        } else {
            Some(Self::join_workspace_relative_path(
                &context.repository_path,
                &normalized,
            ))
        }
    }

    fn map_diff_to_workspace_paths(context: &GitRepoContext, diff: &mut GitDiffStructured) {
        if let Some(path) = Self::repo_relative_to_workspace_path(context, &diff.path) {
            diff.path = path;
        }
        if let Some(old_path) = diff.old_path.as_deref() {
            diff.old_path = Self::repo_relative_to_workspace_path(context, old_path);
        }
    }

    fn parse_porcelain_status(stdout: &str, context: &GitRepoContext) -> GitStatusSummary {
        let mut summary = GitStatusSummary {
            primary_repository_path: context.repository_path.to_string(),
            ..GitStatusSummary::default()
        };

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

            let repo_relative_path = path.to_string();
            let Some(workspace_path) =
                Self::repo_relative_to_workspace_path(context, &repo_relative_path)
            else {
                continue;
            };
            summary.files.push(GitStatusFile {
                path: workspace_path,
                staged: index != ' ' && index != '?',
                status: format!("{index}{worktree}").trim().to_string(),
                repository_path: context.repository_path.to_string(),
                content_signature: Self::content_signature(context, &repo_relative_path),
                repo_relative_path,
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

    fn content_signature(context: &GitRepoContext, repo_relative_path: &str) -> String {
        let path = context.repo_root.join(repo_relative_path);
        let Ok(metadata) = std::fs::metadata(path) else {
            return String::new();
        };
        if !metadata.is_file() {
            return String::new();
        }
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        format!("{}:{modified_ns}", metadata.len())
    }

    fn status_with_git2(&self, context: &GitRepoContext) -> AbstractionResult<GitStatusSummary> {
        let repo =
            Repository::discover(&context.repo_root).map_err(|err| AbstractionError::Internal {
                message: format!("GIT_STATUS_GIT2_FAILED: repository discovery failed: {err}"),
            })?;

        let mut summary = GitStatusSummary {
            primary_repository_path: context.repository_path.to_string(),
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
            .recurse_untracked_dirs(true);
        if let Some(prefix) = context.workspace_relative_prefix.as_deref() {
            options.pathspec(prefix);
        }

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

            let repo_relative_path = path.to_string();
            let Some(workspace_path) =
                Self::repo_relative_to_workspace_path(context, &repo_relative_path)
            else {
                continue;
            };
            summary.files.push(GitStatusFile {
                path: workspace_path,
                staged: status.intersects(
                    Status::INDEX_NEW
                        | Status::INDEX_MODIFIED
                        | Status::INDEX_DELETED
                        | Status::INDEX_RENAMED
                        | Status::INDEX_TYPECHANGE,
                ),
                status: Self::resolve_status_string(status),
                repository_path: context.repository_path.to_string(),
                content_signature: Self::content_signature(context, &repo_relative_path),
                repo_relative_path,
            });
        }

        Ok(summary)
    }

    /// Resolve the HEAD commit OID using git2 (in-process, no fork).
    fn resolve_head_oid(&self, root: &Path) -> AbstractionResult<String> {
        let repo = Repository::discover(root).map_err(|err| AbstractionError::Internal {
            message: format!("GIT_REV_PARSE_FAILED: repository discovery failed: {err}"),
        })?;
        let head = repo.head().map_err(|err| AbstractionError::Internal {
            message: format!("GIT_REV_PARSE_FAILED: failed to read HEAD: {err}"),
        })?;
        let oid = head.target().ok_or_else(|| AbstractionError::Internal {
            message: "GIT_REV_PARSE_FAILED: HEAD has no target".to_string(),
        })?;
        Ok(oid.to_string())
    }

    fn run_git(&self, root: &Path, args: &[&str], error_code: &str) -> AbstractionResult<String> {
        debug!(root = %root.display(), args = ?args, "running git command");
        let mut command = Command::new("git");
        configure_background_command(&mut command);
        if let Some(path) = &self.git_path {
            command.env("PATH", path);
        }
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
            "-z".to_string(),
            "--".to_string(),
        ];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(root, &args, error_code)?;

        Ok(Self::parse_nul_delimited_output(&output))
    }

    #[allow(dead_code)]
    fn list_index_new_paths(
        &self,
        root: &Path,
        paths: &[String],
        error_code: &str,
    ) -> AbstractionResult<std::collections::HashSet<String>> {
        if paths.is_empty() {
            return Ok(std::collections::HashSet::new());
        }

        let mut owned_args = vec![
            "diff".to_string(),
            "--cached".to_string(),
            "--name-only".to_string(),
            "--diff-filter=A".to_string(),
            "-z".to_string(),
            "--".to_string(),
        ];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(root, &args, error_code)?;

        Ok(Self::parse_nul_delimited_output(&output))
    }

    #[allow(dead_code)]
    fn list_tracked_paths(
        &self,
        root: &Path,
        paths: &[String],
        error_code: &str,
    ) -> AbstractionResult<std::collections::HashSet<String>> {
        if paths.is_empty() {
            return Ok(std::collections::HashSet::new());
        }

        let mut owned_args = vec!["ls-files".to_string(), "-z".to_string(), "--".to_string()];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(root, &args, error_code)?;

        Ok(Self::parse_nul_delimited_output(&output))
    }

    fn filter_ignored_paths(
        &self,
        root: &Path,
        paths: &[String],
    ) -> AbstractionResult<Vec<String>> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }

        debug!(
            root = %root.display(),
            path_count = paths.len(),
            "batch filtering ignored git paths"
        );
        let mut command = Command::new("git");
        configure_background_command(&mut command);
        if let Some(path) = &self.git_path {
            command.env("PATH", path);
        }
        let mut child = command
            .arg("-C")
            .arg(root)
            .env("LC_ALL", "C.UTF-8")
            .env("LANG", "C.UTF-8")
            .args(["check-ignore", "--stdin", "-z"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|err| AbstractionError::Internal {
                message: format!("GIT_STAGE_FAILED: failed to run git check-ignore: {err}"),
            })?;

        {
            use std::io::Write;
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| AbstractionError::Internal {
                    message: "GIT_STAGE_FAILED: unable to open stdin for git check-ignore"
                        .to_string(),
                })?;
            for path in paths {
                stdin.write_all(path.as_bytes()).map_err(|err| {
                    AbstractionError::Internal {
                        message: format!(
                            "GIT_STAGE_FAILED: failed to write path '{path}' to git check-ignore: {err}"
                        ),
                    }
                })?;
                stdin.write_all(b"\0").map_err(|err| AbstractionError::Internal {
                    message: format!(
                        "GIT_STAGE_FAILED: failed to terminate path '{path}' for git check-ignore: {err}"
                    ),
                })?;
            }
        }

        let output = child
            .wait_with_output()
            .map_err(|err| AbstractionError::Internal {
                message: format!("GIT_STAGE_FAILED: git check-ignore failed to complete: {err}"),
            })?;

        if !output.status.success() && output.status.code() != Some(1) {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AbstractionError::Internal {
                message: format!("GIT_STAGE_FAILED: git check-ignore failed: {stderr}"),
            });
        }

        let ignored_paths = output
            .stdout
            .split(|byte| *byte == b'\0')
            .filter(|segment| !segment.is_empty())
            .map(|segment| String::from_utf8_lossy(segment).to_string())
            .collect::<std::collections::HashSet<_>>();

        Ok(paths
            .iter()
            .filter(|path| !ignored_paths.contains(path.as_str()))
            .cloned()
            .collect())
    }

    fn status_with_system_git(
        &self,
        context: &GitRepoContext,
    ) -> AbstractionResult<GitStatusSummary> {
        let mut args = vec![
            "status".to_string(),
            "--porcelain".to_string(),
            "--branch".to_string(),
            "--untracked-files=all".to_string(),
        ];
        if let Some(prefix) = context.workspace_relative_prefix.as_deref() {
            args.push("--".to_string());
            args.push(prefix.to_string());
        }
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(&context.repo_root, &arg_refs, "GIT_STATUS_FAILED")?;
        Ok(Self::parse_porcelain_status(&output, context))
    }

    fn discover_workspace_repositories(
        &self,
        workspace_root: &Path,
    ) -> AbstractionResult<Vec<GitRepoContext>> {
        if let Ok(entries) = self.repository_cache.entries.lock() {
            if let Some(repositories) = entries.get(workspace_root) {
                return Ok(repositories.clone());
            }
        }

        let mut repositories = Vec::new();
        if workspace_root.join(".git").exists() {
            repositories.push(GitRepoContext {
                workspace_root: workspace_root.to_path_buf(),
                repo_root: workspace_root.to_path_buf(),
                workspace_relative_prefix: None,
                repository_path: String::new(),
            });
        } else if let Ok(repository) = Repository::discover(workspace_root) {
            if let Some(repo_root) = repository.workdir().map(Path::to_path_buf) {
                repositories.push(Self::context_for_repo_root(
                    workspace_root.to_path_buf(),
                    repo_root,
                )?);
            }
        }

        self.collect_nested_repositories(
            workspace_root,
            workspace_root,
            &mut repositories,
            workspace_root.join(".git").exists(),
        )?;
        repositories.sort_by(|left, right| left.repository_path.cmp(&right.repository_path));
        if let Ok(mut entries) = self.repository_cache.entries.lock() {
            entries.insert(workspace_root.to_path_buf(), repositories.clone());
        }
        Ok(repositories)
    }

    fn collect_nested_repositories(
        &self,
        workspace_root: &Path,
        current_dir: &Path,
        repositories: &mut Vec<GitRepoContext>,
        skip_current_git_dir: bool,
    ) -> AbstractionResult<()> {
        let entries =
            std::fs::read_dir(current_dir).map_err(|error| AbstractionError::Internal {
                message: format!(
                    "GIT_REPOSITORY_DISCOVERY_FAILED: unable to read '{}': {error}",
                    current_dir.display()
                ),
            })?;

        for entry in entries {
            let entry = entry.map_err(|error| AbstractionError::Internal {
                message: format!(
                    "GIT_REPOSITORY_DISCOVERY_FAILED: unable to inspect '{}': {error}",
                    current_dir.display()
                ),
            })?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            if name == ".git" || name == "node_modules" || name == "target" {
                continue;
            }
            if path.join(".git").exists() {
                let repository_path =
                    Self::path_to_workspace_relative(path.as_path(), workspace_root)?;
                if !(skip_current_git_dir && repository_path.is_empty()) {
                    repositories.push(GitRepoContext {
                        workspace_root: workspace_root.to_path_buf(),
                        repo_root: path.clone(),
                        workspace_relative_prefix: None,
                        repository_path,
                    });
                }
            }
            self.collect_nested_repositories(workspace_root, path.as_path(), repositories, false)?;
        }
        Ok(())
    }

    fn normalize_workspace_paths_for_repo(
        &self,
        context: &GitRepoContext,
        paths: &[String],
    ) -> AbstractionResult<Vec<String>> {
        let mut normalized = Vec::with_capacity(paths.len());
        let repository_relative_root = if context.repository_path.is_empty() {
            None
        } else {
            Some(Path::new(context.repository_path.as_str()))
        };
        for path in paths {
            Self::validate_relative_repo_path(path)?;
            let workspace_relative = Path::new(path.trim());
            let repo_relative = if let Some(prefix) = context.workspace_relative_prefix.as_deref() {
                Path::new(prefix).join(workspace_relative)
            } else {
                match repository_relative_root {
                    Some(repo_root) => {
                        workspace_relative.strip_prefix(repo_root).map_err(|_| {
                            AbstractionError::InvalidArgument {
                                message: format!(
                                    "GIT_PATH_INVALID: path '{}' is outside repository '{}'",
                                    path, context.repository_path
                                ),
                            }
                        })?
                    }
                    None => workspace_relative,
                }
                .to_path_buf()
            };
            normalized.push(repo_relative.to_string_lossy().replace('\\', "/"));
        }
        Ok(normalized)
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

    fn parse_nul_delimited_output(output: &str) -> std::collections::HashSet<String> {
        output
            .split('\0')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    }

    fn is_not_git_repository_message(message: &str) -> bool {
        let normalized = message.to_ascii_lowercase();
        normalized.contains("git_repo_invalid")
            || normalized.contains("not a git repository")
            || normalized.contains("must be run in a work tree")
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn status_repo(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<GitStatusSummary> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        match self.status_with_git2(&context) {
            Ok(mut summary) => {
                if summary.branch == "HEAD" {
                    if let Ok(fallback) = self.status_with_system_git(&context) {
                        if fallback.branch != "HEAD" {
                            summary.branch = fallback.branch;
                            summary.ahead = fallback.ahead;
                            summary.behind = fallback.behind;
                        }
                    }
                }
                Ok(summary)
            }
            Err(_) => match self.status_with_system_git(&context) {
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
    pub fn status(&self, workspace_id: &WorkspaceId) -> AbstractionResult<GitStatusSummary> {
        let started_at = Instant::now();
        let workspace_context = self.workspace_context(workspace_id)?;
        let repositories =
            self.discover_workspace_repositories(&workspace_context.workspace_root)?;
        if repositories.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_REPO_INVALID: not a git repository".to_string(),
            });
        }

        let mut aggregated = GitStatusSummary::default();
        let repo_count = repositories.len();
        let mut repo_summaries = Vec::with_capacity(repo_count);
        let repo_statuses = std::thread::scope(|scope| {
            let (tx, rx) = std::sync::mpsc::channel();
            for (index, repo) in repositories.iter().cloned().enumerate() {
                let tx = tx.clone();
                let service = self.clone();
                let workspace_id = workspace_id.clone();
                scope.spawn(move || {
                    let result =
                        service.status_repo(&workspace_id, Some(repo.repository_path.as_str()));
                    let _ = tx.send((index, result));
                });
            }
            drop(tx);

            let mut statuses = vec![None; repo_count];
            for _ in 0..repo_count {
                let (index, result) = rx.recv().map_err(|error| AbstractionError::Internal {
                    message: format!(
                        "GIT_STATUS_FAILED: unable to collect repository status result: {error}"
                    ),
                })?;
                statuses[index] = Some(result);
            }
            statuses
                .into_iter()
                .map(|entry| {
                    entry.ok_or_else(|| AbstractionError::Internal {
                        message: "GIT_STATUS_FAILED: missing repository status result".to_string(),
                    })?
                })
                .collect::<AbstractionResult<Vec<_>>>()
        })?;

        for (index, summary) in repo_statuses.into_iter().enumerate() {
            if index == 0 {
                aggregated.primary_repository_path = summary.primary_repository_path.clone();
                aggregated.branch = summary.branch.clone();
                aggregated.ahead = summary.ahead;
                aggregated.behind = summary.behind;
            }
            aggregated.files.extend(summary.files.iter().cloned());
            repo_summaries.push(GitRepositorySummary {
                repository_path: summary.primary_repository_path.clone(),
                root: summary.primary_repository_path.is_empty(),
                branch: summary.branch.clone(),
                ahead: summary.ahead,
                behind: summary.behind,
                files: summary.files,
            });
        }
        aggregated.repositories = repo_summaries;
        let elapsed_ms = started_at.elapsed().as_millis();
        if elapsed_ms > GIT_STATUS_TARGET_BUDGET_MS {
            warn!(
                workspace_id = %workspace_id,
                repo_count,
                file_count = aggregated.files.len(),
                elapsed_ms,
                target_budget_ms = GIT_STATUS_TARGET_BUDGET_MS,
                "aggregated multi-repository git status exceeded target budget"
            );
        }
        debug!(
            workspace_id = %workspace_id,
            repo_count,
            file_count = aggregated.files.len(),
            elapsed_ms,
            "aggregated multi-repository git status"
        );
        Ok(aggregated)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn init_repo(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        initial_branch: Option<&str>,
    ) -> AbstractionResult<String> {
        let context = if repository_path.is_some() {
            let workspace_root = self.workspace_root(workspace_id)?;
            let requested = repository_path.unwrap_or("").trim();
            let repo_root = if requested.is_empty() {
                workspace_root.clone()
            } else {
                workspace_root.join(requested)
            };
            let repository_path =
                Self::path_to_workspace_relative(repo_root.as_path(), workspace_root.as_path())?;
            GitRepoContext {
                workspace_root,
                repo_root,
                workspace_relative_prefix: None,
                repository_path,
            }
        } else {
            self.workspace_context(workspace_id)?
        };
        let branch = initial_branch
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("main");
        self.validate_branch_name(&context.repo_root, branch)?;

        if Repository::discover(&context.repo_root).is_err() {
            self.run_git(
                &context.repo_root,
                &["init", "-b", branch],
                "GIT_INIT_FAILED",
            )?;
        }

        let summary = self.status_repo(workspace_id, Some(context.repository_path.as_str()))?;
        if summary.branch == "HEAD" || summary.branch.starts_with("HEAD ") {
            Ok(branch.to_string())
        } else {
            Ok(summary.branch)
        }
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        staged: bool,
    ) -> AbstractionResult<String> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let normalized_path = self
            .normalize_workspace_paths_for_repo(&context, &[path.to_string()])?
            .into_iter()
            .next()
            .unwrap_or_default();
        self.run_git_diff(
            &context.repo_root,
            &normalized_path,
            GitDiffMode::from_staged(staged),
        )
    }

    /// High-performance structured diff using git2 library
    /// Returns parsed diff hunks for immediate rendering without frontend parsing
    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file_structured(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        staged: bool,
    ) -> AbstractionResult<GitDiffStructured> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let normalized_path = self
            .normalize_workspace_paths_for_repo(&context, &[path.to_string()])?
            .into_iter()
            .next()
            .unwrap_or_default();
        let diff_mode = GitDiffMode::from_staged(staged);

        // Try git2 first for performance, fallback to git command
        match self.diff_file_with_git2(&context.repo_root, &normalized_path, diff_mode) {
            Ok(mut result) => {
                Self::map_diff_to_workspace_paths(&context, &mut result);
                Ok(result)
            }
            Err(_) => {
                // Fallback to git command and parse the output
                let patch = self.run_git_diff(&context.repo_root, &normalized_path, diff_mode)?;
                let mut result = self.parse_diff_patch(&patch, &normalized_path);
                Self::map_diff_to_workspace_paths(&context, &mut result);
                Ok(result)
            }
        }
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file_expansion(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        old_path: Option<&str>,
        staged: bool,
    ) -> AbstractionResult<GitExpandedCompare> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let normalized_path = self
            .normalize_workspace_paths_for_repo(&context, &[path.to_string()])?
            .into_iter()
            .next()
            .unwrap_or_default();
        let normalized_previous_path = if let Some(previous_path) = old_path {
            self.normalize_workspace_paths_for_repo(&context, &[previous_path.to_string()])?
                .into_iter()
                .next()
        } else {
            None
        };

        let repo =
            Repository::discover(&context.repo_root).map_err(|err| AbstractionError::Internal {
                message: format!("GIT_DIFF_EXPANSION_FAILED: repository discovery failed: {err}"),
            })?;

        let previous_path = normalized_previous_path
            .as_deref()
            .unwrap_or(&normalized_path);
        let before_snapshot = if staged {
            Self::read_head_snapshot(&repo, previous_path)?
        } else {
            Self::read_index_snapshot(&repo, previous_path)?
        };
        let after_snapshot = if staged {
            Self::read_index_snapshot(&repo, &normalized_path)?
        } else {
            Self::read_worktree_snapshot(&context.repo_root, &normalized_path)?
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
            let mut diff = Self::build_full_structured_diff(
                &normalized_path,
                normalized_previous_path.clone(),
                before_text,
                after_text,
                old_exists,
                new_exists,
            );
            Self::map_diff_to_workspace_paths(&context, &mut diff);
            Some(diff)
        };
        let path = Self::repo_relative_to_workspace_path(&context, &normalized_path)
            .unwrap_or_else(|| normalized_path.clone());
        let old_path = normalized_previous_path
            .as_deref()
            .and_then(|path| Self::repo_relative_to_workspace_path(&context, path));

        Ok(GitExpandedCompare {
            path,
            old_path,
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
    pub fn stage(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        paths: &[String],
    ) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Ok(0);
        }

        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let paths = self.normalize_workspace_paths_for_repo(&context, paths)?;
        let mut owned_args = vec!["add".to_string(), "--".to_string()];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();

        // Try staging all paths at once. If some are ignored, git add fails.
        // In that case, filter out ignored paths and retry with only stageable ones.
        match self.run_git(&context.repo_root, &args, "GIT_STAGE_FAILED") {
            Ok(_) => Ok(paths.len()),
            Err(AbstractionError::Internal { message })
                if message.contains("ignored by one of your .gitignore files") =>
            {
                let stageable_paths = self.filter_ignored_paths(&context.repo_root, &paths)?;
                if stageable_paths.is_empty() {
                    return Ok(0);
                }
                let mut retry_args = vec!["add".to_string(), "--".to_string()];
                retry_args.extend(stageable_paths.iter().cloned());
                let retry_refs = retry_args.iter().map(String::as_str).collect::<Vec<_>>();
                self.run_git(&context.repo_root, &retry_refs, "GIT_STAGE_FAILED")?;
                Ok(stageable_paths.len())
            }
            Err(e) => Err(e),
        }
    }

    #[instrument(skip(self, paths), fields(workspace_id = %workspace_id, path_count = paths.len()))]
    pub fn unstage(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        paths: &[String],
    ) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Ok(0);
        }

        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let paths = self.normalize_workspace_paths_for_repo(&context, paths)?;
        let mut owned_args = vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
        ];
        owned_args.extend(paths.iter().cloned());
        let args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&context.repo_root, &args, "GIT_UNSTAGE_FAILED")?;
        Ok(paths.len())
    }

    #[instrument(skip(self, paths), fields(workspace_id = %workspace_id, path_count = paths.len(), include_untracked = include_untracked))]
    pub fn discard(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        paths: &[String],
        include_untracked: bool,
    ) -> AbstractionResult<usize> {
        if paths.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_DISCARD_PATHS_REQUIRED: paths cannot be empty".to_string(),
            });
        }

        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let paths = self.normalize_workspace_paths_for_repo(&context, paths)?;

        // Classify paths using a single git status --porcelain -z call instead of
        // three separate git invocations (ls-files, diff --cached, ls-files).
        let mut status_args = vec![
            "status".to_string(),
            "--porcelain".to_string(),
            "-z".to_string(),
            "--".to_string(),
        ];
        status_args.extend(paths.iter().cloned());
        let status_refs = status_args.iter().map(String::as_str).collect::<Vec<_>>();
        let status_output = self.run_git(&context.repo_root, &status_refs, "GIT_DISCARD_FAILED")?;

        let path_set: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();
        let mut untracked_paths = std::collections::HashSet::new();
        let mut index_new_paths = std::collections::HashSet::new();
        let mut tracked_paths = Vec::new();

        // Porcelain -z format: "XY PATH\0" for ordinary entries,
        // "XY OLD_PATH\0NEW_PATH\0" for renames/copies,
        // "?? PATH\0" for untracked.
        // XY is 2 chars, followed by a space, then the path.
        // Split on \0 but preserve order for multi-segment entries.
        let segments: Vec<&str> = status_output.split('\0').collect();
        let mut i = 0;
        while i < segments.len() {
            let segment = segments[i];
            if segment.is_empty() {
                i += 1;
                continue;
            }
            if segment.len() >= 4 {
                let xy = &segment[..2];
                let rest = &segment[3..]; // skip "XY " (2 status chars + 1 space)
                if xy == "??" {
                    if path_set.contains(rest) {
                        untracked_paths.insert(rest.to_string());
                    }
                    i += 1;
                } else if xy.starts_with('R') || xy.starts_with('C') {
                    // Rename/copy: rest is new_path, next segment is old_path
                    if path_set.contains(rest) {
                        tracked_paths.push(rest.to_string());
                    }
                    i += 2; // consume both new_path and old_path segments
                } else {
                    // Ordinary status: rest is the path
                    if path_set.contains(rest) {
                        let index_status = xy.chars().next().unwrap_or(' ');
                        if index_status == 'A' {
                            index_new_paths.insert(rest.to_string());
                        } else if !untracked_paths.contains(rest) && !index_new_paths.contains(rest)
                        {
                            tracked_paths.push(rest.to_string());
                        }
                    }
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        // Filter tracked_paths to exclude untracked and index-new
        tracked_paths.retain(|p| !untracked_paths.contains(p) && !index_new_paths.contains(p));

        let discarded = tracked_paths.len() + index_new_paths.len() + untracked_paths.len();

        if !tracked_paths.is_empty() {
            let mut restore_args = vec![
                "restore".to_string(),
                "--worktree".to_string(),
                "--".to_string(),
            ];
            restore_args.extend(tracked_paths.iter().cloned());
            let restore_refs = restore_args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_git(&context.repo_root, &restore_refs, "GIT_DISCARD_FAILED")?;
        }

        if !index_new_paths.is_empty() {
            let mut remove_args = vec!["rm".to_string(), "--force".to_string(), "--".to_string()];
            remove_args.extend(index_new_paths.iter().cloned());
            let remove_refs = remove_args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_git(&context.repo_root, &remove_refs, "GIT_DISCARD_FAILED")?;
        }

        if include_untracked && !untracked_paths.is_empty() {
            let mut clean_args = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
            clean_args.extend(untracked_paths.iter().cloned());
            let clean_refs = clean_args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_git(&context.repo_root, &clean_refs, "GIT_DISCARD_FAILED")?;
        }

        Ok(discarded)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn commit(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        message: &str,
    ) -> AbstractionResult<String> {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_COMMIT_MESSAGE_INVALID: message cannot be empty".to_string(),
            });
        }

        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["commit", "-m", trimmed, "--no-gpg-sign"],
            "GIT_COMMIT_FAILED",
        )?;

        let commit_id = self.resolve_head_oid(&context.repo_root)?;
        Ok(commit_id)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn commit_amend(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        message: &str,
    ) -> AbstractionResult<String> {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_COMMIT_MESSAGE_INVALID: commit message cannot be empty".to_string(),
            });
        }

        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["commit", "--amend", "-m", trimmed, "--no-gpg-sign"],
            "GIT_COMMIT_FAILED",
        )?;

        let commit_id = self.resolve_head_oid(&context.repo_root)?;
        Ok(commit_id)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, limit = limit, skip = skip))]
    pub fn log(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        limit: usize,
        skip: usize,
    ) -> AbstractionResult<Vec<GitCommitEntry>> {
        let effective_limit = limit.clamp(1, 500);
        let effective_skip = skip.min(200_000);
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let max_count = effective_limit.to_string();
        let skip_count = effective_skip.to_string();
        let mut args = vec![
            "log".to_string(),
            "--date=iso-strict".to_string(),
            "--decorate=short".to_string(),
            "--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e".to_string(),
            "--max-count".to_string(),
            max_count,
            "--skip".to_string(),
            skip_count,
        ];
        if let Some(prefix) = context.workspace_relative_prefix.as_deref() {
            args.push("--".to_string());
            args.push(prefix.to_string());
        }
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = self.run_git(&context.repo_root, &arg_refs, "GIT_LOG_FAILED")?;

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
        repository_path: Option<&str>,
        commit: &str,
    ) -> AbstractionResult<GitCommitDetail> {
        let commit_id = Self::validate_commit_id(commit)?;
        let context = self.resolve_repo_context(workspace_id, repository_path)?;

        // Merge metadata + body into a single git show call.
        // %x1e separates the structured metadata from the body text.
        let pretty_format =
            "--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e%b".to_string();
        let combined_output = self.run_git(
            &context.repo_root,
            &[
                "show",
                "--no-patch",
                "--date=iso-strict",
                "--decorate=short",
                &pretty_format,
                &commit_id,
            ],
            "GIT_COMMIT_DETAIL_FAILED",
        )?;

        let (meta_part, body_part) = combined_output
            .split_once(LOG_RECORD_SEP)
            .unwrap_or((&combined_output, ""));
        let body = body_part.trim_end().to_string();

        let meta_fields = meta_part
            .trim()
            .split(LOG_FIELD_SEP)
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if meta_fields.len() < 8 {
            return Err(AbstractionError::Internal {
                message: "GIT_COMMIT_DETAIL_FAILED: failed to parse commit metadata".to_string(),
            });
        }

        let files_output = self.run_git(
            &context.repo_root,
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
                    let Some(workspace_path) =
                        Self::repo_relative_to_workspace_path(&context, &path)
                    else {
                        continue;
                    };
                    let workspace_previous_path = if previous_path.is_empty() {
                        None
                    } else {
                        Self::repo_relative_to_workspace_path(&context, &previous_path)
                    };
                    files.push(GitCommitFileEntry {
                        status,
                        path: workspace_path,
                        previous_path: workspace_previous_path,
                    });
                }
                _ => {
                    let path = fields[1].trim().to_string();
                    if path.is_empty() {
                        continue;
                    }
                    let Some(workspace_path) =
                        Self::repo_relative_to_workspace_path(&context, &path)
                    else {
                        continue;
                    };
                    files.push(GitCommitFileEntry {
                        status,
                        path: workspace_path,
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
        repository_path: Option<&str>,
        include_remote: bool,
    ) -> AbstractionResult<Vec<GitBranchEntry>> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
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
        let output = self.run_git(&context.repo_root, &arg_refs, "GIT_BRANCH_LIST_FAILED")?;

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
        repository_path: Option<&str>,
        target: &str,
        create: bool,
        start_point: Option<&str>,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.validate_branch_name(&context.repo_root, target)?;

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
        self.run_git(&context.repo_root, &arg_refs, "GIT_CHECKOUT_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, branch = branch))]
    pub fn create_branch(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        branch: &str,
        start_point: Option<&str>,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.validate_branch_name(&context.repo_root, branch)?;

        let mut args = vec!["branch".to_string(), branch.trim().to_string()];
        if let Some(start_point) = start_point {
            let trimmed = start_point.trim();
            if !trimmed.is_empty() {
                args.push(trimmed.to_string());
            }
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&context.repo_root, &arg_refs, "GIT_BRANCH_CREATE_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, branch = branch, force = force))]
    pub fn delete_branch(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        branch: &str,
        force: bool,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.validate_branch_name(&context.repo_root, branch)?;

        let flag = if force { "-D" } else { "-d" };
        self.run_git(
            &context.repo_root,
            &["branch", flag, branch.trim()],
            "GIT_BRANCH_DELETE_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, remote = remote, prune = prune, include_tags = include_tags))]
    pub fn fetch(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        remote: Option<&str>,
        prune: bool,
        include_tags: bool,
    ) -> AbstractionResult<GitFetchResult> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
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
        self.run_git(&context.repo_root, &arg_refs, "GIT_FETCH_FAILED")?;

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
        repository_path: Option<&str>,
        remote: Option<&str>,
        branch: Option<&str>,
        rebase: bool,
    ) -> AbstractionResult<GitPullResult> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
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
        self.run_git(&context.repo_root, &arg_refs, "GIT_PULL_FAILED")?;

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
        repository_path: Option<&str>,
        remote: Option<&str>,
        branch: Option<&str>,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> AbstractionResult<GitPushResult> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
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
        self.run_git(&context.repo_root, &arg_refs, "GIT_PUSH_FAILED")?;

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
        repository_path: Option<&str>,
        message: Option<&str>,
        include_untracked: bool,
        keep_index: bool,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
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
        self.run_git(&context.repo_root, &arg_refs, "GIT_STASH_PUSH_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, stash = ?stash))]
    pub fn stash_pop(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        stash: Option<&str>,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let mut args = vec!["stash".to_string(), "pop".to_string()];
        if let Some(stash) = stash {
            let trimmed = stash.trim();
            if !trimmed.is_empty() {
                args.push(trimmed.to_string());
            }
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&context.repo_root, &arg_refs, "GIT_STASH_POP_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, limit = limit))]
    pub fn stash_list(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        limit: usize,
    ) -> AbstractionResult<Vec<GitStashEntry>> {
        let effective_limit = limit.clamp(1, 200);
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let max_count = effective_limit.to_string();
        let output = self.run_git(
            &context.repo_root,
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

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn tag_list(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<Vec<GitTagEntry>> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let format = format!(
            "%(refname:short){fs}%(objectname){fs}%(objectname:short){fs}%(taggername){fs}%(subject){rs}",
            fs = LOG_FIELD_SEP,
            rs = LOG_RECORD_SEP,
        );
        let output = self.run_git(
            &context.repo_root,
            &["for-each-ref", "--format", &format, "refs/tags/"],
            "GIT_TAG_LIST_FAILED",
        )?;

        let records = Self::parse_structured_output(&output, 5);
        let mut entries = Vec::with_capacity(records.len());
        for fields in records {
            entries.push(GitTagEntry {
                name: fields[0].clone(),
                oid: fields[1].clone(),
                target: fields[2].clone(),
                tagger: if fields[3].is_empty() {
                    None
                } else {
                    Some(fields[3].clone())
                },
                message: if fields[4].is_empty() {
                    None
                } else {
                    Some(fields[4].clone())
                },
            });
        }
        Ok(entries)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, name = name, annotated = annotated))]
    pub fn tag_create(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        name: &str,
        target: &str,
        annotated: bool,
        message: Option<&str>,
    ) -> AbstractionResult<()> {
        if annotated && message.is_none_or(|m| m.trim().is_empty()) {
            return Err(AbstractionError::InvalidArgument {
                message: "annotated tag requires a message".into(),
            });
        }
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let mut args = vec!["tag".to_string()];
        if annotated {
            args.push("-a".to_string());
            args.push(name.to_string());
            args.push("-m".to_string());
            args.push(message.unwrap().to_string());
        } else {
            args.push(name.to_string());
        }
        args.push(target.to_string());

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&context.repo_root, &arg_refs, "GIT_TAG_CREATE_FAILED")?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, name = name))]
    pub fn tag_delete(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        name: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["tag", "-d", name],
            "GIT_TAG_DELETE_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, remote = ?remote, tag_name = tag_name))]
    pub fn tag_push(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        remote: Option<&str>,
        tag_name: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin");
        self.run_git(
            &context.repo_root,
            &["push", remote, "tag", tag_name],
            "GIT_TAG_PUSH_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, commit_oid = commit_oid))]
    pub fn cherry_pick(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        commit_oid: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["cherry-pick", commit_oid],
            "GIT_CHERRY_PICK_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, commit_oid = commit_oid))]
    pub fn revert(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        commit_oid: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["revert", "--no-edit", commit_oid],
            "GIT_REVERT_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, target = target, mode = mode))]
    pub fn reset(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        target: &str,
        mode: &str,
    ) -> AbstractionResult<()> {
        let reset_flag = match mode {
            "soft" => "--soft",
            "mixed" => "--mixed",
            "hard" => "--hard",
            _ => {
                return Err(AbstractionError::InvalidArgument {
                    message: "GIT_RESET_INVALID_MODE: mode must be soft, mixed, or hard"
                        .to_string(),
                });
            }
        };
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["reset", reset_flag, target],
            "GIT_RESET_FAILED",
        )?;
        Ok(())
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, target = target, no_ff = no_ff))]
    pub fn merge(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        target: &str,
        no_ff: bool,
    ) -> AbstractionResult<MergeResult> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let mut args = vec!["merge".to_string(), "--no-edit".to_string()];
        if no_ff {
            args.push("--no-ff".to_string());
        }
        args.push(target.to_string());

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        match self.run_git(&context.repo_root, &arg_refs, "GIT_MERGE_FAILED") {
            Ok(_) => {
                let head = self.run_git(
                    &context.repo_root,
                    &["rev-parse", "HEAD"],
                    "GIT_MERGE_FAILED",
                )?;
                let head_sha = head.trim().to_string();
                Ok(MergeResult {
                    success: true,
                    conflicts: vec![],
                    merged_commit: Some(head_sha),
                })
            }
            Err(e) => {
                // Check if the failure is due to a merge conflict by looking for MERGE_HEAD
                if context.repo_root.join(".git").join("MERGE_HEAD").exists() {
                    let conflicts =
                        self.conflict_list(workspace_id, Some(context.repository_path.as_str()))?;
                    Ok(MergeResult {
                        success: false,
                        conflicts,
                        merged_commit: None,
                    })
                } else {
                    Err(e)
                }
            }
        }
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn conflict_list(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<Vec<ConflictFile>> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let output = self.run_git(
            &context.repo_root,
            &["status", "--porcelain"],
            "GIT_CONFLICT_LIST_FAILED",
        )?;

        let conflicts: Vec<ConflictFile> = output
            .lines()
            .filter_map(|line| Self::parse_conflict_file(&context, line))
            .collect();

        Ok(conflicts)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path, side = side))]
    pub fn resolve_conflict(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        side: &str,
    ) -> AbstractionResult<Vec<ConflictFile>> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        if !context.repo_root.join(".git").join("MERGE_HEAD").exists() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_MERGE_NOT_IN_PROGRESS: no merge is in progress".to_string(),
            });
        }

        let normalized_path = self
            .normalize_workspace_paths_for_repo(&context, &[path.to_string()])?
            .into_iter()
            .next()
            .unwrap_or_default();
        let conflicts = self.conflict_list(workspace_id, Some(context.repository_path.as_str()))?;
        let conflict = conflicts
            .iter()
            .find(|conflict| {
                self.normalize_workspace_paths_for_repo(
                    &context,
                    std::slice::from_ref(&conflict.path),
                )
                .map(|paths| {
                    paths
                        .into_iter()
                        .any(|candidate| candidate == normalized_path)
                })
                .unwrap_or(false)
            })
            .ok_or_else(|| AbstractionError::InvalidArgument {
                message: format!("GIT_CONFLICT_NOT_FOUND: path '{path}' is not conflicted"),
            })?;

        let accept_ours = match side {
            "ours" => true,
            "theirs" => false,
            _ => {
                return Err(AbstractionError::InvalidArgument {
                    message: "GIT_CONFLICT_SIDE_INVALID: side must be ours or theirs".to_string(),
                });
            }
        };
        let selected_side_is_deleted = matches!(
            (&conflict.status, accept_ours),
            (ConflictStatus::DeletedByUs, true)
                | (ConflictStatus::DeletedByThem, false)
                | (ConflictStatus::AddedByThem, true)
                | (ConflictStatus::AddedByUs, false)
                | (ConflictStatus::BothDeleted, _)
        );

        if selected_side_is_deleted {
            self.run_git(
                &context.repo_root,
                &["rm", "-f", "--ignore-unmatch", "--", &normalized_path],
                "GIT_CONFLICT_RESOLVE_FAILED",
            )?;
        } else {
            let checkout_side = if accept_ours { "--ours" } else { "--theirs" };
            self.run_git(
                &context.repo_root,
                &["checkout", checkout_side, "--", &normalized_path],
                "GIT_CONFLICT_RESOLVE_FAILED",
            )?;
            self.run_git(
                &context.repo_root,
                &["add", "--", &normalized_path],
                "GIT_CONFLICT_RESOLVE_FAILED",
            )?;
        }

        self.conflict_list(workspace_id, Some(context.repository_path.as_str()))
    }

    pub fn merge_state(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<MergeState> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        let in_progress = context.repo_root.join(".git").join("MERGE_HEAD").exists();
        let conflicts = if in_progress {
            self.conflict_list(workspace_id, Some(context.repository_path.as_str()))?
        } else {
            Vec::new()
        };

        Ok(MergeState {
            in_progress,
            conflicts,
        })
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn merge_continue(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<String> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        if !context.repo_root.join(".git").join("MERGE_HEAD").exists() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_MERGE_NOT_IN_PROGRESS: no merge is in progress".to_string(),
            });
        }

        let conflicts = self.conflict_list(workspace_id, Some(context.repository_path.as_str()))?;
        if !conflicts.is_empty() {
            return Err(AbstractionError::InvalidArgument {
                message: "GIT_MERGE_CONFLICTS_REMAIN: resolve all conflicts before continuing"
                    .to_string(),
            });
        }

        self.run_git(
            &context.repo_root,
            &["commit", "--no-edit"],
            "GIT_MERGE_CONTINUE_FAILED",
        )?;

        let head = self.resolve_head_oid(&context.repo_root)?;
        Ok(head)
    }

    #[instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn merge_abort(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;
        self.run_git(
            &context.repo_root,
            &["merge", "--abort"],
            "GIT_MERGE_ABORT_FAILED",
        )?;
        Ok(())
    }

    fn parse_conflict_file(context: &GitRepoContext, line: &str) -> Option<ConflictFile> {
        if line.len() < 4 {
            return None;
        }

        let status = line.get(0..2)?.trim();
        let conflict_status = match status {
            "UU" => ConflictStatus::BothModified,
            "DU" => ConflictStatus::DeletedByUs,
            "UD" => ConflictStatus::DeletedByThem,
            "AU" => ConflictStatus::AddedByUs,
            "UA" => ConflictStatus::AddedByThem,
            "AA" => ConflictStatus::BothAdded,
            "DD" => ConflictStatus::BothDeleted,
            _ => return None,
        };

        let raw_path = line.get(3..)?.trim();
        let path = if let Some((_, new_name)) = raw_path.split_once(" -> ") {
            new_name.trim()
        } else {
            raw_path
        };
        if path.is_empty() {
            return None;
        }

        let workspace_path = Self::repo_relative_to_workspace_path(context, path)?;
        Some(ConflictFile {
            path: workspace_path,
            status: conflict_status,
        })
    }

    #[instrument(skip(self, patch), fields(workspace_id = %workspace_id, path = path))]
    pub fn stage_hunk(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        patch: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;

        let patch_path = context.repo_root.join(".git").join("gto-patch.tmp");
        std::fs::write(&patch_path, patch).map_err(|e| AbstractionError::Internal {
            message: format!("GIT_STAGE_HUNK_FAILED: {e}"),
        })?;

        let result = self.run_git(
            &context.repo_root,
            &["apply", "--cached", patch_path.to_str().unwrap()],
            "GIT_STAGE_HUNK_FAILED",
        );

        let _ = std::fs::remove_file(&patch_path);
        result?;
        Ok(())
    }

    #[instrument(skip(self, patch), fields(workspace_id = %workspace_id, path = path))]
    pub fn unstage_hunk(
        &self,
        workspace_id: &WorkspaceId,
        repository_path: Option<&str>,
        path: &str,
        patch: &str,
    ) -> AbstractionResult<()> {
        let context = self.resolve_repo_context(workspace_id, repository_path)?;

        let patch_path = context.repo_root.join(".git").join("gto-patch.tmp");
        std::fs::write(&patch_path, patch).map_err(|e| AbstractionError::Internal {
            message: format!("GIT_UNSTAGE_HUNK_FAILED: {e}"),
        })?;

        let result = self.run_git(
            &context.repo_root,
            &[
                "apply",
                "--cached",
                "--reverse",
                patch_path.to_str().unwrap(),
            ],
            "GIT_UNSTAGE_HUNK_FAILED",
        );

        let _ = std::fs::remove_file(&patch_path);
        result?;
        Ok(())
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

fn build_git_command_path() -> Option<OsString> {
    let current_path = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut paths = Vec::with_capacity(current_path.len() + 8);

    for dir in common_binary_dirs() {
        if !paths.iter().any(|existing| existing == &dir) {
            paths.push(dir);
        }
    }

    for dir in current_path {
        if !paths.iter().any(|existing| existing == &dir) {
            paths.push(dir);
        }
    }

    env::join_paths(paths).ok()
}

fn common_binary_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = env::var_os("HOME").map(PathBuf::from);

    if let Some(home) = home.as_ref() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".npm-global").join("bin"));
        dirs.push(home.join(".yarn").join("bin"));
        dirs.push(home.join(".volta").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".asdf").join("shims"));
        dirs.push(home.join(".fnm").join("current").join("bin"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(localappdata) = env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(localappdata).join("Programs").join("nodejs"));
        }
        if let Some(programfiles) = env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(programfiles).join("nodejs"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
        dirs.push(PathBuf::from("/bin"));
    }

    dirs
}

#[cfg(test)]
mod tests {
    use super::{
        module_name, ConflictStatus, GitDiffHunk, GitDiffLine, GitDiffMode, GitRepoContext,
        GitService, GitSnapshotContent, GIT_STATUS_TARGET_BUDGET_MS, MAX_STATUS_FILES,
    };
    use git2::{Repository, Status};
    use gt_abstractions::{
        AbstractionError, AbstractionResult, TerminalCwdMode, WorkspaceContext, WorkspaceId,
        WorkspacePermissions, WorkspaceService, WorkspaceSessionSnapshot, WorkspaceSummary,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::Mutex,
        time::Instant,
    };
    use uuid::Uuid;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

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

    fn run_git_output(root: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("git command should start");
        assert!(
            output.status.success(),
            "git {:?} failed with {output:?}",
            args
        );
        String::from_utf8(output.stdout).expect("git output should be utf8")
    }

    #[cfg(unix)]
    fn make_test_service_with_git_path(
        root: PathBuf,
        git_bin_dir: &Path,
    ) -> GitService<TestWorkspaceService> {
        let mut service = GitService::new(TestWorkspaceService { root });
        service.git_path = Some(git_bin_dir.as_os_str().to_os_string());
        service
    }

    fn create_temp_repo() -> (WorkspaceId, PathBuf, GitService<TestWorkspaceService>) {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp repo dir should be created");

        run_git(&root, &["init", "-b", "main"]);
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

    fn init_repo(root: &Path) {
        run_git(root, &["init", "-b", "main"]);
        run_git(root, &["config", "user.name", "GT Office Test"]);
        run_git(root, &["config", "user.email", "test@example.com"]);
    }

    fn create_nested_repo(parent: &Path, relative_path: &str, tracked_file_name: &str) -> PathBuf {
        let repo_root = parent.join(relative_path);
        fs::create_dir_all(&repo_root).expect("nested repo dir should be created");
        init_repo(&repo_root);
        fs::write(repo_root.join(tracked_file_name), "nested base\n")
            .expect("nested tracked file should be written");
        run_git(&repo_root, &["add", tracked_file_name]);
        run_git(&repo_root, &["commit", "-m", "init nested"]);
        repo_root
    }

    fn test_repo_context(
        workspace_root: &Path,
        repo_root: &Path,
        repository_path: &str,
    ) -> GitRepoContext {
        GitRepoContext {
            workspace_root: workspace_root.to_path_buf(),
            repo_root: repo_root.to_path_buf(),
            workspace_relative_prefix: None,
            repository_path: repository_path.to_string(),
        }
    }

    fn test_parent_repo_context(
        workspace_root: &Path,
        repo_root: &Path,
        workspace_relative_prefix: &str,
    ) -> GitRepoContext {
        GitRepoContext {
            workspace_root: workspace_root.to_path_buf(),
            repo_root: repo_root.to_path_buf(),
            workspace_relative_prefix: Some(workspace_relative_prefix.to_string()),
            repository_path: String::new(),
        }
    }

    #[test]
    fn parse_porcelain_status_tracks_branch_ahead_behind_and_renames() {
        let workspace_root = PathBuf::from("/workspace");
        let repo_root = workspace_root.join("packages/app");
        let context = test_repo_context(&workspace_root, &repo_root, "packages/app");
        let summary = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## feature...origin/feature [ahead 2, behind 1]\nM  staged.txt\n D removed.txt\nR  old.txt -> renamed.txt\n?? new.txt\n",
            &context,
        );

        assert_eq!(summary.branch, "feature");
        assert_eq!(summary.ahead, 2);
        assert_eq!(summary.behind, 1);
        assert_eq!(summary.files.len(), 4);
        assert_eq!(summary.files[0].path, "packages/app/staged.txt");
        assert!(summary.files[0].staged);
        assert_eq!(summary.files[1].status, "D");
        assert_eq!(summary.files[2].path, "packages/app/renamed.txt");
        assert_eq!(summary.files[3].status, "??");
    }

    #[test]
    fn parse_porcelain_status_defaults_head_when_branch_header_missing() {
        let workspace_root = PathBuf::from("/workspace");
        let context = test_repo_context(&workspace_root, &workspace_root, "");
        let summary =
            GitService::<TestWorkspaceService>::parse_porcelain_status("?? loose.txt\n", &context);
        assert_eq!(summary.branch, "HEAD");
        assert_eq!(summary.files[0].path, "loose.txt");
    }

    #[test]
    fn resolve_status_string_maps_common_git2_statuses() {
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(
                Status::INDEX_NEW | Status::WT_MODIFIED
            ),
            "AM"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(Status::WT_NEW),
            "?"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(Status::CONFLICTED),
            "UU"
        );
    }

    #[test]
    fn parse_structured_output_drops_short_records() {
        let rows = GitService::<TestWorkspaceService>::parse_structured_output(
            "\u{1e}a\u{1f}b\u{1e}one\u{1f}two\u{1f}three\u{1e}\u{1e}x\u{1f}y\u{1e}",
            3,
        );
        assert_eq!(
            rows,
            vec![vec![
                "one".to_string(),
                "two".to_string(),
                "three".to_string()
            ]]
        );
    }

    #[test]
    fn build_new_file_patch_helpers_cover_text_binary_and_newline_edges() {
        let no_newline_patch =
            GitService::<TestWorkspaceService>::build_new_file_text_patch("notes.txt", "a\nb");
        assert!(no_newline_patch.contains("@@ -0,0 +1,2 @@"));
        assert!(no_newline_patch.contains("+a\n+b\n"));
        assert!(no_newline_patch.contains("\\ No newline at end of file"));

        let empty_patch =
            GitService::<TestWorkspaceService>::build_new_file_text_patch("empty.txt", "");
        assert!(!empty_patch.contains("@@"));

        let binary_patch =
            GitService::<TestWorkspaceService>::build_new_file_binary_patch("image.bin");
        assert!(binary_patch.contains("Binary files /dev/null and b/image.bin differ"));
    }

    #[test]
    fn decode_bytes_snapshot_distinguishes_text_and_binary() {
        let text_snapshot =
            GitService::<TestWorkspaceService>::decode_bytes_snapshot(b"plain text\n")
                .expect("text snapshot");
        assert!(matches!(
            text_snapshot,
            GitSnapshotContent::Text(ref content) if content == "plain text\n"
        ));

        let binary_snapshot =
            GitService::<TestWorkspaceService>::decode_bytes_snapshot(&[0xff, 0x00, 0x41])
                .expect("binary snapshot");
        assert!(matches!(binary_snapshot, GitSnapshotContent::Binary));
    }

    #[test]
    fn validate_commit_id_rejects_invalid_values() {
        let valid = GitService::<TestWorkspaceService>::validate_commit_id(" 0123abc ");
        assert_eq!(valid.expect("valid commit"), "0123abc");

        let empty = GitService::<TestWorkspaceService>::validate_commit_id("   ")
            .expect_err("empty commit should fail");
        assert!(empty.to_string().contains("GIT_COMMIT_INVALID"));

        let malformed = GitService::<TestWorkspaceService>::validate_commit_id("not-a-sha")
            .expect_err("malformed commit should fail");
        assert!(malformed.to_string().contains("GIT_COMMIT_INVALID"));
    }

    #[test]
    fn validate_branch_name_rejects_empty_and_invalid_refs() {
        let (_, root, service) = create_temp_repo();

        let empty = service
            .validate_branch_name(&root, "   ")
            .expect_err("empty branch should fail");
        assert!(empty.to_string().contains("GIT_BRANCH_INVALID"));

        let invalid = service
            .validate_branch_name(&root, "bad branch name")
            .expect_err("invalid branch should fail");
        assert!(invalid.to_string().contains("GIT_BRANCH_INVALID"));

        service
            .validate_branch_name(&root, "feature/test")
            .expect("valid branch name");
    }

    #[test]
    fn filter_ignored_paths_excludes_gitignored_entries() {
        let (_, root, service) = create_temp_repo();
        fs::write(root.join(".gitignore"), "ignored.log\n").expect("write gitignore");
        fs::write(root.join("ignored.log"), "ignored\n").expect("write ignored file");
        fs::write(root.join("kept.txt"), "kept\n").expect("write kept file");

        let filtered = service
            .filter_ignored_paths(
                &root,
                &[
                    "ignored.log".to_string(),
                    "kept.txt".to_string(),
                    "missing.txt".to_string(),
                ],
            )
            .expect("filter ignored paths");

        assert_eq!(
            filtered,
            vec!["kept.txt".to_string(), "missing.txt".to_string()]
        );
    }

    #[test]
    fn module_name_matches_crate_name() {
        assert_eq!(module_name(), "gt-git");
        assert_eq!(GitDiffMode::from_staged(true), GitDiffMode::Staged);
        assert_eq!(GitDiffMode::from_staged(false), GitDiffMode::Unstaged);
    }

    #[test]
    fn parse_hunk_header_handles_invalid_and_single_line_formats() {
        assert_eq!(
            GitService::<TestWorkspaceService>::parse_hunk_header("@@ -4 +9 @@"),
            Some(((4, 1), (9, 1)))
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::parse_hunk_header("not a hunk"),
            None
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::parse_hunk_header("@@"),
            None
        );
    }

    #[test]
    fn compute_word_diff_handles_equal_and_long_lines() {
        let (old_equal, new_equal) =
            GitService::<TestWorkspaceService>::compute_word_diff("same words", "same words");
        assert!(old_equal.iter().all(|segment| segment.kind == "equal"));
        assert!(new_equal.iter().all(|segment| segment.kind == "equal"));

        let long_old = "a".repeat(5000);
        let long_new = "b".repeat(5000);
        let (old_long, new_long) =
            GitService::<TestWorkspaceService>::compute_word_diff(&long_old, &long_new);
        assert_eq!(old_long[0].kind, "delete");
        assert_eq!(old_long[0].value, long_old);
        assert_eq!(new_long[0].kind, "insert");
        assert_eq!(new_long[0].value, long_new);
    }

    #[test]
    fn parse_diff_patch_handles_rename_and_context_lines() {
        let (_, _root, service) = create_temp_repo();
        let patch = "\
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
@@ -1,2 +1,2 @@
-before
 unchanged
+after
";

        let parsed = service.parse_diff_patch(patch, "new.txt");
        assert_eq!(parsed.old_path.as_deref(), Some("old.txt"));
        assert_eq!(parsed.path, "new.txt");
        assert_eq!(parsed.hunks.len(), 1);
        assert_eq!(parsed.hunks[0].lines[0].kind, "del");
        assert_eq!(parsed.hunks[0].lines[1].kind, "ctx");
        assert_eq!(parsed.hunks[0].lines[2].kind, "add");
    }

    #[cfg(unix)]
    #[test]
    fn diff_file_structured_falls_back_to_system_git_patch_parser() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root =
            std::env::temp_dir().join(format!("gt-git-structured-fallback-{}", Uuid::new_v4()));
        let repo_root = root.join("badrepo");
        fs::create_dir_all(repo_root.join(".git")).expect("create malformed repo marker");
        fs::write(repo_root.join("file.txt"), "new\n").expect("create fallback diff file");

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\n\
case \"$*\" in\n\
  *\"ls-files --others\"*) exit 0 ;;\n\
  *\"diff --no-ext-diff -- file.txt\"*)\n\
    printf 'diff --git a/file.txt b/file.txt\\n@@ -1 +1 @@\\n-old\\n+new\\n'\n\
    ;;\n\
  *) exit 0 ;;\n\
esac\n",
        )
        .expect("write diff fallback fake git");
        make_executable(&fake_git);

        let service = make_test_service_with_git_path(root.clone(), &fake_bin);
        let diff = service
            .diff_file_structured(&workspace_id, Some("badrepo"), "badrepo/file.txt", false)
            .expect("structured diff should fall back to system git");
        assert_eq!(diff.path, "badrepo/file.txt");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);
        assert_eq!(diff.hunks.len(), 1);
    }

    #[test]
    fn path_to_workspace_relative_and_repo_context_validate_boundaries() {
        let workspace_root = std::env::temp_dir().join(format!("gt-git-ws-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        let nested_repo = create_nested_repo(&workspace_root, "packages/app", "tracked.txt");
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));

        let relative = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &nested_repo,
            &workspace_root,
        )
        .expect("nested repo should be relative");
        assert_eq!(relative, "packages/app");

        let context = service
            .resolve_repo_context(&workspace_id, Some("packages/app"))
            .expect("resolve nested repo context");
        assert_eq!(context.repository_path, "packages/app");
        assert_eq!(context.repo_root, nested_repo);

        let absolute_error = service
            .resolve_repo_context(&workspace_id, Some("/tmp"))
            .expect_err("absolute repository path should fail");
        assert!(absolute_error
            .to_string()
            .contains("GIT_REPOSITORY_PATH_INVALID"));

        let missing_error = service
            .resolve_repo_context(&workspace_id, Some("packages/missing"))
            .expect_err("missing repository path should fail");
        assert!(missing_error
            .to_string()
            .contains("GIT_REPOSITORY_PATH_INVALID"));
    }

    #[test]
    fn resolve_repo_context_rejects_missing_workspace_root_and_bare_repo() {
        let missing_root = std::env::temp_dir().join(format!("gt-git-missing-{}", Uuid::new_v4()));
        let missing_service = GitService::new(TestWorkspaceService {
            root: missing_root.clone(),
        });
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let missing_error = missing_service
            .resolve_repo_context(&workspace_id, None)
            .expect_err("missing workspace root should fail");
        assert!(missing_error
            .to_string()
            .contains("GIT_WORKSPACE_ROOT_INVALID"));

        let bare_root = std::env::temp_dir().join(format!("gt-git-bare-{}", Uuid::new_v4()));
        fs::create_dir_all(&bare_root).expect("create bare root");
        run_git(&bare_root, &["init", "--bare"]);
        let bare_service = GitService::new(TestWorkspaceService { root: bare_root });
        let bare_error = bare_service
            .resolve_repo_context(&workspace_id, None)
            .expect_err("bare repository should fail");
        assert!(bare_error.to_string().contains("bare repositories"));
    }

    #[test]
    fn workspace_root_and_repo_context_reject_invalid_workspace_relative_targets() {
        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-invalid-targets-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));

        let file_path = workspace_root.join("plain.txt");
        fs::write(&file_path, "not a repo").expect("write plain file");
        let dir_without_git = workspace_root.join("scratch");
        fs::create_dir_all(&dir_without_git).expect("create non-git dir");

        let file_error = service
            .resolve_repo_context(&workspace_id, Some("plain.txt"))
            .expect_err("file path should fail");
        assert!(file_error
            .to_string()
            .contains("repository root does not exist"));

        let non_git_dir_error = service
            .resolve_repo_context(&workspace_id, Some("scratch"))
            .expect_err("plain dir should fail");
        assert!(non_git_dir_error.to_string().contains("no git repository"));

        let escape_error = service
            .resolve_repo_context(&workspace_id, Some("../escape"))
            .expect_err("parent traversal should fail");
        assert!(escape_error
            .to_string()
            .contains("repository path escapes workspace"));
    }

    #[test]
    fn path_to_workspace_relative_handles_missing_and_outside_paths() {
        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-path-root-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        let inside = workspace_root.join("dir/file.txt");
        fs::create_dir_all(inside.parent().expect("inside parent")).expect("create inside parent");
        fs::write(&inside, "inside").expect("write inside file");

        let relative = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &inside,
            &workspace_root,
        )
        .expect("inside path should be relative");
        assert_eq!(relative, "dir/file.txt");

        let outside = std::env::temp_dir().join(format!("gt-git-path-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&outside).expect("create outside dir");
        let outside_error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &outside,
            &workspace_root,
        )
        .expect_err("outside path should fail");
        assert!(outside_error.to_string().contains("outside workspace"));

        let missing_path =
            std::env::temp_dir().join(format!("gt-git-missing-outside-{}", Uuid::new_v4()));
        let missing_error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &missing_path,
            &workspace_root,
        )
        .expect_err("missing path should fail");
        assert!(missing_error.to_string().contains("outside workspace"));
    }

    #[test]
    fn resolve_head_oid_rejects_unborn_head() {
        let root = std::env::temp_dir().join(format!("gt-git-unborn-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        init_repo(&root);
        let service = GitService::new(TestWorkspaceService { root: root.clone() });

        let error = service
            .resolve_head_oid(&root)
            .expect_err("unborn head should fail");
        assert!(error.to_string().contains("GIT_REV_PARSE_FAILED"));
    }

    #[test]
    fn init_repo_existing_repository_returns_current_branch_name() {
        let (workspace_id, root, service) = create_temp_repo();

        let branch = service
            .init_repo(&workspace_id, None, Some("other"))
            .expect("existing repo init should succeed");
        assert_eq!(branch, "main");
        assert_eq!(
            service
                .run_git(&root, &["branch", "--show-current"], "GIT_TEST_FAILED")
                .expect("read current branch")
                .trim(),
            "main"
        );
    }

    #[test]
    fn join_workspace_relative_path_and_validate_relative_repo_path_cover_edges() {
        assert_eq!(
            GitService::<TestWorkspaceService>::join_workspace_relative_path(
                "packages/app",
                "src/lib.rs"
            ),
            "packages/app/src/lib.rs"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::join_workspace_relative_path("", "src/lib.rs"),
            "src/lib.rs"
        );

        let empty_error = GitService::<TestWorkspaceService>::validate_relative_repo_path("   ")
            .expect_err("empty path should fail");
        assert!(empty_error.to_string().contains("path cannot be empty"));

        let absolute_error =
            GitService::<TestWorkspaceService>::validate_relative_repo_path("/tmp/example")
                .expect_err("absolute path should fail");
        assert!(absolute_error
            .to_string()
            .contains("absolute path is not allowed"));
    }

    #[test]
    fn parse_porcelain_status_handles_plain_branch_detached_head_and_short_lines() {
        let workspace_root = PathBuf::from("/workspace");
        let app_root = workspace_root.join("packages/app");
        let app_context = test_repo_context(&workspace_root, &app_root, "packages/app");
        let root_context = test_repo_context(&workspace_root, &workspace_root, "");
        let plain = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## feature/test\n?? scratch.txt\n",
            &app_context,
        );
        assert_eq!(plain.branch, "feature/test");
        assert_eq!(plain.files.len(), 1);
        assert_eq!(plain.files[0].path, "packages/app/scratch.txt");

        let detached = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## HEAD (no branch)\nXY\nR  old.txt -> renamed.txt\n",
            &root_context,
        );
        assert_eq!(detached.branch, "HEAD (no branch)");
        assert_eq!(detached.files.len(), 1);
        assert_eq!(detached.files[0].path, "renamed.txt");

        let tracking = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## main...origin/main [ahead nope, behind nope]\n M tracked.txt\n",
            &root_context,
        );
        assert_eq!(tracking.branch, "main");
        assert_eq!(tracking.ahead, 0);
        assert_eq!(tracking.behind, 0);
    }

    #[test]
    fn resolve_status_string_covers_deleted_renamed_and_typechange_variants() {
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::INDEX_DELETED),
            "D"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::INDEX_RENAMED),
            "R"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(
                git2::Status::INDEX_TYPECHANGE
            ),
            "T"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::WT_DELETED),
            "D"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::WT_RENAMED),
            "R"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::WT_TYPECHANGE),
            "T"
        );
    }

    #[test]
    fn run_git_and_untracked_patch_helpers_cover_failure_and_binary_paths() {
        let non_repo_root =
            std::env::temp_dir().join(format!("gt-git-non-repo-{}", Uuid::new_v4()));
        fs::create_dir_all(&non_repo_root).expect("create non-repo dir");
        let service = GitService::new(TestWorkspaceService {
            root: non_repo_root.clone(),
        });

        let non_repo_error = service
            .run_git(&non_repo_root, &["status"], "GIT_TEST_FAILED")
            .expect_err("non repo command should fail");
        assert!(non_repo_error.to_string().contains("GIT_REPO_INVALID"));

        let (_, repo_root, repo_service) = create_temp_repo();
        let command_error = repo_service
            .run_git(&repo_root, &["definitely-not-a-command"], "GIT_TEST_FAILED")
            .expect_err("invalid git subcommand should fail");
        assert!(command_error.to_string().contains("GIT_TEST_FAILED"));

        fs::write(repo_root.join("binary.dat"), vec![0_u8, 159, 146, 150]).expect("write binary");
        let binary_patch = repo_service
            .build_untracked_worktree_patch(&repo_root, "binary.dat")
            .expect("binary patch helper");
        assert!(binary_patch
            .expect("binary patch should exist")
            .contains("Binary files /dev/null and b/binary.dat differ"));

        let missing_patch = repo_service
            .build_untracked_worktree_patch(&repo_root, "missing.txt")
            .expect("missing patch helper");
        assert!(missing_patch.is_none());

        #[cfg(unix)]
        {
            let fake_root =
                std::env::temp_dir().join(format!("gt-git-vanished-untracked-{}", Uuid::new_v4()));
            fs::create_dir_all(&fake_root).expect("create vanished untracked root");
            let fake_bin = fake_root.join("fake-bin");
            fs::create_dir_all(&fake_bin).expect("create fake bin");
            let fake_git = fake_bin.join("git");
            fs::write(
                &fake_git,
                "#!/bin/sh\n\
case \"$*\" in\n\
  *\"ls-files\"*) printf 'vanished.txt\\0' ;;\n\
  *) exit 0 ;;\n\
esac\n",
            )
            .expect("write vanished untracked fake git");
            make_executable(&fake_git);
            let fake_service = make_test_service_with_git_path(fake_root.clone(), &fake_bin);
            let vanished_patch = fake_service
                .build_untracked_worktree_patch(&fake_root, "vanished.txt")
                .expect("vanished untracked patch helper");
            assert!(vanished_patch.is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_git_covers_spawn_failure_not_repo_and_lossy_stdout() {
        let root = std::env::temp_dir().join(format!("gt-git-fake-run-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fake run root");

        let missing_bin = root.join("missing-bin");
        fs::create_dir_all(&missing_bin).expect("create missing bin");
        let missing_service = make_test_service_with_git_path(root.clone(), &missing_bin);
        let spawn_error = missing_service
            .run_git(&root, &["status"], "GIT_TEST_FAILED")
            .expect_err("missing git should fail");
        assert!(spawn_error.to_string().contains("failed to run git"));

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");

        let not_repo_script = fake_bin.join("git");
        fs::write(
            &not_repo_script,
            "#!/bin/sh\nprintf 'not a git repository\\n' >&2\nexit 1\n",
        )
        .expect("write not repo script");
        make_executable(&not_repo_script);
        let not_repo_service = make_test_service_with_git_path(root.clone(), &fake_bin);
        let not_repo_error = not_repo_service
            .run_git(&root, &["status"], "GIT_TEST_FAILED")
            .expect_err("not repo script should fail");
        assert!(not_repo_error.to_string().contains("GIT_REPO_INVALID"));

        fs::write(&not_repo_script, "#!/bin/sh\nprintf '\\377'\nexit 0\n")
            .expect("rewrite lossy stdout script");
        make_executable(&not_repo_script);
        let lossy_service = make_test_service_with_git_path(root.clone(), &fake_bin);
        let lossy_output = lossy_service
            .run_git(&root, &["status"], "GIT_TEST_FAILED")
            .expect("lossy stdout should succeed");
        assert_eq!(lossy_output, "\u{FFFD}");
    }

    #[cfg(unix)]
    #[test]
    fn filter_ignored_paths_covers_spawn_and_nonzero_failure_shapes() {
        let root = std::env::temp_dir().join(format!("gt-git-fake-ignore-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fake ignore root");

        let missing_bin = root.join("missing-bin");
        fs::create_dir_all(&missing_bin).expect("create missing bin");
        let missing_service = make_test_service_with_git_path(root.clone(), &missing_bin);
        let spawn_error = missing_service
            .filter_ignored_paths(&root, &[String::from("a.txt")])
            .expect_err("missing git check-ignore should fail");
        assert!(spawn_error
            .to_string()
            .contains("failed to run git check-ignore"));

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\nprintf 'check-ignore boom\\n' >&2\nexit 2\n",
        )
        .expect("write failing check-ignore script");
        make_executable(&fake_git);
        let failing_service = make_test_service_with_git_path(root.clone(), &fake_bin);
        let failure = failing_service
            .filter_ignored_paths(&root, &[String::from("a.txt")])
            .expect_err("nonzero check-ignore should fail");
        assert!(failure
            .to_string()
            .contains("git check-ignore failed: check-ignore boom"));
    }

    #[test]
    fn status_repo_uses_system_git_fallback_for_unborn_branch_name() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-unborn-status-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create unborn repo root");
        run_git(&root, &["init", "-b", "main"]);
        run_git(&root, &["config", "user.name", "GT Office Test"]);
        run_git(&root, &["config", "user.email", "test@example.com"]);
        let service = GitService::new(TestWorkspaceService { root });

        let summary = service
            .status_repo(&workspace_id, None)
            .expect("status should succeed for unborn repo");
        assert_eq!(summary.branch, "main");
    }

    #[test]
    fn status_with_git2_reports_ahead_behind_and_workspace_prefixed_paths() {
        let temp_root = std::env::temp_dir().join(format!("gt-git-status-git2-{}", Uuid::new_v4()));
        let remote_root =
            std::env::temp_dir().join(format!("gt-git-status-remote-{}", Uuid::new_v4()));
        let other_root =
            std::env::temp_dir().join(format!("gt-git-status-other-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).expect("create local repo root");
        fs::create_dir_all(&remote_root).expect("create remote repo root");

        run_git(&remote_root, &["init", "--bare"]);
        init_repo(&temp_root);
        run_git(&temp_root, &["branch", "-M", "main"]);
        run_git(
            &temp_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_str().expect("remote str"),
            ],
        );
        fs::write(temp_root.join("tracked.txt"), "base\n").expect("write initial tracked");
        run_git(&temp_root, &["add", "tracked.txt"]);
        run_git(&temp_root, &["commit", "-m", "init"]);
        run_git(&temp_root, &["push", "-u", "origin", "main"]);
        run_git(&remote_root, &["symbolic-ref", "HEAD", "refs/heads/main"]);

        run_git(
            &std::env::temp_dir(),
            &[
                "clone",
                remote_root.to_str().expect("remote str"),
                other_root.to_str().expect("other str"),
            ],
        );
        run_git(&other_root, &["config", "user.name", "GT Office Test"]);
        run_git(&other_root, &["config", "user.email", "test@example.com"]);
        fs::write(other_root.join("remote.txt"), "remote\n").expect("write remote file");
        run_git(&other_root, &["add", "remote.txt"]);
        run_git(&other_root, &["commit", "-m", "remote commit"]);
        run_git(&other_root, &["push", "origin", "main"]);

        fs::write(temp_root.join("local.txt"), "local\n").expect("write local file");
        run_git(&temp_root, &["add", "local.txt"]);
        run_git(&temp_root, &["commit", "-m", "local commit"]);
        run_git(&temp_root, &["fetch", "origin"]);

        fs::write(temp_root.join("tracked.txt"), "base\nmodified\n").expect("modify tracked");
        fs::write(temp_root.join("untracked.txt"), "scratch\n").expect("write untracked");

        let service = GitService::new(TestWorkspaceService {
            root: temp_root.clone(),
        });
        let context = test_repo_context(&temp_root, &temp_root, "packages/app");
        let summary = service
            .status_with_git2(&context)
            .expect("git2 status should succeed");

        assert_eq!(summary.branch, "main");
        assert_eq!(summary.ahead, 1);
        assert_eq!(summary.behind, 1);
        assert!(summary
            .files
            .iter()
            .any(|file| file.path == "packages/app/tracked.txt"));
        assert!(summary
            .files
            .iter()
            .any(|file| file.path == "packages/app/untracked.txt"));
    }

    #[test]
    fn status_with_git2_limits_large_file_lists() {
        let (_, root, service) = create_temp_repo();
        for index in 0..=MAX_STATUS_FILES {
            fs::write(root.join(format!("untracked-{index:04}.txt")), "scratch\n")
                .expect("write untracked status file");
        }

        let summary = service
            .status_with_git2(&test_repo_context(&root, &root, ""))
            .expect("git2 status should succeed");
        assert_eq!(summary.files.len(), MAX_STATUS_FILES);
    }

    #[test]
    fn build_full_structured_diff_covers_equal_new_and_deleted_shapes() {
        let unchanged = GitService::<TestWorkspaceService>::build_full_structured_diff(
            "same.txt", None, "same\n", "same\n", true, true,
        );
        assert_eq!(unchanged.additions, 0);
        assert_eq!(unchanged.deletions, 0);
        assert!(unchanged.hunks.is_empty());

        let created = GitService::<TestWorkspaceService>::build_full_structured_diff(
            "new.txt",
            None,
            "",
            "alpha\nbeta\n",
            false,
            true,
        );
        assert!(created.is_new);
        assert_eq!(created.hunks[0].new_start, 1);
        assert_eq!(created.hunks[0].old_start, 0);

        let deleted = GitService::<TestWorkspaceService>::build_full_structured_diff(
            "gone.txt",
            None,
            "alpha\nbeta\n",
            "",
            true,
            false,
        );
        assert!(deleted.is_deleted);
        assert_eq!(deleted.hunks[0].old_start, 1);
        assert_eq!(deleted.hunks[0].new_start, 0);
    }

    #[test]
    fn list_path_helpers_and_empty_stage_paths_cover_direct_helpers() {
        let (workspace_id, root, service) = create_temp_repo();
        fs::write(root.join("tracked.txt"), "base\nchanged\n").expect("modify tracked");
        fs::write(root.join("staged.txt"), "staged\n").expect("write staged file");
        fs::write(root.join("untracked.txt"), "untracked\n").expect("write untracked file");
        run_git(&root, &["add", "staged.txt"]);

        let tracked = service
            .list_tracked_paths(
                &root,
                &["tracked.txt".to_string(), "staged.txt".to_string()],
                "GIT_TEST_FAILED",
            )
            .expect("list tracked paths");
        assert!(tracked.contains("tracked.txt"));
        assert!(tracked.contains("staged.txt"));

        let index_new = service
            .list_index_new_paths(&root, &["staged.txt".to_string()], "GIT_TEST_FAILED")
            .expect("list index-new paths");
        assert!(index_new.contains("staged.txt"));

        let untracked = service
            .list_untracked_paths(&root, &["untracked.txt".to_string()], "GIT_TEST_FAILED")
            .expect("list untracked paths");
        assert!(untracked.contains("untracked.txt"));

        let empty: Vec<String> = Vec::new();
        assert_eq!(
            service
                .stage(&workspace_id, None, &empty)
                .expect("stage empty paths"),
            0
        );
        assert_eq!(
            service
                .unstage(&workspace_id, None, &empty)
                .expect("unstage empty paths"),
            0
        );
        assert_eq!(
            service
                .filter_ignored_paths(&root, &empty)
                .expect("filter empty paths"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn status_with_system_git_and_discovery_helpers_cover_root_and_skipped_dirs() {
        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-discovery-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        init_repo(&workspace_root);
        run_git(&workspace_root, &["branch", "-M", "main"]);

        let nested_root = create_nested_repo(&workspace_root, "packages/feature", "nested.txt");
        create_nested_repo(&workspace_root, "node_modules/ignored", "ignored.txt");
        create_nested_repo(&workspace_root, "target/ignored", "ignored.txt");

        fs::write(workspace_root.join("root.txt"), "root\n").expect("write root file");
        fs::write(nested_root.join("nested.txt"), "nested\nchanged\n").expect("modify nested file");

        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });
        let root_context = test_repo_context(&workspace_root, &workspace_root, "");
        let root_status = service
            .status_with_system_git(&root_context)
            .expect("root status");
        assert_eq!(root_status.branch, "main");
        assert!(root_status.files.iter().any(|file| file.path == "root.txt"));

        let repos = service
            .discover_workspace_repositories(&workspace_root)
            .expect("discover repositories");
        let repo_paths = repos
            .iter()
            .map(|repo| repo.repository_path.as_str())
            .collect::<Vec<_>>();
        assert!(repo_paths.contains(&""));
        assert!(repo_paths.contains(&"packages/feature"));
        assert!(!repo_paths
            .iter()
            .any(|path| path.starts_with("node_modules/")));
        assert!(!repo_paths.iter().any(|path| path.starts_with("target/")));
    }

    #[test]
    fn workspace_root_and_repo_resolution_cover_missing_and_invalid_repository_inputs() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let missing_root = std::env::temp_dir().join(format!("gt-git-missing-{}", Uuid::new_v4()));
        let missing_service = GitService::new(TestWorkspaceService {
            root: missing_root.clone(),
        });
        let missing_error = missing_service
            .workspace_root(&workspace_id)
            .expect_err("missing workspace root should fail");
        assert!(missing_error
            .to_string()
            .contains("GIT_WORKSPACE_ROOT_INVALID"));

        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-invalid-repo-paths-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });

        let non_repo_error = service
            .resolve_repo_context(&workspace_id, None)
            .expect_err("non-repo workspace should fail");
        assert!(non_repo_error.to_string().contains("GIT_REPO_INVALID"));

        let absolute_error = service
            .resolve_repo_context(&workspace_id, Some("/tmp/absolute"))
            .expect_err("absolute repository path should fail");
        assert!(absolute_error
            .to_string()
            .contains("repository path must be workspace-relative"));

        let escape_error = service
            .resolve_repo_context(&workspace_id, Some("../escape"))
            .expect_err("escaping repository path should fail");
        assert!(escape_error
            .to_string()
            .contains("repository path escapes workspace"));

        let missing_repo_error = service
            .resolve_repo_context(&workspace_id, Some("packages/missing"))
            .expect_err("missing repository dir should fail");
        assert!(missing_repo_error
            .to_string()
            .contains("repository root does not exist"));

        let plain_dir = workspace_root.join("plain");
        fs::create_dir_all(&plain_dir).expect("create plain dir");
        let no_git_error = service
            .resolve_repo_context(&workspace_id, Some("plain"))
            .expect_err("plain directory should fail");
        assert!(no_git_error.to_string().contains("no git repository"));
    }

    #[test]
    fn parse_porcelain_status_and_status_helpers_cover_remaining_error_shapes() {
        let workspace_root = PathBuf::from("/workspace");
        let root_context = test_repo_context(&workspace_root, &workspace_root, "");
        let app_context = test_repo_context(
            &workspace_root,
            &workspace_root.join("packages/app"),
            "packages/app",
        );
        let summary = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## No commits yet on feature/no-commits\nA  added.txt\n",
            &root_context,
        );
        assert_eq!(summary.branch, "feature/no-commits");
        assert_eq!(summary.files[0].status, "A");

        let tracking = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## topic...origin/topic [ahead 2, behind 3]\nR  old.txt -> new.txt\n?? \n",
            &app_context,
        );
        assert_eq!(tracking.ahead, 2);
        assert_eq!(tracking.behind, 3);
        assert_eq!(tracking.files.len(), 1);
        assert_eq!(tracking.files[0].path, "packages/app/new.txt");

        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::WT_MODIFIED),
            "M"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::INDEX_MODIFIED),
            "M"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::resolve_status_string(git2::Status::WT_NEW),
            "?"
        );
    }

    #[test]
    fn status_with_git2_and_path_conversion_cover_non_repo_and_missing_root_failures() {
        let plain_root = std::env::temp_dir().join(format!("gt-git-plain-{}", Uuid::new_v4()));
        fs::create_dir_all(&plain_root).expect("create plain root");
        let service = GitService::new(TestWorkspaceService {
            root: plain_root.clone(),
        });

        let status_error = service
            .status_with_git2(&test_repo_context(&plain_root, &plain_root, ""))
            .expect_err("git2 status should fail for non-repo");
        assert!(status_error.to_string().contains("GIT_STATUS_GIT2_FAILED"));

        let outside_path = std::env::temp_dir().join(format!("gt-git-outside-{}", Uuid::new_v4()));
        let missing_root =
            std::env::temp_dir().join(format!("gt-git-missing-root-{}", Uuid::new_v4()));
        let path_error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &outside_path,
            &missing_root,
        )
        .expect_err("missing workspace root should fail path conversion");
        assert!(path_error
            .to_string()
            .contains("repository is outside workspace"));
    }

    #[test]
    fn init_repo_status_and_path_validation_cover_additional_edge_paths() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-init-status-edge-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");

        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });

        let branch = service
            .init_repo(&workspace_id, None, Some("main"))
            .expect("init repo in plain workspace");
        assert_eq!(branch, "main");

        let missing_repo_root = workspace_root.join("missing");
        let empty_status_error = service
            .status_with_system_git(&test_repo_context(&workspace_root, &missing_repo_root, ""))
            .expect_err("missing repo status should fail");
        assert!(empty_status_error.to_string().contains("GIT_STATUS_FAILED"));

        let aggregate_status = service.status(&workspace_id).expect("aggregate status");
        assert_eq!(aggregate_status.branch, "main");
        assert_eq!(aggregate_status.repositories.len(), 1);
        assert_eq!(aggregate_status.repositories[0].repository_path, "");

        let parent_error =
            GitService::<TestWorkspaceService>::validate_relative_repo_path("../bad")
                .expect_err("parent traversal should fail");
        assert!(parent_error
            .to_string()
            .contains("parent traversal is not allowed"));
    }

    #[test]
    fn repository_and_snapshot_helpers_cover_io_and_scope_failures() {
        let workspace_root =
            std::env::temp_dir().join(format!("gt-git-helper-failures-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        init_repo(&workspace_root);

        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });

        let missing_dir = workspace_root.join("missing-dir");
        let discovery_error = service
            .collect_nested_repositories(&workspace_root, &missing_dir, &mut Vec::new(), false)
            .expect_err("missing directory should fail discovery");
        assert!(discovery_error
            .to_string()
            .contains("GIT_REPOSITORY_DISCOVERY_FAILED"));

        let repo_context = GitRepoContext {
            workspace_root: workspace_root.clone(),
            repo_root: workspace_root.clone(),
            workspace_relative_prefix: None,
            repository_path: "packages/app".to_string(),
        };
        let outside_repo_error = service
            .normalize_workspace_paths_for_repo(&repo_context, &["other/file.txt".to_string()])
            .expect_err("path outside repository should fail");
        assert!(outside_repo_error
            .to_string()
            .contains("is outside repository"));

        let dir_snapshot_error =
            GitService::<TestWorkspaceService>::read_worktree_snapshot(&workspace_root, ".")
                .err()
                .expect("reading a directory should fail");
        assert!(dir_snapshot_error
            .to_string()
            .contains("failed to read worktree file"));
    }

    #[test]
    fn status_and_discovery_cover_plain_workspace_and_non_git_repo_mapping() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let plain_root =
            std::env::temp_dir().join(format!("gt-git-plain-status-{}", Uuid::new_v4()));
        fs::create_dir_all(&plain_root).expect("create plain workspace");

        let service = GitService::new(TestWorkspaceService {
            root: plain_root.clone(),
        });

        let repos = service
            .discover_workspace_repositories(&plain_root)
            .expect("discover plain workspace repositories");
        assert!(repos.is_empty());

        let status_error = service
            .status(&workspace_id)
            .expect_err("plain workspace status should fail");
        assert!(status_error.to_string().contains("GIT_REPO_INVALID"));

        let run_git_error = service
            .run_git(&plain_root, &["status", "--porcelain"], "GIT_TEST_FAILED")
            .expect_err("run_git should map non-repo errors");
        assert!(run_git_error.to_string().contains("GIT_REPO_INVALID"));
    }

    #[test]
    fn snapshot_helpers_cover_success_binary_and_missing_variants() {
        let repo_root = std::env::temp_dir().join(format!("gt-git-snapshots-{}", Uuid::new_v4()));
        fs::create_dir_all(&repo_root).expect("create repo root");
        init_repo(&repo_root);

        fs::write(repo_root.join("tracked.txt"), "tracked text\n").expect("write tracked text");
        run_git(&repo_root, &["add", "tracked.txt"]);
        run_git(&repo_root, &["commit", "-m", "add tracked text"]);

        fs::write(repo_root.join("staged.txt"), "staged text\n").expect("write staged text");
        run_git(&repo_root, &["add", "staged.txt"]);

        fs::write(repo_root.join("binary.bin"), [0_u8, 159, 146, 150]).expect("write binary");
        run_git(&repo_root, &["add", "binary.bin"]);

        let repo = Repository::discover(&repo_root).expect("discover repo");

        let tracked_head =
            GitService::<TestWorkspaceService>::read_head_snapshot(&repo, "tracked.txt")
                .expect("read head snapshot");
        assert!(matches!(
            tracked_head,
            GitSnapshotContent::Text(ref content) if content == "tracked text\n"
        ));

        let missing_head =
            GitService::<TestWorkspaceService>::read_head_snapshot(&repo, "missing.txt")
                .expect("read missing head snapshot");
        assert!(matches!(missing_head, GitSnapshotContent::Missing));

        let staged_index =
            GitService::<TestWorkspaceService>::read_index_snapshot(&repo, "staged.txt")
                .expect("read index snapshot");
        assert!(matches!(
            staged_index,
            GitSnapshotContent::Text(ref content) if content == "staged text\n"
        ));

        let binary_index =
            GitService::<TestWorkspaceService>::read_index_snapshot(&repo, "binary.bin")
                .expect("read binary index snapshot");
        assert!(matches!(binary_index, GitSnapshotContent::Binary));

        let missing_index =
            GitService::<TestWorkspaceService>::read_index_snapshot(&repo, "absent.txt")
                .expect("read missing index snapshot");
        assert!(matches!(missing_index, GitSnapshotContent::Missing));

        fs::create_dir_all(repo_root.join("dir")).expect("create tracked dir");
        fs::write(repo_root.join("dir/file.txt"), "nested\n").expect("write nested file");
        run_git(&repo_root, &["add", "dir/file.txt"]);
        run_git(&repo_root, &["commit", "-m", "add dir"]);
        let repo_with_dir = Repository::discover(&repo_root).expect("rediscover repo with dir");
        let directory_error =
            GitService::<TestWorkspaceService>::read_head_snapshot(&repo_with_dir, "dir")
                .err()
                .expect("directory HEAD entry cannot be read as blob");
        assert!(directory_error
            .to_string()
            .contains("failed to read HEAD blob"));

        let blob_oid = repo_with_dir
            .blob(b"standalone head blob")
            .expect("write standalone blob");
        fs::write(repo_root.join(".git/HEAD"), blob_oid.to_string()).expect("point HEAD to blob");
        let blob_head_repo = Repository::discover(&repo_root).expect("rediscover blob HEAD repo");
        assert!(matches!(
            GitService::<TestWorkspaceService>::read_head_snapshot(&blob_head_repo, "tracked.txt")
                .expect("non-tree HEAD should read as missing"),
            GitSnapshotContent::Missing
        ));
    }

    #[test]
    fn resolve_head_oid_and_blob_decoding_cover_success_cases() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let repo_root = std::env::temp_dir().join(format!("gt-git-head-oid-{}", Uuid::new_v4()));
        fs::create_dir_all(&repo_root).expect("create repo root");
        init_repo(&repo_root);

        fs::write(repo_root.join("tracked.txt"), "tracked text\n").expect("write tracked text");
        run_git(&repo_root, &["add", "tracked.txt"]);
        run_git(&repo_root, &["commit", "-m", "add tracked text"]);

        let service = GitService::new(TestWorkspaceService {
            root: repo_root.clone(),
        });
        let oid = service
            .resolve_head_oid(&repo_root)
            .expect("resolve head oid");
        assert_eq!(
            oid,
            run_git_output(&repo_root, &["rev-parse", "HEAD"]).trim()
        );

        let repo = Repository::discover(&repo_root).expect("discover repo");
        let text_blob = repo
            .head()
            .expect("head")
            .peel_to_tree()
            .expect("tree")
            .get_path(Path::new("tracked.txt"))
            .expect("tracked entry")
            .to_object(&repo)
            .expect("tracked object")
            .peel_to_blob()
            .expect("tracked blob");
        let text_snapshot = GitService::<TestWorkspaceService>::decode_blob_snapshot(&text_blob)
            .expect("decode text blob");
        assert!(matches!(
            text_snapshot,
            GitSnapshotContent::Text(ref content) if content == "tracked text\n"
        ));

        fs::write(repo_root.join("binary.bin"), [0_u8, 159, 146, 150]).expect("write binary");
        run_git(&repo_root, &["add", "binary.bin"]);
        run_git(&repo_root, &["commit", "-m", "add binary"]);
        let binary_repo = Repository::discover(&repo_root).expect("rediscover repo");
        let binary_blob = binary_repo
            .head()
            .expect("head")
            .peel_to_tree()
            .expect("tree")
            .get_path(Path::new("binary.bin"))
            .expect("binary entry")
            .to_object(&binary_repo)
            .expect("binary object")
            .peel_to_blob()
            .expect("binary blob");
        let binary_snapshot =
            GitService::<TestWorkspaceService>::decode_blob_snapshot(&binary_blob)
                .expect("decode binary blob");
        assert!(matches!(binary_snapshot, GitSnapshotContent::Binary));

        let summary = service
            .status_repo(&workspace_id, None)
            .expect("status repo after commits");
        assert_eq!(summary.branch, "main");
    }

    #[test]
    fn diff_file_with_git2_covers_rename_delete_and_empty_patch_shapes() {
        let (_, root, service) = create_temp_repo();

        let unchanged = service
            .diff_file_with_git2(&root, "tracked.txt", GitDiffMode::Unstaged)
            .expect("unchanged diff should succeed");
        assert!(unchanged.hunks.is_empty());
        assert!(unchanged.patch.is_empty());
        assert!(!unchanged.is_new);
        assert!(!unchanged.is_deleted);

        run_git(&root, &["mv", "tracked.txt", "renamed.txt"]);
        fs::write(root.join("renamed.txt"), "renamed\n").expect("update renamed file");
        let renamed = service
            .diff_file_with_git2(&root, "renamed.txt", GitDiffMode::Staged)
            .expect("renamed diff should succeed");
        assert!(!renamed.hunks.is_empty());
        assert!(renamed.patch.contains("renamed.txt"));

        run_git(&root, &["commit", "-m", "rename tracked"]);
        fs::remove_file(root.join("renamed.txt")).expect("remove renamed file");
        run_git(&root, &["add", "-u", "renamed.txt"]);

        let deleted = service
            .diff_file_with_git2(&root, "renamed.txt", GitDiffMode::Staged)
            .expect("deleted diff should succeed");
        assert!(deleted.is_deleted);
        assert!(!deleted.is_new);
    }

    #[test]
    fn diff_file_expansion_covers_new_deleted_and_unchanged_text_variants() {
        let (workspace_id, root, service) = create_temp_repo();

        let unchanged = service
            .diff_file_expansion(&workspace_id, None, "tracked.txt", None, false)
            .expect("unchanged expansion should succeed");
        let unchanged_full = unchanged
            .full_diff
            .as_ref()
            .expect("unchanged full diff should exist");
        assert!(unchanged_full.hunks.is_empty());
        assert_eq!(unchanged_full.additions, 0);
        assert_eq!(unchanged_full.deletions, 0);

        fs::write(root.join("new.txt"), "new file\n").expect("write new file");
        let created = service
            .diff_file_expansion(&workspace_id, None, "new.txt", None, false)
            .expect("new file expansion should succeed");
        assert!(!created.is_binary);
        assert!(!created.old_exists);
        assert!(created.new_exists);
        let created_full = created
            .full_diff
            .as_ref()
            .expect("new file full diff should exist");
        assert!(created_full.is_new);
        assert_eq!(created_full.hunks.len(), 1);

        fs::remove_file(root.join("tracked.txt")).expect("remove tracked file");
        let deleted = service
            .diff_file_expansion(&workspace_id, None, "tracked.txt", None, false)
            .expect("deleted file expansion should succeed");
        assert!(!deleted.is_binary);
        assert!(deleted.old_exists);
        assert!(!deleted.new_exists);
        let deleted_full = deleted
            .full_diff
            .as_ref()
            .expect("deleted file full diff should exist");
        assert!(deleted_full.is_deleted);
        assert_eq!(deleted_full.hunks.len(), 1);
    }

    #[test]
    fn validation_and_parser_helpers_cover_remaining_error_shapes() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let missing_root =
            std::env::temp_dir().join(format!("gt-git-missing-root-{}", Uuid::new_v4()));
        let service = GitService::new(TestWorkspaceService {
            root: missing_root.clone(),
        });

        let workspace_root_error = service
            .workspace_root(&workspace_id)
            .expect_err("missing workspace root should fail");
        assert!(workspace_root_error
            .to_string()
            .contains("GIT_WORKSPACE_ROOT_INVALID"));

        let root = std::env::temp_dir().join(format!("gt-git-validate-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create validation root");
        init_repo(&root);
        let validation_service = GitService::new(TestWorkspaceService { root: root.clone() });

        let absolute_repo_error = validation_service
            .resolve_repo_context(&workspace_id, Some(root.to_string_lossy().as_ref()))
            .expect_err("absolute repository path should fail");
        assert!(absolute_repo_error
            .to_string()
            .contains("repository path must be workspace-relative"));

        let parent_repo_error = validation_service
            .resolve_repo_context(&workspace_id, Some("../escape"))
            .expect_err("parent repository path should fail");
        assert!(parent_repo_error
            .to_string()
            .contains("repository path escapes workspace"));

        let missing_repo_error = validation_service
            .resolve_repo_context(&workspace_id, Some("missing"))
            .expect_err("missing repository path should fail");
        assert!(missing_repo_error
            .to_string()
            .contains("repository root does not exist"));

        let plain_dir = root.join("plain-dir");
        fs::create_dir_all(&plain_dir).expect("create plain dir");
        let plain_repo_error = validation_service
            .resolve_repo_context(&workspace_id, Some("plain-dir"))
            .expect_err("plain directory should fail");
        assert!(plain_repo_error.to_string().contains("no git repository"));

        let outside_repo_error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            Path::new("/definitely/outside"),
            &root,
        )
        .expect_err("outside repository path should fail");
        assert!(outside_repo_error
            .to_string()
            .contains("repository is outside workspace"));

        let empty_path_error =
            GitService::<TestWorkspaceService>::validate_relative_repo_path("  ")
                .expect_err("empty path should fail");
        assert!(empty_path_error.to_string().contains("GIT_PATH_INVALID"));

        let absolute_path_error =
            GitService::<TestWorkspaceService>::validate_relative_repo_path("/tmp/nope")
                .expect_err("absolute path should fail");
        assert!(absolute_path_error
            .to_string()
            .contains("absolute path is not allowed"));

        let empty_branch_error = validation_service
            .validate_branch_name(&root, "   ")
            .expect_err("empty branch should fail");
        assert!(empty_branch_error
            .to_string()
            .contains("GIT_BRANCH_INVALID"));
    }

    #[test]
    fn parse_porcelain_status_and_patch_parser_cover_more_edge_shapes() {
        let parser_service = GitService::new(TestWorkspaceService {
            root: std::env::temp_dir(),
        });
        let workspace_root = PathBuf::from("/workspace");
        let root_context = test_repo_context(&workspace_root, &workspace_root, "");
        let app_context = test_repo_context(
            &workspace_root,
            &workspace_root.join("packages/app"),
            "packages/app",
        );
        let initial_commit = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## Initial commit on feature\nA  staged.txt\n",
            &root_context,
        );
        assert_eq!(initial_commit.branch, "feature");
        assert_eq!(initial_commit.files.len(), 1);

        let ahead_behind = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## topic...origin/topic [ahead 2, behind 3]\nR  old.txt -> new.txt\nM  \n?\n",
            &app_context,
        );
        assert_eq!(ahead_behind.branch, "topic");
        assert_eq!(ahead_behind.ahead, 2);
        assert_eq!(ahead_behind.behind, 3);
        assert_eq!(ahead_behind.files.len(), 1);
        assert_eq!(ahead_behind.files[0].path, "packages/app/new.txt");

        let detached = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "M  file.txt\n",
            &root_context,
        );
        assert_eq!(detached.branch, "HEAD");

        let delete_patch = "\
diff --git a/file.txt b/file.txt\n\
index 1111111..2222222 100644\n\
--- a/file.txt\n\
+++ b/file.txt\n\
@@ -1,2 +1,1 @@\n\
 line 1\n\
-line 2\n";
        let parsed = parser_service.parse_diff_patch(delete_patch, "file.txt");
        assert_eq!(parsed.deletions, 1);
        assert_eq!(parsed.hunks.len(), 1);
        assert!(parsed.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "del" && line.content == "line 2"));
    }

    #[test]
    fn build_full_structured_diff_and_patch_helpers_cover_richer_shapes() {
        let renamed = GitService::<TestWorkspaceService>::build_full_structured_diff(
            "new.txt",
            Some("old.txt".to_string()),
            "same\nbefore only\n",
            "same\nafter only\n",
            true,
            true,
        );
        assert!(renamed.is_renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));
        assert_eq!(renamed.additions, 1);
        assert_eq!(renamed.deletions, 1);
        assert_eq!(renamed.hunks.len(), 1);
        assert!(renamed.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "ctx" && line.content == "same"));
        assert!(renamed.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "del" && line.content == "before only"));
        assert!(renamed.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "add" && line.content == "after only"));

        let empty_patch =
            GitService::<TestWorkspaceService>::build_new_file_text_patch("empty.txt", "");
        assert!(empty_patch.contains("new file mode 100644"));
        assert!(!empty_patch.contains("@@"));

        let no_newline_patch =
            GitService::<TestWorkspaceService>::build_new_file_text_patch("note.txt", "line");
        assert!(no_newline_patch.contains("\\ No newline at end of file"));
    }

    #[test]
    fn parse_diff_patch_and_word_diff_cover_context_flush_and_partial_pairing() {
        let parser_service = GitService::new(TestWorkspaceService {
            root: std::env::temp_dir(),
        });
        let patch = "\
diff --git a/old.txt b/new.txt\n\
similarity index 90%\n\
rename from old.txt\n\
rename to new.txt\n\
@@ -1,3 +1,2 @@\n\
\x20same line\n\
-before one\n\
-before two\n\
+after one\n\
@@ -8,2 +7,2 @@\n\
\x20tail context\n\
-old tail\n\
+new tail\n";
        let parsed = parser_service.parse_diff_patch(patch, "new.txt");
        assert!(parsed.is_renamed);
        assert_eq!(parsed.old_path.as_deref(), Some("old.txt"));
        assert_eq!(parsed.hunks.len(), 2);
        assert_eq!(parsed.deletions, 3);
        assert_eq!(parsed.additions, 2);
        assert!(parsed.hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == "ctx" && line.content == "same line"));
        assert!(parsed.hunks[0].lines[1].segments.is_some());
        assert!(parsed.hunks[0].lines[3].segments.is_some());
        assert!(parsed.hunks[0].lines[2].segments.is_none());

        let mut hunks = vec![GitDiffHunk {
            header: "@@ -1,2 +1,1 @@".to_string(),
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 1,
            lines: vec![
                GitDiffLine {
                    kind: "ctx".to_string(),
                    content: "keep".to_string(),
                    old_line: Some(1),
                    new_line: Some(1),
                    segments: None,
                },
                GitDiffLine {
                    kind: "del".to_string(),
                    content: "remove one".to_string(),
                    old_line: Some(2),
                    new_line: None,
                    segments: None,
                },
                GitDiffLine {
                    kind: "del".to_string(),
                    content: "remove two".to_string(),
                    old_line: Some(3),
                    new_line: None,
                    segments: None,
                },
                GitDiffLine {
                    kind: "add".to_string(),
                    content: "add one".to_string(),
                    old_line: None,
                    new_line: Some(2),
                    segments: None,
                },
            ],
        }];
        GitService::<TestWorkspaceService>::enhance_hunks_with_word_diff(&mut hunks);
        assert!(hunks[0].lines[0].segments.is_none());
        assert!(hunks[0].lines[1].segments.is_some());
        assert!(hunks[0].lines[2].segments.is_none());
        assert!(hunks[0].lines[3].segments.is_some());
    }

    #[test]
    fn init_repo_bootstraps_plain_workspace_in_unit_tests() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-init-plain-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create plain workspace");
        let service = GitService::new(TestWorkspaceService { root: root.clone() });

        let branch = service
            .init_repo(&workspace_id, None, Some("main"))
            .expect("init repo should succeed");
        assert_eq!(branch, "main");
        assert!(root.join(".git").exists());

        let explicit_root =
            std::env::temp_dir().join(format!("gt-git-init-explicit-root-{}", Uuid::new_v4()));
        fs::create_dir_all(&explicit_root).expect("create explicit root workspace");
        let explicit_service = GitService::new(TestWorkspaceService {
            root: explicit_root.clone(),
        });
        let explicit_branch = explicit_service
            .init_repo(&workspace_id, Some("  "), Some("main"))
            .expect("init explicit root repo should succeed");
        assert_eq!(explicit_branch, "main");
        assert!(explicit_root.join(".git").exists());

        run_git(&explicit_root, &["config", "user.name", "GT Office Test"]);
        run_git(
            &explicit_root,
            &["config", "user.email", "test@example.com"],
        );
        fs::write(explicit_root.join("tracked.txt"), "tracked\n").expect("write explicit tracked");
        run_git(&explicit_root, &["add", "tracked.txt"]);
        run_git(&explicit_root, &["commit", "-m", "initial"]);
        let detached_head = run_git_output(&explicit_root, &["rev-parse", "HEAD"]);
        run_git(
            &explicit_root,
            &["checkout", "--detach", detached_head.trim()],
        );
        let detached_branch = explicit_service
            .init_repo(&workspace_id, Some("  "), Some("main"))
            .expect("init existing detached repo should return requested branch");
        assert_eq!(detached_branch, "main");
    }

    #[test]
    fn public_api_validation_and_empty_request_paths_cover_fast_failures() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let missing_root =
            std::env::temp_dir().join(format!("gt-git-missing-root-{}", Uuid::new_v4()));
        let missing_service = GitService::new(TestWorkspaceService { root: missing_root });
        let missing_error = missing_service
            .status_repo(&workspace_id, None)
            .expect_err("missing workspace should fail");
        assert!(missing_error
            .to_string()
            .contains("GIT_WORKSPACE_ROOT_INVALID"));

        let root = std::env::temp_dir().join(format!("gt-git-api-fast-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create api fast root");
        init_repo(&root);
        let service = GitService::new(TestWorkspaceService { root: root.clone() });

        assert_eq!(
            service
                .stage(&workspace_id, None, &[])
                .expect("empty stage is noop"),
            0
        );
        assert_eq!(
            service
                .unstage(&workspace_id, None, &[])
                .expect("empty unstage is noop"),
            0
        );

        let discard_error = service
            .discard(&workspace_id, None, &[], true)
            .expect_err("empty discard should fail");
        assert!(discard_error
            .to_string()
            .contains("GIT_DISCARD_PATHS_REQUIRED"));

        let commit_error = service
            .commit(&workspace_id, None, "   ")
            .expect_err("empty commit message should fail");
        assert!(commit_error
            .to_string()
            .contains("GIT_COMMIT_MESSAGE_INVALID"));

        let amend_error = service
            .commit_amend(&workspace_id, None, "\n\t")
            .expect_err("empty amend message should fail");
        assert!(amend_error
            .to_string()
            .contains("GIT_COMMIT_MESSAGE_INVALID"));

        let absolute_error = service
            .status_repo(&workspace_id, Some("/outside"))
            .expect_err("absolute repository path should fail");
        assert!(absolute_error
            .to_string()
            .contains("GIT_REPOSITORY_PATH_INVALID"));

        let escaping_error = service
            .status_repo(&workspace_id, Some("../outside"))
            .expect_err("escaping repository path should fail");
        assert!(escaping_error
            .to_string()
            .contains("GIT_REPOSITORY_PATH_INVALID"));

        let missing_repo_error = service
            .status_repo(&workspace_id, Some("missing"))
            .expect_err("missing repository path should fail");
        assert!(missing_repo_error
            .to_string()
            .contains("repository root does not exist"));

        fs::create_dir_all(root.join("plain-dir")).expect("create plain dir");
        let non_repo_error = service
            .status_repo(&workspace_id, Some("plain-dir"))
            .expect_err("non-repo path should fail");
        assert!(non_repo_error.to_string().contains("no git repository"));
    }

    #[cfg(unix)]
    #[test]
    fn structured_command_parsers_cover_short_empty_and_optional_fields() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-fake-structured-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create structured root");
        init_repo(&root);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\n\
case \"$*\" in\n\
  *\"for-each-ref\"*\"refs/heads/\"*)\n\
    printf 'bad\\n*\\tmain\\torigin/main\\t>\\tabc123\\tSubject\\n \\t\\t\\t\\tdeadbeef\\tNo name\\n'\n\
    ;;\n\
  *\"log\"*)\n\
    printf 'aaaaaaaa\\037aaaa\\037p1 p2\\037HEAD -> main, tag: v1\\037Alice\\037a@example.com\\0372024-01-01T00:00:00Z\\037summary\\036short\\036'\n\
    ;;\n\
  *\"stash list\"*)\n\
    printf 'stash@{0}\\037bbbbbbbb\\0372024-01-02T00:00:00Z\\037WIP\\036short\\036'\n\
    ;;\n\
  *\"refs/tags/\"*)\n\
    printf 'v1\\037oid\\037short\\037Alice\\037message\\036v2\\037oid2\\037short2\\037\\037\\036'\n\
    ;;\n\
  *)\n\
    exit 0\n\
    ;;\n\
esac\n",
        )
        .expect("write structured fake git");
        make_executable(&fake_git);

        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        let branches = service
            .list_branches(&workspace_id, None, true)
            .expect("branch parser should tolerate malformed lines");
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].current);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));

        let log = service
            .log(&workspace_id, None, 0, usize::MAX)
            .expect("log parser should clamp limits and skip short records");
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].parents, vec!["p1", "p2"]);
        assert!(log[0].refs.iter().any(|value| value == "tag: v1"));

        let stashes = service
            .stash_list(&workspace_id, None, 0)
            .expect("stash parser should skip short records");
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].stash, "stash@{0}");

        let tags = service
            .tag_list(&workspace_id, None)
            .expect("tag parser should preserve optional fields");
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].tagger.as_deref(), Some("Alice"));
        assert_eq!(tags[0].message.as_deref(), Some("message"));
        assert!(tags[1].tagger.is_none());
        assert!(tags[1].message.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn commit_detail_reports_malformed_metadata_from_git_show() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-fake-detail-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create detail root");
        init_repo(&root);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(&fake_git, "#!/bin/sh\nprintf 'too-short'\n")
            .expect("write malformed detail fake git");
        make_executable(&fake_git);
        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        let error = service
            .commit_detail(&workspace_id, None, "abcdef123456")
            .expect_err("malformed metadata should fail");
        assert!(error
            .to_string()
            .contains("failed to parse commit metadata"));
    }

    #[cfg(unix)]
    #[test]
    fn command_builders_cover_default_blank_and_optional_arguments() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-fake-commands-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create command root");
        init_repo(&root);
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked file");
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "initial", "--no-gpg-sign"]);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\n\
case \"$*\" in\n\
  *\"add -- boom.txt\"*)\n\
    printf 'fatal: cannot add boom\\n' >&2\n\
    exit 2\n\
    ;;\n\
  *\"rev-parse\"*)\n\
    printf 'abcdef1234567890\\n'\n\
    ;;\n\
  *\"merge --no-edit fail-target\"*)\n\
    printf 'fatal: not something we can merge\\n' >&2\n\
    exit 2\n\
    ;;\n\
  *\"show --no-patch\"*)\n\
    printf 'abcdef1234567890\\037abcdef1\\037parent1\\037HEAD -> main\\037Alice\\037a@example.com\\0372024-01-01T00:00:00Z\\037Subject\\036Body\\n'\n\
    ;;\n\
  *\"show --format=\"*)\n\
    printf '\\nshort\\n\\tignored.txt\\nR100\\told-only.txt\\nR100\\told.txt\\t\\nM\\t\\nM\\tfile.txt\\n'\n\
    ;;\n\
  *\"log\"*)\n\
    printf 'abcdef1234567890\\037abcdef1\\037parent1\\037HEAD -> main\\037Alice\\037a@example.com\\0372024-01-01T00:00:00Z\\037Subject\\036'\n\
    ;;\n\
  *)\n\
    exit 0\n\
    ;;\n\
esac\n",
        )
        .expect("write command fake git");
        make_executable(&fake_git);
        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        let committed = service
            .commit(&workspace_id, None, " commit message ")
            .expect("commit command builder");
        assert_eq!(committed.len(), 40);
        let amended = service
            .commit_amend(&workspace_id, None, " amended message ")
            .expect("commit amend command builder");
        assert_eq!(amended.len(), 40);
        let log = service
            .log(&workspace_id, None, 1, 0)
            .expect("log command builder");
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].summary, "Subject");
        let detail = service
            .commit_detail(&workspace_id, None, "abcdef1234567890")
            .expect("commit detail command builder");
        assert_eq!(detail.body, "Body");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].path, "file.txt");
        let stage_error = service
            .stage(&workspace_id, None, &["boom.txt".to_string()])
            .expect_err("non-ignored stage failure should be returned");
        assert!(stage_error.to_string().contains("GIT_STAGE_FAILED"));

        service
            .checkout(&workspace_id, None, "topic", true, Some("HEAD"))
            .expect("checkout create with explicit start point");
        service
            .create_branch(&workspace_id, None, "feature", Some("HEAD"))
            .expect("create branch with explicit start point");
        service
            .delete_branch(&workspace_id, None, "feature", false)
            .expect("delete branch without force");
        service
            .delete_branch(&workspace_id, None, "feature", true)
            .expect("delete branch with force");

        let fetch = service
            .fetch(&workspace_id, None, Some("  "), false, false)
            .expect("fetch default remote without tags");
        assert_eq!(fetch.remote, "origin");
        assert!(!fetch.prune);
        assert!(!fetch.include_tags);

        let pull = service
            .pull(&workspace_id, None, Some("  "), Some("  "), false)
            .expect("pull default remote without branch");
        assert_eq!(pull.remote, "origin");
        assert!(pull.branch.is_none());
        assert!(!pull.rebase);

        let push = service
            .push(&workspace_id, None, Some("  "), Some("  "), false, false)
            .expect("push default remote without branch");
        assert_eq!(push.remote, "origin");
        assert!(push.branch.is_none());
        assert!(!push.set_upstream);
        assert!(!push.force_with_lease);

        service
            .stash_push(&workspace_id, None, Some("  "), false, false)
            .expect("stash push ignores blank message");
        service
            .stash_pop(&workspace_id, None, Some("  "))
            .expect("stash pop ignores blank stash ref");
        service
            .tag_create(
                &workspace_id,
                None,
                "v-empty",
                "HEAD",
                false,
                Some("ignored"),
            )
            .expect("lightweight tag ignores message");
        service
            .tag_push(&workspace_id, None, Some("  "), "v-empty")
            .expect("tag push defaults remote");
        service
            .cherry_pick(&workspace_id, None, "abcdef1234567890")
            .expect("cherry-pick command builder");
        service
            .revert(&workspace_id, None, "abcdef1234567890")
            .expect("revert command builder");
        service
            .reset(&workspace_id, None, "HEAD", "soft")
            .expect("reset soft command builder");
        service
            .merge(&workspace_id, None, "feature", false)
            .expect("merge command builder");
        let merge_error = service
            .merge(&workspace_id, None, "fail-target", false)
            .expect_err("non-conflict merge failure should be returned");
        assert!(merge_error.to_string().contains("GIT_MERGE_FAILED"));
        service
            .merge_abort(&workspace_id, None)
            .expect("merge abort command builder");
    }

    #[cfg(unix)]
    #[test]
    fn command_builders_trim_blank_optional_arguments() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root =
            std::env::temp_dir().join(format!("gt-git-fake-blank-commands-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create command root");
        init_repo(&root);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        let command_log = root.join("commands.log");
        fs::write(
            &fake_git,
            format!(
                "#!/bin/sh\n\
printf '%s\\n' \"$*\" >> '{}'\n\
exit 0\n",
                command_log.display()
            ),
        )
        .expect("write blank command fake git");
        make_executable(&fake_git);
        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        service
            .checkout(&workspace_id, None, "blank-start", true, Some("  "))
            .expect("checkout should ignore blank start point");
        service
            .create_branch(&workspace_id, None, "blank-branch", Some("  "))
            .expect("branch create should ignore blank start point");
        let fetch = service
            .fetch(&workspace_id, None, Some("  "), false, false)
            .expect("fetch should default blank remote");
        assert_eq!(fetch.remote, "origin");
        assert!(!fetch.include_tags);
        let pull = service
            .pull(&workspace_id, None, Some("  "), Some("  "), false)
            .expect("pull should default blank remote and ignore blank branch");
        assert_eq!(pull.remote, "origin");
        assert_eq!(pull.branch, None);
        let push = service
            .push(&workspace_id, None, Some("  "), Some("  "), false, false)
            .expect("push should default blank remote and ignore blank branch");
        assert_eq!(push.remote, "origin");
        assert_eq!(push.branch, None);
        service
            .stash_push(&workspace_id, None, Some("  "), false, false)
            .expect("stash push should ignore blank message");
        service
            .stash_pop(&workspace_id, None, Some("  "))
            .expect("stash pop should ignore blank selector");
        service
            .tag_push(&workspace_id, None, Some("  "), "v1.0.0")
            .expect("tag push should default blank remote");
        service
            .cherry_pick(&workspace_id, None, "abcdef1234567890")
            .expect("cherry-pick command builder");
        service
            .revert(&workspace_id, None, "abcdef1234567890")
            .expect("revert command builder");
        service
            .reset(&workspace_id, None, "HEAD~1", "soft")
            .expect("reset command builder");

        let commands = fs::read_to_string(command_log).expect("read command log");
        assert!(commands.contains("checkout -b blank-start\n"));
        assert!(commands.contains("branch blank-branch\n"));
        assert!(commands.contains("fetch origin --no-tags\n"));
        assert!(commands.contains("pull origin --no-rebase\n"));
        assert!(commands.contains("push origin\n"));
        assert!(commands.contains("stash push\n"));
        assert!(commands.contains("stash pop\n"));
        assert!(commands.contains("push origin tag v1.0.0\n"));
        assert!(commands.contains("cherry-pick abcdef1234567890\n"));
        assert!(commands.contains("revert --no-edit abcdef1234567890\n"));
        assert!(commands.contains("reset --soft HEAD~1\n"));
    }

    #[cfg(unix)]
    #[test]
    fn public_commands_propagate_git_failures_with_operation_codes() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-fake-errors-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create command root");
        init_repo(&root);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\n\
case \"$*\" in\n\
  *\"check-ref-format --branch\"*) exit 0 ;;\n\
  *) echo forced git failure >&2; exit 1 ;;\n\
esac\n",
        )
        .expect("write failure fake git");
        make_executable(&fake_git);
        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        type GitFailureCase<'a> = (&'a str, Box<dyn Fn() -> AbstractionResult<()> + 'a>);
        let cases: Vec<GitFailureCase<'_>> = vec![
            (
                "GIT_COMMIT_FAILED",
                Box::new(|| service.commit(&workspace_id, None, "message").map(|_| ())),
            ),
            (
                "GIT_COMMIT_FAILED",
                Box::new(|| {
                    service
                        .commit_amend(&workspace_id, None, "message")
                        .map(|_| ())
                }),
            ),
            (
                "GIT_LOG_FAILED",
                Box::new(|| service.log(&workspace_id, None, 10, 0).map(|_| ())),
            ),
            (
                "GIT_COMMIT_DETAIL_FAILED",
                Box::new(|| {
                    service
                        .commit_detail(&workspace_id, None, "abcdef1234567890")
                        .map(|_| ())
                }),
            ),
            (
                "GIT_CHECKOUT_FAILED",
                Box::new(|| service.checkout(&workspace_id, None, "topic", false, None)),
            ),
            (
                "GIT_BRANCH_CREATE_FAILED",
                Box::new(|| service.create_branch(&workspace_id, None, "topic", None)),
            ),
            (
                "GIT_BRANCH_DELETE_FAILED",
                Box::new(|| service.delete_branch(&workspace_id, None, "topic", false)),
            ),
            (
                "GIT_FETCH_FAILED",
                Box::new(|| {
                    service
                        .fetch(&workspace_id, None, None, false, false)
                        .map(|_| ())
                }),
            ),
            (
                "GIT_STASH_PUSH_FAILED",
                Box::new(|| service.stash_push(&workspace_id, None, Some("message"), false, false)),
            ),
            (
                "GIT_STASH_LIST_FAILED",
                Box::new(|| service.stash_list(&workspace_id, None, 10).map(|_| ())),
            ),
            (
                "GIT_TAG_LIST_FAILED",
                Box::new(|| service.tag_list(&workspace_id, None).map(|_| ())),
            ),
            (
                "GIT_TAG_DELETE_FAILED",
                Box::new(|| service.tag_delete(&workspace_id, None, "v1.0.0")),
            ),
            (
                "GIT_TAG_PUSH_FAILED",
                Box::new(|| service.tag_push(&workspace_id, None, None, "v1.0.0")),
            ),
            (
                "GIT_CHERRY_PICK_FAILED",
                Box::new(|| service.cherry_pick(&workspace_id, None, "abcdef1234567890")),
            ),
            (
                "GIT_REVERT_FAILED",
                Box::new(|| service.revert(&workspace_id, None, "abcdef1234567890")),
            ),
            (
                "GIT_RESET_FAILED",
                Box::new(|| service.reset(&workspace_id, None, "HEAD", "mixed")),
            ),
            (
                "GIT_CONFLICT_LIST_FAILED",
                Box::new(|| service.conflict_list(&workspace_id, None).map(|_| ())),
            ),
            (
                "GIT_MERGE_ABORT_FAILED",
                Box::new(|| service.merge_abort(&workspace_id, None)),
            ),
        ];

        for (expected_code, operation) in cases {
            let error = operation().expect_err(expected_code);
            assert!(
                error.to_string().contains(expected_code),
                "expected {expected_code}, got {error}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn discard_parses_renamed_paths_and_short_porcelain_segments() {
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let root = std::env::temp_dir().join(format!("gt-git-fake-discard-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fake discard root");
        init_repo(&root);

        let fake_bin = root.join("fake-bin");
        fs::create_dir_all(&fake_bin).expect("create fake bin");
        let fake_git = fake_bin.join("git");
        fs::write(
            &fake_git,
            "#!/bin/sh\n\
case \"$*\" in\n\
  *\"status --porcelain -z\"*)\n\
    printf 'R  renamed.txt\\0tracked.txt\\0x\\0'\n\
    ;;\n\
  *)\n\
    exit 0\n\
    ;;\n\
esac\n",
        )
        .expect("write discard fake git");
        make_executable(&fake_git);
        let service = make_test_service_with_git_path(root.clone(), &fake_bin);

        let discarded = service
            .discard(&workspace_id, None, &["renamed.txt".to_string()], false)
            .expect("renamed path should be discardable");
        assert_eq!(discarded, 1);

        fs::remove_dir_all(root).expect("fake discard root should be removed");
    }

    #[test]
    fn path_to_workspace_relative_reports_missing_workspace_root_canonicalization() {
        let existing_path = std::env::temp_dir();
        let missing_root =
            std::env::temp_dir().join(format!("gt-git-missing-root-{}", Uuid::new_v4()));

        let error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &existing_path,
            &missing_root,
        )
        .expect_err("missing workspace root should fail canonicalization");
        assert!(error
            .to_string()
            .contains("repository is outside workspace"));
    }

    #[test]
    fn resolve_head_oid_and_head_snapshot_cover_unborn_and_non_repo_paths() {
        let root = std::env::temp_dir().join(format!("gt-git-unborn-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create unborn repo root");
        init_repo(&root);
        let service = GitService::new(TestWorkspaceService { root: root.clone() });
        let head_error = service
            .resolve_head_oid(&root)
            .expect_err("unborn HEAD has no target");
        assert!(head_error.to_string().contains("GIT_REV_PARSE_FAILED"));

        let plain_dir = std::env::temp_dir().join(format!("gt-git-plain-{}", Uuid::new_v4()));
        fs::create_dir_all(&plain_dir).expect("create plain dir");
        let discover_error = service
            .resolve_head_oid(&plain_dir)
            .expect_err("plain directory is not a repository");
        assert!(discover_error
            .to_string()
            .contains("repository discovery failed"));

        let repo = Repository::discover(&root).expect("discover unborn repo");
        assert!(matches!(
            GitService::<TestWorkspaceService>::read_head_snapshot(&repo, "missing.txt")
                .expect("unborn head snapshot should be missing"),
            GitSnapshotContent::Missing
        ));

        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked file");
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "initial", "--no-gpg-sign"]);
        run_git(&root, &["checkout", "--detach"]);
        let detached_id = service
            .resolve_head_oid(&root)
            .expect("detached HEAD still has a target");
        assert_eq!(detached_id.len(), 40);

        fs::remove_dir_all(root).expect("unborn repo root should be removed");
        fs::remove_dir_all(plain_dir).expect("plain dir should be removed");
    }

    #[test]
    fn list_index_new_and_tracked_paths_distinguish_file_sets() {
        let (_, root, service) = create_temp_repo();
        fs::write(root.join("tracked.txt"), "modified\n").expect("modify tracked");
        fs::write(root.join("new.txt"), "new\n").expect("write new");
        run_git(&root, &["add", "new.txt"]);

        let tracked = service
            .list_tracked_paths(
                &root,
                &["tracked.txt".to_string(), "new.txt".to_string()],
                "GIT_TEST_FAILED",
            )
            .expect("list tracked paths");
        assert!(tracked.contains("tracked.txt"));

        let index_new = service
            .list_index_new_paths(&root, &["new.txt".to_string()], "GIT_TEST_FAILED")
            .expect("list index new paths");
        assert!(index_new.contains("new.txt"));
    }

    #[test]
    fn list_path_helpers_return_empty_sets_for_empty_input() {
        let (_, root, service) = create_temp_repo();

        assert!(service
            .list_untracked_paths(&root, &[], "GIT_TEST_FAILED")
            .expect("empty untracked paths")
            .is_empty());
        assert!(service
            .list_index_new_paths(&root, &[], "GIT_TEST_FAILED")
            .expect("empty index-new paths")
            .is_empty());
        assert!(service
            .list_tracked_paths(&root, &[], "GIT_TEST_FAILED")
            .expect("empty tracked paths")
            .is_empty());
    }

    #[test]
    fn normalize_workspace_paths_for_repo_validates_relative_scope() {
        let workspace_root = std::env::temp_dir().join(format!("gt-git-norm-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        let repo_root = create_nested_repo(&workspace_root, "packages/app", "tracked.txt");
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });
        let context = test_repo_context(&workspace_root, &repo_root, "packages/app");

        let normalized = service
            .normalize_workspace_paths_for_repo(
                &context,
                &[
                    String::from("packages/app/tracked.txt"),
                    String::from("packages/app/other.txt"),
                ],
            )
            .expect("normalize scoped paths");
        assert_eq!(
            normalized,
            vec!["tracked.txt".to_string(), "other.txt".to_string()]
        );

        let outside_repo = service
            .normalize_workspace_paths_for_repo(
                &context,
                &[String::from("packages/other/file.txt")],
            )
            .expect_err("path outside repo should fail");
        assert!(outside_repo.to_string().contains("GIT_PATH_INVALID"));

        let empty = service
            .normalize_workspace_paths_for_repo(&context, &[String::from("   ")])
            .expect_err("empty path should fail");
        assert!(empty.to_string().contains("GIT_PATH_INVALID"));

        let absolute = service
            .normalize_workspace_paths_for_repo(&context, &[String::from("/tmp/file.txt")])
            .expect_err("absolute path should fail");
        assert!(absolute.to_string().contains("GIT_PATH_INVALID"));

        let traversal = service
            .normalize_workspace_paths_for_repo(&context, &[String::from("../escape.txt")])
            .expect_err("traversal should fail");
        assert!(traversal.to_string().contains("GIT_PATH_INVALID"));
    }

    #[test]
    fn parse_conflict_file_maps_supported_statuses_and_renames() {
        let workspace_root = PathBuf::from("/workspace");
        let context = test_repo_context(
            &workspace_root,
            &workspace_root.join("packages/app"),
            "packages/app",
        );
        let both_added =
            GitService::<TestWorkspaceService>::parse_conflict_file(&context, "AA added.txt")
                .expect("both added conflict");
        assert_eq!(both_added.path, "packages/app/added.txt");
        assert!(matches!(both_added.status, ConflictStatus::BothAdded));

        let renamed = GitService::<TestWorkspaceService>::parse_conflict_file(
            &context,
            "DU old.txt -> renamed.txt",
        )
        .expect("renamed conflict");
        assert_eq!(renamed.path, "packages/app/renamed.txt");
        assert!(matches!(renamed.status, ConflictStatus::DeletedByUs));

        assert!(
            GitService::<TestWorkspaceService>::parse_conflict_file(&context, "M  plain.txt")
                .is_none()
        );
        assert!(GitService::<TestWorkspaceService>::parse_conflict_file(&context, "AA ").is_none());
        assert!(GitService::<TestWorkspaceService>::parse_conflict_file(&context, "x").is_none());
    }

    #[test]
    fn parse_porcelain_status_handles_initial_commit_headers() {
        let workspace_root = PathBuf::from("/workspace");
        let context = test_repo_context(&workspace_root, &workspace_root, "");
        let no_commits = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## No commits yet on main\n",
            &context,
        );
        assert_eq!(no_commits.branch, "main");

        let initial_commit = GitService::<TestWorkspaceService>::parse_porcelain_status(
            "## Initial commit on trunk\n",
            &context,
        );
        assert_eq!(initial_commit.branch, "trunk");
    }

    #[test]
    fn parse_porcelain_status_limits_file_count() {
        let mut porcelain = String::from("## main\n");
        for index in 0..=MAX_STATUS_FILES {
            porcelain.push_str(&format!("?? file-{index}.txt\n"));
        }

        let workspace_root = PathBuf::from("/workspace");
        let context = test_repo_context(
            &workspace_root,
            &workspace_root.join("packages/app"),
            "packages/app",
        );
        let summary =
            GitService::<TestWorkspaceService>::parse_porcelain_status(&porcelain, &context);
        assert_eq!(summary.files.len(), MAX_STATUS_FILES);
    }

    #[test]
    fn path_join_and_relative_conversion_cover_root_and_outside_cases() {
        assert_eq!(
            GitService::<TestWorkspaceService>::join_workspace_relative_path("", "a.txt"),
            "a.txt"
        );
        assert_eq!(
            GitService::<TestWorkspaceService>::join_workspace_relative_path("pkg", "a.txt"),
            "pkg/a.txt"
        );

        let workspace_root = std::env::temp_dir().join(format!("gt-git-root-{}", Uuid::new_v4()));
        let outside_root = std::env::temp_dir().join(format!("gt-git-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        fs::create_dir_all(&outside_root).expect("create outside root");

        let root_relative = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &workspace_root,
            &workspace_root,
        )
        .expect("workspace root should map to empty path");
        assert_eq!(root_relative, "");

        let outside_error = GitService::<TestWorkspaceService>::path_to_workspace_relative(
            &outside_root,
            &workspace_root,
        )
        .expect_err("outside path should fail");
        assert!(outside_error
            .to_string()
            .contains("GIT_REPOSITORY_PATH_INVALID"));
    }

    fn restore_env_var(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn restore_env_var_covers_missing_values() {
        let key = format!("GT_GIT_TEST_RESTORE_MISSING_{}", Uuid::new_v4());
        std::env::set_var(&key, "temporary");
        restore_env_var(&key, None);
        assert!(std::env::var_os(&key).is_none());
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("chmod");
    }

    #[cfg(unix)]
    #[test]
    fn commit_succeeds_when_hook_needs_node_outside_inherited_path() {
        use std::os::unix::fs::symlink;

        let _guard = ENV_LOCK.lock().expect("env lock");
        let (workspace_id, root, service) = create_temp_repo();
        let test_home = std::env::temp_dir().join(format!("gt-git-home-{}", Uuid::new_v4()));
        let git_bin_dir = root.join("git-bin");
        let node_bin_dir = test_home.join(".local").join("bin");
        fs::create_dir_all(&git_bin_dir).expect("create git-only path");
        fs::create_dir_all(&node_bin_dir).expect("create node bin path");

        let git_path_output = Command::new("which")
            .arg("git")
            .output()
            .expect("which git should run");
        assert!(git_path_output.status.success(), "which git should succeed");
        let git_path = String::from_utf8_lossy(&git_path_output.stdout)
            .trim()
            .to_string();
        assert!(!git_path.is_empty(), "git path should not be empty");
        symlink(&git_path, git_bin_dir.join("git")).expect("symlink git");

        let node_script = node_bin_dir.join("node");
        fs::write(
            &node_script,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"v20.0.0\"\n  exit 0\nfi\nexit 0\n",
        )
        .expect("write fake node");
        make_executable(&node_script);

        let hooks_dir = root.join(".git").join("hooks");
        fs::create_dir_all(&hooks_dir).expect("create hooks dir");
        let pre_commit = hooks_dir.join("pre-commit");
        fs::write(&pre_commit, "#!/bin/sh\nnode --version >/dev/null\n").expect("write hook");
        make_executable(&pre_commit);

        fs::write(root.join("hook.txt"), "hook\n").expect("write file");
        service
            .stage(&workspace_id, None, &[String::from("hook.txt")])
            .expect("stage");

        let previous_home = std::env::var_os("HOME");
        let previous_path = std::env::var_os("PATH");
        std::env::set_var("HOME", &test_home);
        std::env::set_var("PATH", &git_bin_dir);

        let result = service.commit(&workspace_id, None, "feat: hook commit");

        restore_env_var("HOME", previous_home);
        restore_env_var("PATH", previous_path);
        fs::remove_dir_all(&test_home).expect("remove test home");
        fs::remove_dir_all(root).expect("temp repo should be removed");

        let commit_id = result.expect("commit should succeed with augmented path");
        assert_eq!(commit_id.len(), 40);
    }

    #[test]
    fn discard_removes_untracked_files_without_breaking_tracked_restore() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "changed\n").expect("tracked file should be updated");
        fs::write(root.join("scratch.txt"), "draft\n").expect("untracked file should be created");

        service
            .discard(
                &workspace_id,
                None,
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
    fn discard_removes_index_new_files_like_vscode() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("政策分析.md"), "draft\n").expect("new file should be created");
        run_git(&root, &["add", "政策分析.md"]);

        service
            .discard(&workspace_id, None, &["政策分析.md".to_string()], false)
            .expect("discard should succeed for index new file");

        assert!(!root.join("政策分析.md").exists());

        let status = service
            .status(&workspace_id)
            .expect("status should succeed after discard");
        assert!(
            status.files.iter().all(|file| file.path != "政策分析.md"),
            "discarded index new file should be removed from git status"
        );

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn discard_ignores_stale_unknown_paths_instead_of_failing() {
        let (workspace_id, root, service) = create_temp_repo();

        let discarded = service
            .discard(&workspace_id, None, &["政策分析.md".to_string()], false)
            .expect("discard should ignore stale unknown paths");

        assert_eq!(discarded, 0);

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn discard_reports_actual_processed_path_count() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "changed\n").expect("tracked file should be updated");

        let discarded = service
            .discard(
                &workspace_id,
                None,
                &["tracked.txt".to_string(), "政策分析.md".to_string()],
                false,
            )
            .expect("discard should succeed with mixed valid and stale paths");

        assert_eq!(discarded, 1);
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("tracked file should exist"),
            "base\n"
        );

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
            .diff_file_structured(&workspace_id, None, "tracked.txt", true)
            .expect("staged diff should succeed");
        let unstaged = service
            .diff_file_structured(&workspace_id, None, "tracked.txt", false)
            .expect("unstaged diff should succeed");

        assert_ne!(staged.patch, unstaged.patch);
        assert!(staged.patch.contains("-base"));
        assert!(staged.patch.contains("+staged"));
        assert!(unstaged.patch.contains("+worktree"));
        assert!(!unstaged.patch.contains("-base"));

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn status_aggregates_workspace_root_and_nested_repositories() {
        let (workspace_id, root, service) = create_temp_repo();
        let nested_root = create_nested_repo(&root, "packages/alpha", "nested.txt");

        fs::write(root.join("tracked.txt"), "root changed\n").expect("root file should be updated");
        fs::write(nested_root.join("nested.txt"), "nested changed\n")
            .expect("nested file should be updated");

        let summary = service
            .status(&workspace_id)
            .expect("status should succeed");
        assert_eq!(summary.repositories.len(), 2);
        assert_eq!(summary.repositories[0].repository_path, "");
        assert_eq!(summary.repositories[1].repository_path, "packages/alpha");
        assert!(
            summary
                .files
                .iter()
                .any(|file| file.path == "tracked.txt" && file.repository_path.is_empty()),
            "workspace-root change should stay scoped to the root repository"
        );
        assert!(
            summary
                .files
                .iter()
                .any(|file| file.path == "packages/alpha/nested.txt"
                    && file.repository_path == "packages/alpha"),
            "nested repository change should be reported with its repository path"
        );

        let nested_summary = service
            .status_repo(&workspace_id, Some("packages/alpha"))
            .expect("nested repo status should succeed");
        assert_eq!(nested_summary.primary_repository_path, "packages/alpha");
        assert_eq!(nested_summary.files.len(), 1);
        assert_eq!(nested_summary.files[0].path, "packages/alpha/nested.txt");

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn status_supports_workspace_nested_inside_parent_repository() {
        let parent_root =
            std::env::temp_dir().join(format!("gt-git-parent-worktree-{}", Uuid::new_v4()));
        fs::create_dir_all(&parent_root).expect("create parent repo root");
        init_repo(&parent_root);

        fs::create_dir_all(parent_root.join("outside")).expect("create outside dir");
        fs::write(parent_root.join("outside/outside.txt"), "outside base\n")
            .expect("write outside file");
        fs::create_dir_all(parent_root.join("YYGL/code/assessment-management"))
            .expect("create nested workspace");
        fs::write(
            parent_root.join("YYGL/code/assessment-management/tracked.txt"),
            "workspace base\n",
        )
        .expect("write workspace tracked file");
        run_git(&parent_root, &["add", "."]);
        run_git(&parent_root, &["commit", "-m", "init parent"]);

        let workspace_root = parent_root.join("YYGL/code/assessment-management");
        let nested_root = create_nested_repo(&workspace_root, "modules/child", "child.txt");
        fs::write(
            parent_root.join("YYGL/code/assessment-management/tracked.txt"),
            "workspace changed\n",
        )
        .expect("modify workspace tracked file");
        fs::write(parent_root.join("outside/outside.txt"), "outside changed\n")
            .expect("modify outside file");
        fs::write(nested_root.join("child.txt"), "child changed\n").expect("modify child file");

        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });

        let default_context = service
            .resolve_repo_context(&workspace_id, None)
            .expect("parent repository context should resolve");
        assert_eq!(
            fs::canonicalize(&default_context.repo_root).expect("canonical context repo root"),
            fs::canonicalize(&parent_root).expect("canonical parent repo root")
        );
        assert_eq!(default_context.repository_path, "");
        assert_eq!(
            default_context.workspace_relative_prefix.as_deref(),
            Some("YYGL/code/assessment-management")
        );

        let repositories = service
            .discover_workspace_repositories(&workspace_root)
            .expect("discover parent and child repositories");
        let repository_paths = repositories
            .iter()
            .map(|repository| repository.repository_path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(repository_paths, vec!["", "modules/child"]);

        let summary = service.status(&workspace_id).expect("aggregate status");
        assert_eq!(summary.primary_repository_path, "");
        assert_eq!(summary.repositories.len(), 2);
        assert!(summary
            .repositories
            .iter()
            .any(|repository| repository.repository_path.is_empty()));
        assert!(summary
            .repositories
            .iter()
            .any(|repository| repository.repository_path == "modules/child"));
        assert!(summary.files.iter().any(|file| {
            file.path == "tracked.txt"
                && file.repository_path.is_empty()
                && file.repo_relative_path == "YYGL/code/assessment-management/tracked.txt"
        }));
        assert!(
            !summary
                .files
                .iter()
                .any(|file| file.path.contains("outside/outside.txt")),
            "parent repository status should be scoped to the workspace subtree"
        );
        assert!(summary.files.iter().any(|file| {
            file.path == "modules/child/child.txt"
                && file.repository_path == "modules/child"
                && file.repo_relative_path == "child.txt"
        }));

        let parent_summary = service
            .status_repo(&workspace_id, Some(""))
            .expect("selected parent repository status should succeed");
        assert_eq!(parent_summary.primary_repository_path, "");
        assert!(parent_summary
            .files
            .iter()
            .any(|file| file.path == "tracked.txt"));
        assert!(!parent_summary
            .files
            .iter()
            .any(|file| file.path.contains("outside/outside.txt")));

        let nested_summary = service
            .status_repo(&workspace_id, Some("modules/child"))
            .expect("nested repository status should succeed");
        assert_eq!(nested_summary.primary_repository_path, "modules/child");
        assert_eq!(nested_summary.files[0].path, "modules/child/child.txt");

        fs::remove_dir_all(parent_root).expect("parent repo root should be removed");
    }

    #[test]
    fn parent_repository_scope_normalizes_paths_and_diff_to_workspace_subtree() {
        let parent_root =
            std::env::temp_dir().join(format!("gt-git-parent-paths-{}", Uuid::new_v4()));
        fs::create_dir_all(&parent_root).expect("create parent repo root");
        init_repo(&parent_root);
        fs::create_dir_all(parent_root.join("YYGL/code/assessment-management"))
            .expect("create nested workspace");
        fs::write(
            parent_root.join("YYGL/code/assessment-management/tracked.txt"),
            "base\n",
        )
        .expect("write tracked file");
        run_git(&parent_root, &["add", "."]);
        run_git(&parent_root, &["commit", "-m", "init parent"]);

        let workspace_root = parent_root.join("YYGL/code/assessment-management");
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });
        let context = test_parent_repo_context(
            &workspace_root,
            &parent_root,
            "YYGL/code/assessment-management",
        );

        let normalized = service
            .normalize_workspace_paths_for_repo(
                &context,
                &["tracked.txt".to_string(), "nested/new.txt".to_string()],
            )
            .expect("workspace paths should map into parent repo paths");
        assert_eq!(
            normalized,
            vec![
                "YYGL/code/assessment-management/tracked.txt".to_string(),
                "YYGL/code/assessment-management/nested/new.txt".to_string()
            ]
        );

        fs::write(
            parent_root.join("YYGL/code/assessment-management/tracked.txt"),
            "base\nchanged\n",
        )
        .expect("modify tracked file");
        let diff = service
            .diff_file_structured(&workspace_id, Some(""), "tracked.txt", false)
            .expect("parent scoped diff should succeed");
        assert_eq!(diff.path, "tracked.txt");
        assert!(diff.patch.contains("+changed"));

        service
            .stage(&workspace_id, Some(""), &["tracked.txt".to_string()])
            .expect("stage parent scoped workspace path");
        let staged_status = run_git_output(
            &parent_root,
            &[
                "diff",
                "--cached",
                "--name-only",
                "--",
                "YYGL/code/assessment-management/tracked.txt",
            ],
        );
        assert_eq!(
            staged_status.trim(),
            "YYGL/code/assessment-management/tracked.txt"
        );

        let outside_error = service
            .stage(&workspace_id, Some(""), &["../outside.txt".to_string()])
            .expect_err("parent traversal should still be rejected");
        assert!(outside_error.to_string().contains("GIT_PATH_INVALID"));

        fs::remove_dir_all(parent_root).expect("parent repo root should be removed");
    }

    #[test]
    fn parent_repository_scope_discards_untracked_workspace_files() {
        let parent_root =
            std::env::temp_dir().join(format!("gt-git-parent-discard-{}", Uuid::new_v4()));
        fs::create_dir_all(&parent_root).expect("create parent repo root");
        init_repo(&parent_root);
        fs::create_dir_all(parent_root.join("YYGL/code/assessment-management"))
            .expect("create nested workspace");
        fs::write(
            parent_root.join("YYGL/code/assessment-management/tracked.txt"),
            "base\n",
        )
        .expect("write tracked file");
        run_git(&parent_root, &["add", "."]);
        run_git(&parent_root, &["commit", "-m", "init parent"]);

        let workspace_root = parent_root.join("YYGL/code/assessment-management");
        let workspace_id = WorkspaceId::new(format!("ws-test-{}", Uuid::new_v4()));
        let service = GitService::new(TestWorkspaceService {
            root: workspace_root.clone(),
        });

        fs::write(workspace_root.join("scratch.txt"), "draft\n")
            .expect("write untracked workspace file");
        let discarded = service
            .discard(&workspace_id, Some(""), &["scratch.txt".to_string()], true)
            .expect("discard should remove parent-scoped untracked file");
        assert_eq!(discarded, 1);
        assert!(!workspace_root.join("scratch.txt").exists());

        let status = service
            .status_repo(&workspace_id, Some(""))
            .expect("status should succeed after discard");
        assert!(status.files.iter().all(|file| file.path != "scratch.txt"));

        fs::remove_dir_all(parent_root).expect("parent repo root should be removed");
    }

    #[test]
    fn status_reports_untracked_files_inside_directories() {
        let (workspace_id, root, service) = create_temp_repo();
        fs::create_dir_all(root.join("new-dir")).expect("create untracked directory");
        fs::write(root.join("new-dir/note.txt"), "draft\n").expect("write untracked nested file");

        let status = service
            .status_repo(&workspace_id, None)
            .expect("status should include untracked nested file");

        assert!(
            status.files.iter().any(|file| {
                file.path == "new-dir/note.txt"
                    && file.repo_relative_path == "new-dir/note.txt"
                    && file.status == "?"
                    && !file.content_signature.is_empty()
            }),
            "untracked file inside directory should be reported as a file entry"
        );
        assert!(
            status
                .files
                .iter()
                .all(|file| file.path != "new-dir" && file.path != "new-dir/"),
            "untracked directory should not be reported as a change item"
        );

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn status_content_signature_changes_when_modified_file_changes() {
        let (workspace_id, root, service) = create_temp_repo();
        fs::write(root.join("tracked.txt"), "changed once\n").expect("modify tracked file once");
        let first = service
            .status_repo(&workspace_id, None)
            .expect("first status should succeed");
        let first_file = first
            .files
            .iter()
            .find(|file| file.path == "tracked.txt")
            .expect("tracked file should be dirty");
        assert_eq!(first_file.status, "M");
        assert!(!first_file.content_signature.is_empty());

        fs::write(root.join("tracked.txt"), "changed twice with more bytes\n")
            .expect("modify tracked file again");
        let second = service
            .status_repo(&workspace_id, None)
            .expect("second status should succeed");
        let second_file = second
            .files
            .iter()
            .find(|file| file.path == "tracked.txt")
            .expect("tracked file should still be dirty");
        assert_eq!(second_file.status, "M");
        assert_ne!(first_file.content_signature, second_file.content_signature);

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn repository_cache_invalidation_discovers_new_nested_repository() {
        let (workspace_id, root, service) = create_temp_repo();

        let initial = service
            .status(&workspace_id)
            .expect("initial status should succeed");
        assert_eq!(initial.repositories.len(), 1);

        let nested_root = create_nested_repo(&root, "packages/beta", "beta.txt");

        let cached = service
            .status(&workspace_id)
            .expect("cached status should succeed");
        assert_eq!(
            cached.repositories.len(),
            1,
            "repository discovery should stay cached until invalidated"
        );

        service
            .invalidate_repository_cache(&workspace_id)
            .expect("cache invalidation should succeed");
        fs::write(nested_root.join("beta.txt"), "beta changed\n")
            .expect("nested file should be updated");

        let refreshed = service
            .status(&workspace_id)
            .expect("refreshed status should succeed");
        assert_eq!(refreshed.repositories.len(), 2);
        assert!(
            refreshed
                .repositories
                .iter()
                .any(|repository| repository.repository_path == "packages/beta"),
            "new nested repository should be visible after invalidation"
        );

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn status_discovers_repositories_nested_under_other_repositories() {
        let (workspace_id, root, service) = create_temp_repo();
        let nested_root = create_nested_repo(&root, "packages/alpha", "alpha.txt");
        let deep_nested_root = create_nested_repo(&nested_root, "examples/demo", "demo.txt");

        fs::write(deep_nested_root.join("demo.txt"), "demo changed\n")
            .expect("deep nested file should be updated");

        service
            .invalidate_repository_cache(&workspace_id)
            .expect("cache invalidation should succeed");

        let summary = service
            .status(&workspace_id)
            .expect("status should succeed");
        assert_eq!(summary.repositories.len(), 3);
        assert!(
            summary
                .repositories
                .iter()
                .any(|repository| repository.repository_path == "packages/alpha"),
            "first nested repository should be included",
        );
        assert!(
            summary
                .repositories
                .iter()
                .any(|repository| repository.repository_path == "packages/alpha/examples/demo"),
            "deep nested repository should be included",
        );
        assert!(
            summary.files.iter().any(|file| {
                file.path == "packages/alpha/examples/demo/demo.txt"
                    && file.repository_path == "packages/alpha/examples/demo"
            }),
            "deep nested repository change should stay scoped to the deepest repository",
        );

        fs::remove_dir_all(root).expect("temp repo should be removed");
    }

    #[test]
    fn cached_multi_repository_status_stays_within_interactive_budget() {
        let (workspace_id, root, service) = create_temp_repo();

        fs::write(root.join("tracked.txt"), "root changed\n").expect("root file should be updated");

        for index in 0..8 {
            let relative_path = format!("packages/pkg-{index:02}");
            let tracked_file_name = format!("file-{index:02}.txt");
            let nested_root = create_nested_repo(&root, &relative_path, &tracked_file_name);
            fs::write(
                nested_root.join(&tracked_file_name),
                format!("nested change {index}\n"),
            )
            .expect("nested file should be updated");
        }

        service
            .invalidate_repository_cache(&workspace_id)
            .expect("cache invalidation should succeed");

        let warmed = service
            .status(&workspace_id)
            .expect("warm status should succeed");
        assert_eq!(warmed.repositories.len(), 9);

        let started_at = Instant::now();
        let refreshed = service
            .status(&workspace_id)
            .expect("cached status should succeed");
        let elapsed_ms = started_at.elapsed().as_millis();

        assert_eq!(refreshed.repositories.len(), 9);
        assert!(
            elapsed_ms < GIT_STATUS_TARGET_BUDGET_MS,
            "cached multi-repository status exceeded budget: {elapsed_ms}ms >= {GIT_STATUS_TARGET_BUDGET_MS}ms",
        );

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
            .diff_file_expansion(&workspace_id, None, "tracked.txt", None, true)
            .expect("staged compare should succeed");
        let unstaged = service
            .diff_file_expansion(&workspace_id, None, "tracked.txt", None, false)
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
            .diff_file(&workspace_id, None, "Widget.jsx", false)
            .expect("unstaged raw diff should succeed");
        let structured = service
            .diff_file_structured(&workspace_id, None, "Widget.jsx", false)
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

    #[test]
    fn test_workspace_service_methods_cover_trait_defaults() {
        let root = std::env::temp_dir().join(format!("gt-git-service-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp root should be created");
        let workspace_id = WorkspaceId::new("ws-trait");
        let workspace = TestWorkspaceService { root: root.clone() };

        assert!(workspace.list().expect("list should succeed").is_empty());
        assert!(workspace.open(&root).is_err());
        assert!(!workspace
            .close(&workspace_id)
            .expect("close should return false"));
        assert_eq!(
            workspace
                .switch_active(&workspace_id)
                .expect("switch should echo id"),
            workspace_id
        );
        assert_eq!(
            workspace
                .restore_session(&workspace_id)
                .expect("restore should succeed")
                .terminals
                .len(),
            0
        );

        fs::remove_dir_all(root).expect("temp root should be removed");
    }
}
