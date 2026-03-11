import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import {
  CodeMirrorEditor,
  type CodeEditorCommandRequest,
} from '@/components/editor'
import './FileEditorPane.scss'

const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024

export interface OpenedFile {
  path: string
  content: string
  size: number
  isModified: boolean
}

interface FileEditorPaneProps {
  locale: Locale
  workspaceId: string | null
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

// Memoized editor - 完全隔离，不会因父组件状态变化而重渲染
const MemoizedEditor = memo(
  CodeMirrorEditor,
  (prev, next) =>
    prev.content === next.content &&
    prev.filePath === next.filePath &&
    prev.readOnly === next.readOnly
)

function getFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// Memoized Tab 组件
const FileTab = memo(function FileTab({
  file,
  isActive,
  onSelect,
  onClose,
}: {
  file: OpenedFile
  isActive: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={`file-editor-tab ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      title={file.path}
    >
      <span className="file-editor-tab-name">
        {file.isModified && <span className="file-editor-tab-modified">*</span>}
        {getFileName(file.path)}
      </span>
      <button
        type="button"
        className="file-editor-tab-close"
        onClick={onClose}
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
})

export function FileEditorPane({
  locale,
  workspaceId,
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
  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const onFileModifiedRef = useRef(onFileModified)

  useEffect(() => {
    onFileModifiedRef.current = onFileModified
  }, [onFileModified])

  const activeFile = openedFiles.find((f) => f.path === activeFilePath)
  const isLargeFile = (activeFile?.size ?? 0) > LARGE_FILE_THRESHOLD_BYTES
  const isReadOnly = isLargeFile || !onSaveFile
  const visibleSaveState = saveFeedback.path === activeFilePath ? saveFeedback.state : 'idle'
  const visibleSaveError = saveFeedback.path === activeFilePath ? saveFeedback.error : null

  // 初始化编辑内容缓存
  useEffect(() => {
    for (const file of openedFiles) {
      if (!(file.path in editedContentRef.current)) {
        editedContentRef.current[file.path] = file.content
        lastSavedContentRef.current[file.path] = file.content
        modifiedStateRef.current[file.path] = file.isModified
      }
    }
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

  const hasOpenedFiles = openedFiles.length > 0
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
            {getFileName(activeFilePath)}
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

      {activeFile && !loading && !errorMessage && canRenderContent && (
        <div className="file-editor-content">
          <MemoizedEditor
            locale={locale}
            content={activeFile.content}
            filePath={activeFile.path}
            readOnly={isReadOnly}
            onChange={handleContentChange}
            onSave={handleSave}
            commandRequest={editorCommandRequest}
          />
        </div>
      )}
    </section>
  )
}
