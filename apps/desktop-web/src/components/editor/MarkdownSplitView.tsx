import { useMemo, useRef, useCallback } from 'react'
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
  const previewRef = useRef<HTMLDivElement>(null)

  // Sync scroll from editor to preview
  const handleEditorScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!previewRef.current) return

    const target = e.target as HTMLDivElement
    const scrollRatio = target.scrollTop / (target.scrollHeight - target.clientHeight)
    const previewScrollHeight = previewRef.current.scrollHeight - previewRef.current.clientHeight

    previewRef.current.scrollTop = scrollRatio * previewScrollHeight
  }, [])

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
      <div className="markdown-split-editor" onScroll={handleEditorScroll}>
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