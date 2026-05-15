use gt_abstractions::ConflictStatus;
use gt_abstractions::WorkspaceService;
use gt_git::GitService;
use gt_workspace::InMemoryWorkspaceService;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

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

    fn create_bare() -> Self {
        let path = std::env::temp_dir().join(format!("gtoffice-git-bare-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("failed to create temp bare repo");
        run_git(&path, &["init", "--bare", "--initial-branch=main"]);
        Self { path }
    }

    fn clone_from(source: &Path) -> Self {
        let path = std::env::temp_dir().join(format!("gtoffice-git-clone-test-{}", Uuid::new_v4()));
        let output = Command::new("git")
            .arg("clone")
            .arg(source)
            .arg(&path)
            .output()
            .expect("failed to clone repo");
        assert!(
            output.status.success(),
            "git clone failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
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

fn run_git_output(root: &Path, args: &[&str]) -> String {
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
    String::from_utf8(output.stdout).expect("git output should be utf-8")
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
        .stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage");

    let commit_id = git_service
        .commit(&workspace.workspace_id, None, "feat: add a")
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
        .stage(&workspace.workspace_id, None, &[String::from("../x")])
        .expect_err("expected invalid path");
    assert!(error.to_string().contains("GIT_PATH_INVALID"));
}

#[test]
fn stage_skips_ignored_paths_without_failing() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join(".gitignore"), ".gtoffice/\n").expect("write gitignore");
    fs::create_dir_all(repo.path.join(".gtoffice")).expect("create ignored dir");
    fs::write(repo.path.join(".gtoffice/config.json"), "{}\n").expect("write ignored file");

    let staged = git_service
        .stage(&workspace.workspace_id, None, &[String::from(".gtoffice")])
        .expect("stage ignored path should not fail");

    assert_eq!(staged, 0);

    let status = git_service
        .status(&workspace.workspace_id)
        .expect("read status after ignored stage");
    assert!(status.files.iter().all(|file| file.path != ".gtoffice"));
}

#[test]
fn stage_mixed_paths_skips_ignored_and_stages_remaining_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join(".gitignore"), ".gtoffice/\n").expect("write gitignore");
    fs::write(repo.path.join("tracked.txt"), "tracked\n").expect("write tracked file");
    fs::create_dir_all(repo.path.join(".gtoffice")).expect("create ignored dir");
    fs::write(repo.path.join(".gtoffice/config.json"), "{}\n").expect("write ignored file");

    let staged = git_service
        .stage(
            &workspace.workspace_id,
            None,
            &[String::from("tracked.txt"), String::from(".gtoffice")],
        )
        .expect("mixed stage should succeed");

    assert_eq!(staged, 1);

    let status = git_service
        .status(&workspace.workspace_id)
        .expect("read status after mixed stage");
    let tracked = status
        .files
        .iter()
        .find(|file| file.path == "tracked.txt")
        .expect("tracked file should be present");
    assert!(tracked.staged);
    assert!(status.files.iter().all(|file| file.path != ".gtoffice"));
}

#[test]
fn branch_checkout_and_log_work() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join("a.txt"), "a\n").expect("write file");
    git_service
        .stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage");
    git_service
        .commit(&workspace.workspace_id, None, "feat: add a")
        .expect("commit");

    git_service
        .create_branch(&workspace.workspace_id, None, "feature/test", None)
        .expect("create branch");
    git_service
        .checkout(&workspace.workspace_id, None, "feature/test", false, None)
        .expect("checkout branch");

    let branches = git_service
        .list_branches(&workspace.workspace_id, None, false)
        .expect("list branches");
    assert!(branches.iter().any(|item| item.name == "feature/test"));
    assert!(branches
        .iter()
        .any(|item| item.name == "feature/test" && item.current));

    let log_entries = git_service
        .log(&workspace.workspace_id, None, 10, 0)
        .expect("git log");
    assert!(!log_entries.is_empty());
    assert_eq!(log_entries[0].summary, "feat: add a");
}

#[test]
fn checkout_create_branch_from_start_point_and_force_delete_work() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join("timeline.txt"), "v1\n").expect("write file");
    git_service
        .stage(
            &workspace.workspace_id,
            None,
            &[String::from("timeline.txt")],
        )
        .expect("stage first");
    let first_commit = git_service
        .commit(&workspace.workspace_id, None, "first")
        .expect("commit first");

    fs::write(repo.path.join("timeline.txt"), "v2\n").expect("write updated file");
    git_service
        .stage(
            &workspace.workspace_id,
            None,
            &[String::from("timeline.txt")],
        )
        .expect("stage second");
    let second_commit = git_service
        .commit(&workspace.workspace_id, None, "second")
        .expect("commit second");

    git_service
        .checkout(
            &workspace.workspace_id,
            None,
            "feature/from-first",
            true,
            Some(&first_commit),
        )
        .expect("create and checkout branch from first commit");

    let head_after_checkout = run_git_output(&repo.path, &["rev-parse", "HEAD"]);
    assert_eq!(head_after_checkout.trim(), first_commit);

    let branches = git_service
        .list_branches(&workspace.workspace_id, None, false)
        .expect("list branches");
    assert!(branches
        .iter()
        .any(|branch| branch.name == "feature/from-first" && branch.current));

    fs::write(repo.path.join("feature-only.txt"), "feature branch work\n")
        .expect("write branch file");
    git_service
        .stage(
            &workspace.workspace_id,
            None,
            &[String::from("feature-only.txt")],
        )
        .expect("stage branch file");
    git_service
        .commit(&workspace.workspace_id, None, "branch only")
        .expect("commit branch file");

    git_service
        .checkout(&workspace.workspace_id, None, "main", false, None)
        .expect("checkout main");
    let head_on_main = run_git_output(&repo.path, &["rev-parse", "HEAD"]);
    assert_eq!(head_on_main.trim(), second_commit);

    git_service
        .delete_branch(&workspace.workspace_id, None, "feature/from-first", true)
        .expect("force delete branch");

    let branches_after_delete = git_service
        .list_branches(&workspace.workspace_id, None, false)
        .expect("list branches after delete");
    assert!(branches_after_delete
        .iter()
        .all(|branch| branch.name != "feature/from-first"));
}

