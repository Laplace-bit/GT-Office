import { useMemo, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Locale } from '@shell/i18n/ui-locale'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import './MarkdownSplitView.scss'

// Import code highlighting styles
import 'highlight.js/styles/github-dark.css'

export type MarkdownViewMode = 'edit' | 'preview' | 'split'

interface MarkdownSplitViewProps {
  locale: Locale
  content: string
  filePath: string
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

export function MarkdownSplitView({
  locale,
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
}: MarkdownSplitViewProps) {
  const editorRef = useRef<HTMLDivElement>(null)
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
    const editorScroller = editorRef.current?.querySelector<HTMLElement>('.cm-scroller')
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

  // Markdown rendering configuration
  const markdownComponents = useMemo(
    () => ({
      // Custom link rendering - open external links in new window
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
        return (
          <a
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
          >
            {children}
          </a>
        )
      },
      // Image rendering
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <img src={src} alt={alt} loading="lazy" />
      ),
    }),
    []
  )

  return (
    <div className="markdown-split-view">
      {/* Editor panel */}
      <div ref={editorRef} className="markdown-split-editor">
        <CodeMirrorEditor
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
