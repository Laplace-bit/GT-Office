# Git Multi-Repository Architecture

## Goal

Make Git usable for monorepos, nested repos, and workspace collections without losing the responsiveness of the single-repo flow.

## Constraints

- Workspace switch should show the correct Git state immediately.
- Routine Git refresh should stay within the perceived-interactive budget, with a target under 500ms for normal workspaces.
- File watchers must update branch / dirty state for both the workspace root repo and nested repos.
- Frontend should expose multi-repo state explicitly instead of hiding it behind a single flat file list.

## Backend Model

`GitService::status(workspace_id)` is the aggregate entry point.

- Discover all repositories inside the workspace.
- Continue recursive discovery even after a nested repository is found so deeper repositories are still indexed.
- Resolve each repository into a scoped `GitRepoContext`.
- Run `status_repo()` per repository.
- Build one aggregate payload:
  - workspace-level `files`
  - `repositories[]` per repo
  - `primaryRepositoryPath` as the active default
  - `totalChanges` / `truncated` so the global 2000-entry budget for each status view is explicit

Registered submodules are repositories in the same model, with `kind: submodule` and a
`ready`, `uninitialized`, or `invalid` state. A dirty initialized submodule is reported through
its own repository summary; the parent gitlink is kept only when the submodule commit pointer
changed. Invalid nested `.git` markers are isolated instead of failing healthy repositories.

All mutating commands continue to accept `repositoryPath`, so stage / unstage / commit / fetch / pull / push stay repo-scoped.

Implementation anchors:

- Repository discovery and aggregation: `crates/gt-git/src/lib.rs`
- Tauri command surface with optional `repositoryPath`: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Debounced and immediate refresh coordinator: `apps/desktop-tauri/src-tauri/src/commands/git/status_coordinator.rs`
- Watcher-driven cache invalidation: `apps/desktop-tauri/src-tauri/src/filesystem_watcher.rs`

## Performance Strategy

Repository discovery is the expensive part in a large workspace because recursive `.git` scanning grows with the full tree size, not with the changed files.

The current implementation now uses:

- Repository discovery cache keyed by workspace root, with explicit watcher invalidation and a
  60-second safety expiry to recover from dropped topology events without rescanning every poll.
- Watcher-driven invalidation before the next scheduled Git refresh.
- Debounced status refresh for filesystem bursts.
- One serialized refresh worker per workspace, with immediate requests coalesced into that worker.
- Status reads are bounded to eight repositories at a time.
- File signatures hash files up to 8 MiB completely. Larger files combine size, timestamps,
  platform change metadata, and 16 evenly spaced 16 KiB samples, so every refresh reads at most
  256 KiB per large dirty file. One status invocation shares a 64 MiB read budget; after it is
  exhausted, remaining signatures use explicit metadata-only markers. The index entry OID still
  detects hunk-only staging changes.
- Aggregate status excludes descendant repository paths before counting or applying limits, then
  divides one 2000-entry budget across ready repositories before signatures are built; non-ready
  submodules do not consume file quota. `totalChanges` reports the complete non-duplicated count
  and `truncated` exposes partial file lists.
- Inline structured diffs and expanded comparisons cap each side at 4 MiB, the accumulated patch
  at 8 MiB, and rendered lines at 50,000. Oversized structured results return `tooLarge`; raw diff
  requests fail explicitly with `GIT_DIFF_TOO_LARGE`.
- Tauri Git commands execute on blocking workers instead of the UI runtime and now emit warnings when a command exceeds the 500ms target budget.

This keeps repeated refreshes bounded by actual Git status work instead of repeated directory traversal.

Frontend repository switching now follows the same principle:

- workspace-level git summary is cached per workspace so revisiting a workspace restores the last known branch / counts immediately
- workspace summary is reused immediately from the aggregate payload
- repository-scoped branch / stash / history metadata is cached per workspace+repo key
- repository selection is remembered per workspace, so switching away and back restores the last active repo immediately
- switching back to a repository restores cached metadata instantly, then reconciles in background
- stale summary requests are ignored when the user has already switched to another workspace
- workspace open / switch uses the serialized backend refresh as its fast path; direct frontend
  status reads are reserved for bootstrap and periodic reconciliation
- the file tree consumes the shell summary instead of starting another full repository scan
- structured diff caches keep 8 entries, expanded comparisons keep 5, commit details keep 20,
  and redundant raw patch text is removed before crossing or staying in the renderer cache

Runtime observability also enforces the latency target operationally:

