import { createPortal } from 'react-dom'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import {
  type DaemonSearchBackpressurePayload,
  type DaemonSearchCancelledPayload,
  type DaemonSearchChunkPayload,
  type DaemonSearchDonePayload,
  desktopApi,
  type FilesystemChangedPayload,
  type FilesystemWatchErrorPayload,
  type FsEntry,
  type FsSearchMatch,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { FileSearchModal } from './FileSearchModal'
import { FileTreePromptModal, FileTreeConfirmModal } from './FileTreeModals'
import { resolveFileVisual, type FileVisual } from './file-visuals'
import { addNotification } from '../../stores/notification'
import './FileTreePane.scss'

interface FileTreePaneProps {
  locale: Locale
  workspaceId: string | null
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
  onCreateFile: (filePath: string) => Promise<boolean>
  onDeletePath: (path: string) => Promise<boolean>
  onMovePath: (fromPath: string, toPath: string) => Promise<boolean>
  searchRequest?: {
    mode: 'file' | 'content'
    nonce: number
  } | null
  onSearchRequestConsumed?: (nonce: number) => void
}

interface TreeRow {
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  depth: number
  expanded: boolean
  loading: boolean
}

interface TreeContextMenuState {
  x: number
  y: number
  path: string
  kind: 'dir' | 'file'
}

const ROOT_DIR = '.'
const ROW_HEIGHT = 34
const OVERSCAN_ROWS = 80
const CONTENT_MATCH_MAX_RENDER = 1200
const PRE_RENDER_AHEAD_ROWS = 200
const PRE_RENDER_BEHIND_ROWS = 40
const INITIAL_PRELOAD_ROWS = 400
const SPEED_TIER_SAMPLE_MS = 32
const SPEED_MEDIUM_PX_PER_SEC = 900
const SPEED_FAST_PX_PER_SEC = 1800
const SPEED_MEDIUM_EXTRA_ROWS = 400
const SPEED_FAST_EXTRA_ROWS = 800
const SEARCH_DEBOUNCE_MS = 48
const INITIAL_EXPANDED: Record<string, boolean> = {
  [ROOT_DIR]: true,
}

function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === ROOT_DIR || trimmed === './') {
    return ROOT_DIR
  }
  return trimmed.replace(/^\.\/+/, '').replace(/\/+$/, '')
}

function parentDirectory(path: string): string {
  const normalized = normalizeDirectoryPath(path)
  if (normalized === ROOT_DIR) {
    return ROOT_DIR
  }
  const index = normalized.lastIndexOf('/')
  if (index < 0) {
    return ROOT_DIR
  }
  return normalized.slice(0, index)
}

function leafName(path: string): string {
  const normalized = normalizeDirectoryPath(path)
  if (normalized === ROOT_DIR) {
    return ROOT_DIR
  }
  const index = normalized.lastIndexOf('/')
  if (index < 0) {
    return normalized
  }
  return normalized.slice(index + 1)
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'dir' ? -1 : 1
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

function buildRows(
  byDirectory: Record<string, FsEntry[]>,
  expanded: Record<string, boolean>,
  loading: Record<string, boolean>,
  directory: string,
  depth: number,
): TreeRow[] {
  const children = byDirectory[directory] ?? []
  const rows: TreeRow[] = []
  for (const entry of children) {
    const normalizedPath = normalizeDirectoryPath(entry.path)
    const row: TreeRow = {
      path: normalizedPath,
      name: entry.name,
      kind: entry.kind,
      visual: resolveFileVisual(entry.name, entry.kind, Boolean(expanded[normalizedPath])),
      depth,
      expanded: Boolean(expanded[normalizedPath]),
      loading: Boolean(loading[normalizedPath]),
    }
    rows.push(row)
    if (entry.kind === 'dir' && row.expanded) {
      rows.push(...buildRows(byDirectory, expanded, loading, normalizedPath, depth + 1))
    }
  }
  return rows
}

function isPathUnder(path: string, ancestor: string): boolean {
  const normalizedPath = normalizeDirectoryPath(path)
  const normalizedAncestor = normalizeDirectoryPath(ancestor)
  if (normalizedAncestor === ROOT_DIR) {
    return true
  }
  return (
    normalizedPath === normalizedAncestor || normalizedPath.startsWith(`${normalizedAncestor}/`)
  )
}

function resolveFocusedTreeItem(): { path: string; kind: 'dir' | 'file' } | null {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) {
    return null
  }
  const elementWithPath = activeElement.closest<HTMLElement>('[data-path]')
  const path = elementWithPath?.dataset.path
  if (!path) {
    return null
  }
  const elementWithKind = activeElement.closest<HTMLElement>('[data-kind]')
  const kind = elementWithKind?.dataset.kind
  if (kind === 'dir' || kind === 'file') {
    return { path, kind }
  }
  return { path, kind: 'file' }
}

interface TreeRowItemProps {
  row: TreeRow
  virtualStart: number
  virtualSize: number
  isSelected: boolean
  isCut: boolean
  animateFromExpansion: boolean
  animationDelayMs: number
  loadingText: string
  onToggleDirectory: (event: MouseEvent<HTMLButtonElement>) => void
  onSelectFile: (event: MouseEvent<HTMLButtonElement>) => void
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
}

