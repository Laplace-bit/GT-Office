export interface WorkspaceWindowActiveResponse {
  windowLabel: string
  workspaceId?: string | null
}

export interface WorkspaceOpenResponse {
  workspaceId: string
  name: string
  root: string
}

export interface WorkspaceContextResponse {
  workspaceId: string
  root: string
  permissions: {
    allowTerminal: boolean
    allowGit: boolean
    allowFileRead: boolean
    allowFileWrite: boolean
  }
  terminalDefaultCwd: 'workspace_root' | 'custom'
}

export interface WorkspaceRestoreSessionResponse {
  workspaceId: string
  windows: unknown[]
  tabs: unknown[]
  terminals: unknown[]
}

export interface GitStatusFile {
  path: string
  staged: boolean
  status: string
}

export interface GitStatusResponse {
  workspaceId: string
  branch: string
  ahead: number
  behind: number
  files: GitStatusFile[]
}

export interface GitInitResponse {
  workspaceId: string
  branch: string
  initialized: boolean
}

export interface GitDiffResponse {
  workspaceId: string
  path: string
  patch: string
}

/** Segment within a line for word-level diff highlighting */
export interface DiffSegment {
  /** Segment type: 'equal', 'insert', 'delete' */
  kind: 'equal' | 'insert' | 'delete'
  /** Text content of this segment */
  value: string
}

/** Single line in a diff hunk with word-level diff support */
export interface GitDiffLine {
  /** Line type: 'add', 'del', 'ctx' (context) */
  kind: 'add' | 'del' | 'ctx'
  /** Content of the line (without +/- prefix) */
  content: string
  /** Old line number (null for additions) */
  oldLine: number | null
  /** New line number (null for deletions) */
  newLine: number | null
  /** Word-level diff segments for precise highlighting (optional) */
  segments?: DiffSegment[]
}

/** Diff hunk (contiguous block of changes) */
export interface GitDiffHunk {
  /** Header line (e.g., "@@ -1,3 +1,4 @@") */
  header: string
  /** Starting line in old file */
  oldStart: number
  /** Number of lines in old file */
  oldLines: number
  /** Starting line in new file */
  newStart: number
  /** Number of lines in new file */
  newLines: number
  /** Lines in this hunk */
  lines: GitDiffLine[]
}

/** High-performance structured diff response */
export interface GitDiffStructuredResponse {
  workspaceId: string
  /** File path */
  path: string
  /** Whether the file is binary */
  isBinary: boolean
  /** Whether this is a new file */
  isNew: boolean
  /** Whether this is a deleted file */
  isDeleted: boolean
  /** Whether this is a renamed file */
  isRenamed: boolean
  /** Old file path (for renames) */
  oldPath: string | null
  /** Total additions count */
  additions: number
  /** Total deletions count */
  deletions: number
  /** Diff hunks */
  hunks: GitDiffHunk[]
  /** Raw patch (fallback) */
  patch: string
}

export interface GitCountResponse {
  workspaceId: string
  staged?: number
  unstaged?: number
  discarded?: number
}

export interface GitCommitResponse {
  workspaceId: string
  message: string
  commit: string
}

export interface GitCommitEntry {
  commit: string
  shortCommit: string
  parents: string[]
  refs: string[]
  authorName: string
  authorEmail: string
  authoredAt: string
  summary: string
}

export interface GitLogResponse {
  workspaceId: string
  entries: GitCommitEntry[]
}

export interface GitCommitDetailFile {
  status: string
  path: string
  previousPath?: string | null
}

export interface GitCommitDetailResponse {
  workspaceId: string
  commit: string
  shortCommit: string
  parents: string[]
  refs: string[]
  authorName: string
  authorEmail: string
  authoredAt: string
  summary: string
  body: string
  files: GitCommitDetailFile[]
}

export interface GitBranchEntry {
  name: string
  current: boolean
  upstream?: string | null
  tracking?: string | null
  commit: string
  summary: string
}

