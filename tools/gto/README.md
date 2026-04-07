# GTO CLI

## Scope

Version 1 currently supports:

- `gto agents`
- `gto send <from> <to> <text>`
- `gto inbox <agent>`
- `gto thread <taskId>`
- `gto wait <taskId> --from <agent>`
- agent list/get/create/update/delete
- agent prompt read
- agent send-task/reply-status/handover
- agent inbox/task-thread
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
- `task.dispatch_batch`
- `task.list_threads`
- `task.get_thread`
- `channel.publish`
- `channel.list_messages`

Bridge error envelopes preserve machine-readable downstream command codes for structured errors such as `AGENT_NOT_FOUND: ...`; unstructured bridge failures still return `LOCAL_BRIDGE_INTERNAL`.

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
gto agents
gto send CEO Product "你好" --workspace-id ws_123 --json
gto send CEO Product "Review the latest diff." --workspace-id ws_123 --wait --timeout-sec 120 --json
gto inbox Product --workspace-id ws_123 --json
gto thread task_123 --workspace-id ws_123 --json
gto wait task_123 --workspace-id ws_123 --from CEO --timeout-sec 120 --json
gto agent list --workspace-id ws_123 --json
gto agent get agent_1 --workspace-id ws_123 --json
gto agent create --workspace-id ws_123 --name Alpha --role-id role_1 --tool claude --json
gto agent update agent_1 --workspace-id ws_123 --state paused --json
gto agent delete agent_1 --workspace-id ws_123 --json
gto agent prompt read agent_1 --workspace-id ws_123 --json
gto role list --workspace-id ws_123 --json
gto role create --workspace-id ws_123 --role-key planner --role-name Planner --scope workspace --status active --json
gto agent send-task --workspace-id ws_123 --target-agent-id agent_2 --title "Review diff" --markdown "Review the latest diff and reply with blockers." --json
gto agent reply-status --workspace-id ws_123 --agent-id agent_2 --target-agent-id agent_1 --task-id task_1 --detail "Blocked on integration test" --json
gto agent handover --workspace-id ws_123 --agent-id agent_2 --target-agent-id agent_1 --task-id task_1 --summary "Ready for final review" --next-step "Check the diff" --json
gto agent inbox --workspace-id ws_123 --agent-id agent_1 --json
gto agent task-thread --workspace-id ws_123 --task-id task_1 --json
gto channel list-messages --workspace-id ws_123 --target-agent-id agent_1 --limit 10 --json
gto channel send --workspace-id ws_123 --channel-kind direct --channel-id channel_1 --target-agent-id agent_1 --message-type status --payload '{"taskId":"task_1","summary":"done"}' --json
gto directory snapshot --workspace-id ws_123 --json
gto
```

## Limitations

Human-readable mode is intended for quick inspection. For automation, prefer `--json` and parse the envelope instead of relying on text formatting.

Current convenience commands still rely on either explicit `--workspace-id` or a discoverable workspace root containing `.gtoffice/session.snapshot.json`.

Version 1 does not yet cover agent runtime start/stop, raw terminal transcript access, external connector setup, or full orchestration workflows.
