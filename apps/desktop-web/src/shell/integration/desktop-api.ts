export interface WorkspaceWindowActiveResponse {
  windowLabel: string
  workspaceId: string | null
}

export interface WorkspaceOpenResponse {
  workspaceId: string
  name: string
  root: string
}

export interface WorkspaceListItem {
  workspaceId: string
  name: string
  root: string
  active: boolean
  windowLabel?: string | null
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceListItem[]
}

// ── Session History ──

export type SessionProvider = 'claude' | 'codex'
export type SessionLifecycle = 'live' | 'stopped' | 'archived'

export interface SessionCard {
  gtoSessionId: string
  workspaceId: string
  agentId: string
  provider: SessionProvider
  lifecycle: SessionLifecycle
  providerSessionId?: string | null
  title: string | null
  cwd: string
  startedAtMs: number
  lastActivityAtMs: number
  filesChanged: number
  insertions: number
  deletions: number
  commitsAhead: number
}

export interface SessionListResponse {
  cards: SessionCard[]
  limit: number
  offset: number
}

export interface SessionDiscoverResponse {
  cards: SessionCard[]
  newCount: number
  updatedCount: number
}

export interface SessionDetailResponse {
  session: {
    gtoSessionId: string
    workspaceId: string
    agentId: string
    stationId: string
    provider: SessionProvider
    providerSessionId: string | null
    providerLogPath: string | null
    terminalSessionId: string | null
    lifecycle: SessionLifecycle
    title: string | null
    cwd: string
    startedAtMs: number
    endedAtMs: number | null
    lastActivityAtMs: number
    createdAtMs: number
    updatedAtMs: number
  } | null
  stats: {
    gtoSessionId: string
    gitStartCommit: string | null
    gitEndCommit: string | null
    filesChanged: number
    insertions: number
    deletions: number
    commitsAhead: number
    updatedAtMs: number
  } | null
}

export type ResumeCheck = 'canResume' | 'logFileMissing' | 'logFileCorrupted' | 'providerMismatch'

export type SessionRelaunchMode = 'resume' | 'continueLast' | 'fork' | 'forkLast'

export interface SessionResumeCheckResponse {
  check: ResumeCheck | 'not_found'
  launchCommand: string | null
  steps: Array<
    | { startCli: { command: string } }
    | { waitMs: { ms: number } }
    | { injectCommand: { command: string } }
    | { injectSubmit: { text: string } }
  >
}

export type SessionActivityKind = 'branchSwitched' | 'newCommits' | 'filesChanged' | 'dirtyChanged'

export interface SessionActivityItem {
  workspaceId: string
  kind: SessionActivityKind
  detail: string
  revision: number
}

export interface SessionActivityEventPayload {
  items: SessionActivityItem[]
}

// ── End Session History ──

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

export interface WorkspaceResetResponse {
  workspaceId: string
  reset: boolean
}

export interface WorkspaceUpdatedPayload {
  workspaceId: string
  kind: string
}

export interface WorkspaceActiveChangedPayload {
  workspaceId: string | null
  previousWorkspaceId: string | null
}

export interface WorkspaceCloseResponse {
  workspaceId: string
  closed: boolean
  activeWorkspaceId: string | null
}

export interface WorkspaceSwitchActiveResponse {
  activeWorkspaceId: string
}

export interface WorkspaceOpenInNewWindowResponse {
  workspaceId: string
  windowLabel: string
  root: string
  created: boolean
}

export interface WorkspaceWindowClosedPayload {
  windowLabel: string
}

export interface DesktopAppInfoResponse {
  name: string
  version: string
  identifier: string
  tauriVersion: string
}

export interface AppUpdateStatusResponse {
  enabled: boolean
  currentVersion: string
  channel: string
  repository: string
  manifestUrl: string
  releasesUrl: string
  unavailableReason?: string | null
}

export interface AppUpdateCheckResponse {
  enabled: boolean
  updateAvailable: boolean
  currentVersion: string
  version?: string | null
  notes?: string | null
  publishedAt?: string | null
  target?: string | null
  repository: string
  manifestUrl: string
  releasePageUrl: string
  unavailableReason?: string | null
  errorCode?: string | null
  errorDetail?: string | null
}

export interface AppUpdateInstallResponse {
  enabled: boolean
  updateAvailable: boolean
  currentVersion: string
  version?: string | null
  repository: string
  manifestUrl: string
  releasePageUrl: string
  unavailableReason?: string | null
  errorCode?: string | null
  errorDetail?: string | null
  started: boolean
}

export interface AppUpdateProgressPayload {
  stage: 'started' | 'progress' | 'verifying' | 'finished' | 'error'
  version?: string | null
  downloadedBytes: number
  contentLength?: number | null
  detail?: string | null
}

export type GitStatusEntryKind = 'file' | 'submodule'
export type GitRepositoryKind = 'root' | 'nested' | 'submodule'
export type GitRepositoryState = 'ready' | 'uninitialized' | 'invalid'

export interface GitStatusFile {
  path: string
  staged: boolean
  status: string
  repositoryPath: string
  repoRelativePath: string
  contentSignature?: string
  entryKind: GitStatusEntryKind
  headOid?: string | null
  expectedHeadOid?: string | null
}

export interface GitRepositorySummary {
  repositoryPath: string
  root: boolean
  branch: string
  ahead: number
  behind: number
  files: GitStatusFile[]
  kind: GitRepositoryKind
  state: GitRepositoryState
  headOid?: string | null
  expectedHeadOid?: string | null
  totalChanges: number
  truncated: boolean
}

export interface GitStatusResponse {
  workspaceId: string
  primaryRepositoryPath: string
  branch: string
  ahead: number
  behind: number
  files: GitStatusFile[]
  repositories: GitRepositorySummary[]
  totalChanges: number
  truncated: boolean
  kind: GitRepositoryKind
  state: GitRepositoryState
  headOid?: string | null
  expectedHeadOid?: string | null
  revision?: number
}

export interface GitInitResponse {
  workspaceId: string
  branch: string
  initialized: boolean
}

export interface GitSubmoduleUpdateResponse {
  workspaceId: string
  repositoryPath: string
  recursive: boolean
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
  /** Whether the diff exceeded the inline rendering limits */
  tooLarge: boolean
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
  /** Whether either side or the full comparison exceeded the inline rendering limits */
  tooLarge: boolean
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
  queued: boolean
}

export interface GitPullResponse {
  workspaceId: string
  remote: string
  branch?: string | null
  rebase: boolean
  queued: boolean
}

export interface GitPushResponse {
  workspaceId: string
  remote: string
  branch?: string | null
  setUpstream: boolean
  forceWithLease: boolean
  queued: boolean
}

export interface GitTagPushResponse {
  workspaceId: string
  remote?: string | null
  name: string
  queued: boolean
}