#[test]
fn commit_detail_includes_changed_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join("README.md"), "hello\n").expect("write file");
    git_service
        .stage(&workspace.workspace_id, None, &[String::from("README.md")])
        .expect("stage");
    let commit_id = git_service
        .commit(&workspace.workspace_id, None, "feat: add readme")
        .expect("commit");

    let detail = git_service
        .commit_detail(&workspace.workspace_id, None, &commit_id)
        .expect("commit detail");
    assert_eq!(detail.commit, commit_id);
    assert_eq!(detail.summary, "feat: add readme");
    assert!(detail.files.iter().any(|item| item.path == "README.md"));
}

#[test]
fn commit_detail_tracks_renamed_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("before.txt"), "hello\n").expect("write initial file");
    git.stage(&workspace.workspace_id, None, &[String::from("before.txt")])
        .expect("stage initial");
    git.commit(&workspace.workspace_id, None, "initial")
        .expect("commit initial");

    run_git(&repo.path, &["mv", "before.txt", "after.txt"]);
    let commit_id = git
        .commit(&workspace.workspace_id, None, "rename file")
        .expect("commit rename");

    let detail = git
        .commit_detail(&workspace.workspace_id, None, &commit_id)
        .expect("commit detail");
    let renamed = detail
        .files
        .iter()
        .find(|item| item.path == "after.txt")
        .expect("renamed entry");
    assert_eq!(renamed.status, "R");
    assert_eq!(renamed.previous_path.as_deref(), Some("before.txt"));
}

#[test]
fn commit_detail_tracks_copied_files_and_body() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("source.txt"), "hello\n").expect("write source file");
    git.stage(&workspace.workspace_id, None, &[String::from("source.txt")])
        .expect("stage source");
    git.commit(&workspace.workspace_id, None, "initial")
        .expect("commit initial");

    fs::copy(repo.path.join("source.txt"), repo.path.join("copy.txt")).expect("copy file");
    run_git(&repo.path, &["add", "copy.txt"]);
    let commit_id = git
        .commit(&workspace.workspace_id, None, "copy file\n\nwith body")
        .expect("commit copy");

    let detail = git
        .commit_detail(&workspace.workspace_id, None, &commit_id)
        .expect("commit detail");
    assert_eq!(detail.summary, "copy file");
    assert!(detail.body.contains("with body"));
    let copied = detail
        .files
        .iter()
        .find(|item| item.path == "copy.txt")
        .expect("copied entry");
    assert!(matches!(copied.status.as_str(), "A" | "C"));
}

#[test]
fn diff_file_and_structured_cover_staged_and_untracked_paths() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("tracked.txt"), "changed\n").expect("modify tracked file");
    git.stage(
        &workspace.workspace_id,
        None,
        &[String::from("tracked.txt")],
    )
    .expect("stage tracked file");

    let staged_patch = git
        .diff_file(&workspace.workspace_id, None, "tracked.txt", true)
        .expect("staged diff");
    assert!(staged_patch.contains("tracked.txt"));
    assert!(staged_patch.contains("@@"));

    let staged_structured = git
        .diff_file_structured(&workspace.workspace_id, None, "tracked.txt", true)
        .expect("structured staged diff");
    assert!(!staged_structured.hunks.is_empty());
    assert!(!staged_structured.patch.is_empty());

    fs::write(repo.path.join("scratch.txt"), "brand new\n").expect("write untracked file");
    let untracked_structured = git
        .diff_file_structured(&workspace.workspace_id, None, "scratch.txt", false)
        .expect("structured untracked diff");
    assert!(untracked_structured.is_new);
    assert_eq!(untracked_structured.path, "scratch.txt");
}

#[test]
fn diff_file_expansion_handles_binary_rename_and_nested_repository_paths() {
    let workspace_root =
        std::env::temp_dir().join(format!("gtoffice-git-diff-expansion-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace_root).expect("create workspace root");

    let nested_repo = workspace_root.join("packages/app");
    fs::create_dir_all(&nested_repo).expect("create nested repo");
    run_git(&nested_repo, &["init", "-b", "main"]);
    run_git(
        &nested_repo,
        &["config", "user.email", "gtoffice@example.com"],
    );
    run_git(&nested_repo, &["config", "user.name", "GT Office Bot"]);

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&workspace_root).expect("open workspace");
    let git = GitService::new(service);

    fs::write(nested_repo.join("before.bin"), vec![0_u8, 159, 146, 150])
        .expect("write binary file");
    git.stage(
        &workspace.workspace_id,
        Some("packages/app"),
        &[String::from("packages/app/before.bin")],
    )
    .expect("stage binary");
    git.commit(&workspace.workspace_id, Some("packages/app"), "binary base")
        .expect("commit binary base");

    run_git(&nested_repo, &["mv", "before.bin", "after.bin"]);
    let expansion = git
        .diff_file_expansion(
            &workspace.workspace_id,
            Some("packages/app"),
            "packages/app/after.bin",
            Some("packages/app/before.bin"),
            false,
        )
        .expect("binary rename expansion");
    assert!(expansion.is_binary);
    assert_eq!(expansion.path, "after.bin");
    assert_eq!(expansion.old_path.as_deref(), Some("before.bin"));
    assert!(expansion.full_diff.is_none());
}

#[test]
fn stash_push_and_pop_work() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join("a.txt"), "a\n").expect("write file");
    git_service
        .stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage");
    git_service
        .commit(&workspace.workspace_id, None, "feat: add a")
        .expect("commit");

    fs::write(repo.path.join("a.txt"), "changed\n").expect("modify file");
    git_service
        .stash_push(&workspace.workspace_id, None, Some("wip"), false, false)
        .expect("stash push");

    let stash_entries = git_service
        .stash_list(&workspace.workspace_id, None, 10)
        .expect("stash list");
    assert!(!stash_entries.is_empty());
    assert!(stash_entries[0].summary.contains("wip"));

    git_service
        .stash_pop(&workspace.workspace_id, None, None)
        .expect("stash pop");
}