export interface GitBranchesResponse {
  workspaceId: string
  branches: GitBranchEntry[]
}

export interface GitCheckoutResponse {
  workspaceId: string
  target: string
  create: boolean
  startPoint?: string | null
  checkedOut: boolean
}

export interface GitBranchMutationResponse {
  workspaceId: string
  branch: string
  startPoint?: string | null
  force?: boolean
  created?: boolean
  deleted?: boolean
}

export interface GitFetchResponse {
  workspaceId: string
  remote: string
  prune: boolean
  includeTags: boolean
  fetched: boolean
}

export interface GitPullResponse {
  workspaceId: string
  remote: string
  branch?: string | null
  rebase: boolean
  pulled: boolean
}

export interface GitPushResponse {
  workspaceId: string
  remote: string
  branch?: string | null
  setUpstream: boolean
  forceWithLease: boolean
  pushed: boolean
}

export interface GitStashEntry {
  stash: string
  commit: string
  createdAt: string
  summary: string
}

export interface GitStashListResponse {
  workspaceId: string
  entries: GitStashEntry[]
}

export interface GitStashPushResponse {
  workspaceId: string
  message?: string | null
  includeUntracked: boolean
  keepIndex: boolean
  stashed: boolean
}

export interface GitStashPopResponse {
  workspaceId: string
  stash?: string | null
  popped: boolean
}

export interface TerminalCreateResponse {
  sessionId: string
  workspaceId: string
  shell: string
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string
}

export interface TerminalOutputPayload {
  sessionId: string
  chunk: string
  seq: number
  tsMs: number
}

export interface TerminalStatePayload {
  sessionId: string
  from: string
  to: string
  tsMs: number
}

export interface TerminalMetaPayload {
  sessionId: string
  unreadBytes: number
  unreadChunks: number
  tailChunk: string
  tsMs: number
}

export interface TerminalKillResponse {
  sessionId: string
  signal: string
  killed: boolean
}

export interface TerminalVisibilityResponse {
  sessionId: string
  visible: boolean
  updated: boolean
}

export interface TerminalSnapshotResponse {
  sessionId: string
  chunk: string
  bytes: number
  maxBytes: number
  truncated: boolean
}

export interface FsEntry {
  path: string
  name: string
  kind: 'dir' | 'file'
  sizeBytes?: number
}

export interface FsListDirResponse {
  workspaceId: string
  path: string
  depth: number
  entries: FsEntry[]
}

export interface FsReadFileResponse {
  workspaceId: string
  path: string
  content: string
  encoding: 'utf-8' | 'binary'
  sizeBytes: number
  previewBytes: number
  previewable: boolean
  truncated: boolean
}

export interface FsWriteFileResponse {
  workspaceId: string
  path: string
  bytes: number
  written: boolean
}

export interface FsDeleteResponse {
  workspaceId: string
  path: string
  kind: 'dir' | 'file'
  deleted: boolean
}

export interface FsMoveResponse {
  workspaceId: string
  fromPath: string
  toPath: string
  kind: 'dir' | 'file'
  moved: boolean
}

export interface FsSearchMatch {
  path: string
  line: number
  preview: string
}

export interface FsSearchTextResponse {
  workspaceId: string
  query: string
  glob?: string | null
  matches: FsSearchMatch[]
}

export interface FsSearchFileMatch {
  path: string
  name: string
}

export interface FsSearchFilesResponse {
  workspaceId: string
  query: string
  matches: FsSearchFileMatch[]
}

export interface FsSearchStreamStartResponse {
  workspaceId: string
  searchId: string
  accepted: boolean
}

export interface FsSearchStreamCancelResponse {
  searchId: string
  cancelled: boolean
}

export interface DaemonSearchItemPayload {
  path: string
  line: number
  column: number
  preview: string
}

export interface DaemonSearchChunkPayload {
  searchId: string
  items: DaemonSearchItemPayload[]
}

export interface DaemonSearchBackpressurePayload {
  searchId: string
  droppedChunks: number
}

