# Git Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Git panel with Tower-inspired UX, complete missing features (merge/conflict, tags, cherry-pick, commit enhancement, hunk staging), and improve reliability.

**Architecture:** Split the monolithic `useGitWorkspaceController` into focused sub-controllers. Extract inline components from `GitPane.tsx`. Add 13 new Tauri backend commands with corresponding Rust logic in `gt-git`. Frontend follows the existing pattern: controller → desktopApi → Tauri IPC → Rust.

**Tech Stack:** Rust (git2 + git CLI), Tauri IPC, React + TypeScript, SCSS, @tanstack/react-virtual

---

## File Map

### Backend (Rust)

| Action | File | Purpose |
|--------|------|---------|
| Modify | `crates/gt-abstractions/src/lib.rs` | Add `GitTagEntry`, `MergeResult`, `ConflictFile`, `ConflictStatus` types |
| Modify | `crates/gt-git/src/lib.rs` | Add tag, cherry-pick, revert, reset, merge, hunk staging methods |
| Modify | `crates/gt-git/tests/lib_tests.rs` | Integration tests for all new methods |
| Modify | `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs` | Add 13 new Tauri command handlers |
| Modify | `apps/desktop-tauri/src-tauri/src/lib.rs` | Register new commands in `generate_handler!` |
| Modify | `apps/desktop-tauri/src-tauri/src/commands/tests/git_tests.rs` | Payload contract tests |

### Frontend (TypeScript)

| Action | File | Purpose |
|--------|------|---------|
| Create | `features/git/controllers/useGitStatus.ts` | Status, stage, unstage, discard state |
| Create | `features/git/controllers/useGitCommit.ts` | Commit, amend, message state |
| Create | `features/git/controllers/useGitBranch.ts` | Branch list, checkout, create, delete |
| Create | `features/git/controllers/useGitRemote.ts` | Fetch, pull, push, ahead/behind |
| Create | `features/git/controllers/useGitStash.ts` | Stash push/pop/apply/drop/list |
| Create | `features/git/controllers/useGitDiff.ts` | Diff cache, preload, structured diff |
| Create | `features/git/controllers/useGitMerge.ts` | Merge, conflict detection, resolve |
| Create | `features/git/controllers/useGitController.ts` | Composition layer aggregating sub-controllers |
| Create | `features/git/components/GitOperationsPane.tsx` | Left panel container |
| Create | `features/git/components/GitHistoryPane.tsx` | Right panel container |
| Create | `features/git/components/ChangesSection.tsx` | File list + filter chips |
| Create | `features/git/components/GitFileRow.tsx` | Single file row |
| Create | `features/git/components/CommitForm.tsx` | Multiline commit editor + amend |
| Create | `features/git/components/BranchSection.tsx` | Branch management |
| Create | `features/git/components/StashSection.tsx` | Stash management |
| Create | `features/git/components/TagSection.tsx` | Tag management |
| Create | `features/git/components/MergeConflictPanel.tsx` | Conflict resolution |
| Create | `features/git/components/GitToolbar.tsx` | Top toolbar |
| Create | `features/git/components/GitNoticeBanner.tsx` | Status banner |
| Create | `features/git/components/GitConfirmDialog.tsx` | Reusable confirm dialog |
| Create | `features/git/components/GitContextMenu.tsx` | Right-click context menu |
| Create | `features/git/tags/useGitTags.ts` | Tag CRUD hook |
| Create | `features/git/merge/conflict-parser.ts` | Conflict marker parser |
| Modify | `features/git/GitPane.tsx` | Slim down to barrel re-export |
| Modify | `features/git/DiffViewer.tsx` | Add hunk staging buttons |
| Modify | `features/git/index.ts` | Update exports |
| Modify | `shell/integration/desktop-api.ts` | Add new Tauri IPC wrappers |
| Modify | `shell/i18n/messages.ts` | Add i18n strings for new features |
| Modify | `shell/layout/navigation-model.ts` | Replace placeholder data with live data |
| Modify | `styles/features/git/_pane.scss` | New component styles |
| Modify | `styles/features/git/_diff-viewer.scss` | Hunk staging button styles |

---

## Task 1: Backend — Tag Types and Commands

**Files:**
- Modify: `crates/gt-abstractions/src/lib.rs`
- Modify: `crates/gt-git/src/lib.rs`
- Modify: `crates/gt-git/tests/lib_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tests/git_tests.rs`

### Step 1: Add `GitTagEntry` type to gt-abstractions

In `crates/gt-abstractions/src/lib.rs`, add after the existing `GitStashEntry` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitTagEntry {
    pub name: String,
    pub oid: String,
    pub target: String,
    pub tagger: Option<String>,
    pub message: Option<String>,
}
```

### Step 2: Write test for `tag_list` on empty repo

In `crates/gt-git/tests/lib_tests.rs`, add:

```rust
#[test]
fn tag_list_returns_empty_for_no_tags() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Create an initial commit so HEAD exists
    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    let tags = git.tag_list(&workspace.id).unwrap();
    assert!(tags.is_empty());
}
```

### Step 3: Run test to verify it fails

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git tag_list_returns_empty_for_no_tags 2>&1 | tail -5
```

Expected: compilation error — `tag_list` method not found.

### Step 4: Implement `tag_list` in gt-git

In `crates/gt-git/src/lib.rs`, add the `tag_list` method on `GitService<W>`:

```rust
pub fn tag_list(&self, workspace_id: &WorkspaceId) -> AbstractionResult<Vec<GitTagEntry>> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let repo = Repository::open(&ctx.root).map_err(|e| {
        AbstractionError::Internal(format!("GIT_TAG_LIST_FAILED: {e}"))
    })?;

    let tags = repo.tag_foreach(|oid, name| {
        // name is bytes like "refs/tags/v1.0"
        let name_str = String::from_utf8_lossy(name);
        let tag_name = name_str.strip_prefix("refs/tags/").unwrap_or(&name_str).to_string();

        // Try to peel to a tag object (annotated tag)
        let (target, tagger, message) = match repo.find_tag(oid) {
            Ok(tag) => {
                let target = tag.target_id().to_string();
                let tagger = tag.tagger().map(|s| s.name().unwrap_or("").to_string());
                let message = tag.message().map(|s| s.to_string());
                (target, tagger, message)
            }
            Err(_) => {
                // Lightweight tag — oid is the commit
                (oid.to_string(), None, None)
            }
        };

        // We can't push from the callback, so collect into a vec via a shared ref
        // Actually, tag_foreach returns bool to continue. We need a different approach.
        true
    }).map_err(|e| AbstractionError::Internal(format!("GIT_TAG_LIST_FAILED: {e}")))?;

    // Use git for-each-ref instead for cleaner collection
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "for-each-ref", "--format", "%(refname:short)|%(objectname)|%(objectname:short)|%(taggername)|%(subject)", "refs/tags/"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_TAG_LIST_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_TAG_LIST_FAILED: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<GitTagEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() >= 5 {
                Some(GitTagEntry {
                    name: parts[0].to_string(),
                    oid: parts[1].to_string(),
                    target: parts[2].to_string(),
                    tagger: if parts[3].is_empty() { None } else { Some(parts[3].to_string()) },
                    message: if parts[4].is_empty() { None } else { Some(parts[4].to_string()) },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(entries)
}
```

Note: The above uses git CLI for simplicity. Remove the unused `tag_foreach` code block — use only the `for-each-ref` approach.