#[test]
fn stash_push_supports_include_untracked_keep_index_and_named_pop() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("a.txt"), "base\n").expect("write tracked file");
    git.stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage tracked file");
    git.commit(&workspace.workspace_id, None, "base")
        .expect("commit base");

    fs::write(repo.path.join("a.txt"), "staged change\n").expect("modify tracked file");
    fs::write(repo.path.join("scratch.txt"), "untracked\n").expect("write untracked file");
    git.stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage tracked change");

    git.stash_push(
        &workspace.workspace_id,
        None,
        Some("keep index"),
        true,
        true,
    )
    .expect("stash with flags");

    let staged_after_stash = run_git_output(&repo.path, &["diff", "--cached", "--name-only"]);
    assert_eq!(staged_after_stash.trim(), "a.txt");
    assert!(!repo.path.join("scratch.txt").exists());

    let entries = git
        .stash_list(&workspace.workspace_id, None, 10)
        .expect("list stashes");
    assert_eq!(entries.len(), 1);

    git.stash_pop(&workspace.workspace_id, None, Some(" stash@{0} "))
        .expect("pop named stash");
    assert!(repo.path.join("scratch.txt").exists());
}

#[test]
fn unstage_restores_index_and_empty_requests_are_noop() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    assert_eq!(
        git.unstage(&workspace.workspace_id, None, &[])
            .expect("empty unstage"),
        0
    );

    fs::write(repo.path.join("base.txt"), "base\n").expect("write base");
    git.stage(&workspace.workspace_id, None, &[String::from("base.txt")])
        .expect("stage base");
    git.commit(&workspace.workspace_id, None, "base")
        .expect("commit base");

    fs::write(repo.path.join("draft.txt"), "draft\n").expect("write draft");
    git.stage(&workspace.workspace_id, None, &[String::from("draft.txt")])
        .expect("stage draft");

    assert_eq!(
        git.unstage(&workspace.workspace_id, None, &[String::from("draft.txt")])
            .expect("unstage draft"),
        1
    );

    let cached = run_git_output(&repo.path, &["diff", "--cached", "--name-only"]);
    assert!(cached.trim().is_empty());
    let status = run_git_output(&repo.path, &["status", "--porcelain"]);
    assert!(status.contains("?? draft.txt"));
}

#[test]
fn stage_and_unstage_support_workspace_relative_paths_inside_nested_repo() {
    let workspace_root =
        std::env::temp_dir().join(format!("gtoffice-git-nested-stage-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace_root).expect("create workspace root");
    let nested_repo = workspace_root.join("packages/app");
    fs::create_dir_all(&nested_repo).expect("create nested repo");
    run_git(&nested_repo, &["init", "-b", "main"]);
    run_git(
        &nested_repo,
        &["config", "user.email", "gtoffice@example.com"],
    );
    run_git(&nested_repo, &["config", "user.name", "GT Office Bot"]);
    fs::write(nested_repo.join("tracked.txt"), "base\n").expect("write tracked");
    run_git(&nested_repo, &["add", "tracked.txt"]);
    run_git(&nested_repo, &["commit", "-m", "init", "--no-gpg-sign"]);

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&workspace_root).expect("open workspace");
    let git = GitService::new(service);

    fs::write(nested_repo.join("tracked.txt"), "updated\n").expect("update tracked");
    assert_eq!(
        git.stage(
            &workspace.workspace_id,
            Some("packages/app"),
            &[String::from("packages/app/tracked.txt")],
        )
        .expect("stage nested path"),
        1
    );

    assert_eq!(
        git.unstage(
            &workspace.workspace_id,
            Some("packages/app"),
            &[String::from("packages/app/tracked.txt")],
        )
        .expect("unstage nested path"),
        1
    );
}

#[test]
fn commit_and_amend_reject_empty_messages() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    let commit_error = git
        .commit(&workspace.workspace_id, None, "   ")
        .expect_err("empty commit message should fail");
    assert!(commit_error
        .to_string()
        .contains("GIT_COMMIT_MESSAGE_INVALID"));

    fs::write(repo.path.join("a.txt"), "a\n").expect("write file");
    git.stage(&workspace.workspace_id, None, &[String::from("a.txt")])
        .expect("stage file");
    git.commit(&workspace.workspace_id, None, "initial")
        .expect("commit file");

    let amend_error = git
        .commit_amend(&workspace.workspace_id, None, "  ")
        .expect_err("empty amend message should fail");
    assert!(amend_error
        .to_string()
        .contains("GIT_COMMIT_MESSAGE_INVALID"));
}

#[test]
fn discard_rejects_empty_paths() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    let error = git
        .discard(&workspace.workspace_id, None, &[], false)
        .expect_err("discard without paths should fail");
    assert!(error.to_string().contains("GIT_DISCARD_PATHS_REQUIRED"));
}

