use git2::{BranchType, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
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

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

#[cfg(test)]
mod tests {
    use super::GitService;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    use uuid::Uuid;
    use vb_abstractions::WorkspaceService;
    use vb_workspace::InMemoryWorkspaceService;

    struct TempRepo {
        path: PathBuf,
    }

    impl TempRepo {
        fn create() -> Self {
            let path = std::env::temp_dir().join(format!("gtoffice-git-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("failed to create temp repo");
            run_git(&path, &["init", "-b", "main"]);
            run_git(&path, &["config", "user.email", "gtoffice@example.com"]);
            run_git(&path, &["config", "user.name", "GT Office Bot"]);
            Self { path }
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn run_git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("failed to run git command");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn status_reports_modified_file() {
        let repo = TempRepo::create();
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&repo.path).expect("open workspace");
        let git_service = GitService::new(service);

        let file = repo.path.join("README.md");
        fs::write(&file, "hello\n").expect("write initial");
        run_git(&repo.path, &["add", "README.md"]);
        run_git(&repo.path, &["commit", "-m", "init", "--no-gpg-sign"]);
        fs::write(&file, "hello world\n").expect("write modified");

        let status = git_service
            .status(&workspace.workspace_id)
            .expect("read status");
        assert_eq!(status.branch, "main");
        assert!(status.files.iter().any(|file| file.path == "README.md"));
    }

    #[test]
    fn commit_returns_head_sha() {
        let repo = TempRepo::create();
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&repo.path).expect("open workspace");
        let git_service = GitService::new(service);

        fs::write(repo.path.join("a.txt"), "a").expect("write file");
        git_service
            .stage(&workspace.workspace_id, &[String::from("a.txt")])
            .expect("stage");

        let commit_id = git_service
            .commit(&workspace.workspace_id, "feat: add a")
            .expect("commit");

        assert_eq!(commit_id.len(), 40);
    }

    #[test]
    fn stage_rejects_parent_traversal() {
        let repo = TempRepo::create();
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&repo.path).expect("open workspace");
        let git_service = GitService::new(service);

        let error = git_service
            .stage(&workspace.workspace_id, &[String::from("../x")])
            .expect_err("expected invalid path");
        assert!(error.to_string().contains("GIT_PATH_INVALID"));
    }

    #[test]
    fn branch_checkout_and_log_work() {
        let repo = TempRepo::create();
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&repo.path).expect("open workspace");
        let git_service = GitService::new(service);

        fs::write(repo.path.join("a.txt"), "a\n").expect("write file");
        git_service
            .stage(&workspace.workspace_id, &[String::from("a.txt")])
            .expect("stage");
        git_service
            .commit(&workspace.workspace_id, "feat: add a")
            .expect("commit");

        git_service
            .create_branch(&workspace.workspace_id, "feature/test", None)
            .expect("create branch");
        git_service
            .checkout(&workspace.workspace_id, "feature/test", false, None)
            .expect("checkout branch");

        let branches = git_service
            .list_branches(&workspace.workspace_id, false)
            .expect("list branches");
        assert!(branches.iter().any(|item| item.name == "feature/test"));
        assert!(branches
            .iter()
            .any(|item| item.name == "feature/test" && item.current));

        let log_entries = git_service
            .log(&workspace.workspace_id, 10, 0)
            .expect("git log");
        assert!(!log_entries.is_empty());
        assert_eq!(log_entries[0].summary, "feat: add a");
    }

    #[test]
    fn stash_push_and_pop_work() {
        let repo = TempRepo::create();
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&repo.path).expect("open workspace");
        let git_service = GitService::new(service);

        fs::write(repo.path.join("a.txt"), "a\n").expect("write file");
        git_service
            .stage(&workspace.workspace_id, &[String::from("a.txt")])
            .expect("stage");
        git_service
            .commit(&workspace.workspace_id, "feat: add a")
            .expect("commit");

        fs::write(repo.path.join("a.txt"), "changed\n").expect("modify file");
        git_service
            .stash_push(&workspace.workspace_id, Some("wip"), false, false)
            .expect("stash push");

        let stash_entries = git_service
            .stash_list(&workspace.workspace_id, 10)
            .expect("stash list");
        assert!(!stash_entries.is_empty());
        assert!(stash_entries[0].summary.contains("wip"));

        git_service
            .stash_pop(&workspace.workspace_id, None)
            .expect("stash pop");
    }

    #[test]
    fn init_repo_bootstraps_non_git_workspace() {
        let path = std::env::temp_dir().join(format!("gtoffice-git-init-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        let service = InMemoryWorkspaceService::new();
        let workspace = service.open(&path).expect("open workspace");
        let git_service = GitService::new(service);

        let branch = git_service
            .init_repo(&workspace.workspace_id, Some("main"))
            .expect("init repo");
        assert_eq!(branch, "main");

        fs::remove_dir_all(&path).expect("cleanup temp dir");
    }
}
