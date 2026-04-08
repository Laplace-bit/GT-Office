# Open Source Preparation Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the GT Office codebase for open source release — remove internal artifacts, add standard OSS docs, modernize README, clean git branches.

**Architecture:** Deletion-first cleanup, then new doc creation, then README modernization. Each task produces a self-contained commit. The deprecated `showCommandRail` field is the only code change.

**Tech Stack:** Markdown, Git, shell commands

---

### Task 1: Delete root-level clutter

**Files:**
- Delete: `start.bat`
- Delete: `split_all_tests.py`
- Delete: `temp/` (entire directory)
- Delete: `design-system/` (entire directory)

- [ ] **Step 1: Delete the files**

```bash
git rm start.bat split_all_tests.py
git rm -r temp/ design-system/
```

- [ ] **Step 2: Verify deletions**

```bash
ls start.bat split_all_tests.py temp/ design-system/ 2>&1
```

Expected: "No such file or directory" for each

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove root-level clutter (start.bat, split_all_tests.py, temp/, design-system/)"
```

---

### Task 2: Delete Chinese internal docs

**Files:**
- Delete: `docs/01_需求与产品设计.md`
- Delete: `docs/02_系统架构与模块目录设计.md`
- Delete: `docs/03_项目开发进度跟踪.md`
- Delete: `docs/04_上下文交接文档.md`
- Delete: `docs/05_高质量功能设计_核心工作流.md`
- Delete: `docs/06_API与事件契约草案.md`
- Delete: `docs/07_依赖选型与精简清单.md`
- Delete: `docs/08_原生TUI与结构化协议拦截设计.md`
- Delete: `docs/09_响应式样式单位重构方案.md`
- Delete: `docs/feishu.md`
- Delete: `docs/EXTERNAL_CHANNEL_RELAY_ARCHITECTURE.md`
- Delete: `docs/终端重构/` (entire directory)
- Delete: `cli_agent_docs/` (entire directory)

- [ ] **Step 1: Delete all Chinese docs and cli_agent_docs**

```bash
git rm docs/01_需求与产品设计.md docs/02_系统架构与模块目录设计.md docs/03_项目开发进度跟踪.md docs/04_上下文交接文档.md docs/05_高质量功能设计_核心工作流.md docs/06_API与事件契约草案.md docs/07_依赖选型与精简清单.md docs/08_原生TUI与结构化协议拦截设计.md docs/09_响应式样式单位重构方案.md docs/feishu.md docs/EXTERNAL_CHANNEL_RELAY_ARCHITECTURE.md
git rm -r "docs/终端重构/" cli_agent_docs/
```

- [ ] **Step 2: Verify deletions**

```bash
ls docs/01_*.md docs/feishu.md cli_agent_docs/ 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Chinese internal docs and cli_agent_docs"
```

---

### Task 3: Delete superpowers specs and plans

**Files:**
- Delete: `docs/superpowers/specs/` (entire directory)
- Delete: `docs/superpowers/plans/` (entire directory)

- [ ] **Step 1: Delete superpowers artifacts**

```bash
git rm -r docs/superpowers/specs/ docs/superpowers/plans/
```

- [ ] **Step 2: Verify the directory still exists (but is empty or near-empty)**

```bash
ls docs/superpowers/
```

Expected: no output or only remaining files

- [ ] **Step 3: If directory is empty, remove it**

```bash
rmdir docs/superpowers/ 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove internal superpowers specs and plans"
```

---

### Task 4: Remove tracked AI agent directories from git

65 tracked files exist under `.claude/`, `.codex/`, `.gemini/`, `.superpowers/`. These should be in `.gitignore` instead.

**Files:**
- Remove from git index: `.claude/`, `.codex/`, `.gemini/`, `.superpowers/`

- [ ] **Step 1: Remove from git index (keep on disk)**

```bash
git rm -r --cached .claude/ .codex/ .gemini/ .superpowers/
```

- [ ] **Step 2: Verify files still exist on disk**

```bash
ls -d .claude/ .codex/ .gemini/ .superpowers/
```

Expected: all four directories listed

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove AI agent config dirs from git tracking"
```

