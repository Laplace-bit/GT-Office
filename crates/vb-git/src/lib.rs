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

/// Maximum line length for word-level diff computation (performance optimization)
const MAX_WORD_DIFF_LINE_LENGTH: usize = 500;

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
            .renames_head_to_index(true)
            .renames_index_to_workdir(true)
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
        let output = Command::new("git")
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
                    if message.contains("not a git repository") {
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
    pub fn diff_file(&self, workspace_id: &WorkspaceId, path: &str) -> AbstractionResult<String> {
        Self::validate_relative_repo_path(path)?;
        let root = self.workspace_root(workspace_id)?;
        self.run_git(
            &root,
            &["diff", "--no-ext-diff", "--", path],
            "GIT_DIFF_FAILED",
        )
    }

    /// High-performance structured diff using git2 library
    /// Returns parsed diff hunks for immediate rendering without frontend parsing
    #[instrument(skip(self), fields(workspace_id = %workspace_id, path = path))]
    pub fn diff_file_structured(
        &self,
        workspace_id: &WorkspaceId,
        path: &str,
    ) -> AbstractionResult<GitDiffStructured> {
        Self::validate_relative_repo_path(path)?;
        let root = self.workspace_root(workspace_id)?;

        // Try git2 first for performance, fallback to git command
        match self.diff_file_with_git2(&root, path) {
            Ok(result) => Ok(result),
            Err(_) => {
                // Fallback to git command and parse the output
                let patch = self.run_git(
                    &root,
                    &["diff", "--no-ext-diff", "--", path],
                    "GIT_DIFF_FAILED",
                )?;
                Ok(self.parse_diff_patch(&patch, path))
            }
        }
    }

    /// Use git2 library for high-performance diff
    fn diff_file_with_git2(&self, root: &Path, path: &str) -> AbstractionResult<GitDiffStructured> {
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
        diff_opts.include_untracked(true);
        diff_opts.recurse_untracked_dirs(true);
        diff_opts.context_lines(3);

        // Get the diff
        let diff = if let Some(ref tree) = head_tree {
            repo.diff_tree_to_workdir_with_index(Some(tree), Some(&mut diff_opts))
        } else {
            repo.diff_tree_to_workdir_with_index(None, Some(&mut diff_opts))
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
                let is_new_hunk = current_hunk.as_ref().map_or(true, |h| h.header != header);

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

        // If no structured diff available, get raw patch
        if result.hunks.is_empty() && !result.is_binary {
            result.patch = self
                .run_git(
                    root,
                    &["diff", "--no-ext-diff", "--", path],
                    "GIT_DIFF_FAILED",
                )
                .unwrap_or_default();
        } else {
            result.patch = patch_content;
        }

        Ok(result)
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

        let mut restore_args = vec![
            "restore".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        restore_args.extend(paths.iter().cloned());
        let restore_refs = restore_args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(&root, &restore_refs, "GIT_DISCARD_FAILED")?;

        if include_untracked {
            let mut clean_args = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
            clean_args.extend(paths.iter().cloned());
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


