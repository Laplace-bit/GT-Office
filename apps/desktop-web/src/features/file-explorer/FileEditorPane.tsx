import { createPortal } from 'react-dom'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { desktopApi } from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { FileEditorAutoSaveDelay } from '@shell/state/ui-preferences'
import { AppIcon } from '@shell/ui/icons'
import {
  MonacoEditor,
  MarkdownRenderer,
  MarkdownSplitView,
  type MonacoEditorCommandRequest as CodeEditorCommandRequest,
  type MarkdownViewMode,
} from '@/components/editor'
import { FilePreviewPane } from '@features/file-preview'
import { resolveWorkspaceAbsolutePath } from './file-paths'
import { resolveFileVisual } from './file-visuals'
import { MarkdownModeToggle } from './MarkdownModeToggle'
import './FileEditorPane.scss'

// Import code highlighting styles for markdown preview
import 'highlight.js/styles/github-dark.css'

const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024

export interface OpenedFile {
  path: string
  content: string
  size: number
  isModified: boolean
  hydrated: boolean
  viewType: 'editor' | 'preview'
  mtimeMs: number
  isStale?: boolean
}

interface FileEditorPaneProps {
  locale: Locale
  workspaceId: string | null
  workspaceRoot: string | null
  openedFiles: OpenedFile[]
  activeFilePath: string | null
  loading: boolean
  errorMessage: string | null
  noticeMessage: string | null
  canRenderContent: boolean
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => void
  onSaveFile?: (path: string, content: string) => Promise<boolean>
  onFileModified?: (path: string, isModified: boolean) => void
  editorCommandRequest?: CodeEditorCommandRequest | null
  autoSaveEnabled?: boolean
  autoSaveDelayMs?: FileEditorAutoSaveDelay
}

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'
type TabContextActionId =
  | 'copy-path'
  | 'copy-full-path'
  | 'reveal'
  | 'close'
  | 'close-others'
  | 'close-to-right'
  | 'close-all'

interface TabContextMenuState {
  x: number
  y: number
  path: string
}

function isSameCommandRequest(
  left: CodeEditorCommandRequest | null | undefined,
  right: CodeEditorCommandRequest | null | undefined,
): boolean {
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.nonce === right.nonce &&
    left.type === right.type &&
    left.line === right.line &&
    left.targetPath === right.targetPath
  )
}

// Memoized editor - 完全隔离，不会因父组件状态变化而重渲染
const MemoizedEditor = memo(
  MonacoEditor,
  (prev, next) =>
    prev.locale === next.locale &&
    prev.content === next.content &&
    prev.filePath === next.filePath &&
    prev.readOnly === next.readOnly &&
    isSameCommandRequest(prev.commandRequest, next.commandRequest)
)

function getFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// Memoized Tab 组件
const FileTab = memo(function FileTab({
  file,
  isActive,
  tabRef,
  onSelect,
  onClose,
  onContextMenu,
}: {
  file: OpenedFile
  isActive: boolean
  tabRef?: (node: HTMLDivElement | null) => void
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  const visual = resolveFileVisual(file.path, 'file')
  const TabIcon = visual.icon

  return (
    <div
      ref={tabRef}
      className={`file-editor-tab ${isActive ? 'active' : ''} ${file.isStale ? 'file-editor-tab--stale' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={file.path}
    >
      <span className="file-editor-tab-name">
        <span className={`file-editor-tab-icon file-editor-tab-icon--${visual.kind}`}>
          <TabIcon className="vb-icon" aria-hidden="true" />
        </span>
        <span className="file-editor-tab-label">{getFileName(file.path)}</span>
        {file.isModified && <span className="file-editor-tab-modified" />}
        {file.isStale && !file.isModified && <span className="file-editor-tab-stale" />}
      </span>
      <button
        type="button"
        className="file-editor-tab-close"
        onClick={onClose}
        aria-label="Close"
      >
        <X width={12} height={12} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  )
})

export function FileEditorPane({
  locale,
  workspaceId,
  workspaceRoot,
  openedFiles,
  activeFilePath,
  loading,
  errorMessage,
  noticeMessage,
  canRenderContent,
  onSelectFile,
  onCloseFile,
  onSaveFile,
  onFileModified,
  editorCommandRequest = null,
  autoSaveEnabled = false,
  autoSaveDelayMs = 2000,
}: FileEditorPaneProps) {
  const editedContentRef = useRef<Record<string, string>>({})
  const lastSavedContentRef = useRef<Record<string, string>>({})
  const modifiedStateRef = useRef<Record<string, boolean>>({})
  const saveTimeoutRef = useRef<number | null>(null)
  const autoSaveTimeoutsRef = useRef<Record<string, number>>({})
  const [saveFeedback, setSaveFeedback] = useState<{
    path: string | null
    state: SaveState
    error: string | null
  }>({
    path: null,
    state: 'idle',
    error: null,
  })
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({})
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const onFileModifiedRef = useRef(onFileModified)

  // Markdown view mode state
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('edit')

  useEffect(() => {
    onFileModifiedRef.current = onFileModified
  }, [onFileModified])

  const activeFile = openedFiles.find((f) => f.path === activeFilePath)
  const isPreviewFile = activeFile?.viewType === 'preview'

  // Detect if the active file is markdown
  const isMarkdown = useMemo(() => {
    if (!activeFilePath) return false
    const lowerPath = activeFilePath.toLowerCase()
    return !isPreviewFile && (lowerPath.endsWith('.md') || lowerPath.endsWith('.mdx'))
  }, [activeFilePath, isPreviewFile])
  const isLargeFile = (activeFile?.size ?? 0) > LARGE_FILE_THRESHOLD_BYTES
  const isStaleFile = activeFile?.isStale === true
  const isReadOnly = isLargeFile || !onSaveFile
  const visibleSaveState = saveFeedback.path === activeFilePath ? saveFeedback.state : 'idle'
  const visibleSaveError = saveFeedback.path === activeFilePath ? saveFeedback.error : null
  const openFilePathsKey = openedFiles.map((file) => file.path).join('\u0000')

  // 初始化编辑内容缓存
  useEffect(() => {
    for (const file of openedFiles) {
      if (!(file.path in editedContentRef.current)) {
        editedContentRef.current[file.path] = file.content
        lastSavedContentRef.current[file.path] = file.content
        modifiedStateRef.current[file.path] = file.isModified
      }
    }
    setDraftContentByPath((prev) => {
      const next: Record<string, string> = {}
      for (const file of openedFiles) {
        const previousDraft = prev[file.path]
        const currentDraft = previousDraft ?? editedContentRef.current[file.path] ?? file.content
        const wasModified = currentDraft !== lastSavedContentRef.current[file.path]
        const savedContentChanged = file.content !== lastSavedContentRef.current[file.path]
        if (savedContentChanged) {
          if (!wasModified) {
            lastSavedContentRef.current[file.path] = file.content
            editedContentRef.current[file.path] = file.content
            modifiedStateRef.current[file.path] = false
            next[file.path] = file.content
            continue
          }
        }
        editedContentRef.current[file.path] = currentDraft
        next[file.path] = currentDraft
        modifiedStateRef.current[file.path] = wasModified || file.isModified
      }
      return next
    })
    // 清理已关闭文件的缓存
    const openPaths = new Set(openedFiles.map((f) => f.path))
    for (const path of Object.keys(editedContentRef.current)) {
      if (!openPaths.has(path)) {
        const timeoutId = autoSaveTimeoutsRef.current[path]
        if (typeof timeoutId === 'number') {
          window.clearTimeout(timeoutId)
          delete autoSaveTimeoutsRef.current[path]
        }
        delete editedContentRef.current[path]
        delete lastSavedContentRef.current[path]
        delete modifiedStateRef.current[path]
      }
    }
  }, [openedFiles])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
      for (const timeoutId of Object.values(autoSaveTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  useEffect(() => {
    if (!tabContextMenu) {
      return
    }

    const closeMenu = () => setTabContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTabContextMenu(null)
      }
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [tabContextMenu])

  useEffect(() => {
    if (!tabContextMenu) {
      return
    }

    const stillOpen = openedFiles.some((file) => file.path === tabContextMenu.path)
    if (!stillOpen) {
      setTabContextMenu(null)
    }
  }, [openedFiles, tabContextMenu])

  const saveFile = useCallback(
    async (path: string) => {
      if (!onSaveFile || isReadOnly) return false

      const contentToSave = editedContentRef.current[path]
      if (contentToSave === undefined || contentToSave === lastSavedContentRef.current[path]) {
        return true
      }

      const pendingTimer = autoSaveTimeoutsRef.current[path]
      if (typeof pendingTimer === 'number') {
        window.clearTimeout(pendingTimer)
        delete autoSaveTimeoutsRef.current[path]
      }

      setSaveFeedback({
        path,
        state: 'saving',
        error: null,
      })

      try {
        const success = await onSaveFile(path, contentToSave)
        if (success) {
          lastSavedContentRef.current[path] = contentToSave
          modifiedStateRef.current[path] = false
          onFileModifiedRef.current?.(path, false)
          setSaveFeedback({
            path,
            state: 'saved',
            error: null,
          })
          if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = window.setTimeout(() => {
            setSaveFeedback((prev) =>
              prev.path === path && prev.state === 'saved'
                ? { ...prev, state: 'idle' }
                : prev,
            )
            saveTimeoutRef.current = null
          }, 2000)
        } else {
          setSaveFeedback({
            path,
            state: 'error',
            error: 'Save failed',
          })
        }
        return success
      } catch (error) {
        setSaveFeedback({
          path,
          state: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        return false
      }
    },
    [isReadOnly, onSaveFile],
  )

  // onChange 立即同步父层脏状态，避免焦点恢复/文件监听期间被旧内容覆盖
  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!activeFilePath) return
      const path = activeFilePath
      editedContentRef.current[path] = newContent
      setDraftContentByPath((prev) =>
        prev[path] === newContent
          ? prev
          : {
              ...prev,
              [path]: newContent,
            },
      )
      const isModified = newContent !== lastSavedContentRef.current[path]

      if (modifiedStateRef.current[path] !== isModified) {
        modifiedStateRef.current[path] = isModified
        onFileModifiedRef.current?.(path, isModified)
      }

      const pendingTimer = autoSaveTimeoutsRef.current[path]
      if (typeof pendingTimer === 'number') {
        window.clearTimeout(pendingTimer)
        delete autoSaveTimeoutsRef.current[path]
      }
      if (autoSaveEnabled && isModified && !isReadOnly) {
        autoSaveTimeoutsRef.current[path] = window.setTimeout(() => {
          void saveFile(path)
        }, autoSaveDelayMs)
      }
    },
    [activeFilePath, autoSaveDelayMs, autoSaveEnabled, isReadOnly, saveFile],
  )

  const handleSave = useCallback(async () => {
    if (!activeFilePath) return
    await saveFile(activeFilePath)
  }, [activeFilePath, saveFile])

  // 检测未保存状态 - 只在用户停止输入后检查
  const checkUnsavedState = useCallback(() => {
    if (!activeFilePath) return
    const isUnsaved = editedContentRef.current[activeFilePath] !== lastSavedContentRef.current[activeFilePath]
    setSaveFeedback((prev) => {
      if (
        prev.path === activeFilePath &&
        (prev.state === 'saving' || prev.state === 'saved' || prev.state === 'error')
      ) {
        return prev
      }
      return {
        path: activeFilePath,
        state: isUnsaved ? 'unsaved' : 'idle',
        error: null,
      }
    })
  }, [activeFilePath])

  // 定期检查未保存状态（每 500ms）
  useEffect(() => {
    if (isReadOnly) return
    const interval = window.setInterval(checkUnsavedState, 500)
    return () => window.clearInterval(interval)
  }, [checkUnsavedState, isReadOnly])

  // 处理 tab 关闭
  const handleCloseTab = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation()
      onCloseFile(path)
    },
    [onCloseFile]
  )

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      // ignore clipboard failures to keep the interaction lightweight
    }
    setTabContextMenu(null)
  }, [])

  const handleCopyFullPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(resolveWorkspaceAbsolutePath(workspaceRoot, path))
    } catch {
      // ignore clipboard failures to keep the interaction lightweight
    }
    setTabContextMenu(null)
  }, [workspaceRoot])

  const handleRevealInExplorer = useCallback(async (path: string) => {
    if (!workspaceId) {
      return
    }
    try {
      await desktopApi.fsShowInFolder(workspaceId, path)
    } catch {
      // keep this lightweight; file tree already surfaces reveal failures explicitly
    }
    setTabContextMenu(null)
  }, [workspaceId])

  const closeMultipleTabs = useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        onCloseFile(path)
      }
      setTabContextMenu(null)
    },
    [onCloseFile],
  )

  const handleTabContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, path: string) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectFile(path)
    setTabContextMenu({
      x: event.clientX,
      y: event.clientY,
      path,
    })
  }, [onSelectFile])

  // 处理鼠标滚轮水平滚动
  const handleTabsWheel = useCallback((e: React.WheelEvent) => {
    if (tabsContainerRef.current && e.deltaY !== 0) {
      e.preventDefault()
      tabsContainerRef.current.scrollLeft += e.deltaY
    }
  }, [])

  const setTabRef = useCallback((path: string, node: HTMLDivElement | null) => {
    if (node) {
      tabRefs.current[path] = node
      return
    }
    delete tabRefs.current[path]
  }, [])

  const scrollActiveTabIntoView = useCallback(() => {
    if (!activeFilePath) {
      return false
    }

    const container = tabsContainerRef.current
    const activeTab = tabRefs.current[activeFilePath]
    if (!container || !activeTab) {
      return false
    }

    const containerRect = container.getBoundingClientRect()
    const activeTabRect = activeTab.getBoundingClientRect()
    const gap = 8
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (activeTabRect.left < containerRect.left) {
      const delta = containerRect.left - activeTabRect.left + gap
      container.scrollTo({
        left: Math.max(0, container.scrollLeft - delta),
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
      return true
    }

    if (activeTabRect.right > containerRect.right) {
      const delta = activeTabRect.right - containerRect.right + gap
      container.scrollTo({
        left: container.scrollLeft + delta,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
      return true
    }

    return true
  }, [activeFilePath])

  useEffect(() => {
    if (!activeFilePath) {
      return
    }

    let attempt = 0
    let frameId = 0

    const settleScroll = () => {
      const settled = scrollActiveTabIntoView()
      if (settled || attempt >= 5) {
        return
      }
      attempt += 1
      frameId = window.requestAnimationFrame(settleScroll)
    }

    frameId = window.requestAnimationFrame(settleScroll)
    return () => window.cancelAnimationFrame(frameId)
  }, [activeFilePath, openFilePathsKey, scrollActiveTabIntoView])

  const hasOpenedFiles = openedFiles.length > 0
  const activeContent =
    activeFilePath && activeFile
      ? (draftContentByPath[activeFilePath] ?? activeFile.content)
      : ''
  const tabContextMenuItems = useMemo(() => {
    if (!tabContextMenu) {
      return []
    }

    const targetPath = tabContextMenu.path
    const targetIndex = openedFiles.findIndex((file) => file.path === targetPath)
    const otherPaths = openedFiles.filter((file) => file.path !== targetPath).map((file) => file.path)
    const rightPaths =
      targetIndex >= 0 ? openedFiles.slice(targetIndex + 1).map((file) => file.path) : []
    const allPaths = openedFiles.map((file) => file.path)

    return [
      {
        id: 'copy-path' as const,
        label: t(locale, 'fileTab.copyPath'),
        icon: 'link' as const,
        disabled: false,
      },
      {
        id: 'copy-full-path' as const,
        label: t(locale, 'fileTab.copyFullPath'),
        icon: 'copy' as const,
        disabled: false,
      },
      {
        id: 'reveal' as const,
        label: t(locale, 'fileTab.revealInExplorer'),
        icon: 'external' as const,
        disabled: false,
      },
      {
        id: 'close' as const,
        label: t(locale, 'fileTab.close'),
        icon: 'close' as const,
        disabled: false,
      },
      {
        id: 'close-others' as const,
        label: t(locale, 'fileTab.closeOthers'),
        icon: 'panel-right-close' as const,
        disabled: otherPaths.length === 0,
      },
      {
        id: 'close-to-right' as const,
        label: t(locale, 'fileTab.closeToRight'),
        icon: 'panel-right-open' as const,
        disabled: rightPaths.length === 0,
      },
      {
        id: 'close-all' as const,
        label: t(locale, 'fileTab.closeAll'),
        icon: 'trash' as const,
        disabled: allPaths.length === 0,
      },
    ]
  }, [locale, openedFiles, tabContextMenu])

  const handleTabContextAction = useCallback(
    (actionId: TabContextActionId) => {
      if (!tabContextMenu) {
        return
      }

      const targetPath = tabContextMenu.path
      switch (actionId) {
        case 'copy-path':
          void handleCopyPath(targetPath)
          return
        case 'copy-full-path':
          void handleCopyFullPath(targetPath)
          return
        case 'reveal':
          void handleRevealInExplorer(targetPath)
          return
        case 'close':
          onCloseFile(targetPath)
          setTabContextMenu(null)
          return
        case 'close-others':
          closeMultipleTabs(openedFiles.filter((file) => file.path !== targetPath).map((file) => file.path))
          return
        case 'close-to-right': {
          const targetIndex = openedFiles.findIndex((file) => file.path === targetPath)
          if (targetIndex >= 0) {
            closeMultipleTabs(openedFiles.slice(targetIndex + 1).map((file) => file.path))
          }
          return
        }
        case 'close-all':
          closeMultipleTabs(openedFiles.map((file) => file.path))
          return
      }
    },
    [closeMultipleTabs, handleCopyFullPath, handleCopyPath, handleRevealInExplorer, onCloseFile, openedFiles, tabContextMenu],
  )

  return (
    <section className="panel file-editor-pane">
      {hasOpenedFiles && (
        <div className="file-editor-tabs-wrapper">
          <div
            ref={tabsContainerRef}
            className="file-editor-tabs"
            onWheel={handleTabsWheel}
          >
            {openedFiles.map((file) => (
              <FileTab
                key={file.path}
                file={file}
                isActive={file.path === activeFilePath}
                tabRef={(node) => setTabRef(file.path, node)}
                onSelect={() => onSelectFile(file.path)}
                onClose={(e) => handleCloseTab(e, file.path)}
                onContextMenu={(event) => handleTabContextMenu(event, file.path)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 文件状态 */}
      {activeFilePath && (
        <div className="file-editor-info-bar">
          <span className="file-editor-mini-path" title={activeFilePath}>
            {activeFilePath}
          </span>
          <div className="file-editor-status-group">
            {isStaleFile ? (
              <span className="file-editor-status file-editor-status-stale">
                {t(locale, 'fileContent.fileChangedOnDisk')}
              </span>
            ) : null}
            {isReadOnly ? (
              <span className="file-editor-status file-editor-status-readonly">
                {isLargeFile ? t(locale, 'fileContent.readOnlyLargeFile') : t(locale, 'fileContent.readOnly')}
              </span>
            ) : visibleSaveState === 'saving' ? (
              <span className="file-editor-status file-editor-status-saving">{t(locale, 'fileContent.saving')}</span>
            ) : visibleSaveState === 'saved' ? (
              <span className="file-editor-status file-editor-status-saved">{t(locale, 'fileContent.saved')}</span>
            ) : visibleSaveState === 'error' ? (
              <span className="file-editor-status file-editor-status-error">
                {t(locale, 'fileContent.saveFailed', { detail: visibleSaveError ?? 'Unknown' })}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {!workspaceId && <p className="file-editor-hint">{t(locale, 'fileContent.bindWorkspace')}</p>}
      {workspaceId && !hasOpenedFiles && <p className="file-editor-hint">{t(locale, 'fileContent.selectFileHint')}</p>}
      {loading && <p className="file-editor-loading">{t(locale, 'fileContent.loading')}</p>}

      {noticeMessage && (
        <p className="file-content-notice">{t(locale, 'fileContent.previewNotice', { detail: noticeMessage })}</p>
      )}

      {errorMessage && <p className="file-content-error">{errorMessage}</p>}

      {activeFile && !loading && !errorMessage && (isPreviewFile || canRenderContent) && (
        <div className={`file-editor-content ${isMarkdown ? 'file-editor-content--markdown' : ''}`}>
          {isMarkdown ? (
            <div className="file-editor-toolbar">
              <MarkdownModeToggle locale={locale} mode={viewMode} onChange={setViewMode} />
            </div>
          ) : null}
          {isPreviewFile ? (
            <FilePreviewPane
              locale={locale}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              filePath={activeFile.path}
              fileSize={activeFile.size}
            />
          ) : isMarkdown && viewMode === 'preview' ? (
            // Pure preview mode
            <div className="markdown-preview-pane">
              <div className="markdown-preview-content">
                <MarkdownRenderer
                  content={activeContent}
                  filePath={activeFile.path}
                  workspaceRoot={workspaceRoot}
                />
              </div>
            </div>
          ) : isMarkdown && viewMode === 'split' ? (
            // Split mode
              <MarkdownSplitView
              locale={locale}
              content={activeContent}
              filePath={activeFile.path}
              workspaceRoot={workspaceRoot}
              readOnly={isReadOnly}
              onChange={handleContentChange}
              onSave={handleSave}
            />
          ) : (
            // Edit mode (including non-markdown files)
              <MemoizedEditor
              locale={locale}
              content={activeContent}
              filePath={activeFile.path}
              readOnly={isReadOnly}
              onChange={handleContentChange}
              onSave={handleSave}
              commandRequest={editorCommandRequest}
            />
          )}
        </div>
      )}

      {tabContextMenu
        ? createPortal(
            <div
              className="tree-context-menu file-editor-tab-context-menu"
              role="menu"
              aria-label={getFileName(tabContextMenu.path)}
              style={{
                left: `${Math.min(tabContextMenu.x, window.innerWidth - 220)}px`,
                top: `${Math.min(tabContextMenu.y, window.innerHeight - 320)}px`,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {tabContextMenuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={item.disabled ? 'disabled' : undefined}
                  onClick={() => handleTabContextAction(item.id)}
                >
                  <AppIcon name={item.icon} className="context-menu-icon" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
