import { useRef, useCallback, useEffect } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { MonacoEditor } from './MonacoEditor'
import { MarkdownRenderer } from './MarkdownRenderer'
import './MarkdownSplitView.scss'

// Import code highlighting styles for markdown preview
import 'highlight.js/styles/github-dark.css'

export type MarkdownViewMode = 'edit' | 'preview' | 'split'

interface MarkdownSplitViewProps {
  locale: Locale
  content: string
  filePath: string
  workspaceRoot: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

export function MarkdownSplitView({
  locale,
  content,
  filePath,
  workspaceRoot,
  readOnly = false,
  onChange,
  onSave,
}: MarkdownSplitViewProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const syncingPaneRef = useRef<'editor' | 'preview' | null>(null)

  const syncScrollPosition = useCallback(
    (source: HTMLElement, target: HTMLElement, sourcePane: 'editor' | 'preview') => {
      if (syncingPaneRef.current && syncingPaneRef.current !== sourcePane) {
        return
      }
      const sourceScrollable = source.scrollHeight - source.clientHeight
      const targetScrollable = target.scrollHeight - target.clientHeight
      if (sourceScrollable <= 0 || targetScrollable <= 0) {
        return
      }
      syncingPaneRef.current = sourcePane
      const ratio = source.scrollTop / sourceScrollable
      target.scrollTop = ratio * targetScrollable
      window.requestAnimationFrame(() => {
        if (syncingPaneRef.current === sourcePane) {
          syncingPaneRef.current = null
        }
      })
    },
    [],
  )

  useEffect(() => {
    // Monaco's scroll container is created asynchronously, so we retry until it appears
    const editorContainer = editorContainerRef.current
    const previewScroller = previewRef.current
    if (!editorContainer || !previewScroller) {
      return
    }

    let editorScroller: HTMLElement | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const attachScrollListeners = () => {
      editorScroller = editorContainer.querySelector<HTMLElement>(
        '.monaco-scrollable-element .scrollable-element',
      ) ?? editorContainer.querySelector<HTMLElement>('.monaco-editor .scrollable-element')

      if (!editorScroller) {
        // Monaco DOM not ready yet — retry after a short delay
        retryTimer = setTimeout(attachScrollListeners, 100)
        return
      }

      const handleEditorScroll = () => syncScrollPosition(editorScroller!, previewScroller, 'editor')
      const handlePreviewScroll = () => syncScrollPosition(previewScroller, editorScroller!, 'preview')

      editorScroller.addEventListener('scroll', handleEditorScroll)
      previewScroller.addEventListener('scroll', handlePreviewScroll)
      cleanup = () => {
        editorScroller!.removeEventListener('scroll', handleEditorScroll)
        previewScroller.removeEventListener('scroll', handlePreviewScroll)
      }
    }

    let cleanup: () => void = () => {}
    attachScrollListeners()

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      cleanup()
    }
  }, [syncScrollPosition, content, filePath])

  return (
    <div className="markdown-split-view">
      {/* Editor panel */}
      <div ref={editorContainerRef} className="markdown-split-editor">
        <MonacoEditor
          locale={locale}
          content={content}
          filePath={filePath}
          readOnly={readOnly}
          onChange={onChange}
          onSave={onSave}
        />
      </div>

      {/* Divider */}
      <div className="markdown-split-divider" />

      {/* Preview panel */}
      <div ref={previewRef} className="markdown-split-preview">
        <div className="markdown-preview-content">
          <MarkdownRenderer content={content} filePath={filePath} workspaceRoot={workspaceRoot} />
        </div>
      </div>
    </div>
  )
}