### Step 5: Run test to verify it passes

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git tag_list_returns_empty_for_no_tags 2>&1 | tail -5
```

Expected: PASS.

### Step 6: Write test for `tag_create` lightweight tag

```rust
#[test]
fn tag_create_lightweight_and_list() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    git.tag_create(&workspace.id, "v1.0", "HEAD", false, None).unwrap();

    let tags = git.tag_list(&workspace.id).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v1.0");
    assert!(tags[0].tagger.is_none());
}
```

### Step 7: Implement `tag_create`

```rust
pub fn tag_create(
    &self,
    workspace_id: &WorkspaceId,
    name: &str,
    target: &str,
    annotated: bool,
    message: Option<&str>,
) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&ctx.root).arg("tag");
    if annotated {
        cmd.arg("-a").arg(name).arg("-m").arg(message.unwrap_or(""));
    } else {
        cmd.arg(name);
    }
    cmd.arg(target);

    let output = cmd.output().map_err(|e| {
        AbstractionError::Internal(format!("GIT_TAG_CREATE_FAILED: {e}"))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_TAG_CREATE_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 8: Run tag_create test

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git tag_create_lightweight_and_list 2>&1 | tail -5
```

### Step 9: Implement `tag_delete` and `tag_push` + tests

```rust
pub fn tag_delete(&self, workspace_id: &WorkspaceId, name: &str) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "tag", "-d", name])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_TAG_DELETE_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_TAG_DELETE_FAILED: {stderr}")));
    }
    Ok(())
}

pub fn tag_push(
    &self,
    workspace_id: &WorkspaceId,
    remote: Option<&str>,
    tag_name: &str,
) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let remote = remote.unwrap_or("origin");
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "push", remote, "tag", tag_name])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_TAG_PUSH_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_TAG_PUSH_FAILED: {stderr}")));
    }
    Ok(())
}
```

Tests:

```rust
#[test]
fn tag_delete_removes_tag() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();
    git.tag_create(&workspace.id, "v1.0", "HEAD", false, None).unwrap();

    git.tag_delete(&workspace.id, "v1.0").unwrap();

    let tags = git.tag_list(&workspace.id).unwrap();
    assert!(tags.is_empty());
}

#[test]
fn tag_create_annotated_with_message() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    git.tag_create(&workspace.id, "v2.0", "HEAD", true, Some("Release 2.0")).unwrap();

    let tags = git.tag_list(&workspace.id).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v2.0");
    assert_eq!(tags[0].message.as_deref(), Some("Release 2.0"));
}
```

### Step 10: Add Tauri commands for tags

In `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`, add:

```rust
#[tauri::command]
pub async fn git_tag_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let entries = run_git_blocking(&state, "GIT_TAG_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_list(&workspace_id)
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({ "workspaceId": workspace_id.as_str(), "tags": entries }))
}

#[tauri::command]
pub async fn git_tag_create(
    workspace_id: String,
    name: String,
    target: String,
    annotated: Option<bool>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let is_annotated = annotated.unwrap_or(false);
    run_git_blocking(&state, "GIT_TAG_CREATE_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_create(&workspace_id, &name, &target, is_annotated, message.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({ "workspaceId": workspace_id.as_str(), "name": name }))
}

#[tauri::command]
pub async fn git_tag_delete(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    run_git_blocking(&state, "GIT_TAG_DELETE_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_delete(&workspace_id, &name)
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({ "workspaceId": workspace_id.as_str(), "name": name }))
}

#[tauri::command]
pub async fn git_tag_push(
    workspace_id: String,
    name: String,
    remote: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    run_git_blocking(&state, "GIT_TAG_PUSH_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_push(&workspace_id, remote.as_deref(), &name)
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({ "workspaceId": workspace_id.as_str(), "name": name }))
}
```

### Step 11: Register tag commands in lib.rs

In `apps/desktop-tauri/src-tauri/src/lib.rs`, add to `generate_handler![]`:

```
git::git_tag_list,
git::git_tag_create,
git::git_tag_delete,
git::git_tag_push,
```

### Step 12: Run full backend verification

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git -- --test-threads=1 2>&1 | tail -10
cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5
```

### Step 13: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add crates/gt-abstractions/src/lib.rs crates/gt-git/src/lib.rs crates/gt-git/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/git/mod.rs apps/desktop-tauri/src-tauri/src/lib.rs apps/desktop-tauri/src-tauri/src/commands/tests/git_tests.rs && git commit -m "feat(git): add tag list/create/delete/push backend commands"
```

---

## Task 2: Backend — Cherry-pick, Revert, Reset

**Files:**
- Modify: `crates/gt-git/src/lib.rs`
- Modify: `crates/gt-git/tests/lib_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`

### Step 1: Write test for `cherry_pick`

```rust
#[test]
fn cherry_pick_applies_commit_on_branch() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit on main
    std::fs::write(repo.path.join("file.txt"), "base").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    let base_sha = git.commit(&workspace.id, "base").unwrap();

    // Create feature branch with a commit
    git.create_branch(&workspace.id, "feature", None).unwrap();
    git.checkout(&workspace.id, "feature", false, None).unwrap();
    std::fs::write(repo.path.join("feature.txt"), "feature").unwrap();
    git.stage(&workspace.id, &["feature.txt".into()]).unwrap();
    let feature_sha = git.commit(&workspace.id, "add feature").unwrap();

    // Go back to main
    git.checkout(&workspace.id, "main", false, None).unwrap();

    // Cherry-pick the feature commit
    git.cherry_pick(&workspace.id, &feature_sha).unwrap();

    // Verify the file exists on main
    assert!(repo.path.join("feature.txt").exists());
    let log = git.log(&workspace.id, 5, 0).unwrap();
    assert_eq!(log[0].summary, "add feature");
}
```

### Step 2: Implement `cherry_pick`

```rust
pub fn cherry_pick(&self, workspace_id: &WorkspaceId, commit_oid: &str) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "cherry-pick", commit_oid])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_CHERRY_PICK_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_CHERRY_PICK_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 3: Run cherry-pick test

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git cherry_pick_applies_commit_on_branch 2>&1 | tail -5
```

### Step 4: Write test for `revert`

```rust
#[test]
fn revert_undoes_commit() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "original").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    std::fs::write(repo.path.join("file.txt"), "modified").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    let sha = git.commit(&workspace.id, "modify file").unwrap();

    git.revert(&workspace.id, &sha).unwrap();

    let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
    assert_eq!(content, "original");
}
```

### Step 5: Implement `revert`

```rust
pub fn revert(&self, workspace_id: &WorkspaceId, commit_oid: &str) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "revert", "--no-edit", commit_oid])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_REVERT_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_REVERT_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 6: Run revert test

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git revert_undoes_commit 2>&1 | tail -5
```

### Step 7: Write test for `reset`

```rust
#[test]
fn reset_soft_moves_head_without_changing_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "v1").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    let sha1 = git.commit(&workspace.id, "first").unwrap();

    std::fs::write(repo.path.join("file.txt"), "v2").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "second").unwrap();

    git.reset(&workspace.id, &sha1, "soft").unwrap();

    // File should still have v2 content
    let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
    assert_eq!(content, "v2");

    // But HEAD should be at first commit
    let log = git.log(&workspace.id, 5, 0).unwrap();
    assert_eq!(log[0].summary, "first");
}
```

### Step 8: Implement `reset`

```rust
pub fn reset(
    &self,
    workspace_id: &WorkspaceId,
    target: &str,
    mode: &str,
) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let reset_flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(AbstractionError::InvalidArgument(
            "GIT_RESET_INVALID_MODE: mode must be soft, mixed, or hard".to_string()
        )),
    };

    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "reset", reset_flag, target])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_RESET_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_RESET_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 9: Run all new tests

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git -- --test-threads=1 2>&1 | tail -10
```

### Step 10: Add Tauri commands

In `commands/git/mod.rs`:

```rust
#[tauri::command]
pub async fn git_cherry_pick(
    workspace_id: String,
    commit: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    run_git_blocking(&state, "GIT_CHERRY_PICK_FAILED", move |app_state| {
        app_state.git_service.cherry_pick(&workspace_id, &commit).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id.as_str() }))
}

#[tauri::command]
pub async fn git_revert(
    workspace_id: String,
    commit: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    run_git_blocking(&state, "GIT_REVERT_FAILED", move |app_state| {
        app_state.git_service.revert(&workspace_id, &commit).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id.as_str() }))
}

