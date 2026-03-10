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
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import { FileSearchModal } from './FileSearchModal'
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
const ROW_HEIGHT = 26
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

interface TreeRowItemProps {
  row: TreeRow
  virtualStart: number
  virtualSize: number
  isSelected: boolean
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
  animateFromExpansion,
  animationDelayMs,
  loadingText,
  onToggleDirectory,
  onSelectFile,
  onContextMenu,
}: TreeRowItemProps) {
  return (
    <div
      className={`tree-row tree-row-${row.kind} ${
        row.kind === 'file' && isSelected ? 'tree-row-selected' : ''
      } ${animateFromExpansion ? 'tree-row-expand-enter' : ''}`}
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
          <AppIcon name="folder-open" className="vb-icon vb-icon-tree-node" aria-hidden="true" />
          <span>{row.name}</span>
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
            <AppIcon name="file-text" className="vb-icon vb-icon-tree-node" aria-hidden="true" />
            <span>{row.name}</span>
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
    prev.row.depth === next.row.depth &&
    prev.isSelected === next.isSelected &&
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null)
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
  const loadedDirectoriesRef = useRef<Record<string, boolean>>({})
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

      setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: true }))
      try {
        const response = await desktopApi.fsListDir(workspaceId, directoryPath, 1)
        const filtered = response.entries.filter(
          (entry) => parentDirectory(entry.path) === directoryPath,
        )
        setEntriesByDirectory((prev) => ({
          ...prev,
          [directoryPath]: sortEntries(filtered),
        }))
        setLoadedDirectories((prev) => ({ ...prev, [directoryPath]: true }))
        setErrorMessage(null)
      } catch (error) {
        setErrorMessage(
          t(locale, 'fileTree.directoryLoadFailed', {
            detail: error instanceof Error ? error.message : 'unknown',
          }),
        )
      } finally {
        setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: false }))
      }
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
      setErrorMessage(null)
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

  // eslint-disable-next-line react-hooks/incompatible-library
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

    for (const directory of directories) {
      if (directory !== ROOT_DIR && !loadedDirectoriesRef.current[directory]) {
        continue
      }
      setExpandedDirectories((prev) => ({ ...prev, [directory]: true }))
      await loadDirectory(directory)
    }
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
        setErrorMessage(
          t(locale, 'fileTree.watchSubscribeFailed', {
            detail: error instanceof Error ? error.message : 'unknown',
          }),
        )
      })

    void desktopApi
      .subscribeFilesystemWatchErrors((payload: FilesystemWatchErrorPayload) => {
        if (!active || payload.workspaceId !== workspaceId) {
          return
        }
        setErrorMessage(t(locale, 'fileTree.watchRuntimeError', { detail: payload.detail }))
      })
      .then((unlisten) => {
        if (!active) {
          unlisten()
          return
        }
        cleanupWatchError = unlisten
      })
      .catch((error) => {
        setErrorMessage(
          t(locale, 'fileTree.watchSubscribeFailed', {
            detail: error instanceof Error ? error.message : 'unknown',
          }),
        )
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
      const fileName = window
        .prompt(
          t(locale, 'fileTree.promptCreateUnder', { base: basePath }),
          'new-file.md',
        )
        ?.trim()
      if (!fileName) {
        return
      }

      const normalizedBase = normalizeDirectoryPath(basePath)
      const normalizedName = fileName.replace(/^\/+/, '').replace(/\\/g, '/')
      const targetPath =
        normalizedBase === ROOT_DIR ? normalizedName : `${normalizedBase}/${normalizedName}`

      const created = await onCreateFile(targetPath)
      if (!created) {
        return
      }

      setExpandedDirectories((prev) => ({ ...prev, [normalizedBase]: true }))
      await loadDirectory(normalizedBase)
      onSelectFile(targetPath)
      setContextMenu(null)
    },
    [loadDirectory, locale, onCreateFile, onSelectFile, workspaceId],
  )

  const deletePath = useCallback(
    async (path: string) => {
      if (!workspaceId) {
        return
      }
      const confirmed = window.confirm(
        t(locale, 'fileTree.confirmDelete', { path }),
      )
      if (!confirmed) {
        return
      }

      const deleted = await onDeletePath(path)
      if (!deleted) {
        return
      }
      pruneDirectoryCache(path)
      setContextMenu(null)
      await reloadParentsAfterMutation([path])
    },
    [locale, onDeletePath, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId],
  )

  const movePath = useCallback(
    async (path: string, kind: 'dir' | 'file') => {
      if (!workspaceId) {
        return
      }
      const currentName = leafName(path)
      const targetInput = window
        .prompt(
          t(locale, 'fileTree.promptRenameMove', { path }),
          currentName,
        )
        ?.trim()
      if (!targetInput) {
        return
      }

      const normalizedTarget = targetInput.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '')
      if (!normalizedTarget || normalizedTarget === '.') {
        return
      }

      const targetPath = normalizedTarget.includes('/')
        ? normalizedTarget
        : (() => {
            const parent = parentDirectory(path)
            return parent === ROOT_DIR ? normalizedTarget : `${parent}/${normalizedTarget}`
          })()

      const moved = await onMovePath(path, targetPath)
      if (!moved) {
        return
      }

      pruneDirectoryCache(path)
      setContextMenu(null)
      await reloadParentsAfterMutation([path, targetPath])
      if (kind === 'file') {
        onSelectFile(targetPath)
      }
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
      {errorMessage ? <p className="tree-error">{errorMessage}</p> : null}

      <div className="file-tree-stage">
        <div
          ref={viewportRef}
          className="file-tree-viewport"
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
      {contextMenu ? (
        <div
          className="tree-context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
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
            {t(locale, 'fileTree.createFile')}
          </button>
          <button
            type="button"
            onClick={() => {
              void movePath(contextMenu.path, contextMenu.kind)
            }}
          >
            {t(locale, 'fileTree.renameMove')}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              void deletePath(contextMenu.path)
            }}
          >
            {t(locale, 'fileTree.delete')}
          </button>
        </div>
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
    </aside>
  )
}
