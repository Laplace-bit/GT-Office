
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
  currentSeq: number
}

export interface TerminalDeltaResponse {
  sessionId: string
  chunk: string
  afterSeq: number
  fromSeq: number | null
  toSeq: number
  currentSeq: number
  gap: boolean
  truncated: boolean
}

export interface RenderedScreenSnapshotRow {
  rowIndex: number
  text: string
  trimmedText: string
  isBlank: boolean
}

export interface RenderedScreenSnapshot {
  sessionId: string
  screenRevision: number
  capturedAtMs: number
  viewportTop: number
  viewportHeight: number
  baseY: number
  cursorRow?: number | null
  cursorCol?: number | null
  rows: RenderedScreenSnapshotRow[]
}

export interface TerminalReportRenderedScreenResponse {
  sessionId: string
  screenRevision: number
  accepted: boolean
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

export interface FsCreateDirResponse {
  workspaceId: string
  path: string
  created: boolean
}

export interface FsCopyResponse {
  workspaceId: string
  copied: boolean
}

export interface FsShowInFolderResponse {
  workspaceId: string
  revealed: boolean
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

export type AiConfigAgent = 'claude' | 'codex' | 'gemini'

export type ClaudeProviderMode = 'official' | 'preset' | 'custom'

export type ClaudeAuthScheme = 'anthropic_api_key' | 'anthropic_auth_token'

export type AiAgentConfigStatus = 'unconfigured' | 'configured' | 'guidance_only'

export interface AiAgentInstallStatus {
  installed: boolean
  executable?: string | null
  requiresNode: boolean
  nodeReady: boolean
  npmReady: boolean
  installAvailable: boolean
  uninstallAvailable: boolean
  detectedBy: string[]
  issues: string[]
}

export interface AiAgentSnapshotCard {
  agent: AiConfigAgent
  title: string
  subtitle: string
  installStatus: AiAgentInstallStatus
  mcpInstalled: boolean
  configStatus: AiAgentConfigStatus
  activeSummary?: string | null
}

export interface ClaudeProviderPreset {
  providerId: string
  name: string
  category: string
  description: string
  websiteUrl: string
  apiKeyUrl: string
  billingUrl: string
  recommendedModel: string
  endpoint: string
  authScheme: ClaudeAuthScheme
  whyChoose: string
  bestFor: string
  requiresBilling: boolean
  setupSteps: string[]
}

export interface ClaudeConfigSnapshot {
  savedProviderId?: string | null
  activeMode?: ClaudeProviderMode | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  authScheme?: ClaudeAuthScheme | null
  secretRef?: string | null
  hasSecret: boolean
  updatedAtMs?: number | null
}

export interface ClaudeSavedProviderSnapshot {
  savedProviderId: string
  mode: ClaudeProviderMode
  providerId?: string | null
  providerName: string
  baseUrl?: string | null
  model?: string | null
  authScheme?: ClaudeAuthScheme | null
  hasSecret: boolean
  isActive: boolean
  createdAtMs: number
  updatedAtMs: number
  lastAppliedAtMs: number
}

export interface ClaudeSnapshot {
  presets: ClaudeProviderPreset[]
  config: ClaudeConfigSnapshot
  savedProviders: ClaudeSavedProviderSnapshot[]
  canApplyOfficialMode: boolean
}

export interface LightAgentConfigSnapshot {
  hasSecret: boolean
  secretRef: string | null
  updatedAtMs: number | null
}

export interface LightAgentGuide {
  title: string
  summary: string
  configPath?: string | null
  docsUrl: string
  tips: string[]
  config: LightAgentConfigSnapshot
  mcpInstalled: boolean
}

export interface AiConfigSnapshot {
  agents: AiAgentSnapshotCard[]
  claude: ClaudeSnapshot
  codex: LightAgentGuide
  gemini: LightAgentGuide
}

export interface AiConfigReadSnapshotResponse {
  workspaceId: string
  allow: string
  snapshot: AiConfigSnapshot
  masking: string[]
}

export interface ClaudeDraftInput {
  mode: ClaudeProviderMode
  savedProviderId?: string | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  authScheme?: ClaudeAuthScheme | null
  apiKey?: string | null
}

export interface LightAgentDraftInput {
  apiKey?: string | null
}

export interface ClaudeNormalizedDraft {
  mode: ClaudeProviderMode
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  authScheme?: ClaudeAuthScheme | null
  secretRef?: string | null
  hasSecret: boolean
}

export interface AiConfigMaskedChange {
  key: string
  label: string
  before?: string | null
  after?: string | null
  secret: boolean
}

export interface AiConfigPreviewResponse {
  workspaceId: string
  scope: string
  agent: AiConfigAgent
  previewId: string
  allowed: boolean
  normalizedDraft: ClaudeNormalizedDraft
  maskedDiff: AiConfigMaskedChange[]
  changedKeys: string[]
  secretRefs: string[]
  warnings: string[]
}

export interface AiConfigApplyResponse {
  workspaceId: string
  previewId: string
  confirmedBy: string
  applied: boolean
  auditId: string
  effective: AiConfigSnapshot
  changedTargets: string[]
}

export interface AgentInstallStatus {
  installed: boolean
  executable?: string | null
  requiresNode: boolean
  nodeReady: boolean
}

export interface GitUpdatedPayload {
  workspaceId: string
  available: boolean
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  files: GitStatusFile[]
  revision: number
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
  tool: string
  workdir?: string | null
  customWorkdir: boolean
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
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: AgentState
}

export interface AgentCreateResponse {
  agent: AgentProfile
}

export interface AgentUpdateRequest {
  workspaceId: string
  agentId: string
  name: string
  roleId: string
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: AgentState
}

export interface AgentUpdateResponse {
  agent: AgentProfile
}

export interface AgentDeleteRequest {
  workspaceId: string
  agentId: string
}

export interface AgentDeleteResponse {
  deleted: boolean
}

export interface AgentRuntimeRegisterRequest {
  workspaceId: string
  agentId: string
  stationId: string
  roleKey?: string | null
  sessionId: string
  toolKind?: 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown'
  resolvedCwd?: string | null
  submitSequence?: string | null
  online?: boolean
}

export interface AgentRuntimeRegisterResponse {
  workspaceId: string
  agentId: string
  stationId: string
  roleKey?: string | null
  sessionId: string
  toolKind?: 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown'
  resolvedCwd?: string | null
  submitSequence?: string | null
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

export type ExternalPeerKind = 'direct' | 'group'
export type ExternalAccessPolicyMode = 'pairing' | 'allowlist' | 'open' | 'disabled'
export type ExternalInboundStatus =
  | 'dispatched'
  | 'duplicate'
  | 'pairing_required'
  | 'denied'
  | 'route_not_found'
  | 'failed'

export interface ChannelRouteBinding {
  workspaceId: string
  channel: string
  accountId?: string | null
  peerKind?: ExternalPeerKind | null
  peerPattern?: string | null
  targetAgentId: string
  priority?: number
  createdAtMs?: number | null
  botName?: string | null
}

export interface ChannelAdapterStatusResponse {
  running: boolean
  adapters: Array<{
    id: string
    mode: string
    enabled: boolean
    accounts?: ChannelConnectorAccount[]
  }>
  runtime?: {
    running: boolean
    host: string
    port: number
    baseUrl: string
    feishuWebhook: string
    telegramWebhook: string
    startedAtMs: number
    metrics?: {
      totalRequests: number
      webhookRequests: number
      healthRequests: number
      dispatched: number
      duplicate: number
      pairingRequired: number
      denied: number
      routeNotFound: number
      failed: number
      unauthorized: number
      invalidRequests: number
      rateLimited: number
      timeouts: number
      internalErrors: number
      rateLimitTrackedKeys: number
      lastError?: string | null
      lastErrorAtMs?: number | null
    } | null
  } | null
  snapshot: Record<string, unknown>
}

export interface ChannelConnectorAccount {
  channel: string
  accountId: string
  enabled: boolean
  mode: string
  connectionMode?: string | null
  domain?: string | null
  webhookPath?: string | null
  webhookHost?: string | null
  webhookPort?: number | null
  botTokenRef?: string | null
  webhookSecretRef?: string | null
  appId?: string | null
  appSecretRef?: string | null
  verificationTokenRef?: string | null
  hasBotToken?: boolean
  hasWebhookSecret?: boolean
  hasAppSecret?: boolean
  hasVerificationToken?: boolean
  updatedAtMs: number
}

export interface ChannelConnectorAccountUpsertRequest {
  channel: string
  accountId?: string | null
  enabled?: boolean | null
  mode?: 'webhook' | 'polling' | 'websocket' | string | null
  connectionMode?: 'webhook' | 'websocket' | string | null
  botToken?: string | null
  botTokenRef?: string | null
  webhookSecret?: string | null
  webhookSecretRef?: string | null
  webhookPath?: string | null
  domain?: 'feishu' | 'lark' | string | null
  appId?: string | null
  appSecret?: string | null
  appSecretRef?: string | null
  verificationToken?: string | null
  verificationTokenRef?: string | null
  webhookHost?: string | null
  webhookPort?: number | null
}

export interface ChannelConnectorAccountListResponse {
  channel: string
  accounts: ChannelConnectorAccount[]
}

export interface ChannelConnectorHealthResponse {
  channel: string
  health: {
    channel: string
    accountId: string
    ok: boolean
    status: string
    detail: string
    mode: string
    connectionMode?: string | null
    domain?: string | null
    botUsername?: string | null
    botName?: string | null
    botOpenId?: string | null
    runtimeConnected?: boolean | null
    configuredWebhookUrl?: string | null
    runtimeWebhookUrl?: string | null
    webhookMatched?: boolean | null
    checkedAtMs: number
  }
}

export interface ChannelConnectorWebhookSyncResponse {
  channel: string
  result: {
    channel: string
    accountId: string
    ok: boolean
    webhookUrl: string
    webhookMatched: boolean
    detail: string
    checkedAtMs: number
  }
}

export interface ChannelBindingListResponse {
  bindings: ChannelRouteBinding[]
}

export interface ChannelAccessApproveResponse {
  approved: boolean
  channel: string
  accountId: string
  identity: string
}

export interface ChannelAccessListResponse {
  channel: string
  accountId?: string | null
  entries: Array<{
    channel: string
    accountId: string
    identity: string
    approved: boolean
  }>
}

export interface ChannelExternalInboundRequest {
  message: {
    channel: string
    accountId?: string
    peerKind: ExternalPeerKind
    peerId: string
    senderId: string
    senderName?: string | null
    messageId: string
    text: string
    idempotencyKey?: string | null
    workspaceIdHint?: string | null
    targetAgentIdHint?: string | null
    metadata?: Record<string, unknown>
  }
}

export interface ChannelExternalInboundResponse {
  traceId: string
  status: ExternalInboundStatus
  idempotentHit: boolean
  workspaceId?: string | null
  targetAgentId?: string | null
  taskId?: string | null
  pairingCode?: string | null
  detail?: string | null
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

export interface ChannelListMessagesResponse {
  messages: ChannelMessagePayload[]
}

export interface ChannelAckPayload {
  workspaceId: string
  messageId: string
  targetAgentId: string
  status: 'delivered' | 'failed' | 'ack'
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

export interface ExternalChannelInboundPayload {
  traceId: string
  channel: string
  accountId: string
  peerKind: ExternalPeerKind
  peerId: string
  senderId: string
  senderName?: string | null
  messageId: string
  text?: string | null
}

export interface ExternalChannelRoutedPayload {
  traceId: string
  workspaceId: string
  targetAgentId: string
  matchedBy: string
}

export interface ExternalChannelDispatchProgressPayload {
  traceId: string
  workspaceId: string
  targetAgentId: string
  taskId: string
  status: 'sending' | 'sent' | 'failed'
  detail?: string | null
  title?: string | null
  contentPreview?: string | null
}

export interface ExternalChannelReplyPayload {
  workspaceId: string
  messageId: string
  targetAgentId: string
  status: 'delivered' | 'failed'
  reason?: string | null
}

export interface ExternalChannelOutboundResultPayload {
  traceId?: string | null
  workspaceId: string
  messageId: string
  targetAgentId: string
  channel?: string | null
  status: 'delivered' | 'failed'
  detail?: string | null
  tsMs: number
  relayMode?: string | null
  confidence?: string | null
  textPreview?: string | null
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
  systemGtoDoctor() {
    return invokeCommand<Record<string, unknown>>('system_gto_doctor')
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
  fsCreateDir(workspaceId: string, path: string) {
    return invokeCommand<FsCreateDirResponse>('fs_create_dir', { workspaceId, path })
  },
  fsCopy(workspaceId: string, fromPath: string, toPath: string) {
    return invokeCommand<FsCopyResponse>('fs_copy', { workspaceId, fromPath, toPath })
  },
  fsShowInFolder(workspaceId: string, path: string) {
    return invokeCommand<FsShowInFolderResponse>('fs_show_in_folder', { workspaceId, path })
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
      env?: Record<string, string>
      agentToolKind?: 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown'
    },
  ) {
    return invokeCommand<TerminalCreateResponse>('terminal_create', {
      workspaceId,
      shell: options?.shell ?? null,
      cwd: options?.cwd ?? null,
      cwdMode: options?.cwdMode ?? 'workspace_root',
      env: options?.env ?? null,
      agentToolKind: options?.agentToolKind ?? null,
    })
  },
  aiConfigReadSnapshot(workspaceId: string, allow?: string | null) {
    return invokeCommand<AiConfigReadSnapshotResponse>('ai_config_read_snapshot', {
      workspaceId,
      allow: allow ?? null,
    })
  },
  aiConfigPreviewPatch(
    workspaceId: string,
    agent: AiConfigAgent,
    scope: 'workspace',
    draft: ClaudeDraftInput | LightAgentDraftInput,
  ) {
    return invokeCommand<AiConfigPreviewResponse>('ai_config_preview_patch', {
      workspaceId,
      agent,
      scope,
      draft,
    })
  },
  aiConfigApplyPatch(workspaceId: string, previewId: string, confirmedBy: string) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_apply_patch', {
      workspaceId,
      previewId,
      confirmedBy,
    })
  },
  aiConfigSwitchSavedClaudeProvider(workspaceId: string, savedProviderId: string, confirmedBy: string) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_switch_saved_claude_provider', {
      workspaceId,
      savedProviderId,
      confirmedBy,
    })
  },
  agentInstallStatus(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<AgentInstallStatus>('agent_install_status', { agent })
  },
  agentMcpInstallStatus(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<boolean>('agent_mcp_install_status', { agent })
  },
  installAgent(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<void>('install_agent', { agent })
  },
  uninstallAgent(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<void>('uninstall_agent', { agent })
  },
  installAgentMcp(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<void>('install_agent_mcp', { agent })
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
  terminalReadDelta(sessionId: string, afterSeq: number, maxBytes?: number) {
    return invokeCommand<TerminalDeltaResponse>('terminal_read_delta', {
      sessionId,
      afterSeq,
      maxBytes: maxBytes ?? null,
    })
  },
  terminalReportRenderedScreen(snapshot: RenderedScreenSnapshot) {
    return invokeCommand<TerminalReportRenderedScreenResponse>('terminal_report_rendered_screen', {
      snapshot: {
        sessionId: snapshot.sessionId,
        screenRevision: snapshot.screenRevision,
        capturedAtMs: snapshot.capturedAtMs,
        viewportTop: snapshot.viewportTop,
        viewportHeight: snapshot.viewportHeight,
        baseY: snapshot.baseY,
        cursorRow: snapshot.cursorRow ?? null,
        cursorCol: snapshot.cursorCol ?? null,
        rows: snapshot.rows.map((row) => ({
          rowIndex: row.rowIndex,
          text: row.text,
          trimmedText: row.trimmedText,
          isBlank: row.isBlank,
        })),
      },
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
  channelListMessages(request: {
    workspaceId: string
    targetAgentId?: string | null
    senderAgentId?: string | null
    taskId?: string | null
    limit?: number
  }) {
    return invokeCommand<ChannelListMessagesResponse>('channel_list_messages', {
      request: {
        workspaceId: request.workspaceId,
        targetAgentId: request.targetAgentId ?? null,
        senderAgentId: request.senderAgentId ?? null,
        taskId: request.taskId ?? null,
        limit: request.limit ?? 20,
      },
    })
  },
  channelAdapterStatus() {
    return invokeCommand<ChannelAdapterStatusResponse>('channel_adapter_status')
  },
  channelConnectorAccountUpsert(request: ChannelConnectorAccountUpsertRequest) {
    return invokeCommand<Record<string, unknown>>('channel_connector_account_upsert', {
      request: {
        channel: request.channel,
        accountId: request.accountId ?? null,
        enabled: request.enabled ?? null,
        mode: request.mode ?? null,
        connectionMode: request.connectionMode ?? null,
        botToken: request.botToken ?? null,
        botTokenRef: request.botTokenRef ?? null,
        webhookSecret: request.webhookSecret ?? null,
        webhookSecretRef: request.webhookSecretRef ?? null,
        webhookPath: request.webhookPath ?? null,
        domain: request.domain ?? null,
        appId: request.appId ?? null,
        appSecret: request.appSecret ?? null,
        appSecretRef: request.appSecretRef ?? null,
        verificationToken: request.verificationToken ?? null,
        verificationTokenRef: request.verificationTokenRef ?? null,
        webhookHost: request.webhookHost ?? null,
        webhookPort: request.webhookPort ?? null,
      },
    })
  },
  channelConnectorAccountList(channel: string) {
    return invokeCommand<ChannelConnectorAccountListResponse>('channel_connector_account_list', {
      request: {
        channel,
      },
    })
  },
  channelConnectorHealth(channel: string, accountId?: string | null) {
    return invokeCommand<ChannelConnectorHealthResponse>('channel_connector_health', {
      request: {
        channel,
        accountId: accountId ?? null,
      },
    })
  },
  channelConnectorWebhookSync(
    channel: string,
    accountId?: string | null,
    webhookUrl?: string | null,
  ) {
    return invokeCommand<ChannelConnectorWebhookSyncResponse>('channel_connector_webhook_sync', {
      request: {
        channel,
        accountId: accountId ?? null,
        webhookUrl: webhookUrl ?? null,
      },
    })
  },
  channelBindingUpsert(binding: ChannelRouteBinding) {
    return invokeCommand<Record<string, unknown>>('channel_binding_upsert', {
      binding: {
        workspaceId: binding.workspaceId,
        channel: binding.channel,
        accountId: binding.accountId ?? null,
        peerKind: binding.peerKind ?? null,
        peerPattern: binding.peerPattern ?? null,
        targetAgentId: binding.targetAgentId,
        priority: binding.priority ?? 0,
        createdAtMs: binding.createdAtMs ?? null,
        botName: binding.botName ?? null,
      },
    })
  },
  channelBindingList(workspaceId?: string | null) {
    return invokeCommand<ChannelBindingListResponse>('channel_binding_list', {
      request: {
        workspaceId: workspaceId ?? null,
      },
    })
  },
  channelBindingDelete(binding: ChannelRouteBinding) {
    return invokeCommand<Record<string, unknown>>('channel_binding_delete', {
      binding: {
        workspaceId: binding.workspaceId,
        channel: binding.channel,
        accountId: binding.accountId ?? null,
        peerKind: binding.peerKind ?? null,
        peerPattern: binding.peerPattern ?? null,
        targetAgentId: binding.targetAgentId,
        priority: binding.priority ?? 0,
      },
    })
  },
  channelAccessPolicySet(
    channel: string,
    mode: ExternalAccessPolicyMode,
    accountId?: string | null,
  ) {
    return invokeCommand<Record<string, unknown>>('channel_access_policy_set', {
      request: {
        channel,
        accountId: accountId ?? null,
        mode,
      },
    })
  },
  channelAccessApprove(channel: string, identity: string, accountId?: string | null) {
    return invokeCommand<ChannelAccessApproveResponse>('channel_access_approve', {
      request: {
        channel,
        accountId: accountId ?? null,
        identity,
      },
    })
  },
  channelAccessList(channel: string, accountId?: string | null) {
    return invokeCommand<ChannelAccessListResponse>('channel_access_list', {
      request: {
        channel,
        accountId: accountId ?? null,
      },
    })
  },
  channelExternalInbound(request: ChannelExternalInboundRequest) {
    return invokeCommand<ChannelExternalInboundResponse>('channel_external_inbound', {
      request: {
        message: {
          channel: request.message.channel,
          accountId: request.message.accountId ?? 'default',
          peerKind: request.message.peerKind,
          peerId: request.message.peerId,
          senderId: request.message.senderId,
          senderName: request.message.senderName ?? null,
          messageId: request.message.messageId,
          text: request.message.text,
          idempotencyKey: request.message.idempotencyKey ?? null,
          workspaceIdHint: request.message.workspaceIdHint ?? null,
          targetAgentIdHint: request.message.targetAgentIdHint ?? null,
          metadata: request.message.metadata ?? {},
        },
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
        tool: request.tool ?? null,
        workdir: request.workdir ?? null,
        customWorkdir: request.customWorkdir ?? false,
        employeeNo: request.employeeNo ?? null,
        state: request.state ?? null,
      },
    })
  },
  agentUpdate(request: AgentUpdateRequest) {
    return invokeCommand<AgentUpdateResponse>('agent_update', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        name: request.name,
        roleId: request.roleId,
        tool: request.tool ?? null,
        workdir: request.workdir ?? null,
        customWorkdir: request.customWorkdir ?? false,
        employeeNo: request.employeeNo ?? null,
        state: request.state ?? null,
      },
    })
  },
  agentDelete(request: AgentDeleteRequest) {
    return invokeCommand<AgentDeleteResponse>('agent_delete', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
      },
    })
  },
  agentRuntimeRegister(request: AgentRuntimeRegisterRequest) {
    return invokeCommand<AgentRuntimeRegisterResponse>('agent_runtime_register', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        stationId: request.stationId,
        roleKey: request.roleKey ?? null,
        sessionId: request.sessionId,
        toolKind: request.toolKind ?? 'unknown',
        resolvedCwd: request.resolvedCwd ?? null,
        submitSequence: request.submitSequence ?? null,
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
    onExternalInbound?: (payload: ExternalChannelInboundPayload) => void
    onExternalRouted?: (payload: ExternalChannelRoutedPayload) => void
    onExternalDispatchProgress?: (payload: ExternalChannelDispatchProgressPayload) => void
    onExternalReply?: (payload: ExternalChannelReplyPayload) => void
    onExternalOutboundResult?: (payload: ExternalChannelOutboundResultPayload) => void
    onExternalError?: (payload: Record<string, unknown>) => void
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
    const unlistenExternalInbound = await eventApi.listen<ExternalChannelInboundPayload>(
      'external/channel_inbound',
      (event) => handlers.onExternalInbound?.(event.payload),
    )
    const unlistenExternalRouted = await eventApi.listen<ExternalChannelRoutedPayload>(
      'external/channel_routed',
      (event) => handlers.onExternalRouted?.(event.payload),
    )
    const unlistenExternalDispatchProgress =
      await eventApi.listen<ExternalChannelDispatchProgressPayload>(
      'external/channel_dispatch_progress',
      (event) => handlers.onExternalDispatchProgress?.(event.payload),
    )
    const unlistenExternalReply = await eventApi.listen<ExternalChannelReplyPayload>(
      'external/channel_reply',
      (event) => handlers.onExternalReply?.(event.payload),
    )
    const unlistenExternalOutboundResult =
      await eventApi.listen<ExternalChannelOutboundResultPayload>(
      'external/channel_outbound_result',
      (event) => handlers.onExternalOutboundResult?.(event.payload),
    )
    const unlistenExternalError = await eventApi.listen<Record<string, unknown>>(
      'external/channel_error',
      (event) => handlers.onExternalError?.(event.payload),
    )

    return () => {
      unlistenMessage()
      unlistenAck()
      unlistenDispatchProgress()
      unlistenExternalInbound()
      unlistenExternalRouted()
      unlistenExternalDispatchProgress()
      unlistenExternalReply()
      unlistenExternalOutboundResult()
      unlistenExternalError()
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
