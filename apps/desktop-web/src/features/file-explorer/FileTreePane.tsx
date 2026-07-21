import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import {
  Tree,
  type DragPreviewProps,
  type MoveHandler,
  type NodeRendererProps,
  type RowRendererProps,
  type TreeApi,
} from 'react-arborist'
import { formatShortcutBinding, type ShortcutBinding } from '@features/keybindings'
import {
  desktopApi,
  type FilesystemChangedPayload,
  type FilesystemWatchErrorPayload,
  type FsEntry,
  type GitStatusFile,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  buildTerminalFileDropPayload,
  readTerminalFileDropPayload,
  writeTerminalFileDropPayload,
} from '@shell/utils/terminal-file-drop'
import { FileTreePromptModal, FileTreeConfirmModal } from './FileTreeModals'
import { isWorkspaceNotFoundError, sanitizeDirectoryEntries } from './file-tree-data'
import { buildFileTreeModalKey } from './file-tree-modal-key'
import { resolveExistingTreeSelectionPath } from './file-tree-selection'
import { resolveFileVisual, type FileVisual } from './file-visuals'
import { getSharedTreeDndManager } from './shared-dnd-manager'
import { addNotification } from '../../stores/notification'
import './FileTreePane.scss'

interface FileTreePaneProps {
  locale: Locale
  workspaceId: string | null
  workspaceRoot?: string | null
  gitStatusFiles: readonly GitStatusFile[]
  isMacOs?: boolean
  selectedFilePath: string | null
  onSelectFile: (filePath: string, line?: number) => void
  onCreateFile: (filePath: string) => Promise<boolean>
  onDeletePath: (path: string) => Promise<boolean>
  onMovePath: (fromPath: string, toPath: string) => Promise<boolean>
  onOpenSearch?: (mode?: 'file' | 'content') => void
}

interface TreeContextMenuState {
  x: number
  y: number
  path: string
  kind: 'dir' | 'file' | 'blank'
}

interface TreeNodeData {
  id: string
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  gitStatus: GitStatusVisual | null
  loading: boolean
  children: TreeNodeData[] | null
}

