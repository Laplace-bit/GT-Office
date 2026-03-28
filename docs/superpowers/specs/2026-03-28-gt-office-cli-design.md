# GT Office CLI Design

## Summary

Build the first version of `tools/gt-office-cli` on the existing Node/TypeScript path as an agent control-plane CLI for GT Office. Version 1 focuses on agent CRUD, role CRUD, and structured channel message list/read/send. The CLI must support both one-shot subcommands and a default REPL, with `--json` output available on every command.

## Goals

- Continue the existing `tools/gt-office-cli` implementation instead of switching stacks.
- Expose existing GT Office agent-management capabilities through a stable CLI.
- Expose structured channel messaging capabilities for listing inbox/feed messages and sending structured messages.
- Keep workspace-affecting commands explicit by requiring `workspace_id` input.
- Reuse existing backend validation and business rules rather than duplicating them in the CLI.

## Non-goals

Version 1 does not include:

- agent runtime start/stop management
- terminal transcript retrieval
- full task orchestration workflows
- external connector setup for Feishu/Telegram/WeChat
- channel lifecycle CRUD
- a separate REPL-only command language

## Existing Foundations

The current repository already has most business capabilities implemented behind the desktop/Tauri layer:

- Agent and role CRUD exist in Tauri commands and storage/repository code.
- Prompt file read/write already exists as part of agent management.
- Structured channel publish/list-message flows already exist in task-center and MCP bridge code.
- A partial CLI package already exists at `tools/gt-office-cli` with a baseline metadata test.

This means the CLI should act as a command surface over existing GT Office capabilities, not as a new business-logic implementation.

## Architecture

The CLI should remain inside `tools/gt-office-cli` and be organized into four layers:

### 1. Command layer

Responsible for:

- parsing arguments
- validating command-line-only concerns
- selecting JSON vs human-readable output
- invoking core actions

Suggested files:

- `src/commands/agent.ts`
- `src/commands/role.ts`
- `src/commands/channel.ts`
- `src/commands/directory.ts`

### 2. Core layer

Responsible for:

- command semantics
- result envelopes
- output formatting
- error normalization
- lightweight derived operations such as `agent get`

Suggested files:

- `src/core/result.ts`
- `src/core/errors.ts`
- `src/core/output.ts`

### 3. Adapter layer

Responsible for calling existing GT Office capabilities, without embedding UI concerns.

Adapters should be split by capability ownership:

- agent/role adapters wrap existing desktop backend commands
- channel adapters wrap channel/MCP-backed messaging capabilities
- directory adapter optionally exposes agent-directory snapshot inspection for debugging and integration

Suggested files:

- `src/adapters/agent_backend.ts`
- `src/adapters/channel_backend.ts`
- `src/adapters/directory_backend.ts`

### 4. REPL layer

Responsible for default interactive mode only. The REPL should execute the same subcommands and reuse the same command parser/output path instead of inventing a separate DSL.

Suggested file:

- `src/repl/repl.ts`

## Backend Integration Strategy

### Agent and role management

Version 1 should directly reuse the existing backend capabilities that already implement validation and persistence:

- `agent_role_list`
- `agent_role_save`
- `agent_role_delete`
- `agent_list`
- `agent_create`
- `agent_update`
- `agent_delete`
- `agent_prompt_read`

Why this is the right boundary:

- workdir validation already exists
- provider normalization already exists
- role-in-use deletion checks already exist
- prompt file persistence behavior already exists

The CLI should not copy those rules into TypeScript beyond basic argument presence/shape checks.

### Channel management

Version 1 should reuse the structured channel messaging surface:

- `channel.publish`
- `channel.list_messages`
- optional `gto_get_agent_directory` for debugging/directory snapshots

This keeps CLI messaging aligned with the existing GT Office collaboration model, where inbox/feed visibility is based on structured published messages instead of arbitrary terminal output.

## Command Model

### Agent commands

```bash
gt-office-cli agent list --workspace-id <id> [--json]
gt-office-cli agent get <agent-id> --workspace-id <id> [--json]

gt-office-cli agent create \
  --workspace-id <id> \
  --name <name> \
  --role-id <roleId> \
  --tool <claude|codex|gemini> \
  [--workdir <path>] \
  [--custom-workdir] \
  [--prompt-file-name <name>] \
  [--prompt-content <text>] \
  [--json]

gt-office-cli agent update <agent-id> \
  --workspace-id <id> \
  [--name <name>] \
  [--role-id <roleId>] \
  [--tool <claude|codex|gemini>] \
  [--workdir <path>] \
  [--custom-workdir=<true|false>] \
  [--prompt-file-name <name>] \
  [--prompt-content <text>] \
  [--state <ready|paused|blocked|terminated>] \
  [--json]

gt-office-cli agent delete <agent-id> --workspace-id <id> [--json]
gt-office-cli agent prompt read <agent-id> --workspace-id <id> [--json]
```

Notes:

- `agent get` is a CLI convenience operation layered over the existing list/detail data source.
- `agent update` may update persisted state, but version 1 does not manage runtime lifecycle.
- Prompt inspection is first-class because agent management already couples to provider-specific prompt files.

### Role commands

```bash
gt-office-cli role list --workspace-id <id> [--json]

gt-office-cli role create \
  --workspace-id <id> \
  --role-key <key> \
  --role-name <name> \
  [--scope <workspace|global>] \
  [--status <active|deprecated|disabled>] \
  [--charter-path <path>] \
  [--policy-json <json>] \
  [--json]

gt-office-cli role update <role-id> \
  --workspace-id <id> \
  [--role-key <key>] \
  [--role-name <name>] \
  [--status <active|deprecated|disabled>] \
  [--charter-path <path>] \
  [--policy-json <json>] \
  [--json]

gt-office-cli role delete <role-id> --workspace-id <id> [--json]
```

