# GT Office CLI

## Scope

Version 1 currently supports:

- agent list/get/create/update/delete
- agent prompt read
- role list/create/update/delete
- structured channel list/send
- directory snapshot
- `--json` output
- default REPL mode

## Requirements

The GT Office desktop bridge must be running so the local bridge methods are available.

## Local bridge method surface

CLI v1 currently calls these desktop bridge methods:

- `directory.get`
- `agent.role_list`
- `agent.role_save`
- `agent.role_delete`
- `agent.list`
- `agent.create`
- `agent.update`
- `agent.delete`
- `agent.prompt_read`
- `channel.publish`
- `channel.list_messages`

The desktop bridge also exposes additional methods such as `health`, `task.dispatch_batch`, and `dev.bootstrap_agents`, but CLI v1 does not currently depend on them for its CRUD, channel, or directory command paths.

Bridge error envelopes preserve machine-readable downstream command codes for structured errors such as `AGENT_NOT_FOUND: ...`; unstructured bridge failures still return `MCP_BRIDGE_INTERNAL`.

## Supported enum values

- `--tool`: `claude`, `codex`, `gemini`
- `--state`: `ready`, `paused`, `blocked`, `terminated`
- `--prompt-file-name`: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `--scope`: `workspace`, `global`
- `--status`: `active`, `deprecated`, `disabled`
- `--channel-kind`: `direct`, `group`, `broadcast`
- `--message-type`: `task_instruction`, `status`, `handover`

## JSON envelope

`--json` output uses the shared ResultEnvelope shape:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "traceId": "7a9d..."
}
```

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_JSON",
    "message": "Option must be valid JSON"
  },
  "traceId": "7a9d..."
}
```

## Examples

```bash
node tools/gt-office-cli/bin/gt-office-cli.mjs agent list --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs agent get agent_1 --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs agent create --workspace-id ws_123 --name Alpha --role-id role_1 --tool claude --json
node tools/gt-office-cli/bin/gt-office-cli.mjs agent update agent_1 --workspace-id ws_123 --state paused --json
node tools/gt-office-cli/bin/gt-office-cli.mjs agent delete agent_1 --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs agent prompt read agent_1 --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs role list --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs role create --workspace-id ws_123 --role-key planner --role-name Planner --scope workspace --status active --json
node tools/gt-office-cli/bin/gt-office-cli.mjs channel list-messages --workspace-id ws_123 --target-agent-id agent_1 --limit 10 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs channel send --workspace-id ws_123 --channel-kind direct --channel-id channel_1 --target-agent-id agent_1 --message-type status --payload '{"taskId":"task_1","summary":"done"}' --json
node tools/gt-office-cli/bin/gt-office-cli.mjs directory snapshot --workspace-id ws_123 --json
node tools/gt-office-cli/bin/gt-office-cli.mjs
```

## Limitations

Human-readable mode is intended for quick inspection. For automation, prefer `--json` and parse the envelope instead of relying on text formatting.

Version 1 does not yet cover agent runtime start/stop, raw terminal transcript access, external connector setup, or full orchestration workflows.
