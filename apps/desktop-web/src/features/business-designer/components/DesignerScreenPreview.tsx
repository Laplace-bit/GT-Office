import { useEffect, useRef, useState } from 'react'
import type { Locale } from '../../../shell/i18n/ui-locale'
import { t } from '../../../shell/i18n/ui-locale'

interface DesignerScreenPreviewProps {
  html: string
  locale: Locale
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
export function DesignerScreenPreview({ html, locale, onSelectElement }: DesignerScreenPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null)

  useEffect(() => {
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

    return () => {
      doc.removeEventListener('click', handler, true)
    }
  }, [annotating, html, onSelectElement])

  return (
    <div className="designer-screen-preview">
      <div className="designer-screen-preview__toolbar">
        <button
          type="button"
          className="designer-screen-preview__toggle"
          aria-pressed={annotating}
          onClick={() => setAnnotating((v) => !v)}
        >
          {annotating
            ? t(locale, 'designer.screenPreview.exitAnnotation')
            : t(locale, 'designer.screenPreview.annotationMode')}
        </button>
        {selectedHtml && (
          <span className="designer-screen-preview__hint">
            {t(locale, 'designer.screenPreview.selectedElement', { count: String(selectedHtml.length) })}
          </span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        className="designer-screen-preview__iframe"
        sandbox="allow-same-origin"
        srcDoc={html}
        title={t(locale, 'designer.screenPreview.uiPreview')}
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
