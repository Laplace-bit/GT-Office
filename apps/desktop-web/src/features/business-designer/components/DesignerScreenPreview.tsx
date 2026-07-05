import { useCallback, useRef, useState } from 'react'

interface DesignerScreenPreviewProps {
  html: string
  /** A-layer hook: invoked when the user selects an element. B-layer wires the
   * actual AI optimization conversation; for now it captures the fragment. */
  onSelectElement?: (fragment: { outerHtml: string; selector: string }) => void
}

/**
 * Renders a `uiScreen` block's HTML in a sandboxed iframe (`srcdoc`) and
 * overlays an annotation layer: clicking an element captures its outerHTML +
 * a CSS selector path. This is the A-layer hook; the B-layer conversation
 * (sub-project B) consumes the captured fragment.
 */
export function DesignerScreenPreview({ html, onSelectElement }: DesignerScreenPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null)

  const attachOverlay = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentDocument) {
      return
    }
    const doc = iframe.contentDocument
    const handler = (event: MouseEvent) => {
      if (!annotating) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const target = event.target as HTMLElement
      if (!target || target === doc.body) {
        return
      }
      const outerHtml = target.outerHTML
      const selector = buildSelector(target)
      setSelectedHtml(outerHtml)
      onSelectElement?.({ outerHtml, selector })
    }
    doc.addEventListener('click', handler, true)
    return () => doc.removeEventListener('click', handler, true)
  }, [annotating, onSelectElement])

  const onLoad = useCallback(() => {
    attachOverlay()
  }, [attachOverlay])

  return (
    <div className="designer-screen-preview">
      <div className="designer-screen-preview__toolbar">
        <button
          type="button"
          className="designer-screen-preview__toggle"
          aria-pressed={annotating}
          onClick={() => setAnnotating((v) => !v)}
        >
          {annotating ? '退出注释' : '注释模式'}
        </button>
        {selectedHtml && (
          <span className="designer-screen-preview__hint">已选中元素（{selectedHtml.length} 字符）</span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        className="designer-screen-preview__iframe"
        sandbox="allow-same-origin"
        srcDoc={html}
        title="UI 预览"
        onLoad={onLoad}
      />
    </div>
  )
}

function buildSelector(el: HTMLElement): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && node.nodeType === 1) {
    const part = node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '')
    parts.unshift(part)
    node = node.parentElement
    if (parts.length > 8) {
      break
    }
  }
  return parts.join(' > ')
}