#[test]
fn fetch_pull_push_and_remote_branch_listing_work() {
    let remote = TempRepo::create_bare();
    let local = TempRepo::create();
    run_git(
        &local.path,
        &[
            "remote",
            "add",
            "origin",
            remote.path.to_str().expect("remote path"),
        ],
    );

    let local_service = InMemoryWorkspaceService::new();
    let local_workspace = local_service
        .open(&local.path)
        .expect("open local workspace");
    let local_git = GitService::new(local_service);

    fs::write(local.path.join("shared.txt"), "v1\n").expect("write initial file");
    local_git
        .stage(
            &local_workspace.workspace_id,
            None,
            &[String::from("shared.txt")],
        )
        .expect("stage initial");
    let first_commit = local_git
        .commit(&local_workspace.workspace_id, None, "initial")
        .expect("commit initial");

    let push_result = local_git
        .push(
            &local_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            true,
            false,
        )
        .expect("push initial main");
    assert_eq!(push_result.remote, "origin");
    assert_eq!(push_result.branch.as_deref(), Some("main"));
    assert!(push_result.set_upstream);

    let remote_main = run_git_output(&remote.path, &["rev-parse", "refs/heads/main"]);
    assert_eq!(remote_main.trim(), first_commit);

    let local_branches = local_git
        .list_branches(&local_workspace.workspace_id, None, true)
        .expect("list local and remote branches");
    assert!(local_branches.iter().any(|branch| {
        branch.name == "main"
            && branch.upstream.as_deref() == Some("origin/main")
            && branch.tracking.as_deref() == Some("=")
    }));
    assert!(local_branches
        .iter()
        .any(|branch| branch.name == "origin/main"));

    let clone = TempRepo::clone_from(&remote.path);
    let clone_service = InMemoryWorkspaceService::new();
    let clone_workspace = clone_service
        .open(&clone.path)
        .expect("open clone workspace");
    let clone_git = GitService::new(clone_service);

    fs::write(local.path.join("shared.txt"), "v2 from local\n").expect("update local file");
    local_git
        .stage(
            &local_workspace.workspace_id,
            None,
            &[String::from("shared.txt")],
        )
        .expect("stage local update");
    let second_commit = local_git
        .commit(&local_workspace.workspace_id, None, "second")
        .expect("commit local update");
    local_git
        .push(
            &local_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            false,
            false,
        )
        .expect("push second commit");

    let fetch_result = clone_git
        .fetch(
            &clone_workspace.workspace_id,
            None,
            Some("origin"),
            true,
            true,
        )
        .expect("fetch remote changes");
    assert_eq!(fetch_result.remote, "origin");
    assert!(fetch_result.prune);
    assert!(fetch_result.include_tags);

    let clone_remote_head = run_git_output(&clone.path, &["rev-parse", "refs/remotes/origin/main"]);
    assert_eq!(clone_remote_head.trim(), second_commit);

    let pull_result = clone_git
        .pull(
            &clone_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            false,
        )
        .expect("pull remote changes");
    assert_eq!(pull_result.remote, "origin");
    assert_eq!(pull_result.branch.as_deref(), Some("main"));
    assert!(!pull_result.rebase);
    let pulled_content =
        fs::read_to_string(clone.path.join("shared.txt")).expect("read pulled file");
    assert_eq!(pulled_content, "v2 from local\n");

    fs::write(clone.path.join("clone.txt"), "from clone\n").expect("write clone file");
    clone_git
        .stage(
            &clone_workspace.workspace_id,
            None,
            &[String::from("clone.txt")],
        )
        .expect("stage clone file");
    let clone_commit = clone_git
        .commit(&clone_workspace.workspace_id, None, "clone push")
        .expect("commit clone file");
    clone_git
        .push(
            &clone_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            false,
            false,
        )
        .expect("push clone commit");

    let remote_after_clone_push = run_git_output(&remote.path, &["rev-parse", "refs/heads/main"]);
    assert_eq!(remote_after_clone_push.trim(), clone_commit);
}

#[test]
fn fetch_pull_push_cover_optional_flags() {
    let remote = TempRepo::create_bare();
    let local = TempRepo::create();
    run_git(
        &local.path,
        &[
            "remote",
            "add",
            "origin",
            remote.path.to_str().expect("remote path"),
        ],
    );

    let local_service = InMemoryWorkspaceService::new();
    let local_workspace = local_service
        .open(&local.path)
        .expect("open local workspace");
    let local_git = GitService::new(local_service);

    fs::write(local.path.join("shared.txt"), "v1\n").expect("write initial file");
    local_git
        .stage(
            &local_workspace.workspace_id,
            None,
            &[String::from("shared.txt")],
        )
        .expect("stage initial");
    local_git
        .commit(&local_workspace.workspace_id, None, "initial")
        .expect("commit initial");
    local_git
        .push(
            &local_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            true,
            false,
        )
        .expect("push initial main");

    let clone = TempRepo::clone_from(&remote.path);
    let clone_service = InMemoryWorkspaceService::new();
    let clone_workspace = clone_service
        .open(&clone.path)
        .expect("open clone workspace");
    let clone_git = GitService::new(clone_service);

    fs::write(local.path.join("shared.txt"), "v2\n").expect("update local file");
    local_git
        .stage(
            &local_workspace.workspace_id,
            None,
            &[String::from("shared.txt")],
        )
        .expect("stage update");
    let updated_commit = local_git
        .commit(&local_workspace.workspace_id, None, "second")
        .expect("commit update");
    local_git
        .push(
            &local_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            false,
            false,
        )
        .expect("push update");

    let fetch = clone_git
        .fetch(
            &clone_workspace.workspace_id,
            None,
            Some("  "),
            false,
            false,
        )
        .expect("fetch default remote without tags");
    assert_eq!(fetch.remote, "origin");
    assert!(!fetch.prune);
    assert!(!fetch.include_tags);

    let pull = clone_git
        .pull(
            &clone_workspace.workspace_id,
            None,
            Some("origin"),
            None,
            true,
        )
        .expect("pull with rebase");
    assert_eq!(pull.remote, "origin");
    assert_eq!(pull.branch, None);
    assert!(pull.rebase);
    assert_eq!(
        run_git_output(&clone.path, &["rev-parse", "HEAD"]).trim(),
        updated_commit
    );

    fs::write(clone.path.join("clone.txt"), "from clone\n").expect("write clone file");
    clone_git
        .stage(
            &clone_workspace.workspace_id,
            None,
            &[String::from("clone.txt")],
        )
        .expect("stage clone file");
    let clone_commit = clone_git
        .commit(&clone_workspace.workspace_id, None, "clone update")
        .expect("commit clone file");
    let push = clone_git
        .push(
            &clone_workspace.workspace_id,
            None,
            Some("origin"),
            Some("main"),
            false,
            true,
        )
        .expect("push with force-with-lease");
    assert!(push.force_with_lease);
    assert_eq!(
        run_git_output(&remote.path, &["rev-parse", "refs/heads/main"]).trim(),
        clone_commit
    );
}

