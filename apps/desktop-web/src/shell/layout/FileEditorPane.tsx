import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import {
  CodeMirrorEditor,
  type CodeEditorCommandRequest,
} from './CodeMirrorEditor'

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
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const onFileModifiedRef = useRef(onFileModified)
  onFileModifiedRef.current = onFileModified

  const activeFile = openedFiles.find((f) => f.path === activeFilePath)
  const isLargeFile = (activeFile?.size ?? 0) > LARGE_FILE_THRESHOLD_BYTES
  const isReadOnly = isLargeFile || !onSaveFile

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

  // 文件切换时重置保存状态
  useEffect(() => {
    setSaveState('idle')
    setSaveError(null)
  }, [activeFilePath])

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

    setSaveState('saving')
    setSaveError(null)

    try {
      const success = await onSaveFile(activeFilePath, contentToSave)
      if (success) {
        lastSavedContentRef.current[activeFilePath] = contentToSave
        modifiedStateRef.current[activeFilePath] = false
        onFileModifiedRef.current?.(activeFilePath, false)
        setSaveState('saved')
        if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = window.setTimeout(() => {
          setSaveState((prev) => (prev === 'saved' ? 'idle' : prev))
          saveTimeoutRef.current = null
        }, 2000)
      } else {
        setSaveState('error')
        setSaveError('Save failed')
      }
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'Unknown error')
    }
  }, [activeFilePath, isReadOnly, onSaveFile])

  // 检测未保存状态 - 只在用户停止输入后检查
  const checkUnsavedState = useCallback(() => {
    if (!activeFilePath) return
    const isUnsaved = editedContentRef.current[activeFilePath] !== lastSavedContentRef.current[activeFilePath]
    setSaveState((prev) => {
      if (prev === 'saving' || prev === 'saved' || prev === 'error') return prev
      return isUnsaved ? 'unsaved' : 'idle'
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
      {/* Tab 栏 */}
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

      {/* 文件路径和状态 */}
      {activeFilePath && (
        <div className="file-editor-info-bar">
          {isReadOnly ? (
            <span className="file-editor-status file-editor-status-readonly">
              {isLargeFile ? t(locale, 'fileContent.readOnlyLargeFile') : t(locale, 'fileContent.readOnly')}
            </span>
          ) : saveState === 'saving' ? (
            <span className="file-editor-status file-editor-status-saving">{t(locale, 'fileContent.saving')}</span>
          ) : saveState === 'saved' ? (
            <span className="file-editor-status file-editor-status-saved">{t(locale, 'fileContent.saved')}</span>
          ) : saveState === 'error' ? (
            <span className="file-editor-status file-editor-status-error">
              {t(locale, 'fileContent.saveFailed', { detail: saveError ?? 'Unknown' })}
            </span>
          ) : saveState === 'unsaved' ? (
            <span className="file-editor-status file-editor-status-unsaved">{t(locale, 'fileContent.unsaved')}</span>
          ) : null}
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
