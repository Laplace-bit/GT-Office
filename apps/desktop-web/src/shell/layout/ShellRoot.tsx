import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { ActivityRail } from './ActivityRail'
import { AmbientBackgroundLighting } from './AmbientBackgroundLighting'
import { FileEditorPane, type OpenedFile } from './FileEditorPane'
import { FileTreePane } from './FileTreePane'
import { GitHistoryPane, GitOperationsPane } from './GitPane'
import { useGitWorkspaceController } from '@features/git'
import { LeftBusinessPane } from './LeftBusinessPane'
import { SettingsModal } from './SettingsModal'
import { StationManageModal } from './StationManageModal'
import { StationOverviewPane } from './StationOverviewPane'
import { StationSearchModal } from './StationSearchModal'
import { StatusBar } from './StatusBar'
import { TaskCenterPane } from './TaskCenterPane'
import { TopControlBar } from './TopControlBar'
import type { StationTerminalSink } from './StationXtermTerminal'
import { WorkbenchCanvas, type WorkbenchLayoutPreset } from './WorkbenchCanvas'
import {
  createDefaultStations,
  getNavItems,
  getPaneModels,
  type AgentStation,
  type CreateStationInput,
  type NavItemId,
} from './model'
import { defaultStationOverviewState, filterStationsForOverview } from '@features/workspace'
import {
  buildAgentWorkspaceMarkerPath,
  buildRoleWorkdirRel,
  buildStationWorkdirs,
  resolveAgentWorkdirAbs,
} from '@features/workspace'
import {
  buildTaskDispatchCommand,
  buildTaskCenterDraftFilePath,
  createInitialTaskDraft,
  resolveValidTaskTarget,
  useTaskDispatchActions,
  useTaskCenterDraftPersistence,
  type StationTaskSignal,
  type TaskAttachment,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from '@features/task-center'
import {
  desktopApi,
  type FilesystemChangedPayload,
  type GitStatusResponse,
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
  type UiPreferences,
} from '../state/ui-preferences'
import { pickDirectory } from '../integration/directory-picker'
import './shell-layout.css'

type FileReadMode = 'full'
type StationTerminalRuntime = {
  sessionId: string | null
  stateRaw: string
  unreadCount: number
}
const STATION_INPUT_FLUSH_MS = 4
const STATION_INPUT_MAX_BUFFER_BYTES = 65536
const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24
const STATION_PREVIEW_MAX_LINES = 6
const TASK_DISPATCH_HISTORY_LIMIT = 40
const TASK_DRAFT_PERSIST_DEBOUNCE_MS = 360
const SHELL_LAYOUT_STORAGE_KEY = 'gtoffice.shell.layout.v2'
const WORKSPACE_MEMORY_STORAGE_KEY = 'gtoffice.shell.lastWorkspace.v1'
const WORKSPACE_AUTO_OPEN_DEBOUNCE_MS = 420
const LEFT_PANE_WIDTH_MIN = 210
const LEFT_PANE_WIDTH_MAX = 390
const LEFT_PANE_WIDTH_DEFAULT = 270

function clampLeftPaneWidth(width: number): number {
  return Math.max(LEFT_PANE_WIDTH_MIN, Math.min(LEFT_PANE_WIDTH_MAX, Math.round(width)))
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
    }
    return acc
  }, {})
}

function buildTerminalPreview(content: string): string {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return ''
  }
  return lines.slice(-STATION_PREVIEW_MAX_LINES).join('\n')
}