#[test]
fn status_reports_ahead_and_behind_for_tracking_branch() {
    let remote = TempRepo::create_bare();
    let local = TempRepo::create();
    run_git(
        &local.path,
        &[
            "remote",
            "add",
            "origin",
            remote.path.to_str().expect("remote path"),
        ],
    );

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&local.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(local.path.join("shared.txt"), "v1\n").expect("write initial file");
    git.stage(&workspace.workspace_id, None, &[String::from("shared.txt")])
        .expect("stage initial");
    git.commit(&workspace.workspace_id, None, "initial")
        .expect("commit initial");
    git.push(
        &workspace.workspace_id,
        None,
        Some("origin"),
        Some("main"),
        true,
        false,
    )
    .expect("push initial");

    fs::write(local.path.join("shared.txt"), "local only\n").expect("write local change");
    git.stage(&workspace.workspace_id, None, &[String::from("shared.txt")])
        .expect("stage local change");
    git.commit(&workspace.workspace_id, None, "local only")
        .expect("commit local change");

    let clone = TempRepo::clone_from(&remote.path);
    fs::write(clone.path.join("remote.txt"), "remote\n").expect("write remote file");
    run_git(&clone.path, &["add", "remote.txt"]);
    run_git(
        &clone.path,
        &["commit", "-m", "remote only", "--no-gpg-sign"],
    );
    run_git(&clone.path, &["push", "origin", "main"]);

    git.fetch(&workspace.workspace_id, None, Some("origin"), false, false)
        .expect("fetch remote state");

    let status = git
        .status(&workspace.workspace_id)
        .expect("status with upstream");
    assert_eq!(status.branch, "main");
    assert_eq!(status.ahead, 1);
    assert_eq!(status.behind, 1);
}

#[test]
fn reset_rejects_invalid_mode() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    let error = git
        .reset(&workspace.workspace_id, None, "HEAD", "sideways")
        .expect_err("invalid reset mode should fail");
    assert!(error.to_string().contains("GIT_RESET_INVALID_MODE"));
}

#[test]
fn tag_list_returns_empty_for_no_tags() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Create an initial commit so HEAD exists
    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    let tags = git.tag_list(&workspace.workspace_id, None).unwrap();
    assert!(tags.is_empty());
}

#[test]
fn tag_create_lightweight_and_list() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.tag_create(&workspace.workspace_id, None, "v1.0", "HEAD", false, None)
        .unwrap();

    let tags = git.tag_list(&workspace.workspace_id, None).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v1.0");
    assert!(tags[0].tagger.is_none());
}

#[test]
fn tag_delete_removes_tag() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();
    git.tag_create(&workspace.workspace_id, None, "v1.0", "HEAD", false, None)
        .unwrap();

    git.tag_delete(&workspace.workspace_id, None, "v1.0")
        .unwrap();

    let tags = git.tag_list(&workspace.workspace_id, None).unwrap();
    assert!(tags.is_empty());
}

#[test]
fn tag_create_annotated_with_message() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.tag_create(
        &workspace.workspace_id,
        None,
        "v2.0",
        "HEAD",
        true,
        Some("Release 2.0"),
    )
    .unwrap();

    let tags = git.tag_list(&workspace.workspace_id, None).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v2.0");
    assert_eq!(tags[0].message.as_deref(), Some("Release 2.0"));
}

#[test]
fn tag_create_annotated_requires_message() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    let error = git
        .tag_create(
            &workspace.workspace_id,
            None,
            "v2.0",
            "HEAD",
            true,
            Some("  "),
        )
        .expect_err("annotated tag without message should fail");
    assert!(error
        .to_string()
        .contains("annotated tag requires a message"));
}

#[test]
fn cherry_pick_applies_commit_on_branch() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit on main
    std::fs::write(repo.path.join("file.txt"), "base").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    let _base_sha = git.commit(&workspace.workspace_id, None, "base").unwrap();

    // Create feature branch with a commit
    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    std::fs::write(repo.path.join("feature.txt"), "feature").unwrap();
    git.stage(&workspace.workspace_id, None, &["feature.txt".into()])
        .unwrap();
    let feature_sha = git
        .commit(&workspace.workspace_id, None, "add feature")
        .unwrap();

    // Go back to main
    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();

    // Cherry-pick the feature commit
    git.cherry_pick(&workspace.workspace_id, None, &feature_sha)
        .unwrap();

    // Verify the file exists on main
    assert!(repo.path.join("feature.txt").exists());
    let log = git.log(&workspace.workspace_id, None, 5, 0).unwrap();
    assert_eq!(log[0].summary, "add feature");
}

#[test]
fn revert_undoes_commit() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    std::fs::write(repo.path.join("file.txt"), "modified").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    let sha = git
        .commit(&workspace.workspace_id, None, "modify file")
        .unwrap();

    git.revert(&workspace.workspace_id, None, &sha).unwrap();

    let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
    assert_eq!(content, "original");
}

#[test]
fn merge_fast_forward_combines_branches() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit
    std::fs::write(repo.path.join("base.txt"), "base").unwrap();
    git.stage(&workspace.workspace_id, None, &["base.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    // Create feature branch
    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    std::fs::write(repo.path.join("feature.txt"), "feature").unwrap();
    git.stage(&workspace.workspace_id, None, &["feature.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature work")
        .unwrap();

    // Back to main
    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();

    // Merge feature
    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(result.success);
    assert!(result.conflicts.is_empty());
    assert!(result.merged_commit.is_some());
    assert!(repo.path.join("feature.txt").exists());
}

#[test]
fn merge_conflict_returns_conflict_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit
    std::fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    // Feature branch modifies shared.txt
    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    std::fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    // Main also modifies shared.txt
    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    std::fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    // Merge should conflict
    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);
    assert!(!result.conflicts.is_empty());
    assert!(result.conflicts.iter().any(|c| c.path == "shared.txt"));
    assert!(result
        .conflicts
        .iter()
        .any(|c| c.path == "shared.txt" && matches!(c.status, ConflictStatus::BothModified)));
}

