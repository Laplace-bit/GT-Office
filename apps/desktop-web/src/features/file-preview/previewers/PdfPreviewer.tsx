import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'
import { PreviewError } from '../components/PreviewError'
import { PreviewProgress } from '../components/PreviewProgress'
import { PREVIEW_LIMITS } from '../utils/file-type-utils'
import './PdfPreviewer.scss'

interface PdfPreviewerProps {
  locale: Locale
  filePath: string
  fileSize: number
  onOpenExternal?: () => void
}

const MIN_SCALE = 0.75
const MAX_SCALE = 2
const SCALE_STEP = 0.25

export function PdfPreviewer({ locale, filePath, fileSize, onOpenExternal }: PdfPreviewerProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [imageData, setImageData] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isTooLarge = fileSize > PREVIEW_LIMITS.pdf.maxInlineSize

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPageCount(null)
    setPageIndex(0)

    void desktopApi
      .fsPdfGetInfo(filePath)
      .then((info) => {
        if (cancelled) return
        setPageCount(info.pageCount)
      })
      .catch((reason) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message || t(locale, 'preview.error.loadFailed'))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [filePath, locale])

  useEffect(() => {
    let cancelled = false
    if (pageCount === null) {
      return
    }
    setLoading(true)
    setError(null)

    void desktopApi
      .fsPdfRenderPage(filePath, pageIndex, scale)
      .then((page) => {
        if (cancelled) return
        setImageData(`data:image/png;base64,${page.imageData}`)
        setLoading(false)
      })
      .catch((reason) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message || t(locale, 'preview.error.loadFailed'))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [filePath, locale, pageCount, pageIndex, scale])

  const pageLabel = useMemo(() => {
    if (pageCount === null) {
      return '...'
    }
    return `${pageIndex + 1} / ${pageCount}`
  }, [pageCount, pageIndex])

  const canGoPrev = pageIndex > 0
  const canGoNext = pageCount !== null && pageIndex < pageCount - 1

  const handlePrev = useCallback(() => {
    setPageIndex((current) => Math.max(0, current - 1))
  }, [])

  const handleNext = useCallback(() => {
    setPageIndex((current) => (pageCount === null ? current : Math.min(pageCount - 1, current + 1)))
  }, [pageCount])

  const handleZoomOut = useCallback(() => {
    setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))
  }, [])

  const handleZoomIn = useCallback(() => {
    setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))
  }, [])

  if (isTooLarge) {
    return <PreviewError locale={locale} type="too-large" onOpenExternal={onOpenExternal} />
  }

  if (error) {
    return (
      <PreviewError
        locale={locale}
        type="load-failed"
        message={`${t(locale, 'preview.error.loadFailed')}: ${error}`}
        onOpenExternal={onOpenExternal}
      />
    )
  }

  return (
    <div className="pdf-previewer">
      <div className="pdf-previewer-toolbar">
        <div className="pdf-previewer-group">
          <button
            type="button"
            className="pdf-previewer-btn"
            onClick={handlePrev}
            disabled={!canGoPrev}
            aria-label={t(locale, 'pdf.prevPage')}
            title={t(locale, 'pdf.prevPage')}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span className="pdf-previewer-page">{t(locale, 'pdf.pageStatus', { detail: pageLabel })}</span>
          <button
            type="button"
            className="pdf-previewer-btn"
            onClick={handleNext}
            disabled={!canGoNext}
            aria-label={t(locale, 'pdf.nextPage')}
            title={t(locale, 'pdf.nextPage')}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <div className="pdf-previewer-group">
          <button
            type="button"
            className="pdf-previewer-btn"
            onClick={handleZoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label={t(locale, 'pdf.zoomOut')}
            title={t(locale, 'pdf.zoomOut')}
          >
            <ZoomOut aria-hidden="true" />
          </button>
          <span className="pdf-previewer-zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="pdf-previewer-btn"
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label={t(locale, 'pdf.zoomIn')}
            title={t(locale, 'pdf.zoomIn')}
          >
            <ZoomIn aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="pdf-previewer-canvas">
        {loading ? <PreviewProgress locale={locale} /> : null}
        {imageData ? <img src={imageData} alt="" className="pdf-previewer-image" /> : null}
      </div>
    </div>
  )
}