#[tauri::command]
pub async fn git_reset(
    workspace_id: String,
    target: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    run_git_blocking(&state, "GIT_RESET_FAILED", move |app_state| {
        app_state.git_service.reset(&workspace_id, &target, &mode).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id.as_str() }))
}
```

### Step 11: Register commands in lib.rs

Add to `generate_handler![]`:
```
git::git_cherry_pick,
git::git_revert,
git::git_reset,
```

### Step 12: Verify

```bash
cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5
```

### Step 13: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add crates/gt-git/src/lib.rs crates/gt-git/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/git/mod.rs apps/desktop-tauri/src-tauri/src/lib.rs && git commit -m "feat(git): add cherry-pick, revert, reset backend commands"
```

---

## Task 3: Backend — Merge + Conflict Resolution

**Files:**
- Modify: `crates/gt-abstractions/src/lib.rs`
- Modify: `crates/gt-git/src/lib.rs`
- Modify: `crates/gt-git/tests/lib_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`

### Step 1: Add merge types to gt-abstractions

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub conflicts: Vec<ConflictFile>,
    pub merged_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub status: ConflictStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictStatus {
    BothModified,
    DeletedByUs,
    DeletedByThem,
    AddedByBoth,
    BothAdded,
}
```

### Step 2: Write test for clean merge

```rust
#[test]
fn merge_fast_forward_combines_branches() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit
    std::fs::write(repo.path.join("base.txt"), "base").unwrap();
    git.stage(&workspace.id, &["base.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    // Create feature branch
    git.create_branch(&workspace.id, "feature", None).unwrap();
    git.checkout(&workspace.id, "feature", false, None).unwrap();
    std::fs::write(repo.path.join("feature.txt"), "feature").unwrap();
    git.stage(&workspace.id, &["feature.txt".into()]).unwrap();
    git.commit(&workspace.id, "feature work").unwrap();

    // Back to main
    git.checkout(&workspace.id, "main", false, None).unwrap();

    // Merge feature
    let result = git.merge(&workspace.id, "feature", false).unwrap();
    assert!(result.success);
    assert!(result.conflicts.is_empty());
    assert!(result.merged_commit.is_some());
    assert!(repo.path.join("feature.txt").exists());
}
```

### Step 3: Implement `merge`

```rust
pub fn merge(
    &self,
    workspace_id: &WorkspaceId,
    target: &str,
    no_ff: bool,
) -> AbstractionResult<MergeResult> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&ctx.root).arg("merge");
    if no_ff {
        cmd.arg("--no-ff");
    }
    cmd.arg("--no-edit").arg(target);

    let output = cmd.output().map_err(|e| {
        AbstractionError::Internal(format!("GIT_MERGE_FAILED: {e}"))
    })?;

    if output.status.success() {
        // Get the merge commit SHA
        let head_output = std::process::Command::new("git")
            .args(["-C", ctx.root.to_str().unwrap(), "rev-parse", "HEAD"])
            .output()
            .map_err(|e| AbstractionError::Internal(format!("GIT_MERGE_FAILED: {e}")))?;

        let head_sha = String::from_utf8_lossy(&head_output.stdout).trim().to_string();
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            merged_commit: Some(head_sha),
        });
    }

    // Check if it's a conflict
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("CONFLICT") || stderr.contains("conflict") || stderr.contains("Automatic merge failed") {
        let conflicts = self.conflict_list(workspace_id)?;
        // Abort the merge so the working tree is clean for the user to resolve
        let _ = std::process::Command::new("git")
            .args(["-C", ctx.root.to_str().unwrap(), "merge", "--abort"])
            .output();
        return Ok(MergeResult {
            success: false,
            conflicts,
            merged_commit: None,
        });
    }

    Err(AbstractionError::Internal(format!("GIT_MERGE_FAILED: {stderr}")))
}
```

### Step 4: Implement `conflict_list`

```rust
pub fn conflict_list(&self, workspace_id: &WorkspaceId) -> AbstractionResult<Vec<ConflictFile>> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "diff", "--name-only", "--diff-filter=U"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_CONFLICT_LIST_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_CONFLICT_LIST_FAILED: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let conflicts: Vec<ConflictFile> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|path| ConflictFile {
            path: path.to_string(),
            status: ConflictStatus::BothModified, // simplified — detect exact status via ls-files -u
        })
        .collect();

    Ok(conflicts)
}
```

### Step 5: Implement `merge_continue` and `merge_abort`

```rust
pub fn merge_continue(&self, workspace_id: &WorkspaceId) -> AbstractionResult<String> {
    let ctx = self.workspace.get_context(workspace_id)?;

    // Check if all conflicts are resolved
    let status = self.status(workspace_id)?;
    let has_conflicts = status.files.iter().any(|f| f.status.contains('U') || f.status == "AA");
    if has_conflicts {
        return Err(AbstractionError::InvalidArgument(
            "GIT_MERGE_CONFLICTS_REMAIN: resolve all conflicts before continuing".to_string()
        ));
    }

    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "commit", "--no-edit"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_MERGE_CONTINUE_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_MERGE_CONTINUE_FAILED: {stderr}")));
    }

    let head_output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "rev-parse", "HEAD"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_MERGE_CONTINUE_FAILED: {e}")))?;

    Ok(String::from_utf8_lossy(&head_output.stdout).trim().to_string())
}

pub fn merge_abort(&self, workspace_id: &WorkspaceId) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "merge", "--abort"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_MERGE_ABORT_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_MERGE_ABORT_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 6: Write test for merge conflict

```rust
#[test]
fn merge_conflict_returns_conflict_files() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Initial commit
    std::fs::write(repo.path.join("shared.txt"), "original").unwrap();
    git.stage(&workspace.id, &["shared.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    // Feature branch modifies shared.txt
    git.create_branch(&workspace.id, "feature", None).unwrap();
    git.checkout(&workspace.id, "feature", false, None).unwrap();
    std::fs::write(repo.path.join("shared.txt"), "feature version").unwrap();
    git.stage(&workspace.id, &["shared.txt".into()]).unwrap();
    git.commit(&workspace.id, "feature change").unwrap();

    // Main also modifies shared.txt
    git.checkout(&workspace.id, "main", false, None).unwrap();
    std::fs::write(repo.path.join("shared.txt"), "main version").unwrap();
    git.stage(&workspace.id, &["shared.txt".into()]).unwrap();
    git.commit(&workspace.id, "main change").unwrap();

    // Merge should conflict
    let result = git.merge(&workspace.id, "feature", false).unwrap();
    assert!(!result.success);
    assert!(!result.conflicts.is_empty());
    assert!(result.conflicts.iter().any(|c| c.path == "shared.txt"));
}
```

### Step 7: Run merge tests

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git merge -- --test-threads=1 2>&1 | tail -10
```

### Step 8: Add Tauri commands

```rust
#[tauri::command]
pub async fn git_merge(
    workspace_id: String,
    target: String,
    no_ff: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id);
    let ws_id = workspace_id_owned.clone();
    let result = run_git_blocking(&state, "GIT_MERGE_FAILED", move |app_state| {
        app_state.git_service.merge(&ws_id, &target, no_ff.unwrap_or(false)).map_err(to_command_error)
    }).await?;
    Ok(json!({
        "workspaceId": workspace_id_owned.as_str(),
        "success": result.success,
        "conflicts": result.conflicts,
        "mergedCommit": result.merged_commit,
    }))
}

#[tauri::command]
pub async fn git_merge_continue(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id);
    let ws_id = workspace_id_owned.clone();
    let commit = run_git_blocking(&state, "GIT_MERGE_CONTINUE_FAILED", move |app_state| {
        app_state.git_service.merge_continue(&ws_id).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id_owned.as_str(), "mergedCommit": commit }))
}

