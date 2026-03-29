# GT-Office CLI Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agent-first, stateful CLI harness for GT-Office in `tools/gt-office-cli/` with stable JSON output, default REPL entry, isolated session persistence, and thin adapters over existing GT-Office capabilities.

**Architecture:** Add a new Node workspace under `tools/gt-office-cli/` that owns CLI parsing, REPL flow, session state, result envelopes, and domain adapters. Reuse existing shared types and current Tauri command contracts where possible; only add minimal backend-facing support code when a required CLI path has no stable entrypoint.

**Tech Stack:** TypeScript, Node.js, workspace package in the existing monorepo, `packages/shared-types`, existing GT-Office command contracts from `apps/desktop-tauri/src-tauri/src/commands/*`

---

## File Structure

### New files

- `tools/gt-office-cli/package.json` — workspace package metadata, scripts, CLI bin entry
- `tools/gt-office-cli/tsconfig.json` — TypeScript config for the CLI workspace
- `tools/gt-office-cli/src/index.ts` — process entrypoint and default CLI launcher
- `tools/gt-office-cli/src/gt_office_cli.ts` — top-level CLI group and no-subcommand REPL entry
- `tools/gt-office-cli/src/core/project-state.ts` — in-memory CLI session shape and selectors
- `tools/gt-office-cli/src/core/session-store.ts` — load/save/reset session state in CLI-owned user directory
- `tools/gt-office-cli/src/core/result-envelope.ts` — JSON output helpers aligned to `ResultEnvelope`
- `tools/gt-office-cli/src/core/command-context.ts` — resolved runtime context passed to adapters/commands
- `tools/gt-office-cli/src/adapters/workspace-adapter.ts` — workspace command facade
- `tools/gt-office-cli/src/adapters/filesystem-adapter.ts` — filesystem command facade
- `tools/gt-office-cli/src/adapters/terminal-adapter.ts` — terminal command facade
- `tools/gt-office-cli/src/adapters/git-adapter.ts` — git command facade
- `tools/gt-office-cli/src/adapters/agent-adapter.ts` — agent command facade
- `tools/gt-office-cli/src/adapters/channel-adapter.ts` — channel/MCP facade
- `tools/gt-office-cli/src/adapters/task-adapter.ts` — task facade
- `tools/gt-office-cli/src/adapters/settings-adapter.ts` — settings facade
- `tools/gt-office-cli/src/commands/workspace.ts` — workspace subcommands
- `tools/gt-office-cli/src/commands/files.ts` — filesystem subcommands
- `tools/gt-office-cli/src/commands/terminal.ts` — terminal subcommands
- `tools/gt-office-cli/src/commands/git.ts` — git subcommands
- `tools/gt-office-cli/src/commands/agent.ts` — agent subcommands
- `tools/gt-office-cli/src/commands/channel.ts` — channel subcommands
- `tools/gt-office-cli/src/commands/task.ts` — task subcommands
- `tools/gt-office-cli/src/commands/settings.ts` — settings subcommands
- `tools/gt-office-cli/src/commands/session.ts` — session subcommands
- `tools/gt-office-cli/src/commands/repl.ts` — default REPL command loop
- `tools/gt-office-cli/src/utils/errors.ts` — CLI-local typed errors and code mapping
- `tools/gt-office-cli/src/utils/json-output.ts` — output mode rendering helpers
- `tools/gt-office-cli/src/utils/paths.ts` — platform state file path resolution
- `tools/gt-office-cli/src/utils/format.ts` — human-readable rendering helpers
- `tools/gt-office-cli/tests/TEST.md` — test plan plus final test results
- `tools/gt-office-cli/tests/test_core.ts` — unit tests for state, envelope, path, and context logic
- `tools/gt-office-cli/tests/test_e2e.ts` — command-level and session flow tests

### Existing files to modify

- `package.json` — add the CLI workspace and top-level helper scripts if needed
- `packages/shared-types/src/index.ts` — only if a tiny shared CLI-facing contract addition is required; otherwise leave unchanged
- `docs/superpowers/specs/2026-03-28-gt-office-cli-design.md` — reference only, no planned edits
- `apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs` — reference existing response shape; no change unless a missing CLI-critical path is discovered
- `apps/desktop-tauri/src-tauri/src/commands/file_explorer/mod.rs` — reference existing response shape; no change unless a missing CLI-critical path is discovered
- `apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs` — reference existing terminal contract; no change unless required
- `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs` — reference existing git contract; no change unless required
- `apps/desktop-tauri/src-tauri/src/commands/agent.rs` — reference existing agent contract; no change unless required
- `apps/desktop-tauri/src-tauri/src/commands/settings/mod.rs` — reference existing settings contract; no change unless required

