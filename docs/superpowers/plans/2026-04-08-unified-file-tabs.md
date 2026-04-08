# Unified File Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify code files and previewable files under the same top tab strip while lazily mounting heavy preview content only for the active tab.

**Architecture:** Keep a single `openedFiles + activeFilePath` document model in the shell file controller. Extend each opened file with a lightweight view type so the main file pane can decide whether to render an editor or a preview surface. Previewable files should keep only metadata and optional tiny UI state in memory; their heavy content should mount on demand when the tab becomes active.

**Tech Stack:** React 19, TypeScript, SCSS, CodeMirror, Tauri desktop API, existing file previewers.

---

### Task 1: Model Unified Open Files

**Files:**
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`
- Modify: `apps/desktop-web/src/shell/layout/useShellFileController.ts`
- Test: `apps/desktop-web/tests/file-type-utils.test.ts`

- [ ] Add lightweight file view metadata to `OpenedFile` so text/editor tabs and preview tabs can share one collection.
- [ ] Stop routing previewable files through `activePreviewPath`; open them in `openedFiles` and activate by `activeFilePath`.
- [ ] Preserve lazy behavior by storing metadata only for preview tabs, not decoded assets.

### Task 2: Unify Main Pane Rendering

**Files:**
- Modify: `apps/desktop-web/src/shell/layout/ShellRootView.tsx`
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`
- Modify: `apps/desktop-web/src/features/file-preview/FilePreviewPane.tsx`

- [ ] Remove the editor/preview top-level branch in `ShellRootView` for the files area.
- [ ] Render one file workbench with shared tabs and a content area that chooses editor vs preview by active tab type.
- [ ] Pass only the active file path/root/size needed to render previews on demand.

### Task 3: Fix Image Switch Loading Race

**Files:**
- Modify: `apps/desktop-web/src/features/file-preview/previewers/ImagePreviewer.tsx`
- Modify: `apps/desktop-web/src/features/file-preview/previewers/ImagePreviewer.scss`

- [ ] Rework image loading state so switching from one image to another cannot get stuck in `loading`.
- [ ] Ensure the previewer fully resets on file change without preserving stale `TransformWrapper` internals.

### Task 4: Keep Markdown/Text Behavior Intact

**Files:**
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.scss`
- Modify: `apps/desktop-web/src/components/editor/MarkdownSplitView.tsx`

- [ ] Preserve draft-backed Markdown preview/split behavior under the unified tab model.
- [ ] Keep preview toolbars and fine scrollbars scoped to the relevant active content.

### Task 5: Verify

**Files:**
- Test: `apps/desktop-web/tests/file-type-utils.test.ts`
- Test: `apps/desktop-web/tests/language-extensions.test.ts`

- [ ] Run `npm run build` in `apps/desktop-web`.
- [ ] Run `npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/file-type-utils.test.js .test-dist/tests/language-extensions.test.js`.
- [ ] Manually reason-check the image-switch path and unified tab open/close flow in the final summary.