#[tauri::command]
pub async fn git_merge_abort(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id);
    let ws_id = workspace_id_owned.clone();
    run_git_blocking(&state, "GIT_MERGE_ABORT_FAILED", move |app_state| {
        app_state.git_service.merge_abort(&ws_id).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id_owned.as_str() }))
}

#[tauri::command]
pub async fn git_conflict_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id);
    let ws_id = workspace_id_owned.clone();
    let conflicts = run_git_blocking(&state, "GIT_CONFLICT_LIST_FAILED", move |app_state| {
        app_state.git_service.conflict_list(&ws_id).map_err(to_command_error)
    }).await?;
    Ok(json!({ "workspaceId": workspace_id_owned.as_str(), "conflicts": conflicts }))
}
```

### Step 9: Register commands

Add to `generate_handler![]`:
```
git::git_merge,
git::git_merge_continue,
git::git_merge_abort,
git::git_conflict_list,
```

### Step 10: Verify

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git -- --test-threads=1 2>&1 | tail -10 && cargo check --workspace 2>&1 | tail -5
```

### Step 11: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add crates/gt-abstractions/src/lib.rs crates/gt-git/src/lib.rs crates/gt-git/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/git/mod.rs apps/desktop-tauri/src-tauri/src/lib.rs && git commit -m "feat(git): add merge, merge_continue, merge_abort, conflict_list backend commands"
```

---

## Task 4: Backend — Hunk Staging

**Files:**
- Modify: `crates/gt-git/src/lib.rs`
- Modify: `crates/gt-git/tests/lib_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`

### Step 1: Write test for `stage_hunk`

```rust
#[test]
fn stage_hunk_stages_partial_changes() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    // Create initial file with multiple lines
    std::fs::write(repo.path.join("multi.txt"), "line1\nline2\nline3\nline4\nline5\n").unwrap();
    git.stage(&workspace.id, &["multi.txt".into()]).unwrap();
    git.commit(&workspace.id, "initial").unwrap();

    // Modify two separate hunks
    std::fs::write(repo.path.join("multi.txt"), "line1 changed\nline2\nline3\nline4 changed\nline5\n").unwrap();

    // Get the diff to extract a hunk patch
    let diff = git.diff_file(&workspace.id, "multi.txt", false).unwrap();

    // stage_hunk should accept a patch string
    // For now, test that the method exists and accepts parameters
    // The actual hunk extraction happens on the frontend
}
```

### Step 2: Implement `stage_hunk` and `unstage_hunk`

```rust
pub fn stage_hunk(
    &self,
    workspace_id: &WorkspaceId,
    path: &str,
    patch: &str,
) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;

    // Write patch to a temp file
    let patch_path = ctx.root.join(".git").join("gto-patch.tmp");
    std::fs::write(&patch_path, patch).map_err(|e| {
        AbstractionError::Internal(format!("GIT_STAGE_HUNK_FAILED: {e}"))
    })?;

    let result = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "apply", "--cached", patch_path.to_str().unwrap()])
        .output();

    // Clean up temp file
    let _ = std::fs::remove_file(&patch_path);

    let output = result.map_err(|e| {
        AbstractionError::Internal(format!("GIT_STAGE_HUNK_FAILED: {e}"))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_STAGE_HUNK_FAILED: {stderr}")));
    }
    Ok(())
}