Notes:

- `scope` is supported because the backend model supports workspace/global roles.
- `policy-json` is passed as a raw JSON string in version 1; file-based policy input can wait.

### Channel commands

```bash
gt-office-cli channel list-messages \
  --workspace-id <id> \
  [--target-agent-id <id>] \
  [--sender-agent-id <id>] \
  [--task-id <id>] \
  [--limit <n>] \
  [--json]

gt-office-cli channel send \
  --workspace-id <id> \
  --channel-kind <direct|group|broadcast> \
  --channel-id <id> \
  [--sender-agent-id <id>] \
  [--target-agent-id <id> ...] \
  --message-type <task_instruction|status|handover> \
  --payload <json> \
  [--idempotency-key <key>] \
  [--json]
```

Notes:

- `list-messages` exposes the current structured inbox/feed surface and should not imply raw transcript retrieval.
- `payload` remains raw JSON so the CLI stays transport-oriented and does not invent an extra message schema.
- Multiple `--target-agent-id` values should be supported for group/broadcast cases.

### Optional debugging command

```bash
gt-office-cli directory snapshot --workspace-id <id> [--json]
```

Purpose:

- inspect roles
- inspect agents
- inspect runtimes
- help with CLI debugging and integration workflows

This is useful but secondary to the main version-1 control plane.

## Workspace Rule

All commands that affect or read workspace-scoped state must explicitly require `--workspace-id`.

Reasoning:

- the project rule requires explicit `workspace_id` for multi-workspace operations
- CLI commands should avoid guessing the target workspace
- explicit workspace input reduces accidental cross-workspace operations

## Output Model

Every command supports two output modes.

### Human-readable mode

Short, readable summaries suitable for direct terminal use.

Examples:

- agent list: `name / id / role / tool / state / workdir`
- role list: `name / key / scope / status`
- channel list-messages: `time / from / to / type / taskId`

### JSON mode

All JSON output should use a stable envelope:

Successful result:

```json
{
  "ok": true,
  "data": {}
}
```

Failure result:

```json
{
  "ok": false,
  "error": {
    "code": "ROLE_IN_USE",
    "message": "Role is still assigned to agents"
  }
}
```

This model should be shared by one-shot commands and REPL execution so tests and automation can rely on a consistent structure.

## Error Model

Version 1 should keep errors simple and predictable.

### CLI input errors

Handled directly in the CLI layer for argument/shape problems, for example:

- missing required option
- malformed JSON payload
- invalid enum value

Recommended codes:

- `MISSING_REQUIRED_OPTION`
- `INVALID_ARGUMENT`
- `INVALID_JSON`

### Domain/backend errors

Returned by adapters with minimal transformation, preserving backend meaning when possible, for example:

- `ROLE_IN_USE`
- `AGENT_NOT_FOUND`
- `WORKDIR_INVALID`
- `WORKSPACE_ID_REQUIRED`

This avoids semantic drift between desktop and CLI behavior.

## REPL Design

The CLI must enter REPL mode when invoked with no subcommand.

The REPL should:

- display a banner
- support `help`
- support `exit` / `quit`
- run the same command strings as the one-shot CLI
- reuse the same execution path, error model, and output modes

The REPL should not add a separate DSL, hidden state variables, or advanced interactive UX in version 1.

Not included in version 1 REPL scope:

- command completion
- advanced history management
- session variables
- rich forms or wizard UI

## Directory Layout

Suggested package layout:

```text
tools/gt-office-cli/
  src/
    gt_office_cli.ts
    commands/
      agent.ts
      role.ts
      channel.ts
      directory.ts
    core/
      result.ts
      errors.ts
      output.ts
    adapters/
      agent_backend.ts
      channel_backend.ts
      directory_backend.ts
    repl/
      repl.ts
  tests/
    test_core.ts
    test_e2e.ts
    TEST.md
  package.json
  tsconfig.json
  README.md
```

This keeps the CLI within the repository’s `tools/` boundary and makes the command/core/adapter separation explicit.

## Testing Strategy

The HARNESS process requires a real verification path. For this Node/TypeScript implementation, version 1 should use an equivalent layered test strategy.

### Core tests

Cover:

- result envelope creation
- output formatters
- error normalization
- command-level derived behavior such as `agent get`
- payload parsing and argument mapping

### CLI integration / E2E tests

Cover:

- `agent list`
- `agent create -> update -> delete`
- `role create -> update -> delete`
- `channel send -> channel list-messages`
- `--json` parsing
- default REPL entry, one command execution, and exit

### Dependency strategy

Version 1 should prefer adapter mocks/fakes rather than requiring a live desktop UI runtime for all tests.

Reasoning:

- the CLI boundary is still being established
- contract stability matters first
- true backend integration can be added later as a narrower follow-up once the command surface is stable

## Acceptance Criteria

Version 1 is complete when all of the following are true:

- one-shot commands support agent CRUD
- one-shot commands support role CRUD
- one-shot commands support structured channel send/list-messages
- every command supports `--json`
- invoking `gt-office-cli` with no subcommand starts the REPL
- the REPL can execute the same commands as one-shot mode
- tests cover the minimum control-plane flows
- README documents usage, scope, and current limitations
- implementation does not expand into runtime management, external connectors, or orchestration beyond this approved scope