---

### Task 5: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add new entries to .gitignore**

Append after the existing `# Local data` section:

```
# AI agent local state
.claude/
.codex/
.gemini/
.superpowers/

# Temp/build artifacts
temp/
*.lnk
```

- [ ] **Step 2: Verify .gitignore covers the right patterns**

```bash
git status
```

Expected: `.claude/`, `.codex/`, `.gemini/`, `.superpowers/` do NOT appear as untracked

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add AI agent dirs and temp artifacts to .gitignore"
```

---

### Task 6: Rewrite docs/README.md in English

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: Replace docs/README.md with English content**

```markdown
# GT Office Documentation

Technical documentation for the GT Office project.

## Architecture

- [ARCHITECTURE.md](ARCHITECTURE.md) — System architecture, monorepo layout, and data flow

## Development

- [WORKFLOWS.md](WORKFLOWS.md) — Core user workflows and multi-station collaboration
- [API_CONTRACTS.md](API_CONTRACTS.md) — Tauri command surface, events, and shared types
- [DEPENDENCIES.md](DEPENDENCIES.md) — Dependency policy and allowlist

## Release

- [release-process.md](release-process.md) — Release workflow, tagging, and artifact publishing
- [releases/](releases/) — Per-version release notes
```

- [ ] **Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: rewrite docs/README.md in English"
```

---

### Task 7: Write docs/ARCHITECTURE.md

**Files:**
- Create: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create ARCHITECTURE.md**

Write an English architecture document covering:

1. **Overview** — GT Office is a cross-platform AI Agent desktop workspace built with Tauri (Rust backend) + React (frontend)
2. **Monorepo layout** — `apps/`, `crates/`, `packages/`, `tools/` with module responsibilities
3. **Layered architecture** — Presentation (WebUI) → Application (Tauri Commands) → Domain (Core Services) → Infrastructure (PTY, filesystem, DB, git)
4. **Crate dependency graph** — List of crates (`vb-*`) and their roles:
   - `vb-core` — shared types and abstractions
   - `vb-workspace` — workspace lifecycle and context
   - `vb-filesystem` — file operations within workspace boundaries
   - `vb-terminal` / `vb-terminal-core` — PTY sessions and terminal emulation
   - `vb-git` — Git status, diff, history, branch operations
   - `vb-task` — task tracking and lifecycle
   - `vb-agent` — agent roles, status, installation
   - `vb-ai-config` — AI provider configuration and credential management
   - `vb-settings` — user preferences and app settings
   - `vb-storage` — SQLite persistence layer
   - `vb-security` — path validation and workspace-bound access control
   - `vb-changefeed` — real-time change notification system
   - `vb-session-log` — terminal session logging
   - `vb-telemetry` — usage metrics and diagnostics
   - `vb-keymap` — keyboard shortcut configuration
   - `vb-tools` — tool adapter and external connector infrastructure
   - `vb-abstractions` — shared traits and utility types
   - `vb-daemon` — sidecar process for heavy operations (search, indexing)
