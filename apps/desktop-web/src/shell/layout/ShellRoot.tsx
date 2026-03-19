import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { FileEditorPane, FileTreePane, type OpenedFile } from '@features/file-explorer'
import {
  GitHistoryPane,
  GitOperationsPane,
  isNotGitRepositoryError,
  useGitWorkspaceController,
} from '@features/git'
import {
  formatShortcutBinding,
  areShortcutBindingsEqual,
  defaultShortcutBindings,
  matchesShortcutEvent,
  resolveShortcutBindingsFromSettings,
  shortcutBindingToKeystroke,
  type ShortcutBinding,
} from '@features/keybindings'
import {
  DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  GlobalTaskDispatchOverlay,
  TaskCenterPane,
  areTaskTargetsEqual,
  buildTaskCenterDraftFilePath,
  buildTaskDispatchCommand,
  createInitialTaskDraft,
  normalizeTaskQuickDispatchOpacity,
  resolveValidTaskTargets,
  useTaskDispatchActions,
  useTaskCenterDraftPersistence,
  type StationTaskSignal,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from '@features/task-center'
import { SettingsModal } from '@features/settings'
import type { StationTerminalSink, StationTerminalSinkBindingHandler } from '@features/terminal'
import {
  buildStationChannelBotBindingMap,
  ChannelStudio,
  CommunicationChannelsPane,
  resolveConnectorAccounts,
} from '@features/tool-adapter'
import {
  createDefaultStations,
  mapAgentProfileToStation,
  StationManageModal,
  StationSearchModal,
  WorkbenchCanvas,
  type AgentStation,
  type CreateStationInput,
  type UpdateStationInput,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import {
  buildAgentWorkspaceMarkerPath,
  buildRoleWorkdirRel,
  buildStationWorkdirs,
  buildWorkspaceSessionFilePath,
  buildWorkspaceSessionSnapshot,
  defaultStationOverviewState,
  filterStationsForOverview,
  parseWorkspaceSessionSnapshot,
  resolveAgentWorkdirAbs,
  serializeWorkspaceSessionSnapshot,
  StationOverviewPane,
  type WorkspaceSessionTerminalSnapshot,
} from '@features/workspace'
import {
  getNavItems,
  getPaneModels,
  type NavItemId,
} from './navigation-model'
import { ActivityRail } from './ActivityRail'
import { AmbientBackgroundLighting } from './AmbientBackgroundLighting'
import { LeftBusinessPane } from './LeftBusinessPane'
import { StatusBar } from './StatusBar'
import { TopControlBar } from './TopControlBar'
import {
  type ChannelMessagePayload,
  type ExternalChannelInboundPayload,
  type ExternalChannelOutboundResultPayload,
  type AgentRole,
  type AgentRuntimeRegisterRequest,
  type ChannelRouteBinding,
  desktopApi,
  type FilesystemChangedPayload,
  type FsSearchFileMatch,
  type GitStatusResponse,
  type RenderedScreenSnapshot,
  type TerminalMetaPayload,
  type TerminalOutputPayload,
  type TerminalStatePayload,
} from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import {
  applyUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
  type AmbientLightingIntensity,
} from '../state/ui-preferences'
import { pickDirectory } from '../integration/directory-picker'
import { NotificationList } from '../../components/notification/NotificationList'

import './ShellRoot.scss'

type FileReadMode = 'full'
type StationTerminalRuntime = {
  sessionId: string | null
  stateRaw: string
  unreadCount: number
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
}
const STATION_INPUT_FLUSH_MS = 4
const STATION_INPUT_MAX_BUFFER_BYTES = 65536
const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24
const TASK_DISPATCH_HISTORY_LIMIT = 40
const TASK_DRAFT_PERSIST_DEBOUNCE_MS = 360
const SHELL_LAYOUT_STORAGE_KEY = 'gtoffice.shell.layout.v2'
const DEFAULT_CANVAS_CUSTOM_LAYOUT: WorkbenchCustomLayout = { columns: 2, rows: 2 }
const CANVAS_LAYOUT_MIN = 1
const CANVAS_LAYOUT_MAX = 8
const WORKSPACE_MEMORY_STORAGE_KEY = 'gtoffice.shell.lastWorkspace.v1'
const WORKSPACE_AUTO_OPEN_DEBOUNCE_MS = 420
const WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS = 560
const WORKSPACE_SESSION_MAX_RESTORE_TABS = 8
const WORKSPACE_SESSION_MAX_RESTORE_TERMINALS = 6
const STATION_TASK_SIGNAL_VISIBLE_MS = 3200
const EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT = 36
const EXTERNAL_CHANNEL_STATUS_POLL_MS = 15000
const TELEGRAM_DEBUG_TOAST_VISIBLE_MS = 6000
const LEFT_PANE_WIDTH_MIN = 210
const LEFT_PANE_WIDTH_MAX = 390
const LEFT_PANE_WIDTH_DEFAULT = 270
const STATION_TASK_SUBMIT_MAX_RETRY_FRAMES = 8

function normalizeStationToolKind(
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

function buildStationLaunchCommand(station: AgentStation): string | null {
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

function summarizeExternalChannelText(
  value: string | null | undefined,
  maxChars = 160,
): string | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars)}...`
}

function normalizeExternalChannel(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return 'external'
  }
  return normalized
}

function buildExternalEndpointKey(input: {
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

function buildExternalConversationKey(endpointKey: string, targetAgentId?: string | null): string {
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

function normalizeSubmitSequence(raw: string): string | null {
  if (raw === '\r' || raw === '\n' || raw === '\r\n') {
    return '\r'
  }
  if (raw === '\x1bOM') {
    return raw
  }
  if (isCsiUEnterSequence(raw) || isCsiTildeEnterSequence(raw) || isModifyOtherKeysEnterSequence(raw)) {
    return raw
  }
  return null
}

type ExternalChannelEventItem = {
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

type ExternalTraceContext = {
  channel: string
  accountId: string
  peerKind: 'direct' | 'group'
  peerId: string
  senderId: string
  endpointKey: string
  targetAgentId?: string
}

type TelegramInboundDebugToast = {
  nonce: number
  receivedAtMs: number
  accountId: string
  senderId: string
  senderName?: string | null
  peerId: string
  messageId: string
  text: string
}

const NAV_ITEM_ID_SET = new Set<NavItemId>([
  'stations',
  'tasks',
  'files',
  'git',
  'hooks',
  'channels',
  'policy',
  'settings',
])

type FileEditorCommandRequest = {
  type: 'find' | 'replace' | 'findNext' | 'findPrevious'
  nonce: number
}

function isNavItemId(value: string): value is NavItemId {
  return NAV_ITEM_ID_SET.has(value as NavItemId)
}

function clampLeftPaneWidth(width: number): number {
  return Math.max(LEFT_PANE_WIDTH_MIN, Math.min(LEFT_PANE_WIDTH_MAX, Math.round(width)))
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function isCodeEditorKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.cm-editor, .codemirror-editor-container'))
}

function shouldPreventDesktopBrowserShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return false
  }
  const key = event.key.toLowerCase()
  return key === 'r' || key === '+' || key === '=' || key === '-' || key === '0'
}

function clampCanvasLayoutValue(value: number): number {
  return Math.max(CANVAS_LAYOUT_MIN, Math.min(CANVAS_LAYOUT_MAX, Math.round(value)))
}

function normalizeCanvasCustomLayout(layout: Partial<WorkbenchCustomLayout> | null | undefined): WorkbenchCustomLayout {
  return {
    columns: clampCanvasLayoutValue(layout?.columns ?? DEFAULT_CANVAS_CUSTOM_LAYOUT.columns),
    rows: clampCanvasLayoutValue(layout?.rows ?? DEFAULT_CANVAS_CUSTOM_LAYOUT.rows),
  }
}

function isWorkbenchLayoutMode(value: unknown): value is WorkbenchLayoutMode {
  return value === 'auto' || value === 'focus' || value === 'custom'
}

function mapLegacyLayoutPreset(
  preset: unknown,
): { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } | null {
  switch (preset) {
    case 'auto':
      return { mode: 'auto', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
    case 'focus':
      return { mode: 'focus', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
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

function loadCanvasLayoutPreference(): { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } {
  if (typeof window === 'undefined') {
    return { mode: 'auto', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
  }
  try {
    const raw = window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)
    if (!raw) {
      return { mode: 'auto', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
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
    return { mode: 'auto', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
  } catch {
    return { mode: 'auto', customLayout: DEFAULT_CANVAS_CUSTOM_LAYOUT }
  }
}

function loadLeftPaneWidthPreference(): number {
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

function loadRememberedWorkspacePath(): string | null {
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
    // ignore parse errors
  }
  return null
}

function rememberWorkspacePath(input: { path: string; workspaceId?: string | null; name?: string | null }) {
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
    // best effort only
  }
}

function createInitialStationTerminals(
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

function getStationIdleBanner(station: AgentStation | undefined): string {
  if (!station) {
    return ''
  }
  return `$ station: ${station.name}
$ role: ${station.role}
$ role_dir: ${station.roleWorkdirRel}
$ agent_dir: ${station.agentWorkdirRel}
$ tool: ${station.tool}
`
}

function describeError(error: unknown): string {
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
      // no-op: keep fallback below.
    }
  }
  return 'unknown'
}

function readRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  return input as Record<string, unknown>
}

function readString(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const trimmed = input.trim()
  return trimmed ? trimmed : null
}

function readNumber(input: unknown): number | null {
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

function isMacOsPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /mac/i.test(`${navigator.platform} ${navigator.userAgent}`)
}

function isLinuxPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /linux/i.test(`${navigator.platform} ${navigator.userAgent}`)
}

function remapSelectedPathAfterMove(
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

function normalizeFsPath(path: string): string {
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

function parseDriveStylePath(path: string): { drive: string; rest: string } | null {
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

function normalizeRelativeFsPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '')
}

function normalizeStationWorkdirInput(path: string): string | null {
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

function toRelativePathIfInside(selectedAbsPath: string, workspaceRoot: string): string | null {
  const selected = normalizeFsPath(selectedAbsPath)
  const root = normalizeFsPath(workspaceRoot)
  if (!selected || !root) {
    return null
  }
  const selectedDrivePath = parseDriveStylePath(selected)
  const rootDrivePath = parseDriveStylePath(root)
  if (
    selectedDrivePath &&
    rootDrivePath &&
    selectedDrivePath.drive === rootDrivePath.drive
  ) {
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

function nextStationNumber(stations: AgentStation[]): number {
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

function createStationFromNumber(
  number: number,
  workspaceId?: string | null,
  input?: Partial<CreateStationInput>,
): AgentStation {
  const suffix = String(number).padStart(2, '0')
  const id = `agent-${suffix}`
  const role = input?.role ?? 'product'
  const normalizedWorkdir = normalizeStationWorkdirInput(input?.workdir ?? '')
  const hasCustomWorkdir = typeof normalizedWorkdir === 'string' && normalizedWorkdir.length > 0
  const workdir = hasCustomWorkdir
    ? normalizedWorkdir
    : buildStationWorkdirs(role, id).agentWorkdirRel
  return {
    id,
    name: input?.name?.trim() ? input.name.trim() : `角色-${suffix}`,
    role,
    roleWorkdirRel: buildRoleWorkdirRel(role),
    agentWorkdirRel: workdir,
    customWorkdir: hasCustomWorkdir,
    tool: input?.tool?.trim() ? input.tool.trim() : 'codex cli',
    terminalSessionId: `ts_${String(number).padStart(3, '0')}`,
    state: 'idle',
    workspaceId: workspaceId ?? 'ws_gtoffice',
  }
}

function createStationEditInput(station: AgentStation): UpdateStationInput {
  return {
    id: station.id,
    name: station.name,
    role: station.role,
    tool: station.tool,
    workdir: station.agentWorkdirRel,
  }
}

function isAmbientLightingIntensity(value: unknown): value is AmbientLightingIntensity {
  return value === 'low' || value === 'medium' || value === 'high'
}

function readAmbientLightingFromSettings(values: Record<string, unknown>): {
  enabled: boolean | null
  intensity: AmbientLightingIntensity | null
} {
  const ui = values.ui
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) {
    return {
      enabled: null,
      intensity: null,
    }
  }
  const ambientLighting = (ui as Record<string, unknown>).ambientLighting
  if (!ambientLighting || typeof ambientLighting !== 'object' || Array.isArray(ambientLighting)) {
    return {
      enabled: null,
      intensity: null,
    }
  }
  const ambientLightingRecord = ambientLighting as Record<string, unknown>
  const enabled = ambientLightingRecord.enabled
  const intensity = ambientLightingRecord.intensity
  return {
    enabled: typeof enabled === 'boolean' ? enabled : null,
    intensity: isAmbientLightingIntensity(intensity) ? intensity : null,
  }
}

function readTaskQuickDispatchOpacityFromSettings(values: Record<string, unknown>): number | null {
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

export function ShellRoot() {
  const initialStations = useMemo(() => createDefaultStations(), [])
  const stationCounterRef = useRef(nextStationNumber(initialStations))
  const tauriRuntime = desktopApi.isTauriRuntime()
  const nativeWindowTop = tauriRuntime
  const nativeWindowTopMacOs = tauriRuntime && isMacOsPlatform()
  const nativeWindowTopLinux = tauriRuntime && !nativeWindowTopMacOs && isLinuxPlatform()
  const nativeWindowTopWindows = nativeWindowTop && !nativeWindowTopMacOs && !nativeWindowTopLinux
  const [uiPreferences, setUiPreferences] = useState(loadUiPreferences)
  const [shortcutBindings, setShortcutBindings] = useState(() => defaultShortcutBindings)
  const [taskQuickDispatchOpacity, setTaskQuickDispatchOpacity] = useState(
    DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  )
  const [leftPaneWidth, setLeftPaneWidth] = useState(loadLeftPaneWidthPreference)
  const [leftPaneResizing, setLeftPaneResizing] = useState(false)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true)
  const [activeNavId, setActiveNavId] = useState<NavItemId>('stations')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isTaskQuickDispatchOpen, setIsTaskQuickDispatchOpen] = useState(false)
  const [isChannelStudioOpen, setIsChannelStudioOpen] = useState(false)
  const [isStationManageOpen, setIsStationManageOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<UpdateStationInput | null>(null)
  const [agentRoles, setAgentRoles] = useState<AgentRole[]>([])
  const [stationSavePending, setStationSavePending] = useState(false)
  const [stationDeletePendingId, setStationDeletePendingId] = useState<string | null>(null)
  const [isStationSearchOpen, setIsStationSearchOpen] = useState(false)
  const initialCanvasLayout = useMemo(loadCanvasLayoutPreference, [])
  const [canvasLayoutMode, setCanvasLayoutMode] = useState<WorkbenchLayoutMode>(initialCanvasLayout.mode)
  const [canvasCustomLayout, setCanvasCustomLayout] = useState<WorkbenchCustomLayout>(initialCanvasLayout.customLayout)
  const [pendingScrollStationId, setPendingScrollStationId] = useState<string | null>(null)
  const [stations, setStations] = useState<AgentStation[]>(initialStations)
  const [stationOverviewState, setStationOverviewState] = useState(defaultStationOverviewState)
  const [activeStationId, setActiveStationId] = useState(initialStations[0]?.id ?? '')
  const [taskDraft, setTaskDraft] = useState<TaskDraftState>(() =>
    createInitialTaskDraft(initialStations, initialStations[0]?.id ?? ''),
  )
  const [taskDispatchHistory, setTaskDispatchHistory] = useState<TaskDispatchRecord[]>([])
  const [taskSending, setTaskSending] = useState(false)
  const [taskRetryingTaskId, setTaskRetryingTaskId] = useState<string | null>(null)
  const [taskDraftSavedAtMs, setTaskDraftSavedAtMs] = useState<number | null>(null)
  const [taskNotice, setTaskNotice] = useState<TaskCenterNotice | null>(null)
  const [taskMentionCandidates, setTaskMentionCandidates] = useState<FsSearchFileMatch[]>([])
  const [taskMentionLoading, setTaskMentionLoading] = useState(false)
  const [taskMentionError, setTaskMentionError] = useState<string | null>(null)
  const [externalChannelStatus, setExternalChannelStatus] = useState<{
    loading: boolean
    running: boolean
    doctorOk: boolean | null
    runtimeBaseUrl: string | null
    feishuWebhook: string | null
    telegramWebhook: string | null
    summary: {
      routeBindings: number
      allowlistEntries: number
      pairingPending: number
      idempotencyEntries: number
    } | null
    lastSyncAtMs: number | null
    error: string | null
    bindings?: ChannelRouteBinding[]
    configuredChannels?: string[]
  }>({
    loading: false,
    running: false,
    doctorOk: null,
    runtimeBaseUrl: null,
    feishuWebhook: null,
    telegramWebhook: null,
    summary: null,
    lastSyncAtMs: null,
    error: null,
    bindings: [],
  })
  const [externalChannelEvents, setExternalChannelEvents] = useState<ExternalChannelEventItem[]>(
    [],
  )
  const [telegramDebugToast, setTelegramDebugToast] = useState<TelegramInboundDebugToast | null>(
    null,
  )
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [stationTaskSignals, setStationTaskSignals] = useState<Record<string, StationTaskSignal>>({})
  const [workspacePathInput, setWorkspacePathInput] = useState(
    () => loadRememberedWorkspacePath() ?? '',
  )
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null)
  const [activeWorkspaceRoot, setActiveWorkspaceRoot] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<{
    code:
      | 'checking'
      | 'web-preview'
      | 'tauri-connected'
      | 'workspace-read-failed'
      | 'git-read-failed'
      | 'input-required'
      | 'not-tauri'
      | 'open-failed'
      | 'bound'
    detail?: string
  }>(() => (desktopApi.isTauriRuntime() ? { code: 'checking' } : { code: 'web-preview' }))
  const [gitSummary, setGitSummary] = useState<GitStatusResponse | null>(null)
  const [stationTerminals, setStationTerminals] = useState<Record<string, StationTerminalRuntime>>(
    () => createInitialStationTerminals(initialStations),
  )
  const stationTerminalsRef = useRef(stationTerminals)
  const stationsRef = useRef(stations)
  const sessionStationRef = useRef<Record<string, string>>({})
  const terminalSessionSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, { content: string; cols: number; rows: number }>>({})
  const stationTerminalInputQueueRef = useRef<Record<string, string>>({})
  const stationSubmitSequenceRef = useRef<Record<string, string>>({})
  const stationTerminalInputFlushTimerRef = useRef<Record<string, number | null>>({})
  const stationTerminalInputSendingRef = useRef<Record<string, boolean>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const leftPaneResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(
    null,
  )
  const shellContainerRef = useRef<HTMLDivElement | null>(null)
  const shellTopRef = useRef<HTMLDivElement | null>(null)
  const shellMainRef = useRef<HTMLElement | null>(null)
  const shellStatusRef = useRef<HTMLDivElement | null>(null)
  const shellRailRef = useRef<HTMLDivElement | null>(null)
  const shellLeftPaneRef = useRef<HTMLDivElement | null>(null)
  const shellResizerRef = useRef<HTMLDivElement | null>(null)
  const shellMainPaneRef = useRef<HTMLDivElement | null>(null)
  const windowResizeSyncTimerRef = useRef<number | null>(null)
  const localeRef = useRef(uiPreferences.locale)
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [filePreviewNotice, setFilePreviewNotice] = useState<string | null>(null)
  const [fileCanRenderText, setFileCanRenderText] = useState(false)
  const [fileReadMode, setFileReadMode] = useState<FileReadMode>('full')
  const [fileReadLoading, setFileReadLoading] = useState(false)
  const [fileReadError, setFileReadError] = useState<string | null>(null)
  const [fileSearchRequest, setFileSearchRequest] = useState<{
    mode: 'file' | 'content'
    nonce: number
  } | null>(null)
  const [fileEditorCommandRequest, setFileEditorCommandRequest] = useState<FileEditorCommandRequest | null>(null)
  const loadFileContentRef = useRef<(filePath: string, mode?: FileReadMode) => Promise<void>>(
    async () => {},
  )
  const openedFilesRef = useRef<OpenedFile[]>([])
  const activeFilePathRef = useRef<string | null>(null)
  const fileReadModeRef = useRef<FileReadMode>('full')
  const fileReadSeqRef = useRef(0)
  const activeWorkspaceIdRef = useRef<string | null>(null)
  const gitRefreshTimerRef = useRef<number | null>(null)
  const workspaceOpenInFlightRef = useRef(false)
  const workspaceAutoOpenTimerRef = useRef<number | null>(null)
  const workspaceSessionPersistTimerRef = useRef<number | null>(null)
  const workspaceSessionHydratingRef = useRef(false)
  const workspaceSessionRestoreSeqRef = useRef(0)
  const workspaceSessionRestoreTabTimersRef = useRef<number[]>([])
  const stationUnreadDeltaRef = useRef<Record<string, number>>({})
  const stationUnreadFlushTimerRef = useRef<number | null>(null)
  const stationTaskSignalTimerRef = useRef<Record<string, number | null>>({})
  const stationTaskSignalNonceRef = useRef<Record<string, number>>({})
  const taskMentionSearchSeqRef = useRef(0)
  const taskMentionSearchTimerRef = useRef<number | null>(null)
  const taskMentionLastQueryRef = useRef('')
  const externalChannelEventSeqRef = useRef(0)
  const externalTraceContextRef = useRef<Record<string, ExternalTraceContext>>({})
  const telegramDebugToastTimerRef = useRef<number | null>(null)
  const registeredAgentRuntimeRef = useRef<
    Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>
  >({})
  const tabSessionSnapshotRef = useRef<Array<{ path: string; active: boolean }>>([])
  const terminalSessionSnapshotRef = useRef<WorkspaceSessionTerminalSnapshot[]>([])
  const lastAutoOpenedPathRef = useRef<string | null>(loadRememberedWorkspacePath())

  useEffect(() => {
    window.__GTO_OPEN_CHANNEL_STUDIO__ = () => {
      setIsSettingsOpen(false)
      setIsChannelStudioOpen(true)
    }
    return () => {
      delete window.__GTO_OPEN_CHANNEL_STUDIO__
    }
  }, [])

  const locale = uiPreferences.locale
  const navItems = useMemo(() => getNavItems(locale), [locale])
  const paneModels = useMemo(() => getPaneModels(locale), [locale])
  const stationNameMap = useMemo(
    () =>
      stations.reduce<Record<string, string>>((acc, station) => {
        const normalized = station.name.trim()
        acc[station.id] = normalized || station.id
        return acc
      }, {}),
    [stations],
  )
  const taskCenterDraftFilePath = useMemo(() => buildTaskCenterDraftFilePath(), [])
  const workspaceSessionFilePath = useMemo(() => buildWorkspaceSessionFilePath(), [])

  useEffect(() => {
    stationTerminalsRef.current = stationTerminals
  }, [stationTerminals])

  useEffect(() => {
    stationsRef.current = stations
  }, [stations])

  useEffect(() => {
    if (!pendingScrollStationId) {
      return
    }
    if (stations.some((station) => station.id === pendingScrollStationId)) {
      return
    }
    setPendingScrollStationId(null)
  }, [pendingScrollStationId, stations])

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])
  useEffect(() => {
    openedFilesRef.current = openedFiles
  }, [openedFiles])
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])
  useEffect(() => {
    fileReadModeRef.current = fileReadMode
  }, [fileReadMode])

  useEffect(() => {
    return () => {
      const gitTimerId = gitRefreshTimerRef.current
      if (typeof gitTimerId === 'number') {
        window.clearTimeout(gitTimerId)
      }
      gitRefreshTimerRef.current = null

      const persistTimerId = workspaceSessionPersistTimerRef.current
      if (typeof persistTimerId === 'number') {
        window.clearTimeout(persistTimerId)
      }
      workspaceSessionPersistTimerRef.current = null

      workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      workspaceSessionRestoreTabTimersRef.current = []

      const unreadTimerId = stationUnreadFlushTimerRef.current
      if (typeof unreadTimerId === 'number') {
        window.clearTimeout(unreadTimerId)
      }
      stationUnreadFlushTimerRef.current = null
      stationUnreadDeltaRef.current = {}

      const mentionTimerId = taskMentionSearchTimerRef.current
      if (typeof mentionTimerId === 'number') {
        window.clearTimeout(mentionTimerId)
      }
      taskMentionSearchTimerRef.current = null
      taskMentionSearchSeqRef.current += 1
      taskMentionLastQueryRef.current = ''

      const telegramToastTimerId = telegramDebugToastTimerRef.current
      if (typeof telegramToastTimerId === 'number') {
        window.clearTimeout(telegramToastTimerId)
      }
      telegramDebugToastTimerRef.current = null

      if (desktopApi.isTauriRuntime()) {
        Object.entries(registeredAgentRuntimeRef.current).forEach(([agentId, runtime]) => {
          void desktopApi.agentRuntimeUnregister(runtime.workspaceId, agentId).catch(() => {
            // Best-effort runtime cleanup during shell teardown.
          })
        })
      }
      registeredAgentRuntimeRef.current = {}

    }
  }, [])

  useEffect(() => {
    applyUiPreferences(uiPreferences)
    saveUiPreferences(uiPreferences)
  }, [uiPreferences])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    const loadRuntimeSettings = async () => {
      try {
        const response = await desktopApi.settingsGetEffective(activeWorkspaceId)
        if (disposed) {
          return
        }
        const runtimeShortcuts = resolveShortcutBindingsFromSettings(response.values)
        setShortcutBindings((prev) =>
          areShortcutBindingsEqual(prev, runtimeShortcuts) ? prev : runtimeShortcuts,
        )
        const runtimeTaskQuickDispatchOpacity = readTaskQuickDispatchOpacityFromSettings(
          response.values,
        )
        if (runtimeTaskQuickDispatchOpacity !== null) {
          setTaskQuickDispatchOpacity((prev) =>
            prev === runtimeTaskQuickDispatchOpacity ? prev : runtimeTaskQuickDispatchOpacity,
          )
        }
        const runtimeAmbientLighting = readAmbientLightingFromSettings(response.values)
        if (runtimeAmbientLighting.enabled === null && runtimeAmbientLighting.intensity === null) {
          return
        }
        setUiPreferences((prev) => {
          const nextEnabled =
            runtimeAmbientLighting.enabled === null
              ? prev.ambientLightingEnabled
              : runtimeAmbientLighting.enabled
          const nextIntensity =
            runtimeAmbientLighting.intensity === null
              ? prev.ambientLightingIntensity
              : runtimeAmbientLighting.intensity
          if (
            prev.ambientLightingEnabled === nextEnabled &&
            prev.ambientLightingIntensity === nextIntensity
          ) {
            return prev
          }
          return {
            ...prev,
            ambientLightingEnabled: nextEnabled,
            ambientLightingIntensity: nextIntensity,
          }
        })
      } catch {
        // Keep local preference when settings service is unavailable.
      }
    }

    void loadRuntimeSettings()

    void desktopApi
      .subscribeSettingsUpdated((payload) => {
        if (payload.workspaceId && activeWorkspaceId && payload.workspaceId !== activeWorkspaceId) {
          return
        }
        if (payload.workspaceId && !activeWorkspaceId) {
          return
        }
        void loadRuntimeSettings()
      })
      .then((unlisten) => {
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [activeWorkspaceId])

  const persistAmbientLightingPatch = useCallback((patch: Record<string, unknown>) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        ui: {
          ambientLighting: patch,
        },
      })
      .catch(() => {
        // Do not block UI interaction when settings persistence fails.
      })
  }, [])

  const handleAmbientLightingChange = useCallback((enabled: boolean) => {
    setUiPreferences((prev) => ({
      ...prev,
      ambientLightingEnabled: enabled,
    }))
    persistAmbientLightingPatch({ enabled })
  }, [persistAmbientLightingPatch])

  const handleAmbientLightingIntensityChange = useCallback(
    (intensity: AmbientLightingIntensity) => {
      setUiPreferences((prev) => ({
        ...prev,
        ambientLightingIntensity: intensity,
      }))
      persistAmbientLightingPatch({ intensity })
    },
    [persistAmbientLightingPatch],
  )

  const persistShortcutBindings = useCallback((bindings: typeof shortcutBindings) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        keybindings: {
          overrides: [
            {
              command: 'shell.search.open_file',
              keystroke: shortcutBindingToKeystroke(bindings.openFileSearch),
            },
            {
              command: 'shell.search.open_content',
              keystroke: shortcutBindingToKeystroke(bindings.openContentSearch),
            },
            {
              command: 'shell.editor.find',
              keystroke: shortcutBindingToKeystroke(bindings.editorFind),
            },
            {
              command: 'shell.editor.replace',
              keystroke: shortcutBindingToKeystroke(bindings.editorReplace),
            },
            {
              command: 'task.center.quick_dispatch',
              keystroke: shortcutBindingToKeystroke(bindings.taskQuickDispatch),
            },
          ],
        },
      })
      .catch(() => {
        // Keep local shortcut state even if settings persistence fails.
      })
  }, [])

  const handleTaskQuickDispatchShortcutChange = useCallback((binding: ShortcutBinding) => {
    setShortcutBindings((prev) => {
      const next = {
        ...prev,
        taskQuickDispatch: binding,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings])

  const handleTaskQuickDispatchShortcutReset = useCallback(() => {
    setShortcutBindings((prev) => {
      const next = {
        ...prev,
        taskQuickDispatch: defaultShortcutBindings.taskQuickDispatch,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings])

  const handleTaskQuickDispatchOpacityChange = useCallback((value: number) => {
    const nextOpacity = normalizeTaskQuickDispatchOpacity(value)
    setTaskQuickDispatchOpacity(nextOpacity)
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        ui: {
          taskQuickDispatch: {
            opacity: nextOpacity,
          },
        },
      })
      .catch(() => {
        // The overlay remains usable even if settings persistence fails.
      })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(
      SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        leftPaneWidth,
        canvasLayoutMode,
        canvasCustomLayout,
      }),
    )
  }, [canvasCustomLayout, canvasLayoutMode, leftPaneWidth])

  const syncWindowFrameState = useCallback(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi.windowIsMaximized().then((maximized) => {
      setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
    })
  }, [])

  useEffect(() => {
    if (!nativeWindowTop) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | null = null

    const syncMaximized = async () => {
      if (disposed) {
        return
      }
      const maximized = await desktopApi.windowIsMaximized()
      if (!disposed) {
        setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
      }
    }

    void desktopApi.windowSetDecorations(nativeWindowTopMacOs)
    void syncMaximized()
    void desktopApi.subscribeWindowResized(() => {
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = window.setTimeout(() => {
        windowResizeSyncTimerRef.current = null
        void syncMaximized()
      }, 120)
    }).then((unlisten) => {
      cleanup = unlisten
    })

    return () => {
      disposed = true
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = null
      if (cleanup) {
        cleanup()
      }
    }
  }, [nativeWindowTop, nativeWindowTopMacOs])

  useEffect(() => {
    const draggingClassName = 'vb-window-dragging'
    if (!nativeWindowTopWindows) {
      document.body.classList.remove(draggingClassName)
      return
    }

    const topContainer = shellTopRef.current
    if (!topContainer) {
      return
    }

    const dragRegionSelector = '[data-tauri-drag-region]'
    const interactiveSelector =
      "button,input,textarea,select,a,[role='button'],[contenteditable='true'],label"

    const clearDraggingClass = () => {
      document.body.classList.remove(draggingClassName)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const dragRegion = target.closest(dragRegionSelector)
      if (!dragRegion) {
        return
      }
      if (target.closest(interactiveSelector)) {
        return
      }
      document.body.classList.add(draggingClassName)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearDraggingClass()
      }
    }

    topContainer.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointerup', clearDraggingClass)
    window.addEventListener('pointercancel', clearDraggingClass)
    window.addEventListener('blur', clearDraggingClass)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      topContainer.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointerup', clearDraggingClass)
      window.removeEventListener('pointercancel', clearDraggingClass)
      window.removeEventListener('blur', clearDraggingClass)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearDraggingClass()
    }
  }, [nativeWindowTopWindows])

  useEffect(() => {
    const root = document.documentElement
    const platform = nativeWindowTopMacOs
      ? 'macos'
      : nativeWindowTopLinux
        ? 'linux'
        : nativeWindowTopWindows
          ? 'windows'
          : tauriRuntime
            ? 'unknown'
            : 'web'

    root.setAttribute('data-vb-platform', platform)

    return () => {
      if (root.getAttribute('data-vb-platform') === platform) {
        root.removeAttribute('data-vb-platform')
      }
    }
  }, [nativeWindowTopLinux, nativeWindowTopMacOs, nativeWindowTopWindows, tauriRuntime])

  const handleWindowMinimize = useCallback(() => {
    void desktopApi.windowMinimize()
  }, [])

  const handleWindowToggleMaximize = useCallback(() => {
    void desktopApi.windowToggleMaximize().then((success) => {
      if (!success) {
        return
      }
      syncWindowFrameState()
    })
  }, [syncWindowFrameState])

  const handleWindowClose = useCallback(() => {
    void desktopApi.windowClose()
  }, [])

  const activePaneModel = useMemo(() => {
    if (activeNavId !== 'git') {
      return paneModels[activeNavId]
    }

    if (!gitSummary) {
      return {
        title: t(locale, 'pane.git.title'),
        subtitle: t(locale, 'shell.git.statusMissing'),
        items: [
          t(locale, 'pane.git.currentBranch', { branch: '-' }),
          t(locale, 'pane.git.pendingFiles', { count: 0 }),
          t(locale, 'pane.git.unpushedCommits', { count: 0 }),
        ],
      }
    }

    return {
      title: t(locale, 'pane.git.title'),
      subtitle: t(locale, 'shell.git.summaryStatus', {
        branch: gitSummary.branch,
        ahead: gitSummary.ahead,
        behind: gitSummary.behind,
      }),
      items:
        gitSummary.files.length > 0
          ? gitSummary.files.slice(0, 8).map((file) => `${file.status} ${file.path}`)
          : [t(locale, 'shell.git.workspaceClean')],
    }
  }, [activeNavId, gitSummary, locale, paneModels])

  const runtimeStateByStationId = useMemo(
    () =>
      Object.entries(stationTerminals).reduce<Record<string, string>>((acc, [stationId, runtime]) => {
        acc[stationId] = runtime.stateRaw
        return acc
      }, {}),
    [stationTerminals],
  )

  const filteredStations = useMemo(
    () => filterStationsForOverview(stations, runtimeStateByStationId, stationOverviewState),
    [runtimeStateByStationId, stationOverviewState, stations],
  )

  const channelBotBindingsByStationId = useMemo(
    () =>
      buildStationChannelBotBindingMap(
        stations.map((station) => ({ id: station.id, role: station.role })),
        externalChannelStatus.bindings ?? [],
      ),
    [externalChannelStatus.bindings, stations],
  )

  const appendStationTerminalOutput = useMemo(
    () => (stationId: string, chunk: string) => {
      const previous = stationTerminalOutputCacheRef.current[stationId] ?? ''
      const merged = `${previous}${chunk}`
      stationTerminalOutputCacheRef.current[stationId] =
        merged.length > 50000 ? merged.slice(merged.length - 50000) : merged
      stationTerminalSinkRef.current[stationId]?.write(chunk)
    },
    [],
  )

  const resetStationTerminalOutput = useMemo(
    () => (stationId: string, content?: string) => {
      const station = stationsRef.current.find((item) => item.id === stationId)
      const fallback = getStationIdleBanner(station)
      const nextContent = content ?? fallback
      stationTerminalOutputCacheRef.current[stationId] = nextContent
      stationTerminalSinkRef.current[stationId]?.reset(nextContent)
    },
    [],
  )

  const setStationTerminalState = useMemo(
    () => (stationId: string, patch: Partial<StationTerminalRuntime>) => {
      setStationTerminals((prev) => {
        const current = prev[stationId] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        }
        const nextRuntime = {
          ...current,
          ...patch,
        }
        const next = {
          ...prev,
          [stationId]: nextRuntime,
        }
        stationTerminalsRef.current = next
        return {
          ...next,
        }
      })
    },
    [],
  )

  const clearStationUnread = useMemo(
    () => (stationId: string) => {
      delete stationUnreadDeltaRef.current[stationId]
      setStationTerminals((prev) => {
        const current = prev[stationId]
        if (!current || current.unreadCount === 0) {
          return prev
        }
        return {
          ...prev,
          [stationId]: {
            ...current,
            unreadCount: 0,
          },
        }
      })
    },
    [],
  )

  const flushStationUnreadDeltas = useMemo(
    () => () => {
      const pending = stationUnreadDeltaRef.current
      stationUnreadDeltaRef.current = {}
      stationUnreadFlushTimerRef.current = null
      const entries = Object.entries(pending).filter(([, delta]) => delta > 0)
      if (entries.length === 0) {
        return
      }
      setStationTerminals((prev) => {
        let changed = false
        const next = { ...prev }
        entries.forEach(([stationId, delta]) => {
          const current = next[stationId]
          if (!current) {
            return
          }
          const unreadCount = Math.min(999, current.unreadCount + delta)
          if (unreadCount === current.unreadCount) {
            return
          }
          next[stationId] = {
            ...current,
            unreadCount,
          }
          changed = true
        })
        return changed ? next : prev
      })
    },
    [],
  )

  const incrementStationUnread = useMemo(
    () => (stationId: string, delta: number) => {
      if (delta <= 0) {
        return
      }
      const pending = stationUnreadDeltaRef.current
      pending[stationId] = Math.min(999, (pending[stationId] ?? 0) + delta)
      if (typeof stationUnreadFlushTimerRef.current === 'number') {
        return
      }
      stationUnreadFlushTimerRef.current = window.setTimeout(flushStationUnreadDeltas, 84)
    },
    [flushStationUnreadDeltas],
  )

  const clearStationTaskSignalTimer = useCallback((stationId: string) => {
    const timerId = stationTaskSignalTimerRef.current[stationId]
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
    }
    stationTaskSignalTimerRef.current[stationId] = null
  }, [])

  const scheduleStationTaskSignalDismiss = useCallback(
    (stationId: string, nonce: number) => {
      clearStationTaskSignalTimer(stationId)
      stationTaskSignalTimerRef.current[stationId] = window.setTimeout(() => {
        stationTaskSignalTimerRef.current[stationId] = null
        if ((stationTaskSignalNonceRef.current[stationId] ?? 0) !== nonce) {
          return
        }
        setStationTaskSignals((prev) => {
          const current = prev[stationId]
          if (!current || current.nonce !== nonce) {
            return prev
          }
          const next = { ...prev }
          delete next[stationId]
          return next
        })
      }, STATION_TASK_SIGNAL_VISIBLE_MS)
    },
    [clearStationTaskSignalTimer],
  )

  const emitStationTaskSignal = useCallback(
    (input: { stationId: string; taskId: string; title: string; receivedAtMs: number }) => {
      const nextNonce = (stationTaskSignalNonceRef.current[input.stationId] ?? 0) + 1
      stationTaskSignalNonceRef.current[input.stationId] = nextNonce
      setStationTaskSignals((prev) => ({
        ...prev,
        [input.stationId]: {
          nonce: nextNonce,
          taskId: input.taskId,
          title: input.title,
          receivedAtMs: input.receivedAtMs,
        },
      }))
      scheduleStationTaskSignalDismiss(input.stationId, nextNonce)
    },
    [scheduleStationTaskSignalDismiss],
  )

  const bindExternalTraceTarget = useCallback((traceId: string, targetAgentId: string) => {
    const normalizedTraceId = traceId.trim()
    const normalizedTargetAgentId = targetAgentId.trim()
    if (!normalizedTraceId || !normalizedTargetAgentId) {
      return
    }
    const context = externalTraceContextRef.current[normalizedTraceId]
    if (context) {
      context.targetAgentId = normalizedTargetAgentId
    }
    setExternalChannelEvents((prev) =>
      prev.map((event) => {
        if (event.traceId !== normalizedTraceId) {
          return event
        }
        const endpointKey =
          event.endpointKey ??
          context?.endpointKey ??
          buildExternalEndpointKey({
            channel: event.channel,
            accountId: event.accountId,
            peerKind: event.peerKind,
            peerId: event.peerId,
          })
        return {
          ...event,
          targetAgentId: normalizedTargetAgentId,
          conversationKey: buildExternalConversationKey(endpointKey, normalizedTargetAgentId),
        }
      }),
    )
  }, [])

  const appendExternalChannelEvent = useCallback(
    (input: Omit<ExternalChannelEventItem, 'id' | 'tsMs'> & { tsMs?: number }) => {
      externalChannelEventSeqRef.current += 1
      const nextEvent: ExternalChannelEventItem = {
        id: `ext_evt_${Date.now().toString(16)}_${externalChannelEventSeqRef.current.toString(16)}`,
        tsMs: input.tsMs ?? Date.now(),
        kind: input.kind,
        primary: input.primary,
        channel: input.channel,
        status: input.status,
        secondary: input.secondary,
        detail: input.detail,
        mergeKey: input.mergeKey,
        traceId: input.traceId,
        accountId: input.accountId,
        peerKind: input.peerKind,
        peerId: input.peerId,
        senderId: input.senderId,
        targetAgentId: input.targetAgentId,
        endpointKey: input.endpointKey,
        conversationKey: input.conversationKey,
      }
      setExternalChannelEvents((prev) => {
        if (!nextEvent.mergeKey) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const existingIndex = prev.findIndex(
          (event) => event.mergeKey === nextEvent.mergeKey && event.kind === nextEvent.kind,
        )
        if (existingIndex === -1) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          tsMs: nextEvent.tsMs,
          primary: nextEvent.primary,
          channel: nextEvent.channel,
          status: nextEvent.status,
          secondary: nextEvent.secondary,
          detail: nextEvent.detail,
          traceId: nextEvent.traceId,
          accountId: nextEvent.accountId,
          peerKind: nextEvent.peerKind,
          peerId: nextEvent.peerId,
          senderId: nextEvent.senderId,
          targetAgentId: nextEvent.targetAgentId,
          endpointKey: nextEvent.endpointKey,
          conversationKey: nextEvent.conversationKey,
        }
        return updated
      })
    },
    [],
  )

  const emitTelegramInboundDebugToast = useCallback((payload: ExternalChannelInboundPayload) => {
    if (payload.channel.trim().toLowerCase() !== 'telegram') {
      return
    }
    const normalizedText = (payload.text ?? '').trim()
    const textPreview =
      normalizedText.length > 280 ? `${normalizedText.slice(0, 280)}...` : normalizedText
    const nonce = Date.now()
    const nextToast: TelegramInboundDebugToast = {
      nonce,
      receivedAtMs: nonce,
      accountId: payload.accountId || 'default',
      senderId: payload.senderId || 'unknown',
      senderName: payload.senderName ?? null,
      peerId: payload.peerId || 'unknown',
      messageId: payload.messageId || 'unknown',
      text: textPreview,
    }
    setTelegramDebugToast(nextToast)

    const previousTimer = telegramDebugToastTimerRef.current
    if (typeof previousTimer === 'number') {
      window.clearTimeout(previousTimer)
    }
    telegramDebugToastTimerRef.current = window.setTimeout(() => {
      telegramDebugToastTimerRef.current = null
      setTelegramDebugToast((current) => {
        if (!current || current.nonce !== nonce) {
          return current
        }
        return null
      })
    }, TELEGRAM_DEBUG_TOAST_VISIBLE_MS)
  }, [])

  const refreshExternalChannelStatus = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    setExternalChannelStatus((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))
    try {
      const [adapterStatus, doctorStatus, bindingsResponse] = await Promise.all([
        desktopApi.channelAdapterStatus(),
        desktopApi.systemGtoDoctor(),
        activeWorkspaceId ? desktopApi.channelBindingList(activeWorkspaceId) : Promise.resolve({ bindings: [] }),
      ])
      const connectorAccounts = await resolveConnectorAccounts(adapterStatus, (channel) =>
        desktopApi.channelConnectorAccountList(channel),
      )

      const runtimeRecord = readRecord(adapterStatus.runtime)
      const snapshotRecord = readRecord(adapterStatus.snapshot)
      const doctorRecord = readRecord(doctorStatus)
      const summaryRecord = readRecord(snapshotRecord)
      const doctorOk = typeof doctorRecord?.ok === 'boolean' ? doctorRecord.ok : null

      const feishuWebHit = readString(runtimeRecord?.feishuWebhook)
      const telegramWebHit = readString(runtimeRecord?.telegramWebhook)

      const activeSet = new Set<string>()
      bindingsResponse.bindings.forEach((binding) => activeSet.add(binding.channel))
      connectorAccounts.forEach((account) => {
        if (account.enabled || account.hasBotToken || account.hasWebhookSecret) {
          activeSet.add(account.channel)
        }
      })
      if (feishuWebHit) activeSet.add('feishu')
      if (telegramWebHit) {
        activeSet.add('telegram')
      }

      setExternalChannelStatus({
        loading: false,
        running: Boolean(adapterStatus.running),
        doctorOk,
        runtimeBaseUrl: readString(runtimeRecord?.baseUrl),
        feishuWebhook: feishuWebHit,
        telegramWebhook: telegramWebHit,
        summary: summaryRecord
          ? {
              routeBindings: Math.max(0, readNumber(summaryRecord.routeBindings) ?? 0),
              allowlistEntries: Math.max(0, readNumber(summaryRecord.allowlistEntries) ?? 0),
              pairingPending: Math.max(0, readNumber(summaryRecord.pairingPending) ?? 0),
              idempotencyEntries: Math.max(0, readNumber(summaryRecord.idempotencyEntries) ?? 0),
            }
          : null,
        lastSyncAtMs: Date.now(),
        error: null,
        bindings: bindingsResponse.bindings,
        configuredChannels: Array.from(activeSet),
      })
    } catch (error) {
      setExternalChannelStatus((prev) => ({
        ...prev,
        loading: false,
        error: describeError(error),
        lastSyncAtMs: Date.now(),
      }))
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (activeNavId !== 'channels' && !isChannelStudioOpen) {
      return
    }
    void refreshExternalChannelStatus()
  }, [activeNavId, isChannelStudioOpen, refreshExternalChannelStatus])

  useEffect(() => {
    return () => {
      Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
        clearStationTaskSignalTimer(stationId)
      })
      stationTaskSignalTimerRef.current = {}
      stationTaskSignalNonceRef.current = {}
    }
  }, [clearStationTaskSignalTimer])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    let disposed = false
    let timerId: number | null = null

    const poll = async () => {
      if (disposed) {
        return
      }
      await refreshExternalChannelStatus()
      if (disposed || activeNavId !== 'tasks') {
        return
      }
      timerId = window.setTimeout(() => {
        void poll()
      }, EXTERNAL_CHANNEL_STATUS_POLL_MS)
    }

    if (activeNavId === 'tasks') {
      void poll()
    }

    return () => {
      disposed = true
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
    }
  }, [activeNavId, refreshExternalChannelStatus])

  const bindStationTerminalSink = useMemo<StationTerminalSinkBindingHandler>(
    () => (stationId, sink, meta) => {
      if (!sink) {
        if (meta?.sourceSink && stationTerminalSinkRef.current[stationId] !== meta.sourceSink) {
          return
        }
        if (meta?.restoreState) {
          stationTerminalRestoreStateRef.current[stationId] = {
            content: meta.restoreState,
            cols: meta.restoreCols ?? 0,
            rows: meta.restoreRows ?? 0,
          }
        }
        delete stationTerminalSinkRef.current[stationId]
        return
      }
      stationTerminalSinkRef.current[stationId] = sink
      const station = stationsRef.current.find((item) => item.id === stationId)
      const cachedContent = stationTerminalOutputCacheRef.current[stationId] ?? getStationIdleBanner(station)
      const restoreState = stationTerminalRestoreStateRef.current[stationId]
      if (restoreState) {
        sink.restore(restoreState.content, restoreState.cols, restoreState.rows)
        return
      }
      sink.reset(cachedContent)
    },
    [],
  )

  const ensureTerminalSessionVisible = useCallback((sessionId: string) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (terminalSessionVisibilityRef.current[sessionId]) {
      return
    }
    void desktopApi
      .terminalSetVisibility(sessionId, true)
      .then(() => {
        terminalSessionVisibilityRef.current[sessionId] = true
      })
      .catch(() => {
        // Ignore transient sync failure; next render cycle will retry.
      })
  }, [])

  const decodeBase64Chunk = useMemo(
    () => (base64Chunk: string): string => {
      try {
        const binary = window.atob(base64Chunk)
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
        return new TextDecoder().decode(bytes)
      } catch {
        return ''
      }
    },
    [],
  )

  const refreshGit = useMemo(
    () => async (workspaceId: string | null) => {
      if (!workspaceId) {
        setGitSummary(null)
        return
      }

      try {
        const summary = await desktopApi.gitStatus(workspaceId)
        setGitSummary(summary)
      } catch (error) {
        setGitSummary(null)
        if (isNotGitRepositoryError(error)) {
          return
        }
        setConnectionState({
          code: 'git-read-failed',
          detail: describeError(error),
        })
      }
    },
    [],
  )

  const gitController = useGitWorkspaceController({
    locale,
    workspaceId: activeWorkspaceId,
    summary: gitSummary,
    onRefreshSummary: refreshGit,
  })

  const scheduleRefreshGit = useCallback(
    (workspaceId: string | null) => {
      const timerId = gitRefreshTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      gitRefreshTimerRef.current = window.setTimeout(() => {
        void refreshGit(workspaceId)
      }, 96)
    },
    [refreshGit],
  )

  // Use refs to avoid circular dependency in useEffect chains
  const activeWorkspaceNameRef = useRef(activeWorkspaceName)
  const activeWorkspaceRootRef = useRef(activeWorkspaceRoot)
  useEffect(() => {
    activeWorkspaceNameRef.current = activeWorkspaceName
  }, [activeWorkspaceName])
  useEffect(() => {
    activeWorkspaceRootRef.current = activeWorkspaceRoot
  }, [activeWorkspaceRoot])

  const openWorkspaceAtPath = useCallback(
    async (path: string, reason: 'manual' | 'restore' | 'picker' | 'debounce' = 'manual') => {
      const normalized = normalizeFsPath(path)
      if (!normalized) {
        setConnectionState({ code: 'input-required' })
        return
      }

      if (!desktopApi.isTauriRuntime()) {
        setConnectionState({ code: 'not-tauri' })
        return
      }

      if (workspaceOpenInFlightRef.current) {
        return
      }

      const currentRoot = activeWorkspaceRootRef.current
      const activeRootNormalized = currentRoot ? normalizeFsPath(currentRoot) : null
      if (activeRootNormalized && normalized === activeRootNormalized) {
        rememberWorkspacePath({
          path: normalized,
          workspaceId: activeWorkspaceIdRef.current,
          name: activeWorkspaceNameRef.current,
        })
        lastAutoOpenedPathRef.current = normalized
        return
      }

      workspaceOpenInFlightRef.current = true
      setConnectionState({ code: 'checking', detail: reason })

      try {
        const opened = await desktopApi.workspaceOpen(normalized)
        setActiveWorkspaceId(opened.workspaceId)
        setActiveWorkspaceName(opened.name)
        setActiveWorkspaceRoot(opened.root)
        setWorkspacePathInput(opened.root)
        rememberWorkspacePath({
          path: opened.root,
          workspaceId: opened.workspaceId,
          name: opened.name,
        })
        lastAutoOpenedPathRef.current = opened.root
        setConnectionState({ code: 'bound', detail: opened.root })
        void refreshGit(opened.workspaceId)
      } catch (error) {
        setConnectionState({
          code: 'open-failed',
          detail: describeError(error),
        })
      } finally {
        workspaceOpenInFlightRef.current = false
      }
    },
    [refreshGit],
  )

  // Bootstrap effect - runs only once on mount
  const bootstrapRanRef = useRef(false)
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    // Prevent double execution in React StrictMode
    if (bootstrapRanRef.current) {
      return
    }
    bootstrapRanRef.current = true

    const bootstrapWorkspace = async () => {
      setConnectionState({ code: 'tauri-connected' })
      const response = await desktopApi.workspaceGetWindowActive()
      if (response.workspaceId) {
        let workspaceRoot: string | null = null
        try {
          const context = await desktopApi.workspaceGetContext(response.workspaceId)
          workspaceRoot = context.root
        } catch {
          workspaceRoot = null
        }
        setActiveWorkspaceId(response.workspaceId)
        setActiveWorkspaceName(response.workspaceId)
        setActiveWorkspaceRoot(workspaceRoot)
        if (workspaceRoot) {
          setWorkspacePathInput(workspaceRoot)
          rememberWorkspacePath({
            path: workspaceRoot,
            workspaceId: response.workspaceId,
            name: response.workspaceId,
          })
          lastAutoOpenedPathRef.current = workspaceRoot
          setConnectionState({ code: 'bound', detail: workspaceRoot })
        }
        void refreshGit(response.workspaceId)
        return
      }

      const remembered = loadRememberedWorkspacePath()
      if (remembered) {
        setWorkspacePathInput(remembered)
        await openWorkspaceAtPath(remembered, 'restore')
        return
      }
      setConnectionState({ code: 'input-required' })
    }

    void bootstrapWorkspace()
      .catch((error) => {
        setConnectionState({
          code: 'workspace-read-failed',
          detail: describeError(error),
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Store openWorkspaceAtPath in a ref to avoid dependency issues
  const openWorkspaceAtPathRef = useRef(openWorkspaceAtPath)
  useEffect(() => {
    openWorkspaceAtPathRef.current = openWorkspaceAtPath
  }, [openWorkspaceAtPath])

  // Auto-open workspace when path input changes (debounced)
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    const normalized = normalizeFsPath(workspacePathInput)
    const currentRoot = activeWorkspaceRootRef.current
    const activeRootNormalized = currentRoot ? normalizeFsPath(currentRoot) : null
    if (!normalized || normalized === activeRootNormalized || normalized === lastAutoOpenedPathRef.current) {
      return
    }
    const timerId = window.setTimeout(() => {
      workspaceAutoOpenTimerRef.current = null
      lastAutoOpenedPathRef.current = normalized
      void openWorkspaceAtPathRef.current(normalized, 'debounce')
    }, WORKSPACE_AUTO_OPEN_DEBOUNCE_MS)
    workspaceAutoOpenTimerRef.current = timerId
    return () => {
      const pending = workspaceAutoOpenTimerRef.current
      if (typeof pending === 'number') {
        window.clearTimeout(pending)
      }
      workspaceAutoOpenTimerRef.current = null
    }
  }, [workspacePathInput])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    if (activeWorkspaceRootRef.current) {
      return
    }
    let cancelled = false
    void desktopApi
      .workspaceGetContext(activeWorkspaceId)
      .then((context) => {
        if (cancelled) {
          return
        }
        setActiveWorkspaceRoot(context.root)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setActiveWorkspaceRoot(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | null = null
    void desktopApi
      .subscribeGitUpdated((payload) => {
        if (disposed) {
          return
        }
        const activeWorkspaceId = activeWorkspaceIdRef.current
        if (!activeWorkspaceId || payload.workspaceId !== activeWorkspaceId) {
          return
        }
        scheduleRefreshGit(activeWorkspaceId)
      })
      .then((unlisten) => {
        cleanup = unlisten
      })
    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
      const timerId = gitRefreshTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      gitRefreshTimerRef.current = null
    }
  }, [scheduleRefreshGit])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null
    void desktopApi
      .subscribeTerminalEvents({
        onOutput: (payload: TerminalOutputPayload) => {
          const previous = terminalOutputQueueRef.current[payload.sessionId] ?? Promise.resolve()
          terminalOutputQueueRef.current[payload.sessionId] = previous
            .catch(() => undefined)
            .then(async () => {
              if (disposed) {
                return
              }
              const stationId = sessionStationRef.current[payload.sessionId]
              if (!stationId) {
                return
              }
              const unread = stationId !== activeStationId
              const seq = terminalSessionSeqRef.current[payload.sessionId] ?? 0
              if (payload.seq <= seq) {
                return
              }
              if (payload.seq === seq + 1) {
                const text = decodeBase64Chunk(payload.chunk)
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = payload.seq
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const delta = await desktopApi
                .terminalReadDelta(payload.sessionId, seq)
                .catch(() => null)
              if (
                delta &&
                !delta.gap &&
                !delta.truncated &&
                delta.fromSeq === seq + 1 &&
                delta.toSeq >= payload.seq
              ) {
                const text = decodeBase64Chunk(delta.chunk)
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = delta.toSeq
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const snapshot = await desktopApi.terminalReadSnapshot(payload.sessionId).catch(() => null)
              if (!snapshot) {
                return
              }
              resetStationTerminalOutput(stationId, decodeBase64Chunk(snapshot.chunk))
              terminalSessionSeqRef.current[payload.sessionId] = snapshot.currentSeq
              if (unread) {
                incrementStationUnread(stationId, 1)
              }
            })
        },
        onStateChanged: (payload: TerminalStatePayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            return
          }
          setStationTerminalState(stationId, { stateRaw: payload.to })
          appendStationTerminalOutput(stationId, `\n[terminal:${payload.to}]\n`)
          if (payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed') {
            delete terminalSessionSeqRef.current[payload.sessionId]
            delete terminalOutputQueueRef.current[payload.sessionId]
          }
        },
        onMeta: (payload: TerminalMetaPayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            return
          }
          const tail = decodeBase64Chunk(payload.tailChunk)
          if (tail) {
            appendStationTerminalOutput(stationId, tail)
          }
          if (stationId !== activeStationId) {
            const delta = Math.max(1, Math.min(99, payload.unreadChunks || 1))
            incrementStationUnread(stationId, delta)
          }
        },
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    activeStationId,
    appendStationTerminalOutput,
    decodeBase64Chunk,
    incrementStationUnread,
    resetStationTerminalOutput,
    setStationTerminalState,
  ])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      registeredAgentRuntimeRef.current = {}
      return
    }
    const previous = registeredAgentRuntimeRef.current
    const desired: Record<
      string,
      { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }
    > = {}

    if (activeWorkspaceId) {
      stations.forEach((station) => {
        const sessionId = stationTerminals[station.id]?.sessionId ?? null
        if (!sessionId) {
          return
        }
        desired[station.id] = {
          workspaceId: activeWorkspaceId,
          sessionId,
          toolKind: normalizeStationToolKind(station.tool),
          resolvedCwd: stationTerminals[station.id]?.resolvedCwd ?? null,
        }
      })
    }

    Object.entries(previous).forEach(([agentId, runtime]) => {
      const next = desired[agentId]
      if (
        next &&
        next.workspaceId === runtime.workspaceId &&
        next.sessionId === runtime.sessionId &&
        next.toolKind === runtime.toolKind &&
        next.resolvedCwd === runtime.resolvedCwd
      ) {
        return
      }
      void desktopApi
        .agentRuntimeUnregister(runtime.workspaceId, agentId)
        .catch(() => {
          // Keep sync loop resilient during transient runtime teardown.
        })
    })

    Object.entries(desired).forEach(([agentId, runtime]) => {
      const prev = previous[agentId]
      if (
        prev &&
        prev.workspaceId === runtime.workspaceId &&
        prev.sessionId === runtime.sessionId &&
        prev.toolKind === runtime.toolKind &&
        prev.resolvedCwd === runtime.resolvedCwd
      ) {
        return
      }
      const stationRole =
        stationsRef.current.find((station) => station.id === agentId)?.role ?? null
      const submitSequence = stationSubmitSequenceRef.current[agentId] ?? null
      void desktopApi
        .agentRuntimeRegister({
          workspaceId: runtime.workspaceId,
          agentId,
          stationId: agentId,
          roleKey: stationRole,
          sessionId: runtime.sessionId,
          toolKind: runtime.toolKind as AgentRuntimeRegisterRequest['toolKind'],
          resolvedCwd: runtime.resolvedCwd,
          submitSequence,
          online: true,
        })
        .catch(() => {
          // Ignore sync retry failures; next render cycle will retry.
        })
    })

    registeredAgentRuntimeRef.current = desired
  }, [activeWorkspaceId, stations, stationTerminals])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    void desktopApi
      .subscribeChannelEvents({
        onMessage: (payload: ChannelMessagePayload) => {
          if (disposed) {
            return
          }
          const station = stationsRef.current.find(
            (item) => item.id === payload.targetAgentId,
          )
          if (!station) {
            return
          }
          const rawPayload = payload.payload
          const taskId =
            typeof rawPayload.taskId === 'string' ? rawPayload.taskId : payload.messageId
          const title =
            typeof rawPayload.title === 'string' ? rawPayload.title : payload.type

          emitStationTaskSignal({
            stationId: station.id,
            taskId,
            title,
            receivedAtMs: payload.tsMs,
          })
        },
        onAck: () => {
          // Ack events are tracked in task center history records.
        },
        onDispatchProgress: () => {
          // Progress events are consumed by the dispatch command response in current UI.
        },
        onExternalInbound: (payload: ExternalChannelInboundPayload) => {
          const channel = normalizeExternalChannel(payload.channel)
          const accountId = payload.accountId?.trim() || 'default'
          const peerKind = payload.peerKind
          const peerId = payload.peerId?.trim() || 'unknown-peer'
          const senderId = payload.senderId?.trim() || 'unknown-sender'
          const endpointKey = buildExternalEndpointKey({
            channel,
            accountId,
            peerKind,
            peerId,
          })
          const previousTraceContext = externalTraceContextRef.current[payload.traceId]
          const traceContext: ExternalTraceContext = {
            channel,
            accountId,
            peerKind,
            peerId,
            senderId,
            endpointKey,
            targetAgentId: previousTraceContext?.targetAgentId,
          }
          externalTraceContextRef.current[payload.traceId] = traceContext
          const textPreview = summarizeExternalChannelText(payload.text)
          appendExternalChannelEvent({
            kind: 'inbound',
            primary: textPreview ?? `${channel} · ${senderId}`,
            channel,
            status: 'received',
            secondary: `${channel} · ${senderId}`,
            detail: `peer=${payload.peerId} · msg=${payload.messageId}`,
            traceId: payload.traceId,
            accountId,
            peerKind,
            peerId,
            senderId,
            targetAgentId: traceContext.targetAgentId,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, traceContext.targetAgentId),
          })
          emitTelegramInboundDebugToast(payload)
        },
        onExternalRouted: (payload) => {
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
        },
        onExternalDispatchProgress: (payload) => {
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
        },
        onExternalReply: () => {
          // `external/channel_reply` is an internal channel ack mirrored from task dispatch,
          // not a real external provider send result. Do not show it in recent external events.
        },
        onExternalOutboundResult: (payload: ExternalChannelOutboundResultPayload) => {
          if (payload.relayMode === 'dispatch-ack') {
            return
          }
          const textPreview = summarizeExternalChannelText(payload.textPreview)
          const traceContext =
            payload.traceId && payload.traceId.trim()
              ? externalTraceContextRef.current[payload.traceId]
              : undefined
          if (payload.traceId && traceContext) {
            traceContext.targetAgentId = payload.targetAgentId
          }
          const endpointKey =
            traceContext?.endpointKey ??
            buildExternalEndpointKey({
              channel: payload.channel ?? traceContext?.channel,
              accountId: traceContext?.accountId,
              peerKind: traceContext?.peerKind,
              peerId: traceContext?.peerId,
            })
          const targetAgentId = payload.targetAgentId || traceContext?.targetAgentId
          const failureMergeKey =
            payload.status === 'failed'
              ? `outbound-failed:${payload.traceId ?? payload.messageId}:${payload.targetAgentId}:${payload.textPreview ?? ''}`
              : undefined
          appendExternalChannelEvent({
            kind: 'outbound',
            primary: textPreview ?? `${payload.targetAgentId} · ${payload.status}`,
            channel: payload.channel ?? traceContext?.channel ?? undefined,
            status: payload.status === 'failed' ? 'failed' : 'sent',
            secondary: `${payload.targetAgentId} · ${payload.status}`,
            detail: payload.status === 'failed' ? payload.detail ?? undefined : undefined,
            mergeKey: failureMergeKey,
            tsMs: payload.tsMs,
            traceId: payload.traceId ?? undefined,
            accountId: traceContext?.accountId,
            peerKind: traceContext?.peerKind,
            peerId: traceContext?.peerId,
            senderId: traceContext?.senderId,
            targetAgentId: targetAgentId ?? undefined,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, targetAgentId),
          })
        },
        onExternalError: () => {},
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    appendExternalChannelEvent,
    bindExternalTraceTarget,
    emitStationTaskSignal,
    emitTelegramInboundDebugToast,
  ])

  useEffect(() => {
    setStationTerminals(createInitialStationTerminals(stationsRef.current))
    sessionStationRef.current = {}
    terminalSessionSeqRef.current = {}
    terminalOutputQueueRef.current = {}
    terminalSessionVisibilityRef.current = {}
    stationTerminalRestoreStateRef.current = {}
    stationTerminalOutputCacheRef.current = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
      acc[station.id] = getStationIdleBanner(station)
      return acc
    }, {})
    Object.values(stationTerminalInputFlushTimerRef.current).forEach((timerId) => {
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
    })
    stationTerminalInputFlushTimerRef.current = {}
    stationTerminalInputQueueRef.current = {}
    stationTerminalInputSendingRef.current = {}
    stationSubmitSequenceRef.current = {}
    Object.entries(stationTerminalSinkRef.current).forEach(([stationId, sink]) => {
      sink.reset(stationTerminalOutputCacheRef.current[stationId])
    })
    setOpenedFiles([])
    setActiveFilePath(null)
    setFilePreviewNotice(null)
    setFileCanRenderText(false)
    setFileReadMode('full')
    setFileReadLoading(false)
    setFileReadError(null)
    setTaskDispatchHistory([])
    setTaskSending(false)
    setTaskRetryingTaskId(null)
    setTaskDraftSavedAtMs(null)
    setTaskNotice(null)
    setExternalChannelEvents([])
    externalChannelEventSeqRef.current = 0
    externalTraceContextRef.current = {}
    Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
      clearStationTaskSignalTimer(stationId)
    })
    stationTaskSignalTimerRef.current = {}
    stationTaskSignalNonceRef.current = {}
    setStationTaskSignals({})
    setTaskDraft(createInitialTaskDraft(stationsRef.current, stationsRef.current[0]?.id ?? ''))
    fileReadSeqRef.current += 1
  }, [activeWorkspaceId, clearStationTaskSignalTimer])

  useEffect(() => {
    const stationIdSet = new Set(stations.map((station) => station.id))
    setStationTerminals((prev) => {
      const next: Record<string, StationTerminalRuntime> = {}
      stations.forEach((station) => {
        next[station.id] = prev[station.id] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        }
      })
      return next
    })

    Object.keys(stationTerminalOutputCacheRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalOutputCacheRef.current[stationId]
      }
    })
    Object.keys(stationTerminalRestoreStateRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
    })
    Object.keys(stationTaskSignalTimerRef.current).forEach((stationId) => {
      if (stationIdSet.has(stationId)) {
        return
      }
      clearStationTaskSignalTimer(stationId)
      delete stationTaskSignalTimerRef.current[stationId]
      delete stationTaskSignalNonceRef.current[stationId]
    })
    stations.forEach((station) => {
      if (!stationTerminalOutputCacheRef.current[station.id]) {
        stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
      }
    })
    Object.entries(sessionStationRef.current).forEach(([sessionId, stationId]) => {
      if (!stationIdSet.has(stationId)) {
        delete sessionStationRef.current[sessionId]
        delete terminalSessionSeqRef.current[sessionId]
        delete terminalOutputQueueRef.current[sessionId]
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })
    Object.entries(stationTerminalInputFlushTimerRef.current).forEach(([stationId, timerId]) => {
      if (stationIdSet.has(stationId)) {
        return
      }
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      delete stationTerminalInputFlushTimerRef.current[stationId]
      delete stationTerminalInputQueueRef.current[stationId]
      delete stationTerminalInputSendingRef.current[stationId]
    })
    if (!activeStationId && stations[0]) {
      setActiveStationId(stations[0].id)
      return
    }
    if (activeStationId && !stationIdSet.has(activeStationId)) {
      setActiveStationId(stations[0]?.id ?? '')
    }
  }, [activeStationId, clearStationTaskSignalTimer, stations])

  useEffect(() => {
    if (!activeWorkspaceId) {
      return
    }
    setStations((prev) =>
      prev.map((station) =>
        station.workspaceId === activeWorkspaceId
          ? station
          : { ...station, workspaceId: activeWorkspaceId },
      ),
    )
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    clearStationUnread(activeStationId)
  }, [activeStationId, clearStationUnread])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    const desiredVisibility: Record<string, boolean> = {}
    Object.keys(sessionStationRef.current).forEach((sessionId) => {
      // Keep every mapped terminal session visible. Active-only visibility caused
      // focus and cursor race conditions when switching between station terminals.
      desiredVisibility[sessionId] = true
    })

    Object.entries(desiredVisibility).forEach(([sessionId, visible]) => {
      if (!visible) {
        return
      }
      if (terminalSessionVisibilityRef.current[sessionId]) {
        return
      }
      ensureTerminalSessionVisible(sessionId)
    })

    Object.keys(terminalSessionVisibilityRef.current).forEach((sessionId) => {
      if (desiredVisibility[sessionId] === undefined) {
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })
  }, [ensureTerminalSessionVisible, stationTerminals])

  useEffect(() => {
    if (activeNavId !== 'stations') {
      return
    }
    if (filteredStations.length === 0) {
      return
    }
    if (!filteredStations.some((station) => station.id === activeStationId)) {
      setActiveStationId(filteredStations[0].id)
    }
  }, [activeNavId, activeStationId, filteredStations])

  useEffect(() => {
    const nextTargetIds = resolveValidTaskTargets(stations, taskDraft.targetStationIds)
    if (areTaskTargetsEqual(nextTargetIds, taskDraft.targetStationIds)) {
      return
    }
    setTaskDraft((prev) => ({
      ...prev,
      targetStationIds: nextTargetIds,
    }))
  }, [stations, taskDraft.targetStationIds])

  const readTaskCenterSnapshotFile = useCallback(
    async (input: { workspaceId: string; taskCenterDraftFilePath: string }) => {
      if (!desktopApi.isTauriRuntime()) {
        return null
      }
      try {
        const file = await desktopApi.fsReadFile(input.workspaceId, input.taskCenterDraftFilePath)
        if (!file.previewable) {
          return null
        }
        return file.content
      } catch {
        return null
      }
    },
    [],
  )

  const writeTaskCenterSnapshotFile = useCallback(
    async (input: {
      workspaceId: string
      taskCenterDraftFilePath: string
      serializedSnapshot: string
    }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      await desktopApi.fsWriteFile(
        input.workspaceId,
        input.taskCenterDraftFilePath,
        input.serializedSnapshot,
      )
    },
    [],
  )

  useTaskCenterDraftPersistence({
    activeWorkspaceId,
    taskCenterDraftFilePath,
    stationsRef,
    activeStationId,
    taskDraft,
    taskDispatchHistory,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
    persistDebounceMs: TASK_DRAFT_PERSIST_DEBOUNCE_MS,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskDraftSavedAtMs,
    setTaskNotice,
    onReadTaskSnapshotFile: readTaskCenterSnapshotFile,
    onWriteTaskSnapshotFile: writeTaskCenterSnapshotFile,
  })

  const handlePickWorkspaceDirectory = useMemo(
    () => async () => {
      const selected = await pickDirectory({
        defaultPath: workspacePathInput || activeWorkspaceRoot || '/mnt/c/project/vbCode',
      })
      if (!selected) {
        return
      }
      const normalized = normalizeFsPath(selected)
      setWorkspacePathInput(normalized)
      await openWorkspaceAtPath(normalized, 'picker')
    },
    [activeWorkspaceRoot, openWorkspaceAtPath, workspacePathInput],
  )

  const handlePickStationWorkdir = useMemo(
    () => async (): Promise<string | null> => {
      let workspaceRoot = activeWorkspaceRoot ?? workspacePathInput.trim()
      if (!workspaceRoot && activeWorkspaceId && desktopApi.isTauriRuntime()) {
        try {
          const context = await desktopApi.workspaceGetContext(activeWorkspaceId)
          workspaceRoot = context.root
          setActiveWorkspaceRoot(context.root)
        } catch {
          workspaceRoot = ''
        }
      }
      if (!workspaceRoot) {
        window.alert(
          locale === 'zh-CN'
            ? '请先绑定工作区后再选择角色目录。'
            : 'Bind a workspace before selecting station directory.',
        )
        return null
      }
      const selected = await pickDirectory({
        defaultPath: workspaceRoot,
      })
      if (!selected) {
        return null
      }
      const relative = toRelativePathIfInside(selected, workspaceRoot)
      if (!relative) {
        window.alert(
          locale === 'zh-CN'
            ? '所选目录必须位于当前工作区内。'
            : 'Selected directory must be inside the current workspace.',
        )
        return null
      }
      return relative
    },
    [activeWorkspaceId, activeWorkspaceRoot, locale, workspacePathInput],
  )

  const connectionLabel = useMemo(() => {
    switch (connectionState.code) {
      case 'checking':
        return t(locale, 'connection.checking')
      case 'web-preview':
        return t(locale, 'connection.webPreview')
      case 'tauri-connected':
        return t(locale, 'connection.tauriConnected')
      case 'workspace-read-failed':
        return t(locale, 'connection.workspaceReadFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'git-read-failed':
        return t(locale, 'connection.gitReadFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'input-required':
        return t(locale, 'connection.inputRequired')
      case 'not-tauri':
        return t(locale, 'connection.notTauri')
      case 'open-failed':
        return t(locale, 'connection.openFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'bound':
        return t(locale, 'connection.bound', {
          detail: activeWorkspaceRoot ?? connectionState.detail ?? '',
        })
      default:
        return t(locale, 'connection.unknown')
    }
  }, [activeWorkspaceRoot, connectionState, locale])

  const resolveWorkspaceRoot = useMemo(
    () => async (workspaceId: string): Promise<string | null> => {
      if (activeWorkspaceRoot) {
        return activeWorkspaceRoot
      }
      try {
        const context = await desktopApi.workspaceGetContext(workspaceId)
        setActiveWorkspaceRoot(context.root)
        return context.root
      } catch {
        return null
      }
    },
    [activeWorkspaceRoot],
  )

  const ensureStationTerminalSession = useMemo(
    () => async (stationId: string): Promise<string | null> => {
      const existing = stationTerminalsRef.current[stationId]?.sessionId
      if (existing) {
        return existing
      }

      if (!activeWorkspaceId) {
        appendStationTerminalOutput(stationId, t(locale, 'system.bindWorkspace'))
        return null
      }
      if (!desktopApi.isTauriRuntime()) {
        appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoPty'))
        return null
      }

      try {
        const station = stationsRef.current.find((item) => item.id === stationId)
        if (!station) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.launchFailed', {
              detail: 'STATION_NOT_FOUND',
            }),
          )
          return null
        }
        const workspaceRoot = await resolveWorkspaceRoot(activeWorkspaceId)
        if (!workspaceRoot) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.launchFailed', {
              detail: 'WORKSPACE_CONTEXT_UNAVAILABLE',
            }),
          )
          return null
        }

        await desktopApi.fsWriteFile(
          activeWorkspaceId,
          buildAgentWorkspaceMarkerPath(station.agentWorkdirRel),
          '',
        )
        const agentWorkspaceCwd = resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
        const terminalEnv = {
          GTO_WORKSPACE_ID: activeWorkspaceId,
          GTO_AGENT_ID: station.id,
          GTO_ROLE_KEY: station.role,
          GTO_STATION_ID: station.id,
        }
        const session = await desktopApi.terminalCreate(activeWorkspaceId, {
          cwd: agentWorkspaceCwd,
          cwdMode: 'custom',
          env: terminalEnv,
          agentToolKind: normalizeStationToolKind(station.tool),
        })
        sessionStationRef.current[session.sessionId] = stationId
        terminalSessionSeqRef.current[session.sessionId] = 0
        terminalOutputQueueRef.current[session.sessionId] = Promise.resolve()
        delete stationTerminalRestoreStateRef.current[stationId]
        ensureTerminalSessionVisible(session.sessionId)
        const currentRuntime = stationTerminalsRef.current[stationId] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root' as const,
          resolvedCwd: null,
        }
        stationTerminalsRef.current = {
          ...stationTerminalsRef.current,
          [stationId]: {
            ...currentRuntime,
            sessionId: session.sessionId,
            stateRaw: 'running',
            unreadCount: 0,
            shell: session.shell,
            cwdMode: session.cwdMode,
            resolvedCwd: session.resolvedCwd,
          },
        }
        resetStationTerminalOutput(
          stationId,
          `${t(locale, 'system.terminalLaunched')}${t(locale, 'system.terminalSessionInfo', {
            sessionId: session.sessionId,
            cwd: session.resolvedCwd,
          })}${t(locale, 'system.stationWorkspaceInfo', {
            roleDir: station.roleWorkdirRel,
            agentDir: station.agentWorkdirRel,
          })}`,
        )
        setStationTerminalState(stationId, {
          sessionId: session.sessionId,
          stateRaw: 'running',
          unreadCount: 0,
          shell: session.shell,
          cwdMode: session.cwdMode,
          resolvedCwd: session.resolvedCwd,
        })
        return session.sessionId
      } catch (error) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.launchFailed', {
            detail: describeError(error),
          }),
        )
        return null
      }
    },
    [
      activeWorkspaceId,
      appendStationTerminalOutput,
      ensureTerminalSessionVisible,
      locale,
      resetStationTerminalOutput,
      resolveWorkspaceRoot,
      setStationTerminalState,
    ],
  )

  const launchStationTerminal = useMemo(
    () => async (stationId: string) => {
      await ensureStationTerminalSession(stationId)
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession],
  )

  const sendStationTerminalInput = useMemo(
    () => {
      const clearFlushTimer = (stationId: string) => {
        const timerId = stationTerminalInputFlushTimerRef.current[stationId]
        if (typeof timerId === 'number') {
          window.clearTimeout(timerId)
        }
        stationTerminalInputFlushTimerRef.current[stationId] = null
      }

      const flushStationInput = async (stationId: string) => {
        clearFlushTimer(stationId)
        if (stationTerminalInputSendingRef.current[stationId]) {
          return
        }
        const queuedInput = stationTerminalInputQueueRef.current[stationId] ?? ''
        if (!queuedInput) {
          return
        }
        stationTerminalInputQueueRef.current[stationId] = ''
        stationTerminalInputSendingRef.current[stationId] = true

        if (!desktopApi.isTauriRuntime()) {
          appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoInput'))
          stationTerminalInputSendingRef.current[stationId] = false
          return
        }

        try {
          let sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
          if (!sessionId) {
            sessionId = await ensureStationTerminalSession(stationId)
            if (!sessionId) {
              stationTerminalInputSendingRef.current[stationId] = false
              return
            }
          }
          await desktopApi.terminalWrite(sessionId, queuedInput)
        } catch (error) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.sendFailed', {
              detail: describeError(error),
            }),
          )
        } finally {
          stationTerminalInputSendingRef.current[stationId] = false
          if (stationTerminalInputQueueRef.current[stationId]) {
            queueMicrotask(() => {
              void flushStationInput(stationId)
            })
          }
        }
      }

      return (stationId: string, input: string) => {
        if (!input) {
          return
        }
        const previous = stationTerminalInputQueueRef.current[stationId] ?? ''
        const merged = `${previous}${input}`
        stationTerminalInputQueueRef.current[stationId] =
          merged.length > STATION_INPUT_MAX_BUFFER_BYTES
            ? merged.slice(merged.length - STATION_INPUT_MAX_BUFFER_BYTES)
            : merged

        clearFlushTimer(stationId)
        const hasLineBreak = input.includes('\n') || input.includes('\r')
        if (hasLineBreak || input.length >= STATION_INPUT_IMMEDIATE_CHUNK_BYTES) {
          void flushStationInput(stationId)
          return
        }
        if (!previous && !stationTerminalInputSendingRef.current[stationId]) {
          // Keep single-keystroke echo responsive while still batching burst traffic.
          void flushStationInput(stationId)
          return
        }
        stationTerminalInputFlushTimerRef.current[stationId] = window.setTimeout(() => {
          stationTerminalInputFlushTimerRef.current[stationId] = null
          void flushStationInput(stationId)
        }, STATION_INPUT_FLUSH_MS)
      }
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale],
  )

  const submitStationTerminal = useCallback(async (stationId: string): Promise<boolean> => {
    for (let attempt = 0; attempt <= STATION_TASK_SUBMIT_MAX_RETRY_FRAMES; attempt += 1) {
      const submittedByTerminal = stationTerminalSinkRef.current[stationId]?.submit?.() ?? false
      if (submittedByTerminal) {
        return true
      }
      if (attempt >= STATION_TASK_SUBMIT_MAX_RETRY_FRAMES) {
        return false
      }
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          resolve()
        })
      })
    }
    return false
  }, [])

  const handleStationTerminalInput = useCallback(
    (stationId: string, data: string) => {
      const submitSequence = normalizeSubmitSequence(data)
      if (submitSequence) {
        stationSubmitSequenceRef.current[stationId] = submitSequence
        const workspaceId = activeWorkspaceIdRef.current
        const sessionId = stationTerminalsRef.current[stationId]?.sessionId
        const station = stationsRef.current.find((entry) => entry.id === stationId)
        const stationRole = station?.role ?? null
        if (workspaceId && sessionId) {
          void desktopApi.agentRuntimeRegister({
            workspaceId,
            agentId: stationId,
            stationId,
            roleKey: stationRole,
            sessionId,
            toolKind: normalizeStationToolKind(station?.tool),
            resolvedCwd: stationTerminalsRef.current[stationId]?.resolvedCwd ?? null,
            submitSequence,
            online: true,
          }).catch(() => {
            // Best-effort runtime update; next periodic sync will retry.
          })
        }
      }
      sendStationTerminalInput(stationId, data)
    },
    [sendStationTerminalInput],
  )

  const writeStationTerminalCommand = useCallback(
    async (stationId: string, command: string) => {
      if (!desktopApi.isTauriRuntime()) {
        appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoInput'))
        return false
      }
      let sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId) {
        sessionId = await ensureStationTerminalSession(stationId)
      }
      if (!sessionId) {
        return false
      }
      await desktopApi.terminalWrite(sessionId, command)
      return true
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale],
  )

  const resizeStationTerminal = useMemo(
    () => (stationId: string, cols: number, rows: number) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId) {
        return
      }
      // Fire and forget - resize is best effort
      void desktopApi.terminalResize(sessionId, cols, rows).catch(() => {
        // Resize failures are non-critical
      })
    },
    [],
  )

  const reportRenderedScreenSnapshot = useMemo(
    () => (stationId: string, snapshot: RenderedScreenSnapshot) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId || snapshot.sessionId !== sessionId) {
        return
      }
      void desktopApi.terminalReportRenderedScreen(snapshot).catch(() => {
        // Snapshot reporting is best-effort and must not affect terminal interaction.
      })
    },
    [],
  )

  const launchStationCliAgent = useMemo(
    () => async (stationId: string) => {
      const sessionId = await ensureStationTerminalSession(stationId)
      if (!sessionId) {
        return
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      const launchCommand = station ? buildStationLaunchCommand(station) : null
      if (!launchCommand) {
        stationTerminalSinkRef.current[stationId]?.focus()
        return
      }
      sendStationTerminalInput(stationId, launchCommand)
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession, sendStationTerminalInput],
  )

  const ensureTaskTargetRuntime = useCallback(
    async (input: { workspaceId: string; targetStationId: string }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const station = stationsRef.current.find((item) => item.id === input.targetStationId)
      if (!station) {
        return
      }
      const sessionId = await ensureStationTerminalSession(station.id)
      if (!sessionId) {
        return
      }
      await desktopApi.agentRuntimeRegister({
        workspaceId: input.workspaceId,
        agentId: station.id,
        stationId: station.id,
        roleKey: station.role,
        sessionId,
        toolKind: normalizeStationToolKind(station.tool),
        resolvedCwd: stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
        submitSequence: stationSubmitSequenceRef.current[station.id] ?? null,
        online: true,
      })
    },
    [ensureStationTerminalSession],
  )

  const dispatchTaskBatch = useCallback(
    async (input: {
      workspaceId: string
      title: string
      markdown: string
      targetStationIds: string[]
    }) => {
      const response = await desktopApi.taskDispatchBatch({
        workspaceId: input.workspaceId,
        sender: { type: 'human', agentId: null },
        targets: input.targetStationIds,
        title: input.title,
        markdown: input.markdown,
        attachments: [],
      })
      const postSubmitResults = await Promise.all(
        response.results.map(async (result) => {
          if (result.status !== 'sent') {
            return result
          }
          const submitted = await submitStationTerminal(result.targetAgentId)
          if (submitted) {
            return result
          }
          return {
            ...result,
            status: 'failed' as const,
            detail: 'XTERM_SUBMIT_FAILED',
          }
        }),
      )
      return {
        ...response,
        results: postSubmitResults,
      }
    },
    [submitStationTerminal],
  )

  const verifyTaskFileReadable = useCallback(
    async (input: { workspaceId: string; taskFilePath: string }) => {
      await desktopApi.fsReadFile(input.workspaceId, input.taskFilePath)
    },
    [],
  )

  const deliverTaskToStation = useCallback(
    async (input: {
      station: AgentStation
      taskId: string
      taskFilePath: string
      title: string
    }) => {
      const { station, taskId, taskFilePath, title } = input
      const sessionId = await ensureStationTerminalSession(station.id)
      if (!sessionId) {
        throw new Error('TARGET_AGENT_SESSION_UNAVAILABLE')
      }
      appendStationTerminalOutput(
        station.id,
        t(locale, 'system.taskDispatched', {
          taskId,
          path: taskFilePath,
        }),
      )
      const accepted = await writeStationTerminalCommand(
        station.id,
        buildTaskDispatchCommand(taskId, taskFilePath),
      )
      if (!accepted) {
        throw new Error('TARGET_AGENT_SESSION_UNAVAILABLE')
      }
      const submitted = await submitStationTerminal(station.id)
      if (!submitted) {
        throw new Error('XTERM_SUBMIT_FAILED')
      }
      emitStationTaskSignal({
        stationId: station.id,
        taskId,
        title,
        receivedAtMs: Date.now(),
      })
    },
    [
      appendStationTerminalOutput,
      emitStationTaskSignal,
      ensureStationTerminalSession,
      locale,
      submitStationTerminal,
      writeStationTerminalCommand,
    ],
  )

  const {
    updateTaskDraft,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  } = useTaskDispatchActions({
    locale,
    activeWorkspaceId,
    stationsRef,
    taskDraft,
    taskDispatchHistory,
    taskSending,
    taskRetryingTaskId,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskNotice,
    onEnsureTaskTargetRuntime: ensureTaskTargetRuntime,
    onDispatchTaskBatch: dispatchTaskBatch,
    onVerifyTaskFileReadable: verifyTaskFileReadable,
    onDeliverTaskToStation: deliverTaskToStation,
    setStationTaskSignals,
    describeError,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
  })

  const clearTaskMentionSearch = useCallback(() => {
    if (typeof taskMentionSearchTimerRef.current === 'number') {
      window.clearTimeout(taskMentionSearchTimerRef.current)
    }
      taskMentionSearchTimerRef.current = null
      taskMentionSearchSeqRef.current += 1
      taskMentionLastQueryRef.current = ''
      setTaskMentionCandidates([])
      setTaskMentionLoading(false)
      setTaskMentionError(null)
  }, [])

  const searchTaskMentionFiles = useCallback(
    (rawQuery: string) => {
      const query = rawQuery.trim()
      if (!query || !activeWorkspaceId || !desktopApi.isTauriRuntime()) {
        clearTaskMentionSearch()
        return
      }
      if (query === taskMentionLastQueryRef.current) {
        return
      }
      taskMentionLastQueryRef.current = query

      if (typeof taskMentionSearchTimerRef.current === 'number') {
        window.clearTimeout(taskMentionSearchTimerRef.current)
      }
      const requestSeq = taskMentionSearchSeqRef.current + 1
      taskMentionSearchSeqRef.current = requestSeq
      setTaskMentionLoading(true)
      setTaskMentionError(null)

      taskMentionSearchTimerRef.current = window.setTimeout(() => {
        void desktopApi
          .fsSearchFiles(activeWorkspaceId, query, 80)
          .then((response) => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionCandidates(response.matches.slice(0, 10))
            setTaskMentionError(null)
          })
          .catch((error) => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionCandidates([])
            setTaskMentionError(
              t(localeRef.current, 'taskCenter.mentionSearchFailed', {
                detail: describeError(error),
              }),
            )
          })
          .finally(() => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionLoading(false)
          })
      }, 64)
    },
    [activeWorkspaceId, clearTaskMentionSearch],
  )

  useEffect(() => {
    clearTaskMentionSearch()
  }, [activeWorkspaceId, clearTaskMentionSearch])

  const loadStationsFromDatabase = useCallback(
    async (workspaceId: string) => {
      const [roleResponse, agentResponse] = await Promise.all([
        desktopApi.agentRoleList(workspaceId),
        desktopApi.agentList(workspaceId),
      ])
      const activeRoles = roleResponse.roles.filter((role) => role.status !== 'disabled')
      const roleMap = new Map(activeRoles.map((role) => [role.id, role]))
      setAgentRoles(activeRoles)
      setStations(
        agentResponse.agents
          .map((agent) => mapAgentProfileToStation(agent, roleMap))
          .filter((station): station is AgentStation => station !== null),
      )
    },
    [],
  )

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      setAgentRoles([])
      return
    }
    if (!activeWorkspaceId) {
      setAgentRoles([])
      setStations([])
      return
    }
    void loadStationsFromDatabase(activeWorkspaceId).catch((error) => {
      console.error('failed to load agents', error)
    })
  }, [activeWorkspaceId, loadStationsFromDatabase])

  const addStation = useMemo(
    () => async (input: CreateStationInput) => {
      if (normalizeStationWorkdirInput(input.workdir) === null) {
        window.alert(
          localeRef.current === 'zh-CN'
            ? '工作目录必须是工作区内的相对路径，不支持绝对路径或 .. 越界。'
            : 'Work directory must be a workspace-relative path without absolute path or "..".',
        )
        return
      }
      if (desktopApi.isTauriRuntime() && activeWorkspaceId) {
        const matchedRole = agentRoles.find((role) => role.roleKey === input.role)
        if (!matchedRole) {
          window.alert(
            localeRef.current === 'zh-CN'
              ? '未找到可用角色定义，请先检查数据库角色配置。'
              : 'No matching role definition was found in the database.',
          )
          return
        }
        setStationSavePending(true)
        try {
          await desktopApi.agentCreate({
            workspaceId: activeWorkspaceId,
            name: input.name,
            roleId: matchedRole.id,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: true,
            state: 'ready',
          })
          await loadStationsFromDatabase(activeWorkspaceId)
          setIsStationManageOpen(false)
        } finally {
          setStationSavePending(false)
        }
        return
      }
      const number = stationCounterRef.current
      stationCounterRef.current += 1
      const station = createStationFromNumber(number, activeWorkspaceId, input)
      setStations((prev) => [...prev, station])
      setStationTerminals((prev) => ({
        ...prev,
        [station.id]: {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        },
      }))
      stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
      setActiveStationId(station.id)
    },
    [activeWorkspaceId, agentRoles, loadStationsFromDatabase],
  )

  const updateStation = useMemo(
    () => async (stationId: string, input: CreateStationInput) => {
      if (normalizeStationWorkdirInput(input.workdir) === null) {
        window.alert(
          localeRef.current === 'zh-CN'
            ? '工作目录必须是工作区内的相对路径，不支持绝对路径或 .. 越界。'
            : 'Work directory must be a workspace-relative path without absolute path or "..".',
        )
        return
      }
      if (desktopApi.isTauriRuntime() && activeWorkspaceId) {
        const matchedRole = agentRoles.find((role) => role.roleKey === input.role)
        if (!matchedRole) {
          window.alert(
            localeRef.current === 'zh-CN'
              ? '未找到可用角色定义，请先检查数据库角色配置。'
              : 'No matching role definition was found in the database.',
          )
          return
        }
        setStationSavePending(true)
        try {
          await desktopApi.agentUpdate({
            workspaceId: activeWorkspaceId,
            agentId: stationId,
            name: input.name,
            roleId: matchedRole.id,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: true,
            state: 'ready',
          })
          await loadStationsFromDatabase(activeWorkspaceId)
          setIsStationManageOpen(false)
          setEditingStation(null)
        } finally {
          setStationSavePending(false)
        }
        return
      }
      setStations((prev) =>
        prev.map((s) => {
          if (s.id !== stationId) return s
          return {
            ...s,
            name: input.name,
            role: input.role,
            tool: input.tool,
            agentWorkdirRel: input.workdir,
            roleWorkdirRel: buildRoleWorkdirRel(input.role),
            customWorkdir: true,
          }
        }),
      )
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [activeWorkspaceId, agentRoles, loadStationsFromDatabase],
  )

  const removeStation = useMemo(
    () => async (stationId: string) => {
      const runtime = stationTerminalsRef.current[stationId]
      const mappedSessionId =
        Object.entries(sessionStationRef.current).find(([, mappedStationId]) => mappedStationId === stationId)?.[0] ??
        null
      const targetSessionId = runtime?.sessionId ?? mappedSessionId
      if (targetSessionId && desktopApi.isTauriRuntime()) {
        try {
          await desktopApi.terminalKill(targetSessionId, 'TERM')
        } catch (error) {
          const detail = describeError(error)
          if (!detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
            appendStationTerminalOutput(
              stationId,
              t(locale, 'system.killFailed', {
                detail,
              }),
            )
            return
          }
        }
      } else if (targetSessionId) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killSkippedNoRuntime', {
            sessionId: targetSessionId,
          }),
        )
      } else if (runtime?.sessionId) {
        // Defensive branch: runtime has stale session id but mapping lookup missed it.
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killFailed', {
            detail: runtime.sessionId,
          }),
        )
        return
      }

      setStationTerminalState(stationId, {
        sessionId: null,
        stateRaw: 'killed',
        unreadCount: 0,
        shell: null,
        cwdMode: 'workspace_root',
        resolvedCwd: null,
      })

      Object.entries(sessionStationRef.current).forEach(([sessionId, mappedStationId]) => {
        if (mappedStationId === stationId) {
          delete sessionStationRef.current[sessionId]
          delete terminalSessionSeqRef.current[sessionId]
          delete terminalOutputQueueRef.current[sessionId]
          delete terminalSessionVisibilityRef.current[sessionId]
        }
      })
      if (targetSessionId) {
        delete sessionStationRef.current[targetSessionId]
        delete terminalSessionSeqRef.current[targetSessionId]
        delete terminalOutputQueueRef.current[targetSessionId]
        delete terminalSessionVisibilityRef.current[targetSessionId]
      }
      const flushTimerId = stationTerminalInputFlushTimerRef.current[stationId]
      if (typeof flushTimerId === 'number') {
        window.clearTimeout(flushTimerId)
      }
      delete stationTerminalInputFlushTimerRef.current[stationId]
      delete stationTerminalInputQueueRef.current[stationId]
      delete stationTerminalInputSendingRef.current[stationId]
      delete stationTerminalRestoreStateRef.current[stationId]

      setStations((prev) => prev.filter((station) => station.id !== stationId))
      setStationTerminals((prev) => {
        const next = { ...prev }
        delete next[stationId]
        return next
      })
      delete stationTerminalOutputCacheRef.current[stationId]
      clearStationTaskSignalTimer(stationId)
      delete stationTaskSignalNonceRef.current[stationId]
      setStationTaskSignals((prev) => {
        if (!prev[stationId]) {
          return prev
        }
        const next = { ...prev }
        delete next[stationId]
        return next
      })
      const workspaceId = activeWorkspaceIdRef.current
      if (workspaceId && desktopApi.isTauriRuntime()) {
        setStationDeletePendingId(stationId)
        try {
          await desktopApi.agentDelete({
            workspaceId,
            agentId: stationId,
          })
          await loadStationsFromDatabase(workspaceId)
        } finally {
          setStationDeletePendingId(null)
        }
      }
      if (workspaceId && desktopApi.isTauriRuntime()) {
        void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
          // Runtime sync effect will retry if this one fails.
        })
      }
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [
      appendStationTerminalOutput,
      clearStationTaskSignalTimer,
      loadStationsFromDatabase,
      locale,
      setStationTerminalState,
    ],
  )

  const canvasStations = useMemo(() => {
    if (activeNavId === 'stations') {
      return filteredStations
    }
    return stations
  }, [activeNavId, filteredStations, stations])

  const terminalSessionCount = useMemo(
    () => Object.values(stationTerminals).filter((runtime) => runtime.sessionId).length,
    [stationTerminals],
  )

  const handleCanvasSelectStation = useCallback((stationId: string) => {
    setActiveStationId(stationId)
  }, [])

  const handleCanvasLaunchStationTerminal = useCallback(
    (stationId: string) => {
      void launchStationTerminal(stationId)
    },
    [launchStationTerminal],
  )

  const handleCanvasLaunchCliAgent = useCallback(
    (stationId: string) => {
      void launchStationCliAgent(stationId)
    },
    [launchStationCliAgent],
  )

  const handleCanvasOpenStationManage = useCallback(() => {
    setEditingStation(null)
    setIsStationManageOpen(true)
  }, [])

  const handleCanvasOpenStationSearch = useCallback(() => {
    setIsStationSearchOpen(true)
  }, [])

  const handleCanvasLayoutModeChange = useCallback((mode: WorkbenchLayoutMode) => {
    setCanvasLayoutMode(mode)
  }, [])

  const handleCanvasCustomLayoutChange = useCallback((layout: WorkbenchCustomLayout) => {
    setCanvasCustomLayout(normalizeCanvasCustomLayout(layout))
  }, [])

  const handleCanvasScrollToStationHandled = useCallback((stationId: string) => {
    setPendingScrollStationId((prev) => (prev === stationId ? null : prev))
  }, [])

  const handleCanvasRemoveStation = useCallback(
    (stationId: string) => {
      void removeStation(stationId)
    },
    [removeStation],
  )
  const loadFileContent = useMemo(
    () => async (filePath: string, mode: FileReadMode = 'full') => {
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return
      }

      const existingFile = openedFilesRef.current.find((file) => file.path === filePath)
      if (existingFile?.hydrated) {
        setActiveFilePath(filePath)
        setFileCanRenderText(true)
        setFilePreviewNotice(null)
        setFileReadError(null)
        return
      }

      setActiveFilePath(filePath)
      setFileReadLoading(true)
      setFileReadError(null)
      setFilePreviewNotice(null)
      const currentSeq = fileReadSeqRef.current + 1
      fileReadSeqRef.current = currentSeq

      try {
        const response =
          mode === 'full'
            ? await desktopApi.fsReadFileFull(activeWorkspaceId, filePath)
            : await desktopApi.fsReadFile(activeWorkspaceId, filePath)
        if (fileReadSeqRef.current !== currentSeq) {
          return
        }

        setFileReadMode(mode)
        if (!response.previewable) {
          setFileCanRenderText(false)
          setFilePreviewNotice(
            t(locale, 'file.previewBinary', {
              size: response.sizeBytes,
            }),
          )
          return
        }

        setFileCanRenderText(true)
        setOpenedFiles((prev) => {
          const exists = prev.some((file) => file.path === filePath)
          if (exists) {
            return prev.map((file) =>
              file.path === filePath
                ? {
                    ...file,
                    content: response.content,
                    size: response.sizeBytes,
                    hydrated: true,
                  }
                : file,
            )
          }
          return [
            ...prev,
            {
              path: filePath,
              content: response.content,
              size: response.sizeBytes,
              isModified: false,
              hydrated: true,
            },
          ]
        })
        if (response.truncated) {
          setFilePreviewNotice(
            t(locale, mode === 'full' ? 'file.previewStillTruncated' : 'file.previewTruncated', {
              preview: response.previewBytes,
              size: response.sizeBytes,
            }),
          )
        } else {
          setFilePreviewNotice(null)
        }
      } catch (error) {
        if (fileReadSeqRef.current !== currentSeq) {
          return
        }
        setFilePreviewNotice(null)
        setFileCanRenderText(false)
        setFileReadError(
          t(locale, 'file.readError', {
            detail: describeError(error),
          }),
        )
      } finally {
        if (fileReadSeqRef.current === currentSeq) {
          setFileReadLoading(false)
        }
      }
    },
    [activeWorkspaceId, locale],
  )

  useEffect(() => {
    loadFileContentRef.current = loadFileContent
  }, [loadFileContent])

  const tabSessionSnapshotEntries = useMemo(
    () =>
      openedFiles.map((file) => ({
        path: file.path,
        active: file.path === activeFilePath,
      })),
    [activeFilePath, openedFiles],
  )

  const tabSessionSnapshotSignature = useMemo(
    () =>
      tabSessionSnapshotEntries
        .map((entry) => `${entry.path}:${entry.active ? '1' : '0'}`)
        .join('|'),
    [tabSessionSnapshotEntries],
  )

  const terminalSessionSnapshotEntries = useMemo(
    () =>
      stations.reduce<WorkspaceSessionTerminalSnapshot[]>((acc, station) => {
        const runtime = stationTerminals[station.id]
        if (!runtime?.sessionId) {
          return acc
        }
        acc.push({
          stationId: station.id,
          shell: runtime.shell,
          cwdMode: runtime.cwdMode,
          resolvedCwd: runtime.resolvedCwd,
          active: station.id === activeStationId,
        })
        return acc
      }, []),
    [activeStationId, stationTerminals, stations],
  )

  const terminalSessionSnapshotSignature = useMemo(
    () =>
      terminalSessionSnapshotEntries
        .map(
          (entry) =>
            `${entry.stationId}:${entry.shell ?? ''}:${entry.cwdMode}:${entry.resolvedCwd ?? ''}:${
              entry.active ? '1' : '0'
            }`,
        )
        .join('|'),
    [terminalSessionSnapshotEntries],
  )

  useEffect(() => {
    tabSessionSnapshotRef.current = tabSessionSnapshotEntries
  }, [tabSessionSnapshotEntries])

  useEffect(() => {
    terminalSessionSnapshotRef.current = terminalSessionSnapshotEntries
  }, [terminalSessionSnapshotEntries])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      workspaceSessionHydratingRef.current = false
      return
    }

    workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    workspaceSessionRestoreTabTimersRef.current = []

    const workspaceId = activeWorkspaceId
    const restoreSeq = workspaceSessionRestoreSeqRef.current + 1
    workspaceSessionRestoreSeqRef.current = restoreSeq
    workspaceSessionHydratingRef.current = true
    let cancelled = false

    const restoreWorkspaceSession = async () => {
      try {
        const response = await desktopApi.workspaceRestoreSession(workspaceId)
        if (
          cancelled ||
          workspaceSessionRestoreSeqRef.current !== restoreSeq ||
          activeWorkspaceIdRef.current !== workspaceId
        ) {
          return
        }

        const restored = parseWorkspaceSessionSnapshot(
          JSON.stringify({
            version: 1,
            updatedAtMs: Date.now(),
            windows: response.windows,
            tabs: response.tabs,
            terminals: response.terminals,
          }),
        )
        if (!restored) {
          return
        }

        const activeNav = restored.windows[0]?.activeNavId
        if (typeof activeNav === 'string' && isNavItemId(activeNav)) {
          setActiveNavId(activeNav)
        }

        const tabsToRestore = restored.tabs.slice(0, WORKSPACE_SESSION_MAX_RESTORE_TABS)
        const activeTabPath = tabsToRestore.find((tab) => tab.active)?.path ?? tabsToRestore[0]?.path ?? null
        setOpenedFiles(
          tabsToRestore.map((tab) => ({
            path: tab.path,
            content: '',
            size: 0,
            isModified: false,
            hydrated: false,
          })),
        )
        setActiveFilePath(activeTabPath)
        if (activeTabPath) {
          await loadFileContentRef.current(activeTabPath, 'full')
        }

        const restorableTerminals = restored.terminals
          .filter((terminal) => stationsRef.current.some((station) => station.id === terminal.stationId))
          .sort((left, right) => Number(right.active) - Number(left.active))
          .slice(0, WORKSPACE_SESSION_MAX_RESTORE_TERMINALS)

        let restoredActiveStationId: string | null = null
        for (const terminal of restorableTerminals) {
          if (
            cancelled ||
            workspaceSessionRestoreSeqRef.current !== restoreSeq ||
            activeWorkspaceIdRef.current !== workspaceId
          ) {
            return
          }
          const restoreCwdMode =
            terminal.cwdMode === 'custom' && terminal.resolvedCwd ? 'custom' : 'workspace_root'
          const restoreCwd = restoreCwdMode === 'custom' ? terminal.resolvedCwd : null

          try {
            const station = stationsRef.current.find((item) => item.id === terminal.stationId)
            const terminalEnv = station
              ? {
                  GTO_WORKSPACE_ID: workspaceId,
                  GTO_AGENT_ID: station.id,
                  GTO_ROLE_KEY: station.role,
                  GTO_STATION_ID: station.id,
                }
              : undefined
            const session = await desktopApi.terminalCreate(workspaceId, {
              shell: terminal.shell,
              cwdMode: restoreCwdMode,
              cwd: restoreCwd,
              env: terminalEnv,
              agentToolKind: station ? normalizeStationToolKind(station.tool) : 'unknown',
            })
            sessionStationRef.current[session.sessionId] = terminal.stationId
            terminalSessionSeqRef.current[session.sessionId] = 0
            terminalOutputQueueRef.current[session.sessionId] = Promise.resolve()
            delete stationTerminalRestoreStateRef.current[terminal.stationId]
            ensureTerminalSessionVisible(session.sessionId)
            setStationTerminalState(terminal.stationId, {
              sessionId: session.sessionId,
              stateRaw: 'running',
              unreadCount: 0,
              shell: session.shell,
              cwdMode: session.cwdMode,
              resolvedCwd: session.resolvedCwd,
            })
            if (terminal.active && !restoredActiveStationId) {
              restoredActiveStationId = terminal.stationId
            }
          } catch {
            // Keep restore resilient: one terminal failure must not block overall restore.
          }
        }

        if (restoredActiveStationId) {
          setActiveStationId(restoredActiveStationId)
        }
      } finally {
        if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
          workspaceSessionHydratingRef.current = false
        }
      }
    }

    void restoreWorkspaceSession()

    return () => {
      cancelled = true
      workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      workspaceSessionRestoreTabTimersRef.current = []
      if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
        workspaceSessionHydratingRef.current = false
      }
    }
  }, [activeWorkspaceId, ensureTerminalSessionVisible, setStationTerminalState])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    if (workspaceSessionHydratingRef.current) {
      return
    }

    const existingTimerId = workspaceSessionPersistTimerRef.current
    if (typeof existingTimerId === 'number') {
      window.clearTimeout(existingTimerId)
    }

    const workspaceId = activeWorkspaceId
    workspaceSessionPersistTimerRef.current = window.setTimeout(() => {
      if (workspaceSessionHydratingRef.current || activeWorkspaceIdRef.current !== workspaceId) {
        return
      }
      const snapshot = buildWorkspaceSessionSnapshot({
        updatedAtMs: Date.now(),
        windows: [{ activeNavId }],
        tabs: tabSessionSnapshotRef.current,
        terminals: terminalSessionSnapshotRef.current,
      })
      const serialized = serializeWorkspaceSessionSnapshot(snapshot)
      void desktopApi.fsWriteFile(workspaceId, workspaceSessionFilePath, serialized).catch(() => {
        // Keep UI responsive: snapshot persistence is best-effort.
      })
      workspaceSessionPersistTimerRef.current = null
    }, WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS)

    return () => {
      const timerId = workspaceSessionPersistTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      workspaceSessionPersistTimerRef.current = null
    }
  }, [
    activeNavId,
    activeWorkspaceId,
    tabSessionSnapshotSignature,
    terminalSessionSnapshotSignature,
    workspaceSessionFilePath,
  ])

  const saveFileContent = useCallback(
    async (filePath: string, content: string): Promise<boolean> => {
      if (!activeWorkspaceId) {
        return false
      }

      try {
        await desktopApi.fsWriteFile(activeWorkspaceId, filePath, content)
        // 更新已打开文件的内容
        setOpenedFiles((prev) =>
          prev.map((f) =>
            f.path === filePath ? { ...f, content, isModified: false, hydrated: true } : f
          )
        )
        return true
      } catch (error) {
        setFileReadError(
          t(locale, 'fileContent.saveFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [activeWorkspaceId, locale],
  )

  const createFileInWorkspace = useMemo(
    () => async (filePath: string) => {
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return false
      }

      try {
        await desktopApi.fsWriteFile(activeWorkspaceId, filePath, '')
        await loadFileContent(filePath, 'full')
        return true
      } catch (error) {
        setFileReadError(
          t(locale, 'file.createFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [activeWorkspaceId, loadFileContent, locale],
  )

  // 关闭文件 tab
  const closeFile = useCallback(
    (filePath: string) => {
      setOpenedFiles((prev) => {
        const newFiles = prev.filter((f) => f.path !== filePath)
        // 如果关闭的是当前活动文件，切换到其他文件
        if (activeFilePath === filePath) {
          const closedIndex = prev.findIndex((f) => f.path === filePath)
          const nextFile = newFiles[Math.min(closedIndex, newFiles.length - 1)]
          setActiveFilePath(nextFile?.path ?? null)
        }
        return newFiles
      })
    },
    [activeFilePath],
  )

  // 选择文件 tab
  const selectFile = useCallback(
    (filePath: string) => {
      const existing = openedFilesRef.current.find((file) => file.path === filePath)
      if (existing && !existing.hydrated) {
        void loadFileContent(filePath, 'full')
        return
      }
      setActiveFilePath(filePath)
      setFileReadError(null)
    },
    [loadFileContent],
  )

  // 文件修改状态变化
  const handleFileModified = useCallback((filePath: string, isModified: boolean) => {
    setOpenedFiles((prev) =>
      prev.map((f) => (f.path === filePath ? { ...f, isModified } : f))
    )
  }, [])

  const deletePathInWorkspace = useMemo(
    () => async (path: string) => {
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return false
      }

      try {
        await desktopApi.fsDelete(activeWorkspaceId, path)
        // 关闭被删除的文件
        setOpenedFiles((prev) => {
          const newFiles = prev.filter((f) => f.path !== path && !f.path.startsWith(`${path}/`))
          if (activeFilePath && (activeFilePath === path || activeFilePath.startsWith(`${path}/`))) {
            const nextFile = newFiles[0]
            setActiveFilePath(nextFile?.path ?? null)
          }
          return newFiles
        })
        setFilePreviewNotice(null)
        setFileCanRenderText(openedFiles.length > 1)
        setFileReadMode('full')
        setFileReadError(null)
        setFileReadLoading(false)
        return true
      } catch (error) {
        setFileReadError(
          t(locale, 'file.deleteFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [activeFilePath, activeWorkspaceId, locale, openedFiles.length],
  )

  const movePathInWorkspace = useMemo(
    () => async (fromPath: string, toPath: string) => {
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return false
      }

      try {
        const response = await desktopApi.fsMove(activeWorkspaceId, fromPath, toPath)
        if (!response.moved) {
          return true
        }
        // 更新已打开文件的路径
        const remapped = remapSelectedPathAfterMove(activeFilePath, fromPath, toPath)
        if (remapped && remapped !== activeFilePath) {
          setOpenedFiles((prev) =>
            prev.map((f) => {
              const newPath = remapSelectedPathAfterMove(f.path, fromPath, toPath)
              return newPath && newPath !== f.path ? { ...f, path: newPath } : f
            })
          )
          setActiveFilePath(remapped)
        }
        return true
      } catch (error) {
        setFileReadError(
          t(locale, 'file.moveFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [activeFilePath, activeWorkspaceId, locale],
  )

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null
    const handleFilesystemChanged = (payload: FilesystemChangedPayload) => {
      if (!active || payload.workspaceId !== activeWorkspaceId) {
        return
      }
      const changedPaths = payload.paths.map((path) => path.replace(/^\.\/+/, ''))
      const currentOpenedFiles = openedFilesRef.current
      if (currentOpenedFiles.length === 0) {
        return
      }

      if (payload.kind === 'removed') {
        // 关闭被删除的文件
        const removedPaths = new Set(changedPaths)
        setOpenedFiles((prev) => {
          const newFiles = prev.filter((f) => !removedPaths.has(f.path))
          const activeFilePath = activeFilePathRef.current
          if (activeFilePath && removedPaths.has(activeFilePath)) {
            const nextFile = newFiles[0]
            setActiveFilePath(nextFile?.path ?? null)
          }
          return newFiles
        })
        return
      }
      if (
        payload.kind === 'modified' ||
        payload.kind === 'created' ||
        payload.kind === 'renamed' ||
        payload.kind === 'other'
      ) {
        // 重新加载已修改的已打开文件
        for (const file of currentOpenedFiles) {
          if (changedPaths.includes(file.path) && file.hydrated && !file.isModified) {
            void loadFileContent(file.path, fileReadModeRef.current)
          }
        }
      }
    }

    void desktopApi.subscribeFilesystemEvents(handleFilesystemChanged).then((unlisten) => {
      if (!active) {
        unlisten()
        return
      }
      cleanup = unlisten
    })

    return () => {
      active = false
      if (cleanup) {
        cleanup()
      }
    }
  }, [activeWorkspaceId, loadFileContent])

  const handleSelectNav = useCallback(
    (id: NavItemId) => {
      const isSameTab = id === activeNavId
      setActiveNavId(id)
      if (id === 'settings') {
        setIsSettingsOpen(true)
      }
      if (isSameTab) {
        setLeftPaneVisible((prev) => !prev)
      } else {
        setLeftPaneVisible(true)
      }
    },
    [activeNavId],
  )

  const triggerFileSearch = useCallback((mode: 'file' | 'content') => {
    setActiveNavId('files')
    setLeftPaneVisible(true)
    setFileSearchRequest((prev) => ({
      mode,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [])

  const triggerFileEditorCommand = useCallback((type: FileEditorCommandRequest['type']) => {
    setFileEditorCommandRequest((prev) => ({
      type,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [])

  const closeTaskQuickDispatch = useCallback(() => {
    setIsTaskQuickDispatchOpen(false)
  }, [])

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (document.body.dataset.gtoShortcutRecording === 'true') {
        return
      }
      const editableTarget = isEditableKeyboardTarget(event.target)
      const codeEditorTarget = isCodeEditorKeyboardTarget(event.target)

      if (matchesShortcutEvent(event, shortcutBindings.taskQuickDispatch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        setIsTaskQuickDispatchOpen((prev) => !prev)
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.openContentSearch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch('content')
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.editorFind, nativeWindowTopMacOs)) {
        if (codeEditorTarget) {
          return
        }
        if (editableTarget) {
          return
        }
        if (activeNavId === 'files' && activeFilePath) {
          event.preventDefault()
          event.stopPropagation()
          triggerFileEditorCommand('find')
          return
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.editorReplace, nativeWindowTopMacOs)) {
        if (codeEditorTarget) {
          return
        }
        if (editableTarget) {
          return
        }
        if (activeNavId === 'files' && activeFilePath) {
          event.preventDefault()
          event.stopPropagation()
          triggerFileEditorCommand('replace')
        }
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.openFileSearch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch('file')
        return
      }

      // Prevent desktop WebView reload/zoom shortcuts without swallowing plain text input.
      if (desktopApi.isTauriRuntime() && shouldPreventDesktopBrowserShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onGlobalShortcut, { capture: true })
    return () => {
      window.removeEventListener('keydown', onGlobalShortcut, { capture: true })
    }
  }, [
    activeFilePath,
    activeNavId,
    nativeWindowTopMacOs,
    shortcutBindings,
    triggerFileEditorCommand,
    triggerFileSearch,
  ])

  const handleLeftPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      leftPaneResizeRef.current = {
        pointerId,
        startX: event.clientX,
        startWidth: leftPaneWidth,
      }
      setLeftPaneResizing(true)

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      const previousBodyCursor = document.body.style.cursor
      const previousBodyUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        if (leftPaneResizeRef.current?.pointerId !== releasedPointerId) {
          return
        }
        leftPaneResizeRef.current = null
        setLeftPaneResizing(false)
        document.body.style.cursor = previousBodyCursor
        document.body.style.userSelect = previousBodyUserSelect
        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (leftPaneResizeRef.current?.pointerId !== moveEvent.pointerId) {
          return
        }
        const delta = moveEvent.clientX - leftPaneResizeRef.current.startX
        setLeftPaneWidth(clampLeftPaneWidth(leftPaneResizeRef.current.startWidth + delta))
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishResize(upEvent.pointerId)
      }

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishResize(cancelEvent.pointerId)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [leftPaneWidth],
  )

  const handleLeftPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev - step))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev + step))
    }
  }, [])

  const shellMainStyle = useMemo(
    () =>
      ({
        '--shell-left-pane-width': `${leftPaneWidth}px`,
      }) as CSSProperties,
    [leftPaneWidth],
  )

  return (
    <div
      ref={shellContainerRef}
      className={`agent-shell ${
        nativeWindowTopWindows ? 'shell-native-window-top-windows' : ''
      }`}
    >
      <AmbientBackgroundLighting
        enabled={uiPreferences.ambientLightingEnabled && !nativeWindowTopWindows}
        intensity={uiPreferences.ambientLightingIntensity}
      />
      <div ref={shellTopRef} className="shell-top-slot">
        <TopControlBar
          locale={locale}
          workspacePath={workspacePathInput}
          connectionLabel={connectionLabel}
          nativeWindowTop={nativeWindowTop}
          nativeWindowTopMacOs={nativeWindowTopMacOs}
          nativeWindowTopLinux={nativeWindowTopLinux}
          windowMaximized={windowMaximized}
          onPickWorkspaceDirectory={() => {
            void handlePickWorkspaceDirectory()
          }}
          onOpenSettings={() => {
            setIsChannelStudioOpen(false)
            setIsSettingsOpen(true)
          }}
          onWindowMinimize={handleWindowMinimize}
          onWindowToggleMaximize={handleWindowToggleMaximize}
          onWindowClose={handleWindowClose}
        />
        {telegramDebugToast ? (
          <section className="telegram-debug-toast" role="status" aria-live="polite">
            <header className="telegram-debug-toast-header">
              <strong>{t(locale, 'channel.telegram.debugToast.title')}</strong>
              <button
                type="button"
                onClick={() => {
                  const timerId = telegramDebugToastTimerRef.current
                  if (typeof timerId === 'number') {
                    window.clearTimeout(timerId)
                  }
                  telegramDebugToastTimerRef.current = null
                  setTelegramDebugToast(null)
                }}
                aria-label={t(locale, 'channel.telegram.debugToast.dismiss')}
              >
                ×
              </button>
            </header>
            <p>
              {t(locale, 'channel.telegram.debugToast.sender', {
                sender: telegramDebugToast.senderName || telegramDebugToast.senderId,
              })}
            </p>
            <p>
              {t(locale, 'channel.telegram.debugToast.peer', {
                peer: telegramDebugToast.peerId,
              })}
            </p>
            <p>
              {t(locale, 'channel.telegram.debugToast.message', {
                message: telegramDebugToast.messageId,
              })}
            </p>
            <p>
              {t(locale, 'channel.telegram.debugToast.content', {
                content: telegramDebugToast.text || t(locale, 'channel.telegram.debugToast.empty'),
              })}
            </p>
            <p>
              {t(locale, 'channel.telegram.debugToast.account', {
                account: telegramDebugToast.accountId,
              })}
            </p>
            <p className="telegram-debug-toast-time">
              {new Date(telegramDebugToast.receivedAtMs).toLocaleTimeString(
                locale === 'zh-CN' ? 'zh-CN' : 'en-US',
                { hour12: false },
              )}
            </p>
          </section>
        ) : null}
      </div>

      <main ref={shellMainRef} className="shell-main-layout relative z-10" style={shellMainStyle}>
        <div ref={shellRailRef} className="shell-rail-slot">
          <ActivityRail
            items={navItems}
            activeId={activeNavId}
            onSelect={handleSelectNav}
            locale={locale}
          />
        </div>

        {leftPaneVisible ? (
          <div
            ref={shellLeftPaneRef}
            className={`shell-pane-shell shell-left-pane ${activeNavId === 'tasks' ? 'is-task-center' : ''}`}
          >
            {activeNavId === 'files' ? (
              <FileTreePane
                locale={locale}
                workspaceId={activeWorkspaceId}
                selectedFilePath={activeFilePath}
                searchRequest={fileSearchRequest}
                onSearchRequestConsumed={(nonce) => {
                  setFileSearchRequest((prev) => {
                    if (!prev || prev.nonce !== nonce) {
                      return prev
                    }
                    return null
                  })
                }}
                onSelectFile={(filePath) => {
                  void loadFileContent(filePath, 'full')
                }}
                onCreateFile={createFileInWorkspace}
                onDeletePath={deletePathInWorkspace}
                onMovePath={movePathInWorkspace}
              />
            ) : activeNavId === 'tasks' ? (
              <div className="task-center-scroll-host">
                <TaskCenterPane
                  locale={locale}
                  stations={stations}
                  draft={taskDraft}
                  sending={taskSending}
                  draftSavedAtMs={taskDraftSavedAtMs}
                  notice={taskNotice}
                  mentionCandidates={taskMentionCandidates}
                  mentionLoading={taskMentionLoading}
                  mentionError={taskMentionError}
                  onDraftChange={updateTaskDraft}
                  onInsertSnippet={insertTaskSnippet}
                  onSendTask={() => {
                    void dispatchTaskToAgent()
                  }}
                  onSearchMentionFiles={searchTaskMentionFiles}
                  onClearMentionSearch={clearTaskMentionSearch}
                />
              </div>
            ) : activeNavId === 'stations' ? (
              <StationOverviewPane
                locale={locale}
                stations={stations}
                activeStationId={activeStationId}
                runtimeStateByStationId={runtimeStateByStationId}
                view={stationOverviewState}
                onViewChange={(patch) => {
                  setStationOverviewState((prev) => ({ ...prev, ...patch }))
                }}
                onSelectStation={(stationId) => {
                  setActiveStationId(stationId)
                }}
                onEditStation={(station) => {
                  setEditingStation(createStationEditInput(station))
                  setIsStationManageOpen(true)
                }}
              />
            ) : activeNavId === 'git' ? (
              <GitOperationsPane controller={gitController} />
            ) : activeNavId === 'channels' ? (
              <CommunicationChannelsPane
                locale={locale}
                agentNameMap={stationNameMap}
                dispatchHistory={taskDispatchHistory}
                retryingTaskId={taskRetryingTaskId}
                externalStatus={externalChannelStatus}
                externalEvents={externalChannelEvents}
                onRetryDispatchTask={(taskId) => {
                  void retryTaskDispatch(taskId)
                }}
                onRefreshExternalStatus={() => {
                  void refreshExternalChannelStatus()
                }}
              />
            ) : (
              <LeftBusinessPane model={activePaneModel} />
            )}
          </div>
        ) : null}

        {leftPaneVisible ? (
          <div
            ref={shellResizerRef}
            className={`shell-column-resizer ${leftPaneResizing ? 'active' : ''}`}
            role="separator"
            aria-label="Resize left panel"
            aria-orientation="vertical"
            aria-valuemin={LEFT_PANE_WIDTH_MIN}
            aria-valuemax={LEFT_PANE_WIDTH_MAX}
            aria-valuenow={leftPaneWidth}
            tabIndex={0}
            onPointerDown={handleLeftPaneResizePointerDown}
            onKeyDown={handleLeftPaneResizeKeyDown}
          />
        ) : null}

        <div ref={shellMainPaneRef} className="shell-pane-shell shell-main-pane">
          {activeNavId === 'files' ? (
            <FileEditorPane
              locale={locale}
              workspaceId={activeWorkspaceId}
              openedFiles={openedFiles}
              activeFilePath={activeFilePath}
              loading={fileReadLoading}
              errorMessage={fileReadError}
              noticeMessage={filePreviewNotice}
              canRenderContent={fileCanRenderText}
              onSelectFile={selectFile}
              onCloseFile={closeFile}
              onSaveFile={saveFileContent}
              onFileModified={handleFileModified}
              editorCommandRequest={fileEditorCommandRequest}
            />
          ) : activeNavId === 'git' ? (
            <GitHistoryPane controller={gitController} />
          ) : (
            <WorkbenchCanvas
              locale={locale}
              appearanceVersion={`${uiPreferences.themeMode}:${uiPreferences.monoFont}:${uiPreferences.uiFontSize}`}
              stations={canvasStations}
              activeStationId={activeStationId}
              terminalByStation={stationTerminals}
              taskSignalByStationId={stationTaskSignals}
              channelBotBindingsByStationId={channelBotBindingsByStationId}
              onSelectStation={handleCanvasSelectStation}
              onLaunchStationTerminal={handleCanvasLaunchStationTerminal}
              onLaunchCliAgent={handleCanvasLaunchCliAgent}
              onSendInputData={handleStationTerminalInput}
              onResizeTerminal={resizeStationTerminal}
              onBindTerminalSink={bindStationTerminalSink}
              onRenderedScreenSnapshot={reportRenderedScreenSnapshot}
              layoutMode={canvasLayoutMode}
              customLayout={canvasCustomLayout}
              onLayoutModeChange={handleCanvasLayoutModeChange}
              onCustomLayoutChange={handleCanvasCustomLayoutChange}
              scrollToStationId={pendingScrollStationId}
              onScrollToStationHandled={handleCanvasScrollToStationHandled}
              onOpenStationManage={handleCanvasOpenStationManage}
              onOpenStationSearch={handleCanvasOpenStationSearch}
              onRemoveStation={handleCanvasRemoveStation}
            />
          )}
        </div>

      </main>

      <div ref={shellStatusRef} className="relative z-10">
        <StatusBar
          locale={locale}
          gitBranch={gitSummary?.branch ?? '-'}
          gitBranches={gitController.branches}
          gitChangedFiles={gitSummary?.files.length ?? 0}
          onCheckoutBranch={gitController.checkoutTo}
          checkoutLoading={gitController.actionLoading === 'checkout'}
          agentOnline={6}
          agentTotal={8}
          terminalSessions={terminalSessionCount}
        />
      </div>

      <GlobalTaskDispatchOverlay
        open={isTaskQuickDispatchOpen}
        locale={locale}
        stations={stations}
        draft={taskDraft}
        sending={taskSending}
        draftSavedAtMs={taskDraftSavedAtMs}
        notice={taskNotice}
        mentionCandidates={taskMentionCandidates}
        mentionLoading={taskMentionLoading}
        mentionError={taskMentionError}
        shortcutLabel={formatShortcutBinding(shortcutBindings.taskQuickDispatch, nativeWindowTopMacOs)}
        opacity={taskQuickDispatchOpacity}
        onClose={closeTaskQuickDispatch}
        onOpacityChange={handleTaskQuickDispatchOpacityChange}
        onDraftChange={updateTaskDraft}
        onInsertSnippet={insertTaskSnippet}
        onSendTask={() => {
          void dispatchTaskToAgent()
        }}
        onSearchMentionFiles={searchTaskMentionFiles}
        onClearMentionSearch={clearTaskMentionSearch}
      />

      <SettingsModal
        open={isSettingsOpen}
        locale={locale}
        workspaceId={activeWorkspaceId}
        themeMode={uiPreferences.themeMode}
        uiFont={uiPreferences.uiFont}
        monoFont={uiPreferences.monoFont}
        uiFontSize={uiPreferences.uiFontSize}
        ambientLightingEnabled={uiPreferences.ambientLightingEnabled}
        ambientLightingIntensity={uiPreferences.ambientLightingIntensity}
        isMacOs={nativeWindowTopMacOs}
        taskQuickDispatchShortcut={shortcutBindings.taskQuickDispatch}
        defaultTaskQuickDispatchShortcut={defaultShortcutBindings.taskQuickDispatch}
        onClose={() => {
          setIsSettingsOpen(false)
        }}
        onLocaleChange={(value) => setUiPreferences((prev) => ({ ...prev, locale: value }))}
        onThemeModeChange={(value) =>
          setUiPreferences((prev) => ({
            ...prev,
            themeMode: value,
          }))
        }
        onUiFontChange={(value) =>
          setUiPreferences((prev) => ({
            ...prev,
            uiFont: value,
          }))
        }
        onMonoFontChange={(value) =>
          setUiPreferences((prev) => ({
            ...prev,
            monoFont: value,
          }))
        }
        onUiFontSizeChange={(value) =>
          setUiPreferences((prev) => ({
            ...prev,
            uiFontSize: value,
          }))
        }
        onAmbientLightingChange={handleAmbientLightingChange}
        onAmbientLightingIntensityChange={handleAmbientLightingIntensityChange}
        onTaskQuickDispatchShortcutChange={handleTaskQuickDispatchShortcutChange}
        onTaskQuickDispatchShortcutReset={handleTaskQuickDispatchShortcutReset}
      />
<StationManageModal
        open={isStationManageOpen}
        locale={locale}
        roles={agentRoles}
        editingStation={editingStation}
        saving={stationSavePending}
        deleting={stationDeletePendingId === editingStation?.id}
        onClose={() => {
          setIsStationManageOpen(false)
          setEditingStation(null)
        }}
        onPickWorkdir={handlePickStationWorkdir}
        onSubmit={(input) => {
          if (editingStation) {
            void updateStation(editingStation.id, input)
          } else {
            void addStation(input)
          }
        }}
        onDelete={(stationId) => removeStation(stationId)}
      />
      <ChannelStudio
        open={isChannelStudioOpen}
        locale={locale}
        workspaceId={activeWorkspaceId}
        onClose={() => {
          setIsChannelStudioOpen(false)
        }}
      />

      <StationSearchModal
        open={isStationSearchOpen}
        locale={locale}
        query={stationOverviewState.query}
        stations={filteredStations}
        onClose={() => {
          setIsStationSearchOpen(false)
        }}
        onQueryChange={(value) => {
          setStationOverviewState((prev) => ({ ...prev, query: value }))
        }}
        onSelectStation={(stationId) => {
          setActiveNavId('stations')
          setActiveStationId(stationId)
          setPendingScrollStationId(stationId)
        }}
      />

      <NotificationList />
    </div>
  )
}
