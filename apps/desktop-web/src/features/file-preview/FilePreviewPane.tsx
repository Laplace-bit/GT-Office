import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { categorizeFile, isPreviewable } from './utils/file-type-utils'
import { ImagePreviewer, VideoPreviewer, AudioPreviewer } from './previewers'
import { PreviewError } from './components/PreviewError'
import './FilePreviewPane.scss'

interface FilePreviewPaneProps {
  locale: Locale
  workspaceId: string | null
  filePath: string | null
  fileSize: number
  onOpenExternal?: () => void
}

export function FilePreviewPane({
  locale,
  workspaceId,
  filePath,
  fileSize,
  onOpenExternal,
}: FilePreviewPaneProps) {
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

  const fileType = categorizeFile(filePath)

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

  const renderPreviewer = () => {
    switch (fileType.category) {
      case 'image':
        return (
          <ImagePreviewer
            locale={locale}
            filePath={filePath}
            fileSize={fileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      case 'video':
        return <VideoPreviewer filePath={filePath} />
      case 'audio':
        return <AudioPreviewer filePath={filePath} />
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