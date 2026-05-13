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

All mutating commands continue to accept `repositoryPath`, so stage / unstage / commit / fetch / pull / push stay repo-scoped.

Implementation anchors:

- Repository discovery and aggregation: `crates/gt-git/src/lib.rs`
- Tauri command surface with optional `repositoryPath`: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
- Debounced and immediate refresh coordinator: `apps/desktop-tauri/src-tauri/src/commands/git/status_coordinator.rs`
- Watcher-driven cache invalidation: `apps/desktop-tauri/src-tauri/src/filesystem_watcher.rs`

## Performance Strategy

Repository discovery is the expensive part in a large workspace because recursive `.git` scanning grows with the full tree size, not with the changed files.

The current implementation now uses:

- Repository discovery cache keyed by workspace root.
- Watcher-driven invalidation before the next scheduled Git refresh.
- Debounced status refresh for filesystem bursts.
- Immediate refresh for user-initiated Git mutations.
- Tauri Git commands execute on blocking workers instead of the UI runtime and now emit warnings when a command exceeds the 500ms target budget.

This keeps repeated refreshes bounded by actual Git status work instead of repeated directory traversal.

Frontend repository switching now follows the same principle:

- workspace-level git summary is cached per workspace so revisiting a workspace restores the last known branch / counts immediately
- workspace summary is reused immediately from the aggregate payload
- repository-scoped branch / stash / history metadata is cached per workspace+repo key
- repository selection is remembered per workspace, so switching away and back restores the last active repo immediately
- switching back to a repository restores cached metadata instantly, then reconciles in background
- stale summary requests are ignored when the user has already switched to another workspace

Runtime observability also enforces the latency target operationally:

- aggregated status refresh logs a warning when it exceeds the 500ms target budget
- user-initiated mutations refresh status on a non-UI worker path and emit `git/updated` only when the payload fingerprint changes

## Watcher Rules

Git refresh must trigger on:

- working tree file changes inside any repository
- branch / index metadata changes inside any `.git` directory, including nested repos

Nested repo metadata matters because branch switches, rebases, and external Git operations may only touch `packages/*/.git/*`.

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

## Verification

The following tests and checks currently cover the critical path:

- `cargo test -p gt-git status_aggregates_workspace_root_and_nested_repositories`
- `cargo test -p gt-git repository_cache_invalidation_discovers_new_nested_repository`
- `cargo test -p gt-git status_discovers_repositories_nested_under_other_repositories`
- `cargo test -p gt-git cached_multi_repository_status_stays_within_interactive_budget`
- `cargo test -p gtoffice-desktop-tauri repository_cache_invalidation_is_reserved_for_repo_topology_changes`
- `cargo test -p gtoffice-desktop-tauri git_status_payload_keeps_contract_fields`
- `cd apps/desktop-web && npm run build`
- `node --test apps/desktop-web/tests/repository-selection-model.test.js`
- `node --test apps/desktop-web/tests/workspace-git-summary-model.test.js`
- `node --test apps/desktop-web/tests/git-helpers.test.js`

Known limitation:

- `cd apps/desktop-web && npm run test:unit` is not currently green because the repo already has unrelated TypeScript test harness issues outside the Git multi-repo path.

## Next Recommended Steps

- Persist the selected repository per workspace window.
- Add repository-level collapse / expand state in the changes pane.
- Optionally surface an “All repositories” grouped file view once commit and discard semantics are clearly separated per repo.