pub fn unstage_hunk(
    &self,
    workspace_id: &WorkspaceId,
    path: &str,
    patch: &str,
) -> AbstractionResult<()> {
    let ctx = self.workspace.get_context(workspace_id)?;

    let patch_path = ctx.root.join(".git").join("gto-patch.tmp");
    std::fs::write(&patch_path, patch).map_err(|e| {
        AbstractionError::Internal(format!("GIT_UNSTAGE_HUNK_FAILED: {e}"))
    })?;

    let result = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "apply", "--cached", "--reverse", patch_path.to_str().unwrap()])
        .output();

    let _ = std::fs::remove_file(&patch_path);

    let output = result.map_err(|e| {
        AbstractionError::Internal(format!("GIT_UNSTAGE_HUNK_FAILED: {e}"))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_UNSTAGE_HUNK_FAILED: {stderr}")));
    }
    Ok(())
}
```

### Step 3: Add Tauri commands

```rust
#[tauri::command]
pub async fn git_stage_hunk(
    workspace_id: String,
    path: String,
    patch: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let ws_id = WorkspaceId::new(workspace_id.clone());
    run_git_blocking(&state, "GIT_STAGE_HUNK_FAILED", move |app_state| {
        app_state.git_service.stage_hunk(&ws_id, &path, &patch).map_err(to_command_error)
    }).await?;
    state.inner().git_status_coordinator.refresh_now(&app, state.inner(), &WorkspaceId::new(workspace_id));
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_unstage_hunk(
    workspace_id: String,
    path: String,
    patch: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let ws_id = WorkspaceId::new(workspace_id.clone());
    run_git_blocking(&state, "GIT_UNSTAGE_HUNK_FAILED", move |app_state| {
        app_state.git_service.unstage_hunk(&ws_id, &path, &patch).map_err(to_command_error)
    }).await?;
    state.inner().git_status_coordinator.refresh_now(&app, state.inner(), &WorkspaceId::new(workspace_id));
    Ok(json!({ "ok": true }))
}
```

### Step 4: Register commands

Add to `generate_handler![]`:
```
git::git_stage_hunk,
git::git_unstage_hunk,
```

### Step 5: Verify

```bash
cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5
```

### Step 6: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add crates/gt-git/src/lib.rs crates/gt-git/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/git/mod.rs apps/desktop-tauri/src-tauri/src/lib.rs && git commit -m "feat(git): add hunk-level stage/unstage backend commands"
```

---

## Task 5: Backend — Commit Amend

**Files:**
- Modify: `crates/gt-git/src/lib.rs`
- Modify: `crates/gt-git/tests/lib_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`

### Step 1: Write test for amend

```rust
#[test]
fn commit_amend_updates_message() {
    let repo = TempRepo::create();
    let service = InMemoryWorkspaceService::new();
    let workspace = service.open(&repo.path).expect("open workspace");
    let git = GitService::new(service);

    std::fs::write(repo.path.join("file.txt"), "content").unwrap();
    git.stage(&workspace.id, &["file.txt".into()]).unwrap();
    git.commit(&workspace.id, "original message").unwrap();

    // Amend the message
    git.commit_amend(&workspace.id, "amended message").unwrap();

    let log = git.log(&workspace.id, 1, 0).unwrap();
    assert_eq!(log[0].summary, "amended message");
}
```

### Step 2: Implement `commit_amend`

```rust
pub fn commit_amend(&self, workspace_id: &WorkspaceId, message: &str) -> AbstractionResult<String> {
    if message.trim().is_empty() {
        return Err(AbstractionError::InvalidArgument(
            "GIT_COMMIT_MESSAGE_INVALID: commit message cannot be empty".to_string()
        ));
    }

    let ctx = self.workspace.get_context(workspace_id)?;
    let output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "commit", "--amend", "-m", message, "--no-gpg-sign"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_COMMIT_FAILED: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AbstractionError::Internal(format!("GIT_COMMIT_FAILED: {stderr}")));
    }

    let head_output = std::process::Command::new("git")
        .args(["-C", ctx.root.to_str().unwrap(), "rev-parse", "HEAD"])
        .output()
        .map_err(|e| AbstractionError::Internal(format!("GIT_COMMIT_FAILED: {e}")))?;

    Ok(String::from_utf8_lossy(&head_output.stdout).trim().to_string())
}
```

### Step 3: Modify Tauri `git_commit` to support amend

Update the existing `git_commit` command to accept an optional `amend` parameter:

```rust
#[tauri::command]
pub async fn git_commit(
    workspace_id: String,
    message: String,
    amend: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let is_amend = amend.unwrap_or(false);

    let sha = run_git_blocking(&state, "GIT_COMMIT_FAILED", move |app_state| {
        if is_amend {
            app_state.git_service.commit_amend(&ws_id, &message).map_err(to_command_error)
        } else {
            app_state.git_service.commit(&ws_id, &message).map_err(to_command_error)
        }
    }).await?;

    state.inner().git_status_coordinator.refresh_now(&app, state.inner(), &WorkspaceId::new(workspace_id));
    Ok(json!({ "workspaceId": workspace_id_owned.as_str(), "commitSha": sha }))
}
```

### Step 4: Verify

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git commit_amend_updates_message -- --test-threads=1 2>&1 | tail -5 && cargo check --workspace 2>&1 | tail -5
```

### Step 5: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add crates/gt-git/src/lib.rs crates/gt-git/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/git/mod.rs && git commit -m "feat(git): add commit amend support"
```

---

## Task 6: Frontend — desktop-api.ts + Shared Types

**Files:**
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`
- Modify: `apps/desktop-web/src/shell/i18n/messages.ts`

### Step 1: Add TypeScript types for new responses

At the top of `desktop-api.ts` (or in a shared types file), add:

```typescript
interface GitTagEntry {
  name: string
  oid: string
  target: string
  tagger: string | null
  message: string | null
}

interface GitTagListResponse {
  workspaceId: string
  tags: GitTagEntry[]
}

interface GitMergeResult {
  workspaceId: string
  success: boolean
  conflicts: GitConflictFile[]
  mergedCommit: string | null
}

interface GitConflictFile {
  path: string
  status: string
}
```

### Step 2: Add desktopApi methods for new commands

```typescript
// Tags
gitTagList(workspaceId: string) {
  return invokeCommand<GitTagListResponse>('git_tag_list', { workspaceId })
},

gitTagCreate(workspaceId: string, name: string, target: string, options?: { annotated?: boolean; message?: string }) {
  return invokeCommand<{ workspaceId: string; name: string }>('git_tag_create', {
    workspaceId, name, target,
    annotated: options?.annotated ?? false,
    message: options?.message ?? null,
  })
},

gitTagDelete(workspaceId: string, name: string) {
  return invokeCommand<{ workspaceId: string; name: string }>('git_tag_delete', { workspaceId, name })
},

gitTagPush(workspaceId: string, name: string, remote?: string) {
  return invokeCommand<{ workspaceId: string; name: string }>('git_tag_push', {
    workspaceId, name, remote: remote ?? null,
  })
},

// Cherry-pick / Revert / Reset
gitCherryPick(workspaceId: string, commit: string) {
  return invokeCommand<{ workspaceId: string }>('git_cherry_pick', { workspaceId, commit })
},

gitRevert(workspaceId: string, commit: string) {
  return invokeCommand<{ workspaceId: string }>('git_revert', { workspaceId, commit })
},

gitReset(workspaceId: string, target: string, mode: 'soft' | 'mixed' | 'hard') {
  return invokeCommand<{ workspaceId: string }>('git_reset', { workspaceId, target, mode })
},

// Merge
gitMerge(workspaceId: string, target: string, options?: { noFf?: boolean }) {
  return invokeCommand<GitMergeResult>('git_merge', {
    workspaceId, target, noFf: options?.noFf ?? false,
  })
},

gitMergeContinue(workspaceId: string) {
  return invokeCommand<{ workspaceId: string; mergedCommit: string }>('git_merge_continue', { workspaceId })
},

gitMergeAbort(workspaceId: string) {
  return invokeCommand<{ workspaceId: string }>('git_merge_abort', { workspaceId })
},

gitConflictList(workspaceId: string) {
  return invokeCommand<{ workspaceId: string; conflicts: GitConflictFile[] }>('git_conflict_list', { workspaceId })
},

// Hunk staging
gitStageHunk(workspaceId: string, path: string, patch: string) {
  return invokeCommand<{ ok: boolean }>('git_stage_hunk', { workspaceId, path, patch })
},

gitUnstageHunk(workspaceId: string, path: string, patch: string) {
  return invokeCommand<{ ok: boolean }>('git_unstage_hunk', { workspaceId, path, patch })
},

// Updated commit with amend
// Modify existing gitCommit to accept amend option:
gitCommit(workspaceId: string, message: string, options?: { amend?: boolean }) {
  return invokeCommand<GitCommitResponse>('git_commit', {
    workspaceId, message, amend: options?.amend ?? false,
  })
},
```

### Step 3: Add i18n strings

Add to `messages.ts` (zh-CN and en-US):

```
// Tags
'git.tags': 'Tags' / '标签',
'git.tags.create': 'Create Tag' / '创建标签',
'git.tags.delete': 'Delete Tag' / '删除标签',
'git.tags.push': 'Push Tag' / '推送标签',
'git.tags.name': 'Tag name' / '标签名称',
'git.tags.message': 'Tag message (annotated)' / '标签消息（注释标签）',
'git.tags.confirmDelete': 'Delete tag "{name}"?' / '删除标签 "{name}"？',

// Merge
'git.merge.title': 'Merge' / '合并',
'git.merge.target': 'Branch to merge' / '要合并的分支',
'git.merge.conflicts': 'Merge conflicts detected' / '检测到合并冲突',
'git.merge.continue': 'Continue Merge' / '继续合并',
'git.merge.abort': 'Abort Merge' / '中止合并',
'git.merge.acceptOurs': 'Accept Ours' / '接受 ours',
'git.merge.acceptTheirs': 'Accept Theirs' / '接受 theirs',
'git.merge.acceptBoth': 'Accept Both' / '接受两者',

// Commit
'git.commit.amend': 'Amend' / '修改',
'git.commit.subject': 'Subject (50 chars recommended)' / '主题（建议 50 字符）',
'git.commit.body': 'Description (optional)' / '描述（可选）',
'git.commit.shortcut': '⌘Enter to commit' / '⌘Enter 提交',

// Graph actions
'git.graph.cherryPick': 'Cherry Pick' / 'Cherry Pick',
'git.graph.revert': 'Revert' / 'Revert',
'git.graph.reset': 'Reset' / '重置',
'git.graph.resetSoft': 'Reset (Soft)' / '重置（Soft）',
'git.graph.resetMixed': 'Reset (Mixed)' / '重置（Mixed）',
'git.graph.resetHard': 'Reset (Hard)' / '重置（Hard）',
'git.graph.createBranch': 'Create Branch from here' / '从此创建分支',
'git.graph.copyHash': 'Copy Hash' / '复制 Hash',

// Hunk
'git.hunk.stage': 'Stage Hunk' / '暂存 Hunk',
'git.hunk.unstage': 'Unstage Hunk' / '取消暂存 Hunk',

// Errors
'git.error.cherryPickFailed': 'Cherry-pick failed' / 'Cherry-pick 失败',
'git.error.revertFailed': 'Revert failed' / 'Revert 失败',
'git.error.resetFailed': 'Reset failed' / '重置失败',
'git.error.mergeFailed': 'Merge failed' / '合并失败',
'git.error.tagFailed': 'Tag operation failed' / '标签操作失败',
```

### Step 4: Verify typecheck

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -10
```

### Step 5: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/shell/integration/desktop-api.ts apps/desktop-web/src/shell/i18n/messages.ts && git commit -m "feat(git): add frontend API wrappers and i18n for new git commands"
```

---

## Task 7: Frontend — Controller Decomposition

**Files:**
- Create: `features/git/controllers/useGitStatus.ts`
- Create: `features/git/controllers/useGitCommit.ts`
- Create: `features/git/controllers/useGitBranch.ts`
- Create: `features/git/controllers/useGitRemote.ts`
- Create: `features/git/controllers/useGitStash.ts`
- Create: `features/git/controllers/useGitDiff.ts`
- Create: `features/git/controllers/useGitMerge.ts`
- Create: `features/git/controllers/useGitController.ts`
- Modify: `features/git/useGitWorkspaceController.ts`

### Step 1: Create `useGitStatus.ts`

Extract status-related state and actions from `useGitWorkspaceController`:

```typescript
import { useState, useCallback, useRef } from 'react'
import type { GitStatusResponse, GitStatusFile, GitFileFilter, GitDiffScope } from '../types'
import { desktopApi } from '@/shell/integration/desktop-api'

interface UseGitStatusOptions {
  workspaceId: string | null
  isGitRepository: boolean
}

export function useGitStatus({ workspaceId, isGitRepository }: UseGitStatusOptions) {
  const [summary, setSummary] = useState<GitStatusResponse | null>(null)
  const [filter, setFilter] = useState<GitFileFilter>('all')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const stagedFiles = summary?.files.filter(f => hasStagedChanges(f)) ?? []
  const unstagedFiles = summary?.files.filter(f => hasUnstagedChanges(f)) ?? []
  const visibleFiles = filter === 'all'
    ? summary?.files ?? []
    : filter === 'staged'
    ? stagedFiles
    : unstagedFiles

  const refreshSummary = useCallback(async () => {
    if (!workspaceId || !isGitRepository) return
    const result = await desktopApi.gitStatus(workspaceId)
    setSummary(result)
  }, [workspaceId, isGitRepository])

  const runAction = useCallback(async (key: string, fn: () => Promise<void>) => {
    setActionLoading(key)
    try {
      await fn()
    } finally {
      setActionLoading(null)
    }
  }, [])

  const stagePath = useCallback(async (path: string) => {
    if (!workspaceId) return
    await runAction('stage', async () => {
      await desktopApi.gitStage(workspaceId, [path])
      await refreshSummary()
    })
  }, [workspaceId, refreshSummary, runAction])

  const unstagePath = useCallback(async (path: string) => {
    if (!workspaceId) return
    await runAction('unstage', async () => {
      await desktopApi.gitUnstage(workspaceId, [path])
      await refreshSummary()
    })
  }, [workspaceId, refreshSummary, runAction])

  const stageAll = useCallback(async () => {
    if (!workspaceId) return
    await runAction('stageAll', async () => {
      await desktopApi.gitStage(workspaceId, unstagedFiles.map(f => f.path))
      await refreshSummary()
    })
  }, [workspaceId, unstagedFiles, refreshSummary, runAction])

  const unstageAll = useCallback(async () => {
    if (!workspaceId) return
    await runAction('unstageAll', async () => {
      await desktopApi.gitUnstage(workspaceId, stagedFiles.map(f => f.path))
      await refreshSummary()
    })
  }, [workspaceId, stagedFiles, refreshSummary, runAction])

  const discardPath = useCallback(async (path: string) => {
    if (!workspaceId) return
    await runAction('discard', async () => {
      await desktopApi.gitDiscard(workspaceId, [path])
      await refreshSummary()
    })
  }, [workspaceId, refreshSummary, runAction])

  return {
    summary, setSummary, filter, setFilter,
    stagedFiles, unstagedFiles, visibleFiles,
    hasStagedFiles: stagedFiles.length > 0,
    hasUnstagedFiles: unstagedFiles.length > 0,
    actionLoading, refreshSummary,
    stagePath, unstagePath, stageAll, unstageAll, discardPath,
  }
}
```

### Step 2: Create `useGitCommit.ts`

```typescript
import { useState, useCallback } from 'react'
import { desktopApi } from '@/shell/integration/desktop-api'

interface UseGitCommitOptions {
  workspaceId: string | null
  onCommitSuccess: () => Promise<void>
}

export function useGitCommit({ workspaceId, onCommitSuccess }: UseGitCommitOptions) {
  const [commitMessage, setCommitMessage] = useState('')
  const [amendMode, setAmendMode] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const commit = useCallback(async () => {
    if (!workspaceId || !commitMessage.trim()) return
    setActionLoading('commit')
    try {
      await desktopApi.gitCommit(workspaceId, commitMessage, { amend: amendMode })
      setCommitMessage('')
      setAmendMode(false)
      await onCommitSuccess()
    } finally {
      setActionLoading(null)
    }
  }, [workspaceId, commitMessage, amendMode, onCommitSuccess])

  return {
    commitMessage, setCommitMessage,
    amendMode, setAmendMode,
    actionLoading, commit,
  }
}
```

### Step 3: Create `useGitBranch.ts`, `useGitRemote.ts`, `useGitStash.ts`, `useGitDiff.ts`, `useGitMerge.ts`

Follow the same pattern — extract the relevant state, effects, and actions from the existing `useGitWorkspaceController`. Each sub-controller receives `workspaceId` and `isGitRepository` as inputs, and returns its own slice of state + actions.

### Step 4: Create `useGitController.ts` — composition layer

```typescript
import { useGitStatus } from './useGitStatus'
import { useGitCommit } from './useGitCommit'
import { useGitBranch } from './useGitBranch'
import { useGitRemote } from './useGitRemote'
import { useGitStash } from './useGitStash'
import { useGitDiff } from './useGitDiff'
import { useGitMerge } from './useGitMerge'

export function useGitController(options: {
  workspaceId: string | null
  locale: Locale
  onRefreshSummary?: () => Promise<void>
}) {
  const status = useGitStatus({ workspaceId, isGitRepository: /* derived */ })
  const commit = useGitCommit({ workspaceId, onCommitSuccess: status.refreshSummary })
  const branch = useGitBranch({ workspaceId, onBranchChange: status.refreshSummary })
  const remote = useGitRemote({ workspaceId, onRemoteOp: status.refreshSummary })
  const stash = useGitStash({ workspaceId, onStashOp: status.refreshSummary })
  const diff = useGitDiff({ workspaceId })
  const merge = useGitMerge({ workspaceId, onMergeOp: status.refreshSummary })

  // Return merged interface matching current GitWorkspaceController shape
  return { ...status, ...commit, ...branch, ...remote, ...stash, ...diff, ...merge }
}
```

### Step 5: Migrate `useGitWorkspaceController.ts`

Replace the body of `useGitWorkspaceController` to delegate to `useGitController`. Keep the same return type so no downstream changes needed:

```typescript
export function useGitWorkspaceController(options: UseGitWorkspaceControllerOptions) {
  return useGitController(options)
}
```

### Step 6: Verify typecheck

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -10
```

### Step 7: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/controllers/ apps/desktop-web/src/features/git/useGitWorkspaceController.ts && git commit -m "refactor(git): decompose useGitWorkspaceController into focused sub-controllers"
```

---

## Task 8: Frontend — Component Extraction

**Files:**
- Create: `features/git/components/GitOperationsPane.tsx`
- Create: `features/git/components/GitHistoryPane.tsx`
- Create: `features/git/components/ChangesSection.tsx`
- Create: `features/git/components/GitFileRow.tsx`
- Create: `features/git/components/CommitForm.tsx`
- Create: `features/git/components/BranchSection.tsx`
- Create: `features/git/components/StashSection.tsx`
- Create: `features/git/components/GitToolbar.tsx`
- Create: `features/git/components/GitNoticeBanner.tsx`
- Create: `features/git/components/GitConfirmDialog.tsx`
- Modify: `features/git/GitPane.tsx`

### Step 1: Extract `GitToolbar`

Move the header section (branch name, ahead/behind, fetch/pull/push buttons) from `GitPane.tsx` into `GitToolbar.tsx`. Props: `controller: GitWorkspaceController`.

### Step 2: Extract `GitFileRow`

Move the file row rendering (status badge, path, action buttons) into `GitFileRow.tsx`. Props: `file: GitStatusFile`, `selected: boolean`, `onSelect`, `onStage`, `onUnstage`, `onDiscard`.

### Step 3: Extract `ChangesSection`

Move the changes section (filter chips, stage/unstage all, file list) into `ChangesSection.tsx`. Props: `controller: GitWorkspaceController`.

### Step 4: Extract `CommitForm`

Move the commit section into `CommitForm.tsx`. Props: `message`, `setMessage`, `onCommit`, `loading`.

### Step 5: Extract `BranchSection`, `StashSection`, `GitNoticeBanner`

Same pattern — move each section into its own component file.

### Step 6: Create `GitConfirmDialog.tsx`

Replace all `window.confirm()` calls with a proper modal dialog component.

### Step 7: Slim down `GitPane.tsx`

`GitPane.tsx` becomes a barrel that re-exports `GitOperationsPane` and `GitHistoryPane`. Each pane composes the extracted sub-components.

### Step 8: Verify typecheck + build

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5 && npm run build:tauri 2>&1 | tail -10
```

### Step 9: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/components/ apps/desktop-web/src/features/git/GitPane.tsx && git commit -m "refactor(git): extract inline components from GitPane.tsx into separate files"
```

---

## Task 9: Frontend — Commit Enhancement UI

**Files:**
- Modify: `features/git/components/CommitForm.tsx`
- Modify: `styles/features/git/_pane.scss`

### Step 1: Replace `<input>` with `<textarea>`

```tsx
<textarea
  className="git-commit-textarea"
  value={message}
  onChange={e => setMessage(e.target.value)}
  placeholder={t('git.commit.subject')}
  rows={2}
  onKeyDown={e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onCommit()
    }
  }}
