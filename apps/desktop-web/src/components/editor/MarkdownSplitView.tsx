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
    // Monaco uses .monaco-scrollable-element > .scrollable-element as its scroll container
    const editorScroller = editorContainerRef.current?.querySelector<HTMLElement>(
      '.monaco-scrollable-element .scrollable-element',
    ) ?? editorContainerRef.current?.querySelector<HTMLElement>('.monaco-editor .scrollable-element')
    const previewScroller = previewRef.current
    if (!editorScroller || !previewScroller) {
      return
    }

    const handleEditorScroll = () => syncScrollPosition(editorScroller, previewScroller, 'editor')
    const handlePreviewScroll = () => syncScrollPosition(previewScroller, editorScroller, 'preview')

    editorScroller.addEventListener('scroll', handleEditorScroll)
    previewScroller.addEventListener('scroll', handlePreviewScroll)
    return () => {
      editorScroller.removeEventListener('scroll', handleEditorScroll)
      previewScroller.removeEventListener('scroll', handlePreviewScroll)
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