#[test]
fn merge_no_ff_creates_explicit_merge_commit() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("base.txt"), "base").unwrap();
    git.stage(&workspace.workspace_id, None, &["base.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("feature.txt"), "feature").unwrap();
    git.stage(&workspace.workspace_id, None, &["feature.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature work")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", true)
        .unwrap();

    assert!(result.success);
    let head = run_git_output(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    let parent_count = head.split_whitespace().count() - 1;
    assert_eq!(parent_count, 2, "no-ff merge should produce a merge commit");
}

#[test]
fn merge_continue_rejects_unresolved_conflicts() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let error = git
        .merge_continue(&workspace.workspace_id, None)
        .expect_err("merge continue should fail while conflicts remain");
    assert!(error.to_string().contains("GIT_MERGE_CONFLICTS_REMAIN"));
}

#[test]
fn resolve_conflict_accepts_theirs_and_stages_result() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "base\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let remaining = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "theirs")
        .unwrap();
    assert!(remaining.is_empty());
    assert_eq!(
        fs::read_to_string(repo.path.join("shared.txt")).unwrap(),
        "feature\n"
    );

    let status = git.status(&workspace.workspace_id).unwrap();
    assert!(status
        .files
        .iter()
        .any(|file| file.path == "shared.txt" && file.status == "M"));
    let merged = git.merge_continue(&workspace.workspace_id, None).unwrap();
    assert!(!merged.is_empty());
}

#[test]
fn resolve_conflict_rejects_invalid_requests_and_accepts_ours() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    let no_merge_error = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "ours")
        .unwrap_err();
    assert!(no_merge_error
        .to_string()
        .contains("GIT_MERGE_NOT_IN_PROGRESS"));

    fs::write(repo.path.join("shared.txt"), "base\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let missing_conflict_error = git
        .resolve_conflict(&workspace.workspace_id, None, "other.txt", "ours")
        .unwrap_err();
    assert!(missing_conflict_error
        .to_string()
        .contains("GIT_CONFLICT_NOT_FOUND"));

    let invalid_side_error = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "mine")
        .unwrap_err();
    assert!(invalid_side_error
        .to_string()
        .contains("GIT_CONFLICT_SIDE_INVALID"));

    let remaining = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "ours")
        .unwrap();
    assert!(remaining.is_empty());
    assert_eq!(
        fs::read_to_string(repo.path.join("shared.txt")).unwrap(),
        "main\n"
    );
}

#[test]
fn resolve_conflict_accepts_deleted_side() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "modify on feature")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::remove_file(repo.path.join("shared.txt")).unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "delete on main")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let remaining = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "ours")
        .unwrap();
    assert!(remaining.is_empty());
    assert!(!repo.path.join("shared.txt").exists());
    assert!(!git
        .merge_continue(&workspace.workspace_id, None)
        .unwrap()
        .is_empty());
}

#[test]
fn resolve_conflict_accepts_their_deleted_side() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::remove_file(repo.path.join("shared.txt")).unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "delete on feature")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "modify on main")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);
    assert!(result.conflicts.iter().any(|conflict| {
        conflict.path == "shared.txt" && matches!(conflict.status, ConflictStatus::DeletedByThem)
    }));

    let remaining = git
        .resolve_conflict(&workspace.workspace_id, None, "shared.txt", "theirs")
        .unwrap();
    assert!(remaining.is_empty());
    assert!(!repo.path.join("shared.txt").exists());
    assert!(!git
        .merge_continue(&workspace.workspace_id, None)
        .unwrap()
        .is_empty());
}

#[test]
fn merge_continue_rejects_when_no_merge_is_in_progress() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    let error = git
        .merge_continue(&workspace.workspace_id, None)
        .expect_err("merge continue should fail without MERGE_HEAD");
    assert!(error.to_string().contains("GIT_MERGE_NOT_IN_PROGRESS"));
}

#[test]
fn merge_continue_commits_resolved_merge() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    fs::write(repo.path.join("shared.txt"), "resolved version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();

    let merge_commit = git
        .merge_continue(&workspace.workspace_id, None)
        .expect("merge continue should create merge commit");
    assert_eq!(merge_commit.len(), 40);

    let head = run_git_output(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    let parent_count = head.split_whitespace().count() - 1;
    assert_eq!(
        parent_count, 2,
        "resolved merge should create a merge commit"
    );
    assert_eq!(
        fs::read_to_string(repo.path.join("shared.txt")).unwrap(),
        "resolved version"
    );
}

#[test]
fn merge_abort_restores_pre_merge_state() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);
    assert!(repo.path.join(".git").join("MERGE_HEAD").exists());

    git.merge_abort(&workspace.workspace_id, None)
        .expect("merge abort should succeed");

    assert!(!repo.path.join(".git").join("MERGE_HEAD").exists());
    assert_eq!(
        fs::read_to_string(repo.path.join("shared.txt")).unwrap(),
        "main version"
    );
    let status = git.status(&workspace.workspace_id).unwrap();
    assert!(
        status.files.is_empty(),
        "merge abort should leave a clean worktree"
    );
}

#[test]
fn conflict_list_classifies_deleted_by_them_conflicts() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::remove_file(repo.path.join("shared.txt")).unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "delete on feature")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "modify on main")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let conflicts = git.conflict_list(&workspace.workspace_id, None).unwrap();
    assert!(conflicts.iter().any(|conflict| {
        conflict.path == "shared.txt" && matches!(conflict.status, ConflictStatus::DeletedByThem)
    }));
}

#[test]
fn conflict_list_classifies_deleted_by_us_conflicts() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "modify on feature")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::remove_file(repo.path.join("shared.txt")).unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "delete on main")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let conflicts = git.conflict_list(&workspace.workspace_id, None).unwrap();
    assert!(conflicts.iter().any(|conflict| {
        conflict.path == "shared.txt" && matches!(conflict.status, ConflictStatus::DeletedByUs)
    }));
}