5. **Frontend ↔ Backend communication** — Tauri invoke commands and event system
6. **External channel relay** — Agent processes communicate via Display Channel (PTY → xterm.js) and Data Channel (structured output → Telegram/WeChat/Feishu). Three-layer approach: env vars for TUI suppression, dual-channel output for structured data, MCP protocol for long-term integration.
7. **Local CLI and Bridge** — `gto` CLI discovers the local bridge, dispatches tasks between agents, and handles reply/handover flows

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: add ARCHITECTURE.md (English)"
```

---

### Task 8: Write docs/WORKFLOWS.md

**Files:**
- Create: `docs/WORKFLOWS.md`

- [ ] **Step 1: Create WORKFLOWS.md**

Write an English workflows document covering:

1. **Workspace lifecycle** — Open a directory as a workspace → workspace context (root, permissions, default cwd) → close/restore
2. **File operations** — Browse file tree → open/search/preview/edit → workspace-bound path validation
3. **Terminal sessions** — Create PTY session bound to workspace root → CLI agent launch (Claude Code, Codex, Gemini) → session restore
4. **Git integration** — Status/diff/log/branch/stash → real-time refresh → workspace coordination
5. **Multi-station collaboration** — Workbench roles (manager, product, build, quality-release) → station terminal cards → workspace context sharing
6. **Agent collaboration** — Install CLI agents → `gto` directory snapshot → task dispatch → reply-status/handover → inbox and thread inspection
7. **Tool adapters and channels** — External channel routing (Telegram, WeChat) → data channel for structured output → relay architecture

- [ ] **Step 2: Commit**

```bash
git add docs/WORKFLOWS.md
git commit -m "docs: add WORKFLOWS.md (English)"
```

---

### Task 9: Write docs/API_CONTRACTS.md

**Files:**
- Create: `docs/API_CONTRACTS.md`

- [ ] **Step 1: Create API_CONTRACTS.md**

Write an English API contracts document covering:

1. **Contract principles** — Request-response commands, streaming events, unified `ResultEnvelope`, machine-readable error codes, workspace-scoped commands
2. **Unified response structure** — `{ ok, data, error, traceId }` with error code + message + details
3. **Command surface** — Organized by domain:
   - Workspace: list, open, close, restore_session, switch_active, get_context
   - Filesystem: list_dir, read_file, write_file, delete, move, search
   - Terminal: create, destroy, resize, write, read_output
   - Git: status, diff, log, branch, stash
   - Agent: install, uninstall, list_roles, update_role
   - Settings: get, set, reset
   - AI Config: get_providers, set_provider, get_live_settings
   - Task: create, update, list, cancel
4. **Event contracts** — Workspace events, file change events, terminal output events, git status events
5. **Shared types** — `packages/shared-types` defines contracts between frontend and backend
6. **Error codes** — Security errors (`SECURITY_PATH_DENIED`), bridge errors (`LOCAL_BRIDGE_UNAVAILABLE`, `LOCAL_BRIDGE_AUTH_FAILED`), agent errors (`AGENT_OFFLINE`, `MCP_INVALID_PARAMS`)

- [ ] **Step 2: Commit**

```bash
git add docs/API_CONTRACTS.md
git commit -m "docs: add API_CONTRACTS.md (English)"
```

---

### Task 10: Write docs/DEPENDENCIES.md

**Files:**
- Create: `docs/DEPENDENCIES.md`

- [ ] **Step 1: Create DEPENDENCIES.md**

Write an English dependencies document covering:

1. **Policy** — Only add dependencies required for the current milestone. Dependencies not on the allowlist are not introduced. Unused or off-list dependencies are removed on discovery.
2. **Frontend allowlist (P0)** — React, Vite, TypeScript, xterm, Radix UI, Tailwind CSS, SCSS, @tanstack/react-virtual, Codemirror, motion, lucide-react
3. **Frontend allowlist (P1)** — shiki, diff2html, @gitgraph/react, cmdk, zod, dompurify
4. **Tauri** — @tauri-apps/api, @tauri-apps/cli
5. **Rust crates** — Core: tokio, serde, tauri; Storage: rusqlite; Terminal: portpicker; Git: git2; HTTP: reqwest; Crypto: keyring; Logging: tracing
6. **Adding new dependencies** — Record in this doc with: purpose, alternatives considered, impact scope. Get approval before introducing.

- [ ] **Step 2: Commit**

```bash
git add docs/DEPENDENCIES.md
git commit -m "docs: add DEPENDENCIES.md (English)"
```

---

### Task 11: Write CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

Write a standard contributing guide covering:

1. **Development setup** — Prerequisites (Node.js 20+, npm 10+, Rust stable, platform Tauri deps), `npm install`, `npm run dev:web`, `npm run dev:tauri`
2. **Project structure** — Brief monorepo layout reference (points to `docs/ARCHITECTURE.md` for detail)
3. **Code style** — Rust: rustfmt + clippy, no unwrap() in non-trivial paths, tracing for key flows; TypeScript: strict typecheck, SCSS (no raw CSS), responsive units (no px)
4. **PR process** — Branch naming (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`), conventional commit messages, one feature per PR
5. **Verification checklist** — Before submitting:
   - `npm run typecheck` passes
   - `cargo check --workspace` passes
   - `npm run build:web` passes
   - No new warnings from clippy