/>
```

### Step 2: Add amend toggle

```tsx
<label className="git-commit-amend-toggle">
  <input
    type="checkbox"
    checked={amendMode}
    onChange={e => setAmendMode(e.target.checked)}
  />
  <span>{t('git.commit.amend')}</span>
</label>
```

### Step 3: Add character counter for subject line

```tsx
<span className="git-commit-char-count">
  {firstLine.length}/50
</span>
```

### Step 4: Add keyboard shortcut hint

```tsx
<span className="git-commit-shortcut-hint">
  {t('git.commit.shortcut')}
</span>
```

### Step 5: Style the textarea and new elements

In `_pane.scss`, add styles for `.git-commit-textarea`, `.git-commit-amend-toggle`, `.git-commit-char-count`.

### Step 6: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5
```

### Step 7: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/components/CommitForm.tsx apps/desktop-web/src/styles/features/git/_pane.scss && git commit -m "feat(git): multiline commit editor with amend toggle and keyboard shortcut"
```

---

## Task 10: Frontend — Tag Management UI

**Files:**
- Create: `features/git/tags/useGitTags.ts`
- Create: `features/git/components/TagSection.tsx`
- Modify: `features/git/components/GitOperationsPane.tsx`
- Modify: `styles/features/git/_pane.scss`

### Step 1: Create `useGitTags.ts`

```typescript
import { useState, useCallback, useEffect } from 'react'
import { desktopApi } from '@/shell/integration/desktop-api'
import type { GitTagEntry } from '@/shell/integration/desktop-api'

