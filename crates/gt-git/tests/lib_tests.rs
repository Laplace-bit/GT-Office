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
fn commit_detail_includes_changed_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git_service = GitService::new(service);

    fs::write(repo.path.join("README.md"), "hello\n").expect("write file");
    git_service
        .stage(&workspace.workspace_id, &[String::from("README.md")])
        .expect("stage");
    let commit_id = git_service
        .commit(&workspace.workspace_id, "feat: add readme")
        .expect("commit");

    let detail = git_service
        .commit_detail(&workspace.workspace_id, &commit_id)
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

#[test]
fn list_branches_returns_repo_invalid_for_non_git_workspace() {
    let path = std::env::temp_dir().join(format!("gtoffice-git-nonrepo-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp dir");
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&path).expect("open workspace");
    let git_service = GitService::new(service);

    let error = git_service
        .list_branches(&workspace.workspace_id, true)
        .expect_err("non git workspace should not list branches");
    assert!(error.to_string().contains("GIT_REPO_INVALID"));

    fs::remove_dir_all(&path).expect("cleanup temp dir");
}
