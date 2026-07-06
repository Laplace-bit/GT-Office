# GT Office — API Contracts

This document defines the executable contracts between the React frontend and the Rust backend via Tauri commands and events.

## Contract Principles

1. **Commands** are request-response. The frontend invokes a command and receives a result.
2. **Events** are streaming state updates and async notifications. The backend pushes events; the frontend subscribes.
3. **All responses** use a unified `ResultEnvelope`.
4. **Error codes** are machine-readable and stable. Error messages are human-readable.
5. **Workspace-scoped commands** must carry `workspace_id`.

## Unified Response Structure

Every command returns a `ResultEnvelope`:

```typescript
interface ResultEnvelope<T> {
  ok: boolean
  data: T | null
  error: {
    code: string
    message: string
    details: Record<string, unknown>
  } | null
  traceId: string
}
```

Success example:

```json
{ "ok": true, "data": { "workspaceId": "ws-1" }, "error": null, "traceId": "7a9d..." }
```

Error example:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "SECURITY_PATH_DENIED",
    "message": "Target path is outside workspace",
    "details": { "path": "/etc/passwd", "workspaceRoot": "/home/user/project" }
  },
  "traceId": "7a9d..."
}
```

## Command Surface

### Workspace

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `workspace.list` | `{}` | `workspaces[]` |
| `workspace.open` | `path` | `workspaceId, name, root` |
| `workspace.close` | `workspaceId` | `closed` |
| `workspace.restore_session` | `workspaceId` | `windows, tabs, terminals` |
| `workspace.switch_active` | `workspaceId` | `activeWorkspaceId` |
| `workspace.get_context` | `workspaceId` | `root, permissions, terminalDefaultCwd` |
| `workspace.get_window_active` | `{}` | `windowLabel, workspaceId?` |

### Filesystem

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `fs.list_dir` | `workspaceId, path, depth?` | `entries[]` |
| `fs.read_file` | `workspaceId, path` | `content, encoding, sizeBytes, previewable, truncated` |
| `fs.read_file_full` | `workspaceId, path, limitBytes?` | Same as `read_file` |
| `fs.write_file` | `workspaceId, path, content` | `written` |
| `fs.delete` | `workspaceId, path` | `kind, deleted` |
| `fs.move` | `workspaceId, fromPath, toPath` | `kind, moved` |
| `fs.search` | `workspaceId, query, options?` | `results[]` |
| `fs.show_in_folder` | `workspaceId, path` | `opened` |

### Terminal

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `terminal_create` | `workspaceId, cwd?, shell?` | `sessionId, workspaceId, shell, cwdMode, resolvedCwd` |
| `terminal_write` | `workspaceId, sessionId, input` | `workspaceId, sessionId, accepted` |
| `terminal_write_with_submit` | `workspaceId, sessionId, input, submitSequence?` | `workspaceId, sessionId, accepted` |
| `terminal_resize` | `workspaceId, sessionId, cols, rows` | `workspaceId, sessionId, cols, rows, resized` |
| `terminal_kill` | `workspaceId, sessionId, signal?` | `workspaceId, sessionId, signal, killed` |
| `terminal_set_visibility` | `workspaceId, sessionId, visible` | `workspaceId, sessionId, visible, updated` |
| `terminal_read_snapshot` | `workspaceId, sessionId, maxBytes?` | `workspaceId, sessionId, chunk, bytes, maxBytes, truncated, currentSeq` |
| `terminal_read_delta` | `workspaceId, sessionId, afterSeq, maxBytes?` | `workspaceId, sessionId, chunk, fromSeq?, toSeq, currentSeq, gap, truncated` |
| `terminal_describe_processes` | `workspaceId, sessionId` | `workspaceId` + process snapshot |
| `terminal_report_rendered_screen` | `workspaceId, snapshot, toolKind?` | `workspaceId, sessionId, screenRevision, accepted, humanText?, humanEntries[]` |
| `terminal_has_session` | `workspaceId, sessionId` | `workspaceId, sessionId, alive` |
| `terminal_activate` | `workspaceId, sessionId` | `workspaceId` + rendered terminal placeholder |
| `terminal_get_rendered_screen` | `workspaceId, sessionId` | `workspaceId` + rendered terminal placeholder |
| `terminal_open_output_channel` | `workspaceId, sessionId` | `workspaceId, sessionId, channelBound` |
| `terminal_debug_clear_human_log` | `workspaceId, sessionId` | `workspaceId, sessionId, cleared` |
| `terminal_debug_append_frontend_focus_log` | `entry.workspaceId?, entry.stationId, entry.sessionId?, entry.kind, entry.detail?` | `workspaceId?, stationId, sessionId?, kind, accepted, logPath` |

### Session

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `session_list` | `workspaceId, provider?, limit?, offset?` | `cards[], limit, offset` |
| `session_discover` | `workspaceId, cwd, provider?, force?` | `cards[], stats, cached` |
| `session_get` | `workspaceId, gtoSessionId` | `session, stats` |
| `session_launch` | `workspaceId, stationId, agentId, provider, cwd, terminalSessionId?` | `gtoSessionId` |
| `session_resume_bind` | `workspaceId, gtoSessionId, terminalSessionId, stationId, agentId` | `ok` |
| `session_end` | `workspaceId, gtoSessionId` | `ok` |
| `session_resume_check` | `workspaceId?, gtoSessionId?, relaunchMode?, expectedProvider?` | `check, session?, stats?, providerMismatch?` |
| `session_update_title` | `workspaceId, gtoSessionId, title` | `ok` |
| `session_changefeed_query` | `workspaceId` | `snapshot` |
| `session_changefeed_push` | `workspaceId, branch, dirty, ahead, behind, stagedFiles, unstagedFiles, untrackedFiles, revision` | `emitted` |

### Git

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `git.status` | `workspaceId` | `branches, staged, unstaged, untracked` |
| `git.diff` | `workspaceId, path?, staged?` | `diff` |
| `git.log` | `workspaceId, count?` | `commits[]` |
| `git.branch_list` | `workspaceId` | `branches[]` |
| `git.stash_list` | `workspaceId` | `stashes[]` |

### Agent

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `agent.install` | `providerId, options?` | `installed` |
| `agent.uninstall` | `providerId` | `uninstalled` |
| `agent.list_roles` | `workspaceId` | `roles[]` |
| `agent.update_role` | `workspaceId, roleId, status` | `updated` |

### Settings

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `settings.get` | `key` | `value` |
| `settings.set` | `key, value` | `set` |
| `settings.reset` | `key` | `reset` |
| `settings.update_status` | `{}` | `enabled, currentVersion, manifestUrl` |
| `settings.update_check` | `{}` | `updateAvailable, version?, notes?` |
| `settings.update_download_and_install` | `{}` | `started, version?, errorCode?` |

### AI Config

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `ai_config.get_providers` | `{}` | `providers[]` |
| `ai_config.set_provider` | `providerId, config` | `updated` |
| `ai_config.get_live_settings` | `providerId` | `settings` |

### Task

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `task.create` | `workspaceId, title, markdown` | `taskId` |
| `task.update` | `taskId, status?, detail?` | `updated` |
| `task.list` | `workspaceId, filters?` | `tasks[]` |
| `task.cancel` | `taskId` | `cancelled` |

### Business Designer

| Command | Key Request Fields | Key Response Fields |
|---------|-------------------|-------------------|
| `business_designer.list_documents` | `workspaceId` | `documents[]` |
| `business_designer.init_docs_repo` | `workspaceId` | `initialized` |
| `business_designer.create_document` | `workspaceId, name?` | `documentId, manifest` |
| `business_designer.read_document` | `workspaceId, documentId` | `document, manifest, generated` |
| `business_designer.save_document` | `workspaceId, documentId, document, manifest` | `saved, revision` |
| `business_designer.validate_document` | `workspaceId, documentId` | `revision, diagnostics, gaps, rulesRun, graphProjection` |
| `business_designer.compile_document` | `workspaceId, documentId` | `compiled` (includes `code-gen-prompt.md` in generated files) |
| `business_designer.create_checkpoint` | `workspaceId, documentId, message?` | `checkpointId` |
| `business_designer.diff_checkpoint` | `workspaceId, documentId, checkpointId?` | `diff` |
| `business_designer.compare_checkpoints` | `workspaceId, documentId, fromCheckpointId, toCheckpointId` | `diff` |
| `business_designer.list_checkpoints` | `workspaceId, documentId` | `checkpoints[]` |
| `business_designer.preview_agent_task` | `workspaceId, documentId, hostBlockId, gapCodes, scope, baseRevision` | `preview` |
| `business_designer.run_agent_completion` | `workspaceId, documentId, hostBlockId, gapCodes, scope, baseRevision` | `patch` |
| `business_designer.run_mock_agent_completion` | `workspaceId, documentId, hostBlockId, gapCodes, scope, baseRevision` | `patch` (mock) |
| `business_designer.start_freeform_completion` | `workspaceId, documentId, scenario, hostBlockId?, userPrompt?` | `runId, sessionId` |
| `business_designer.list_freeform_completion_runs` | `workspaceId, documentId` | `runs[]` |
| `business_designer.read_freeform_completion_run_log` | `workspaceId, documentId, runId` | `log` |
| `business_designer.update_freeform_completion_run_status` | `workspaceId, documentId, runId, status` | `updated` |
| `business_designer.revert_to_checkpoint` | `workspaceId, documentId, checkpointId` | `reverted` |
| `business_designer.validate_agent_patch` | `workspaceId, documentId, patch, baseRevision` | `validation` |
| `business_designer.recover_agent_patch_from_task` | `workspaceId, documentId, taskId` | `patch` |
| `business_designer.apply_agent_patch` | `workspaceId, documentId, patch, baseRevision, acceptedChangeIndices?` | `applied, gapResolution` |
| `business_designer.export_document` | `workspaceId, documentId, format` | `export` (supports `codeGenPrompt` format) |
| `business_designer.export_document_to_file` | `workspaceId, documentId, format, path` | `exported` |
| `business_designer.preview_coding_handoff` | `workspaceId, documentId` | `preview` |
| `business_designer.dispatch_coding_handoff` | `workspaceId, documentId` | `taskId` |

## Event Contracts

Events are broadcast from the backend to all subscribed frontend listeners. Workspace-scoped events include `workspaceId` so listeners can reject stale events before mutating active UI state.

| Event | Payload | Trigger |
|-------|---------|---------|
| `gtoffice:workspace-opened` | `{ workspaceId, name, root }` | Workspace opened |
| `gtoffice:workspace-closed` | `{ workspaceId }` | Workspace closed |
| `gtoffice:file-changed` | `{ workspaceId, path, kind }` | File system change detected |
| `terminal/output` | `{ workspaceId, sessionId, chunk, seq, tsMs }` | Terminal produced output |
| `terminal/state_changed` | `{ workspaceId, sessionId, from, to, tsMs }` | Terminal lifecycle changed |
| `terminal/meta` | `{ workspaceId, sessionId, unreadBytes, unreadChunks, tailChunk, tsMs }` | Hidden terminal produced summarized output |
| `gtoffice:git-status-changed` | `{ workspaceId }` | Git status needs refresh |
| `gtoffice:ui-preferences-updated` | `{ preferences }` | UI preferences changed |

## Shared Types

The `packages/shared-types` package defines the contracts between frontend and backend. Both sides import from this package to ensure type consistency.

Key shared type categories:
- Workspace types (workspace config, context, permissions)
- File system types (directory entries, file metadata)
- Terminal types (session config, output events)
- Git types (status, diff, log entries)
- Agent types (roles, installation status)
- Error types (error codes, result envelope)

## Error Codes

### Security Errors

| Code | Description |
|------|-------------|
| `SECURITY_PATH_DENIED` | Target path is outside workspace |
| `SECURITY_WORKSPACE_REQUIRED` | Workspace ID is required but missing |

### Bridge Errors

| Code | Description |
|------|-------------|
| `LOCAL_BRIDGE_UNAVAILABLE` | Local bridge runtime is not reachable |
| `LOCAL_BRIDGE_AUTH_FAILED` | Bridge authentication token is invalid |

### Agent Errors

| Code | Description |
|------|-------------|
| `AGENT_OFFLINE` | Target agent is not connected |
| `AGENT_INSTALL_FAILED` | Agent installation failed |
| `MCP_INVALID_PARAMS` | MCP request has invalid parameters |
| `MCP_BRIDGE_UNAVAILABLE` | MCP bridge is not available |

### Workspace Errors

| Code | Description |
|------|-------------|
| `WORKSPACE_NOT_FOUND` | Referenced workspace does not exist |
| `WORKSPACE_ALREADY_OPEN` | Workspace is already open |
