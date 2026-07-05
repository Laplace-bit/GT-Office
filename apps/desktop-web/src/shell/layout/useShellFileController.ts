import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { OpenedFile } from '@features/file-explorer'
import { isPreviewable } from '@features/file-preview'
import {
  desktopApi,
  type FilesystemChangedPayload,
  type FsStatEntry,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'
import {
  describeError,
  remapSelectedPathAfterMove,
  type FileEditorCommandRequest,
  type FileReadMode,
} from './ShellRoot.shared'
import { resolveOpenedEditorPathsForWatchEvent } from './file-watch-reconcile-model'

type FileSearchMode = 'file' | 'content'
type LoadFileOptions = {
  activate?: boolean
  forceReload?: boolean
  silent?: boolean
}

function isPathInvalidReadError(error: unknown): boolean {
  const detail = describeError(error)
  return detail.includes('FS_PATH_INVALID')
}

interface UseShellFileControllerInput {
  activeWorkspaceId: string | null
  locale: Locale
}

export interface ShellFileController {
  openedFiles: OpenedFile[]
  setOpenedFiles: Dispatch<SetStateAction<OpenedFile[]>>
  activeFilePath: string | null
  setActiveFilePath: Dispatch<SetStateAction<string | null>>
  filePreviewNotice: string | null
  fileCanRenderText: boolean
  fileReadLoading: boolean
  fileReadError: string | null
  isFileSearchModalOpen: boolean
  fileSearchMode: 'file' | 'content'
  setIsFileSearchModalOpen: Dispatch<SetStateAction<boolean>>
  fileEditorCommandRequest: FileEditorCommandRequest | null
  tabSessionSnapshotEntries: Array<{ path: string; active: boolean }>
  tabSessionSnapshotSignature: string
  loadFileContent: (filePath: string, mode?: FileReadMode, options?: LoadFileOptions) => Promise<void>
  loadFileContentRef: MutableRefObject<(filePath: string, mode?: FileReadMode, options?: LoadFileOptions) => Promise<void>>
  saveFileContent: (filePath: string, content: string) => Promise<boolean>
  createFileInWorkspace: (filePath: string) => Promise<boolean>
  closeFile: (filePath: string) => void
  selectFile: (filePath: string) => void
  handleFileModified: (filePath: string, isModified: boolean) => void
  deletePathInWorkspace: (path: string) => Promise<boolean>
  movePathInWorkspace: (fromPath: string, toPath: string) => Promise<boolean>
  requestFileSearch: (mode?: FileSearchMode) => void
  requestFileEditorCommand: (
    type: FileEditorCommandRequest['type'],
    options?: { line?: number; targetPath?: string | null },
  ) => void
  resetFileState: () => void
}

export function useShellFileController({
  activeWorkspaceId,
  locale,
}: UseShellFileControllerInput): ShellFileController {
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [filePreviewNotice, setFilePreviewNotice] = useState<string | null>(null)
  const [fileCanRenderText, setFileCanRenderText] = useState(false)
  const [fileReadMode, setFileReadMode] = useState<FileReadMode>('full')
  const [fileReadLoading, setFileReadLoading] = useState(false)
  const [fileReadError, setFileReadError] = useState<string | null>(null)
  const [isFileSearchModalOpen, setIsFileSearchModalOpen] = useState(false)
  const [fileSearchMode, setFileSearchMode] = useState<FileSearchMode>('file')
  const [fileEditorCommandRequest, setFileEditorCommandRequest] =
    useState<FileEditorCommandRequest | null>(null)
  const loadFileContentRef = useRef<(filePath: string, mode?: FileReadMode, options?: LoadFileOptions) => Promise<void>>(
    async () => {},
  )
  const openedFilesRef = useRef<OpenedFile[]>([])
  const activeFilePathRef = useRef<string | null>(null)
  const fileReadModeRef = useRef<FileReadMode>('full')
  const fileReadSeqRef = useRef(0)
  const fileReadSeqByPathRef = useRef<Map<string, number>>(new Map())
  const recentlySavedPathsRef = useRef<Map<string, number>>(new Map())
  const pendingExternalStatPathsRef = useRef<Set<string>>(new Set())
  const pendingExternalStatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPendingExternalStatTimer = useCallback(() => {
    if (pendingExternalStatTimerRef.current) {
      clearTimeout(pendingExternalStatTimerRef.current)
      pendingExternalStatTimerRef.current = null
    }
  }, [])

  const markFilesStale = useCallback((paths: string[], mtimeByPath?: Map<string, number>) => {
    if (paths.length === 0) {
      return
    }
    const pathSet = new Set(paths)
    setOpenedFiles((prev) =>
      prev.map((file) =>
        pathSet.has(file.path)
          ? {
              ...file,
              isStale: true,
              mtimeMs: mtimeByPath?.get(file.path) ?? file.mtimeMs,
            }
          : file,
      ),
    )
  }, [])

  const removeOpenedFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) {
      return
    }
    const removedPaths = new Set(paths)
    setOpenedFiles((prev) => {
      const nextFiles = prev.filter((file) => !removedPaths.has(file.path))
      const currentActiveFilePath = activeFilePathRef.current
      if (currentActiveFilePath && removedPaths.has(currentActiveFilePath)) {
        const nextFile = nextFiles[0]
        setActiveFilePath(nextFile?.path ?? null)
      }
      return nextFiles
    })
  }, [])

  const reconcileOpenedFilesWithStatsRef = useRef<(paths: string[]) => Promise<void>>(async () => {})

  useEffect(() => {
    openedFilesRef.current = openedFiles
  }, [openedFiles])

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    fileReadModeRef.current = fileReadMode
  }, [fileReadMode])

  const loadFileContent = useMemo(
    () => async (filePath: string, mode: FileReadMode = 'full', options?: LoadFileOptions) => {
      const activate = options?.activate !== false
      const forceReload = options?.forceReload === true
      const silent = options?.silent === true
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return
      }

      // Preview-capable files open as lightweight tabs and mount their heavy content on activation.
      if (isPreviewable(filePath)) {
        setOpenedFiles((prev) => {
          if (prev.some((file) => file.path === filePath)) {
            return prev
          }
          return [
            ...prev,
            {
              path: filePath,
              content: '',
              size: 0,
              isModified: false,
              hydrated: true,
              viewType: 'preview',
              mtimeMs: 0,
              contentSignature: '',
            },
          ]
        })
        if (activate) setActiveFilePath(filePath)
        setFileReadLoading(false)
        setFileReadError(null)
        setFilePreviewNotice(null)
        return
      }

      const existingFile = openedFilesRef.current.find((file) => file.path === filePath)
      if (existingFile?.hydrated && !forceReload && !existingFile.isStale) {
        if (activate) setActiveFilePath(filePath)
        setFileCanRenderText(true)
        setFilePreviewNotice(null)
        setFileReadError(null)
        return
      }

      if (activate) setActiveFilePath(filePath)
      const affectsVisibleFile = activate || activeFilePathRef.current === filePath
      if (!silent && affectsVisibleFile) {
        setFileReadLoading(true)
        setFileReadError(null)
        setFilePreviewNotice(null)
      }
      const currentSeq = fileReadSeqRef.current + 1
      fileReadSeqRef.current = currentSeq
      fileReadSeqByPathRef.current.set(filePath, currentSeq)

      try {
        const response =
          mode === 'full'
            ? await desktopApi.fsReadFileFull(activeWorkspaceId, filePath)
            : await desktopApi.fsReadFile(activeWorkspaceId, filePath)
        if (fileReadSeqByPathRef.current.get(filePath) !== currentSeq) {
          return
        }

        setFileReadMode(mode)
        if (!response.previewable) {
          if (affectsVisibleFile) {
            setFileCanRenderText(false)
            setFilePreviewNotice(
              t(locale, 'file.previewBinary', {
                size: response.sizeBytes,
              }),
            )
          }
          return
        }

        if (affectsVisibleFile) {
          setFileCanRenderText(true)
        }
        setOpenedFiles((prev) => {
          const existingOpenedFile = prev.find((file) => file.path === filePath)
          if (!existingOpenedFile && !activate) {
            return prev
          }
          if (existingOpenedFile?.isModified && !activate) {
            return prev
          }
          const exists = Boolean(existingOpenedFile)
          if (exists) {
            return prev.map((file) =>
              file.path === filePath
                ? {
                    ...file,
                    content: response.content,
                    size: response.sizeBytes,
                    hydrated: true,
                    viewType: 'editor',
                    mtimeMs: response.mtimeMs,
                    contentSignature: response.contentSignature ?? `${response.sizeBytes}:${response.mtimeMs}`,
                    isStale: false,
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
              viewType: 'editor',
              mtimeMs: response.mtimeMs,
              contentSignature: response.contentSignature ?? `${response.sizeBytes}:${response.mtimeMs}`,
            },
          ]
        })
        if (affectsVisibleFile) {
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
        }
      } catch (error) {
        if (fileReadSeqByPathRef.current.get(filePath) !== currentSeq) {
          return
        }
        if (forceReload) {
          if (isPathInvalidReadError(error) && activeWorkspaceId) {
            try {
              const statResponse = await desktopApi.fsStatFiles(activeWorkspaceId, [filePath])
              const statEntry = statResponse.entries.find((entry) => entry.path === filePath)
              if (!statEntry?.exists) {
                removeOpenedFiles([filePath])
                return
              }
              markFilesStale([filePath], new Map([[filePath, statEntry.mtimeMs]]))
              return
            } catch {
              markFilesStale([filePath])
              return
            }
          }
          if (silent) {
            markFilesStale([filePath])
            return
          }
        }
        if (affectsVisibleFile) {
          setFilePreviewNotice(null)
          setFileCanRenderText(false)
          setFileReadError(
            t(locale, 'file.readError', {
              detail: describeError(error),
            }),
          )
        }
      } finally {
        if (
          !silent &&
          affectsVisibleFile &&
          fileReadSeqByPathRef.current.get(filePath) === currentSeq
        ) {
          setFileReadLoading(false)
        }
      }
    },
    [activeWorkspaceId, locale, markFilesStale, removeOpenedFiles],
  )

  const reconcileOpenedFilesWithStats = useCallback(
    async (paths: string[]) => {
      if (!activeWorkspaceId) {
        return
      }
      const candidatePaths = Array.from(
        new Set(
          paths.filter((path) => {
            const file = openedFilesRef.current.find((entry) => entry.path === path)
            return Boolean(file && file.hydrated && file.viewType === 'editor')
          }),
        ),
      )
      if (candidatePaths.length === 0) {
        return
      }

      let statResponse: { entries: FsStatEntry[] }
      try {
        statResponse = await desktopApi.fsStatFiles(activeWorkspaceId, candidatePaths)
      } catch {
        return
      }

      const statByPath = new Map(statResponse.entries.map((entry) => [entry.path, entry]))
      const filesToReload: string[] = []
      const filesToRemove: string[] = []
      const staleFiles: string[] = []
      const staleMtimeByPath = new Map<string, number>()

      for (const path of candidatePaths) {
        const file = openedFilesRef.current.find((entry) => entry.path === path)
        if (!file || !file.hydrated || file.viewType !== 'editor') {
          continue
        }

        const statEntry = statByPath.get(path)
        if (!statEntry?.exists) {
          filesToRemove.push(path)
          continue
        }
        const statSignature = statEntry.contentSignature ?? `${statEntry.sizeBytes}:${statEntry.mtimeMs}`
        const fileSignature = file.contentSignature ?? `${file.size}:${file.mtimeMs}`
        if (statEntry.mtimeMs === file.mtimeMs) {
          if (statSignature === fileSignature) {
            continue
          }
        }

        const savedAt = recentlySavedPathsRef.current.get(path)
        if (savedAt && Date.now() - savedAt < 2000 && statSignature === fileSignature) {
          continue
        }

        if (file.isModified) {
          staleFiles.push(path)
          staleMtimeByPath.set(path, statEntry.mtimeMs)
          continue
        }

        filesToReload.push(path)
      }

      if (filesToRemove.length > 0) {
        removeOpenedFiles(filesToRemove)
      }
      if (staleFiles.length > 0) {
        markFilesStale(staleFiles, staleMtimeByPath)
      }
      await Promise.all(
        filesToReload.map((path) =>
          loadFileContentRef.current(path, fileReadModeRef.current, {
            activate: false,
            forceReload: true,
            silent: true,
          }),
        ),
      )
    },
    [activeWorkspaceId, markFilesStale, removeOpenedFiles],
  )

  useEffect(() => {
    loadFileContentRef.current = loadFileContent
  }, [loadFileContent])

  useEffect(() => {
    reconcileOpenedFilesWithStatsRef.current = reconcileOpenedFilesWithStats
  }, [reconcileOpenedFilesWithStats])

  const saveFileContent = useCallback(
    async (filePath: string, content: string): Promise<boolean> => {
      if (!activeWorkspaceId) {
        return false
      }

      try {
        await desktopApi.fsWriteFile(activeWorkspaceId, filePath, content)
        const statResponse = await desktopApi.fsStatFiles(activeWorkspaceId, [filePath])
        const statEntry = statResponse.entries.find((e) => e.path === filePath)
        recentlySavedPathsRef.current.set(filePath, Date.now())
        setOpenedFiles((prev) =>
          prev.map((file) =>
            file.path === filePath
              ? {
                  ...file,
                  content,
                  isModified: false,
                  hydrated: true,
                  viewType: 'editor',
                  mtimeMs: statEntry?.mtimeMs ?? file.mtimeMs,
                  contentSignature:
                    statEntry?.contentSignature ??
                    (statEntry ? `${statEntry.sizeBytes}:${statEntry.mtimeMs}` : file.contentSignature),
                  isStale: false,
                }
              : file,
          ),
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

  const closeFile = useCallback(
    (filePath: string) => {
      recentlySavedPathsRef.current.delete(filePath)
      fileReadSeqByPathRef.current.delete(filePath)
      pendingExternalStatPathsRef.current.delete(filePath)
      setOpenedFiles((prev) => {
        const nextFiles = prev.filter((file) => file.path !== filePath)
        if (activeFilePathRef.current === filePath) {
          const closedIndex = prev.findIndex((file) => file.path === filePath)
          const nextFile = nextFiles[Math.min(closedIndex, nextFiles.length - 1)]
          setActiveFilePath(nextFile?.path ?? null)
        }
        return nextFiles
      })
    },
    [],
  )

  const selectFile = useCallback(
    (filePath: string) => {
      const existing = openedFilesRef.current.find((file) => file.path === filePath)
      if (existing && !existing.hydrated) {
        void loadFileContent(filePath, 'full')
        return
      }
      setActiveFilePath(filePath)
      setFileReadError(null)
      if (existing?.hydrated && existing.mtimeMs > 0 && activeWorkspaceId) {
        void reconcileOpenedFilesWithStatsRef.current([filePath])
      }
    },
    [loadFileContent, activeWorkspaceId],
  )

  const handleFileModified = useCallback((filePath: string, isModified: boolean) => {
    setOpenedFiles((prev) =>
      prev.map((file) =>
        file.path === filePath
          ? { ...file, isModified, ...(isModified ? {} : { isStale: false }) }
          : file,
      ),
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
        setOpenedFiles((prev) => {
          const nextFiles = prev.filter(
            (file) => file.path !== path && !file.path.startsWith(`${path}/`),
          )
          const currentActiveFilePath = activeFilePathRef.current
          if (
            currentActiveFilePath &&
            (currentActiveFilePath === path || currentActiveFilePath.startsWith(`${path}/`))
          ) {
            const nextFile = nextFiles[0]
            setActiveFilePath(nextFile?.path ?? null)
          }
          return nextFiles
        })
        setFilePreviewNotice(null)
        setFileCanRenderText(openedFilesRef.current.length > 1)
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
    [activeWorkspaceId, locale],
  )

  const movePathInWorkspace = useMemo(
    () => async (fromPath: string, toPath: string) => {
      console.log('[movePathInWorkspace] called', { fromPath, toPath, activeWorkspaceId })
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        console.warn('[movePathInWorkspace] no activeWorkspaceId, aborting')
        return false
      }

      try {
        console.log('[movePathInWorkspace] calling desktopApi.fsMove...')
        const response = await desktopApi.fsMove(activeWorkspaceId, fromPath, toPath)
        console.log('[movePathInWorkspace] fsMove response:', response)
        if (!response.moved) {
          return true
        }
        const remapped = remapSelectedPathAfterMove(activeFilePathRef.current, fromPath, toPath)
        if (remapped && remapped !== activeFilePathRef.current) {
          setOpenedFiles((prev) =>
            prev.map((file) => {
              const nextPath = remapSelectedPathAfterMove(file.path, fromPath, toPath)
              return nextPath && nextPath !== file.path ? { ...file, path: nextPath } : file
            }),
          )
          setActiveFilePath(remapped)
        }
        return true
      } catch (error) {
        console.error('[movePathInWorkspace] fsMove threw:', error)
        setFileReadError(
          t(locale, 'file.moveFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [activeWorkspaceId, locale],
  )

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null
    const scheduleStatReconcile = (paths: string[]) => {
      const candidatePaths = resolveOpenedEditorPathsForWatchEvent(openedFilesRef.current, paths)
      if (candidatePaths.length === 0) {
        return
      }
      for (const path of candidatePaths) {
        pendingExternalStatPathsRef.current.add(path)
      }
      clearPendingExternalStatTimer()
      pendingExternalStatTimerRef.current = setTimeout(() => {
        const queuedPaths = Array.from(pendingExternalStatPathsRef.current)
        pendingExternalStatPathsRef.current.clear()
        pendingExternalStatTimerRef.current = null
        if (queuedPaths.length === 0) {
          return
        }
        void reconcileOpenedFilesWithStatsRef.current(queuedPaths)
      }, 120)
    }

    const handleFilesystemChanged = (payload: FilesystemChangedPayload) => {
      if (!active || payload.workspaceId !== activeWorkspaceId) {
        return
      }
      const changedPaths = payload.paths.map((path) => path.replace(/^\.\/+/, ''))
      const currentOpenedFiles = openedFilesRef.current
      if (currentOpenedFiles.length === 0) {
        return
      }

      if (
        payload.kind === 'removed' ||
        payload.kind === 'modified' ||
        payload.kind === 'created' ||
        payload.kind === 'renamed' ||
        payload.kind === 'other'
      ) {
        scheduleStatReconcile(changedPaths)
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
      clearPendingExternalStatTimer()
      pendingExternalStatPathsRef.current.clear()
      if (cleanup) {
        cleanup()
      }
    }
  }, [activeWorkspaceId, clearPendingExternalStatTimer])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }

    let focusDebounceTimer: ReturnType<typeof setTimeout> | null = null

    const handleWindowFocus = () => {
      if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
      focusDebounceTimer = setTimeout(() => {
        const currentOpenedFiles = openedFilesRef.current
        const eligibleFiles = currentOpenedFiles.filter(
          (file) => file.hydrated && file.viewType === 'editor' && file.mtimeMs > 0,
        )
        if (eligibleFiles.length === 0) return

        void reconcileOpenedFilesWithStatsRef.current(eligibleFiles.map((file) => file.path))
      }, 250)
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => {
      if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [activeWorkspaceId])

  const requestFileSearch = useCallback((mode?: FileSearchMode) => {
    if (mode) {
      setFileSearchMode(mode)
    }
    setIsFileSearchModalOpen(true)
  }, [])

  const requestFileEditorCommand = useCallback((
    type: FileEditorCommandRequest['type'],
    options?: { line?: number; targetPath?: string | null },
  ) => {
    setFileEditorCommandRequest((prev) => ({
      type,
      nonce: (prev?.nonce ?? 0) + 1,
      line: options?.line,
      targetPath: options?.targetPath ?? activeFilePathRef.current,
    }))
  }, [])

  const resetFileState = useCallback(() => {
    fileReadSeqRef.current += 1
    fileReadSeqByPathRef.current.clear()
    openedFilesRef.current = []
    activeFilePathRef.current = null
    fileReadModeRef.current = 'full'
    recentlySavedPathsRef.current.clear()
    pendingExternalStatPathsRef.current.clear()
    clearPendingExternalStatTimer()
    setOpenedFiles([])
    setActiveFilePath(null)
    setFilePreviewNotice(null)
    setFileCanRenderText(false)
    setFileReadMode('full')
    setFileReadLoading(false)
    setFileReadError(null)
    setIsFileSearchModalOpen(false)
    setFileEditorCommandRequest(null)
  }, [clearPendingExternalStatTimer])

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

  return {
    openedFiles,
    setOpenedFiles,
    activeFilePath,
    setActiveFilePath,
    filePreviewNotice,
    fileCanRenderText,
    fileReadLoading,
    fileReadError,
    isFileSearchModalOpen,
    fileSearchMode,
    setIsFileSearchModalOpen,
    fileEditorCommandRequest,
    tabSessionSnapshotEntries,
    tabSessionSnapshotSignature,
    loadFileContent,
    loadFileContentRef,
    saveFileContent,
    createFileInWorkspace,
    closeFile,
    selectFile,
    handleFileModified,
    deletePathInWorkspace,
    movePathInWorkspace,
    requestFileSearch,
    requestFileEditorCommand,
    resetFileState,
  }
}