export interface DaemonSearchDonePayload {
  searchId: string
  scannedFiles: number
  emittedMatches: number
  cancelled: boolean
}

export interface DaemonSearchCancelledPayload {
  searchId: string
}

export interface FilesystemChangedPayload {
  workspaceId: string
  kind: 'created' | 'modified' | 'removed' | 'renamed' | 'other'
  paths: string[]
  tsMs: number
}

export interface FilesystemWatchErrorPayload {
  workspaceId: string
  detail: string
}

export interface SettingsEffectiveResponse {
  workspaceId?: string | null
  values: Record<string, unknown>
  sources: Record<string, unknown>
}

export interface SettingsUpdateResponse {
  workspaceId?: string | null
  scope: string
  patch: Record<string, unknown>
  updated: boolean
  effective: Record<string, unknown>
}

export interface SettingsResetResponse {
  workspaceId?: string | null
  scope: string
  keys: string[]
  reset: boolean
  effective: Record<string, unknown>
}

export interface SettingsUpdatedPayload {
  workspaceId?: string | null
  scope: 'user' | 'workspace' | 'session'
  tsMs: number
}

export interface GitUpdatedPayload {
  workspaceId: string
  branch: string
  dirty: boolean
}

export interface TaskDispatchSender {
  type: 'human' | 'agent'
  agentId?: string | null
}

export interface TaskDispatchAttachmentPayload {
  path: string
  name: string
  category: string
}

export interface TaskDispatchBatchRequest {
  workspaceId: string
  sender?: TaskDispatchSender
  targets: string[]
  title: string
  markdown: string
  attachments: TaskDispatchAttachmentPayload[]
  submitSequences?: Record<string, string>
}

export interface TaskDispatchBatchResult {
  targetAgentId: string
  taskId: string
  status: 'sent' | 'failed'
  detail?: string | null
  taskFilePath?: string | null
}

export interface TaskDispatchBatchResponse {
  batchId: string
  results: TaskDispatchBatchResult[]
}

export type AgentState = 'ready' | 'paused' | 'blocked' | 'terminated'

