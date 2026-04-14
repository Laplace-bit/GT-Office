import { normalizeTaskQuickDispatchOpacity } from '@features/task-center'
import { buildStationTerminalIdleBanner } from '@features/terminal/station-terminal-idle-banner'
import {
  DEFAULT_WORKBENCH_CUSTOM_LAYOUT,
  isWorkbenchLayoutMode,
  type AgentStation,
  type CreateStationInput,
  type UpdateStationInput,
  type WorkbenchContainerModel,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import { buildRoleWorkdirRel, buildStationWorkdirs } from '@features/workspace'
import type {
  AgentRuntimeRegisterRequest,
  GitStatusResponse,
  GitUpdatedPayload,
} from '../integration/desktop-api'
import type { NavItemId } from './navigation-model'

export type FileReadMode = 'full'

export type StationTerminalRuntime = {
  sessionId: string | null
  stateRaw: string
  unreadCount: number
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
}

export type DetachedProjectionTarget = {
  containerId: string
  windowLabel: string
}

export type ExternalChannelEventItem = {
  id: string
  tsMs: number
  kind: 'inbound' | 'routed' | 'dispatch' | 'reply' | 'outbound' | 'error'
  primary: string
  channel?: string
  status?: 'received' | 'sent' | 'failed'
  secondary?: string
  detail?: string
  mergeKey?: string
  traceId?: string
  accountId?: string
  peerKind?: 'direct' | 'group'
  peerId?: string
  senderId?: string
  targetAgentId?: string
  endpointKey?: string
  conversationKey?: string
}

export type ExternalTraceContext = {
  channel: string
  accountId: string
  peerKind: 'direct' | 'group'
  peerId: string
  senderId: string
  endpointKey: string
  targetAgentId?: string
}

export type TelegramInboundDebugToast = {
  nonce: number
  receivedAtMs: number
  accountId: string
  senderId: string
  senderName?: string | null
  peerId: string
  messageId: string
  text: string
}

export type FileEditorCommandRequest = {
  type: 'find' | 'replace' | 'findNext' | 'findPrevious' | 'gotoLine'
  nonce: number
  line?: number
  targetPath?: string | null
}

export const STATION_INPUT_FLUSH_MS = 12
export const STATION_INPUT_MAX_BUFFER_BYTES = 65536
const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24
export const STATION_TASK_SUBMIT_MAX_RETRY_FRAMES = 8
export const TASK_DISPATCH_HISTORY_LIMIT = 40
export const TASK_DRAFT_PERSIST_DEBOUNCE_MS = 360
export const SHELL_LAYOUT_STORAGE_KEY = 'gtoffice.shell.layout.v2'
const CANVAS_LAYOUT_MIN = 1
const CANVAS_LAYOUT_MAX = 8
export const WORKSPACE_MEMORY_STORAGE_KEY = 'gtoffice.shell.lastWorkspace.v1'
export const WORKSPACE_AUTO_OPEN_DEBOUNCE_MS = 420
export const WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS = 560
export const WORKSPACE_SESSION_MAX_RESTORE_TABS = 8
export const WORKSPACE_SESSION_MAX_RESTORE_TERMINALS = 6
export const STATION_TASK_SIGNAL_VISIBLE_MS = 3200
export const EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT = 36
export const EXTERNAL_CHANNEL_STATUS_POLL_MS = 15000
export const TELEGRAM_DEBUG_TOAST_VISIBLE_MS = 6000
export const LEFT_PANE_WIDTH_MIN = 210
export const LEFT_PANE_WIDTH_MAX = 1200
export const LEFT_PANE_WIDTH_DEFAULT = 270
export const RIGHT_PANE_WIDTH_MIN = 280
export const RIGHT_PANE_WIDTH_MAX = 1600
export const RIGHT_PANE_WIDTH_DEFAULT = 360
export const SHELL_MAIN_CONTENT_MIN_SHARE = 0.35
export const SHELL_RIGHT_PANE_MAX_SHARE = 1 - SHELL_MAIN_CONTENT_MIN_SHARE

export function resolveShellMainContentMinWidth(availableWidth: number): number {
  return Math.max(0, Math.round(availableWidth * SHELL_MAIN_CONTENT_MIN_SHARE))
}
export function buildDefaultWorkbenchContainerId(): string {
  return 'canvas-main'
}

export function buildFloatingContainerId(seed: number): string {
  return `container-${seed.toString(36)}`
}

export function buildWorkbenchContainerTitle(
  container: WorkbenchContainerModel,
  stations: AgentStation[],
): string {
  const activeStation =
    (container.activeStationId
      ? stations.find((station) => station.id === container.activeStationId) ?? null
      : null) ??
    stations.find((station) => container.stationIds.includes(station.id)) ??
    null
  if (!activeStation) {
    return 'GT Office Surface'
  }
  if (container.stationIds.length <= 1) {
    return activeStation.name
  }
  return `${activeStation.name} +${container.stationIds.length - 1}`
}

export function normalizeStationToolKind(
  tool: string | null | undefined,
): NonNullable<AgentRuntimeRegisterRequest['toolKind']> {
  const normalized = tool?.trim().toLowerCase() ?? ''
  if (normalized.includes('claude')) {
    return 'claude'
  }
  if (normalized.includes('codex')) {
    return 'codex'
  }
  if (normalized.includes('gemini')) {
    return 'gemini'
  }
  if (normalized.includes('shell')) {
    return 'shell'
  }
  return 'unknown'
}

export function buildStationLaunchCommand(station: AgentStation): string | null {
  if (station.launchCommand?.trim()) {
    return station.launchCommand.trim() + '\n'
  }
  switch (normalizeStationToolKind(station.tool)) {
    case 'claude':
      return 'claude\n'
    case 'codex':
      return 'codex\n'
    case 'gemini':
      return 'gemini\n'
    default:
      return null
  }
}

function isDigitsOnly(value: string): boolean {
  return value.length > 0 && /^\d+$/.test(value)
}

export function summarizeExternalChannelText(
  value: string | null | undefined,
  maxChars = 4096,
): string | null {
  const normalized = (value ?? '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) {
    return null
  }
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars)}…`
}

export function normalizeExternalChannel(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return 'external'
  }
  return normalized
}

export function buildExternalEndpointKey(input: {
  channel?: string | null
  accountId?: string | null
  peerKind?: string | null
  peerId?: string | null
}): string {
  const channel = normalizeExternalChannel(input.channel)
  const accountId = input.accountId?.trim() || 'default'
  const peerKind = input.peerKind?.trim() || 'direct'
  const peerId = input.peerId?.trim() || 'unknown-peer'
  return `${channel}::${accountId}::${peerKind}::${peerId}`
}

export function buildExternalConversationKey(
  endpointKey: string,
  targetAgentId?: string | null,
): string {
  const target = targetAgentId?.trim()
  if (!target) {
    return `${endpointKey}::pending`
  }
  return `${endpointKey}::target::${target}`
}

function isCsiUEnterSequence(raw: string): boolean {
  if (!raw.startsWith('\x1b[13;') || !raw.endsWith('u')) {
    return false
  }
  return isDigitsOnly(raw.slice('\x1b[13;'.length, -1))
}

function isCsiTildeEnterSequence(raw: string): boolean {
  if (raw === '\x1b[13~') {
    return true
  }
  if (!raw.startsWith('\x1b[13;') || !raw.endsWith('~')) {
    return false
  }
  return isDigitsOnly(raw.slice('\x1b[13;'.length, -1))
}

function isModifyOtherKeysEnterSequence(raw: string): boolean {
  if (!raw.startsWith('\x1b[27;13;') || !raw.endsWith('~')) {
    return false
  }
  return isDigitsOnly(raw.slice('\x1b[27;13;'.length, -1))
}

export function normalizeSubmitSequence(raw: string): string | null {
  if (raw === '\r' || raw === '\n' || raw === '\r\n') {
    return '\r'
  }
  if (raw === '\x1bOM') {
    return raw
  }
  if (
    isCsiUEnterSequence(raw) ||
    isCsiTildeEnterSequence(raw) ||
    isModifyOtherKeysEnterSequence(raw)
  ) {
    return raw
  }
  return null
}

export function shouldFlushStationInputImmediately(input: string): boolean {
  if (!input) {
    return false
  }
  if (input.includes('\n') || input.includes('\r')) {
    return true
  }
  if (input.length >= STATION_INPUT_IMMEDIATE_CHUNK_BYTES) {
    return true
  }
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if ((code >= 0 && code < 32) || code === 127) {
      return true
    }
  }
  return input.includes('\u001b')
}

const NAV_ITEM_ID_SET = new Set<NavItemId>([
  'stations',
  'tasks',
  'files',
  'git',
  'hooks',
  'channels',
  'policy',
])

export function isNavItemId(value: string): value is NavItemId {
  return NAV_ITEM_ID_SET.has(value as NavItemId)
}

export function clampLeftPaneWidth(width: number, maxWidth = LEFT_PANE_WIDTH_MAX): number {
  return Math.max(LEFT_PANE_WIDTH_MIN, Math.min(maxWidth, Math.round(width)))
}

export function resolveLeftPaneWidthMax(containerWidth: number, reservedWidth = 0): number {
  return Math.max(
    LEFT_PANE_WIDTH_MIN,
    Math.min(LEFT_PANE_WIDTH_MAX, Math.round(containerWidth - reservedWidth)),
  )
}

export function clampRightPaneWidth(width: number, maxWidth = RIGHT_PANE_WIDTH_MAX): number {
  return Math.max(RIGHT_PANE_WIDTH_MIN, Math.min(maxWidth, Math.round(width)))
}

export function resolveRightPaneWidthMax(availableWidth: number): number {
  return Math.max(
    RIGHT_PANE_WIDTH_MIN,
    Math.min(RIGHT_PANE_WIDTH_MAX, Math.round(availableWidth * SHELL_RIGHT_PANE_MAX_SHARE)),
  )
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function isCodeEditorKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.cm-editor, .codemirror-editor-container'))
}

export function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('.xterm-helper-textarea, .xterm, .station-terminal-shell'))
  )
}

export function shouldPreventDesktopBrowserShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return false
  }
  const key = event.key.toLowerCase()
  return key === 'r' || key === '+' || key === '=' || key === '-' || key === '0'
}

function clampCanvasLayoutValue(value: number): number {
  return Math.max(CANVAS_LAYOUT_MIN, Math.min(CANVAS_LAYOUT_MAX, Math.round(value)))
}

export function normalizeCanvasCustomLayout(
  layout: Partial<WorkbenchCustomLayout> | null | undefined,
): WorkbenchCustomLayout {
  return {
    columns: clampCanvasLayoutValue(layout?.columns ?? DEFAULT_WORKBENCH_CUSTOM_LAYOUT.columns),
    rows: clampCanvasLayoutValue(layout?.rows ?? DEFAULT_WORKBENCH_CUSTOM_LAYOUT.rows),
  }
}

function mapLegacyLayoutPreset(
  preset: unknown,
): { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } | null {
  switch (preset) {
    case 'auto':
      return { mode: 'auto', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
    case 'focus':
      return { mode: 'focus', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
    case '1*1':
      return { mode: 'custom', customLayout: { columns: 1, rows: 1 } }
    case '1*2':
      return { mode: 'custom', customLayout: { columns: 1, rows: 2 } }
    case '2*1':
      return { mode: 'custom', customLayout: { columns: 2, rows: 1 } }
    case '2*2':
      return { mode: 'custom', customLayout: { columns: 2, rows: 2 } }
    case '3*2':
      return { mode: 'custom', customLayout: { columns: 3, rows: 2 } }
    case '4*2':
      return { mode: 'custom', customLayout: { columns: 4, rows: 2 } }
    default:
      return null
  }
}

export function loadCanvasLayoutPreference(): {
  mode: WorkbenchLayoutMode
  customLayout: WorkbenchCustomLayout
} {
  if (typeof window === 'undefined') {
    return { mode: 'auto', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
  }
  try {
    const raw = window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)
    if (!raw) {
      return { mode: 'auto', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
    }
    const parsed = JSON.parse(raw) as {
      canvasLayoutMode?: WorkbenchLayoutMode
      canvasCustomLayout?: WorkbenchCustomLayout
      canvasLayoutPreset?: string
    }
    if (isWorkbenchLayoutMode(parsed.canvasLayoutMode)) {
      return {
        mode: parsed.canvasLayoutMode,
        customLayout: normalizeCanvasCustomLayout(parsed.canvasCustomLayout),
      }
    }
    const legacy = mapLegacyLayoutPreset(parsed.canvasLayoutPreset)
    if (legacy) {
      return {
        mode: legacy.mode,
        customLayout: normalizeCanvasCustomLayout(legacy.customLayout),
      }
    }
    return { mode: 'auto', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
  } catch {
    return { mode: 'auto', customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT }
  }
}

export function loadLeftPaneWidthPreference(): number {
  if (typeof window === 'undefined') {
    return LEFT_PANE_WIDTH_DEFAULT
  }
  try {
    const raw = window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)
    if (!raw) {
      return LEFT_PANE_WIDTH_DEFAULT
    }
    const parsed = JSON.parse(raw) as { leftPaneWidth?: number }
    if (typeof parsed.leftPaneWidth !== 'number') {
      return LEFT_PANE_WIDTH_DEFAULT
    }
    return clampLeftPaneWidth(parsed.leftPaneWidth)
  } catch {
    return LEFT_PANE_WIDTH_DEFAULT
  }
}

export function loadRightPaneWidthPreference(): number {
  if (typeof window === 'undefined') {
    return RIGHT_PANE_WIDTH_DEFAULT
  }
  try {
    const raw = window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)
    if (!raw) {
      return RIGHT_PANE_WIDTH_DEFAULT
    }
    const parsed = JSON.parse(raw) as { rightPaneWidth?: number }
    if (typeof parsed.rightPaneWidth !== 'number') {
      return RIGHT_PANE_WIDTH_DEFAULT
    }
    return clampRightPaneWidth(parsed.rightPaneWidth)
  } catch {
    return RIGHT_PANE_WIDTH_DEFAULT
  }
}

export function loadRememberedWorkspacePath(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_MEMORY_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { path?: string | null }
    if (parsed && typeof parsed.path === 'string' && parsed.path.trim()) {
      return parsed.path
    }
  } catch {
    // Ignore parse errors and fall back to empty memory state.
  }
  return null
}

export function rememberWorkspacePath(input: {
  path: string
  workspaceId?: string | null
  name?: string | null
}) {
  if (typeof window === 'undefined') {
    return
  }
  const normalized = normalizeFsPath(input.path)
  if (!normalized) {
    return
  }
  try {
    window.localStorage.setItem(
      WORKSPACE_MEMORY_STORAGE_KEY,
      JSON.stringify({
        path: normalized,
        workspaceId: input.workspaceId ?? null,
        name: input.name ?? null,
        updatedAt: Date.now(),
      }),
    )
  } catch {
    // Best effort only.
  }
}

export function createInitialStationTerminals(
  stations: AgentStation[],
): Record<string, StationTerminalRuntime> {
  return stations.reduce<Record<string, StationTerminalRuntime>>((acc, station) => {
    acc[station.id] = {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    }
    return acc
  }, {})
}

export function getStationIdleBanner(station: AgentStation | undefined): string {
  if (!station) {
    return ''
  }
  return buildStationTerminalIdleBanner()
}

export function describeError(error: unknown): string {
  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed || 'unknown'
  }
  if (error instanceof Error) {
    const trimmed = error.message.trim()
    if (trimmed) {
      return trimmed
    }
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'detail', 'error']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      // Keep fallback below.
    }
  }
  return 'unknown'
}

export function readRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  return input as Record<string, unknown>
}

export function readString(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const trimmed = input.trim()
  return trimmed ? trimmed : null
}

export function readNumber(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input
  }
  if (typeof input === 'string') {
    const parsed = Number(input)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

export function isMacOsPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /mac/i.test(`${navigator.platform} ${navigator.userAgent}`)
}

export function isLinuxPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /linux/i.test(`${navigator.platform} ${navigator.userAgent}`)
}

export function remapSelectedPathAfterMove(
  selectedPath: string | null,
  fromPath: string,
  toPath: string,
): string | null {
  if (!selectedPath) {
    return null
  }
  if (selectedPath === fromPath) {
    return toPath
  }
  const prefix = `${fromPath}/`
  if (selectedPath.startsWith(prefix)) {
    return `${toPath}${selectedPath.slice(fromPath.length)}`
  }
  return selectedPath
}

export function normalizeFsPath(path: string): string {
  const withForwardSlash = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/^\/\/\.\//, '')
  const isUncLike = withForwardSlash.startsWith('//')
  const collapsed = withForwardSlash.replace(/\/+/g, '/')
  const normalized = isUncLike ? `/${collapsed}` : collapsed
  if (!normalized) {
    return ''
  }
  if (/^[A-Za-z]:\/$/.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/$/, '')
}

export function parseDriveStylePath(path: string): { drive: string; rest: string } | null {
  const normalized = normalizeFsPath(path)
  if (!normalized) {
    return null
  }
  const windows = normalized.match(/^([A-Za-z]):(?:\/(.*))?$/)
  if (windows) {
    return {
      drive: windows[1].toLowerCase(),
      rest: windows[2] ?? '',
    }
  }
  const wslMount = normalized.match(/^\/mnt\/([A-Za-z])(?:\/(.*))?$/i)
  if (wslMount) {
    return {
      drive: wslMount[1].toLowerCase(),
      rest: wslMount[2] ?? '',
    }
  }
  return null
}

export function normalizeRelativeFsPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

export function normalizeStationWorkdirInput(path: string): string | null {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/^\/\/\.\//, '')
    .replace(/\/+/g, '/')
  if (!normalized) {
    return ''
  }
  if (normalized === '.' || normalized === './') {
    return '.'
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null
  }
  const segments = normalized
    .replace(/^\/+/, '')
    .replace(/\/$/, '')
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..' || segment.includes(':'))) {
    return null
  }
  return segments.join('/') || '.'
}

export function toRelativePathIfInside(
  selectedAbsPath: string,
  workspaceRoot: string,
): string | null {
  const selected = normalizeFsPath(selectedAbsPath)
  const root = normalizeFsPath(workspaceRoot)
  if (!selected || !root) {
    return null
  }
  const selectedDrivePath = parseDriveStylePath(selected)
  const rootDrivePath = parseDriveStylePath(root)
  if (selectedDrivePath && rootDrivePath && selectedDrivePath.drive === rootDrivePath.drive) {
    const selectedRest = normalizeRelativeFsPath(selectedDrivePath.rest)
    const rootRest = normalizeRelativeFsPath(rootDrivePath.rest)
    const selectedRestLower = selectedRest.toLowerCase()
    const rootRestLower = rootRest.toLowerCase()
    if (selectedRestLower === rootRestLower) {
      return '.'
    }
    if (!rootRestLower) {
      return selectedRest || '.'
    }
    const prefix = `${rootRestLower}/`
    if (selectedRestLower.startsWith(prefix)) {
      return selectedRest.slice(rootRest.length + 1)
    }
    return null
  }
  const selectedForCompare = selected.toLowerCase()
  const rootForCompare = root.toLowerCase()
  if (selectedForCompare === rootForCompare) {
    return '.'
  }
  const prefix = `${rootForCompare}/`
  if (!selectedForCompare.startsWith(prefix)) {
    return null
  }
  return selected.slice(root.length + 1)
}

export function nextStationNumber(stations: AgentStation[]): number {
  const max = stations.reduce((acc, station) => {
    const matched = station.id.match(/(\d+)$/)
    if (!matched) {
      return acc
    }
    const parsed = Number.parseInt(matched[1], 10)
    return Number.isNaN(parsed) ? acc : Math.max(acc, parsed)
  }, 0)
  return max + 1
}

export function createStationFromNumber(
  number: number,
  workspaceId?: string | null,
  input?: Partial<CreateStationInput>,
): AgentStation {
  const suffix = String(number).padStart(2, '0')
  const id = `agent-${suffix}`
  const role = input?.role ?? 'product'
  const roleName = input?.roleName?.trim() || role
  const normalizedWorkdir = normalizeStationWorkdirInput(input?.workdir ?? '')
  const hasCustomWorkdir = input?.customWorkdir ?? false
  const defaultWorkdir = buildStationWorkdirs(role, input?.name?.trim() || id).agentWorkdirRel
  const workdir = hasCustomWorkdir
    ? normalizedWorkdir || defaultWorkdir
    : defaultWorkdir
  const tool = input?.tool?.trim() ? input.tool.trim() : 'codex cli'
  return {
    id,
    name: input?.name?.trim() ? input.name.trim() : `角色-${suffix}`,
    roleId: input?.roleId?.trim() || `local-role-${role}`,
    role,
    roleName,
    roleWorkdirRel: buildRoleWorkdirRel(role),
    agentWorkdirRel: workdir,
    customWorkdir: hasCustomWorkdir,
    tool,
    toolKind: normalizeStationToolKind(tool),
    promptFileName: null,
    promptFileRelativePath: null,
    launchCommand: input?.launchCommand ?? null,
    terminalSessionId: `ts_${String(number).padStart(3, '0')}`,
    state: 'idle',
    workspaceId: workspaceId ?? 'ws_gtoffice',
    orderIndex: 0,
  }
}

export function createStationEditInput(station: AgentStation): UpdateStationInput {
  return {
    id: station.id,
    name: station.name,
    roleId: station.roleId,
    role: station.role,
    roleName: station.roleName,
    tool: station.tool,
    workdir: station.agentWorkdirRel,
    customWorkdir: station.customWorkdir,
    promptContent: '',
    launchCommand: station.launchCommand,
  }
}

export function gitSummaryFromUpdatedPayload(payload: GitUpdatedPayload): GitStatusResponse | null {
  if (!payload.available) {
    return null
  }
  return {
    workspaceId: payload.workspaceId,
    branch: payload.branch,
    ahead: payload.ahead,
    behind: payload.behind,
    files: payload.files,
  }
}

export function readTaskQuickDispatchOpacityFromSettings(
  values: Record<string, unknown>,
): number | null {
  const ui = values.ui
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) {
    return null
  }
  const taskQuickDispatch = (ui as Record<string, unknown>).taskQuickDispatch
  if (
    !taskQuickDispatch ||
    typeof taskQuickDispatch !== 'object' ||
    Array.isArray(taskQuickDispatch)
  ) {
    return null
  }
  const opacity = (taskQuickDispatch as Record<string, unknown>).opacity
  if (typeof opacity !== 'number') {
    return null
  }
  return normalizeTaskQuickDispatchOpacity(opacity)
}