- aggregated status refresh logs a warning when it exceeds the 500ms target budget
- watcher refreshes emit `git/updated` only when the payload fingerprint changes; user-initiated
  immediate refreshes force one snapshot so newly opened windows do not depend on prior event history

## Watcher Rules

Git refresh must trigger on:

- working tree file changes inside any repository
- branch / index metadata changes inside any `.git` directory, including nested repos
- submodule metadata changes under `.git/modules/**`
- `.gitmodules` and nested `.git` pointer changes, which also invalidate repository discovery

Nested repo metadata matters because branch switches, rebases, and external Git operations may only touch `packages/*/.git/*`.
Watcher events are the fast path. The visible frontend also reconciles the active workspace every
10 seconds and on focus, so a dropped native watcher event does not leave file or branch state stale.

## Frontend Model

The frontend should follow a two-level model similar to VS Code Source Control:

1. Repository overview
2. Active repository detail

Repository overview shows:

- repository path
- branch
- ahead / behind
- staged / unstaged / total file counts
- current active repository
- submodule state and an explicit initialize action for uninitialized submodules

Active repository detail shows:

- changed files
- commit form
- branch / stash / tag operations
- history / diff scoped to the selected repository

This prevents cross-repo ambiguity and makes it obvious which repo a commit or branch operation will affect.

## Workspace Switching

Workspace active-change events must trigger an immediate Git summary reload for the new workspace. Relying only on watcher traffic is insufficient because the new workspace may be idle.

Current implementation:

- workspace summary cache restores the last known Git state immediately when revisiting a workspace
- repository selection is remembered per workspace in the controller layer
- repository-scoped branch / stash / history caches are restored before background reconciliation
- stale async refresh results are dropped if the user already switched workspace or repository
- closing a workspace cancels its refresh generation and pending watcher batch before removing it
- a closed active workspace clears frontend Git state; late status responses are ignored
- closing a presented workspace releases its file tree before the replacement workspace restores,
  so no directory request is sent with an already-closed workspace id
- close requests provide the adjacent tab selected from stable UI order, and the response returns
  the authoritative active workspace as a fallback when event delivery fails

## Verification

The following tests and checks currently cover the critical path:

- `cargo test -p gt-git status_aggregates_workspace_root_and_nested_repositories`
- `cargo test -p gt-git repository_cache_invalidation_discovers_new_nested_repository`
- `cargo test -p gt-git status_discovers_repositories_nested_under_other_repositories`
- `cargo test -p gt-git cached_multi_repository_status_preserves_all_repository_results`
- `cargo test -p gt-git status_describes_initialized_submodule_and_marks_parent_gitlink`
- `cargo test -p gt-git uninitialized_submodule_is_reported_and_can_be_initialized_explicitly`
- `cargo test -p gt-git status_signature_changes_when_only_staged_hunk_changes`
- `cargo test -p gt-git aggregate_status_shares_global_file_budget_across_repositories`
- `cargo test -p gt-git aggregate_status_excludes_nested_repo_before_counting_and_capping`
- `cargo test -p gt-git aggregate_status_non_ready_repositories_do_not_consume_file_quota`
- `cargo test -p gt-git content_hash_reads_small_files_fully_and_large_files_within_fixed_budget`
- `cargo test -p gt-git status_content_hashes_respect_one_shared_read_budget`
- `cargo test -p gt-git oversized_file_diff_is_bounded_for_worktree_index_and_head`
- `cargo test -p gt-git excessive_diff_lines_return_too_large_without_building_hunks`
- `cargo test -p gt-git --test lib_tests hunk`
- `cargo test -p gt-git expired_repository_cache_rediscovers_topology_without_watcher_invalidation`
- `cargo test -p gtoffice-desktop-tauri repository_cache_invalidation_is_reserved_for_repo_topology_changes`
- `cargo test -p gtoffice-desktop-tauri git_status_payload_keeps_contract_fields`
- `cd apps/desktop-web && npm run build`
- `cd apps/desktop-web && npm exec -- tsc -p tsconfig.tests.json`
- `cd apps/desktop-web && node --test .test-dist/tests/repository-selection-model.test.js`
- `cd apps/desktop-web && node --test .test-dist/tests/workspace-git-summary-model.test.js`
- `cd apps/desktop-web && node --test .test-dist/tests/git-helpers.test.js`
- `cd apps/desktop-web && node --test .test-dist/tests/file-tree-data.test.js`

## Next Recommended Steps

- Persist the selected repository per workspace window.
- Add repository-level collapse / expand state in the changes pane.
- Optionally surface an “All repositories” grouped file view once commit and discard semantics are clearly separated per repo.
