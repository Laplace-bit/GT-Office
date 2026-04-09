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
import { desktopApi, type FilesystemChangedPayload } from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'
import {
  describeError,
  remapSelectedPathAfterMove,
  type FileEditorCommandRequest,
  type FileReadMode,
} from './ShellRoot.shared'

type FileSearchMode = 'file' | 'content'

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
  loadFileContent: (filePath: string, mode?: FileReadMode, options?: { activate?: boolean }) => Promise<void>
  loadFileContentRef: MutableRefObject<(filePath: string, mode?: FileReadMode, options?: { activate?: boolean }) => Promise<void>>
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
  const loadFileContentRef = useRef<(filePath: string, mode?: FileReadMode, options?: { activate?: boolean }) => Promise<void>>(
    async () => {},
  )
  const openedFilesRef = useRef<OpenedFile[]>([])
  const activeFilePathRef = useRef<string | null>(null)
  const fileReadModeRef = useRef<FileReadMode>('full')
  const fileReadSeqRef = useRef(0)

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
    () => async (filePath: string, mode: FileReadMode = 'full', options?: { activate?: boolean }) => {
      const activate = options?.activate !== false
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
      if (existingFile?.hydrated) {
        if (activate) setActiveFilePath(filePath)
        setFileCanRenderText(true)
        setFilePreviewNotice(null)
        setFileReadError(null)
        return
      }

      if (activate) setActiveFilePath(filePath)
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
                    viewType: 'editor',
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

  const saveFileContent = useCallback(
    async (filePath: string, content: string): Promise<boolean> => {
      if (!activeWorkspaceId) {
        return false
      }

      try {
        await desktopApi.fsWriteFile(activeWorkspaceId, filePath, content)
        setOpenedFiles((prev) =>
          prev.map((file) =>
            file.path === filePath
              ? { ...file, content, isModified: false, hydrated: true, viewType: 'editor' }
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
    },
    [loadFileContent],
  )

  const handleFileModified = useCallback((filePath: string, isModified: boolean) => {
    setOpenedFiles((prev) =>
      prev.map((file) => (file.path === filePath ? { ...file, isModified } : file)),
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
      if (!activeWorkspaceId) {
        setFileReadError(t(locale, 'fileContent.bindWorkspace'))
        return false
      }

      try {
        const response = await desktopApi.fsMove(activeWorkspaceId, fromPath, toPath)
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
        const removedPaths = new Set(changedPaths)
        setOpenedFiles((prev) => {
          const nextFiles = prev.filter((file) => !removedPaths.has(file.path))
          const currentActiveFilePath = activeFilePathRef.current
          if (currentActiveFilePath && removedPaths.has(currentActiveFilePath)) {
            const nextFile = nextFiles[0]
            setActiveFilePath(nextFile?.path ?? null)
          }
          return nextFiles
        })
        return
      }
      if (
        payload.kind === 'modified' ||
        payload.kind === 'created' ||
        payload.kind === 'renamed' ||
        payload.kind === 'other'
      ) {
        for (const file of currentOpenedFiles) {
          if (
            changedPaths.includes(file.path) &&
            file.viewType === 'editor' &&
            file.hydrated &&
            !file.isModified
          ) {
            void loadFileContent(file.path, fileReadModeRef.current, { activate: false })
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
    openedFilesRef.current = []
    activeFilePathRef.current = null
    fileReadModeRef.current = 'full'
    setOpenedFiles([])
    setActiveFilePath(null)
    setFilePreviewNotice(null)
    setFileCanRenderText(false)
    setFileReadMode('full')
    setFileReadLoading(false)
    setFileReadError(null)
    setIsFileSearchModalOpen(false)
    setFileEditorCommandRequest(null)
  }, [])

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
