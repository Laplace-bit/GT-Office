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
