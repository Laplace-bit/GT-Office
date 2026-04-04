# MCP Local Bundled Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GT Office production builds install the MCP bridge from bundled local resources instead of relying on `npx`, with a Rust fallback that writes supported client config files directly.

**Architecture:** Keep CLI installation behavior unchanged, but move MCP install behavior to a local-bundled model. Add a Rust writer for Claude/Codex/Gemini/Qwen MCP config plus managed instruction files, and let the Tauri command prefer that path before any Node-based installer fallback.

**Tech Stack:** Rust (Tauri commands, `vb-tools`), existing bundled MCP resources, Node tests for script guards, Rust unit tests.

---

### Task 1: Add failing tests for MCP local-bundled config writing

**Files:**
- Modify: `crates/vb-tools/src/agent_installer.rs`

- [ ] **Step 1: Write failing Rust tests**
- [ ] **Step 2: Run targeted cargo test to verify failure**
- [ ] **Step 3: Implement minimal config-writer support in `vb-tools`**
- [ ] **Step 4: Re-run targeted cargo test to verify pass**

### Task 2: Switch desktop MCP installation to Rust fallback first

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/agentic_one.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/local_bridge.rs` if path resolution needs shared helpers

- [ ] **Step 1: Write failing command/helper tests for bundled install selection**
- [ ] **Step 2: Run targeted cargo test to verify failure**
- [ ] **Step 3: Implement local-bundled MCP install flow with Node fallback only for dev escape hatches**
- [ ] **Step 4: Re-run targeted cargo test to verify pass**

### Task 3: Update docs and release-facing copy

**Files:**
- Modify: `README.md`
- Modify: `tools/gto-agent-mcp/README.md`
- Modify: `docs/03_项目开发进度跟踪.md`

- [ ] **Step 1: Update docs to describe bundled-local MCP install behavior**
- [ ] **Step 2: Run focused verification (`cargo test`, `cargo check`, `npm run build:tauri`)**
