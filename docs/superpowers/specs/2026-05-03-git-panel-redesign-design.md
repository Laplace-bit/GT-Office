# Git Panel Redesign — Design Spec

**Date**: 2026-05-03
**Status**: Approved
**Scope**: Visual/UX polish, feature completeness, reliability improvements
**Design Reference**: Tower (professional Git client, macOS native feel)

---

## 1. Goals

1. **Visual & Interaction**: Tower-inspired Apple-style design, polished animations, responsive layout
2. **Feature Completeness**: Add Merge/Conflict Resolution, Cherry-pick/Revert/Reset, Tag management, Commit enhancement (multiline + amend), Hunk-level staging
3. **Reliability**: Replace placeholder data, unified error handling, loading states, keyboard shortcuts

## 2. Architecture

### 2.1 Controller Decomposition

Split `useGitWorkspaceController` (~894 lines) into focused sub-controllers:

```
features/git/controllers/
├── useGitStatus.ts        # status, stage, unstage, discard, file list state
├── useGitCommit.ts        # commit, amend, multiline message
├── useGitBranch.ts        # branch list, checkout, create, delete
├── useGitRemote.ts        # fetch, pull, push, ahead/behind
├── useGitStash.ts         # stash push/pop/apply/drop/list
├── useGitDiff.ts          # diff cache (LRU), preload, structured diff
├── useGitMerge.ts         # merge, conflict detection, resolve (NEW)
└── useGitController.ts    # Composition layer: aggregates sub-controllers, exposes unified interface
```

**Composition pattern**: `useGitController` calls all sub-controllers and returns a merged object. Components receive the same controller shape as today — no prop threading changes needed.

### 2.2 Component Extraction

Extract inline components from `GitPane.tsx` (~1188 lines):

```
features/git/components/
├── GitOperationsPane.tsx       # Left panel shell (slim container)
├── GitHistoryPane.tsx          # Right panel shell
├── ChangesSection.tsx          # File list + filter chips + stage/unstage all
├── GitFileRow.tsx              # Single file row (status badge + hover actions)
├── CommitForm.tsx              # Multiline commit editor + amend toggle
├── BranchSection.tsx           # Branch management area
├── StashSection.tsx            # Stash management area
├── MergeConflictPanel.tsx      # Conflict resolution panel (NEW)
├── TagSection.tsx              # Tag management area (NEW)
├── GitToolbar.tsx              # Top toolbar (fetch/pull/push/branch switcher)
├── GitNoticeBanner.tsx         # Status notification banner
├── GitConfirmDialog.tsx        # Reusable confirm dialog (replaces window.confirm)
└── GitContextMenu.tsx          # Right-click context menu
```

### 2.3 New Modules

```
features/git/merge/
├── conflict-parser.ts     # Parse conflict markers from file content
└── merge-strategy.ts      # Merge/rebase selection logic

features/git/tags/
└── useGitTags.ts          # Tag CRUD hook
```

### 2.4 Files Unchanged

- `GitGraphView.tsx` — virtual-scroll SVG graph (733 lines, stable)
- `DiffViewer.tsx` — structured diff rendering (422 lines, will add hunk staging)
- `git-graph-layout.ts` — lane algorithm (212 lines)
- `git-error.ts`, `git-font-scale.ts` — utilities

### 2.5 Barrel Update

`GitPane.tsx` becomes a barrel re-exporting `GitOperationsPane` and `GitHistoryPane`.
`index.ts` updates exports to include new components and controllers.

## 3. UI Layout & Interaction Design

### 3.1 Left Panel (GitOperationsPane)

**Header**
- Current branch name + ahead/behind indicators (`main ↑2 ↓1`)
- Toolbar buttons: Refresh / Fetch / Pull / Push with loading spinners
- Branch switcher: click branch name → popover list with search filter (replaces `<select>`)

**Changes Section**
- Filter chips: `All (12)` / `Staged (3)` / `Unstaged (9)` — with count badges
- File list (virtual-scroll):
  - Status badge with color coding: Modified=blue, Added=green, Deleted=red, Untracked=gray, Conflicted=orange
  - Tree view with collapsible directories (not flat list) — group files by common path prefix, collapse/expand directories, virtual-scroll the flattened visible list
  - Hover actions: Stage / Unstage / Discard (not always-visible)
  - Right-click context menu: Stage / Unstage / Discard / Open in Editor / Copy Path
- Conflicted files: special orange marker, click enters conflict resolution mode

**Commit Section (Enhanced)**
- `<textarea autoResize>` replacing `<input>`, min 2 lines, max 8 lines
- Empty line separates subject (recommend 50 chars) and body (recommend 72 chars/line)
- Character counter for subject line
- Amend toggle: checkbox, when checked loads previous commit message via `gitCommitDetail`
- Submit: Commit button + keyboard hint (⌘Enter)

**Branch Section (Optimized)**
- Collapsible tree: `Local` / `Remote` groups
- Current branch highlighted with indicator
- Checkout: single click (replaces select + button two-step)
- Delete: confirmation popover (replaces `window.confirm`)

**Stash Section**
- Keep existing structure
- Add `Stash Drop` and `Stash Apply` (without removing from list)

**Tag Section (NEW)**
- Collapsible tag list
- Create tag: lightweight / annotated choice, name + optional message
- Delete tag with confirmation

### 3.2 Right Panel (GitHistoryPane)

**Git Graph View**
- Keep virtual-scroll + SVG lane rendering
- Selected commit detail panel gains action buttons:
  - Cherry Pick / Revert / Reset (soft/mixed/hard) / Create Branch from here / Copy Hash
- Add search box: filter by message, author, hash