6. **Reporting issues** — Use GitHub Issues with clear reproduction steps
7. **License** — By contributing, you agree your code is licensed under Apache 2.0

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md"
```

---

### Task 12: Write CODE_OF_CONDUCT.md

**Files:**
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Create CODE_OF_CONDUCT.md**

Use the Contributor Covenant v2.1 standard text. Replace the enforcement contact with a placeholder that the project maintainer will fill in:

```
Enforcement: opensource@gtoffice.dev
```

- [ ] **Step 2: Commit**

```bash
git add CODE_OF_CONDUCT.md
git commit -m "docs: add CODE_OF_CONDUCT.md (Contributor Covenant v2.1)"
```

---

### Task 13: Modernize README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README.md with badges, TOC, and updated sections**

Key changes:
1. Add badges after title: `[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)` and `[![Version](https://img.shields.io/badge/version-0.1.6-blue.svg)]`
2. Add Table of Contents after badges
3. Remove "Current release target: `v0.1.6`" line
4. Remove "Root package version: `0.1.6`" from Release section
5. Update Documentation Map to point to English docs (ARCHITECTURE.md, WORKFLOWS.md, API_CONTRACTS.md, DEPENDENCIES.md)
6. Add Contributing section linking to CONTRIBUTING.md
7. Add placeholder for screenshot/demo: `<!-- ![GT Office Screenshot](docs/assets/screenshot.png) -->`
8. Add Roadmap section with high-level goals: code-signing and notarization, plugin system, remote workspace support, Phase 2 crate rename

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: modernize README with badges, TOC, and English doc links"
```

---

### Task 14: Update README_CN.md

**Files:**
- Modify: `README_CN.md`

- [ ] **Step 1: Mirror README.md changes in Chinese**

Apply the same structural changes as Task 13:
1. Add badges
2. Add Table of Contents (Chinese)
3. Remove version-specific lines
4. Update Documentation Map to English doc links
5. Add Contributing section (link to CONTRIBUTING.md)
6. Add screenshot placeholder
7. Add Roadmap section (Chinese)

- [ ] **Step 2: Commit**

```bash
git add README_CN.md
git commit -m "docs: update README_CN.md to match English README"
```

---

### Task 15: Fix deprecated showCommandRail code

**Files:**
- Modify: `apps/desktop-web/src/shell/state/ui-preferences.ts`

`showCommandRail` is referenced only in this one file (8 occurrences). It is a deprecated field on `UiPreferences` that is kept in sync with `quickCommandVisibilityByProvider` but serves no independent purpose.

- [ ] **Step 1: Remove `showCommandRail` from the `UiPreferences` interface**

Remove line 48-49:
```typescript
  /** @deprecated Prefer `quickCommandVisibilityByProvider`. */
  showCommandRail: boolean
```

- [ ] **Step 2: Remove `showCommandRail: true` from `defaultUiPreferences` (line 264)**

- [ ] **Step 3: Remove `showCommandRail` from `setQuickCommandRailVisibility` return value (line 542)**

Change:
```typescript
  return {
    ...preferences,
    quickCommandVisibilityByProvider,
    showCommandRail: Object.values(quickCommandVisibilityByProvider).some(Boolean),
  }
```
To:
```typescript
  return {
    ...preferences,
    quickCommandVisibilityByProvider,
  }
```

- [ ] **Step 4: Remove `showCommandRail` from `loadUiPreferences` return value**

In the `loadUiPreferences` function (around line 587-601), remove the `showCommandRail` property from the return object. The `parsed.showCommandRail` used in `normalizeQuickCommandVisibilityByProvider` (line 570) must be preserved as a migration source — it reads the old value from localStorage to derive `quickCommandVisibilityByProvider`. Just remove it from the returned object.

Change the return block to remove `showCommandRail`:
```typescript
    return {
      locale: parsed.locale ?? defaultUiPreferences.locale,
      themeMode: parsed.themeMode ?? defaultUiPreferences.themeMode,
      uiFont: parsed.uiFont ?? defaultUiPreferences.uiFont,
      monoFont: parsed.monoFont ?? defaultUiPreferences.monoFont,
      uiFontSize:
        parsed.uiFontSize === 'small' || parsed.uiFontSize === 'medium' ||
        parsed.uiFontSize === 'large' || parsed.uiFontSize === 'xlarge'
          ? parsed.uiFontSize
          : defaultUiPreferences.uiFontSize,
      showWorkspaceActionsInRail:
        typeof parsed.showWorkspaceActionsInRail === 'boolean'
          ? parsed.showWorkspaceActionsInRail
          : defaultUiPreferences.showWorkspaceActionsInRail,
      quickCommandVisibilityByProvider: normalizedQuickCommandVisibilityByProvider,
      pinnedCommandIdsByProvider: normalizedPinnedCommandIdsByProvider,
      customCommandCapsulesByProvider: normalizedCustomCommandCapsulesByProvider,
      orderedCommandCapsuleIdsByProvider: normalizedOrderedCommandCapsuleIdsByProvider,
    }
```

- [ ] **Step 5: Run typecheck to verify no other code references `showCommandRail`**

```bash
npm run typecheck
```

Expected: PASS (no type errors about missing `showCommandRail`)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-web/src/shell/state/ui-preferences.ts
git commit -m "refactor: remove deprecated showCommandRail field from UiPreferences"
```

---

### Task 16: Clean up stale remote branches

**Files:**
- Remote branches only

- [ ] **Step 1: Check each branch for unmerged commits**

```bash
git log main..origin/fix/git-untracked-new-file-diff --oneline 2>/dev/null
git log main..origin/terminal-refactoring-phase1 --oneline 2>/dev/null
git log main..origin/worktree-gt-office-cli --oneline 2>/dev/null
```

- [ ] **Step 2: If all commits are merged or the branch is abandoned, delete the remote branches**

```bash
git push origin --delete fix/git-untracked-new-file-diff
git push origin --delete terminal-refactoring-phase1
git push origin --delete worktree-gt-office-cli
```

- [ ] **Step 3: Prune remote-tracking references**

```bash
git remote prune origin
```

- [ ] **Step 4: Verify only main remains**

```bash
git branch -r
```

Expected: only `origin/main` and `origin/HEAD`

---

### Task 17: Final verification

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 2: Run Rust check**

```bash
cargo check --workspace
```

Expected: PASS (no errors)

- [ ] **Step 3: Check for sensitive files in git**

```bash
git ls-files | grep -iE '\.env|credentials|\.secret|\.key|\.pem|\.lnk'
```

Expected: no output

- [ ] **Step 4: Verify .gitignore covers local-only dirs**

```bash
git status
```

Expected: `.claude/`, `.codex/`, `.gemini/`, `.superpowers/` do not appear as untracked

- [ ] **Step 5: Verify docs directory is clean**

```bash
ls docs/
```

Expected: only English doc files remain (ARCHITECTURE.md, WORKFLOWS.md, API_CONTRACTS.md, DEPENDENCIES.md, README.md, release-process.md, releases/)

- [ ] **Step 6: Verify no broken doc references in README**

Manually check that each `[link](path)` in README.md and README_CN.md points to an existing file.