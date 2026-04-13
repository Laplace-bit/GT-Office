import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import {
  CodeMirrorEditor,
  MarkdownRenderer,
  MarkdownSplitView,
  type CodeEditorCommandRequest,
  type MarkdownViewMode,
} from '@/components/editor'
import { FilePreviewPane } from '@features/file-preview'
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
}

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

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
  CodeMirrorEditor,
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
}: {
  file: OpenedFile
  isActive: boolean
  tabRef?: (node: HTMLDivElement | null) => void
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  const visual = resolveFileVisual(file.path, 'file')
  const TabIcon = visual.icon

  return (
    <div
      ref={tabRef}
      className={`file-editor-tab ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      title={file.path}
    >
      <span className="file-editor-tab-name">
        <span className={`file-editor-tab-icon file-editor-tab-icon--${visual.kind}`}>
          <TabIcon className="vb-icon" aria-hidden="true" />
        </span>
        <span className="file-editor-tab-label">{getFileName(file.path)}</span>
        {file.isModified && <span className="file-editor-tab-modified" />}
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
}: FileEditorPaneProps) {
  const editedContentRef = useRef<Record<string, string>>({})
  const lastSavedContentRef = useRef<Record<string, string>>({})
  const modifiedStateRef = useRef<Record<string, boolean>>({})
  const saveTimeoutRef = useRef<number | null>(null)
  const modifyDebounceRef = useRef<number | null>(null)
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
        next[file.path] = prev[file.path] ?? file.content
      }
      return next
    })
    // 清理已关闭文件的缓存
    const openPaths = new Set(openedFiles.map((f) => f.path))
    for (const path of Object.keys(editedContentRef.current)) {
      if (!openPaths.has(path)) {
        delete editedContentRef.current[path]
        delete lastSavedContentRef.current[path]
        delete modifiedStateRef.current[path]
      }
    }
  }, [openedFiles])

  // 文件内容更新时同步（外部更新）
  useEffect(() => {
    if (activeFile && activeFile.content !== lastSavedContentRef.current[activeFile.path]) {
      editedContentRef.current[activeFile.path] = activeFile.content
      lastSavedContentRef.current[activeFile.path] = activeFile.content
      modifiedStateRef.current[activeFile.path] = false
      setDraftContentByPath((prev) => ({
        ...prev,
        [activeFile.path]: activeFile.content,
      }))
    }
  }, [activeFile])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
      if (modifyDebounceRef.current) window.clearTimeout(modifyDebounceRef.current)
    }
  }, [])

  // onChange 只更新 ref，使用防抖通知父组件
  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!activeFilePath) return
      editedContentRef.current[activeFilePath] = newContent
      setDraftContentByPath((prev) =>
        prev[activeFilePath] === newContent
          ? prev
          : {
              ...prev,
              [activeFilePath]: newContent,
            },
      )
      const isModified = newContent !== lastSavedContentRef.current[activeFilePath]

      // 只在状态变化时通知父组件，使用防抖
      if (modifiedStateRef.current[activeFilePath] !== isModified) {
        modifiedStateRef.current[activeFilePath] = isModified
        if (modifyDebounceRef.current) window.clearTimeout(modifyDebounceRef.current)
        modifyDebounceRef.current = window.setTimeout(() => {
          onFileModifiedRef.current?.(activeFilePath, isModified)
          modifyDebounceRef.current = null
        }, 100)
      }
    },
    [activeFilePath]
  )

  // 保存时检查是否有变化，并更新状态
  const handleSave = useCallback(async () => {
    if (!onSaveFile || isReadOnly || !activeFilePath) return

    const contentToSave = editedContentRef.current[activeFilePath]
    if (contentToSave === lastSavedContentRef.current[activeFilePath]) return

    setSaveFeedback({
      path: activeFilePath,
      state: 'saving',
      error: null,
    })

    try {
      const success = await onSaveFile(activeFilePath, contentToSave)
      if (success) {
        lastSavedContentRef.current[activeFilePath] = contentToSave
        modifiedStateRef.current[activeFilePath] = false
        onFileModifiedRef.current?.(activeFilePath, false)
        setSaveFeedback({
          path: activeFilePath,
          state: 'saved',
          error: null,
        })
        if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = window.setTimeout(() => {
          setSaveFeedback((prev) =>
            prev.path === activeFilePath && prev.state === 'saved'
              ? { ...prev, state: 'idle' }
              : prev,
          )
          saveTimeoutRef.current = null
        }, 2000)
      } else {
        setSaveFeedback({
          path: activeFilePath,
          state: 'error',
          error: 'Save failed',
        })
      }
    } catch (error) {
      setSaveFeedback({
        path: activeFilePath,
        state: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [activeFilePath, isReadOnly, onSaveFile])

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
    </section>
  )
}