**Diff Viewer**
- Integrate Shiki syntax highlighting (replace `SimpleDiffView` fallback)
- Collapsible hunk headers
- Hunk-level Stage/Unstage buttons in hunk header area

**Conflict Resolution View (NEW)**
- Activated when merge conflicts detected
- Three-way merge view: Base / Ours / Theirs
- Per-conflict-block actions: Accept Ours / Accept Theirs / Accept Both
- Manual edit mode
- Post-resolution: "Continue Merge" / "Abort Merge" buttons

## 4. New Feature Details

### 4.1 Commit Enhancement (Multiline + Amend)

**Frontend**:
- `CommitForm` uses `<textarea autoResize>`, min 2 rows, max 8 rows
- Amend toggle: on check, call `gitCommitDetail(lastCommitHash)` to pre-fill message
- Submit sends `{ message: "subject\n\nbody", amend: boolean }`

**Backend**:
- `git_commit` command adds `amend: Option<bool>` parameter
- amend=true uses `git commit --amend`
- Extend `commit()` method in `gt-git` crate

### 4.2 Tag Management

**New backend commands**:
- `git_tag_list(workspace_id)` → `Vec<TagEntry>` (name, oid, target, tagger, message)
- `git_tag_create(workspace_id, name, target, annotated?, message?)`
- `git_tag_delete(workspace_id, name)`
- `git_tag_push(workspace_id, remote?, tag_name)`

**Frontend**:
- `useGitTags` hook: list / create / delete / push
- `TagSection` component: list + create form + delete confirmation

### 4.3 Cherry-pick / Revert / Reset

**New backend commands**:
- `git_cherry_pick(workspace_id, commit_oid)`
- `git_revert(workspace_id, commit_oid)`
- `git_reset(workspace_id, target, mode: "soft"|"mixed"|"hard")`

**Frontend**:
- Action buttons in GitGraphView commit detail panel
- Reset uses dedicated confirmation dialog (hard reset is destructive)
- Cherry-pick / Revert auto-refresh status after execution

### 4.4 Merge + Conflict Resolution

**New backend commands**:
- `git_merge(workspace_id, target, no_ff?: bool)` → `MergeResult`
- `git_merge_continue(workspace_id)` → continue after conflict resolution
- `git_merge_abort(workspace_id)` → abort merge
- `git_conflict_list(workspace_id)` → `Vec<ConflictFile>`

**MergeResult type**:
```rust
struct MergeResult {
  success: bool,
  conflicts: Vec<ConflictFile>,
  merged_commit: Option<String>,
}

struct ConflictFile {
  path: String,
  status: ConflictStatus, // BothModified, DeletedByUs, DeletedByThem, AddedByBoth
}
```

**Frontend conflict resolution flow**:
1. User selects target branch → calls `git_merge`
2. If `conflicts` non-empty:
   - Left panel Changes shows conflicted files (orange markers)
   - Right panel switches to Conflict Resolution view
   - User resolves each conflict (ours/theirs/both/manual edit)
   - Resolved files auto-stage
3. All resolved → "Continue Merge" button appears
4. "Abort Merge" available at any time

### 4.5 Hunk-level Stage/Unstage

**New backend commands**:
- `git_stage_hunk(workspace_id, path, patch_text)`
- `git_unstage_hunk(workspace_id, path, patch_text)`

**Frontend**:
- DiffViewer hunk header gains Stage/Unstage buttons
- On click, extract hunk patch text and send to backend

## 5. Reliability Improvements

### 5.1 Navigation Model
- Replace hardcoded placeholders in `navigation-model.ts` with live data from `useGitController`
- Show real: current branch, pending file count, unpushed commit count

### 5.2 Error Handling
- All git operations show toast notifications (success/failure)
- Typed error codes preserved from backend
- User-friendly error messages with i18n

### 5.3 Loading States
- Each section has independent loading indicators
- Optimistic UI for stage/unstage (immediate visual feedback, revert on error)

### 5.4 Keyboard Shortcuts
- ⌘Enter: commit
- ⌘R: refresh status
- Esc: close popovers/dialogs
- ↑/↓: navigate file list
- Enter: stage/unstage selected file

### 5.5 Large Repository
- Status file cap (2000) with "Show more" prompt
- Virtual scroll for all lists (already in place)
- Diff LRU cache (already in place, max 30 entries)

## 6. Style Guidelines

- SCSS only, no new CSS files
- Responsive units (rem), no px
- Container queries for responsive breakpoints (56rem, 42rem, 32rem)
- Apple-style: subtle shadows, rounded corners, smooth transitions
- Dark/light theme support via design tokens
- Status colors: Modified=#3B82F6, Added=#22C55E, Deleted=#EF4444, Untracked=#9CA3AF, Conflicted=#F97316

## 7. Backend Changes Summary

### New Tauri Commands (13)
1. `git_tag_list`
2. `git_tag_create`
3. `git_tag_delete`
4. `git_tag_push`
5. `git_cherry_pick`
6. `git_revert`
7. `git_reset`
8. `git_merge`
9. `git_merge_continue`
10. `git_merge_abort`
11. `git_conflict_list`
12. `git_stage_hunk`
13. `git_unstage_hunk`

### Modified Commands (1)
- `git_commit` — add `amend` parameter

### New Crates/Modules
- `gt-git`: extend with merge, tag, cherry-pick, revert, reset, hunk staging logic
- `gt-abstractions`: add `TagEntry`, `MergeResult`, `ConflictFile`, `ConflictStatus` types

## 8. Scope Control

**In scope**:
- All items listed above

**Out of scope** (for this iteration):
- Interactive rebase
- Blame view
- Git worktree management
- Submodule support
- GPG signing configuration
- In-app credential management
- Sparse checkout
