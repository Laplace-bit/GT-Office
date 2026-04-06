import { useCallback, useEffect, useState } from 'react'
import { Music } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { PreviewError } from '../components/PreviewError'
import { PreviewProgress } from '../components/PreviewProgress'
import { PREVIEW_LIMITS } from '../utils/file-type-utils'
import { resolveMediaPreviewPath } from './media-preview-path'
import './AudioPreviewer.scss'

interface AudioPreviewerProps {
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

export function AudioPreviewer({
  locale,
  workspaceRoot,
  filePath,
  fileSize,
  onOpenExternal,
}: AudioPreviewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isTooLarge = fileSize > PREVIEW_LIMITS.audio.maxInlineSize
  const resolvedPath = resolveMediaPreviewPath(workspaceRoot, filePath)
  const src = resolvedPath ? safeConvertFileSrc(resolvedPath) : null
  const fileName = filePath.split('/').pop() || filePath

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
    <div className="audio-previewer">
      {loading && <PreviewProgress locale={locale} />}
      {error && (
        <PreviewError
          locale={locale}
          type="load-failed"
          message={error}
          onOpenExternal={onOpenExternal}
        />
      )}
      <div className="audio-previewer-cover">
        <Music className="audio-previewer-icon" aria-hidden="true" />
      </div>
      <div className="audio-previewer-info">
        <span className="audio-previewer-name">{fileName}</span>
      </div>
      <audio
        key={src}
        className="audio-previewer-player"
        controls
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
        style={{ display: loading || error ? 'none' : 'block' }}
      >
        <source src={src} />
      </audio>
    </div>
  )
}