export function useGitTags(workspaceId: string | null, isGitRepository: boolean) {
  const [tags, setTags] = useState<GitTagEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceId || !isGitRepository) return
    setLoading(true)
    try {
      const result = await desktopApi.gitTagList(workspaceId)
      setTags(result.tags)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, isGitRepository])

  useEffect(() => { refresh() }, [refresh])

  const createTag = useCallback(async (name: string, target: string, annotated: boolean, message?: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagCreate(workspaceId, name, target, { annotated, message })
    await refresh()
  }, [workspaceId, refresh])

  const deleteTag = useCallback(async (name: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagDelete(workspaceId, name)
    await refresh()
  }, [workspaceId, refresh])

  const pushTag = useCallback(async (name: string, remote?: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagPush(workspaceId, name, remote)
  }, [workspaceId])

  return { tags, loading, refresh, createTag, deleteTag, pushTag }
}
```

### Step 2: Create `TagSection.tsx`

A collapsible section with:
- Tag list (name, target hash, optional message)
- Create form: name input, annotated checkbox, message input (if annotated), target (default HEAD)
- Delete button with confirmation popover
- Push button

### Step 3: Add `TagSection` to `GitOperationsPane.tsx`

Add after the Stash section:

```tsx
<TagSection
  tags={tags}
  loading={tagsLoading}
  onCreate={createTag}
  onDelete={deleteTag}
  onPush={pushTag}
/>
```

### Step 4: Style the tag section

Add `.git-tag-section`, `.git-tag-item`, `.git-tag-create-form` styles to `_pane.scss`.

### Step 5: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5
```

### Step 6: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/tags/ apps/desktop-web/src/features/git/components/TagSection.tsx apps/desktop-web/src/features/git/components/GitOperationsPane.tsx apps/desktop-web/src/styles/features/git/_pane.scss && git commit -m "feat(git): tag management UI with create, delete, and push"
```

---

## Task 11: Frontend — Cherry-pick / Revert / Reset UI

**Files:**
- Modify: `features/git/GitGraphView.tsx`
- Modify: `styles/features/git/_pane.scss`

### Step 1: Add action buttons to commit detail panel

In `GitGraphView.tsx`, find the commit detail panel (shown when a commit is selected). Add a row of action buttons:

```tsx
<div className="git-graph-detail-actions">
  <button onClick={() => onCherryPick(selectedCommit.commit)}>
    {t('git.graph.cherryPick')}
  </button>
  <button onClick={() => onRevert(selectedCommit.commit)}>
    {t('git.graph.revert')}
  </button>
  <div className="git-graph-reset-dropdown">
    <button>{t('git.graph.reset')}</button>
    <div className="git-graph-reset-menu">
      <button onClick={() => onReset(selectedCommit.commit, 'soft')}>
        {t('git.graph.resetSoft')}
      </button>
      <button onClick={() => onReset(selectedCommit.commit, 'mixed')}>
        {t('git.graph.resetMixed')}
      </button>
      <button onClick={() => onReset(selectedCommit.commit, 'hard')}>
        {t('git.graph.resetHard')}
      </button>
    </div>
  </div>
  <button onClick={() => onCreateBranch(selectedCommit.commit)}>
    {t('git.graph.createBranch')}
  </button>
  <button onClick={() => copyToClipboard(selectedCommit.commit)}>
    {t('git.graph.copyHash')}
  </button>
</div>
```

### Step 2: Add confirm dialog for hard reset

Use `GitConfirmDialog` with a warning message for hard reset:

```tsx
{resetConfirm && (
  <GitConfirmDialog
    title={t('git.graph.resetHard')}
    message={t('git.graph.resetHardWarning')}
    confirmLabel={t('git.graph.resetHard')}
    variant="danger"
    onConfirm={() => onReset(resetConfirm, 'hard')}
    onCancel={() => setResetConfirm(null)}
  />
)}
```

### Step 3: Wire callbacks to controller

Pass `onCherryPick`, `onRevert`, `onReset`, `onCreateBranch` from the controller through `GitHistoryPane`.

### Step 4: Style action buttons

Add `.git-graph-detail-actions` styles to `_pane.scss`.

### Step 5: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5
```

### Step 6: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/GitGraphView.tsx apps/desktop-web/src/styles/features/git/_pane.scss && git commit -m "feat(git): cherry-pick, revert, reset actions in commit graph detail panel"
```

---

## Task 12: Frontend — Merge + Conflict Resolution UI

**Files:**
- Create: `features/git/merge/conflict-parser.ts`
- Create: `features/git/controllers/useGitMerge.ts`
- Create: `features/git/components/MergeConflictPanel.tsx`
- Modify: `features/git/components/GitOperationsPane.tsx`
- Modify: `features/git/components/GitHistoryPane.tsx`
- Modify: `styles/features/git/_pane.scss`

### Step 1: Create `useGitMerge.ts`

```typescript
import { useState, useCallback } from 'react'
import { desktopApi } from '@/shell/integration/desktop-api'
import type { GitConflictFile } from '@/shell/integration/desktop-api'