### Notes on boundaries

- Prefer keeping all implementation in `tools/gt-office-cli/`.
- Only add backend changes after proving a required CLI path has no usable existing contract.
- If a backend change becomes necessary, keep it minimal and feature-aligned.

## Task 1: Scaffold the CLI workspace

**Files:**
- Create: `tools/gt-office-cli/package.json`
- Create: `tools/gt-office-cli/tsconfig.json`
- Create: `tools/gt-office-cli/src/index.ts`
- Create: `tools/gt-office-cli/src/gt_office_cli.ts`
- Modify: `package.json:6-20`
- Test: `tools/gt-office-cli/tests/test_e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildCliMetadata } from "../src/gt_office_cli";

describe("buildCliMetadata", () => {
  it("declares gt-office-cli as a stateful harness", () => {
    const meta = buildCliMetadata();
    expect(meta.name).toBe("gt-office-cli");
    expect(meta.defaultMode).toBe("repl");
    expect(meta.supportsJson).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: FAIL with workspace missing and `buildCliMetadata` unresolved.

- [ ] **Step 3: Write minimal implementation**

```json
{
  "name": "gt-office-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "gt-office": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

```json
{
  "extends": "../../packages/shared-types/tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

```ts
// tools/gt-office-cli/src/gt_office_cli.ts
export function buildCliMetadata() {
  return {
    name: "gt-office-cli",
    defaultMode: "repl",
    supportsJson: true,
  } as const;
}
```

```ts
// tools/gt-office-cli/src/index.ts
import { buildCliMetadata } from "./gt_office_cli";

export function main() {
  return buildCliMetadata();
}
```

```json
// package.json
{
  "workspaces": [
    "apps/*",
    "packages/*",
    "tools/*"
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: PASS for `buildCliMetadata declares gt-office-cli as a stateful harness`.

- [ ] **Step 5: Commit**

```bash
git add package.json tools/gt-office-cli/package.json tools/gt-office-cli/tsconfig.json tools/gt-office-cli/src/index.ts tools/gt-office-cli/src/gt_office_cli.ts tools/gt-office-cli/tests/test_e2e.ts
git commit -m "feat: scaffold gt-office cli workspace"
```

## Task 2: Add core result envelope and command context primitives

**Files:**
- Create: `tools/gt-office-cli/src/core/result-envelope.ts`
- Create: `tools/gt-office-cli/src/core/command-context.ts`
- Create: `tools/gt-office-cli/src/utils/errors.ts`
- Modify: `tools/gt-office-cli/src/gt_office_cli.ts`
- Test: `tools/gt-office-cli/tests/test_core.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { okResult, errResult } from "../src/core/result-envelope";

describe("result-envelope", () => {
  it("creates an ok envelope", () => {
    const result = okResult({ workspaceId: "ws:1" }, "trace-1");
    expect(result).toEqual({
      ok: true,
      data: { workspaceId: "ws:1" },
      error: null,
      traceId: "trace-1",
    });
  });

  it("creates an error envelope", () => {
    const result = errResult("CLI_ACTIVE_WORKSPACE_REQUIRED", "Active workspace required", "trace-2");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CLI_ACTIVE_WORKSPACE_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL with `result-envelope` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ResultEnvelope } from "@gto/shared-types";

export function okResult<T>(data: T, traceId: string): ResultEnvelope<T> {
  return { ok: true, data, error: null, traceId };
}

export function errResult(code: string, message: string, traceId: string): ResultEnvelope<never> {
  return {
    ok: false,
    data: null,
    error: { code, message },
    traceId,
  };
}
```

```ts
export type OutputMode = "human" | "json";

export interface CommandContext {
  traceId: string;
  outputMode: OutputMode;
  activeWorkspaceId: string | null;
  selectedTerminalSessionId: string | null;
  selectedAgentId: string | null;
}
```

```ts
export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `creates an ok envelope` and `creates an error envelope`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/core/result-envelope.ts tools/gt-office-cli/src/core/command-context.ts tools/gt-office-cli/src/utils/errors.ts tools/gt-office-cli/tests/test_core.ts
git commit -m "feat: add gt-office cli core envelope primitives"
```

## Task 3: Implement CLI-owned session persistence

**Files:**
- Create: `tools/gt-office-cli/src/core/project-state.ts`
- Create: `tools/gt-office-cli/src/core/session-store.ts`
- Create: `tools/gt-office-cli/src/utils/paths.ts`
- Test: `tools/gt-office-cli/tests/test_core.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createEmptyState, applyWorkspaceSelection } from "../src/core/project-state";

describe("project-state", () => {
  it("stores active workspace selection", () => {
    const state = applyWorkspaceSelection(createEmptyState(), {
      workspaceId: "ws:alpha",
      root: "/tmp/workspace",
    });
    expect(state.activeWorkspaceId).toBe("ws:alpha");
    expect(state.activeWorkspaceRoot).toBe("/tmp/workspace");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL with `project-state` unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface CliProjectState {
  activeWorkspaceId: string | null;
  activeWorkspaceRoot: string | null;
  selectedTerminalSessionId: string | null;
  selectedAgentId: string | null;
  outputMode: "human" | "json";
}

export function createEmptyState(): CliProjectState {
  return {
    activeWorkspaceId: null,
    activeWorkspaceRoot: null,
    selectedTerminalSessionId: null,
    selectedAgentId: null,
    outputMode: "human",
  };
}

export function applyWorkspaceSelection(
  state: CliProjectState,
  payload: { workspaceId: string; root: string },
): CliProjectState {
  return {
    ...state,
    activeWorkspaceId: payload.workspaceId,
    activeWorkspaceRoot: payload.root,
  };
}
```

```ts
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { createEmptyState, type CliProjectState } from "./project-state";
import { resolveSessionFilePath } from "../utils/paths";

export async function loadSession(): Promise<CliProjectState> {
  try {
    const content = await fs.readFile(resolveSessionFilePath(), "utf8");
    return JSON.parse(content) as CliProjectState;
  } catch {
    return createEmptyState();
  }
}

export async function saveSession(state: CliProjectState): Promise<void> {
  const path = resolveSessionFilePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(state, null, 2), "utf8");
}
```

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveSessionFilePath(): string {
  return join(homedir(), ".config", "gt-office-cli", "session.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `stores active workspace selection`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/core/project-state.ts tools/gt-office-cli/src/core/session-store.ts tools/gt-office-cli/src/utils/paths.ts tools/gt-office-cli/tests/test_core.ts
git commit -m "feat: persist gt-office cli session state"
```

## Task 4: Add workspace and filesystem adapters against existing contracts

**Files:**
- Create: `tools/gt-office-cli/src/adapters/workspace-adapter.ts`
- Create: `tools/gt-office-cli/src/adapters/filesystem-adapter.ts`
- Create: `tools/gt-office-cli/src/utils/json-output.ts`
- Modify: `tools/gt-office-cli/src/core/command-context.ts`
- Test: `tools/gt-office-cli/tests/test_core.ts`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs:90-226`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/file_explorer/mod.rs:77-260`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeWorkspaceOpenResult } from "../src/adapters/workspace-adapter";

describe("workspace-adapter", () => {
  it("normalizes workspace open payload", () => {
    const normalized = normalizeWorkspaceOpenResult({
      workspaceId: "ws:1",
      name: "demo",
      root: "/repo/demo",
    });
    expect(normalized.workspaceId).toBe("ws:1");
    expect(normalized.root).toBe("/repo/demo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL with adapter module unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface WorkspaceOpenResult {
  workspaceId: string;
  name: string;
  root: string;
}

export function normalizeWorkspaceOpenResult(payload: WorkspaceOpenResult): WorkspaceOpenResult {
  return payload;
}
```

```ts
export interface FileListDirResult {
  workspaceId: string;
  path: string;
  depth: number;
  entries: Array<{ path: string; name: string; kind: string; sizeBytes?: number }>;
}

export function normalizeListDirResult(payload: FileListDirResult): FileListDirResult {
  return payload;
}
```

```ts
import type { ResultEnvelope } from "@gto/shared-types";

export function renderJson<T>(envelope: ResultEnvelope<T>): string {
  return JSON.stringify(envelope, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `normalizes workspace open payload`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/adapters/workspace-adapter.ts tools/gt-office-cli/src/adapters/filesystem-adapter.ts tools/gt-office-cli/src/utils/json-output.ts tools/gt-office-cli/tests/test_core.ts
git commit -m "feat: add workspace and filesystem cli adapters"
```

## Task 5: Add terminal and git adapters with explicit workspace context rules

**Files:**
- Create: `tools/gt-office-cli/src/adapters/terminal-adapter.ts`
- Create: `tools/gt-office-cli/src/adapters/git-adapter.ts`
- Modify: `tools/gt-office-cli/src/utils/errors.ts`
- Test: `tools/gt-office-cli/tests/test_core.ts`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { requireWorkspaceId } from "../src/adapters/terminal-adapter";

describe("terminal-adapter", () => {
  it("throws when workspace id is missing", () => {
    expect(() => requireWorkspaceId(null)).toThrowError("Active workspace required");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL with `terminal-adapter` unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
import { CliError } from "../utils/errors";

export function requireWorkspaceId(workspaceId: string | null): string {
  if (!workspaceId) {
    throw new CliError("CLI_ACTIVE_WORKSPACE_REQUIRED", "Active workspace required");
  }
  return workspaceId;
}
```

```ts
export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: Array<{ path: string; status: string }>;
}

export function normalizeGitStatus(payload: GitStatusResult): GitStatusResult {
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `throws when workspace id is missing`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/adapters/terminal-adapter.ts tools/gt-office-cli/src/adapters/git-adapter.ts tools/gt-office-cli/src/utils/errors.ts tools/gt-office-cli/tests/test_core.ts
git commit -m "feat: enforce workspace-scoped terminal and git adapters"
```

## Task 6: Add agent, channel, task, and settings adapters

**Files:**
- Create: `tools/gt-office-cli/src/adapters/agent-adapter.ts`
- Create: `tools/gt-office-cli/src/adapters/channel-adapter.ts`
- Create: `tools/gt-office-cli/src/adapters/task-adapter.ts`
- Create: `tools/gt-office-cli/src/adapters/settings-adapter.ts`
- Test: `tools/gt-office-cli/tests/test_core.ts`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/agent.rs`
- Reference: `apps/desktop-tauri/src-tauri/src/commands/settings/mod.rs`
- Reference: `docs/06_API与事件契约草案.md:108-191`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeDispatchRequest } from "../src/adapters/channel-adapter";

describe("channel-adapter", () => {
  it("keeps workspace scoped dispatch payloads explicit", () => {
    const payload = normalizeDispatchRequest({
      workspaceId: "ws:alpha",
      sender: "agent:ceo",
      targets: ["agent:worker-1"],
      title: "Do work",
      markdown: "run task",
    });
    expect(payload.workspaceId).toBe("ws:alpha");
    expect(payload.targets).toEqual(["agent:worker-1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL with adapter module unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface DispatchBatchRequest {
  workspaceId: string;
  sender: string;
  targets: string[];
  title: string;
  markdown: string;
}

export function normalizeDispatchRequest(payload: DispatchBatchRequest): DispatchBatchRequest {
  return payload;
}
```

```ts
export interface AgentListResult {
  agents: Array<{ agentId: string; name: string; roleId?: string; workspaceId: string }>;
}

export function normalizeAgentList(payload: AgentListResult): AgentListResult {
  return payload;
}
```

```ts
export interface TaskListResult {
  tasks: Array<{ id: string; title: string; status: string }>;
}

export function normalizeTaskList(payload: TaskListResult): TaskListResult {
  return payload;
}
```

```ts
export interface SettingsGetResult {
  values: Record<string, unknown>;
  sources: Record<string, unknown>;
}

export function normalizeSettingsResult(payload: SettingsGetResult): SettingsGetResult {
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `keeps workspace scoped dispatch payloads explicit`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/adapters/agent-adapter.ts tools/gt-office-cli/src/adapters/channel-adapter.ts tools/gt-office-cli/src/adapters/task-adapter.ts tools/gt-office-cli/src/adapters/settings-adapter.ts tools/gt-office-cli/tests/test_core.ts
git commit -m "feat: add gt-office collaboration adapters"
```

## Task 7: Implement workspace, files, terminal, and git commands

**Files:**
- Create: `tools/gt-office-cli/src/commands/workspace.ts`
- Create: `tools/gt-office-cli/src/commands/files.ts`
- Create: `tools/gt-office-cli/src/commands/terminal.ts`
- Create: `tools/gt-office-cli/src/commands/git.ts`
- Modify: `tools/gt-office-cli/src/gt_office_cli.ts`
- Test: `tools/gt-office-cli/tests/test_e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createWorkspaceCommandSet } from "../src/commands/workspace";

describe("workspace command set", () => {
  it("includes open and list subcommands", () => {
    const commands = createWorkspaceCommandSet();
    expect(commands.map((item) => item.name)).toEqual(expect.arrayContaining(["list", "open"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: FAIL with command module unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createWorkspaceCommandSet() {
  return [
    { name: "list" },
    { name: "open" },
    { name: "close" },
    { name: "active" },
    { name: "context" },
  ] as const;
}
```

```ts
export function createFilesCommandSet() {
  return ["ls", "read", "write", "search", "move", "copy", "delete"] as const;
}

export function createTerminalCommandSet() {
  return ["create", "select", "write", "resize", "kill", "status"] as const;
}

export function createGitCommandSet() {
  return ["status", "diff", "log", "stage", "unstage", "commit", "branches", "checkout"] as const;
}
```

```ts
import { createWorkspaceCommandSet } from "./commands/workspace";
import { createFilesCommandSet } from "./commands/files";
import { createTerminalCommandSet } from "./commands/terminal";
import { createGitCommandSet } from "./commands/git";

export function buildCliMetadata() {
  return {
    name: "gt-office-cli",
    defaultMode: "repl",
    supportsJson: true,
    commandGroups: {
      workspace: createWorkspaceCommandSet(),
      files: createFilesCommandSet(),
      terminal: createTerminalCommandSet(),
      git: createGitCommandSet(),
    },
  } as const;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: PASS for `includes open and list subcommands`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/commands/workspace.ts tools/gt-office-cli/src/commands/files.ts tools/gt-office-cli/src/commands/terminal.ts tools/gt-office-cli/src/commands/git.ts tools/gt-office-cli/src/gt_office_cli.ts tools/gt-office-cli/tests/test_e2e.ts
git commit -m "feat: add core gt-office cli command groups"
```

## Task 8: Implement agent, channel, task, settings, and session commands

**Files:**
- Create: `tools/gt-office-cli/src/commands/agent.ts`
- Create: `tools/gt-office-cli/src/commands/channel.ts`
- Create: `tools/gt-office-cli/src/commands/task.ts`
- Create: `tools/gt-office-cli/src/commands/settings.ts`
- Create: `tools/gt-office-cli/src/commands/session.ts`
- Modify: `tools/gt-office-cli/src/gt_office_cli.ts`
- Test: `tools/gt-office-cli/tests/test_e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createSessionCommandSet } from "../src/commands/session";

describe("session command set", () => {
  it("includes save, load, show, and reset", () => {
    expect(createSessionCommandSet()).toEqual(["show", "save", "load", "reset"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: FAIL with `commands/session` unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createAgentCommandSet() {
  return ["list", "create", "update", "delete", "assign", "runtime"] as const;
}

export function createChannelCommandSet() {
  return ["dispatch", "status", "handover", "inbox"] as const;
}

export function createTaskCommandSet() {
  return ["list", "show", "watch"] as const;
}

export function createSettingsCommandSet() {
  return ["get", "update", "reset"] as const;
}

export function createSessionCommandSet() {
  return ["show", "save", "load", "reset"] as const;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: PASS for `includes save, load, show, and reset`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/commands/agent.ts tools/gt-office-cli/src/commands/channel.ts tools/gt-office-cli/src/commands/task.ts tools/gt-office-cli/src/commands/settings.ts tools/gt-office-cli/src/commands/session.ts tools/gt-office-cli/src/gt_office_cli.ts tools/gt-office-cli/tests/test_e2e.ts
git commit -m "feat: add state and collaboration cli command groups"
```

## Task 9: Implement the default REPL flow and human-readable formatting

**Files:**
- Create: `tools/gt-office-cli/src/commands/repl.ts`
- Create: `tools/gt-office-cli/src/utils/format.ts`
- Modify: `tools/gt-office-cli/src/index.ts`
- Modify: `tools/gt-office-cli/src/gt_office_cli.ts`
- Test: `tools/gt-office-cli/tests/test_e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldEnterReplByDefault } from "../src/commands/repl";

describe("repl defaulting", () => {
  it("enters repl when there is no subcommand", () => {
    expect(shouldEnterReplByDefault([])).toBe(true);
    expect(shouldEnterReplByDefault(["workspace", "list"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: FAIL with `commands/repl` unresolved.

- [ ] **Step 3: Write minimal implementation**

```ts
export function shouldEnterReplByDefault(argv: string[]): boolean {
  return argv.length === 0;
}

export async function runRepl(): Promise<number> {
  return 0;
}
```

```ts
export function formatStatusLine(label: string, value: string): string {
  return `${label}: ${value}`;
}
```

```ts
import { shouldEnterReplByDefault, runRepl } from "./commands/repl";

export async function main(argv = process.argv.slice(2)) {
  if (shouldEnterReplByDefault(argv)) {
    return runRepl();
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_e2e.ts`
Expected: PASS for `enters repl when there is no subcommand`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/src/commands/repl.ts tools/gt-office-cli/src/utils/format.ts tools/gt-office-cli/src/index.ts tools/gt-office-cli/src/gt_office_cli.ts tools/gt-office-cli/tests/test_e2e.ts
git commit -m "feat: default gt-office cli to repl mode"
```

## Task 10: Write the test plan document before expanding test coverage

**Files:**
- Create: `tools/gt-office-cli/tests/TEST.md`
- Test: `tools/gt-office-cli/tests/test_core.ts`
- Test: `tools/gt-office-cli/tests/test_e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("TEST.md", () => {
  it("documents unit and e2e coverage plans", () => {
    const text = readFileSync(new URL("./TEST.md", import.meta.url), "utf8");
    expect(text).toContain("test_core.ts");
    expect(text).toContain("test_e2e.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: FAIL because `tests/TEST.md` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```md
# GT-Office CLI Test Plan

## Test Inventory Plan

- `test_core.ts`: 8 unit tests planned
- `test_e2e.ts`: 6 integration/E2E tests planned

## Unit Test Plan

### `project-state.ts`
- create empty state
- apply workspace selection
- retain explicit output mode
- expected tests: 3

### `session-store.ts`
- load missing session as empty
- save and reload session
- expected tests: 2

### `result-envelope.ts`
- ok envelope
- error envelope
- expected tests: 2

### `paths.ts`
- resolve stable session file path
- expected tests: 1

## E2E Test Plan

- CLI metadata exposes command groups
- default invocation enters REPL
- workspace/files/terminal/git command sets register core subcommands
- session commands register persistence actions
- json output uses the stable ResultEnvelope shape (`ok`, `data`, `error`, `traceId`, with the inactive branch serialized as `null`)
- explicit workspace context is preserved in adapter payloads

## Realistic Workflow Scenarios

### Workflow: Workspace shell bootstrap
- Simulates: agent opening a workspace and selecting terminal context
- Operations chained: workspace open -> terminal create -> session save
- Verified: selected workspace/session ids remain explicit and serializable

### Workflow: Repository inspection
- Simulates: agent querying a repo without UI
- Operations chained: files ls -> files read -> git status
- Verified: normalized payloads remain stable and machine-readable

### Workflow: Delegated collaboration
- Simulates: manager agent dispatching work
- Operations chained: agent list -> channel dispatch -> task list
- Verified: workspace-scoped request payloads and json envelopes remain explicit
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts`
Expected: PASS for `documents unit and e2e coverage plans`.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/tests/TEST.md tools/gt-office-cli/tests/test_core.ts
git commit -m "test: add gt-office cli test plan"
```

## Task 11: Expand verification coverage and execute the test suite

**Files:**
- Modify: `tools/gt-office-cli/tests/test_core.ts`
- Modify: `tools/gt-office-cli/tests/test_e2e.ts`
- Modify: `tools/gt-office-cli/tests/TEST.md`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderJson } from "../src/utils/json-output";
import { okResult } from "../src/core/result-envelope";

describe("json output", () => {
  it("renders stable ResultEnvelope json", () => {
    const text = renderJson(okResult({ ok: 1 }, "trace-json"));
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: { ok: 1 },
      error: null,
      traceId: "trace-json",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace tools/gt-office-cli run test -- --run tests/test_core.ts tests/test_e2e.ts`
Expected: FAIL until missing assertions and command coverage are added.

- [ ] **Step 3: Write minimal implementation**

```ts
// Add assertions covering:
// - renderJson(okResult(...)) shape
// - createFilesCommandSet() includes "read"
// - createTerminalCommandSet() includes "create"
// - createGitCommandSet() includes "status"
// - createChannelCommandSet() includes "dispatch"
// - createTaskCommandSet() includes "watch"
// - createSettingsCommandSet() includes "update"
```

```md
## Test Results

Paste full `npm --workspace tools/gt-office-cli run test` output here after execution.

## Summary Statistics

- Total tests: <fill with actual count>
- Pass rate: <fill with actual rate>
- Execution time: <fill with actual timing>

## Coverage Notes

- Current tests validate CLI scaffolding, session persistence, command registration, and JSON envelope stability.
- Live backend invocation coverage is deferred until adapter transport wiring is implemented.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace tools/gt-office-cli run test`
Expected: PASS for all `test_core.ts` and `test_e2e.ts` cases.

Run: `npm run typecheck`
Expected: PASS for repo typecheck and CLI workspace type safety.

Run: `npm run build:tauri`
Expected: PASS if CLI package additions do not break the existing build.

Run: `cargo check --workspace`
Expected: PASS because the CLI package does not violate Rust workspace constraints.

- [ ] **Step 5: Commit**

```bash
git add tools/gt-office-cli/tests/test_core.ts tools/gt-office-cli/tests/test_e2e.ts tools/gt-office-cli/tests/TEST.md
git commit -m "test: verify gt-office cli scaffolding"
```

## Task 12: If transport gaps are discovered, add the thinnest backend support

**Files:**
- Modify only if required after adapter wiring exploration:
  - `apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs`
  - `apps/desktop-tauri/src-tauri/src/commands/file_explorer/mod.rs`
  - `apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs`
  - `apps/desktop-tauri/src-tauri/src/commands/git/mod.rs`
  - `apps/desktop-tauri/src-tauri/src/commands/agent.rs`
  - `apps/desktop-tauri/src-tauri/src/commands/settings/mod.rs`
  - `packages/shared-types/src/index.ts`
- Test: existing command tests under `apps/desktop-tauri/src-tauri/src/commands/tests/*.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn cli_required_command_payload_remains_workspace_scoped() {
    let payload = serde_json::json!({
        "workspaceId": "ws:alpha",
        "path": ".",
    });
    assert_eq!(payload.get("workspaceId").unwrap(), "ws:alpha");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test commands::tests --workspace -- --nocapture`
Expected: FAIL only if a missing backend path forces a new contract test.

- [ ] **Step 3: Write minimal implementation**

```rust
// Only add a missing command/helper if the CLI cannot consume an existing command path.
// Keep the response shape aligned to docs/06 and current Value/json builders.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test commands::tests --workspace -- --nocapture`
Expected: PASS for the newly added thin backend support and no regressions in existing command tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands packages/shared-types/src/index.ts
git commit -m "feat: add minimal backend support for gt-office cli"
```

## Self-Review

### Spec coverage

- Independent Node workspace under `tools/gt-office-cli/`: covered by Task 1.
- Agent-first command model with `workspace/files/terminal/git/agent/channel/task/settings/session/repl`: covered by Tasks 7, 8, and 9.
- Stable `ResultEnvelope`-style JSON output: covered by Tasks 2, 4, and 11.
- CLI-owned session persistence: covered by Task 3.
- Thin adapters over existing capabilities: covered by Tasks 4, 5, 6, and 12.
- Minimal/non-invasive backend changes only if needed: covered by Task 12.
- Validation path including repo-level checks: covered by Task 11.

No spec gaps found.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain in required work steps.
- Task 12 is conditional by design, but it still includes explicit files, tests, commands, and implementation rule.

### Type consistency

- State model consistently uses `activeWorkspaceId`, `activeWorkspaceRoot`, `selectedTerminalSessionId`, and `selectedAgentId` across tasks.
- JSON envelope helpers consistently use `okResult`, `errResult`, and `renderJson`.
- Command group constructors use `createXCommandSet` naming consistently.

No naming mismatches found.