export interface GitRemoteOperationPayload {
  workspaceId: string
  repositoryPath?: string | null
  operation: 'fetch' | 'pull' | 'push' | 'tagPush'
  status: 'started' | 'finished' | 'error'
  remote?: string | null
  branch?: string | null
  error?: string | null
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

export interface GitTagEntry {
  name: string
  oid: string
  target: string
  tagger: string | null
  message: string | null
}

export interface GitTagListResponse {
  workspaceId: string
  entries: GitTagEntry[]
}

export interface GitConflictFile {
  path: string
  status: string
}

export interface GitMergeResult {
  workspaceId: string
  success: boolean
  conflicts: GitConflictFile[]
  mergedCommit: string | null
}

export interface GitMergeStateResponse {
  workspaceId: string
  inProgress: boolean
  conflicts: GitConflictFile[]
}

export interface GitConflictResolveResponse {
  workspaceId: string
  path: string
  side: 'ours' | 'theirs'
  conflicts: GitConflictFile[]
}

export interface TerminalCreateResponse {
  sessionId: string
  workspaceId: string
  shell: string
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string
}

export interface TerminalWriteResponse {
  workspaceId: string
  sessionId: string
  accepted: boolean
}

export interface TerminalResizeResponse {
  workspaceId: string
  sessionId: string
  cols: number
  rows: number
  resized: boolean
}

export interface TerminalOutputPayload {
  sessionId: string
  workspaceId: string
  chunk: string
  seq: number
  tsMs: number
}

export interface TerminalStatePayload {
  sessionId: string
  workspaceId: string
  from: string
  to: string
  tsMs: number
}

export interface TerminalMetaPayload {
  sessionId: string
  workspaceId: string
  unreadBytes: number
  unreadChunks: number
  tailChunk: string
  tsMs: number
}

export interface TerminalKillResponse {
  workspaceId: string
  sessionId: string
  signal: string
  killed: boolean
}

export interface TerminalHasSessionResponse {
  workspaceId: string
  sessionId: string
  alive: boolean
}

export interface TerminalVisibilityResponse {
  workspaceId: string
  sessionId: string
  visible: boolean
  updated: boolean
}

export interface TerminalRenderedScreenResponse {
  workspaceId: string
  sessionId: string
  revision: number
  content: string
  cols: number
  rows: number
  cursorRow: number
  cursorCol: number
  scrollbackLines: number
  title: string | null
}

export interface TerminalOpenOutputChannelResponse {
  workspaceId: string
  sessionId: string
  channelBound: boolean
}

export interface TerminalSnapshotResponse {
  workspaceId: string
  sessionId: string
  chunk: string
  bytes: number
  maxBytes: number
  truncated: boolean
  currentSeq: number
}

export interface TerminalDeltaResponse {
  workspaceId: string
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
  workspaceId: string
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
  workspaceId: string
  sessionId: string
  screenRevision: number
  accepted: boolean
  humanText: string | null
  humanEntries: TerminalDebugHumanEntry[]
  humanEventCount: number
}

export interface TerminalDebugClearHumanLogResponse {
  workspaceId: string
  sessionId: string
  cleared: boolean
}

export interface TerminalDebugAppendFrontendFocusLogResponse {
  workspaceId: string | null
  stationId: string
  sessionId: string | null
  kind: string
  accepted: boolean
  logPath: string
}

export interface SurfaceDetachedStationPayload {
  stationId: string
  name: string
  tool: string
  agentWorkdirRel: string
  workspaceId: string
  sessionId?: string | null
}

export interface SurfaceOpenDetachedWindowRequest {
  workspaceId: string
  containerId: string
  title: string
  activeStationId?: string | null
  fullscreenStationId?: string | null
  minimizedStationIds?: string[]
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
  viewportY?: number | null
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

export interface DetachedTerminalLaunchCliAgentMessage {
  kind: 'detached_terminal_launch_cli_agent'
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

export interface DetachedTerminalUpdateContainerViewStateMessage {
  kind: 'detached_terminal_update_container_view_state'
  workspaceId: string
  containerId: string
  activeStationId?: string | null
  fullscreenStationId?: string | null
  minimizedStationIds?: string[]
  layoutMode?: 'auto' | 'focus' | 'custom'
  customLayout?: {
    columns: number
    rows: number
  } | null
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
  | DetachedTerminalLaunchCliAgentMessage
  | DetachedTerminalWriteInputMessage
  | DetachedTerminalWriteWithSubmitMessage
  | DetachedTerminalResizeMessage
  | DetachedTerminalActivateStationMessage
  | DetachedTerminalUpdateContainerViewStateMessage
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
  mtimeMs: number
  contentSignature?: string
}

export interface FsWriteFileResponse {
  workspaceId: string
  path: string
  bytes: number
  written: boolean
}

export interface FsStatEntry {
  path: string
  sizeBytes: number
  mtimeMs: number
  exists: boolean
  contentSignature?: string
}

export interface FsStatFilesResponse {
  workspaceId: string
  entries: FsStatEntry[]
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
  opened: boolean
}

export interface FileInfoResponse {
  path: string
  size: number
  mimeType: string
  isBinary: boolean
  isLarge: boolean
  category: string
}

export interface PdfInfoResponse {
  pageCount: number
  pageWidth: number
  pageHeight: number
  title?: string | null
  author?: string | null
}

export interface PdfPageResponse {
  imageData: string
  width: number
  height: number
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

export interface BusinessDesignerDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string | null
}

export interface BusinessDesignerDocumentSummary {
  documentId: string
  title: string
  module?: string | null
  status: string
  path: string
  updatedAt?: string | null
  blockCount: number
  tags: string[]
}

export interface BusinessDesignerListDocumentsResponse {
  workspaceId: string
  docsRoot: string
  scaffoldInitialized: boolean
  repoInitialized: boolean
  documents: BusinessDesignerDocumentSummary[]
  diagnostics: BusinessDesignerDiagnostic[]
}

export interface BusinessDesignerInitDocsRepoResponse {
  workspaceId: string
  docsRoot: string
  scaffoldCreated: boolean
  repoInitialized: boolean
  gitInitialized: boolean
  templatesWritten: boolean
}

export interface BusinessDesignerGeneratedPaths {
  readme: string
  agentBrief: string
  agentInput: string
  previewHtml: string
}

export interface BusinessDesignerManifest {
  schemaVersion: number
  documentId: string
  title: string
  module?: string | null
  createdAt: string
  updatedAt: string
  entry: string
  generated: BusinessDesignerGeneratedPaths
  tags: string[]
  status: string
  layout?: Record<string, BusinessDesignerLayoutPosition> | null
}

export interface BusinessDesignerLayoutPosition {
  x: number
  y: number
}

export interface BusinessDesignerBlockLink {
  targetBlockId: string
  relation: string
}

export interface BusinessDesignerBlock {
  id: string
  kind: string
  title: string
  order: number
  payload: unknown
  links: BusinessDesignerBlockLink[]
  validation: BusinessDesignerDiagnostic[]
  updatedAt: string
}

export interface BusinessDesignerDesignGraph {
  schemaVersion: number
  documentId: string
  revision: string
  title: string
  blocks: BusinessDesignerBlock[]
}

export interface BusinessDesignerDocumentDetail {
  workspaceId: string
  docsRoot: string
  manifest: BusinessDesignerManifest
  design: BusinessDesignerDesignGraph
  diagnostics: BusinessDesignerDiagnostic[]
}

export interface BusinessDesignerCreateDocumentParams {
  documentId: string
  title: string
  module?: string | null
}

export interface BusinessDesignerValidationResult {
  schemaVersion: number
  workspaceId: string
  documentId: string
  revision: string
  diagnostics: BusinessDesignerDiagnostic[]
  gaps: BusinessDesignerGap[]
  rulesRun: BusinessDesignerRuleRun[]
  graphProjection: BusinessDesignerGraphProjection
}

export interface BusinessDesignerGap {
  id: string
  key: string
  code: string
  blockId: string
  layer: 'intra' | 'inter'
  severity: 'warning' | 'error'
  message: string
  fixableByAgent: boolean
  locator?: Record<string, string> | null
}

export interface BusinessDesignerRuleRun {
  kind: string
  code: string
  blockId: string
  passed: boolean
  gapCount: number
}

export interface BusinessDesignerDerivedEdge {
  fromBlockId: string
  toBlockId: string
  relation: 'dependsOn' | 'produces' | 'consumes' | 'uses' | 'extends'
  sourceField?: string | null
}

export interface BusinessDesignerGraphProjection {
  links: BusinessDesignerDerivedEdge[]
}

export interface BusinessDesignerGapResolution {
  targetGapKeys: string[]
  resolved: string[]
  unresolved: string[]
  incidentalResolved: string[]
  introduced: BusinessDesignerGap[]
}

export interface BusinessDesignerCompileResult {
  workspaceId: string
  documentId: string
  revision: string
  generated: BusinessDesignerGeneratedPaths
  files: string[]
  diagnostics: BusinessDesignerDiagnostic[]
}

export interface BusinessDesignerCheckpointResult {
  workspaceId: string
  documentId: string
  commit?: string | null
  committed: boolean
  message: string
}

export interface BusinessDesignerDiffEntry {
  status: string
  path: string
}

export interface BusinessDesignerDiffResult {
  workspaceId: string
  documentId?: string | null
  base?: string | null
  head?: string | null
  entries: BusinessDesignerDiffEntry[]
}

export interface BusinessDesignerCheckpointEntry {
  commit: string
  shortCommit: string
  authoredAt: string
  summary: string
}

export interface BusinessDesignerCheckpointHistoryResult {
  workspaceId: string
  documentId?: string | null
  entries: BusinessDesignerCheckpointEntry[]
}

export interface BusinessDesignerAgentTaskPreview {
  workspaceId: string
  documentId: string
  requestId: string
  provider: string
  status: 'ready' | 'no_agent_fixable_gaps' | string
  schemaVersion: number
  selectedBlockIds: string[]
  revision: string
  contextPath: string
  outputContract: string
  lifecycle: string
  hostBlockId: string
  gapCodes: string[]
  targetGapKeys: string[]
  scope: 'single' | 'block'
  targetGaps: BusinessDesignerGap[]
  contextGaps: BusinessDesignerGap[]
  hostBlock?: BusinessDesignerBlock | null
  adjacency?: BusinessDesignerDerivedEdge[] | null
}

export interface BusinessDesignerAgentCompletionResult {
  workspaceId: string
  documentId: string
  requestId: string
  dispatch: unknown
}

export interface BusinessDesignerRevertToCheckpointRequest {
  traceId: string
  documentId: string
  checkpoint: string
}

export interface BusinessDesignerPatchOperation {
  op: 'updateBlock'
  blockId: string
  patch: {
    kind?: string | null
    title?: string | null
    order?: number | null
    payload?: unknown
    links?: BusinessDesignerBlockLink[] | null
  }
}

export interface BusinessDesignerAgentPatch {
  schemaVersion: number
  documentId: string
  baseRevision: string
  summary: string
  changes: BusinessDesignerPatchOperation[]
  openQuestions: string[]
  hostBlockId: string
  gapCodes: string[]
  targetGapKeys: string[]
  scope?: 'single' | 'block' | null
}

export interface BusinessDesignerPatchPreviewChange {
  op: string
  blockId: string
  title?: string | null
  kind?: string | null
  destructive: boolean
  summary: string
}

export interface BusinessDesignerPatchValidationResult {
  workspaceId: string
  documentId: string
  patchPath?: string | null
  patch: BusinessDesignerAgentPatch
  diagnostics: BusinessDesignerDiagnostic[]
  changes: BusinessDesignerPatchPreviewChange[]
  valid: boolean
}

export interface BusinessDesignerRecoveredAgentPatchResult {
  workspaceId: string
  documentId: string
  taskId: string
  sourceMessageId: string
  sourceAgentId: string
  sourceMessageType: string
  validation: BusinessDesignerPatchValidationResult
}

export interface BusinessDesignerPatchApplyResult {
  workspaceId: string
  documentId: string
  appliedRevision: string
  patchPath: string
  acceptedChanges: number[]
  skippedChanges: number[]
  detail: BusinessDesignerDocumentDetail
  diagnostics: BusinessDesignerDiagnostic[]
  gapResolution: BusinessDesignerGapResolution
  gaps: BusinessDesignerGap[]
  rulesRun: BusinessDesignerRuleRun[]
  graphProjection: BusinessDesignerGraphProjection
}

export interface BusinessDesignerExportResult {
  workspaceId: string
  documentId: string
  format: string
  suggestedFileName: string
  mimeType: string
  content: string
  sourcePath: string
  savedPath?: string | null
  cancelled?: boolean | null
}

export interface BusinessDesignerCodingTask {
  id: string
  title: string
  markdown: string
  acceptanceRefs: string[]
  contractRefs: string[]
  riskRefs: string[]
}

export interface BusinessDesignerCodingHandoffPreview {
  workspaceId: string
  documentId: string
  title: string
  revision: string
  request: TaskDispatchBatchRequest
  tasks: BusinessDesignerCodingTask[]
  attachments: TaskDispatchAttachmentPayload[]
  diagnostics: BusinessDesignerDiagnostic[]
}

export interface BusinessDesignerCodingHandoffDispatchResult {
  workspaceId: string
  documentId: string
  preview: BusinessDesignerCodingHandoffPreview
  dispatch: TaskDispatchBatchResponse
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

export type AiConfigAgent = 'claude' | 'codex'

export type ClaudeProviderMode = 'official' | 'preset' | 'custom'

export type ClaudeApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

export type ClaudeAuthScheme = 'anthropic_api_key' | 'anthropic_auth_token'

export interface ClaudeModelOverrides {
  haikuModel?: string | null
  sonnetModel?: string | null
  opusModel?: string | null
}

export type AiAgentConfigStatus = 'unconfigured' | 'configured' | 'guidance_only'
export type AgentInstallRecommendedAction = 'install' | 'install_node' | 'install_brew' | 'manual_help'
export type AgentInstallProgressPhase =
  | 'preparing'
  | 'downloading'
  | 'installing'
  | 'verifying'
  | 'completed'
  | 'failed'
export type AgentInstallDiagnosticCode =
  | 'node_missing'
  | 'npm_missing'
  | 'dns_failed'
  | 'timeout'
  | 'tls_failed'
  | 'registry_blocked'
  | 'permission_denied'
  | 'installer_corrupt'
  | 'verification_failed'
  | 'unknown'

export interface AiAgentInstallStatus {
  installed: boolean
  executable?: string | null
  requiresNode: boolean
  nodeReady: boolean
  npmReady: boolean
  brewReady: boolean
  installAvailable: boolean
  uninstallAvailable: boolean
  detectedBy: string[]
  issues: string[]
  autoInstallSupported?: boolean
  recommendedAction?: AgentInstallRecommendedAction | null
}

export interface AgentInstallProgressEvent {
  phase: AgentInstallProgressPhase
  message: string
  detail?: string | null
  attemptId?: string | null
  diagnosticCode?: AgentInstallDiagnosticCode | null
}

export interface AiAgentSnapshotCard {
  agent: AiConfigAgent
  title: string
  subtitle: string
  installStatus: AiAgentInstallStatus
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
  apiFormat?: ClaudeApiFormat | null
  modelOverrides?: ClaudeModelOverrides | null
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
  apiFormat?: ClaudeApiFormat | null
  modelOverrides?: ClaudeModelOverrides | null
}

export interface ClaudeSnapshot {
  presets: ClaudeProviderPreset[]
  config: ClaudeConfigSnapshot
  savedProviders: ClaudeSavedProviderSnapshot[]
  canApplyOfficialMode: boolean
}

export type CodexProviderMode = 'official' | 'preset' | 'custom'

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


export interface CodexSnapshot {
  title: string
  summary: string
  configPath?: string | null
  docsUrl: string
  tips: string[]
  presets: CodexProviderPreset[]
  config: CodexConfigSnapshot
  savedProviders: CodexSavedProviderSnapshot[]
}


export interface AiConfigSnapshot {
  agents: AiAgentSnapshotCard[]
  claude: ClaudeSnapshot
  codex: CodexSnapshot
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
  apiFormat?: ClaudeApiFormat | null
  modelOverrides?: ClaudeModelOverrides | null
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


export interface ClaudeNormalizedDraft {
  mode: ClaudeProviderMode
  providerId?: string | null
  providerName?: string | null
  baseUrl?: string | null
  model?: string | null
  authScheme?: ClaudeAuthScheme | null
  secretRef?: string | null
  hasSecret: boolean
  apiFormat?: ClaudeApiFormat | null
  modelOverrides?: ClaudeModelOverrides | null
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


export type AiConfigDraftInput = ClaudeDraftInput | CodexDraftInput

export interface AiConfigFetchedModel {
  id: string
  ownedBy?: string | null
}

export interface AiConfigEndpointTestResult {
  url: string
  latencyMs?: number | null
  statusCode?: number | null
  error?: string | null
}

export type AiConfigNormalizedDraft =
  | { claude: ClaudeNormalizedDraft }
  | { codex: CodexNormalizedDraft }

export type AnyAiConfigNormalizedDraft =
  | ClaudeNormalizedDraft
  | CodexNormalizedDraft

export function unwrapAiConfigNormalizedDraft(
  draft: AiConfigNormalizedDraft,
):
  | { agent: 'claude'; draft: ClaudeNormalizedDraft }
  | { agent: 'codex'; draft: CodexNormalizedDraft }
 {
  if ('claude' in draft) {
    return { agent: 'claude', draft: draft.claude }
  }
  return { agent: 'codex', draft: draft.codex }
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

export interface GtoCliStatus {
  installed: boolean
  managed: boolean
  commandPath?: string | null
  targetScriptPath?: string | null
  nodeReady: boolean
  installAvailable: boolean
  uninstallAvailable: boolean
  issue?: string | null
}

export interface GtoSkillStatus {
  installed: boolean
  managed: boolean
  targetDir?: string | null
  sourceDir?: string | null
  installAvailable: boolean
  uninstallAvailable: boolean
  issue?: string | null
}

export interface GitUpdatedPayload {
  workspaceId: string
  available: boolean
  primaryRepositoryPath: string
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  files: GitStatusFile[]
  repositories: GitRepositorySummary[]
  totalChanges: number
  truncated: boolean
  kind: GitRepositoryKind
  state: GitRepositoryState
  headOid?: string | null
  expectedHeadOid?: string | null
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

export type AgentScope = 'station' | 'designer'

export interface AgentProfile {
  id: string
  workspaceId: string
  name: string
  tool: string
  workdir?: string | null
  customWorkdir: boolean
  scope: AgentScope
  state: AgentState
  employeeNo?: string | null
  policySnapshotId?: string | null
  promptFileName?: string | null
  promptFileRelativePath?: string | null
  launchCommand?: string | null
  orderIndex: number
  createdAtMs: number
  updatedAtMs: number
}

export interface AgentListResponse {
  agents: AgentProfile[]
}

export interface AgentCreateRequest {
  workspaceId: string
  agentId?: string | null
  name: string
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: AgentState
  promptEnabled?: boolean
  promptFileName?: string | null
  promptContent?: string | null
  launchCommand?: string | null
}

export interface AgentCreateResponse {
  agent: AgentProfile
}

export interface AgentUpdateRequest {
  workspaceId: string
  agentId: string
  name: string
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: AgentState
  promptEnabled?: boolean
  promptFileName?: string | null
  promptContent?: string | null
  launchCommand?: string | null
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

export interface AgentPromptReadRequest {
  workspaceId: string
  agentId: string
}

export interface AgentPromptReadResponse {
  promptContent: string
  promptFileName?: string | null
  promptFileRelativePath?: string | null
}

export interface AgentReorderRequest {
  workspaceId: string
  orderedAgentIds: string[]
}

export interface AgentRuntimeRegisterRequest {
  workspaceId: string
  agentId: string
  stationId: string
  sessionId: string
  toolKind?: 'claude' | 'codex' | 'shell' | 'unknown'
  resolvedCwd?: string | null
  submitSequence?: string | null
  online?: boolean
}

export interface AgentRuntimeRegisterResponse {
  workspaceId: string
  agentId: string
  stationId: string
  sessionId: string
  toolKind?: 'claude' | 'codex' | 'shell' | 'unknown'
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
export type ToolProfileProviderKind = 'claude' | 'codex' | 'shell' | 'unknown' | 'any'
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

type ToolCommandArgumentWire = Omit<ToolCommandArgument, 'options'> & {
  options?: ToolCommandArgumentOption[] | null
}

type ToolCommandSummaryWire = Omit<ToolCommandSummary, 'arguments'> & {
  arguments?: ToolCommandArgumentWire[] | null
}

type ToolListCommandsResponseWire = Omit<ToolListCommandsResponse, 'commands'> & {
  commands: ToolCommandSummaryWire[]
}

function normalizeToolCommandArgument(argument: ToolCommandArgumentWire): ToolCommandArgument {
  return {
    ...argument,
    options: argument.options ?? [],
  }
}

function normalizeToolCommandSummary(command: ToolCommandSummaryWire): ToolCommandSummary {
  return {
    ...command,
    arguments: (command.arguments ?? []).map(normalizeToolCommandArgument),
  }
}

export function normalizeToolListCommandsResponse(
  response: ToolListCommandsResponseWire,
): ToolListCommandsResponse {
  return {
    ...response,
    commands: response.commands.map(normalizeToolCommandSummary),
  }
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

export interface ChannelConnectorAccountDeleteResponse {
  channel: string
  accountId: string
  deleted: boolean
  deletedBindings: number
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

export interface FeishuQrLoginBeginResult {
  deviceCode: string
  qrUrl: string
  userCode: string
  interval: number
  expireIn: number
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

export interface ChannelBindingDeleteResponse {
  deleted: boolean
  binding: ChannelRouteBinding
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

export function runAsyncCleanupSafely(
  cleanups: Array<(() => void | Promise<void>) | null | undefined>,
): void {
  cleanups.forEach((cleanup) => {
    if (!cleanup) {
      return
    }
    try {
      void Promise.resolve(cleanup()).catch(() => {
        // Listener cleanup must never surface as an unhandled rejection.
      })
    } catch {
      // Listener cleanup must never break caller teardown.
    }
  })
}

export function createSafeAsyncCleanup(
  cleanups: Array<(() => void | Promise<void>) | null | undefined>,
): () => void {
  let cleaned = false
  return () => {
    if (cleaned) {
      return
    }
    cleaned = true
    runAsyncCleanupSafely(cleanups)
  }
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
  async getCurrentWindowLabel(): Promise<string | null> {
    if (!isTauriRuntime()) {
      return null
    }
    try {
      const webviewWindowApi = await import('@tauri-apps/api/webviewWindow')
      return webviewWindowApi.getCurrentWebviewWindow().label
    } catch {
      return null
    }
  },
  systemPickDirectory(defaultPath?: string | null) {
    return invokeCommand<string | null>('system_pick_directory', {
      defaultPath: defaultPath ?? null,
    })
  },
  systemConfirm(title: string, message: string) {
    return invokeCommand<boolean>('system_confirm', { title, message })
  },
  signalUiReady() {
    return invokeCommand<void>('system_signal_ui_ready')
  },
  systemOpenUrl(url: string) {
    return invokeCommand<void>('system_open_url', { url })
  },
  systemGtoDoctor() {
    return invokeCommand<Record<string, unknown>>('system_gto_doctor')
  },
  systemGtoCliStatus() {
    return invokeCommand<GtoCliStatus>('system_gto_cli_status', {})
  },
  systemGtoCliInstall() {
    return invokeCommand<GtoCliStatus>('system_gto_cli_install', {})
  },
  systemGtoCliUninstall() {
    return invokeCommand<GtoCliStatus>('system_gto_cli_uninstall', {})
  },
  systemGtoSkillStatus(agent: 'claude' | 'codex') {
    return invokeCommand<GtoSkillStatus>('system_gto_skill_status', { agent })
  },
  systemGtoSkillInstall(agent: 'claude' | 'codex') {
    return invokeCommand<GtoSkillStatus>('system_gto_skill_install', { agent })
  },
  systemGtoSkillUninstall(agent: 'claude' | 'codex') {
    return invokeCommand<GtoSkillStatus>('system_gto_skill_uninstall', { agent })
  },
  workspaceGetWindowActive() {
    return invokeCommand<WorkspaceWindowActiveResponse>('workspace_get_window_active')
  },
  workspaceList() {
    return invokeCommand<WorkspaceListResponse>('workspace_list')
  },
  workspaceOpen(path: string) {
    return invokeCommand<WorkspaceOpenResponse>('workspace_open', { path })
  },
  workspaceClose(workspaceId: string, nextWorkspaceId?: string | null) {
    return invokeCommand<WorkspaceCloseResponse>('workspace_close', {
      workspaceId,
      nextWorkspaceId: nextWorkspaceId ?? null,
    })
  },
  workspaceSwitchActive(workspaceId: string) {
    return invokeCommand<WorkspaceSwitchActiveResponse>('workspace_switch_active', { workspaceId })
  },
  workspaceOpenInNewWindow(
    workspaceId: string,
    position?: { x: number; y: number } | null,
    size?: { width: number; height: number } | null,
  ) {
    return invokeCommand<WorkspaceOpenInNewWindowResponse>('workspace_open_in_new_window', {
      workspaceId,
      position: position ? [position.x, position.y] : null,
      size: size ? [size.width, size.height] : null,
    })
  },
  workspaceGetContext(workspaceId: string) {
    return invokeCommand<WorkspaceContextResponse>('workspace_get_context', { workspaceId })
  },
  workspaceRestoreSession(workspaceId: string) {
    return invokeCommand<WorkspaceRestoreSessionResponse>('workspace_restore_session', {
      workspaceId,
    })
  },
  workspaceResetState(workspaceId: string, confirmationText: string) {
    return invokeCommand<WorkspaceResetResponse>('workspace_reset_state', {
      workspaceId,
      confirmationText,
    })
  },
  gitStatus(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<GitStatusResponse>('git_status', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },
  gitInit(workspaceId: string, initialBranch?: string | null, repositoryPath?: string | null) {
    return invokeCommand<GitInitResponse>('git_init', {
      workspaceId,
      initialBranch: initialBranch ?? null,
      repositoryPath: repositoryPath ?? null,
    })
  },
  gitSubmoduleUpdate(workspaceId: string, repositoryPath: string, recursive = true) {
    return invokeCommand<GitSubmoduleUpdateResponse>('git_submodule_update', {
      workspaceId,
      repositoryPath,
      recursive,
    })
  },
  gitDiffFile(workspaceId: string, path: string, staged?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitDiffResponse>('git_diff_file', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      staged: staged ?? false,
    })
  },
  /** High-performance structured diff with parsed hunks */
  gitDiffFileStructured(workspaceId: string, path: string, staged?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitDiffStructuredResponse>('git_diff_file_structured', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      staged: staged ?? false,
    })
  },
  gitDiffFileExpansion(workspaceId: string, path: string, oldPath?: string | null, staged?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitDiffExpansionResponse>('git_diff_file_expansion', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      oldPath: oldPath ?? null,
      staged: staged ?? false,
    })
  },
  gitStage(workspaceId: string, paths: string[], repositoryPath?: string | null) {
    return invokeCommand<GitCountResponse>('git_stage', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      paths,
    })
  },
  gitUnstage(workspaceId: string, paths: string[], repositoryPath?: string | null) {
    return invokeCommand<GitCountResponse>('git_unstage', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      paths,
    })
  },
  gitDiscard(workspaceId: string, paths: string[], includeUntracked?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitCountResponse>('git_discard', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      paths,
      includeUntracked: includeUntracked ?? false,
    })
  },
  gitCommit(workspaceId: string, message: string, options?: { amend?: boolean; repositoryPath?: string | null }) {
    return invokeCommand<GitCommitResponse>('git_commit', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      message,
      amend: options?.amend ?? false,
    })
  },
  gitLog(workspaceId: string, options?: { limit?: number; skip?: number; repositoryPath?: string | null }) {
    return invokeCommand<GitLogResponse>('git_log', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      limit: options?.limit ?? null,
      skip: options?.skip ?? null,
    })
  },
  gitCommitDetail(workspaceId: string, commit: string, repositoryPath?: string | null) {
    return invokeCommand<GitCommitDetailResponse>('git_commit_detail', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      commit,
    })
  },
  gitListBranches(workspaceId: string, includeRemote?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitBranchesResponse>('git_list_branches', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      includeRemote: includeRemote ?? false,
    })
  },
  gitCheckout(
    workspaceId: string,
    target: string,
    options?: { create?: boolean; startPoint?: string | null; repositoryPath?: string | null },
  ) {
    return invokeCommand<GitCheckoutResponse>('git_checkout', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      target,
      create: options?.create ?? false,
      startPoint: options?.startPoint ?? null,
    })
  },
  gitCreateBranch(workspaceId: string, branch: string, startPoint?: string | null, repositoryPath?: string | null) {
    return invokeCommand<GitBranchMutationResponse>('git_create_branch', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      branch,
      startPoint: startPoint ?? null,
    })
  },
  gitDeleteBranch(workspaceId: string, branch: string, force?: boolean, repositoryPath?: string | null) {
    return invokeCommand<GitBranchMutationResponse>('git_delete_branch', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      branch,
      force: force ?? false,
    })
  },
  gitFetch(
    workspaceId: string,
    options?: { remote?: string | null; prune?: boolean; includeTags?: boolean; repositoryPath?: string | null },
  ) {
    return invokeCommand<GitFetchResponse>('git_fetch', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      remote: options?.remote ?? null,
      prune: options?.prune ?? true,
      includeTags: options?.includeTags ?? true,
    })
  },
  gitPull(
    workspaceId: string,
    options?: { remote?: string | null; branch?: string | null; rebase?: boolean; repositoryPath?: string | null },
  ) {
    return invokeCommand<GitPullResponse>('git_pull', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
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
      repositoryPath?: string | null
    },
  ) {
    return invokeCommand<GitPushResponse>('git_push', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      remote: options?.remote ?? null,
      branch: options?.branch ?? null,
      setUpstream: options?.setUpstream ?? false,
      forceWithLease: options?.forceWithLease ?? false,
    })
  },
  gitStashPush(
    workspaceId: string,
    options?: { message?: string | null; includeUntracked?: boolean; keepIndex?: boolean; repositoryPath?: string | null },
  ) {
    return invokeCommand<GitStashPushResponse>('git_stash_push', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      message: options?.message ?? null,
      includeUntracked: options?.includeUntracked ?? false,
      keepIndex: options?.keepIndex ?? false,
    })
  },
  gitStashPop(workspaceId: string, stash?: string | null, repositoryPath?: string | null) {
    return invokeCommand<GitStashPopResponse>('git_stash_pop', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      stash: stash ?? null,
    })
  },
  gitStashList(workspaceId: string, limit?: number, repositoryPath?: string | null) {
    return invokeCommand<GitStashListResponse>('git_stash_list', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      limit: limit ?? null,
    })
  },
  // Tags
  gitTagList(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<GitTagListResponse>('git_tag_list', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },
  gitTagCreate(workspaceId: string, name: string, target: string, options?: { annotated?: boolean; message?: string; repositoryPath?: string | null }) {
    return invokeCommand<{ workspaceId: string; name: string }>('git_tag_create', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      name,
      target,
      annotated: options?.annotated ?? false,
      message: options?.message ?? null,
    })
  },
  gitTagDelete(workspaceId: string, name: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string; name: string }>('git_tag_delete', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      name,
    })
  },
  gitTagPush(workspaceId: string, name: string, remote?: string, repositoryPath?: string | null) {
    return invokeCommand<GitTagPushResponse>('git_tag_push', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      name,
      remote: remote ?? null,
    })
  },
  // Cherry-pick / Revert / Reset
  gitCherryPick(workspaceId: string, commit: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string }>('git_cherry_pick', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      commit,
    })
  },
  gitRevert(workspaceId: string, commit: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string }>('git_revert', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      commit,
    })
  },
  gitReset(
    workspaceId: string,
    target: string,
    mode: 'soft' | 'mixed' | 'hard',
    repositoryPath?: string | null,
  ) {
    return invokeCommand<{ workspaceId: string }>('git_reset', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      target,
      mode,
    })
  },
  // Merge
  gitMerge(
    workspaceId: string,
    target: string,
    options?: { noFf?: boolean; repositoryPath?: string | null },
  ) {
    return invokeCommand<GitMergeResult>('git_merge', {
      workspaceId,
      repositoryPath: options?.repositoryPath ?? null,
      target,
      noFf: options?.noFf ?? false,
    })
  },
  gitMergeContinue(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string; mergedCommit: string }>('git_merge_continue', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },
  gitMergeAbort(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string }>('git_merge_abort', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },
  gitConflictList(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<{ workspaceId: string; conflicts: GitConflictFile[] }>('git_conflict_list', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },

  gitConflictResolve(
    workspaceId: string,
    path: string,
    side: 'ours' | 'theirs',
    repositoryPath?: string | null,
  ) {
    return invokeCommand<GitConflictResolveResponse>('git_conflict_resolve', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      side,
    })
  },

  gitMergeState(workspaceId: string, repositoryPath?: string | null) {
    return invokeCommand<GitMergeStateResponse>('git_merge_state', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
    })
  },
  // Hunk staging
  gitStageHunk(workspaceId: string, path: string, patch: string, repositoryPath?: string | null) {
    return invokeCommand<{ ok: boolean }>('git_stage_hunk', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      patch,
    })
  },
  gitUnstageHunk(
    workspaceId: string,
    path: string,
    patch: string,
    repositoryPath?: string | null,
  ) {
    return invokeCommand<{ ok: boolean }>('git_unstage_hunk', {
      workspaceId,
      repositoryPath: repositoryPath ?? null,
      path,
      patch,
    })
  },
  fsListDir(workspaceId: string, path: string, depth = 2) {
    return invokeCommand<FsListDirResponse>('fs_list_dir', { workspaceId, path, depth })
  },
  fsReadFile(workspaceId: string, path: string) {
    return invokeCommand<FsReadFileResponse>('fs_read_file', { workspaceId, path })
  },
  fsGetFileInfo(path: string) {
    return invokeCommand<FileInfoResponse>('fs_get_file_info', { path })
  },
  fsPdfGetInfo(path: string) {
    return invokeCommand<PdfInfoResponse>('fs_pdf_get_info', { path })
  },
  fsPdfRenderPage(path: string, page: number, scale: number) {
    return invokeCommand<PdfPageResponse>('fs_pdf_render_page', { path, page, scale })
  },
  fsReadFileFull(workspaceId: string, path: string, limitBytes?: number) {
    return invokeCommand<FsReadFileResponse>('fs_read_file_full', {
      workspaceId,
      path,
      limitBytes: limitBytes ?? null,
    })
  },
  fsStatFiles(workspaceId: string, paths: string[]) {
    return invokeCommand<FsStatFilesResponse>('fs_stat_files', { workspaceId, paths })
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
  businessDesignerListDocuments(workspaceId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerListDocumentsResponse>('business_designer_list_documents', {
      traceId,
      workspaceId,
    })
  },
  listBusinessDesignerDocuments(workspaceId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerListDocumentsResponse>('business_designer_list_documents', {
      traceId,
      workspaceId,
    })
  },
  businessDesignerInitDocsRepo(workspaceId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerInitDocsRepoResponse>('business_designer_init_docs_repo', {
      traceId,
      workspaceId,
    })
  },
  initBusinessDesignerDocsRepo(workspaceId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerInitDocsRepoResponse>('business_designer_init_docs_repo', {
      traceId,
      workspaceId,
    })
  },
  businessDesignerCreateDocument(
    workspaceId: string,
    params: BusinessDesignerCreateDocumentParams,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_create_document', {
      traceId,
      workspaceId,
      documentId: params.documentId,
      title: params.title,
      module: params.module ?? null,
    })
  },
  createBusinessDesignerDocument(
    workspaceId: string,
    params: BusinessDesignerCreateDocumentParams,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_create_document', {
      traceId,
      workspaceId,
      documentId: params.documentId,
      title: params.title,
      module: params.module ?? null,
    })
  },
  businessDesignerReadDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_read_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  readBusinessDesignerDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_read_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  businessDesignerSaveDocument(workspaceId: string, detail: BusinessDesignerDocumentDetail, traceId?: string) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_save_document', {
      traceId,
      workspaceId,
      detail,
    })
  },
  saveBusinessDesignerDocument(workspaceId: string, detail: BusinessDesignerDocumentDetail, traceId?: string) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_save_document', {
      traceId,
      workspaceId,
      detail,
    })
  },
  businessDesignerValidateDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerValidationResult>('business_designer_validate_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  validateBusinessDesignerDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerValidationResult>('business_designer_validate_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  businessDesignerCompileDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerCompileResult>('business_designer_compile_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  compileBusinessDesignerDocument(workspaceId: string, documentId: string, traceId?: string) {
    return invokeCommand<BusinessDesignerCompileResult>('business_designer_compile_document', {
      traceId,
      workspaceId,
      documentId,
    })
  },
  businessDesignerCreateCheckpoint(workspaceId: string, documentId: string, message: string, traceId?: string) {
    return invokeCommand<BusinessDesignerCheckpointResult>('business_designer_create_checkpoint', {
      traceId,
      workspaceId,
      documentId,
      message,
    })
  },
  createBusinessDesignerCheckpoint(workspaceId: string, documentId: string, message: string, traceId?: string) {
    return invokeCommand<BusinessDesignerCheckpointResult>('business_designer_create_checkpoint', {
      traceId,
      workspaceId,
      documentId,
      message,
    })
  },
  businessDesignerDiffCheckpoint(
    workspaceId: string,
    params?: { documentId?: string | null; base?: string | null },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDiffResult>('business_designer_diff_checkpoint', {
      traceId,
      workspaceId,
      documentId: params?.documentId ?? null,
      base: params?.base ?? null,
    })
  },
  diffBusinessDesignerCheckpoint(
    workspaceId: string,
    params?: { documentId?: string | null; base?: string | null },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDiffResult>('business_designer_diff_checkpoint', {
      traceId,
      workspaceId,
      documentId: params?.documentId ?? null,
      base: params?.base ?? null,
    })
  },
  businessDesignerCompareCheckpoints(
    workspaceId: string,
    params: { documentId?: string | null; base: string; head: string },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDiffResult>('business_designer_compare_checkpoints', {
      traceId,
      workspaceId,
      documentId: params.documentId ?? null,
      base: params.base,
      head: params.head,
    })
  },
  compareBusinessDesignerCheckpoints(
    workspaceId: string,
    params: { documentId?: string | null; base: string; head: string },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerDiffResult>('business_designer_compare_checkpoints', {
      traceId,
      workspaceId,
      documentId: params.documentId ?? null,
      base: params.base,
      head: params.head,
    })
  },
  businessDesignerListCheckpoints(
    workspaceId: string,
    params?: { documentId?: string | null },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerCheckpointHistoryResult>('business_designer_list_checkpoints', {
      traceId,
      workspaceId,
      documentId: params?.documentId ?? null,
    })
  },
  listBusinessDesignerCheckpoints(
    workspaceId: string,
    params?: { documentId?: string | null },
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerCheckpointHistoryResult>('business_designer_list_checkpoints', {
      traceId,
      workspaceId,
      documentId: params?.documentId ?? null,
    })
  },
  businessDesignerPreviewAgentTask(
    workspaceId: string,
    params: {
      traceId: string
      documentId: string
      selectedBlockIds: string[]
      provider: string
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
      baseRevision: string
    },
  ) {
    return invokeCommand<BusinessDesignerAgentTaskPreview>('business_designer_preview_agent_task', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        selectedBlockIds: params.selectedBlockIds,
        provider: params.provider,
        hostBlockId: params.hostBlockId,
        gapCodes: params.gapCodes,
        scope: params.scope,
        baseRevision: params.baseRevision,
      },
    })
  },
  previewBusinessDesignerAgentTask(
    workspaceId: string,
    params: {
      traceId: string
      documentId: string
      selectedBlockIds: string[]
      provider: string
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
      baseRevision: string
    },
  ) {
    return invokeCommand<BusinessDesignerAgentTaskPreview>('business_designer_preview_agent_task', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        selectedBlockIds: params.selectedBlockIds,
        provider: params.provider,
        hostBlockId: params.hostBlockId,
        gapCodes: params.gapCodes,
        scope: params.scope,
        baseRevision: params.baseRevision,
      },
    })
  },
  businessDesignerRunAgentCompletion(
    workspaceId: string,
    params: {
      traceId: string
      documentId: string
      targetAgentIds: string[]
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
      baseRevision: string
    },
  ) {
    return invokeCommand<BusinessDesignerAgentCompletionResult>('business_designer_run_agent_completion', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        targetAgentIds: params.targetAgentIds,
        hostBlockId: params.hostBlockId,
        gapCodes: params.gapCodes,
        scope: params.scope,
        baseRevision: params.baseRevision,
      },
    })
  },
  businessDesignerRevertToCheckpoint(
    workspaceId: string,
    params: BusinessDesignerRevertToCheckpointRequest,
  ) {
    return invokeCommand<BusinessDesignerDocumentDetail>('business_designer_revert_to_checkpoint', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        checkpoint: params.checkpoint,
      },
    })
  },
  runBusinessDesignerAgentCompletion(
    workspaceId: string,
    params: {
      traceId: string
      documentId: string
      targetAgentIds: string[]
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
      baseRevision: string
    },
  ) {
    return invokeCommand<BusinessDesignerAgentCompletionResult>('business_designer_run_agent_completion', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        targetAgentIds: params.targetAgentIds,
        hostBlockId: params.hostBlockId,
        gapCodes: params.gapCodes,
        scope: params.scope,
        baseRevision: params.baseRevision,
      },
    })
  },
  businessDesignerRunMockAgentCompletion(
    workspaceId: string,
    params: {
      traceId: string
      documentId: string
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
      baseRevision: string
      selectedBlockIds?: string[]
    },
  ) {
    return invokeCommand<BusinessDesignerPatchValidationResult>('business_designer_run_mock_agent_completion', {
      request: {
        traceId: params.traceId,
        workspaceId,
        documentId: params.documentId,
        hostBlockId: params.hostBlockId,
        gapCodes: params.gapCodes,
        scope: params.scope,
        baseRevision: params.baseRevision,
        selectedBlockIds: params.selectedBlockIds ?? [],
      },
    })
  },
  businessDesignerValidateAgentPatch(
    workspaceId: string,
    documentId: string,
    patch: BusinessDesignerAgentPatch,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerPatchValidationResult>('business_designer_validate_agent_patch', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        patch,
      },
    })
  },
  validateBusinessDesignerAgentPatch(
    workspaceId: string,
    documentId: string,
    patch: BusinessDesignerAgentPatch,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerPatchValidationResult>('business_designer_validate_agent_patch', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        patch,
      },
    })
  },
  businessDesignerRecoverAgentPatchFromTask(
    workspaceId: string,
    documentId: string,
    taskId: string,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerRecoveredAgentPatchResult>('business_designer_recover_agent_patch_from_task', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        taskId,
      },
    })
  },
  recoverBusinessDesignerAgentPatchFromTask(
    workspaceId: string,
    documentId: string,
    taskId: string,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerRecoveredAgentPatchResult>('business_designer_recover_agent_patch_from_task', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        taskId,
      },
    })
  },
  businessDesignerApplyAgentPatch(
    workspaceId: string,
    documentId: string,
    patch: BusinessDesignerAgentPatch,
    acceptedChangeIndices?: number[] | null,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerPatchApplyResult>('business_designer_apply_agent_patch', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        patch,
        acceptedChangeIndices: acceptedChangeIndices ?? null,
      },
    })
  },
  applyBusinessDesignerAgentPatch(
    workspaceId: string,
    documentId: string,
    patch: BusinessDesignerAgentPatch,
    acceptedChangeIndices?: number[] | null,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerPatchApplyResult>('business_designer_apply_agent_patch', {
      request: {
        traceId: traceId ?? null,
        workspaceId,
        documentId,
        patch,
        acceptedChangeIndices: acceptedChangeIndices ?? null,
      },
    })
  },
  businessDesignerExportDocument(
    workspaceId: string,
    documentId: string,
    format: string,
  ) {
    return invokeCommand<BusinessDesignerExportResult>('business_designer_export_document', {
      workspaceId,
      documentId,
      format,
    })
  },
  exportBusinessDesignerDocument(
    workspaceId: string,
    documentId: string,
    format: string,
  ) {
    return invokeCommand<BusinessDesignerExportResult>('business_designer_export_document', {
      workspaceId,
      documentId,
      format,
    })
  },
  businessDesignerExportDocumentToFile(
    workspaceId: string,
    documentId: string,
    format: string,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerExportResult>('business_designer_export_document_to_file', {
      traceId,
      workspaceId,
      documentId,
      format,
    })
  },
  exportBusinessDesignerDocumentToFile(
    workspaceId: string,
    documentId: string,
    format: string,
    traceId?: string,
  ) {
    return invokeCommand<BusinessDesignerExportResult>('business_designer_export_document_to_file', {
      traceId,
      workspaceId,
      documentId,
      format,
    })
  },
  businessDesignerPreviewCodingHandoff(workspaceId: string, documentId: string) {
    return invokeCommand<BusinessDesignerCodingHandoffPreview>('business_designer_preview_coding_handoff', {
      workspaceId,
      documentId,
    })
  },
  previewBusinessDesignerCodingHandoff(workspaceId: string, documentId: string) {
    return invokeCommand<BusinessDesignerCodingHandoffPreview>('business_designer_preview_coding_handoff', {
      workspaceId,
      documentId,
    })
  },
  businessDesignerDispatchCodingHandoff(
    workspaceId: string,
    documentId: string,
    targetAgentIds: string[],
  ) {
    return invokeCommand<BusinessDesignerCodingHandoffDispatchResult>('business_designer_dispatch_coding_handoff', {
      request: {
        workspaceId,
        documentId,
        targetAgentIds,
      },
    })
  },
  dispatchBusinessDesignerCodingHandoff(
    workspaceId: string,
    documentId: string,
    targetAgentIds: string[],
  ) {
    return invokeCommand<BusinessDesignerCodingHandoffDispatchResult>('business_designer_dispatch_coding_handoff', {
      request: {
        workspaceId,
        documentId,
        targetAgentIds,
      },
    })
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
  settingsUpdateStatus() {
    return invokeCommand<AppUpdateStatusResponse>('settings_update_status')
  },
  settingsUpdateCheck() {
    return invokeCommand<AppUpdateCheckResponse>('settings_update_check')
  },
  settingsUpdateDownloadAndInstall() {
    return invokeCommand<AppUpdateInstallResponse>('settings_update_download_and_install')
  },
  toolListProfiles(workspaceId: string) {
    return invokeCommand<ToolListProfilesResponse>('tool_list_profiles', { workspaceId })
  },
  toolListCommands(request: ToolListCommandsRequest) {
    return invokeCommand<ToolListCommandsResponseWire>('tool_list_commands', {
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
    }).then(normalizeToolListCommandsResponse)
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
      agentToolKind?: 'claude' | 'codex' | 'shell' | 'unknown'
      injectProviderEnv?: boolean
      /** When false, skip login-shell startup for faster PTY (PATH must be set via env). */
      loginShell?: boolean
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
      loginShell: options?.loginShell ?? null,
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
  aiConfigFetchModels(
    baseUrl: string,
    apiKey: string,
    options?: {
      isFullUrl?: boolean
      modelsUrlOverride?: string | null
    },
  ) {
    return invokeCommand<AiConfigFetchedModel[]>('ai_config_fetch_models', {
      baseUrl,
      apiKey,
      isFullUrl: options?.isFullUrl ?? null,
      modelsUrlOverride: options?.modelsUrlOverride ?? null,
    })
  },
  aiConfigTestEndpoints(urls: string[], timeoutSecs?: number | null) {
    return invokeCommand<AiConfigEndpointTestResult[]>('ai_config_test_endpoints', {
      urls,
      timeoutSecs: timeoutSecs ?? null,
    })
  },
  aiConfigImportCurrent(
    workspaceId: string | null | undefined,
    agent: AiConfigAgent,
    confirmedBy: string,
  ) {
    return invokeCommand<AiConfigApplyResponse>('ai_config_import_current', {
      workspaceId: workspaceId ?? null,
      agent,
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
  agentInstallStatus(agent: 'ClaudeCode' | 'Codex') {
    return invokeCommand<AgentInstallStatus>('agent_install_status', { agent })
  },
  installAgent(agent: 'ClaudeCode' | 'Codex') {
    return invokeCommand<void>('install_agent', { agent })
  },
  uninstallAgent(agent: 'ClaudeCode' | 'Codex') {
    return invokeCommand<void>('uninstall_agent', { agent })
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
  terminalWrite(workspaceId: string, sessionId: string, input: string) {
    return invokeCommand<TerminalWriteResponse>('terminal_write', {
      workspaceId,
      sessionId,
      input,
    })
  },
  terminalWriteWithSubmit(
    workspaceId: string,
    sessionId: string,
    input: string,
    submitSequence?: string | null,
  ) {
    return invokeCommand<TerminalWriteResponse>('terminal_write_with_submit', {
      workspaceId,
      sessionId,
      input,
      submitSequence: submitSequence ?? null,
    })
  },
  terminalResize(workspaceId: string, sessionId: string, cols: number, rows: number) {
    return invokeCommand<TerminalResizeResponse>('terminal_resize', {
      workspaceId,
      sessionId,
      cols,
      rows,
    })
  },
  terminalKill(workspaceId: string, sessionId: string, signal?: string) {
    return invokeCommand<TerminalKillResponse>('terminal_kill', {
      workspaceId,
      sessionId,
      signal: signal ?? null,
    })
  },
  terminalHasSession(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalHasSessionResponse>('terminal_has_session', {
      workspaceId,
      sessionId,
    })
  },
  terminalSetVisibility(workspaceId: string, sessionId: string, visible: boolean) {
    return invokeCommand<TerminalVisibilityResponse>('terminal_set_visibility', {
      workspaceId,
      sessionId,
      visible,
    })
  },
  terminalReadSnapshot(workspaceId: string, sessionId: string, maxBytes?: number) {
    return invokeCommand<TerminalSnapshotResponse>('terminal_read_snapshot', {
      workspaceId,
      sessionId,
      maxBytes: maxBytes ?? null,
    })
  },
  terminalReadDelta(workspaceId: string, sessionId: string, afterSeq: number, maxBytes?: number) {
    return invokeCommand<TerminalDeltaResponse>('terminal_read_delta', {
      workspaceId,
      sessionId,
      afterSeq,
      maxBytes: maxBytes ?? null,
    })
  },
  terminalDescribeProcesses(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalDescribeProcessesResponse>('terminal_describe_processes', {
      workspaceId,
      sessionId,
    })
  },
  terminalActivate(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalRenderedScreenResponse>('terminal_activate', {
      workspaceId,
      sessionId,
    })
  },
  terminalGetRenderedScreen(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalRenderedScreenResponse>('terminal_get_rendered_screen', {
      workspaceId,
      sessionId,
    })
  },
  terminalOpenOutputChannel(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalOpenOutputChannelResponse>('terminal_open_output_channel', {
      workspaceId,
      sessionId,
    })
  },
  terminalReportRenderedScreen(
    workspaceId: string,
    snapshot: RenderedScreenSnapshot,
    toolKind?: string | null,
  ) {
    return invokeCommand<TerminalReportRenderedScreenResponse>('terminal_report_rendered_screen', {
      workspaceId,
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
  terminalDebugClearHumanLog(workspaceId: string, sessionId: string) {
    return invokeCommand<TerminalDebugClearHumanLogResponse>('terminal_debug_clear_human_log', {
      workspaceId,
      sessionId,
    })
  },
  terminalDebugAppendFrontendFocusLog(entry: {
    atMs: number
    workspaceId?: string | null
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
          workspaceId: entry.workspaceId ?? null,
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
  channelConnectorAccountDelete(channel: string, accountId?: string | null) {
    return invokeCommand<ChannelConnectorAccountDeleteResponse>(
      'channel_connector_account_delete',
      {
        request: {
          channel,
          accountId: accountId ?? null,
        },
      },
    )
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
  feishuQrLoginStart(domain?: string | null) {
    return invokeCommand<{ channel: string; result: FeishuQrLoginBeginResult }>(
      'feishu_qr_login_start',
      {
        request: {
          domain: domain ?? null,
        },
      },
    )
  },

  feishuQrLoginCancel() {
    return invokeCommand<{ channel: string; cancelled: boolean }>(
      'feishu_qr_login_cancel',
      {
        request: {},
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
    return invokeCommand<ChannelBindingDeleteResponse>('channel_binding_delete', {
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
  agentList(workspaceId: string) {
    return invokeCommand<AgentListResponse>('agent_list', { workspaceId })
  },
  agentCreate(request: AgentCreateRequest) {
    return invokeCommand<AgentCreateResponse>('agent_create', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId ?? null,
        name: request.name,
        tool: request.tool ?? null,
        workdir: request.workdir ?? null,
        customWorkdir: request.customWorkdir ?? false,
        employeeNo: request.employeeNo ?? null,
        state: request.state ?? null,
        promptEnabled: request.promptEnabled ?? false,
        promptFileName: request.promptFileName ?? null,
        promptContent: request.promptContent ?? null,
        launchCommand: request.launchCommand ?? null,
      },
    })
  },
  agentUpdate(request: AgentUpdateRequest) {
    return invokeCommand<AgentUpdateResponse>('agent_update', {
      request: {
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        name: request.name,
        tool: request.tool ?? null,
        workdir: request.workdir ?? null,
        customWorkdir: request.customWorkdir ?? false,
        employeeNo: request.employeeNo ?? null,
        state: request.state ?? null,
        promptEnabled: request.promptEnabled ?? false,
        promptFileName: request.promptFileName ?? null,
        promptContent: request.promptContent ?? null,
        launchCommand: request.launchCommand ?? null,
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
  agentReorder(request: AgentReorderRequest) {
    return invokeCommand<{ reordered: boolean }>('agent_reorder', {
      request: {
        workspaceId: request.workspaceId,
        orderedAgentIds: request.orderedAgentIds,
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
      const unlisten = await window.onResized(onResized)
      return createSafeAsyncCleanup([unlisten])
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

    return createSafeAsyncCleanup([unlistenOutput, unlistenState, unlistenMeta])
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

    return createSafeAsyncCleanup([
      unlistenMessage,
      unlistenAck,
      unlistenDispatchProgress,
      unlistenExternalInbound,
      unlistenExternalRouted,
      unlistenExternalDispatchProgress,
      unlistenExternalReply,
      unlistenExternalOutboundResult,
      unlistenExternalError,
    ])
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
    return createSafeAsyncCleanup([unlistenChanged])
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
    return createSafeAsyncCleanup([unlisten])
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

    return createSafeAsyncCleanup([unlistenChunk, unlistenBackpressure, unlistenDone, unlistenCancelled])
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
    return createSafeAsyncCleanup([unlisten])
  },
  async subscribeAppUpdateProgress(
    onUpdated: (payload: AppUpdateProgressPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<AppUpdateProgressPayload>('settings/update_progress', (event) =>
      onUpdated(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
  },
  async subscribeGitUpdated(onUpdated: (payload: GitUpdatedPayload) => void): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<GitUpdatedPayload>('git/updated', (event) =>
      onUpdated(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
  },
  async subscribeSessionActivity(onActivity: (payload: SessionActivityEventPayload) => void): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<SessionActivityEventPayload>('gtoffice:session-activity', (event) =>
      onActivity(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
  },
  async subscribeGitRemoteOperation(
    onUpdated: (payload: GitRemoteOperationPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<GitRemoteOperationPayload>(
      'git/remote_operation',
      (event) => onUpdated(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
  },
  async subscribeWorkspaceEvents(handlers: {
    onUpdated?: (payload: WorkspaceUpdatedPayload) => void
    onActiveChanged?: (payload: WorkspaceActiveChangedPayload) => void
  }): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlistenUpdated = await eventApi.listen<WorkspaceUpdatedPayload>(
      'workspace/updated',
      (event: { payload: WorkspaceUpdatedPayload }) => handlers.onUpdated?.(event.payload),
    )
    const unlistenActiveChanged = await eventApi.listen<WorkspaceActiveChangedPayload>(
      'workspace/active_changed',
      (event: { payload: WorkspaceActiveChangedPayload }) => handlers.onActiveChanged?.(event.payload),
    )
    return createSafeAsyncCleanup([unlistenUpdated, unlistenActiveChanged])
  },
  async subscribeWorkspaceWindowClosed(
    onWindowClosed: (payload: WorkspaceWindowClosedPayload) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<WorkspaceWindowClosedPayload>(
      'workspace/window_closed',
      (event: { payload: WorkspaceWindowClosedPayload }) => onWindowClosed(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
  },
  async listenInstallProgress(
    agent: AiConfigAgent,
    onMessage: (message: AgentInstallProgressEvent) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {}
    }

    const eventApi = await import('@tauri-apps/api/event')
    const unlisten = await eventApi.listen<AgentInstallProgressEvent>(`install-progress:${agent}`, (event) =>
      onMessage(event.payload),
    )
    return createSafeAsyncCleanup([unlisten])
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
    return createSafeAsyncCleanup([unlistenClosed, unlistenUpdated, unlistenBridge])
  },

  // ── Session History ──
  sessionList(workspaceId: string, provider?: SessionProvider | null, limit?: number, offset?: number) {
    return invokeCommand<SessionListResponse>('session_list', {
      workspaceId,
      provider: provider ?? null,
      limit: limit ?? null,
      offset: offset ?? null,
    })
  },
  sessionDiscover(
    workspaceId: string,
    cwd: string,
    provider?: SessionProvider | null,
    force = false,
  ) {
    return invokeCommand<SessionDiscoverResponse>('session_discover', {
      workspaceId,
      cwd,
      provider: provider ?? null,
      force,
    })
  },
  sessionGet(workspaceId: string, gtoSessionId: string) {
    return invokeCommand<SessionDetailResponse>('session_get', {
      workspaceId,
      gtoSessionId,
    })
  },
  sessionLaunch(params: {
    workspaceId: string
    stationId: string
    agentId: string
    provider: SessionProvider
    cwd: string
    terminalSessionId?: string | null
  }) {
    return invokeCommand<{ gtoSessionId: string }>('session_launch', {
      workspaceId: params.workspaceId,
      stationId: params.stationId,
      agentId: params.agentId,
      provider: params.provider,
      cwd: params.cwd,
      terminalSessionId: params.terminalSessionId ?? null,
    })
  },
  sessionResumeBind(params: {
    workspaceId: string
    gtoSessionId: string
    terminalSessionId: string
    stationId: string
    agentId: string
  }) {
    return invokeCommand<{ ok: boolean }>('session_resume_bind', params)
  },
  sessionEnd(workspaceId: string, gtoSessionId: string) {
    return invokeCommand<{ ok: boolean }>('session_end', {
      workspaceId,
      gtoSessionId,
    })
  },
  sessionResumeCheck(params: {
    workspaceId?: string | null
    gtoSessionId?: string | null
    relaunchMode?: SessionRelaunchMode
    expectedProvider?: SessionProvider | null
  }) {
    return invokeCommand<SessionResumeCheckResponse>('session_resume_check', {
      workspaceId: params.workspaceId ?? null,
      gtoSessionId: params.gtoSessionId ?? null,
      relaunchMode: params.relaunchMode ?? 'resume',
      expectedProvider: params.expectedProvider ?? null,
    })
  },
  sessionUpdateTitle(workspaceId: string, gtoSessionId: string, title: string) {
    return invokeCommand<{ ok: boolean }>('session_update_title', {
      workspaceId,
      gtoSessionId,
      title,
    })
  },
  sessionChangefeedQuery(workspaceId: string) {
    return invokeCommand<{ snapshot: unknown }>('session_changefeed_query', {
      workspaceId,
    })
  },
  sessionChangefeedPush(params: {
    workspaceId: string
    branch: string
    dirty: boolean
    ahead: number
    behind: number
    stagedFiles: number
    unstagedFiles: number
    untrackedFiles: number
    revision: number
  }) {
    return invokeCommand<{ emitted: boolean }>('session_changefeed_push', params)
  },
}