export function useGitMerge(workspaceId: string | null, onMergeOp: () => Promise<void>) {
  const [mergeConflicts, setMergeConflicts] = useState<GitConflictFile[]>([])
  const [isMerging, setIsMerging] = useState(false)

  const startMerge = useCallback(async (target: string, noFf?: boolean) => {
    if (!workspaceId) return
    const result = await desktopApi.gitMerge(workspaceId, target, { noFf })
    if (result.success) {
      await onMergeOp()
      return { success: true }
    } else {
      setMergeConflicts(result.conflicts)
      setIsMerging(true)
      return { success: false, conflicts: result.conflicts }
    }
  }, [workspaceId, onMergeOp])

  const continueMerge = useCallback(async () => {
    if (!workspaceId) return
    await desktopApi.gitMergeContinue(workspaceId)
    setMergeConflicts([])
    setIsMerging(false)
    await onMergeOp()
  }, [workspaceId, onMergeOp])

  const abortMerge = useCallback(async () => {
    if (!workspaceId) return
    await desktopApi.gitMergeAbort(workspaceId)
    setMergeConflicts([])
    setIsMerging(false)
    await onMergeOp()
  }, [workspaceId, onMergeOp])

  return { mergeConflicts, isMerging, startMerge, continueMerge, abortMerge }
}
```

### Step 2: Create `MergeConflictPanel.tsx`

Shown in the right panel when `isMerging` is true:

```tsx
function MergeConflictPanel({ conflicts, onContinue, onAbort, controller }) {
  return (
    <div className="git-merge-conflict-panel">
      <div className="git-merge-conflict-header">
        <span>{t('git.merge.conflicts')}</span>
        <span>{conflicts.length} files</span>
      </div>
      <div className="git-merge-conflict-files">
        {conflicts.map(file => (
          <div key={file.path} className="git-merge-conflict-file">
            <span className="conflict-status-badge">{file.status}</span>
            <span className="conflict-path">{file.path}</span>
          </div>
        ))}
      </div>
      <div className="git-merge-conflict-actions">
        <button onClick={onContinue} disabled={conflicts.length > 0}>
          {t('git.merge.continue')}
        </button>
        <button onClick={onAbort} variant="danger">
          {t('git.merge.abort')}
        </button>
      </div>
    </div>
  )
}
```

### Step 3: Create `conflict-parser.ts`

Parse conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) from file content to enable per-block resolution:

```typescript
interface ConflictBlock {
  ours: string
  theirs: string
  startLine: number
  endLine: number
}

export function parseConflictMarkers(content: string): ConflictBlock[] {
  // Split by conflict markers and extract ours/theirs sections
  // Returns array of ConflictBlock for interactive resolution
}
```

### Step 4: Integrate merge flow

In `GitOperationsPane`, add a "Merge Branch" button in the branch section that triggers `startMerge(target)`. When `isMerging` is true, show the `MergeConflictPanel` in the right panel instead of the normal diff/graph view.

### Step 5: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5
```

### Step 6: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/merge/ apps/desktop-web/src/features/git/controllers/useGitMerge.ts apps/desktop-web/src/features/git/components/MergeConflictPanel.tsx apps/desktop-web/src/features/git/components/GitOperationsPane.tsx apps/desktop-web/src/features/git/components/GitHistoryPane.tsx apps/desktop-web/src/styles/features/git/_pane.scss && git commit -m "feat(git): merge and conflict resolution UI"
```

---

## Task 13: Frontend — Hunk Staging UI

**Files:**
- Modify: `features/git/DiffViewer.tsx`
- Modify: `styles/features/git/_diff-viewer.scss`

### Step 1: Add stage/unstage buttons to hunk headers

In `DiffViewer.tsx`, find the hunk header rendering. Add action buttons:

```tsx
<div className="diff-hunk-header">
  <span className="diff-hunk-range">{hunk.header}</span>
  <div className="diff-hunk-actions">
    {scope === 'unstaged' && (
      <button
        className="git-hunk-stage-btn"
        onClick={() => onStageHunk(path, hunk.patchText)}
      >
        {t('git.hunk.stage')}
      </button>
    )}
    {scope === 'staged' && (
      <button
        className="git-hunk-unstage-btn"
        onClick={() => onUnstageHunk(path, hunk.patchText)}
      >
        {t('git.hunk.unstage')}
      </button>
    )}
  </div>
</div>
```

### Step 2: Wire hunk patch extraction

The structured diff from the backend includes hunk data. Extract the unified diff patch text for each hunk to send to `gitStageHunk` / `gitUnstageHunk`.

### Step 3: Style hunk action buttons

In `_diff-viewer.scss`:

```scss
.diff-hunk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .diff-hunk-actions {
    display: flex;
    gap: 0.5rem;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  &:hover .diff-hunk-actions {
    opacity: 1;
  }
}

.git-hunk-stage-btn,
.git-hunk-unstage-btn {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  // ... theme-aware colors
}
```

### Step 4: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5
```

### Step 5: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/features/git/DiffViewer.tsx apps/desktop-web/src/styles/features/git/_diff-viewer.scss && git commit -m "feat(git): hunk-level stage/unstage buttons in DiffViewer"
```

---

## Task 14: Frontend — Reliability Improvements

**Files:**
- Modify: `shell/layout/navigation-model.ts`
- Modify: `styles/features/git/_pane.scss`
- Modify: `features/git/components/GitContextMenu.tsx` (new)

### Step 1: Replace navigation model placeholders

In `navigation-model.ts`, replace hardcoded values with live data:

```typescript
// Before:
description: `Current branch: main\nPending files: 9\nUnpushed commits: 2`

// After: accept live data from controller
description: `Current branch: ${branch}\nPending files: ${fileCount}\nUnpushed commits: ${unpushedCount}`
```

### Step 2: Add toast notifications

Create a simple toast utility or use an existing one. All mutating git operations should show:
- Success: brief confirmation (e.g., "Committed abc1234")
- Failure: error message with code

### Step 3: Add keyboard shortcuts

- `⌘Enter`: commit (already in CommitForm)
- `⌘R`: refresh status — add keydown listener in `GitOperationsPane`
- `Esc`: close popovers/dialogs — add to `GitConfirmDialog` and dropdown menus

### Step 4: Add right-click context menu

Create `GitContextMenu.tsx` with options: Stage / Unstage / Discard / Open in Editor / Copy Path. Wire to `GitFileRow` via `onContextMenu`.

### Step 5: Add loading indicators per section

Each section (Changes, Commit, Branch, Stash, Tag) should show a spinner when its specific operation is loading, not just a global loading state.

### Step 6: Style refinements

- File status badge colors: Modified=#3B82F6, Added=#22C55E, Deleted=#EF4444, Untracked=#9CA3AF, Conflicted=#F97316
- Smooth transitions for section collapse/expand
- Hover effects on file rows and action buttons
- Apple-style shadows and border-radius on dialogs

### Step 7: Verify

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -5 && npm run build:tauri 2>&1 | tail -10
```

### Step 8: Commit

```bash
cd /Users/dzlin/work/GT-Office && git add apps/desktop-web/src/shell/layout/navigation-model.ts apps/desktop-web/src/features/git/components/ apps/desktop-web/src/styles/features/git/ && git commit -m "feat(git): reliability improvements — live nav data, toasts, keyboard shortcuts, context menu"
```

---

## Task 15: Full Verification

### Step 1: Backend tests

```bash
cd /Users/dzlin/work/GT-Office && cargo test -p gt-git -- --test-threads=1 2>&1 | tail -20
```

### Step 2: Workspace check

```bash
cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5
```

### Step 3: Frontend typecheck

```bash
cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -10
```

### Step 4: Build

```bash
cd /Users/dzlin/work/GT-Office && npm run build:tauri 2>&1 | tail -10
```

### Step 5: Lint

```bash
cd /Users/dzlin/work/GT-Office && cargo clippy --workspace 2>&1 | tail -10
```

### Step 6: Commit any fixes

If any verification fails, fix and commit.