const TreeRowItem = memo(function TreeRowItem({
  row,
  virtualStart,
  virtualSize,
  isSelected,
  isCut,
  animateFromExpansion,
  animationDelayMs,
  loadingText,
  onToggleDirectory,
  onSelectFile,
  onContextMenu,
}: TreeRowItemProps) {
  const NodeIcon = row.visual.icon

  return (
    <div
      className={`tree-row tree-row-${row.kind} ${
        row.kind === 'file' && isSelected ? 'tree-row-selected' : ''
      } tree-row-visual-${row.visual.kind} ${isCut ? 'tree-row-cut' : ''} ${
        animateFromExpansion ? 'tree-row-expand-enter' : ''
      }`}
      data-path={row.path}
      data-kind={row.kind}
      style={{
        transform: `translate3d(0, ${virtualStart}px, 0)`,
        height: `${virtualSize}px`,
        paddingLeft: `${8 + row.depth * 14}px`,
        animationDelay: animateFromExpansion ? `${animationDelayMs}ms` : undefined,
      }}
      onContextMenu={onContextMenu}
    >
      {row.kind === 'dir' ? (
        <button
          type="button"
          className="tree-toggle"
          data-path={row.path}
          onClick={onToggleDirectory}
        >
          <span className="tree-chevron">
            <AppIcon
              name={row.expanded ? 'chevron-down' : 'chevron-right'}
              className="vb-icon vb-icon-tree-chevron"
              aria-hidden="true"
            />
          </span>
          <span className={`tree-node-icon tree-node-icon--${row.visual.kind}`} aria-hidden="true">
            <NodeIcon className="vb-icon vb-icon-tree-node" />
          </span>
          <span className="tree-toggle-label">{row.name}</span>
          {row.loading ? (
            <span className="tree-loading">{loadingText}</span>
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          className="tree-file-button"
          data-path={row.path}
          onClick={onSelectFile}
          title={row.path}
        >
          <span className="tree-file">
            <span className={`tree-node-icon tree-node-icon--${row.visual.kind}`} aria-hidden="true">
              <NodeIcon className="vb-icon vb-icon-tree-node" />
            </span>
            <span className="tree-file-name">{row.name}</span>
            {row.visual.badge ? <span className="tree-file-badge">{row.visual.badge}</span> : null}
          </span>
        </button>
      )}
    </div>
  )
}, (prev, next) => {
  return (
    prev.row.path === next.row.path &&
    prev.row.expanded === next.row.expanded &&
    prev.row.loading === next.row.loading &&
    prev.row.name === next.row.name &&
    prev.row.kind === next.row.kind &&
    prev.row.visual.kind === next.row.visual.kind &&
    prev.row.visual.badge === next.row.visual.badge &&
    prev.row.visual.icon === next.row.visual.icon &&
    prev.row.depth === next.row.depth &&
    prev.isSelected === next.isSelected &&
    prev.isCut === next.isCut &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.animateFromExpansion === next.animateFromExpansion &&
    prev.animationDelayMs === next.animationDelayMs
  )
})

export function FileTreePane({
  locale,
  workspaceId,
  selectedFilePath,
  onSelectFile,
  onCreateFile,
  onDeletePath,
  onMovePath,
  searchRequest,
  onSearchRequestConsumed,
}: FileTreePaneProps) {
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FsEntry[]>>({})
  const [expandedDirectories, setExpandedDirectories] =
    useState<Record<string, boolean>>(INITIAL_EXPANDED)
  const [loadedDirectories, setLoadedDirectories] = useState<Record<string, boolean>>({})
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<{ action: 'cut' | 'copy'; path: string } | null>(null)

  // Modal States
  const [promptModal, setPromptModal] = useState<{
    open: boolean
    title: string
    defaultValue: string
    placeholder: string
    onSubmit: (value: string) => void
  }>({
    open: false,
    title: '',
    defaultValue: '',
    placeholder: '',
    onSubmit: () => {},
  })

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  const [recentExpandedPath, setRecentExpandedPath] = useState<string | null>(null)
  const [expandAnimationNonce, setExpandAnimationNonce] = useState(0)
  const [hasInteractedScroll, setHasInteractedScroll] = useState(false)
  const [scrollSpeedTier, setScrollSpeedTier] = useState<'idle' | 'medium' | 'fast'>('idle')
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'file' | 'content'>('file')
  const [searchQuery, setSearchQuery] = useState('')
  const [contentMatches, setContentMatches] = useState<FsSearchMatch[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchDroppedChunks, setSearchDroppedChunks] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const workspaceIdRef = useRef<string | null>(workspaceId)
  const loadedDirectoriesRef = useRef<Record<string, boolean>>({})
  const inFlightDirectoryLoadsRef = useRef<Record<string, Promise<void>>>({})
  const pendingRefreshDirectoriesRef = useRef<Set<string>>(new Set())
  const refreshTimerRef = useRef<number | null>(null)
  const searchRequestSeqRef = useRef(0)
  const activeStreamSearchIdRef = useRef<string | null>(null)
  const lastScrollTopRef = useRef(0)
  const lastScrollTsRef = useRef(0)
  const scrollDirectionRef = useRef<'forward' | 'backward'>('forward')
  const speedTierRafRef = useRef<number | null>(null)
  const trimmedSearchQuery = searchQuery.trim()

  const cancelActiveStreamSearch = useCallback(() => {
    const activeSearchId = activeStreamSearchIdRef.current
    if (!activeSearchId) {
      return
    }
    activeStreamSearchIdRef.current = null
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi.fsSearchStreamCancel(activeSearchId).catch(() => {
      // ignore cancellation races
    })
  }, [])

  const loadDirectory = useCallback(
    async (rawDirectoryPath: string) => {
      if (!workspaceId) {
        return
      }
      const directoryPath = normalizeDirectoryPath(rawDirectoryPath)
      const existingTask = inFlightDirectoryLoadsRef.current[directoryPath]
      if (existingTask) {
        await existingTask
        return
      }
      const requestWorkspaceId = workspaceId

      const task = (async () => {
        setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: true }))
        try {
          const response = await desktopApi.fsListDir(requestWorkspaceId, directoryPath, 1)
          if (workspaceIdRef.current !== requestWorkspaceId) {
            return
          }
          const filtered = response.entries.filter(
            (entry) => parentDirectory(entry.path) === directoryPath,
          )
          setEntriesByDirectory((prev) => ({
            ...prev,
            [directoryPath]: sortEntries(filtered),
          }))
          setLoadedDirectories((prev) => ({ ...prev, [directoryPath]: true }))
        } catch (error) {
          if (workspaceIdRef.current !== requestWorkspaceId) {
            return
          }
          addNotification({
            type: 'error',
            message: t(locale, 'fileTree.directoryLoadFailed', {
              detail: error instanceof Error ? error.message : describeUnknownError(error),
            })
          })
        } finally {
          delete inFlightDirectoryLoadsRef.current[directoryPath]
          if (workspaceIdRef.current === requestWorkspaceId) {
            setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: false }))
          }
        }
      })()

      inFlightDirectoryLoadsRef.current[directoryPath] = task
      await task
    },
    [locale, workspaceId],
  )

  const refreshRoot = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    setEntriesByDirectory({})
    setExpandedDirectories(INITIAL_EXPANDED)
    setLoadedDirectories({})
    setLoadingDirectories({})
    setHasInteractedScroll(false)
    setScrollSpeedTier('idle')
    lastScrollTopRef.current = 0
    lastScrollTsRef.current = 0
    scrollDirectionRef.current = 'forward'
    await loadDirectory(ROOT_DIR)
  }, [loadDirectory, workspaceId])

  useEffect(() => {
    workspaceIdRef.current = workspaceId
    inFlightDirectoryLoadsRef.current = {}
    if (!workspaceId) {
      setEntriesByDirectory({})
      setExpandedDirectories(INITIAL_EXPANDED)
      setLoadedDirectories({})
      setLoadingDirectories({})
      setSearchQuery('')
      setContentMatches([])
      setSearchError(null)
      setSearchLoading(false)
      setSearchDroppedChunks(0)
      setIsSearchModalOpen(false)
      cancelActiveStreamSearch()
      setHasInteractedScroll(false)
      setScrollSpeedTier('idle')
      lastScrollTopRef.current = 0
      lastScrollTsRef.current = 0
      scrollDirectionRef.current = 'forward'
      setContextMenu(null)
      return
    }
    void refreshRoot()
  }, [cancelActiveStreamSearch, refreshRoot, workspaceId])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

  useEffect(() => {
    loadedDirectoriesRef.current = loadedDirectories
  }, [loadedDirectories])

  useEffect(() => {
    if (!recentExpandedPath) {
      return
    }
    const timerId = window.setTimeout(() => {
      setRecentExpandedPath(null)
    }, 240)
    return () => window.clearTimeout(timerId)
  }, [expandAnimationNonce, recentExpandedPath])

  // Track the last processed nonce to avoid re-opening on re-renders
  const lastProcessedNonceRef = useRef(0)

  useEffect(() => {
    if (!searchRequest || searchRequest.nonce <= 0) {
      return
    }
    // Only open if this is a new request (nonce increased)
    if (searchRequest.nonce <= lastProcessedNonceRef.current) {
      return
    }
    lastProcessedNonceRef.current = searchRequest.nonce
    setSearchMode(searchRequest.mode)
    setIsSearchModalOpen(true)
    onSearchRequestConsumed?.(searchRequest.nonce)
  }, [onSearchRequestConsumed, searchRequest])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null
    void desktopApi
      .subscribeDaemonSearchEvents({
        onChunk: (payload: DaemonSearchChunkPayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setContentMatches((prev) => {
            if (prev.length >= CONTENT_MATCH_MAX_RENDER) {
              return prev
            }
            const next = [...prev]
            for (const item of payload.items) {
              if (next.length >= CONTENT_MATCH_MAX_RENDER) {
                break
              }
              next.push({
                path: item.path,
                line: item.line,
                preview: item.preview,
              })
            }
            return next
          })
        },
        onBackpressure: (payload: DaemonSearchBackpressurePayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setSearchDroppedChunks((prev) => prev + Math.max(0, payload.droppedChunks || 0))
        },
        onDone: (payload: DaemonSearchDonePayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setSearchLoading(false)
          activeStreamSearchIdRef.current = null
        },
        onCancelled: (payload: DaemonSearchCancelledPayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setSearchLoading(false)
          activeStreamSearchIdRef.current = null
        },
      })
      .then((unlisten) => {
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
  }, [])

  useEffect(() => {
    return () => {
      cancelActiveStreamSearch()
    }
  }, [cancelActiveStreamSearch])

  useEffect(() => {
    if (!isSearchModalOpen || !workspaceId || searchMode !== 'content') {
      cancelActiveStreamSearch()
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    if (!trimmedSearchQuery) {
      cancelActiveStreamSearch()
      setSearchLoading(false)
      setSearchError(null)
      setContentMatches([])
      setSearchDroppedChunks(0)
      return
    }

    const requestId = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestId
    setSearchLoading(true)
    setSearchError(null)
    setSearchDroppedChunks(0)
    setContentMatches([])

    const timer = window.setTimeout(() => {
      const searchId = `search_${Date.now().toString(36)}_${requestId.toString(36)}`
      const previousSearchId = activeStreamSearchIdRef.current
      activeStreamSearchIdRef.current = searchId
      if (previousSearchId && previousSearchId !== searchId) {
        void desktopApi.fsSearchStreamCancel(previousSearchId).catch(() => {
          // ignore cancellation races
        })
      }
      void desktopApi
        .fsSearchStreamStart(workspaceId, {
          searchId,
          query: trimmedSearchQuery,
          chunkSize: 64,
          maxResults: CONTENT_MATCH_MAX_RENDER,
        })
        .catch(async (error) => {
          if (
            searchRequestSeqRef.current !== requestId ||
            activeStreamSearchIdRef.current !== searchId
          ) {
            return
          }
          activeStreamSearchIdRef.current = null
          try {
            const response = await desktopApi.fsSearchText(workspaceId, trimmedSearchQuery)
            if (searchRequestSeqRef.current !== requestId) {
              return
            }
            setContentMatches(response.matches.slice(0, CONTENT_MATCH_MAX_RENDER))
            setSearchLoading(false)
          } catch (fallbackError) {
            if (searchRequestSeqRef.current !== requestId) {
              return
            }
            setSearchLoading(false)
            setContentMatches([])
            setSearchError(
              t(locale, 'fileTree.searchFailed', {
                detail: fallbackError instanceof Error ? fallbackError.message : describeUnknownError(error),
              }),
            )
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [cancelActiveStreamSearch, isSearchModalOpen, locale, searchMode, trimmedSearchQuery, workspaceId])

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      const normalizedPath = normalizeDirectoryPath(directoryPath)
      const isExpanded = Boolean(expandedDirectories[normalizedPath])
      setExpandedDirectories((prev) => {
        return {
          ...prev,
          [normalizedPath]: !isExpanded,
        }
      })
      if (!isExpanded) {
        setRecentExpandedPath(normalizedPath)
        setExpandAnimationNonce((prev) => prev + 1)
      }
      if (!loadedDirectories[normalizedPath] && !loadingDirectories[normalizedPath]) {
        void loadDirectory(normalizedPath)
      }
    },
    [expandedDirectories, loadDirectory, loadedDirectories, loadingDirectories],
  )

  const rows = useMemo(
    () => buildRows(entriesByDirectory, expandedDirectories, loadingDirectories, ROOT_DIR, 0),
    [entriesByDirectory, expandedDirectories, loadingDirectories],
  )
  const fileMatches = useMemo(() => {
    if (!trimmedSearchQuery || searchMode !== 'file') {
      return []
    }
    const keyword = trimmedSearchQuery.toLowerCase()
    const dedup = new Map<string, FsEntry>()
    for (const entries of Object.values(entriesByDirectory)) {
      for (const entry of entries) {
        if (entry.kind !== 'file') {
          continue
        }
        const searchable = `${entry.path} ${entry.name}`.toLowerCase()
        if (!searchable.includes(keyword)) {
          continue
        }
        if (!dedup.has(entry.path)) {
          dedup.set(entry.path, entry)
        }
      }
    }
    return Array.from(dedup.values())
      .sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
      .slice(0, 400)
  }, [entriesByDirectory, searchMode, trimmedSearchQuery])

  const rowRangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range)
      const total = rows.length
      if (total <= 0) {
        return base
      }
      const first = base[0] ?? 0
      const last = base[base.length - 1] ?? 0
      const speedExtra =
        scrollSpeedTier === 'fast'
          ? SPEED_FAST_EXTRA_ROWS
          : scrollSpeedTier === 'medium'
            ? SPEED_MEDIUM_EXTRA_ROWS
            : 0
      const preloadExtra = hasInteractedScroll ? 0 : INITIAL_PRELOAD_ROWS
      const forwardExtra =
        scrollDirectionRef.current === 'forward' ? speedExtra : Math.floor(speedExtra * 0.4)
      const backwardExtra =
        scrollDirectionRef.current === 'backward' ? speedExtra : Math.floor(speedExtra * 0.4)
      const start = Math.max(0, first - PRE_RENDER_BEHIND_ROWS - backwardExtra)
      const end = Math.min(total - 1, last + PRE_RENDER_AHEAD_ROWS + preloadExtra + forwardExtra)
      const expanded: number[] = []
      for (let index = start; index <= end; index += 1) {
        expanded.push(index)
      }
      return expanded
    },
    [hasInteractedScroll, rows.length, scrollSpeedTier],
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: (index) => rows[index]?.path ?? index,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    rangeExtractor: rowRangeExtractor,
    initialRect: { width: 1, height: 760 },
    isScrollingResetDelay: 120,
    useScrollendEvent: true,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  })

  const recentExpandedDepth = useMemo(() => {
    if (!recentExpandedPath) {
      return -1
    }
    const expandedRow = rows.find((row) => row.path === recentExpandedPath && row.kind === 'dir')
    return expandedRow?.depth ?? -1
  }, [recentExpandedPath, rows])

  const pruneDirectoryCache = useCallback((path: string) => {
    const normalized = normalizeDirectoryPath(path)
    if (normalized === ROOT_DIR) {
      return
    }

    setEntriesByDirectory((prev) => {
      const next: Record<string, FsEntry[]> = {}
      for (const [dir, entries] of Object.entries(prev)) {
        if (isPathUnder(dir, normalized)) {
          continue
        }
        next[dir] = entries.filter((entry) => !isPathUnder(entry.path, normalized))
      }
      return next
    })

    const stripMap = (prev: Record<string, boolean>) => {
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (!isPathUnder(key, normalized)) {
          next[key] = value
        }
      }
      return next
    }
    setLoadedDirectories(stripMap)
    setLoadingDirectories(stripMap)
    setExpandedDirectories((prev) => {
      const next = stripMap(prev)
      next[ROOT_DIR] = true
      return next
    })
  }, [])

  const flushQueuedDirectoryReloads = useCallback(async () => {
    if (!workspaceId) {
      pendingRefreshDirectoriesRef.current.clear()
      refreshTimerRef.current = null
      return
    }

    const directories = Array.from(pendingRefreshDirectoriesRef.current)
    pendingRefreshDirectoriesRef.current.clear()
    refreshTimerRef.current = null

    const directoriesToReload = directories.filter(
      (directory) => directory === ROOT_DIR || loadedDirectoriesRef.current[directory],
    )
    if (directoriesToReload.length === 0) {
      return
    }

    setExpandedDirectories((prev) => {
      let changed = false
      const next = { ...prev }
      for (const directory of directoriesToReload) {
        if (!next[directory]) {
          next[directory] = true
          changed = true
        }
      }
      return changed ? next : prev
    })

    await Promise.allSettled(directoriesToReload.map((directory) => loadDirectory(directory)))
  }, [loadDirectory, workspaceId])

  const scheduleDirectoryReload = useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        const normalized = normalizeDirectoryPath(path)
        pendingRefreshDirectoriesRef.current.add(normalized)
      }
      if (refreshTimerRef.current !== null) {
        return
      }
      refreshTimerRef.current = window.setTimeout(() => {
        void flushQueuedDirectoryReloads()
      }, 120)
    },
    [flushQueuedDirectoryReloads],
  )

  const reloadParentsAfterMutation = useCallback(
    async (paths: string[]) => {
      if (!workspaceId) {
        return
      }
      scheduleDirectoryReload(paths.map((path) => parentDirectory(path)))
    },
    [scheduleDirectoryReload, workspaceId],
  )

  const handleFilesystemChanged = useCallback(
    (payload: FilesystemChangedPayload) => {
      if (!workspaceId || payload.workspaceId !== workspaceId) {
        return
      }

      const normalizedPaths = payload.paths
        .map((path) => normalizeDirectoryPath(path))
        .filter((path) => path.length > 0)
      if (normalizedPaths.length === 0) {
        return
      }

      if (payload.kind === 'removed' || payload.kind === 'renamed') {
        for (const path of normalizedPaths) {
          pruneDirectoryCache(path)
        }
      }

      const parentPaths = normalizedPaths.map((path) => parentDirectory(path))
      if (normalizedPaths.includes(ROOT_DIR)) {
        parentPaths.push(ROOT_DIR)
      }
      scheduleDirectoryReload(parentPaths)
    },
    [pruneDirectoryCache, scheduleDirectoryReload, workspaceId],
  )

  useEffect(() => {
    if (!workspaceId || !desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanupChanged: (() => void) | null = null
    let cleanupWatchError: (() => void) | null = null
    void desktopApi
      .subscribeFilesystemEvents((payload: FilesystemChangedPayload) => {
        if (!active) {
          return
        }
        handleFilesystemChanged(payload)
      })
      .then((unlisten) => {
        if (!active) {
          unlisten()
          return
        }
        cleanupChanged = unlisten
      })
      .catch((error) => {
        addNotification({
          type: 'error',
          message: t(locale, 'fileTree.watchSubscribeFailed', {
            detail: error instanceof Error ? error.message : 'unknown',
          })
        })
      })

    void desktopApi
      .subscribeFilesystemWatchErrors((payload: FilesystemWatchErrorPayload) => {
        if (!active || payload.workspaceId !== workspaceId) {
          return
        }
        addNotification({
          type: 'error',
          message: t(locale, 'fileTree.watchRuntimeError', { detail: payload.detail })
        })
      })
      .then((unlisten) => {
        if (!active) {
          unlisten()
          return
        }
        cleanupWatchError = unlisten
      })
      .catch((error) => {
        addNotification({
          type: 'error',
          message: t(locale, 'fileTree.watchSubscribeFailed', {
            detail: error instanceof Error ? error.message : 'unknown',
          })
        })
      })

    return () => {
      active = false
      if (cleanupChanged) {
        cleanupChanged()
      }
      if (cleanupWatchError) {
        cleanupWatchError()
      }
    }
  }, [handleFilesystemChanged, locale, workspaceId])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      if (speedTierRafRef.current !== null) {
        window.cancelAnimationFrame(speedTierRafRef.current)
      }
      refreshTimerRef.current = null
      speedTierRafRef.current = null
    }
  }, [])

  useEffect(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    pendingRefreshDirectoriesRef.current.clear()
  }, [workspaceId])

  const createFileAtBase = useCallback(
    async (basePath: string) => {
      if (!workspaceId) {
        return
      }
      setPromptModal({
        open: true,
        title: t(locale, 'fileTree.createFile'),
        defaultValue: 'new-file.md',
        placeholder: t(locale, 'fileTree.promptCreateUnder', { base: basePath }),
        onSubmit: async (fileName) => {
          const trimmedName = fileName.trim()
          if (!trimmedName) return
          
          const normalizedBase = normalizeDirectoryPath(basePath)
          const normalizedName = trimmedName.replace(/^\/+/, '').replace(/\\/g, '/')
          const targetPath =
            normalizedBase === ROOT_DIR ? normalizedName : `${normalizedBase}/${normalizedName}`

          const created = await onCreateFile(targetPath)
          if (created) {
            setExpandedDirectories((prev) => ({ ...prev, [normalizedBase]: true }))
            await loadDirectory(normalizedBase)
            onSelectFile(targetPath)
          }
          setPromptModal((prev) => ({ ...prev, open: false }))
        },
      })
      setContextMenu(null)
    },
    [loadDirectory, locale, onCreateFile, onSelectFile, workspaceId],
  )

  const createFolderAtBase = useCallback(
    async (basePath: string) => {
      if (!workspaceId) {
        return
      }
      setPromptModal({
        open: true,
        title: t(locale, 'fileTree.createFolder'),
        defaultValue: 'new-folder',
        placeholder: t(locale, 'fileTree.promptCreateFolderUnder', { base: basePath }),
        onSubmit: async (folderName) => {
          const trimmedName = folderName.trim()
          if (!trimmedName) return

          const normalizedBase = normalizeDirectoryPath(basePath)
          const normalizedName = trimmedName.replace(/^\/+/, '').replace(/\\/g, '/')
          const targetPath =
            normalizedBase === ROOT_DIR ? normalizedName : `${normalizedBase}/${normalizedName}`

          try {
            await desktopApi.fsCreateDir(workspaceId, targetPath)
            setExpandedDirectories((prev) => ({ ...prev, [normalizedBase]: true }))
            await loadDirectory(normalizedBase)
          } catch (error) {
            addNotification({
              type: 'error',
              message: t(locale, 'fileTree.createFolderFailed', {
                detail: error instanceof Error ? error.message : describeUnknownError(error),
              })
            })
          }
          setPromptModal((prev) => ({ ...prev, open: false }))
        },
      })
      setContextMenu(null)
    },
    [loadDirectory, locale, workspaceId],
  )

  const deletePath = useCallback(
    async (path: string) => {
      if (!workspaceId) {
        return
      }
      setConfirmModal({
        open: true,
        title: t(locale, 'fileTree.delete'),
        message: t(locale, 'fileTree.confirmDelete', { path }),
        onConfirm: async () => {
          const deleted = await onDeletePath(path)
          if (deleted) {
            pruneDirectoryCache(path)
            await reloadParentsAfterMutation([path])
          }
          setConfirmModal((prev) => ({ ...prev, open: false }))
        },
      })
      setContextMenu(null)
    },
    [locale, onDeletePath, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId],
  )

  const movePath = useCallback(
    async (path: string, kind: 'dir' | 'file') => {
      if (!workspaceId) {
        return
      }
      const currentName = leafName(path)
      setPromptModal({
        open: true,
        title: t(locale, 'fileTree.renameMove'),
        defaultValue: currentName,
        placeholder: t(locale, 'fileTree.promptRenameMove', { path }),
        onSubmit: async (targetInput) => {
          const trimmedTarget = targetInput.trim()
          if (!trimmedTarget || trimmedTarget === '.') return

          const normalizedTarget = trimmedTarget.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '')
          const targetPath = normalizedTarget.includes('/')
            ? normalizedTarget
            : (() => {
                const parent = parentDirectory(path)
                return parent === ROOT_DIR ? normalizedTarget : `${parent}/${normalizedTarget}`
              })()

          const moved = await onMovePath(path, targetPath)
          if (moved) {
            pruneDirectoryCache(path)
            await reloadParentsAfterMutation([path, targetPath])
            if (kind === 'file') {
              onSelectFile(targetPath)
            }
          }
          setPromptModal((prev) => ({ ...prev, open: false }))
        },
      })
      setContextMenu(null)
    },
    [locale, onMovePath, onSelectFile, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId],
  )

  const handleSearchSubmit = useCallback(() => {
    if (searchMode === 'file') {
      const first = fileMatches[0]
      if (first) {
        onSelectFile(first.path)
        setIsSearchModalOpen(false)
      }
      return
    }
    const first = contentMatches[0]
    if (first) {
      onSelectFile(first.path)
      setIsSearchModalOpen(false)
    }
  }, [contentMatches, fileMatches, onSelectFile, searchMode])

  const handleDirectoryToggleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const path = event.currentTarget.dataset.path
      if (!path) {
        return
      }
      toggleDirectory(path)
    },
    [toggleDirectory],
  )

  const handleFileButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const path = event.currentTarget.dataset.path
      if (!path) {
        return
      }
      onSelectFile(path)
    },
    [onSelectFile],
  )

  const pastePath = useCallback(
    async (targetBasePath: string) => {
      if (!workspaceId || !clipboard) {
        return
      }

      if (clipboard.path === targetBasePath || isPathUnder(targetBasePath, clipboard.path)) {
        addNotification({ type: 'error', message: t(locale, 'fileTree.pasteInvalid') })
        return
      }

      const sourceName = leafName(clipboard.path)
      const normalizedBase = normalizeDirectoryPath(targetBasePath)
      
      // Resolve name conflicts
      let targetName = sourceName
      let attempt = 0
      const existingEntries = entriesByDirectory[normalizedBase] || []

      while (existingEntries.some((entry) => entry.name === targetName)) {
        attempt++
        const dotIndex = sourceName.lastIndexOf('.')
        if (dotIndex > 0) {
          const name = sourceName.substring(0, dotIndex)
          const ext = sourceName.substring(dotIndex)
          targetName = attempt === 1 ? `${name} copy${ext}` : `${name} copy ${attempt}${ext}`
        } else {
          targetName = attempt === 1 ? `${sourceName} copy` : `${sourceName} copy ${attempt}`
        }
      }

      const targetPath = normalizedBase === ROOT_DIR ? targetName : `${normalizedBase}/${targetName}`

      try {
        if (clipboard.action === 'cut') {
          const moved = await onMovePath(clipboard.path, targetPath)
          if (moved) {
            pruneDirectoryCache(clipboard.path)
            await reloadParentsAfterMutation([clipboard.path, targetPath])
            setClipboard(null)
          }
        } else {
          await desktopApi.fsCopy(workspaceId, clipboard.path, targetPath)
          await reloadParentsAfterMutation([targetPath])
        }
      } catch (error) {
        addNotification({
          type: 'error',
          message: t(locale, 'fileTree.pasteFailed', {
            detail: error instanceof Error ? error.message : describeUnknownError(error),
          })
        })
      }
      setContextMenu(null)
    },
    [clipboard, entriesByDirectory, locale, onMovePath, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId],
  )

  const revealInExplorer = useCallback(async (path: string) => {
    if (!workspaceId) return
    try {
      await desktopApi.fsShowInFolder(workspaceId, path)
    } catch (error) {
      addNotification({
        type: 'error',
        message: t(locale, 'fileTree.revealFailed', {
          detail: error instanceof Error ? error.message : describeUnknownError(error),
        })
      })
    }
    setContextMenu(null)
  }, [locale, workspaceId])

  const copyPathText = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      // ignore clipboard error
    }
    setContextMenu(null)
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const focusedItem = resolveFocusedTreeItem()
      if (!focusedItem) {
        return
      }
      const { path, kind } = focusedItem

      const isMac = navigator.userAgent.includes('Mac OS')
      const isMod = isMac ? event.metaKey : event.ctrlKey

      if (event.key === 'F2' || (event.key === 'Enter' && isMac)) {
        event.preventDefault()
        event.stopPropagation()
        void movePath(path, kind)
        return
      }

      if (event.key === 'Delete' || (event.key === 'Backspace' && isMac && isMod)) {
        event.preventDefault()
        event.stopPropagation()
        void deletePath(path)
        return
      }

      if (isMod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        event.stopPropagation()
        setClipboard({ action: 'copy', path })
        return
      }

      if (isMod && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        event.stopPropagation()
        setClipboard({ action: 'cut', path })
        return
      }

      if (isMod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        event.stopPropagation()
        const targetBasePath = kind === 'dir' ? path : parentDirectory(path)
        void pastePath(targetBasePath)
        return
      }
    },
    [deletePath, movePath, pastePath],
  )

  const handleRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rowElement = event.currentTarget
    const path = rowElement.dataset.path
    const kind = rowElement.dataset.kind
    if (!path || (kind !== 'dir' && kind !== 'file')) {
      return
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path,
      kind,
    })
  }, [])

  const loadingText = useMemo(() => t(locale, 'fileTree.loading'), [locale])

  return (
    <aside className="panel left-pane file-tree-pane">
      <div className="file-tree-header">
        <div className="file-tree-header-actions">
          <button
            type="button"
            className="tree-search-btn"
            aria-label={t(locale, 'fileTree.openSearch')}
            title={t(locale, 'fileTree.openSearch')}
            onClick={() => {
              setSearchMode('file')
              setIsSearchModalOpen(true)
            }}
            disabled={!workspaceId}
          >
            <AppIcon name="search" className="vb-icon vb-icon-tree-search" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tree-refresh-btn"
            aria-label={t(locale, 'fileTree.refresh')}
            title={t(locale, 'fileTree.refresh')}
            onClick={() => {
              void refreshRoot()
            }}
            disabled={!workspaceId}
          >
            <AppIcon name="refresh" className="vb-icon vb-icon-tree-search" aria-hidden="true" />
          </button>
        </div>
      </div>
      {!workspaceId ? (
        <p className="tree-empty">{t(locale, 'fileTree.noWorkspace')}</p>
      ) : null}

      <div className="file-tree-stage">
        <div
          ref={viewportRef}
          className="file-tree-viewport"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          data-scrolling={rowVirtualizer.isScrolling ? 'true' : 'false'}
          onScroll={(event) => {
            const nextTop = event.currentTarget.scrollTop
            if (!hasInteractedScroll && nextTop > 0) {
              setHasInteractedScroll(true)
            }
            const now = performance.now()
            const lastTop = lastScrollTopRef.current
            const lastTs = lastScrollTsRef.current
            const delta = nextTop - lastTop
            if (delta > 0) {
              scrollDirectionRef.current = 'forward'
            } else if (delta < 0) {
              scrollDirectionRef.current = 'backward'
            }
            lastScrollTopRef.current = nextTop
            lastScrollTsRef.current = now
            if (!lastTs) {
              return
            }
            const elapsedMs = now - lastTs
            if (elapsedMs < SPEED_TIER_SAMPLE_MS) {
              return
            }
            const pxPerSec = (Math.abs(nextTop - lastTop) * 1000) / Math.max(1, elapsedMs)
            const nextTier: 'idle' | 'medium' | 'fast' =
              pxPerSec >= SPEED_FAST_PX_PER_SEC
                ? 'fast'
                : pxPerSec >= SPEED_MEDIUM_PX_PER_SEC
                  ? 'medium'
                  : 'idle'
            if (speedTierRafRef.current !== null) {
              window.cancelAnimationFrame(speedTierRafRef.current)
            }
            speedTierRafRef.current = window.requestAnimationFrame(() => {
              speedTierRafRef.current = null
              setScrollSpeedTier((prev) => (prev === nextTier ? prev : nextTier))
            })
          }}
        >
          {rows.length === 0 ? (
            <p className="tree-empty">{t(locale, 'fileTree.directoryEmpty')}</p>
          ) : (
            <div
              className="file-tree-virtual-list"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) {
                  return null
                }
                const animateFromExpansion =
                  recentExpandedPath !== null &&
                  recentExpandedDepth >= 0 &&
                  row.depth > recentExpandedDepth &&
                  isPathUnder(row.path, recentExpandedPath)
                const animationDelayMs = animateFromExpansion
                  ? Math.min(60, (row.depth - recentExpandedDepth - 1) * 18)
                  : 0

                return (
                  <TreeRowItem
                    key={row.path}
                    row={row}
                    virtualStart={virtualRow.start}
                    virtualSize={virtualRow.size}
                    isSelected={row.kind === 'file' && selectedFilePath === row.path}
                    isCut={clipboard?.action === 'cut' && clipboard.path === row.path}
                    animateFromExpansion={animateFromExpansion}
                    animationDelayMs={animationDelayMs}
                    loadingText={loadingText}
                    onToggleDirectory={handleDirectoryToggleClick}
                    onSelectFile={handleFileButtonClick}
                    onContextMenu={handleRowContextMenu}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
      {contextMenu ? createPortal(
        <div
          className="tree-context-menu"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 220)}px`,
            top: `${contextMenu.y + 350 > window.innerHeight ? contextMenu.y - 350 : contextMenu.y}px`,
          }}
        >
          <button
            type="button"
            onClick={() => {
              const basePath =
                contextMenu.kind === 'dir' ? contextMenu.path : parentDirectory(contextMenu.path)
              void createFileAtBase(basePath)
            }}
          >
            <AppIcon name="file-plus" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.createFile')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const basePath =
                contextMenu.kind === 'dir' ? contextMenu.path : parentDirectory(contextMenu.path)
              void createFolderAtBase(basePath)
            }}
          >
            <AppIcon name="folder-plus" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.createFolder')}</span>
          </button>
          <div className="tree-context-separator" />
          <button
            type="button"
            onClick={() => {
              setClipboard({ action: 'cut', path: contextMenu.path })
              setContextMenu(null)
            }}
          >
            <AppIcon name="scissors" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.cut')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setClipboard({ action: 'copy', path: contextMenu.path })
              setContextMenu(null)
            }}
          >
            <AppIcon name="copy" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.copy')}</span>
          </button>
          <button
            type="button"
            disabled={!clipboard}
            className={!clipboard ? 'disabled' : ''}
            onClick={() => {
              const basePath =
                contextMenu.kind === 'dir' ? contextMenu.path : parentDirectory(contextMenu.path)
              void pastePath(basePath)
            }}
          >
            <AppIcon name="clipboard-paste" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.paste')}</span>
          </button>
          <div className="tree-context-separator" />
          <button
            type="button"
            onClick={() => {
              void copyPathText(contextMenu.path)
            }}
          >
            <AppIcon name="link" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.copyPath')}</span>
          </button>
          <div className="tree-context-separator" />
          <button
            type="button"
            onClick={() => {
              void movePath(contextMenu.path, contextMenu.kind)
            }}
          >
            <AppIcon name="pencil" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.renameMove')}</span>
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              void deletePath(contextMenu.path)
            }}
          >
            <AppIcon name="trash" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.delete')}</span>
          </button>
          <div className="tree-context-separator" />
          <button
            type="button"
            onClick={() => {
              void revealInExplorer(contextMenu.path)
            }}
          >
            <AppIcon name="external" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.revealInExplorer')}</span>
          </button>
        </div>
        , document.body
      ) : null}
      <FileSearchModal
        open={isSearchModalOpen}
        locale={locale}
        workspaceId={workspaceId}
        mode={searchMode}
        query={searchQuery}
        fileMatches={fileMatches}
        contentMatches={contentMatches}
        loading={searchLoading}
        error={searchError}
        droppedChunks={searchDroppedChunks}
        onClose={() => setIsSearchModalOpen(false)}
        onModeChange={setSearchMode}
        onQueryChange={setSearchQuery}
        onSubmit={handleSearchSubmit}
        onSelectFile={(path) => {
          onSelectFile(path)
          setIsSearchModalOpen(false)
        }}
      />
      <FileTreePromptModal
        key={`${promptModal.open ? 'open' : 'closed'}:${promptModal.title}:${promptModal.defaultValue}`}
        open={promptModal.open}
        title={promptModal.title}
        defaultValue={promptModal.defaultValue}
        placeholder={promptModal.placeholder}
        onClose={() => setPromptModal(prev => ({ ...prev, open: false }))}
        onSubmit={promptModal.onSubmit}
      />
      <FileTreeConfirmModal
        key={`${confirmModal.open ? 'open' : 'closed'}:${confirmModal.title}:${confirmModal.message}`}
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        onClose={() => setConfirmModal(prev => ({ ...prev, open: false }))}
        onConfirm={confirmModal.onConfirm}
      />
    </aside>
  )
}
