import { useEffect, useState } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'
import {
  categorizeFile,
  isPreviewable,
  supportsInlineMediaPreview,
} from './utils/file-type-utils'
import { ImagePreviewer, VideoPreviewer, AudioPreviewer, PdfPreviewer } from './previewers'
import { PreviewProgress } from './components/PreviewProgress'
import { PreviewError } from './components/PreviewError'
import { resolveMediaPreviewPath } from './previewers/media-preview-path'
import './FilePreviewPane.scss'

const WORKSPACE_ROOT_WAIT_TIMEOUT_MS = 1200

function describePreviewError(locale: Locale, error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${t(locale, 'preview.error.loadFailed')}: ${error.message.trim()}`
  }
  if (typeof error === 'string' && error.trim()) {
    return `${t(locale, 'preview.error.loadFailed')}: ${error.trim()}`
  }
  return t(locale, 'preview.error.loadFailed')
}

interface FilePreviewPaneProps {
  locale: Locale
  workspaceId: string | null
  workspaceRoot: string | null
  filePath: string | null
  fileSize: number
  onOpenExternal?: () => void
}

export function FilePreviewPane({
  locale,
  workspaceId,
  workspaceRoot,
  filePath,
  fileSize,
  onOpenExternal,
}: FilePreviewPaneProps) {
  const [resolvedFileSize, setResolvedFileSize] = useState<number | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [workspaceRootTimedOut, setWorkspaceRootTimedOut] = useState(false)
  const fileType = categorizeFile(filePath)
  const resolvedPath = filePath ? resolveMediaPreviewPath(workspaceRoot, filePath) : null

  useEffect(() => {
    setWorkspaceRootTimedOut(false)

    if (resolvedPath || !filePath) {
      return
    }

    const timerId = window.setTimeout(() => {
      setWorkspaceRootTimedOut(true)
    }, WORKSPACE_ROOT_WAIT_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [filePath, resolvedPath])

  useEffect(() => {
    let cancelled = false
    setResolvedFileSize(null)
    setMetadataError(null)

    if (!resolvedPath || !desktopApi.isTauriRuntime()) {
      return () => {
        cancelled = true
      }
    }

    void desktopApi.fsGetFileInfo(resolvedPath)
      .then((info) => {
        if (!cancelled) {
          setResolvedFileSize(info.size)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMetadataError(describePreviewError(locale, error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [locale, resolvedPath])

  if (!workspaceId) {
    return (
      <div className="file-preview-pane">
        <div className="file-preview-empty">
          {t(locale, 'preview.bindWorkspace')}
        </div>
      </div>
    )
  }

  if (!filePath) {
    return (
      <div className="file-preview-pane">
        <div className="file-preview-empty">
          {t(locale, 'preview.selectFile')}
        </div>
      </div>
    )
  }

  if (!isPreviewable(filePath)) {
    return (
      <div className="file-preview-pane">
        <PreviewError
          locale={locale}
          type="unsupported"
          onOpenExternal={onOpenExternal}
        />
      </div>
    )
  }

  if (!resolvedPath) {
    return (
      <section className="file-preview-pane panel">
        {workspaceRootTimedOut ? (
          <PreviewError
            locale={locale}
            type="load-failed"
            message={t(locale, 'preview.error.workspaceContext')}
            onOpenExternal={onOpenExternal}
          />
        ) : (
          <PreviewProgress locale={locale} />
        )}
      </section>
    )
  }

  if (metadataError) {
    return (
      <section className="file-preview-pane panel">
        <PreviewError
          locale={locale}
          type="load-failed"
          message={metadataError}
          onOpenExternal={onOpenExternal}
        />
      </section>
    )
  }

  if (desktopApi.isTauriRuntime() && resolvedFileSize === null) {
    return (
      <section className="file-preview-pane panel">
        <PreviewProgress locale={locale} />
      </section>
    )
  }

  if (fileType.category !== 'pdf' && !supportsInlineMediaPreview(filePath)) {
    return (
      <section className="file-preview-pane panel">
        <PreviewError
          locale={locale}
          type="unsupported"
          message={t(locale, 'preview.error.inlineUnsupported')}
          onOpenExternal={onOpenExternal}
        />
      </section>
    )
  }

  const effectiveFileSize = resolvedFileSize ?? fileSize

  const renderPreviewer = () => {
    switch (fileType.category) {
      case 'image':
        return (
          <ImagePreviewer
            locale={locale}
            workspaceRoot={workspaceRoot}
            filePath={resolvedPath}
            fileSize={effectiveFileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      case 'video':
        return (
          <VideoPreviewer
            locale={locale}
            workspaceRoot={workspaceRoot}
            filePath={resolvedPath}
            fileSize={effectiveFileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      case 'audio':
        return (
          <AudioPreviewer
            locale={locale}
            workspaceRoot={workspaceRoot}
            filePath={resolvedPath}
            fileSize={effectiveFileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      case 'pdf':
        return (
          <PdfPreviewer
            locale={locale}
            filePath={resolvedPath}
            fileSize={effectiveFileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      default:
        return (
          <PreviewError
            locale={locale}
            type="unsupported"
            onOpenExternal={onOpenExternal}
          />
        )
    }
  }

  return (
    <section className="file-preview-pane panel">
      {renderPreviewer()}
    </section>
  )
}
