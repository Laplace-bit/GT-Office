import { useState, useCallback } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { PreviewProgress } from '../components/PreviewProgress'
import { PreviewError } from '../components/PreviewError'
import { PREVIEW_LIMITS } from '../utils/file-type-utils'
import './ImagePreviewer.scss'

interface ImagePreviewerProps {
  locale: Locale
  filePath: string
  fileSize: number
  onOpenExternal?: () => void
}

interface ControlsProps {
  locale: Locale
}

function Controls({ locale }: ControlsProps) {
  const { zoomIn, zoomOut, resetTransform } = useControls()

  return (
    <>
      <button
        type="button"
        className="image-previewer-btn"
        onClick={() => zoomIn()}
        title={t(locale, 'image.zoomIn')}
        aria-label={t(locale, 'image.zoomIn')}
      >
        <ZoomIn className="image-previewer-btn-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="image-previewer-btn"
        onClick={() => zoomOut()}
        title={t(locale, 'image.zoomOut')}
        aria-label={t(locale, 'image.zoomOut')}
      >
        <ZoomOut className="image-previewer-btn-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="image-previewer-btn"
        onClick={() => resetTransform()}
        title={t(locale, 'image.fitWindow')}
        aria-label={t(locale, 'image.fitWindow')}
      >
        <Maximize2 className="image-previewer-btn-icon" aria-hidden="true" />
      </button>
    </>
  )
}

export function ImagePreviewer({
  locale,
  filePath,
  fileSize,
  onOpenExternal,
}: ImagePreviewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isTooLarge = fileSize > PREVIEW_LIMITS.image.maxInlineSize
  const src = convertFileSrc(filePath)

  const handleLoad = useCallback(() => {
    setLoading(false)
  }, [])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(t(locale, 'preview.error.loadFailed'))
  }, [locale])

  if (isTooLarge) {
    return (
      <PreviewError
        locale={locale}
        type="too-large"
        onOpenExternal={onOpenExternal}
      />
    )
  }

  return (
    <div className="image-previewer">
      {/* 图片容器 */}
      <div className="image-previewer-content">
        {loading && <PreviewProgress locale={locale} />}
        {error && (
          <PreviewError
            locale={locale}
            type="load-failed"
            message={error}
            onOpenExternal={onOpenExternal}
          />
        )}
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={5}
          centerOnInit
        >
          <div className="image-previewer-controls">
            <Controls locale={locale} />
          </div>
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={src}
              alt=""
              className="image-previewer-img"
              onLoad={handleLoad}
              onError={handleError}
              style={{ display: loading || error ? 'none' : 'block' }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  )
}