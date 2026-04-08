# Open Source Preparation — Phase 1 Design

**Date:** 2026-04-08  
**Scope:** Clean up codebase, remove internal/process artifacts, add standard open source docs, modernize README, clean git branches. Phase 2 (crate rename `vb-*` → `gt-*`) is out of scope.

---

## 1. File Deletions

### Root-level clutter

| File | Reason |
|------|--------|
| `openclaw - 快捷方式.lnk` | Windows shortcut, not a repo artifact |
| `start.bat` | One-line batch file (`npm run dev:tauri`), redundant |
| `split_all_tests.py` | One-time utility script, no longer needed |
| `temp/` | Old build/MCP logs, temporary artifacts |
| `design-system/` | Nearly empty — only a MASTER.md and empty pages/ |

### Chinese internal docs → replaced by English equivalents

| Removed file | Replacement |
|-------------|-------------|
| `docs/01_需求与产品设计.md` | Covered in README.md and CONTRIBUTING.md |
| `docs/02_系统架构与模块目录设计.md` | `docs/ARCHITECTURE.md` (English) |
| `docs/03_项目开发进度跟踪.md` | Delete (82KB tracking file, not for open source) |
| `docs/04_上下文交接文档.md` | Delete (internal handover) |
| `docs/05_高质量功能设计_核心工作流.md` | `docs/WORKFLOWS.md` (English) |
| `docs/06_API与事件契约草案.md` | `docs/API_CONTRACTS.md` (English) |
| `docs/07_依赖选型与精简清单.md` | `docs/DEPENDENCIES.md` (English) |
| `docs/08_原生TUI与结构化协议拦截设计.md` | Delete (niche internal design) |
| `docs/09_响应式样式单位重构方案.md` | Delete (one-time refactor plan) |
| `docs/feishu.md` | Delete (niche Feishu integration, non-core) |
| `docs/EXTERNAL_CHANNEL_RELAY_ARCHITECTURE.md` | Merged into `docs/ARCHITECTURE.md` |
| `docs/终端重构/` | Delete (completed refactor) |
| `docs/superpowers/specs/` | Delete (internal AI planning artifacts) |
| `docs/superpowers/plans/` | Delete (internal AI planning artifacts) |
| `docs/README.md` | Rewrite in English |

### Third-party agent docs

| Removed | Reason |
|---------|--------|
| `cli_agent_docs/` | Claude Code, Codex, Gemini READMEs are not this project's docs |

## 2. New Open Source Documents

### `CONTRIBUTING.md`
- Development setup (prerequisites, install, dev commands)
- Project structure overview
- Code style expectations (Rust: rustfmt + clippy, TS: typecheck)
- PR process (branch naming, commit messages, verification commands)
- Verification checklist (typecheck, cargo check, build:tauri)

### `CODE_OF_CONDUCT.md`
- Contributor Covenant v2.1
- Contact email for enforcement

### `docs/ARCHITECTURE.md`
- Monorepo layout and module responsibilities
- Frontend ↔ backend communication (Tauri commands/events)
- Crate dependency graph summary
- External channel relay architecture (from deleted doc)
- Data flow: workspace → files → terminal → git → agents

### `docs/WORKFLOWS.md`
- Core user workflows: workspace, files, terminal, Git, agents
- Multi-station collaboration flow
- Tool adapter and channel routing

### `docs/API_CONTRACTS.md`
- Tauri command surface overview
- Shared types between frontend/backend
- Event contracts
- Error codes

### `docs/DEPENDENCIES.md`
- Dependency policy and allowlist
- Rust crates and their purposes
- npm packages and their purposes
- Adding new dependencies: process

## 3. .gitignore Enhancement

Add these entries:

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

Remove tracked files that should now be ignored (e.g., `.claude/` if tracked).

## 4. README Modernization

### Add
- Badges: License (Apache 2.0), version, platform support (macOS/Windows/Linux)
- Screenshot/demo GIF placeholder
- Table of contents
- Roadmap section (high-level future plans)
- Link to CONTRIBUTING.md
- Links to English docs (ARCHITECTURE.md, WORKFLOWS.md, etc.)

### Modify
- Remove version-specific "Current release target: v0.1.6" — use badge instead
- Remove "Root package version: 0.1.6" from Release section — use badge
- Update Documentation Map to point to English docs
- Keep README_CN.md and update it to match

## 5. Branch Cleanup

Delete stale remote branches:
- `origin/fix/git-untracked-new-file-diff`
- `origin/terminal-refactoring-phase1`
- `origin/worktree-gt-office-cli`

## 6. Deprecated Code Fix

- Remove `@deprecated quickCommandVisibility` field in `apps/desktop-web/src/shell/state/ui-preferences.ts` and all references to it

## 7. Items NOT Changed (Phase 1)

- `CLAUDE.md`, `GEMINI.md`, `AGENTS.md` — AI dev tooling, kept as-is
- `.claude/`, `.codex/`, `.gemini/`, `.superpowers/` — added to .gitignore but not deleted from disk
- `tools/gto/`, `tools/gto-agent-mcp/`, `tools/gto-agent-mcp-sidecar/` — active infrastructure
- `docs/release-process.md`, `docs/releases/` — useful release docs
- `CHANGELOG.md` — kept as-is
- `LICENSE` — Apache 2.0, no change
- `README_CN.md` — kept, updated to match English README
- Crate rename (`vb-*` → `gt-*`) — Phase 2, separate effort

## 8. Verification

After all changes:
1. `npm run typecheck` passes
2. `cargo check --workspace` passes
3. `npm run build:web` passes
4. No broken links in README or docs
5. No sensitive files in `git ls-files`
6. `.gitignore` covers all local-only directories