const ROOT_DIR = '.'
const ROW_HEIGHT = 34
const OVERSCAN_COUNT = 16
const INDENT = 14
const DRAG_EXPAND_DELAY_MS = 550
const DRAG_COLLAPSE_DELAY_MS = 180
const DRAG_SCROLL_EDGE_PX = 36
const DRAG_SCROLL_STEP_PX = 18
const SHORTCUT_CREATE_FILE: ShortcutBinding = {
  key: 'a',
  mod: false,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_CREATE_FOLDER: ShortcutBinding = {
  key: 'a',
  mod: false,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
}
const SHORTCUT_RENAME: ShortcutBinding = {
  key: 'f2',
  mod: false,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_DELETE: ShortcutBinding = {
  key: 'delete',
  mod: false,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_MAC_DELETE: ShortcutBinding = {
  key: 'backspace',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_CUT: ShortcutBinding = {
  key: 'x',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_COPY: ShortcutBinding = {
  key: 'c',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}
const SHORTCUT_PASTE: ShortcutBinding = {
  key: 'v',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
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

function normalizeRelativePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/^\/\/\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  if (/^[A-Za-z]:/.test(normalized)) {
    return ''
  }
  if (!normalized || normalized === '.') {
    return ''
  }
  if (normalized.split('/').some((segment) => segment === '..' || segment.includes(':'))) {
    return ''
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  return segments.join('/')
}

function normalizeRootForJoin(workspaceRoot: string): { root: string; separator: '\\' | '/' } {
  const raw = workspaceRoot.trim()
  const separator: '\\' | '/' = raw.includes('\\') ? '\\' : '/'
  if (!raw) {
    return { root: '', separator }
  }
  if (raw === '/' || raw === '\\') {
    return { root: separator, separator }
  }
  const stripped = raw.replace(/[\\/]+$/, '')
  if (!stripped) {
    return { root: separator, separator }
  }
  if (/^[A-Za-z]:$/.test(stripped)) {
    return { root: `${stripped}${separator}`, separator }
  }
  if (/^\\\\\?\\[A-Za-z]:$/.test(stripped)) {
    return { root: `${stripped}\\`, separator: '\\' }
  }
  return { root: stripped, separator }
}

function resolveAbsolutePath(workspaceRoot: string, targetPath: string): string {
  const { root, separator } = normalizeRootForJoin(workspaceRoot)
  const normalizedRel = normalizeRelativePath(targetPath)
  if (!normalizedRel) {
    return root
  }
  const osPath = normalizedRel.split('/').join(separator)
  if (!root) {
    return `${separator}${osPath}`
  }
  if (root.endsWith(separator)) {
    return `${root}${osPath}`
  }
  return `${root}${separator}${osPath}`
}

function collectAncestorDirectories(path: string): string[] {
  const normalized = normalizeDirectoryPath(path)
  if (normalized === ROOT_DIR) {
    return []
  }
  const directories: string[] = []
  let current = parentDirectory(normalized)
  while (current !== ROOT_DIR) {
    directories.unshift(current)
    current = parentDirectory(current)
  }
  return directories
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'dir' ? -1 : 1
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
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

type GitTone = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

interface GitStatusVisual {
  label: string
  tone: GitTone
}

const GIT_TONE_PRIORITY: Record<GitTone, number> = {
  conflict: 6,
  modified: 5,
  deleted: 4,
  added: 3,
  renamed: 2,
  untracked: 1,
}

function normalizeGitFileStatus(rawStatus: string | null | undefined): GitStatusVisual | null {
  if (!rawStatus) {
    return null
  }
  const value = rawStatus.trim().toUpperCase()
  if (!value) {
    return null
  }
  if (value.startsWith('??')) {
    return { label: '?', tone: 'untracked' }
  }
  if (value.includes('U')) {
    return { label: 'U', tone: 'conflict' }
  }
  if (value.includes('R')) {
    return { label: 'R', tone: 'renamed' }
  }
  if (value.includes('D')) {
    return { label: 'D', tone: 'deleted' }
  }
  if (value.includes('A')) {
    return { label: 'A', tone: 'added' }
  }
  if (value.includes('M')) {
    return { label: 'M', tone: 'modified' }
  }
  return null
}

function pickDominantGitStatus(
  current: GitStatusVisual | undefined,
  incoming: GitStatusVisual,
): GitStatusVisual {
  if (!current) {
    return incoming
  }
  return GIT_TONE_PRIORITY[incoming.tone] > GIT_TONE_PRIORITY[current.tone] ? incoming : current
}

function buildGitStatusesByPath(files: readonly GitStatusFile[]): Record<string, GitStatusVisual> {
  const next: Record<string, GitStatusVisual> = {}
  for (const file of files) {
    const normalizedPath = normalizeDirectoryPath(file.path)
    if (!normalizedPath || normalizedPath === ROOT_DIR) {
      continue
    }
    const normalizedStatus = normalizeGitFileStatus(file.status)
    if (!normalizedStatus) {
      continue
    }
    next[normalizedPath] = pickDominantGitStatus(next[normalizedPath], normalizedStatus)
    let currentParent = parentDirectory(normalizedPath)
    while (currentParent !== ROOT_DIR) {
      next[currentParent] = pickDominantGitStatus(next[currentParent], normalizedStatus)
      currentParent = parentDirectory(currentParent)
    }
  }
  return next
}

function buildTreeNodes(
  byDirectory: Record<string, FsEntry[]>,
  loading: Record<string, boolean>,
  gitStatusesByPath: Record<string, GitStatusVisual>,
  directory: string,
): TreeNodeData[] {
  const entries = byDirectory[directory] ?? []
  return entries.map((entry) => {
    const path = normalizeDirectoryPath(entry.path)
    const children =
      entry.kind === 'dir'
        ? buildTreeNodes(byDirectory, loading, gitStatusesByPath, path)
        : null
    return {
      id: path,
      path,
      name: entry.name,
      kind: entry.kind,
      visual: resolveFileVisual(entry.name, entry.kind, false),
      gitStatus: gitStatusesByPath[path] ?? null,
      loading: entry.kind === 'dir' ? Boolean(loading[path]) : false,
      children,
    }
  })
}

function collectNodeKinds(nodes: TreeNodeData[], output: Record<string, 'dir' | 'file'>) {
  for (const node of nodes) {
    output[node.path] = node.kind
    if (node.children && node.children.length > 0) {
      collectNodeKinds(node.children, output)
    }
  }
}

function TreeNodeRenderer({
  node,
  style,
  dragHandle,
  loadingLabel,
}: NodeRendererProps<TreeNodeData> & { loadingLabel: string }) {
  const data = node.data
  const NodeIcon = data.kind === 'dir'
    ? (node.isOpen ? FolderOpen : Folder)
    : data.visual.icon
  const gitToneClass = data.gitStatus ? `tree-name-git--${data.gitStatus.tone}` : ''

  return (
    <div
      ref={data.kind === 'dir' ? dragHandle : undefined}
      style={style}
      className={`tree-node-shell tree-node-shell-${data.kind}`}
    >
      {data.kind === 'dir' ? (
        <div className="tree-toggle">
          <span className="tree-chevron" aria-hidden="true">
            <AppIcon
              name={node.isOpen ? 'chevron-down' : 'chevron-right'}
              className="vb-icon vb-icon-tree-chevron"
            />
          </span>
          <span className={`tree-node-icon tree-node-icon--${data.visual.kind}`} aria-hidden="true">
            <NodeIcon className="vb-icon vb-icon-tree-node" />
          </span>
          <span className={`tree-toggle-label ${gitToneClass}`}>{data.name}</span>
          {data.loading ? <span className="tree-loading">{loadingLabel}</span> : null}
        </div>
      ) : (
        <div className="tree-file-button" title={data.path} draggable>
          <span className="tree-file">
            <span className={`tree-node-icon tree-node-icon--${data.visual.kind}`} aria-hidden="true">
              <NodeIcon className="vb-icon vb-icon-tree-node" />
            </span>
            <span className={`tree-file-name ${gitToneClass}`}>{data.name}</span>
            {(data.visual.badge || data.gitStatus) ? (
              <span className="tree-file-meta">
                {data.visual.badge ? <span className="tree-file-badge">{data.visual.badge}</span> : null}
                {data.gitStatus ? (
                  <span className={`tree-git-status tree-git-status--${data.gitStatus.tone}`}>
                    {data.gitStatus.label}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </div>
      )}
    </div>
  )
}

function TreeDragPreview({ dragIds }: DragPreviewProps) {
  return (
    <div className="tree-row tree-row-drag-overlay">
        <div className="tree-file">
          <span className="tree-node-icon tree-node-icon--folder" aria-hidden="true">
            <Folder className="vb-icon vb-icon-tree-node" />
          </span>
          <span className="tree-file-name">{dragIds.length > 1 ? `${dragIds.length} items` : dragIds[0]}</span>
        </div>
    </div>
  )
}

export function FileTreePane({
  locale,
  workspaceId,
  workspaceRoot: workspaceRootProp = null,
  gitStatusFiles,
  isMacOs = false,
  selectedFilePath,
  onSelectFile,
  onCreateFile,
  onDeletePath,
  onMovePath,
  onOpenSearch,
}: FileTreePaneProps) {
  const treeDndManager = useMemo(() => getSharedTreeDndManager(), [])
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FsEntry[]>>({})
  const [loadedDirectories, setLoadedDirectories] = useState<Record<string, boolean>>({})
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<{ action: 'cut' | 'copy'; path: string } | null>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState(workspaceRootProp ?? '')
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(selectedFilePath)
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 })
  const gitStatusesByPath = useMemo(
    () => buildGitStatusesByPath(gitStatusFiles),
    [gitStatusFiles],
  )
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null)

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

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const workspaceIdRef = useRef<string | null>(workspaceId)
  const loadedDirectoriesRef = useRef<Record<string, boolean>>({})
  const inFlightDirectoryLoadsRef = useRef<Record<string, Promise<void>>>({})
  const pendingRefreshDirectoriesRef = useRef<Set<string>>(new Set())
  const refreshTimerRef = useRef<number | null>(null)
  const treeRef = useRef<TreeApi<TreeNodeData> | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const pendingDropDirectoryRef = useRef<string | null>(null)
  const dragExpandTimerRef = useRef<number | null>(null)
  const dragExpandPathRef = useRef<string | null>(null)
  const dragCollapseTimersRef = useRef<Map<string, number>>(new Map())
  const autoExpandedDirectoriesRef = useRef<Set<string>>(new Set())
  const dragScrollFrameRef = useRef<number | null>(null)
  const dragScrollDeltaRef = useRef(0)
  const nativeFileDragPathRef = useRef<string | null>(null)

  const loadDirectory = useCallback(
    async (rawDirectoryPath: string) => {
      if (!workspaceId) {
        return
      }
      const requestWorkspaceId = workspaceId
      if (workspaceIdRef.current !== requestWorkspaceId) {
        return
      }
      const directoryPath = normalizeDirectoryPath(rawDirectoryPath)
      const loadKey = JSON.stringify([requestWorkspaceId, directoryPath])
      const existingTask = inFlightDirectoryLoadsRef.current[loadKey]
      if (existingTask) {
        await existingTask
        return
      }
      const task = (async () => {
        setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: true }))
        try {
          const response = await desktopApi.fsListDir(requestWorkspaceId, directoryPath, 1)
          if (workspaceIdRef.current !== requestWorkspaceId) {
            return
          }
          setEntriesByDirectory((prev) => ({
            ...prev,
            [directoryPath]: sortEntries(sanitizeDirectoryEntries(response.entries, directoryPath)),
          }))
          setLoadedDirectories((prev) => ({ ...prev, [directoryPath]: true }))
        } catch (error) {
          if (
            workspaceIdRef.current !== requestWorkspaceId ||
            isWorkspaceNotFoundError(error)
          ) {
            return
          }
          addNotification({
            type: 'error',
            message: t(locale, 'fileTree.directoryLoadFailed', {
              detail: error instanceof Error ? error.message : describeUnknownError(error),
            }),
          })
        } finally {
          if (workspaceIdRef.current === requestWorkspaceId) {
            setLoadingDirectories((prev) => ({ ...prev, [directoryPath]: false }))
          }
        }
      })()
      inFlightDirectoryLoadsRef.current[loadKey] = task
      try {
        await task
      } finally {
        if (inFlightDirectoryLoadsRef.current[loadKey] === task) {
          delete inFlightDirectoryLoadsRef.current[loadKey]
        }
      }
    },
    [locale, workspaceId],
  )

  const closeOpenPathsUnder = useCallback((path: string) => {
    const normalized = normalizeDirectoryPath(path)
    const api = treeRef.current
    if (!api) {
      return
    }
    for (const openPath of Object.keys(api.openState)) {
      if (api.isOpen(openPath) && isPathUnder(openPath, normalized)) {
        api.close(openPath)
      }
    }
  }, [])

  const ensureOpenDirectoriesLoaded = useCallback(() => {
    const api = treeRef.current
    if (!api || !workspaceId) {
      return
    }
    for (const path of Object.keys(api.openState)) {
      if (!api.isOpen(path) || path === ROOT_DIR) {
        continue
      }
      const loadKey = JSON.stringify([workspaceId, path])
      if (!loadedDirectoriesRef.current[path] && !inFlightDirectoryLoadsRef.current[loadKey]) {
        void loadDirectory(path)
      }
    }
  }, [loadDirectory, workspaceId])

  const refreshRoot = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    const requestWorkspaceId = workspaceId
    if (workspaceIdRef.current !== requestWorkspaceId) {
      return
    }
    setEntriesByDirectory({})
    setLoadedDirectories({})
    setLoadingDirectories({})
    await loadDirectory(ROOT_DIR)
    if (workspaceIdRef.current !== requestWorkspaceId) {
      return
    }
    ensureOpenDirectoriesLoaded()
  }, [ensureOpenDirectoriesLoaded, loadDirectory, workspaceId])

  useLayoutEffect(() => {
    workspaceIdRef.current = workspaceId
  }, [workspaceId])

  useEffect(() => {
    inFlightDirectoryLoadsRef.current = {}
    if (!workspaceId) {
      setEntriesByDirectory({})
      setLoadedDirectories({})
      setLoadingDirectories({})
      setWorkspaceRoot('')
      setSelectedTreePath(null)
      return
    }
    if (workspaceRootProp) {
      setWorkspaceRoot(workspaceRootProp)
    } else {
      void desktopApi
        .workspaceGetContext(workspaceId)
        .then((context) => {
          if (workspaceIdRef.current === workspaceId) {
            setWorkspaceRoot(context.root)
          }
        })
        .catch(() => {
          if (workspaceIdRef.current === workspaceId) {
            setWorkspaceRoot('')
          }
        })
    }
    void refreshRoot()
  }, [refreshRoot, workspaceId, workspaceRootProp])

  useEffect(() => {
    loadedDirectoriesRef.current = loadedDirectories
  }, [loadedDirectories])

  useEffect(() => {
    setSelectedTreePath(selectedFilePath ? normalizeDirectoryPath(selectedFilePath) : null)
  }, [selectedFilePath])

  const measureTreeViewport = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const nextWidth = Math.max(0, Math.round(viewport.clientWidth))
    const nextHeight = Math.max(0, Math.round(viewport.clientHeight))
    setTreeSize((current) => (
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight }
    ))
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    measureTreeViewport()

    const observer = new ResizeObserver(() => {
      measureTreeViewport()
    })
    observer.observe(viewport)

    const scheduleReflowMeasurements = (attemptsLeft: number) => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        measureTreeViewport()
        if (attemptsLeft > 1) {
          scheduleReflowMeasurements(attemptsLeft - 1)
        } else {
          resizeFrameRef.current = null
        }
      })
    }

    scheduleReflowMeasurements(6)
    window.addEventListener('resize', measureTreeViewport)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureTreeViewport)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [measureTreeViewport, workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedFilePath) {
      return
    }
    const normalizedPath = normalizeDirectoryPath(selectedFilePath)
    const ancestors = collectAncestorDirectories(normalizedPath)
    let cancelled = false
    void (async () => {
      for (const directory of ancestors) {
        if (cancelled) {
          return
        }
        if (!loadedDirectoriesRef.current[directory]) {
          await loadDirectory(directory)
        }
      }
      if (cancelled) {
        return
      }
      treeRef.current?.openParents(normalizedPath)
      void treeRef.current?.scrollTo(normalizedPath)
    })()
    return () => {
      cancelled = true
    }
  }, [loadDirectory, selectedFilePath, workspaceId])

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

  const pruneDirectoryCache = useCallback((path: string) => {
    const normalized = normalizeDirectoryPath(path)
    if (normalized === ROOT_DIR) {
      return
    }
    closeOpenPathsUnder(normalized)
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
    setLoadedDirectories((prev) => {
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (!isPathUnder(key, normalized)) {
          next[key] = value
        }
      }
      return next
    })
    setLoadingDirectories((prev) => {
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (!isPathUnder(key, normalized)) {
          next[key] = value
        }
      }
      return next
    })
  }, [closeOpenPathsUnder])

  const applyOptimisticTreeMove = useCallback((
    fromPath: string,
    toPath: string,
    kind: 'dir' | 'file',
  ) => {
    const normalizedFrom = normalizeDirectoryPath(fromPath)
    const normalizedTo = normalizeDirectoryPath(toPath)
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return
    }

    setEntriesByDirectory((prev) => {
      const sourceParent = parentDirectory(normalizedFrom)
      const targetParent = parentDirectory(normalizedTo)
      const sourceEntries = prev[sourceParent]
      if (!sourceEntries) {
        return prev
      }

      const sourceEntry = sourceEntries.find((entry) => normalizeDirectoryPath(entry.path) === normalizedFrom)
      if (!sourceEntry) {
        return prev
      }

      const next: Record<string, FsEntry[]> = { ...prev }
      next[sourceParent] = sourceEntries.filter(
        (entry) => normalizeDirectoryPath(entry.path) !== normalizedFrom,
      )

      const targetEntries = next[targetParent]
      if (targetEntries) {
        const movedEntry: FsEntry = {
          ...sourceEntry,
          path: normalizedTo,
          name: leafName(normalizedTo),
          kind,
        }
        next[targetParent] = sortEntries([
          ...targetEntries.filter((entry) => normalizeDirectoryPath(entry.path) !== normalizedTo),
          movedEntry,
        ])
      }

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
    await Promise.allSettled(directoriesToReload.map((directory) => loadDirectory(directory)))
  }, [loadDirectory, workspaceId])

  const clearPendingDragExpand = useCallback(() => {
    if (dragExpandTimerRef.current !== null) {
      window.clearTimeout(dragExpandTimerRef.current)
      dragExpandTimerRef.current = null
    }
    dragExpandPathRef.current = null
  }, [])

  const clearPendingDragCollapse = useCallback((path?: string) => {
    if (path) {
      const timer = dragCollapseTimersRef.current.get(path)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        dragCollapseTimersRef.current.delete(path)
      }
      return
    }
    for (const timer of dragCollapseTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    dragCollapseTimersRef.current.clear()
  }, [])

  const collapseAutoExpandedDirectory = useCallback((path: string) => {
    const normalizedPath = normalizeDirectoryPath(path)
    if (!autoExpandedDirectoriesRef.current.has(normalizedPath)) {
      return
    }
    autoExpandedDirectoriesRef.current.delete(normalizedPath)
    clearPendingDragCollapse(normalizedPath)
    treeRef.current?.close(normalizedPath)
  }, [clearPendingDragCollapse])

  const scheduleDragCollapse = useCallback((path: string) => {
    const normalizedPath = normalizeDirectoryPath(path)
    if (!autoExpandedDirectoriesRef.current.has(normalizedPath)) {
      return
    }
    clearPendingDragCollapse(normalizedPath)
    const timer = window.setTimeout(() => {
      dragCollapseTimersRef.current.delete(normalizedPath)
      collapseAutoExpandedDirectory(normalizedPath)
    }, DRAG_COLLAPSE_DELAY_MS)
    dragCollapseTimersRef.current.set(normalizedPath, timer)
  }, [clearPendingDragCollapse, collapseAutoExpandedDirectory])

  const restoreAutoExpandedDirectories = useCallback((keepPath?: string | null) => {
    const keepNormalized = keepPath ? normalizeDirectoryPath(keepPath) : null
    clearPendingDragCollapse()
    const expandedPaths = Array.from(autoExpandedDirectoriesRef.current)
    autoExpandedDirectoriesRef.current.clear()
    for (const path of expandedPaths) {
      if (keepNormalized && path === keepNormalized) {
        autoExpandedDirectoriesRef.current.add(path)
        continue
      }
      treeRef.current?.close(path)
    }
  }, [clearPendingDragCollapse])

  useEffect(() => {
    pendingRefreshDirectoriesRef.current.clear()
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    clearPendingDragExpand()
    clearPendingDragCollapse()
    restoreAutoExpandedDirectories()
    pendingDropDirectoryRef.current = null
    nativeFileDragPathRef.current = null
    setContextMenu(null)
  }, [
    clearPendingDragCollapse,
    clearPendingDragExpand,
    restoreAutoExpandedDirectories,
    workspaceId,
  ])

  const stopDragAutoScroll = useCallback(() => {
    dragScrollDeltaRef.current = 0
    if (dragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragScrollFrameRef.current)
      dragScrollFrameRef.current = null
    }
  }, [])

  const getDragScrollElement = useCallback(() => {
    return treeRef.current?.listEl.current ?? viewportRef.current
  }, [])

  const startDragAutoScroll = useCallback((delta: number) => {
    dragScrollDeltaRef.current = delta
    if (dragScrollFrameRef.current !== null) {
      return
    }
    const tick = () => {
      const scrollElement = getDragScrollElement()
      if (!scrollElement || dragScrollDeltaRef.current === 0) {
        dragScrollFrameRef.current = null
        return
      }
      const nextScrollTop = Math.max(
        0,
        Math.min(
          scrollElement.scrollTop + dragScrollDeltaRef.current,
          scrollElement.scrollHeight - scrollElement.clientHeight,
        ),
      )
      if (nextScrollTop === scrollElement.scrollTop) {
        stopDragAutoScroll()
        return
      }
      scrollElement.scrollTop = nextScrollTop
      dragScrollFrameRef.current = window.requestAnimationFrame(tick)
    }
    dragScrollFrameRef.current = window.requestAnimationFrame(tick)
  }, [getDragScrollElement, stopDragAutoScroll])

  const scheduleDragExpand = useCallback((path: string) => {
    const normalizedPath = normalizeDirectoryPath(path)
    if (!normalizedPath || normalizedPath === ROOT_DIR) {
      clearPendingDragExpand()
      return
    }
    if (dragExpandPathRef.current === normalizedPath) {
      return
    }
    clearPendingDragExpand()
    clearPendingDragCollapse(normalizedPath)
    dragExpandPathRef.current = normalizedPath
    dragExpandTimerRef.current = window.setTimeout(() => {
      dragExpandTimerRef.current = null
      dragExpandPathRef.current = null
      if (!treeRef.current?.isOpen(normalizedPath)) {
        treeRef.current?.open(normalizedPath)
        autoExpandedDirectoriesRef.current.add(normalizedPath)
      }
      void loadDirectory(normalizedPath)
    }, DRAG_EXPAND_DELAY_MS)
  }, [clearPendingDragCollapse, clearPendingDragExpand, loadDirectory])

  const scheduleDirectoryReload = useCallback((paths: string[]) => {
    for (const path of paths) {
      pendingRefreshDirectoriesRef.current.add(normalizeDirectoryPath(path))
    }
    if (refreshTimerRef.current !== null) {
      return
    }
    refreshTimerRef.current = window.setTimeout(() => {
      void flushQueuedDirectoryReloads()
    }, 120)
  }, [flushQueuedDirectoryReloads])

  const reloadParentsAfterMutation = useCallback(async (paths: string[]) => {
    if (!workspaceId) {
      return
    }
    scheduleDirectoryReload(paths.map((path) => parentDirectory(path)))
  }, [scheduleDirectoryReload, workspaceId])

  const handleFilesystemChanged = useCallback((payload: FilesystemChangedPayload) => {
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
  }, [pruneDirectoryCache, scheduleDirectoryReload, workspaceId])

  useEffect(() => {
    if (!workspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    let active = true
    let cleanupChanged: (() => void) | null = null
    let cleanupWatchError: (() => void) | null = null

    void desktopApi
      .subscribeFilesystemEvents((payload: FilesystemChangedPayload) => {
        if (active) {
          handleFilesystemChanged(payload)
        }
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
          }),
        })
      })

    void desktopApi
      .subscribeFilesystemWatchErrors((payload: FilesystemWatchErrorPayload) => {
        if (!active || payload.workspaceId !== workspaceId) {
          return
        }
        addNotification({
          type: 'error',
          message: t(locale, 'fileTree.watchRuntimeError', { detail: payload.detail }),
        })
      })
      .then((unlisten) => {
        if (!active) {
          unlisten()
          return
        }
        cleanupWatchError = unlisten
      })

    return () => {
      active = false
      cleanupChanged?.()
      cleanupWatchError?.()
    }
  }, [handleFilesystemChanged, locale, workspaceId])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      if (dragExpandTimerRef.current !== null) {
        window.clearTimeout(dragExpandTimerRef.current)
      }
      clearPendingDragCollapse()
      stopDragAutoScroll()
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [clearPendingDragCollapse, stopDragAutoScroll])

  const treeData = useMemo(
    () => buildTreeNodes(entriesByDirectory, loadingDirectories, gitStatusesByPath, ROOT_DIR),
    [entriesByDirectory, gitStatusesByPath, loadingDirectories],
  )

  useEffect(() => {
    ensureOpenDirectoriesLoaded()
  }, [ensureOpenDirectoriesLoaded, treeData])

  const nodeKindsByPath = useMemo(() => {
    const next: Record<string, 'dir' | 'file'> = {}
    collectNodeKinds(treeData, next)
    return next
  }, [treeData])

  const effectiveSelectionPath = useMemo(
    () => resolveExistingTreeSelectionPath(selectedTreePath, nodeKindsByPath),
    [nodeKindsByPath, selectedTreePath],
  )

  const selectedTreeKind = selectedTreePath ? nodeKindsByPath[selectedTreePath] ?? null : null

  const createFileAtBase = useCallback(async (basePath: string) => {
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
        if (!trimmedName) {
          return
        }
        const normalizedBase = normalizeDirectoryPath(basePath)
        const normalizedName = trimmedName.replace(/^\/+/, '').replace(/\\/g, '/')
        const targetPath =
          normalizedBase === ROOT_DIR ? normalizedName : `${normalizedBase}/${normalizedName}`
        const created = await onCreateFile(targetPath)
        if (created) {
          await loadDirectory(normalizedBase)
          treeRef.current?.open(normalizedBase)
          onSelectFile(targetPath)
          setSelectedTreePath(targetPath)
        }
        setPromptModal((prev) => ({ ...prev, open: false }))
      },
    })
    setContextMenu(null)
  }, [loadDirectory, locale, onCreateFile, onSelectFile, workspaceId])

  const createFolderAtBase = useCallback(async (basePath: string) => {
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
        if (!trimmedName) {
          return
        }
        const normalizedBase = normalizeDirectoryPath(basePath)
        const normalizedName = trimmedName.replace(/^\/+/, '').replace(/\\/g, '/')
        const targetPath =
          normalizedBase === ROOT_DIR ? normalizedName : `${normalizedBase}/${normalizedName}`
        try {
          await desktopApi.fsCreateDir(workspaceId, targetPath)
          await loadDirectory(normalizedBase)
          treeRef.current?.open(normalizedBase)
          setSelectedTreePath(targetPath)
        } catch (error) {
          addNotification({
            type: 'error',
            message: t(locale, 'fileTree.createFolderFailed', {
              detail: error instanceof Error ? error.message : describeUnknownError(error),
            }),
          })
        }
        setPromptModal((prev) => ({ ...prev, open: false }))
      },
    })
    setContextMenu(null)
  }, [loadDirectory, locale, workspaceId])

  const deletePath = useCallback(async (path: string) => {
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
          setSelectedTreePath(parentDirectory(path))
        }
        setConfirmModal((prev) => ({ ...prev, open: false }))
      },
    })
    setContextMenu(null)
  }, [locale, onDeletePath, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId])

  const movePath = useCallback(async (path: string, kind: 'dir' | 'file') => {
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
        if (!trimmedTarget || trimmedTarget === '.') {
          return
        }
        const normalizedTarget = trimmedTarget
          .replace(/^\/+/, '')
          .replace(/\\/g, '/')
          .replace(/\/+$/, '')
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
          setSelectedTreePath(targetPath)
          if (kind === 'file') {
            onSelectFile(targetPath)
          }
        }
        setPromptModal((prev) => ({ ...prev, open: false }))
      },
    })
    setContextMenu(null)
  }, [locale, onMovePath, onSelectFile, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId])

  const pastePath = useCallback(async (targetBasePath: string) => {
    if (!workspaceId || !clipboard) {
      return
    }
    if (clipboard.path === targetBasePath || isPathUnder(targetBasePath, clipboard.path)) {
      addNotification({ type: 'error', message: t(locale, 'fileTree.pasteInvalid') })
      return
    }
    const sourceName = leafName(clipboard.path)
    const normalizedBase = normalizeDirectoryPath(targetBasePath)
    const existingEntries = entriesByDirectory[normalizedBase] || []
    let targetName = sourceName
    let attempt = 0
    while (existingEntries.some((entry) => entry.name === targetName)) {
      attempt += 1
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
          setSelectedTreePath(targetPath)
        }
      } else {
        await desktopApi.fsCopy(workspaceId, clipboard.path, targetPath)
        await reloadParentsAfterMutation([targetPath])
        setSelectedTreePath(targetPath)
      }
    } catch (error) {
      addNotification({
        type: 'error',
        message: t(locale, 'fileTree.pasteFailed', {
          detail: error instanceof Error ? error.message : describeUnknownError(error),
        }),
      })
    }
    setContextMenu(null)
  }, [clipboard, entriesByDirectory, locale, onMovePath, pruneDirectoryCache, reloadParentsAfterMutation, workspaceId])

  const revealInExplorer = useCallback(async (path: string) => {
    if (!workspaceId) {
      return
    }
    try {
      await desktopApi.fsShowInFolder(workspaceId, path)
    } catch (error) {
      addNotification({
        type: 'error',
        message: t(locale, 'fileTree.revealFailed', {
          detail: error instanceof Error ? error.message : describeUnknownError(error),
        }),
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

  const copyFullPathText = useCallback(async (path: string) => {
    const absolutePath = resolveAbsolutePath(workspaceRoot, path)
    try {
      await navigator.clipboard.writeText(absolutePath || path)
    } catch {
      // ignore clipboard error
    }
    setContextMenu(null)
  }, [workspaceRoot])

  const shortcutLabels = useMemo(
    () => ({
      createFile: formatShortcutBinding(SHORTCUT_CREATE_FILE, isMacOs),
      createFolder: formatShortcutBinding(SHORTCUT_CREATE_FOLDER, isMacOs),
      rename: formatShortcutBinding(SHORTCUT_RENAME, isMacOs),
      delete: formatShortcutBinding(isMacOs ? SHORTCUT_MAC_DELETE : SHORTCUT_DELETE, isMacOs),
      cut: formatShortcutBinding(SHORTCUT_CUT, isMacOs),
      copy: formatShortcutBinding(SHORTCUT_COPY, isMacOs),
      paste: formatShortcutBinding(SHORTCUT_PASTE, isMacOs),
    }),
    [isMacOs],
  )
  const loadingLabel = t(locale, 'fileTree.loading')

  const handleMove: MoveHandler<TreeNodeData> = useCallback(async ({
    dragIds,
    parentId,
    parentNode,
  }) => {
    const sourcePath = dragIds[0]
    if (!sourcePath) {
      return
    }
    const sourceName = leafName(sourcePath)
    const explicitDropDirectory = pendingDropDirectoryRef.current
    pendingDropDirectoryRef.current = null

    let targetBase: string
    if (explicitDropDirectory) {
      targetBase = normalizeDirectoryPath(explicitDropDirectory)
    } else if (parentNode && (parentNode.data as TreeNodeData | undefined)?.kind === 'dir') {
      targetBase = normalizeDirectoryPath((parentNode.data as TreeNodeData).path)
    } else if (parentId) {
      targetBase = normalizeDirectoryPath(parentId)
    } else {
      targetBase = ROOT_DIR
    }

    const targetPath = targetBase === ROOT_DIR ? sourceName : `${targetBase}/${sourceName}`
    if (targetPath === sourcePath) {
      return
    }
    const moved = await onMovePath(sourcePath, targetPath)
    if (!moved) {
      restoreAutoExpandedDirectories()
      return
    }

    if (targetBase !== ROOT_DIR) {
      treeRef.current?.open(targetBase)
    }

    pruneDirectoryCache(sourcePath)
    applyOptimisticTreeMove(sourcePath, targetPath, nodeKindsByPath[sourcePath] ?? 'file')
    await loadDirectory(targetBase)
    await reloadParentsAfterMutation([sourcePath, targetPath])
    setSelectedTreePath(targetPath)
    if (nodeKindsByPath[sourcePath] === 'file') {
      onSelectFile(targetPath)
    }
    restoreAutoExpandedDirectories(targetBase !== ROOT_DIR ? targetBase : null)
  }, [
    applyOptimisticTreeMove,
    loadDirectory,
    nodeKindsByPath,
    onMovePath,
    onSelectFile,
    pruneDirectoryCache,
    reloadParentsAfterMutation,
    restoreAutoExpandedDirectories,
  ])

  const handleNativeFileMove = useCallback(async (sourcePath: string, targetDirectory: string) => {
    const normalizedSourcePath = normalizeDirectoryPath(sourcePath)
    const normalizedTargetDirectory = normalizeDirectoryPath(targetDirectory)
    if (!normalizedSourcePath || !normalizedTargetDirectory) {
      return
    }

    const targetPath =
      normalizedTargetDirectory === ROOT_DIR
        ? leafName(normalizedSourcePath)
        : `${normalizedTargetDirectory}/${leafName(normalizedSourcePath)}`

    if (targetPath === normalizedSourcePath) {
      return
    }

    const moved = await onMovePath(normalizedSourcePath, targetPath)
    if (!moved) {
      restoreAutoExpandedDirectories()
      return
    }

    if (normalizedTargetDirectory !== ROOT_DIR) {
      treeRef.current?.open(normalizedTargetDirectory)
    }

    pruneDirectoryCache(normalizedSourcePath)
    applyOptimisticTreeMove(normalizedSourcePath, targetPath, 'file')
    await loadDirectory(normalizedTargetDirectory)
    await reloadParentsAfterMutation([normalizedSourcePath, targetPath])
    setSelectedTreePath(targetPath)
    onSelectFile(targetPath)
    restoreAutoExpandedDirectories(normalizedTargetDirectory !== ROOT_DIR ? normalizedTargetDirectory : null)
  }, [
    applyOptimisticTreeMove,
    loadDirectory,
    onMovePath,
    onSelectFile,
    pruneDirectoryCache,
    reloadParentsAfterMutation,
    restoreAutoExpandedDirectories,
  ])

  const renderRow = useCallback((props: RowRendererProps<TreeNodeData>) => {
    const { node, attrs, innerRef, children } = props
    return (
      <div
        {...attrs}
        ref={innerRef}
        className={[
          attrs.className,
          'tree-row',
          `tree-row-${node.data.kind}`,
          node.isSelected ? 'tree-row-selected' : '',
          node.isFocused ? 'tree-row-focused' : '',
          node.isDragging ? 'tree-row-dragging-source' : '',
          node.willReceiveDrop ? 'tree-row-drop-target' : '',
          draggingFilePath === node.data.path ? 'tree-row-file-drop-source' : '',
          clipboard?.action === 'cut' && clipboard.path === node.data.path ? 'tree-row-cut' : '',
        ].filter(Boolean).join(' ')}
        onFocus={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          if (node.data.kind === 'dir') {
            node.select()
            setSelectedTreePath(node.data.path)
            node.toggle()
            return
          }
          node.handleClick(event)
          setSelectedTreePath(node.data.path)
          onSelectFile(node.data.path)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          if (node.data.kind === 'file') {
            onSelectFile(node.data.path)
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          node.select()
          setSelectedTreePath(node.data.path)
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            path: node.data.path,
            kind: node.data.kind,
          })
        }}
        onDragOverCapture={(event) => {
          if (nativeFileDragPathRef.current && node.data.kind === 'dir') {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }
          if (node.data.kind === 'dir') {
            pendingDropDirectoryRef.current = node.data.path
            if (!node.isOpen) {
              scheduleDragExpand(node.data.path)
            } else {
              clearPendingDragExpand()
              clearPendingDragCollapse(node.data.path)
            }
          } else {
            pendingDropDirectoryRef.current = null
            clearPendingDragExpand()
          }
        }}
        onDragStartCapture={(event) => {
          if (node.data.kind !== 'file') {
            return
          }
          const payload = buildTerminalFileDropPayload(workspaceRoot, node.data.path)
          event.dataTransfer.effectAllowed = 'copyMove'
          writeTerminalFileDropPayload(event.dataTransfer, payload)
          nativeFileDragPathRef.current = node.data.path
          setDraggingFilePath(node.data.path)
        }}
        onDropCapture={(event) => {
          clearPendingDragExpand()
          clearPendingDragCollapse()
          pendingDropDirectoryRef.current = node.data.kind === 'dir' ? node.data.path : null
          const payload = readTerminalFileDropPayload(event.dataTransfer)
          if (node.data.kind !== 'dir' || !payload || nativeFileDragPathRef.current !== payload.relativePath) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          void handleNativeFileMove(payload.relativePath, node.data.path)
        }}
        onDragLeaveCapture={() => {
          if (dragExpandPathRef.current === node.data.path) {
            clearPendingDragExpand()
          }
          if (node.data.kind === 'dir') {
            scheduleDragCollapse(node.data.path)
          }
        }}
        onDragEndCapture={() => {
          nativeFileDragPathRef.current = null
          setDraggingFilePath(null)
          clearPendingDragExpand()
          clearPendingDragCollapse()
          stopDragAutoScroll()
          restoreAutoExpandedDirectories()
          pendingDropDirectoryRef.current = null
        }}
      >
        {children}
      </div>
    )
  }, [
    clearPendingDragCollapse,
    clearPendingDragExpand,
    clipboard,
    draggingFilePath,
    onSelectFile,
    restoreAutoExpandedDirectories,
    scheduleDragCollapse,
    scheduleDragExpand,
    stopDragAutoScroll,
  ])
  const renderNode = useCallback(
    (props: NodeRendererProps<TreeNodeData>) => (
      <TreeNodeRenderer {...props} loadingLabel={loadingLabel} />
    ),
    [loadingLabel],
  )

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedTreePath || !selectedTreeKind) {
      return
    }
    const isMod = isMacOs ? event.metaKey : event.ctrlKey

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      void createFileAtBase(selectedTreeKind === 'dir' ? selectedTreePath : parentDirectory(selectedTreePath))
      return
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      void createFolderAtBase(selectedTreeKind === 'dir' ? selectedTreePath : parentDirectory(selectedTreePath))
      return
    }
    if (event.key === 'F2') {
      event.preventDefault()
      void movePath(selectedTreePath, selectedTreeKind)
      return
    }
    if (event.key === 'Delete' || (event.key === 'Backspace' && isMacOs && isMod)) {
      event.preventDefault()
      void deletePath(selectedTreePath)
      return
    }
    if (isMod && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      setClipboard({ action: 'copy', path: selectedTreePath })
      return
    }
    if (isMod && event.key.toLowerCase() === 'x') {
      event.preventDefault()
      setClipboard({ action: 'cut', path: selectedTreePath })
      return
    }
    if (isMod && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void pastePath(selectedTreeKind === 'dir' ? selectedTreePath : parentDirectory(selectedTreePath))
      return
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) {
        return
      }
      const rect = activeElement.getBoundingClientRect()
      setContextMenu({
        x: rect.left + Math.min(24, rect.width / 2),
        y: rect.top + Math.min(20, rect.height / 2),
        path: selectedTreePath,
        kind: selectedTreeKind,
      })
    }
  }, [
    createFileAtBase,
    createFolderAtBase,
    deletePath,
    isMacOs,
    movePath,
    pastePath,
    selectedTreeKind,
    selectedTreePath,
  ])

  const rootContextLabel = locale === 'zh-CN' ? '工作区根目录' : 'Workspace Root'
  const targetBaseForContext =
    contextMenu?.kind === 'dir'
      ? contextMenu.path
      : contextMenu?.kind === 'file'
        ? parentDirectory(contextMenu.path)
        : ROOT_DIR

  return (
    <aside className="panel left-pane file-tree-pane">
      <div className="file-tree-header">
        <div className="file-tree-header-actions">
          <button
            type="button"
            className="tree-search-btn"
            aria-label={t(locale, 'fileTree.openSearch')}
            title={t(locale, 'fileTree.openSearch')}
            onClick={() => onOpenSearch?.('file')}
            disabled={!workspaceId}
          >
            <AppIcon name="search" className="vb-icon vb-icon-tree-search" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tree-refresh-btn"
            aria-label={t(locale, 'fileTree.refresh')}
            title={t(locale, 'fileTree.refresh')}
            onClick={() => { void refreshRoot() }}
            disabled={!workspaceId}
          >
            <AppIcon name="refresh" className="vb-icon vb-icon-tree-search" aria-hidden="true" />
          </button>
        </div>
      </div>
      {!workspaceId ? <p className="tree-empty">{t(locale, 'fileTree.noWorkspace')}</p> : null}
      <div className="file-tree-stage">
        <div
          ref={viewportRef}
          className="file-tree-viewport"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onDragOver={(event) => {
            if (nativeFileDragPathRef.current) {
              event.preventDefault()
            }
            const rect = event.currentTarget.getBoundingClientRect()
            const offsetY = event.clientY - rect.top
            if (offsetY <= DRAG_SCROLL_EDGE_PX) {
              startDragAutoScroll(-DRAG_SCROLL_STEP_PX)
            } else if (offsetY >= rect.height - DRAG_SCROLL_EDGE_PX) {
              startDragAutoScroll(DRAG_SCROLL_STEP_PX)
            } else {
              stopDragAutoScroll()
            }
          }}
          onDragLeave={() => {
            stopDragAutoScroll()
          }}
          onDrop={() => {
            stopDragAutoScroll()
          }}
          onContextMenu={(event) => {
            const target = event.target
            if (target instanceof HTMLElement && target.closest('.tree-row')) {
              return
            }
            event.preventDefault()
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              path: ROOT_DIR,
              kind: 'blank',
            })
          }}
        >
          {treeSize.width > 0 && treeSize.height > 0 ? (
            <Tree<TreeNodeData>
              key={workspaceId ?? 'no-workspace'}
              ref={treeRef}
              dndManager={treeDndManager}
              data={treeData}
              width={treeSize.width}
              height={treeSize.height}
              rowHeight={ROW_HEIGHT}
              indent={INDENT}
              overscanCount={OVERSCAN_COUNT}
              selection={effectiveSelectionPath}
              selectionFollowsFocus
              openByDefault={false}
              disableMultiSelection
              onSelect={(nodes) => {
                const next = nodes[0]?.data.path ?? null
                setSelectedTreePath(next)
              }}
              onFocus={(node) => {
                setSelectedTreePath(node.data.path)
              }}
              onActivate={(node) => {
                setSelectedTreePath(node.data.path)
                if (node.data.kind === 'dir') {
                  node.toggle()
                } else {
                  onSelectFile(node.data.path)
                }
              }}
              onToggle={(id) => {
                const path = normalizeDirectoryPath(id)
                if (!loadedDirectoriesRef.current[path]) {
                  void loadDirectory(path)
                }
              }}
              disableDrop={({ parentNode, dragNodes }) => {
                // parentNode may be react-arborist's synthetic root node (which
                // has no data.kind). Allow drops on the root and on directories;
                // only reject drops directly onto file nodes.
                if (parentNode && 'kind' in parentNode.data && parentNode.data.kind !== 'dir') {
                  return true
                }
                const selfOrAncestor = dragNodes.some((dragNode) => {
                  if (!parentNode) {
                    return false
                  }
                  return dragNode.id === parentNode.id || dragNode.isAncestorOf(parentNode)
                })
                return selfOrAncestor
              }}
              onMove={handleMove}
              renderRow={renderRow}
              renderDragPreview={TreeDragPreview}
            >
              {renderNode}
            </Tree>
          ) : workspaceId ? (
            <p className="tree-empty">{t(locale, 'fileTree.loading')}</p>
          ) : null}
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
          {contextMenu.kind === 'blank' ? (
            <>
              <div className="tree-context-caption">{rootContextLabel}</div>
              <div className="tree-context-separator" />
            </>
          ) : null}
          <button type="button" onClick={() => { void createFileAtBase(targetBaseForContext) }}>
            <AppIcon name="file-plus" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.createFile')}</span>
            <span className="tree-context-shortcut">{shortcutLabels.createFile}</span>
          </button>
          <button type="button" onClick={() => { void createFolderAtBase(targetBaseForContext) }}>
            <AppIcon name="folder-plus" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.createFolder')}</span>
            <span className="tree-context-shortcut">{shortcutLabels.createFolder}</span>
          </button>
          <div className="tree-context-separator" />
          {contextMenu.kind !== 'blank' ? (
            <>
              <button type="button" onClick={() => { setClipboard({ action: 'cut', path: contextMenu.path }); setContextMenu(null) }}>
                <AppIcon name="scissors" className="context-menu-icon" />
                <span>{t(locale, 'fileTree.cut')}</span>
                <span className="tree-context-shortcut">{shortcutLabels.cut}</span>
              </button>
              <button type="button" onClick={() => { setClipboard({ action: 'copy', path: contextMenu.path }); setContextMenu(null) }}>
                <AppIcon name="copy" className="context-menu-icon" />
                <span>{t(locale, 'fileTree.copy')}</span>
                <span className="tree-context-shortcut">{shortcutLabels.copy}</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={!clipboard}
            className={!clipboard ? 'disabled' : ''}
            onClick={() => { void pastePath(targetBaseForContext) }}
          >
            <AppIcon name="clipboard-paste" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.paste')}</span>
            <span className="tree-context-shortcut">{shortcutLabels.paste}</span>
          </button>
          <div className="tree-context-separator" />
          <button type="button" onClick={() => { void copyPathText(contextMenu.kind === 'blank' ? ROOT_DIR : contextMenu.path) }}>
            <AppIcon name="link" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.copyPath')}</span>
          </button>
          <button type="button" onClick={() => { void copyFullPathText(contextMenu.kind === 'blank' ? ROOT_DIR : contextMenu.path) }}>
            <AppIcon name="copy" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.copyFullPath')}</span>
          </button>
          <div className="tree-context-separator" />
          {contextMenu.kind !== 'blank' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (contextMenu.kind === 'dir' || contextMenu.kind === 'file') {
                    void movePath(contextMenu.path, contextMenu.kind)
                  }
                }}
              >
                <AppIcon name="pencil" className="context-menu-icon" />
                <span>{t(locale, 'fileTree.renameMove')}</span>
                <span className="tree-context-shortcut">{shortcutLabels.rename}</span>
              </button>
              <button type="button" className="danger" onClick={() => { void deletePath(contextMenu.path) }}>
                <AppIcon name="trash" className="context-menu-icon" />
                <span>{t(locale, 'fileTree.delete')}</span>
                <span className="tree-context-shortcut">{shortcutLabels.delete}</span>
              </button>
              <div className="tree-context-separator" />
            </>
          ) : null}
          <button type="button" onClick={() => { void revealInExplorer(contextMenu.kind === 'blank' ? ROOT_DIR : contextMenu.path) }}>
            <AppIcon name="external" className="context-menu-icon" />
            <span>{t(locale, 'fileTree.revealInExplorer')}</span>
          </button>
          {contextMenu.kind === 'blank' ? (
            <button type="button" onClick={() => { void refreshRoot(); setContextMenu(null) }}>
              <AppIcon name="refresh" className="context-menu-icon" />
              <span>{t(locale, 'fileTree.refresh')}</span>
            </button>
          ) : null}
        </div>,
        document.body,
      ) : null}
      <FileTreePromptModal
        key={buildFileTreeModalKey('prompt', promptModal.open, promptModal.title, promptModal.defaultValue)}
        open={promptModal.open}
        title={promptModal.title}
        defaultValue={promptModal.defaultValue}
        placeholder={promptModal.placeholder}
        onClose={() => setPromptModal((prev) => ({ ...prev, open: false }))}
        onSubmit={promptModal.onSubmit}
      />
      <FileTreeConfirmModal
        key={buildFileTreeModalKey('confirm', confirmModal.open, confirmModal.title, confirmModal.message)}
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        onClose={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmModal.onConfirm}
      />
    </aside>
  )
}
