
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

export interface DesktopAppInfoResponse {
  name: string
  version: string
  identifier: string
  tauriVersion: string
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

export interface GitDiffExpansionResponse {
  workspaceId: string
  path: string
  oldPath: string | null
  isBinary: boolean
  oldExists: boolean
  newExists: boolean
  fullDiff: GitDiffStructuredResponse | null
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

export interface TerminalSessionProcessInfo {
  pid: number
  parentPid: number | null
  executable: string
  args: string
  depth: number
}

export interface TerminalDescribeProcessesResponse {
  sessionId: string
  rootPid: number | null
  currentProcess: TerminalSessionProcessInfo | null
  processes: TerminalSessionProcessInfo[]
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

export interface TerminalDebugHumanEntry {
  atMs: number
  text: string
}

export interface TerminalReportRenderedScreenResponse {
  sessionId: string
  screenRevision: number
  accepted: boolean
  humanText: string | null
  humanEntries: TerminalDebugHumanEntry[]
  humanEventCount: number
}

export interface TerminalDebugClearHumanLogResponse {
  sessionId: string
  cleared: boolean
}

export interface TerminalDebugAppendFrontendFocusLogResponse {
  stationId: string
  sessionId: string | null
  kind: string
  accepted: boolean
  logPath: string
}

export interface SurfaceDetachedStationPayload {
  stationId: string
  name: string
  role: string
  tool: string
  agentWorkdirRel: string
  roleWorkdirRel?: string | null
  workspaceId: string
  sessionId?: string | null
}

export interface SurfaceOpenDetachedWindowRequest {
  workspaceId: string
  containerId: string
  title: string
  activeStationId?: string | null
  layoutMode?: 'auto' | 'focus' | 'custom'
  customLayout?: {
    columns: number
    rows: number
  }
  topmost?: boolean
  stations: SurfaceDetachedStationPayload[]
}

export interface SurfaceWindowStateResponse {
  windowLabel: string
  topmost: boolean
  updated: boolean
}

export interface SurfaceOpenDetachedWindowResponse {
  windowLabel: string
  created: boolean
}

export interface SurfaceWindowClosedPayload {
  windowLabel: string
}

export interface SurfaceWindowUpdatedPayload {
  windowLabel: string
  topmost: boolean
}

export interface StationTerminalRestoreStatePayload {
  content: string
  cols: number
  rows: number
}

export interface DetachedTerminalSurfaceRuntime {
  sessionId: string | null
  unreadCount: number
  stateRaw?: string
  shell?: string | null
  cwdMode?: 'workspace_root' | 'custom'
  resolvedCwd?: string | null
}

export interface DetachedTerminalHydrateRequestMessage {
  kind: 'detached_terminal_hydrate_request'
  workspaceId: string
  containerId: string
}

export interface DetachedTerminalHydrateSnapshotMessage {
  kind: 'detached_terminal_hydrate_snapshot'
  workspaceId: string
  containerId: string
  activeStationId: string | null
  runtimes: Record<string, DetachedTerminalSurfaceRuntime>
  outputs: Record<string, string>
  projectionSeqByStation: Record<string, number>
  restoreStates?: Record<string, StationTerminalRestoreStatePayload>
}

export interface DetachedTerminalEnsureSessionMessage {
  kind: 'detached_terminal_ensure_session'
  workspaceId: string
  containerId: string
  stationId: string
}

export interface DetachedTerminalWriteInputMessage {
  kind: 'detached_terminal_write_input'
  workspaceId: string
  containerId: string
  stationId: string
  sessionId: string | null
  input: string
}

export interface DetachedTerminalWriteWithSubmitMessage {
  kind: 'detached_terminal_write_with_submit'
  workspaceId: string
  containerId: string
  stationId: string
  input: string
}

export interface DetachedTerminalResizeMessage {
  kind: 'detached_terminal_resize'
  workspaceId: string
  containerId: string
  stationId: string
  sessionId: string | null
  cols: number
  rows: number
}

export interface DetachedTerminalActivateStationMessage {
  kind: 'detached_terminal_activate_station'
  workspaceId: string
  containerId: string
  stationId: string
}

export interface DetachedTerminalOutputAppendMessage {
  kind: 'detached_terminal_output_append'
  workspaceId: string
  containerId: string
  stationId: string
  chunk: string
  projectionSeq: number
  unreadDelta?: number
}

export interface DetachedTerminalOutputResetMessage {
  kind: 'detached_terminal_output_reset'
  workspaceId: string
  containerId: string
  stationId: string
  content: string
  projectionSeq: number
}

export interface DetachedTerminalRestoreStateMessage {
  kind: 'detached_terminal_restore_state'
  workspaceId: string
  containerId: string
  stationId: string
  sessionId: string | null
  state: StationTerminalRestoreStatePayload
}

export interface DetachedTerminalRuntimeUpdatedMessage {
  kind: 'detached_terminal_runtime_updated'
  workspaceId: string
  containerId: string
  stationId: string
  runtimePatch: Partial<DetachedTerminalSurfaceRuntime>
  projectionSeq: number
}

export type DetachedTerminalBridgeMessage =
  | DetachedTerminalHydrateRequestMessage
  | DetachedTerminalHydrateSnapshotMessage
  | DetachedTerminalEnsureSessionMessage
  | DetachedTerminalWriteInputMessage
  | DetachedTerminalWriteWithSubmitMessage
  | DetachedTerminalResizeMessage
  | DetachedTerminalActivateStationMessage
  | DetachedTerminalOutputAppendMessage
  | DetachedTerminalOutputResetMessage
  | DetachedTerminalRuntimeUpdatedMessage
  | DetachedTerminalRestoreStateMessage

export interface SurfaceBridgeEventPayload<TPayload = DetachedTerminalBridgeMessage> {
  sourceWindowLabel: string
  targetWindowLabel: string
  payload: TPayload
}

export interface SurfaceBridgePostResponse {
  accepted: boolean
  targetWindowLabel: string
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
export type AiAgentMcpStatus = 'not_installed' | 'installed_sidecar' | 'installed_legacy_node'

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
  mcpStatus: AiAgentMcpStatus
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

export type CodexProviderMode = 'official' | 'preset' | 'custom'

export type GeminiProviderMode = 'official' | 'preset' | 'custom'

export type GeminiAuthMode = 'oauth' | 'api_key'

export interface CodexProviderPreset {
  providerId: string
  name: string
  category: string
  description: string
  websiteUrl: string
  apiKeyUrl: string
  billingUrl: string
  recommendedModel: string
  endpoint?: string | null
  configTemplate: string
  requiresApiKey: boolean
  setupSteps: string[]
}

export interface GeminiProviderPreset {
  providerId: string
  name: string
  category: string
  description: string
  websiteUrl: string
  apiKeyUrl: string
  billingUrl: string
  recommendedModel: string
  endpoint?: string | null
  authMode: GeminiAuthMode
  selectedType: string
  requiresApiKey: boolean
  setupSteps: string[]
  extraEnv?: Record<string, string>
}

export interface CodexConfigSnapshot {
  savedProviderId?: string | null
  activeMode?: CodexProviderMode | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  configToml?: string | null
  secretRef?: string | null
  hasSecret: boolean
  updatedAtMs?: number | null
}

export interface GeminiConfigSnapshot {
  savedProviderId?: string | null
  activeMode?: GeminiProviderMode | null
  authMode?: GeminiAuthMode | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  selectedType?: string | null
  secretRef?: string | null
  hasSecret: boolean
  updatedAtMs?: number | null
}

export interface CodexSavedProviderSnapshot {
  savedProviderId: string
  mode: CodexProviderMode
  providerId?: string | null
  providerName: string
  baseUrl?: string | null
  model?: string | null
  configToml?: string | null
  hasSecret: boolean
  isActive: boolean
  createdAtMs: number
  updatedAtMs: number
  lastAppliedAtMs: number
}

export interface GeminiSavedProviderSnapshot {
  savedProviderId: string
  mode: GeminiProviderMode
  providerId?: string | null
  providerName: string
  baseUrl?: string | null
  model?: string | null
  authMode: GeminiAuthMode
  selectedType: string
  hasSecret: boolean
  isActive: boolean
  createdAtMs: number
  updatedAtMs: number
  lastAppliedAtMs: number
}

export interface CodexSnapshot {
  title: string
  summary: string
  configPath?: string | null
  docsUrl: string
  tips: string[]
  presets: CodexProviderPreset[]
  config: CodexConfigSnapshot
  savedProviders: CodexSavedProviderSnapshot[]
  mcpInstalled: boolean
}

export interface GeminiSnapshot {
  title: string
  summary: string
  configPath?: string | null
  docsUrl: string
  tips: string[]
  presets: GeminiProviderPreset[]
  config: GeminiConfigSnapshot
  savedProviders: GeminiSavedProviderSnapshot[]
  mcpInstalled: boolean
}

export interface AiConfigSnapshot {
  agents: AiAgentSnapshotCard[]
  claude: ClaudeSnapshot
  codex: CodexSnapshot
  gemini: GeminiSnapshot
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

export interface CodexDraftInput {
  mode: CodexProviderMode
  savedProviderId?: string | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  apiKey?: string | null
  configToml?: string | null
}

export interface GeminiDraftInput {
  mode: GeminiProviderMode
  savedProviderId?: string | null
  authMode?: GeminiAuthMode | null
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  apiKey?: string | null
  selectedType?: string | null
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

export interface CodexNormalizedDraft {
  mode: CodexProviderMode
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  configToml?: string | null
  secretRef?: string | null
  hasSecret: boolean
}

export interface GeminiNormalizedDraft {
  mode: GeminiProviderMode
  authMode: GeminiAuthMode
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  selectedType: string
  secretRef?: string | null
  hasSecret: boolean
}

export type AiConfigDraftInput = ClaudeDraftInput | CodexDraftInput | GeminiDraftInput

export type AiConfigNormalizedDraft =
  | { claude: ClaudeNormalizedDraft }
  | { codex: CodexNormalizedDraft }
  | { gemini: GeminiNormalizedDraft }

export type AnyAiConfigNormalizedDraft =
  | ClaudeNormalizedDraft
  | CodexNormalizedDraft
  | GeminiNormalizedDraft

export function unwrapAiConfigNormalizedDraft(
  draft: AiConfigNormalizedDraft,
):
  | { agent: 'claude'; draft: ClaudeNormalizedDraft }
  | { agent: 'codex'; draft: CodexNormalizedDraft }
  | { agent: 'gemini'; draft: GeminiNormalizedDraft } {
  if ('claude' in draft) {
    return { agent: 'claude', draft: draft.claude }
  }
  if ('codex' in draft) {
    return { agent: 'codex', draft: draft.codex }
  }
  return { agent: 'gemini', draft: draft.gemini }
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
  normalizedDraft: AiConfigNormalizedDraft
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

export type AgentRoleScope = 'global' | 'workspace'

export interface AgentRole {
  id: string
  workspaceId: string
  roleKey: string
  roleName: string
  departmentId: string
  scope: AgentRoleScope
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
  promptFileName?: string | null
  promptFileRelativePath?: string | null
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
  promptFileName?: string | null
  promptContent?: string | null
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
  promptFileName?: string | null
  promptContent?: string | null
}

export interface AgentUpdateResponse {
  agent: AgentProfile
}

export interface AgentDeleteRequest {
  workspaceId: string
  agentId: string
  cleanupMode?: 'reject' | 'rebind' | 'disable' | 'delete' | null
  replacementAgentId?: string | null
}

export interface AgentDeleteResponse {
  deleted: boolean
  errorCode?: string | null
  blockingBindings?: ChannelRouteBinding[] | null
  bindingCleanup?: {
    matchedCount: number
    updatedCount: number
    deletedCount: number
    disabledCount: number
    reboundToAgentId?: string | null
  } | null
}

export interface AgentRoleSaveRequest {
  workspaceId: string
  roleId?: string | null
  roleKey?: string | null
  roleName: string
  scope?: AgentRoleScope | null
  status?: 'active' | 'deprecated' | 'disabled' | null
  charterPath?: string | null
  policyJson?: string | null
}

export interface AgentRoleSaveResponse {
  role: AgentRole
}

export interface AgentRoleDeleteRequest {
  workspaceId: string
  roleId: string
  scope?: AgentRoleScope | null
}

export interface AgentRoleDeleteResponse {
  deleted: boolean
}

export interface AgentPromptReadRequest {
  workspaceId: string
  agentId: string
}

export interface AgentPromptReadResponse {
  promptContent: string
  promptFileName?: string | null
  promptFileRelativePath?: string | null
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

export type ToolProfileActionCategory =
  | 'prompt_insert'
  | 'terminal_submit'
  | 'launch_tool'
  | 'open_settings'
  | 'mcp_helper'
  | 'slash_template'

export type ToolProfileSurfaceTarget = 'terminal' | 'workspace_ui' | 'tool_adapter'
export type ToolProfileScopeKind = 'station' | 'workspace' | 'selection'
export type ToolProfileProviderKind = 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown' | 'any'
export type ToolCommandProviderKind = ToolProfileProviderKind
export type ToolCommandKind =
  | 'semantic'
  | 'provider_native'
  | 'bundled_skill'
  | 'settings_entry'
  | 'launch_profile'
export type ToolCommandFamily = 'built_in' | 'bundled_skill' | 'workspace_action'
export type ToolCommandCategory = ToolProfileActionCategory
export type ToolCommandSurfaceTarget = ToolProfileSurfaceTarget
export type ToolCommandScopeKind = ToolProfileScopeKind
export type ToolCommandPresentation = 'direct' | 'sheet' | 'navigation'
export type ToolCommandDangerLevel = 'safe' | 'confirm' | 'expensive'
export type ToolCommandArgumentKind = 'text' | 'multiline_text' | 'enum' | 'duration' | 'path' | 'boolean'

export interface ToolProfileSummary {
  workspaceId?: string | null
  id: string
  profileId?: string | null
  toolKind?: ToolProfileProviderKind | null
  label: string
  shortLabel?: string | null
  tooltip?: string | null
  icon?: string | null
  providerKind?: ToolProfileProviderKind | null
  category?: ToolProfileActionCategory | null
  surfaceTarget?: ToolProfileSurfaceTarget | null
  scopeKind?: ToolProfileScopeKind | null
  priority?: number | null
  group?: 'launch' | 'prompt' | 'templates' | 'submit' | 'workspace' | 'profiles' | null
  requiresLiveSession?: boolean | null
  supportsDetachedWindow?: boolean | null
  supportsParallelTargets?: boolean | null
  title?: string | null
  launchMode?: string | null
  configured?: boolean | null
  providerSummary?: string | null
  provider?: Record<string, unknown> | null
  launchDefaults?: Record<string, unknown> | null
  supports?: Record<string, unknown> | null
  warnings?: string[] | null
}

export interface ToolListProfilesResponse {
  workspaceId: string
  profiles: ToolProfileSummary[]
}

export interface ToolLaunchRequest {
  workspaceId: string
  profileId: string
  context?: Record<string, unknown> | null
}

export interface ToolLaunchResponse {
  workspaceId: string
  profileId: string
  toolKind?: ToolProfileProviderKind | null
  context?: Record<string, unknown> | null
  toolSessionId?: string | null
  terminalSessionId?: string | null
  stationId?: string | null
  roleKey?: string | null
  resolvedCwd?: string | null
  shell?: string | null
  submitSequence?: string | null
  launchCommand?: string | null
  initialPrompt?: string | null
}

export interface ToolValidateProfileResponse {
  profile: Record<string, unknown>
  valid: boolean
  profileId?: string | null
  toolKind?: ToolProfileProviderKind | null
  warnings: string[]
}

export interface ToolCommandArgumentOption {
  label: string
  value: string
}

export interface ToolCommandArgument {
  name: string
  label: string
  kind: ToolCommandArgumentKind
  placeholder?: string | null
  defaultValue?: string | null
  options: ToolCommandArgumentOption[]
  required: boolean
}

export type ToolCommandExecution =
  | {
      type: 'insert_text'
      text: string
      submit: boolean
    }
  | {
      type: 'open_command_sheet'
      command: string
      submit: boolean
    }
  | {
      type: 'launch_profile'
      profileId: string
    }
  | {
      type: 'open_settings_modal'
      section: string
    }
  | {
      type: 'open_channel_studio'
    }

export interface ToolCommandCatalogStationContext {
  stationId?: string | null
  hasTerminalSession: boolean
  detachedReadonly: boolean
  resolvedCwd?: string | null
}

export interface ToolCommandSummary {
  id: string
  label: string
  shortLabel?: string | null
  slashCommand?: string | null
  commandFamily: ToolCommandFamily
  tooltip?: string | null
  icon: string
  providerKind: ToolCommandProviderKind
  kind: ToolCommandKind
  category: ToolCommandCategory
  surfaceTarget: ToolCommandSurfaceTarget
  scopeKind: ToolCommandScopeKind
  group: string
  priority: number
  presentation: ToolCommandPresentation
  dangerLevel: ToolCommandDangerLevel
  defaultPinned: boolean
  enabled: boolean
  disabledReason?: string | null
  requiresLiveSession: boolean
  supportsDetachedWindow: boolean
  supportsParallelTargets: boolean
  execution: ToolCommandExecution
  arguments: ToolCommandArgument[]
}

export interface ToolListCommandsRequest {
  workspaceId: string
  toolKind?: ToolProfileProviderKind | null
  station: ToolCommandCatalogStationContext
}

export interface ToolListCommandsResponse {
  workspaceId: string
  catalogVersion: number
  toolKind?: ToolProfileProviderKind | null
  station: ToolCommandCatalogStationContext
  commands: ToolCommandSummary[]
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
  enabled?: boolean
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
  baseUrl?: string | null
  webhookPath?: string | null
  webhookHost?: string | null
  webhookPort?: number | null
  botTokenRef?: string | null
  tokenRef?: string | null
  webhookSecretRef?: string | null
  appId?: string | null
  appSecretRef?: string | null
  verificationTokenRef?: string | null
  hasBotToken?: boolean
  hasToken?: boolean
  hasWebhookSecret?: boolean
  hasAppSecret?: boolean
  hasVerificationToken?: boolean
  updatedAtMs: number
  lastBoundAtMs?: number | null
  lastSyncAtMs?: number | null
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
    baseUrl?: string | null
    botUsername?: string | null
    botName?: string | null
    botDisplayName?: string | null
    botOpenId?: string | null
    runtimeConnected?: boolean | null
    lastSyncAtMs?: number | null
    configuredWebhookUrl?: string | null
    runtimeWebhookUrl?: string | null
    webhookMatched?: boolean | null
    checkedAtMs: number
  }
}

export interface WechatAuthSession {
  authSessionId: string
  accountId: string
  status: string
  checkedAtMs: number
  qrCodeId?: string | null
  qrCodeSvgDataUrl?: string | null
  expiresAtMs?: number | null
  detail?: string | null
  boundAccountId?: string | null
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
  resolvedTargets?: string[] | null
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
  async appGetInfo(): Promise<DesktopAppInfoResponse | null> {
    if (!isTauriRuntime()) {
      return null
    }
    try {
      const appApi = await import('@tauri-apps/api/app')
      const [name, version, identifier, tauriVersion] = await Promise.all([
        appApi.getName(),
        appApi.getVersion(),
        appApi.getIdentifier(),
        appApi.getTauriVersion(),
      ])
      return {
        name,
        version,
        identifier,
        tauriVersion,
      }
    } catch {
      return null
    }
  },
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
  gitDiffFile(workspaceId: string, path: string, staged?: boolean) {
    return invokeCommand<GitDiffResponse>('git_diff_file', { workspaceId, path, staged: staged ?? false })
  },
  /** High-performance structured diff with parsed hunks */
  gitDiffFileStructured(workspaceId: string, path: string, staged?: boolean) {
    return invokeCommand<GitDiffStructuredResponse>('git_diff_file_structured', {
      workspaceId,
      path,
      staged: staged ?? false,
    })
  },
  gitDiffFileExpansion(workspaceId: string, path: string, oldPath?: string | null, staged?: boolean) {
    return invokeCommand<GitDiffExpansionResponse>('git_diff_file_expansion', {
      workspaceId,
      path,
      oldPath: oldPath ?? null,
      staged: staged ?? false,
    })
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
  toolListProfiles(workspaceId: string) {
    return invokeCommand<ToolListProfilesResponse>('tool_list_profiles', { workspaceId })
  },
  toolListCommands(request: ToolListCommandsRequest) {
    return invokeCommand<ToolListCommandsResponse>('tool_list_commands', {
      request: {
        workspaceId: request.workspaceId,
        toolKind: request.toolKind ?? null,
        station: {
          stationId: request.station.stationId ?? null,
          hasTerminalSession: request.station.hasTerminalSession,
          detachedReadonly: request.station.detachedReadonly,
          resolvedCwd: request.station.resolvedCwd ?? null,
        },
      },
    })
  },
  toolLaunch(request: ToolLaunchRequest) {
    return invokeCommand<ToolLaunchResponse>('tool_launch', {
      workspaceId: request.workspaceId,
      profileId: request.profileId,
      context: request.context ?? null,
    })
  },
  toolValidateProfile(profile: Record<string, unknown>) {
    return invokeCommand<ToolValidateProfileResponse>('tool_validate_profile', { profile })
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
      injectProviderEnv?: boolean
    },
  ) {
    return invokeCommand<TerminalCreateResponse>('terminal_create', {
      workspaceId,
      shell: options?.shell ?? null,
      cwd: options?.cwd ?? null,
      cwdMode: options?.cwdMode ?? 'workspace_root',
      env: options?.env ?? null,
      agentToolKind: options?.agentToolKind ?? null,
      injectProviderEnv: options?.injectProviderEnv ?? null,
    })
  },
  aiConfigReadSnapshot(workspaceId?: string | null, allow?: string | null) {
    return invokeCommand<AiConfigReadSnapshotResponse>('ai_config_read_snapshot', {
      workspaceId: workspaceId ?? null,
      allow: allow ?? null,
    })
  },
  aiConfigPreviewPatch(
    workspaceId: string | null | undefined,
    agent: AiConfigAgent,
    scope: 'global',
    draft: AiConfigDraftInput,
  ) {
    return invokeCommand<AiConfigPreviewResponse>('ai_config_preview_patch', {
      workspaceId: workspaceId ?? null,
      agent,
      scope,
      draft,
    })
  },
  aiConfigApplyPatch(workspaceId: string | null | undefined, previewId: string, confirmedBy: string) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_apply_patch', {
      workspaceId: workspaceId ?? null,
      previewId,
      confirmedBy,
    })
  },
  aiConfigSwitchSavedProvider(
    workspaceId: string | null | undefined,
    agent: AiConfigAgent,
    savedProviderId: string,
    confirmedBy: string,
  ) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_switch_saved_provider', {
      workspaceId: workspaceId ?? null,
      agent,
      savedProviderId,
      confirmedBy,
    })
  },
  aiConfigDeleteSavedProvider(
    workspaceId: string | null | undefined,
    agent: AiConfigAgent,
    savedProviderId: string,
    confirmedBy: string,
  ) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_delete_saved_provider', {
      workspaceId: workspaceId ?? null,
      agent,
      savedProviderId,
      confirmedBy,
    })
  },
  agentInstallStatus(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<AgentInstallStatus>('agent_install_status', { agent })
  },
  agentMcpInstallStatus(agent: 'ClaudeCode' | 'Codex' | 'Gemini', workspaceId?: string) {
    return invokeCommand<AiAgentMcpStatus>('agent_mcp_install_status', { agent, workspaceId })
  },
  installAgent(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<void>('install_agent', { agent })
  },
  uninstallAgent(agent: 'ClaudeCode' | 'Codex' | 'Gemini') {
    return invokeCommand<void>('uninstall_agent', { agent })
  },
  installAgentMcp(agent: 'ClaudeCode' | 'Codex' | 'Gemini', workspaceId: string) {
    return invokeCommand<void>('install_agent_mcp', { agent, workspaceId })
  },
  uninstallAgentMcp(agent: 'ClaudeCode' | 'Codex' | 'Gemini', workspaceId: string) {
    return invokeCommand<void>('uninstall_agent_mcp', { agent, workspaceId })
  },
  surfaceOpenDetachedWindow(payload: SurfaceOpenDetachedWindowRequest) {
    return invokeCommand<SurfaceOpenDetachedWindowResponse>('surface_open_detached_window', {
      payload,
    })
  },
  surfaceCloseWindow(windowLabel?: string | null) {
    return invokeCommand<{ closed: boolean; windowLabel: string }>('surface_close_window', {
      windowLabel: windowLabel ?? null,
    })
  },
  surfaceSetWindowTopmost(windowLabel: string | null, topmost: boolean) {
    return invokeCommand<SurfaceWindowStateResponse>('surface_set_window_topmost', {
      windowLabel,
      topmost,
    })
  },
  surfaceStartWindowDragging(windowLabel?: string | null) {
    return invokeCommand<{ started: boolean; windowLabel: string }>('surface_start_window_dragging', {
      windowLabel: windowLabel ?? null,
    })
  },
  surfaceBridgePost(targetWindowLabel: string, payload: DetachedTerminalBridgeMessage) {
    return invokeCommand<SurfaceBridgePostResponse>('surface_bridge_post', {
      targetWindowLabel,
      payload,
    })
  },
  terminalWrite(sessionId: string, input: string) {
    return invokeCommand<{ sessionId: string; accepted: boolean }>('terminal_write', {
      sessionId,
      input,
    })
  },
  terminalWriteWithSubmit(sessionId: string, input: string, submitSequence?: string | null) {
    return invokeCommand<{ sessionId: string; accepted: boolean }>('terminal_write_with_submit', {
      sessionId,
      input,
      submitSequence: submitSequence ?? null,
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
  terminalDescribeProcesses(sessionId: string) {
    return invokeCommand<TerminalDescribeProcessesResponse>('terminal_describe_processes', {
      sessionId,
    })
  },
  terminalReportRenderedScreen(snapshot: RenderedScreenSnapshot, toolKind?: string | null) {
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
      toolKind: toolKind ?? null,
    })
  },
  terminalDebugClearHumanLog(sessionId: string) {
    return invokeCommand<TerminalDebugClearHumanLogResponse>('terminal_debug_clear_human_log', {
      sessionId,
    })
  },
  terminalDebugAppendFrontendFocusLog(entry: {
    atMs: number
    stationId: string
    sessionId?: string | null
    kind: string
    detail?: string | null
  }) {
    return invokeCommand<TerminalDebugAppendFrontendFocusLogResponse>(
      'terminal_debug_append_frontend_focus_log',
      {
        entry: {
          atMs: entry.atMs,
          stationId: entry.stationId,
          sessionId: entry.sessionId ?? null,
          kind: entry.kind,
          detail: entry.detail ?? null,
        },
      },
    )
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
  channelConnectorWechatAuthStart(accountId?: string | null) {
    return invokeCommand<{ channel: string; session: WechatAuthSession }>(
      'channel_connector_wechat_auth_start',
      {
        request: {
          accountId: accountId ?? null,
        },
      },
    )
  },
  channelConnectorWechatAuthStatus(authSessionId: string) {
    return invokeCommand<{ channel: string; session: WechatAuthSession }>(
      'channel_connector_wechat_auth_status',
      {
        request: {
          authSessionId,
        },
      },
    )
  },
  channelConnectorWechatAuthCancel(authSessionId: string) {
    return invokeCommand<{ channel: string; session: WechatAuthSession }>(
      'channel_connector_wechat_auth_cancel',
      {
        request: {
          authSessionId,
        },
      },
    )
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
        enabled: binding.enabled ?? true,
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
  agentRoleSave(request: AgentRoleSaveRequest) {
    return invokeCommand<AgentRoleSaveResponse>('agent_role_save', {
      request: {
        workspaceId: request.workspaceId,
        roleId: request.roleId ?? null,
        roleKey: request.roleKey ?? null,
        roleName: request.roleName,
        scope: request.scope ?? null,
        status: request.status ?? null,
        charterPath: request.charterPath ?? null,
        policyJson: request.policyJson ?? null,
      },
    })
  },
  agentRoleDelete(request: AgentRoleDeleteRequest) {
    return invokeCommand<AgentRoleDeleteResponse>('agent_role_delete', {
      request: {
        workspaceId: request.workspaceId,
        roleId: request.roleId,
        scope: request.scope ?? null,
      },
    })
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
        promptFileName: request.promptFileName ?? null,
        promptContent: request.promptContent ?? null,
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
        promptFileName: request.promptFileName ?? null,
        promptContent: request.promptContent ?? null,
      },
    })
  },
  agentDelete(request: AgentDeleteRequest) {
    return invokeCommand<AgentDeleteResponse>('agent_delete', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        cleanupMode: request.cleanupMode ?? null,
        replacementAgentId: request.replacementAgentId ?? null,
      },
    })
  },
  agentPromptRead(request: AgentPromptReadRequest) {
    return invokeCommand<AgentPromptReadResponse>('agent_prompt_read', {
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
  async subscribeSurfaceEvents(handlers: {
    onWindowClosed?: (payload: SurfaceWindowClosedPayload) => void
    onWindowUpdated?: (payload: SurfaceWindowUpdatedPayload) => void
    onBridge?: (payload: SurfaceBridgeEventPayload) => void
  }): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const webviewWindowApi = await import('@tauri-apps/api/webviewWindow')
    const currentWebviewWindow = webviewWindowApi.getCurrentWebviewWindow()
    const unlistenClosed = await eventApi.listen<SurfaceWindowClosedPayload>(
      'surface/window_closed',
      (event: { payload: SurfaceWindowClosedPayload }) => handlers.onWindowClosed?.(event.payload),
    )
    const unlistenUpdated = await eventApi.listen<SurfaceWindowUpdatedPayload>(
      'surface/window_updated',
      (event: { payload: SurfaceWindowUpdatedPayload }) => handlers.onWindowUpdated?.(event.payload),
    )
    const unlistenBridge = await currentWebviewWindow.listen<SurfaceBridgeEventPayload>(
      'surface/bridge',
      (event: { payload: SurfaceBridgeEventPayload }) => handlers.onBridge?.(event.payload),
    )
    return () => {
      unlistenClosed()
      unlistenUpdated()
      unlistenBridge()
    }
  },
}
