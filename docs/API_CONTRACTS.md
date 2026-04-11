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
| `terminal.create` | `workspaceId, cwd?, shell?` | `sessionId` |
| `terminal.destroy` | `sessionId` | `destroyed` |
| `terminal.resize` | `sessionId, cols, rows` | `resized` |
| `terminal.write` | `sessionId, data` | `written` |
| `terminal.read_output` | `sessionId` | `output[]` |

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

## Event Contracts

Events use the `gtoffice:` namespace and are broadcast from the backend to all subscribed frontend listeners.

| Event | Payload | Trigger |
|-------|---------|---------|
| `gtoffice:workspace-opened` | `{ workspaceId, name, root }` | Workspace opened |
| `gtoffice:workspace-closed` | `{ workspaceId }` | Workspace closed |
| `gtoffice:file-changed` | `{ workspaceId, path, kind }` | File system change detected |
| `gtoffice:terminal-output` | `{ sessionId, data }` | Terminal produced output |
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