function getStationIdleBanner(
  locale: UiPreferences['locale'],
  station: AgentStation | undefined,
): string {
  if (!station) {
    return ''
  }
  return `$ station: ${station.name}
$ role: ${station.role}
$ role_dir: ${station.roleWorkdirRel}
$ agent_dir: ${station.agentWorkdirRel}
$ tool: ${station.tool}

> ${t(locale, 'workbench.noLiveOutput')}
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
  const role = input?.role ?? 'implementation'
  const normalizedWorkdir = normalizeStationWorkdirInput(input?.workdir ?? '')
  const hasCustomWorkdir = typeof normalizedWorkdir === 'string' && normalizedWorkdir.length > 0
  const workdir = hasCustomWorkdir
    ? normalizedWorkdir
    : buildStationWorkdirs(role, id).agentWorkdirRel
  return {
    id,
    name: input?.name?.trim() ? input.name.trim() : `工位-${suffix}`,
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

export function ShellRoot() {
  const initialStations = useMemo(() => createDefaultStations(), [])
  const stationCounterRef = useRef(nextStationNumber(initialStations))
  const tauriRuntime = desktopApi.isTauriRuntime()
  const nativeWindowTop = tauriRuntime
  const nativeWindowTopMacOs = tauriRuntime && isMacOsPlatform()
  const nativeWindowTopLinux = tauriRuntime && !nativeWindowTopMacOs && isLinuxPlatform()
  const nativeWindowTopWindows = nativeWindowTop && !nativeWindowTopMacOs && !nativeWindowTopLinux
  const [uiPreferences, setUiPreferences] = useState(loadUiPreferences)
  const [leftPaneWidth, setLeftPaneWidth] = useState(loadLeftPaneWidthPreference)
  const [leftPaneResizing, setLeftPaneResizing] = useState(false)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true)
  const [activeNavId, setActiveNavId] = useState<NavItemId>('stations')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isStationManageOpen, setIsStationManageOpen] = useState(false)
  const [isStationSearchOpen, setIsStationSearchOpen] = useState(false)
  const [canvasLayoutPreset, setCanvasLayoutPreset] = useState<WorkbenchLayoutPreset>('auto')
  const [pendingScrollStationId, setPendingScrollStationId] = useState<string | null>(null)
  const [stations, setStations] = useState<AgentStation[]>(initialStations)
  const [stationOverviewState, setStationOverviewState] = useState(defaultStationOverviewState)
  const [activeStationId, setActiveStationId] = useState(initialStations[0]?.id ?? '')
  const [taskDraft, setTaskDraft] = useState<TaskDraftState>(() =>
    createInitialTaskDraft(initialStations, initialStations[0]?.id ?? ''),
  )
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([])
  const [taskDispatchHistory, setTaskDispatchHistory] = useState<TaskDispatchRecord[]>([])
  const [taskSending, setTaskSending] = useState(false)
  const [taskRetryingTaskId, setTaskRetryingTaskId] = useState<string | null>(null)
  const [taskDraftSavedAtMs, setTaskDraftSavedAtMs] = useState<number | null>(null)
  const [taskNotice, setTaskNotice] = useState<TaskCenterNotice | null>(null)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [stationTaskSignals, setStationTaskSignals] = useState<Record<string, StationTaskSignal>>({})
  const [workspacePathInput, setWorkspacePathInput] = useState(
    () => loadRememberedWorkspacePath() ?? '/mnt/c/project/vbCode',
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
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalInputQueueRef = useRef<Record<string, string>>({})
  const stationTerminalInputFlushTimerRef = useRef<Record<string, number | null>>({})
  const stationTerminalInputSendingRef = useRef<Record<string, boolean>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const terminalSnapshotSeqRef = useRef(0)
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
  const fileReadSeqRef = useRef(0)
  const activeWorkspaceIdRef = useRef<string | null>(null)
  const gitRefreshTimerRef = useRef<number | null>(null)
  const workspaceOpenInFlightRef = useRef(false)
  const workspaceAutoOpenTimerRef = useRef<number | null>(null)
  const lastAutoOpenedPathRef = useRef<string | null>(loadRememberedWorkspacePath())

  const locale = uiPreferences.locale
  const navItems = useMemo(() => getNavItems(locale), [locale])
  const paneModels = useMemo(() => getPaneModels(locale), [locale])
  const taskCenterDraftFilePath = useMemo(() => buildTaskCenterDraftFilePath(), [])

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
    return () => {
      const gitTimerId = gitRefreshTimerRef.current
      if (typeof gitTimerId === 'number') {
        window.clearTimeout(gitTimerId)
      }
      gitRefreshTimerRef.current = null
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

    const loadAmbientLightingSetting = async () => {
      try {
        const response = await desktopApi.settingsGetEffective(activeWorkspaceId)
        if (disposed) {
          return
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

    void loadAmbientLightingSetting()

    void desktopApi
      .subscribeSettingsUpdated((payload) => {
        if (payload.workspaceId && activeWorkspaceId && payload.workspaceId !== activeWorkspaceId) {
          return
        }
        if (payload.workspaceId && !activeWorkspaceId) {
          return
        }
        void loadAmbientLightingSetting()
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(
      SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        leftPaneWidth,
      }),
    )
  }, [leftPaneWidth])

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

    void desktopApi.windowSetDecorations(false)
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
  }, [nativeWindowTop])

  useEffect(() => {
    const draggingClassName = 'vb-window-dragging'
    if (!nativeWindowTop) {
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
  }, [nativeWindowTop])

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
      const fallback = getStationIdleBanner(localeRef.current, station)
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
        }
        return {
          ...prev,
          [stationId]: {
            ...current,
            ...patch,
          },
        }
      })
    },
    [],
  )

  const clearStationUnread = useMemo(
    () => (stationId: string) => {
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

  const incrementStationUnread = useMemo(
    () => (stationId: string, delta: number) => {
      if (delta <= 0) {
        return
      }
      setStationTerminals((prev) => {
        const current = prev[stationId]
        if (!current) {
          return prev
        }
        return {
          ...prev,
          [stationId]: {
            ...current,
            unreadCount: Math.min(999, current.unreadCount + delta),
          },
        }
      })
    },
    [],
  )

  const bindStationTerminalSink = useMemo(
    () => (stationId: string, sink: StationTerminalSink | null) => {
      if (!sink) {
        delete stationTerminalSinkRef.current[stationId]
        return
      }
      stationTerminalSinkRef.current[stationId] = sink
      const station = stationsRef.current.find((item) => item.id === stationId)
      const snapshot =
        stationTerminalOutputCacheRef.current[stationId] ??
        getStationIdleBanner(localeRef.current, station)
      sink.reset(snapshot)
    },
    [],
  )

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
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            return
          }
          const text = decodeBase64Chunk(payload.chunk)
          if (text) {
            appendStationTerminalOutput(stationId, text)
          }
          if (stationId !== activeStationId) {
            incrementStationUnread(stationId, 1)
          }
        },
        onStateChanged: (payload: TerminalStatePayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            return
          }
          setStationTerminalState(stationId, { stateRaw: payload.to })
          appendStationTerminalOutput(stationId, `\n[terminal:${payload.to}]\n`)
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
    setStationTerminalState,
  ])

  useEffect(() => {
    setStationTerminals(createInitialStationTerminals(stationsRef.current))
    sessionStationRef.current = {}
    terminalSessionVisibilityRef.current = {}
    terminalSnapshotSeqRef.current += 1
    stationTerminalOutputCacheRef.current = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
      acc[station.id] = getStationIdleBanner(localeRef.current, station)
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
    setTaskAttachments([])
    setTaskDispatchHistory([])
    setTaskSending(false)
    setTaskRetryingTaskId(null)
    setTaskDraftSavedAtMs(null)
    setTaskNotice(null)
    setStationTaskSignals({})
    setTaskDraft(createInitialTaskDraft(stationsRef.current, stationsRef.current[0]?.id ?? ''))
    fileReadSeqRef.current += 1
  }, [activeWorkspaceId])

  useEffect(() => {
    const stationIdSet = new Set(stations.map((station) => station.id))
    setStationTerminals((prev) => {
      const next: Record<string, StationTerminalRuntime> = {}
      stations.forEach((station) => {
        next[station.id] = prev[station.id] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
        }
      })
      return next
    })

    Object.keys(stationTerminalOutputCacheRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalOutputCacheRef.current[stationId]
      }
    })
    stations.forEach((station) => {
      if (!stationTerminalOutputCacheRef.current[station.id]) {
        stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(localeRef.current, station)
      }
    })
    Object.entries(sessionStationRef.current).forEach(([sessionId, stationId]) => {
      if (!stationIdSet.has(stationId)) {
        delete sessionStationRef.current[sessionId]
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
  }, [activeStationId, stations])

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

  const activeStationSessionId = stationTerminals[activeStationId]?.sessionId ?? null

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
    Object.entries(sessionStationRef.current).forEach(([sessionId, stationId]) => {
      desiredVisibility[sessionId] = stationId === activeStationId
    })

    Object.entries(desiredVisibility).forEach(([sessionId, visible]) => {
      if (terminalSessionVisibilityRef.current[sessionId] === visible) {
        return
      }
      terminalSessionVisibilityRef.current[sessionId] = visible
      void desktopApi.terminalSetVisibility(sessionId, visible).catch(() => {
        // Ignore transient sync failure; next render cycle will retry.
      })
    })

    Object.keys(terminalSessionVisibilityRef.current).forEach((sessionId) => {
      if (desiredVisibility[sessionId] === undefined) {
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })

    const activeSessionId = activeStationSessionId
    if (!activeSessionId) {
      return
    }
    const snapshotSeq = terminalSnapshotSeqRef.current + 1
    terminalSnapshotSeqRef.current = snapshotSeq
    void desktopApi
      .terminalReadSnapshot(activeSessionId, 262_144)
      .then((snapshot) => {
        if (terminalSnapshotSeqRef.current !== snapshotSeq) {
          return
        }
        const mappedStationId = sessionStationRef.current[snapshot.sessionId]
        if (!mappedStationId || mappedStationId !== activeStationId) {
          return
        }
        const text = decodeBase64Chunk(snapshot.chunk)
        if (text) {
          resetStationTerminalOutput(mappedStationId, text)
        }
        clearStationUnread(mappedStationId)
      })
      .catch(() => {
        // Snapshot is a best-effort replay path.
      })
  }, [
    activeStationId,
    activeStationSessionId,
    clearStationUnread,
    decodeBase64Chunk,
    resetStationTerminalOutput,
  ])

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
    const nextTargetId = resolveValidTaskTarget(stations, taskDraft.targetStationId, activeStationId)
    if (nextTargetId === taskDraft.targetStationId) {
      return
    }
    setTaskDraft((prev) => ({
      ...prev,
      targetStationId: nextTargetId,
    }))
  }, [activeStationId, stations, taskDraft.targetStationId])

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
    taskAttachments,
    taskDispatchHistory,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
    persistDebounceMs: TASK_DRAFT_PERSIST_DEBOUNCE_MS,
    setTaskDraft,
    setTaskAttachments,
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
            ? '请先绑定工作区后再选择岗位目录。'
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
        const session = await desktopApi.terminalCreate(activeWorkspaceId, {
          cwd: agentWorkspaceCwd,
          cwdMode: 'custom',
        })
        sessionStationRef.current[session.sessionId] = stationId
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

  const launchStationCliAgent = useMemo(
    () => async (stationId: string) => {
      const sessionId = await ensureStationTerminalSession(stationId)
      if (!sessionId) {
        return
      }
      sendStationTerminalInput(stationId, 'codex\n')
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession, sendStationTerminalInput],
  )

  const persistTaskDocument = useCallback(
    async (input: {
      workspaceId: string
      taskFilePath: string
      manifestPath: string
      markdownContent: string
      manifestContent: string
    }) => {
      await desktopApi.fsWriteFile(input.workspaceId, input.taskFilePath, input.markdownContent)
      await desktopApi.fsWriteFile(input.workspaceId, input.manifestPath, input.manifestContent)
    },
    [],
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
      setStationTaskSignals: Dispatch<SetStateAction<Record<string, StationTaskSignal>>>
    }) => {
      const { station, taskId, taskFilePath, title, setStationTaskSignals } = input
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
      sendStationTerminalInput(station.id, `${buildTaskDispatchCommand(taskId, taskFilePath)}\n`)
      setStationTaskSignals((prev) => {
        const previousSignal = prev[station.id]
        return {
          ...prev,
          [station.id]: {
            nonce: (previousSignal?.nonce ?? 0) + 1,
            taskId,
            title,
            receivedAtMs: Date.now(),
          },
        }
      })
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale, sendStationTerminalInput],
  )

  const {
    updateTaskDraft,
    addTaskAttachmentByPath,
    addTaskAttachmentFromInput,
    removeTaskAttachment,
    insertTaskAttachmentReference,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  } = useTaskDispatchActions({
    locale,
    activeWorkspaceId,
    activeStationId,
    stationsRef,
    taskDraft,
    taskAttachments,
    taskDispatchHistory,
    taskSending,
    taskRetryingTaskId,
    setTaskDraft,
    setTaskAttachments,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskNotice,
    onPersistTaskDocument: persistTaskDocument,
    onVerifyTaskFileReadable: verifyTaskFileReadable,
    onDeliverTaskToStation: deliverTaskToStation,
    setStationTaskSignals,
    describeError,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
  })

  const addStation = useMemo(
    () => (input: CreateStationInput) => {
      if (normalizeStationWorkdirInput(input.workdir) === null) {
        window.alert(
          localeRef.current === 'zh-CN'
            ? '工作目录必须是工作区内的相对路径，不支持绝对路径或 .. 越界。'
            : 'Work directory must be a workspace-relative path without absolute path or "..".',
        )
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
        },
      }))
      stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(localeRef.current, station)
      setActiveStationId(station.id)
    },
    [activeWorkspaceId],
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
      })

      Object.entries(sessionStationRef.current).forEach(([sessionId, mappedStationId]) => {
        if (mappedStationId === stationId) {
          delete sessionStationRef.current[sessionId]
          delete terminalSessionVisibilityRef.current[sessionId]
        }
      })
      if (targetSessionId) {
        delete sessionStationRef.current[targetSessionId]
        delete terminalSessionVisibilityRef.current[targetSessionId]
      }
      const flushTimerId = stationTerminalInputFlushTimerRef.current[stationId]
      if (typeof flushTimerId === 'number') {
        window.clearTimeout(flushTimerId)
      }
      delete stationTerminalInputFlushTimerRef.current[stationId]
      delete stationTerminalInputQueueRef.current[stationId]
      delete stationTerminalInputSendingRef.current[stationId]

      setStations((prev) => prev.filter((station) => station.id !== stationId))
      setStationTerminals((prev) => {
        const next = { ...prev }
        delete next[stationId]
        return next
      })
      delete stationTerminalOutputCacheRef.current[stationId]
      setStationTaskSignals((prev) => {
        if (!prev[stationId]) {
          return prev
        }
        const next = { ...prev }
        delete next[stationId]
        return next
      })
    },
    [appendStationTerminalOutput, locale, setStationTerminalState],
  )

  const canvasStations = useMemo(() => {
    if (activeNavId === 'stations') {
      return filteredStations
    }
    return stations
  }, [activeNavId, filteredStations, stations])

  const terminalPreviewByStation = useMemo(
    () =>
      canvasStations.reduce<Record<string, string>>((acc, station) => {
        const snapshot =
          stationTerminalOutputCacheRef.current[station.id] ?? getStationIdleBanner(localeRef.current, station)
        acc[station.id] = buildTerminalPreview(snapshot)
        return acc
      }, {}),
    [canvasStations, stationTerminals],
  )

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
    setIsStationManageOpen(true)
  }, [])

  const handleCanvasOpenStationSearch = useCallback(() => {
    setIsStationSearchOpen(true)
  }, [])

  const handleCanvasLayoutPresetChange = useCallback((preset: WorkbenchLayoutPreset) => {
    setCanvasLayoutPreset(preset)
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

    // 检查文件是否已打开
    const existingFile = openedFiles.find((f) => f.path === filePath)
    if (existingFile) {
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
        // 添加到已打开文件列表
        setOpenedFiles((prev) => {
          const exists = prev.some((f) => f.path === filePath)
          if (exists) {
            return prev.map((f) =>
              f.path === filePath
                ? { ...f, content: response.content, size: response.sizeBytes }
                : f
            )
          }
          return [...prev, { path: filePath, content: response.content, size: response.sizeBytes, isModified: false }]
        })
        if (response.truncated) {
          setFilePreviewNotice(
            t(locale, mode === 'full' ? 'file.previewStillTruncated' : 'file.previewTruncated', {
              preview: response.previewBytes,
              size: response.sizeBytes,
            }),
          )
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
    [activeWorkspaceId, locale, openedFiles],
  )

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
            f.path === filePath ? { ...f, content, isModified: false } : f
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
  const selectFile = useCallback((filePath: string) => {
    setActiveFilePath(filePath)
  }, [])

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
    if (!activeWorkspaceId || openedFiles.length === 0 || !desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null
    const handleFilesystemChanged = (payload: FilesystemChangedPayload) => {
      if (!active || payload.workspaceId !== activeWorkspaceId) {
        return
      }
      const changedPaths = payload.paths.map((path) => path.replace(/^\.\/+/, ''))

      if (payload.kind === 'removed') {
        // 关闭被删除的文件
        const removedPaths = new Set(changedPaths)
        setOpenedFiles((prev) => {
          const newFiles = prev.filter((f) => !removedPaths.has(f.path))
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
        for (const file of openedFiles) {
          if (changedPaths.includes(file.path) && !file.isModified) {
            void loadFileContent(file.path, fileReadMode)
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
  }, [activeFilePath, activeWorkspaceId, fileReadMode, loadFileContent, openedFiles])

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

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      const modKey = nativeWindowTopMacOs ? event.metaKey : event.ctrlKey
      if (!modKey || event.altKey) {
        return
      }
      const key = event.key.toLowerCase()

      if (key === 'f') {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch(event.shiftKey ? 'content' : 'file')
        return
      }
      if (key === 'p') {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch('file')
        return
      }

      // Prevent WebView default browser shortcuts in desktop runtime.
      if (desktopApi.isTauriRuntime() && (key === 'r' || key === '+' || key === '=' || key === '-' || key === '0')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onGlobalShortcut, { capture: true })
    return () => {
      window.removeEventListener('keydown', onGlobalShortcut, { capture: true })
    }
  }, [nativeWindowTopMacOs, triggerFileSearch])

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
      className="h-full max-h-full box-border grid grid-rows-[auto_1fr_auto] gap-[10px] p-[0_12px_12px] overflow-hidden bg-vb-bg transition-colors duration-300 relative"
    >
      <AmbientBackgroundLighting
        enabled={uiPreferences.ambientLightingEnabled && !nativeWindowTopWindows}
        intensity={uiPreferences.ambientLightingIntensity}
      />

      <div ref={shellTopRef} className="relative z-40">
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
            setIsSettingsOpen(true)
          }}
          onWindowMinimize={handleWindowMinimize}
          onWindowToggleMaximize={handleWindowToggleMaximize}
          onWindowClose={handleWindowClose}
        />
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
          <div ref={shellLeftPaneRef} className="shell-pane-shell shell-left-pane">
            {activeNavId === 'files' ? (
              <FileTreePane
                locale={locale}
                workspaceId={activeWorkspaceId}
                selectedFilePath={activeFilePath}
                searchRequest={fileSearchRequest}
                onSelectFile={(filePath) => {
                  void loadFileContent(filePath, 'full')
                }}
                onCreateFile={createFileInWorkspace}
                onDeletePath={deletePathInWorkspace}
                onMovePath={movePathInWorkspace}
              />
            ) : activeNavId === 'tasks' ? (
              <TaskCenterPane
                locale={locale}
                stations={stations}
                selectedFilePath={activeFilePath}
                draft={taskDraft}
                attachments={taskAttachments}
                dispatchHistory={taskDispatchHistory}
                sending={taskSending}
                retryingTaskId={taskRetryingTaskId}
                draftSavedAtMs={taskDraftSavedAtMs}
                notice={taskNotice}
                onDraftChange={updateTaskDraft}
                onAddAttachmentFromInput={addTaskAttachmentFromInput}
                onAddAttachmentPath={addTaskAttachmentByPath}
                onRemoveAttachment={removeTaskAttachment}
                onInsertAttachmentReference={insertTaskAttachmentReference}
                onInsertSnippet={insertTaskSnippet}
                onSendTask={() => {
                  void dispatchTaskToAgent()
                }}
                onRetryDispatchTask={(taskId) => {
                  void retryTaskDispatch(taskId)
                }}
              />
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
                onOpenManageModal={() => {
                  setIsStationManageOpen(true)
                }}
                onRemoveStation={(stationId) => {
                  void removeStation(stationId)
                }}
              />
            ) : activeNavId === 'git' ? (
              <GitOperationsPane controller={gitController} />
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
            />
          ) : activeNavId === 'git' ? (
            <GitHistoryPane controller={gitController} />
          ) : (
            <WorkbenchCanvas
              locale={locale}
              appearanceVersion={`${uiPreferences.themeMode}:${uiPreferences.monoFont}`}
              stations={canvasStations}
              activeStationId={activeStationId}
              terminalByStation={stationTerminals}
              terminalPreviewByStation={terminalPreviewByStation}
              taskSignalByStationId={stationTaskSignals}
              onSelectStation={handleCanvasSelectStation}
              onLaunchStationTerminal={handleCanvasLaunchStationTerminal}
              onLaunchCliAgent={handleCanvasLaunchCliAgent}
              onSendInputData={sendStationTerminalInput}
              onResizeTerminal={resizeStationTerminal}
              onBindTerminalSink={bindStationTerminalSink}
              layoutPreset={canvasLayoutPreset}
              onLayoutPresetChange={handleCanvasLayoutPresetChange}
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

      <SettingsModal
        open={isSettingsOpen}
        locale={locale}
        workspaceId={activeWorkspaceId}
        themeMode={uiPreferences.themeMode}
        uiFont={uiPreferences.uiFont}
        monoFont={uiPreferences.monoFont}
        ambientLightingEnabled={uiPreferences.ambientLightingEnabled}
        ambientLightingIntensity={uiPreferences.ambientLightingIntensity}
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
        onAmbientLightingChange={handleAmbientLightingChange}
        onAmbientLightingIntensityChange={handleAmbientLightingIntensityChange}
      />

      <StationManageModal
        open={isStationManageOpen}
        locale={locale}
        onClose={() => {
          setIsStationManageOpen(false)
        }}
        onPickWorkdir={handlePickStationWorkdir}
        onSubmit={(input) => {
          addStation(input)
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
    </div>
  )
}
