import { useCallback, useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { PreviewError } from '../components/PreviewError'
import { PreviewProgress } from '../components/PreviewProgress'
import { PREVIEW_LIMITS } from '../utils/file-type-utils'
import { resolveMediaPreviewPath } from './media-preview-path'
import './VideoPreviewer.scss'

interface VideoPreviewerProps {
  locale: Locale
  workspaceRoot: string | null
  filePath: string
  fileSize: number
  onOpenExternal?: () => void
}

function safeConvertFileSrc(filePath: string): string | null {
  try {
    return convertFileSrc(filePath)
  } catch {
    return null
  }
}

export function VideoPreviewer({
  locale,
  workspaceRoot,
  filePath,
  fileSize,
  onOpenExternal,
}: VideoPreviewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isTooLarge = fileSize > PREVIEW_LIMITS.video.maxInlineSize
  const resolvedPath = resolveMediaPreviewPath(workspaceRoot, filePath)
  const src = resolvedPath ? safeConvertFileSrc(resolvedPath) : null

  useEffect(() => {
    setLoading(true)
    setError(null)
  }, [src])

  if (!resolvedPath) {
    return <PreviewProgress locale={locale} />
  }

  if (!src) {
    return (
      <PreviewError
        locale={locale}
        type="load-failed"
        message={t(locale, 'preview.error.invalidPath')}
        onOpenExternal={onOpenExternal}
      />
    )
  }

  const handleLoadedMetadata = useCallback(() => {
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
    <div className="video-previewer">
      {loading && <PreviewProgress locale={locale} />}
      {error && (
        <PreviewError
          locale={locale}
          type="load-failed"
          message={error}
          onOpenExternal={onOpenExternal}
        />
      )}
      <video
        key={src}
        className="video-previewer-player"
        controls
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
        style={{ display: loading || error ? 'none' : 'block' }}
      >
        <source src={src} />
        {/* 浏览器不支持 video 标签 */}
      </video>
    </div>
  )
}