#[test]
fn conflict_list_classifies_both_added_conflicts() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("base.txt"), "base").unwrap();
    git.stage(&workspace.workspace_id, None, &["base.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "add on feature")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "add on main")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let conflicts = git.conflict_list(&workspace.workspace_id, None).unwrap();
    assert!(conflicts.iter().any(|conflict| {
        conflict.path == "shared.txt" && matches!(conflict.status, ConflictStatus::BothAdded)
    }));
}

#[test]
fn merge_state_tracks_in_progress_and_resolved_conflicts() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    git.create_branch(&workspace.workspace_id, None, "feature", None)
        .unwrap();
    git.checkout(&workspace.workspace_id, None, "feature", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "feature change")
        .unwrap();

    git.checkout(&workspace.workspace_id, None, "main", false, None)
        .unwrap();
    fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "main change")
        .unwrap();

    let result = git
        .merge(&workspace.workspace_id, None, "feature", false)
        .unwrap();
    assert!(!result.success);

    let conflicted_state = git.merge_state(&workspace.workspace_id, None).unwrap();
    assert!(conflicted_state.in_progress);
    assert!(conflicted_state.conflicts.iter().any(|conflict| {
        conflict.path == "shared.txt" && matches!(conflict.status, ConflictStatus::BothModified)
    }));

    fs::write(repo.path.join("shared.txt"), "resolved version").unwrap();
    git.stage(&workspace.workspace_id, None, &["shared.txt".into()])
        .unwrap();

    let resolved_state = git.merge_state(&workspace.workspace_id, None).unwrap();
    assert!(resolved_state.in_progress);
    assert!(resolved_state.conflicts.is_empty());

    git.merge_continue(&workspace.workspace_id, None)
        .expect("merge continue should complete");

    let complete_state = git.merge_state(&workspace.workspace_id, None).unwrap();
    assert!(!complete_state.in_progress);
    assert!(complete_state.conflicts.is_empty());
}

#[test]
fn reset_soft_moves_head_without_changing_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "v1").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    let sha1 = git.commit(&workspace.workspace_id, None, "first").unwrap();

    std::fs::write(repo.path.join("file.txt"), "v2").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "second").unwrap();

    git.reset(&workspace.workspace_id, None, &sha1, "soft")
        .unwrap();

    // File should still have v2 content
    let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
    assert_eq!(content, "v2");

    // But HEAD should be at first commit
    let log = git.log(&workspace.workspace_id, None, 5, 0).unwrap();
    assert_eq!(log[0].summary, "first");
}

#[test]
fn reset_mixed_and_hard_update_index_and_worktree() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("file.txt"), "v1").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    let first_commit = git.commit(&workspace.workspace_id, None, "first").unwrap();

    fs::write(repo.path.join("file.txt"), "v2").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    let second_commit = git.commit(&workspace.workspace_id, None, "second").unwrap();

    fs::write(repo.path.join("file.txt"), "v3").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "third").unwrap();

    git.reset(&workspace.workspace_id, None, &second_commit, "mixed")
        .unwrap();
    assert_eq!(
        fs::read_to_string(repo.path.join("file.txt")).unwrap(),
        "v3"
    );
    let mixed_status = git.status(&workspace.workspace_id).unwrap();
    let mixed_file = mixed_status
        .files
        .iter()
        .find(|file| file.path == "file.txt")
        .expect("file should remain modified after mixed reset");
    assert!(!mixed_file.staged);
    assert_eq!(mixed_file.status.trim(), "M");

    git.reset(&workspace.workspace_id, None, &first_commit, "hard")
        .unwrap();
    assert_eq!(
        fs::read_to_string(repo.path.join("file.txt")).unwrap(),
        "v1"
    );
    let hard_status = git.status(&workspace.workspace_id).unwrap();
    assert!(hard_status.files.is_empty());
}

#[test]
fn tag_push_updates_remote_reference() {
    let remote = TempRepo::create_bare();
    let repo = TempRepo::create();
    run_git(
        &repo.path,
        &[
            "remote",
            "add",
            "origin",
            remote.path.to_str().expect("remote path"),
        ],
    );

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    fs::write(repo.path.join("tagged.txt"), "tag me\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["tagged.txt".into()])
        .unwrap();
    let commit = git
        .commit(&workspace.workspace_id, None, "taggable")
        .unwrap();

    git.push(
        &workspace.workspace_id,
        None,
        Some("origin"),
        Some("main"),
        true,
        false,
    )
    .unwrap();
    git.tag_create(
        &workspace.workspace_id,
        None,
        "v1.2.3",
        "HEAD",
        true,
        Some("release"),
    )
    .unwrap();
    git.tag_push(&workspace.workspace_id, None, Some("origin"), "v1.2.3")
        .unwrap();

    let remote_tag = run_git_output(&remote.path, &["rev-parse", "refs/tags/v1.2.3^{}"]);
    assert_eq!(remote_tag.trim(), commit);
}

#[test]
fn init_repo_bootstraps_non_git_workspace() {
    let path = std::env::temp_dir().join(format!("gtoffice-git-init-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp dir");
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&path).expect("open workspace");
    let git_service = GitService::new(service);

    let branch = git_service
        .init_repo(&workspace.workspace_id, None, Some("main"))
        .expect("init repo");
    assert_eq!(branch, "main");

    fs::remove_dir_all(&path).expect("cleanup temp dir");
}

#[test]
fn init_repo_supports_explicit_nested_repository_path() {
    let workspace_root =
        std::env::temp_dir().join(format!("gtoffice-git-init-nested-{}", Uuid::new_v4()));
    let nested_repo = workspace_root.join("packages/app");
    fs::create_dir_all(&nested_repo).expect("create nested target");

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&workspace_root).expect("open workspace");
    let git = GitService::new(service);

    let branch = git
        .init_repo(&workspace.workspace_id, Some("packages/app"), Some("trunk"))
        .expect("init nested repo");

    assert_eq!(branch, "trunk");
    assert!(nested_repo.join(".git").exists());
    assert_eq!(
        run_git_output(&nested_repo, &["branch", "--show-current"]).trim(),
        "trunk"
    );
}

#[test]
fn status_returns_repo_invalid_for_non_git_workspace() {
    let path = std::env::temp_dir().join(format!("gtoffice-git-no-repo-status-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp dir");

    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&path).expect("open workspace");
    let git = GitService::new(service);

    let error = git
        .status(&workspace.workspace_id)
        .expect_err("plain workspace should not have git status");
    assert!(error.to_string().contains("GIT_REPO_INVALID"));
}