export interface OrganizationDepartment {
  id: string
  workspaceId: string
  name: string
  description?: string | null
  orderIndex: number
  isSystem: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface AgentRole {
  id: string
  workspaceId: string
  roleKey: string
  roleName: string
  departmentId: string
  charterPath?: string | null
  policyJson?: string | null
  version: number
  status: 'active' | 'deprecated' | 'disabled'
  isSystem: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface AgentProfile {
  id: string
  workspaceId: string
  name: string
  roleId: string
  state: AgentState
  employeeNo?: string | null
  policySnapshotId?: string | null
  createdAtMs: number
  updatedAtMs: number
}

export interface AgentDepartmentListResponse {
  departments: OrganizationDepartment[]
}

export interface AgentRoleListResponse {
  roles: AgentRole[]
}

export interface AgentListResponse {
  agents: AgentProfile[]
}

export interface AgentCreateRequest {
  workspaceId: string
  agentId?: string | null
  name: string
  roleId: string
  employeeNo?: string | null
  state?: AgentState
}

export interface AgentCreateResponse {
  agent: AgentProfile
}

export interface AgentRuntimeRegisterRequest {
  workspaceId: string
  agentId: string
  stationId: string
  sessionId: string
  online?: boolean
}

export interface AgentRuntimeRegisterResponse {
  workspaceId: string
  agentId: string
  stationId: string
  sessionId: string
  registered: boolean
}

export interface AgentRuntimeUnregisterResponse {
  workspaceId: string
  agentId: string
  unregistered: boolean
}

export type ChannelKind = 'direct' | 'group' | 'broadcast'
export type ChannelMessageType = 'task_instruction' | 'status' | 'handover'

export interface ChannelPublishRequest {
  workspaceId: string
  channel: {
    kind: ChannelKind
    id: string
  }
  senderAgentId?: string | null
  targetAgentIds?: string[]
  type: ChannelMessageType
  payload: Record<string, unknown>
  idempotencyKey?: string | null
}

export interface ChannelPublishResponse {
  messageId: string
  acceptedTargets: string[]
  failedTargets: Array<{
    agentId: string
    reason: string
  }>
}

export interface ChannelMessagePayload {
  workspaceId: string
  channelId: string
  messageId: string
  seq: number
  senderAgentId?: string | null
  targetAgentId: string
  type: ChannelMessageType
  payload: Record<string, unknown>
  tsMs: number
}

export interface ChannelAckPayload {
  workspaceId: string
  messageId: string
  targetAgentId: string
  status: 'delivered' | 'failed'
  reason?: string | null
  tsMs: number
}

export interface TaskDispatchProgressPayload {
  batchId: string
  workspaceId: string
  targetAgentId: string
  taskId: string
  status: 'sending' | 'sent' | 'failed'
  detail?: string | null
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
type RuntimeWindowController = {
  setDecorations: (decorations: boolean) => Promise<void>
  isMaximized: () => Promise<boolean>
  toggleMaximize: () => Promise<void>
  minimize: () => Promise<void>
  close: () => Promise<void>
  onResized: (handler: () => void) => Promise<() => void>
}

let cachedInvoke: InvokeFn | null = null
let cachedWindowController: RuntimeWindowController | null = null

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const withInternals = window as Window & { __TAURI_INTERNALS__?: unknown }
  return Boolean(withInternals.__TAURI_INTERNALS__)
}

async function getInvoke(): Promise<InvokeFn> {
  if (cachedInvoke) {
    return cachedInvoke
  }

  const core = await import('@tauri-apps/api/core')
  cachedInvoke = core.invoke as InvokeFn
  return cachedInvoke
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('TAURI_RUNTIME_UNAVAILABLE')
  }
  const invoke = await getInvoke()
  return invoke<T>(command, args)
}

async function getWindowController(): Promise<RuntimeWindowController> {
  if (cachedWindowController) {
    return cachedWindowController
  }
  if (!isTauriRuntime()) {
    throw new Error('TAURI_RUNTIME_UNAVAILABLE')
  }
  const windowApi = await import('@tauri-apps/api/window')
  cachedWindowController = windowApi.getCurrentWindow()
  return cachedWindowController
}

export const desktopApi = {
  isTauriRuntime,
  systemPickDirectory(defaultPath?: string | null) {
    return invokeCommand<string | null>('system_pick_directory', {
      defaultPath: defaultPath ?? null,
    })
  },
  workspaceGetWindowActive() {
    return invokeCommand<WorkspaceWindowActiveResponse>('workspace_get_window_active')
  },
  workspaceOpen(path: string) {
    return invokeCommand<WorkspaceOpenResponse>('workspace_open', { path })
  },
  workspaceGetContext(workspaceId: string) {
    return invokeCommand<WorkspaceContextResponse>('workspace_get_context', { workspaceId })
  },
  workspaceRestoreSession(workspaceId: string) {
    return invokeCommand<WorkspaceRestoreSessionResponse>('workspace_restore_session', {
      workspaceId,
    })
  },
  gitStatus(workspaceId: string) {
    return invokeCommand<GitStatusResponse>('git_status', { workspaceId })
  },
  gitInit(workspaceId: string, initialBranch?: string | null) {
    return invokeCommand<GitInitResponse>('git_init', {
      workspaceId,
      initialBranch: initialBranch ?? null,
    })
  },
  gitDiffFile(workspaceId: string, path: string) {
    return invokeCommand<GitDiffResponse>('git_diff_file', { workspaceId, path })
  },
  /** High-performance structured diff with parsed hunks */
  gitDiffFileStructured(workspaceId: string, path: string) {
    return invokeCommand<GitDiffStructuredResponse>('git_diff_file_structured', { workspaceId, path })
  },
  gitStage(workspaceId: string, paths: string[]) {
    return invokeCommand<GitCountResponse>('git_stage', { workspaceId, paths })
  },
  gitUnstage(workspaceId: string, paths: string[]) {
    return invokeCommand<GitCountResponse>('git_unstage', { workspaceId, paths })
  },
  gitDiscard(workspaceId: string, paths: string[], includeUntracked?: boolean) {
    return invokeCommand<GitCountResponse>('git_discard', {
      workspaceId,
      paths,
      includeUntracked: includeUntracked ?? false,
    })
  },
  gitCommit(workspaceId: string, message: string) {
    return invokeCommand<GitCommitResponse>('git_commit', { workspaceId, message })
  },
  gitLog(workspaceId: string, options?: { limit?: number; skip?: number }) {
    return invokeCommand<GitLogResponse>('git_log', {
      workspaceId,
      limit: options?.limit ?? null,
      skip: options?.skip ?? null,
    })
  },
  gitCommitDetail(workspaceId: string, commit: string) {
    return invokeCommand<GitCommitDetailResponse>('git_commit_detail', {
      workspaceId,
      commit,
    })
  },
  gitListBranches(workspaceId: string, includeRemote?: boolean) {
    return invokeCommand<GitBranchesResponse>('git_list_branches', {
      workspaceId,
      includeRemote: includeRemote ?? false,
    })
  },
  gitCheckout(
    workspaceId: string,
    target: string,
    options?: { create?: boolean; startPoint?: string | null },
  ) {
    return invokeCommand<GitCheckoutResponse>('git_checkout', {
      workspaceId,
      target,
      create: options?.create ?? false,
      startPoint: options?.startPoint ?? null,
    })
  },
  gitCreateBranch(workspaceId: string, branch: string, startPoint?: string | null) {
    return invokeCommand<GitBranchMutationResponse>('git_create_branch', {
      workspaceId,
      branch,
      startPoint: startPoint ?? null,
    })
  },
  gitDeleteBranch(workspaceId: string, branch: string, force?: boolean) {
    return invokeCommand<GitBranchMutationResponse>('git_delete_branch', {
      workspaceId,
      branch,
      force: force ?? false,
    })
  },
  gitFetch(
    workspaceId: string,
    options?: { remote?: string | null; prune?: boolean; includeTags?: boolean },
  ) {
    return invokeCommand<GitFetchResponse>('git_fetch', {
      workspaceId,
      remote: options?.remote ?? null,
      prune: options?.prune ?? true,
      includeTags: options?.includeTags ?? true,
    })
  },
  gitPull(
    workspaceId: string,
    options?: { remote?: string | null; branch?: string | null; rebase?: boolean },
  ) {
    return invokeCommand<GitPullResponse>('git_pull', {
      workspaceId,
      remote: options?.remote ?? null,
      branch: options?.branch ?? null,
      rebase: options?.rebase ?? false,
    })
  },
  gitPush(
    workspaceId: string,
    options?: {
      remote?: string | null
      branch?: string | null
      setUpstream?: boolean
      forceWithLease?: boolean
    },
  ) {
    return invokeCommand<GitPushResponse>('git_push', {
      workspaceId,
      remote: options?.remote ?? null,
      branch: options?.branch ?? null,
      setUpstream: options?.setUpstream ?? false,
      forceWithLease: options?.forceWithLease ?? false,
    })
  },
  gitStashPush(
    workspaceId: string,
    options?: { message?: string | null; includeUntracked?: boolean; keepIndex?: boolean },
  ) {
    return invokeCommand<GitStashPushResponse>('git_stash_push', {
      workspaceId,
      message: options?.message ?? null,
      includeUntracked: options?.includeUntracked ?? false,
      keepIndex: options?.keepIndex ?? false,
    })
  },
  gitStashPop(workspaceId: string, stash?: string | null) {
    return invokeCommand<GitStashPopResponse>('git_stash_pop', {
      workspaceId,
      stash: stash ?? null,
    })
  },
  gitStashList(workspaceId: string, limit?: number) {
    return invokeCommand<GitStashListResponse>('git_stash_list', {
      workspaceId,
      limit: limit ?? null,
    })
  },
  fsListDir(workspaceId: string, path: string, depth = 2) {
    return invokeCommand<FsListDirResponse>('fs_list_dir', { workspaceId, path, depth })
  },
  fsReadFile(workspaceId: string, path: string) {
    return invokeCommand<FsReadFileResponse>('fs_read_file', { workspaceId, path })
  },
  fsReadFileFull(workspaceId: string, path: string, limitBytes?: number) {
    return invokeCommand<FsReadFileResponse>('fs_read_file_full', {
      workspaceId,
      path,
      limitBytes: limitBytes ?? null,
    })
  },
  fsWriteFile(workspaceId: string, path: string, content: string) {
    return invokeCommand<FsWriteFileResponse>('fs_write_file', { workspaceId, path, content })
  },
  fsDelete(workspaceId: string, path: string) {
    return invokeCommand<FsDeleteResponse>('fs_delete', { workspaceId, path })
  },
  fsMove(workspaceId: string, fromPath: string, toPath: string) {
    return invokeCommand<FsMoveResponse>('fs_move', { workspaceId, fromPath, toPath })
  },
  fsSearchText(workspaceId: string, query: string, glob?: string | null) {
    return invokeCommand<FsSearchTextResponse>('fs_search_text', {
      workspaceId,
      query,
      glob: glob ?? null,
    })
  },
  fsSearchFiles(workspaceId: string, query: string, maxResults?: number) {
    return invokeCommand<FsSearchFilesResponse>('fs_search_files', {
      workspaceId,
      query,
      maxResults: maxResults ?? null,
    })
  },
  fsSearchStreamStart(
    workspaceId: string,
    options: {
      searchId?: string | null
      query: string
      glob?: string | null
      chunkSize?: number | null
      maxResults?: number | null
    },
  ) {
    return invokeCommand<FsSearchStreamStartResponse>('fs_search_stream_start', {
      workspaceId,
      searchId: options.searchId ?? null,
      query: options.query,
      glob: options.glob ?? null,
      chunkSize: options.chunkSize ?? null,
      maxResults: options.maxResults ?? null,
    })
  },
  fsSearchStreamCancel(searchId: string) {
    return invokeCommand<FsSearchStreamCancelResponse>('fs_search_stream_cancel', {
      searchId,
    })
  },
  settingsGetEffective(workspaceId?: string | null) {
    return invokeCommand<SettingsEffectiveResponse>('settings_get_effective', {
      workspaceId: workspaceId ?? null,
    })
  },
  settingsUpdate(
    scope: 'user' | 'workspace' | 'session',
    patch: Record<string, unknown>,
    workspaceId?: string | null,
  ) {
    return invokeCommand<SettingsUpdateResponse>('settings_update', {
      workspaceId: workspaceId ?? null,
      scope,
      patch,
    })
  },
  settingsReset(
    scope: 'user' | 'workspace' | 'session',
    keys: string[],
    workspaceId?: string | null,
  ) {
    return invokeCommand<SettingsResetResponse>('settings_reset', {
      workspaceId: workspaceId ?? null,
      scope,
      keys,
    })
  },
  terminalCreate(
    workspaceId: string,
    options?: {
      shell?: string | null
      cwd?: string | null
      cwdMode?: 'workspace_root' | 'custom'
    },
  ) {
    return invokeCommand<TerminalCreateResponse>('terminal_create', {
      workspaceId,
      shell: options?.shell ?? null,
      cwd: options?.cwd ?? null,
      cwdMode: options?.cwdMode ?? 'workspace_root',
    })
  },
  terminalWrite(sessionId: string, input: string) {
    return invokeCommand<{ sessionId: string; accepted: boolean }>('terminal_write', {
      sessionId,
      input,
    })
  },
  terminalResize(sessionId: string, cols: number, rows: number) {
    return invokeCommand<{ sessionId: string; cols: number; rows: number; resized: boolean }>(
      'terminal_resize',
      {
        sessionId,
        cols,
        rows,
      },
    )
  },
  terminalKill(sessionId: string, signal?: string) {
    return invokeCommand<TerminalKillResponse>('terminal_kill', {
      sessionId,
      signal: signal ?? null,
    })
  },
  terminalSetVisibility(sessionId: string, visible: boolean) {
    return invokeCommand<TerminalVisibilityResponse>('terminal_set_visibility', {
      sessionId,
      visible,
    })
  },
  terminalReadSnapshot(sessionId: string, maxBytes?: number) {
    return invokeCommand<TerminalSnapshotResponse>('terminal_read_snapshot', {
      sessionId,
      maxBytes: maxBytes ?? null,
    })
  },
  taskDispatchBatch(request: TaskDispatchBatchRequest) {
    return invokeCommand<TaskDispatchBatchResponse>('task_dispatch_batch', {
      request: {
        workspaceId: request.workspaceId,
        sender: request.sender ?? { type: 'human', agentId: null },
        targets: request.targets,
        title: request.title,
        markdown: request.markdown,
        attachments: request.attachments,
        submitSequences: request.submitSequences ?? {},
      },
    })
  },
  channelPublish(request: ChannelPublishRequest) {
    return invokeCommand<ChannelPublishResponse>('channel_publish', {
      request: {
        workspaceId: request.workspaceId,
        channel: request.channel,
        senderAgentId: request.senderAgentId ?? null,
        targetAgentIds: request.targetAgentIds ?? [],
        type: request.type,
        payload: request.payload,
        idempotencyKey: request.idempotencyKey ?? null,
      },
    })
  },
  agentDepartmentList(workspaceId: string) {
    return invokeCommand<AgentDepartmentListResponse>('agent_department_list', { workspaceId })
  },
  agentRoleList(workspaceId: string) {
    return invokeCommand<AgentRoleListResponse>('agent_role_list', { workspaceId })
  },
  agentList(workspaceId: string) {
    return invokeCommand<AgentListResponse>('agent_list', { workspaceId })
  },
  agentCreate(request: AgentCreateRequest) {
    return invokeCommand<AgentCreateResponse>('agent_create', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId ?? null,
        name: request.name,
        roleId: request.roleId,
        employeeNo: request.employeeNo ?? null,
        state: request.state ?? null,
      },
    })
  },
  agentRuntimeRegister(request: AgentRuntimeRegisterRequest) {
    return invokeCommand<AgentRuntimeRegisterResponse>('agent_runtime_register', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        stationId: request.stationId,
        sessionId: request.sessionId,
        online: request.online ?? true,
      },
    })
  },
  agentRuntimeUnregister(workspaceId: string, agentId: string) {
    return invokeCommand<AgentRuntimeUnregisterResponse>('agent_runtime_unregister', {
      request: {
        workspaceId,
        agentId,
      },
    })
  },
  async windowSetDecorations(decorations: boolean): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false
    }
    try {
      const window = await getWindowController()
      await window.setDecorations(decorations)
      return true
    } catch {
      return false
    }
  },
  async windowIsMaximized(): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false
    }
    try {
      const window = await getWindowController()
      return await window.isMaximized()
    } catch {
      return false
    }
  },
  async windowToggleMaximize(): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false
    }
    try {
      const window = await getWindowController()
      await window.toggleMaximize()
      return true
    } catch {
      return false
    }
  },
  async windowMinimize(): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false
    }
    try {
      const window = await getWindowController()
      await window.minimize()
      return true
    } catch {
      return false
    }
  },
  async windowClose(): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false
    }
    try {
      const window = await getWindowController()
      await window.close()
      return true
    } catch {
      return false
    }
  },
  async subscribeWindowResized(onResized: () => void): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }
    try {
      const window = await getWindowController()
      return await window.onResized(onResized)
    } catch {
      return () => {}
    }
  },
  async subscribeTerminalEvents(handlers: {
    onOutput: (payload: TerminalOutputPayload) => void
    onStateChanged: (payload: TerminalStatePayload) => void
    onMeta: (payload: TerminalMetaPayload) => void
  }): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlistenOutput = await eventApi.listen<TerminalOutputPayload>(
      'terminal/output',
      (event) => handlers.onOutput(event.payload),
    )
    const unlistenState = await eventApi.listen<TerminalStatePayload>(
      'terminal/state_changed',
      (event) => handlers.onStateChanged(event.payload),
    )
    const unlistenMeta = await eventApi.listen<TerminalMetaPayload>(
      'terminal/meta',
      (event) => handlers.onMeta(event.payload),
    )

    return () => {
      unlistenOutput()
      unlistenState()
      unlistenMeta()
    }
  },
  async subscribeChannelEvents(handlers: {
    onMessage: (payload: ChannelMessagePayload) => void
    onAck: (payload: ChannelAckPayload) => void
    onDispatchProgress: (payload: TaskDispatchProgressPayload) => void
  }): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlistenMessage = await eventApi.listen<ChannelMessagePayload>(
      'channel/message',
      (event) => handlers.onMessage(event.payload),
    )
    const unlistenAck = await eventApi.listen<ChannelAckPayload>('channel/ack', (event) =>
      handlers.onAck(event.payload),
    )
    const unlistenDispatchProgress = await eventApi.listen<TaskDispatchProgressPayload>(
      'task/dispatch_progress',
      (event) => handlers.onDispatchProgress(event.payload),
    )

    return () => {
      unlistenMessage()
      unlistenAck()
      unlistenDispatchProgress()
    }
  },
  async subscribeFilesystemEvents(
    onChanged: (payload: FilesystemChangedPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlistenChanged = await eventApi.listen<FilesystemChangedPayload>(
      'filesystem/changed',
      (event) => onChanged(event.payload),
    )
    return () => {
      unlistenChanged()
    }
  },
  async subscribeFilesystemWatchErrors(
    onError: (payload: FilesystemWatchErrorPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<FilesystemWatchErrorPayload>(
      'filesystem/watch_error',
      (event) => onError(event.payload),
    )
    return () => {
      unlisten()
    }
  },
  async subscribeDaemonSearchEvents(handlers: {
    onChunk: (payload: DaemonSearchChunkPayload) => void
    onBackpressure: (payload: DaemonSearchBackpressurePayload) => void
    onDone: (payload: DaemonSearchDonePayload) => void
    onCancelled: (payload: DaemonSearchCancelledPayload) => void
  }): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlistenChunk = await eventApi.listen<DaemonSearchChunkPayload>(
      'daemon/search_chunk',
      (event) => handlers.onChunk(event.payload),
    )
    const unlistenBackpressure = await eventApi.listen<DaemonSearchBackpressurePayload>(
      'daemon/search_backpressure',
      (event) => handlers.onBackpressure(event.payload),
    )
    const unlistenDone = await eventApi.listen<DaemonSearchDonePayload>(
      'daemon/search_done',
      (event) => handlers.onDone(event.payload),
    )
    const unlistenCancelled = await eventApi.listen<DaemonSearchCancelledPayload>(
      'daemon/search_cancelled',
      (event) => handlers.onCancelled(event.payload),
    )

    return () => {
      unlistenChunk()
      unlistenBackpressure()
      unlistenDone()
      unlistenCancelled()
    }
  },
  async subscribeSettingsUpdated(
    onUpdated: (payload: SettingsUpdatedPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<SettingsUpdatedPayload>('settings/updated', (event) =>
      onUpdated(event.payload),
    )
    return () => {
      unlisten()
    }
  },
  async subscribeGitUpdated(onUpdated: (payload: GitUpdatedPayload) => void): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<GitUpdatedPayload>('git/updated', (event) =>
      onUpdated(event.payload),
    )
    return () => {
      unlisten()
    }
  },
}
