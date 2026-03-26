# File Name Search Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file-name search return matches from the whole workspace, including directories not yet loaded in the file tree, while keeping UI latency low.

**Architecture:** Keep content search unchanged. Replace file-name mode’s front-end tree filtering with the existing Tauri `fs_search_files` backend search, then debounce requests and ignore stale responses so repeated typing stays cheap and responsive. Reuse the existing modal/result UI contract with the minimal state change needed.

**Tech Stack:** React 19, TypeScript, Tauri command bridge, Rust filesystem search, Node test + Rust test

---

### Task 1: Add failing regression coverage

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tests/filesystem_tests.rs`
- Create: `apps/desktop-web/tests/file-search-state.test.ts`
- Modify: `apps/desktop-web/tsconfig.tests.json`

- [ ] **Step 1: Write the failing Rust regression test**

Add a test that creates nested files without any frontend tree-loading assumption and proves `search_file_matches(...)` finds by filename from the workspace root.

- [ ] **Step 2: Run test to verify it passes for backend baseline**

Run: `cargo test -p desktop-tauri search_file_matches_finds_by_file_name -- --exact`
Expected: PASS

- [ ] **Step 3: Write the failing frontend regression test**

Extract the file-name search decision logic into a small pure helper and test that file mode uses backend results instead of loaded tree entries.

Example assertion shape:

```ts
assert.deepEqual(
  resolveVisibleFileMatches({
    mode: 'file',
    backendMatches: [{ path: 'nested/target.ts', name: 'target.ts' }],
    loadedEntries: [],
    query: 'target',
  }),
  [{ path: 'nested/target.ts', name: 'target.ts', kind: 'file' }],
)
```

- [ ] **Step 4: Run frontend test to verify it fails**

Run: `npm --prefix apps/desktop-web run test:unit -- file-search-state.test`
Expected: FAIL because file mode still depends on loaded tree entries or helper does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/tests/filesystem_tests.rs apps/desktop-web/tests/file-search-state.test.ts apps/desktop-web/tsconfig.tests.json
git commit -m "test: add filename search regression coverage"
```

### Task 2: Switch file-name mode to backend search

**Files:**
- Create: `apps/desktop-web/src/features/file-explorer/file-search-state.ts`
- Modify: `apps/desktop-web/src/features/file-explorer/FileTreePane.tsx`
- Modify: `apps/desktop-web/src/features/file-explorer/FileSearchModal.tsx`
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`

- [ ] **Step 1: Add minimal shared helper types/logic**

Create a small helper that maps backend file-search matches to modal `FsEntry` items and keeps the file-mode result selection pure/testable.

- [ ] **Step 2: Run frontend test to confirm helper is wired correctly**

Run: `npm --prefix apps/desktop-web run test:unit -- file-search-state.test`
Expected: PASS

- [ ] **Step 3: Replace file-mode local filtering with debounced backend search**

In `FileTreePane.tsx`:
- add `fileMatches` state
- debounce file-mode queries with the existing `SEARCH_DEBOUNCE_MS`
- call `desktopApi.fsSearchFiles(workspaceId, trimmedQuery, 120)`
- clear results when modal closes, workspace changes, mode changes, or query becomes empty
- track request sequence so stale responses are ignored
- only set loading for the active request

- [ ] **Step 4: Preserve performance constraints**

Keep these invariants:
- no per-keystroke scan over `entriesByDirectory`
- no changes to content streaming search path
- no extra re-sorting of full tree data in file mode
- result count stays bounded by backend `maxResults`

- [ ] **Step 5: Run targeted verification**

Run:
- `npm --prefix apps/desktop-web run test:unit -- file-search-state.test`
- `cargo test -p desktop-tauri search_file_matches_finds_by_file_name -- --exact`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-web/src/features/file-explorer/file-search-state.ts apps/desktop-web/src/features/file-explorer/FileTreePane.tsx apps/desktop-web/src/features/file-explorer/FileSearchModal.tsx apps/desktop-web/src/shell/integration/desktop-api.ts apps/desktop-web/tests/file-search-state.test.ts apps/desktop-web/tsconfig.tests.json apps/desktop-tauri/src-tauri/src/commands/tests/filesystem_tests.rs
git commit -m "fix: restore workspace filename search"
```

### Task 3: Verify no regressions in the feature slice

**Files:**
- Modify: `apps/desktop-web/src/features/file-explorer/FileTreePane.tsx`
- Modify: `apps/desktop-web/src/features/file-explorer/file-search-state.ts`

- [ ] **Step 1: Run focused lint/type/test checks**

Run:
- `npm --prefix apps/desktop-web run lint -- src/features/file-explorer/FileTreePane.tsx src/features/file-explorer/FileSearchModal.tsx src/features/file-explorer/file-search-state.ts tests/file-search-state.test.ts`
- `npm --prefix apps/desktop-web run test:unit -- file-search-state.test`
- `cargo test -p desktop-tauri search_file_matches_finds_by_file_name -- --exact`

Expected: PASS

- [ ] **Step 2: Manual verification**

In the desktop app:
- open file search (`Cmd/Ctrl+P`)
- search for a filename in an unexpanded directory
- confirm it appears without expanding the tree first
- type quickly and confirm result list remains responsive
- switch to content mode and confirm existing content search still works

- [ ] **Step 3: If anything fails, fix the minimal root cause and rerun only the affected checks**

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-web/src/features/file-explorer/FileTreePane.tsx apps/desktop-web/src/features/file-explorer/file-search-state.ts
git commit -m "test: verify filename search regression fix"
```