#[test]
fn inmemory_workspace_covers_git_validation_fast_failures() {
    let missing_path =
        std::env::temp_dir().join(format!("gtoffice-git-missing-root-{}", Uuid::new_v4()));
    fs::create_dir_all(&missing_path).expect("create temp dir");
    let missing_service = InMemoryWorkspaceService::new();
    let missing_workspace = missing_service.open(&missing_path).expect("open workspace");
    fs::remove_dir_all(&missing_path).expect("remove workspace root");
    let missing_git = GitService::new(missing_service);
    let missing_error = missing_git
        .status(&missing_workspace.workspace_id)
        .expect_err("missing workspace root should fail");
    assert!(missing_error
        .to_string()
        .contains("GIT_WORKSPACE_ROOT_INVALID"));

    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    assert_eq!(
        git.stage(&workspace.workspace_id, None, &[])
            .expect("empty stage is noop"),
        0
    );
    assert_eq!(
        git.unstage(&workspace.workspace_id, None, &[])
            .expect("empty unstage is noop"),
        0
    );

    let discard_error = git
        .discard(&workspace.workspace_id, None, &[], true)
        .expect_err("empty discard should fail");
    assert!(discard_error
        .to_string()
        .contains("GIT_DISCARD_PATHS_REQUIRED"));

    let commit_error = git
        .commit(&workspace.workspace_id, None, "  ")
        .expect_err("empty commit message should fail");
    assert!(commit_error
        .to_string()
        .contains("GIT_COMMIT_MESSAGE_INVALID"));

    let amend_error = git
        .commit_amend(&workspace.workspace_id, None, "\n\t")
        .expect_err("empty amend message should fail");
    assert!(amend_error
        .to_string()
        .contains("GIT_COMMIT_MESSAGE_INVALID"));

    let absolute_error = git
        .status_repo(&workspace.workspace_id, Some("/outside"))
        .expect_err("absolute repository path should fail");
    assert!(absolute_error
        .to_string()
        .contains("GIT_REPOSITORY_PATH_INVALID"));

    let escaping_error = git
        .status_repo(&workspace.workspace_id, Some("../outside"))
        .expect_err("escaping repository path should fail");
    assert!(escaping_error
        .to_string()
        .contains("GIT_REPOSITORY_PATH_INVALID"));

    let missing_repo_error = git
        .status_repo(&workspace.workspace_id, Some("missing"))
        .expect_err("missing repository path should fail");
    assert!(missing_repo_error
        .to_string()
        .contains("repository root does not exist"));

    fs::create_dir_all(repo.path.join("plain-dir")).expect("create plain dir");
    let non_repo_error = git
        .status_repo(&workspace.workspace_id, Some("plain-dir"))
        .expect_err("non-repo path should fail");
    assert!(non_repo_error.to_string().contains("no git repository"));
}

#[test]
fn stage_hunk_applies_partial_patch() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Create initial file with multiple lines
    std::fs::write(repo.path.join("multi.txt"), "line1\nline2\nline3\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["multi.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    // Modify the first line
    std::fs::write(repo.path.join("multi.txt"), "line1 changed\nline2\nline3\n").unwrap();

    // Create a patch for the change (matching what `git diff` would produce)
    let patch = "--- a/multi.txt\n+++ b/multi.txt\n@@ -1,3 +1,3 @@\n-line1\n+line1 changed\n line2\n line3\n";

    // Stage the hunk
    git.stage_hunk(&workspace.workspace_id, None, "multi.txt", patch)
        .unwrap();

    // Verify the change is staged
    let diff = git
        .diff_file(&workspace.workspace_id, None, "multi.txt", true)
        .unwrap();
    assert!(
        diff.contains("-line1"),
        "staged diff should contain deletion: {diff}"
    );
    assert!(
        diff.contains("+line1 changed"),
        "staged diff should contain addition: {diff}"
    );
}

#[test]
fn unstage_hunk_reverses_staged_patch() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Create initial file with multiple lines
    std::fs::write(repo.path.join("multi.txt"), "line1\nline2\nline3\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["multi.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "initial")
        .unwrap();

    // Modify the first line and stage it
    std::fs::write(repo.path.join("multi.txt"), "line1 changed\nline2\nline3\n").unwrap();
    git.stage(&workspace.workspace_id, None, &["multi.txt".into()])
        .unwrap();

    // Verify it is staged
    let staged_diff = git
        .diff_file(&workspace.workspace_id, None, "multi.txt", true)
        .unwrap();
    assert!(
        staged_diff.contains("+line1 changed"),
        "should be staged before unstage"
    );

    // Unstage via patch
    let patch = "--- a/multi.txt\n+++ b/multi.txt\n@@ -1,3 +1,3 @@\n-line1\n+line1 changed\n line2\n line3\n";
    git.unstage_hunk(&workspace.workspace_id, None, "multi.txt", patch)
        .unwrap();

    // Verify nothing is staged now
    let after_diff = git
        .diff_file(&workspace.workspace_id, None, "multi.txt", true)
        .unwrap();
    assert!(
        after_diff.trim().is_empty(),
        "nothing should be staged after unstage: {after_diff}"
    );
}

#[test]
fn commit_amend_updates_message() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.workspace_id, None, &["file.txt".into()])
        .unwrap();
    git.commit(&workspace.workspace_id, None, "original message")
        .unwrap();

    // Amend the message
    git.commit_amend(&workspace.workspace_id, None, "amended message")
        .unwrap();

    let log = git.log(&workspace.workspace_id, None, 1, 0).unwrap();
    assert_eq!(log[0].summary, "amended message");
}

#[test]
fn list_branches_returns_repo_invalid_for_non_git_workspace() {
    let path = std::env::temp_dir().join(format!("gtoffice-git-nonrepo-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp dir");
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&path).expect("open workspace");
    let git_service = GitService::new(service);

    let error = git_service
        .list_branches(&workspace.workspace_id, None, true)
        .expect_err("non git workspace should not list branches");
    assert!(error.to_string().contains("GIT_REPO_INVALID"));

    fs::remove_dir_all(&path).expect("cleanup temp dir");
}
