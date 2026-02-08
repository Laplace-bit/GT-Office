import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'

interface FileContentPaneProps {
  locale: Locale
  workspaceId: string | null
  selectedFilePath: string | null
  fileContent: string
  loading: boolean
  errorMessage: string | null
  noticeMessage: string | null
  canLoadFullContent: boolean
  onLoadFullContent: () => void
  canRenderContent: boolean
  readMode: 'preview' | 'full'
  onSwitchToPreview: () => void
}

export function FileContentPane({
  locale,
  workspaceId,
  selectedFilePath,
  fileContent,
  loading,
  errorMessage,
  noticeMessage,
  canLoadFullContent,
  onLoadFullContent,
  canRenderContent,
  readMode,
  onSwitchToPreview,
}: FileContentPaneProps) {
  return (
    <section className="panel file-content-pane">
      <header className="file-content-header">
        <h2>{t(locale, 'fileContent.title')}</h2>
        <p>{selectedFilePath ?? t(locale, 'fileContent.noFileSelected')}</p>
      </header>

      {!workspaceId ? (
        <p>{t(locale, 'fileContent.bindWorkspace')}</p>
      ) : null}
      {workspaceId && !selectedFilePath ? (
        <p>{t(locale, 'fileContent.selectFileHint')}</p>
      ) : null}
      {loading ? <p>{t(locale, 'fileContent.loading')}</p> : null}
      <div className="file-content-mode-row">
        <span className="file-content-mode-badge">
          {t(
            locale,
            readMode === 'full' ? 'fileContent.modeFull' : 'fileContent.modePreview',
          )}
        </span>
        {readMode === 'full' ? (
          <button
            type="button"
            className="file-content-load-preview"
            onClick={onSwitchToPreview}
            disabled={loading}
          >
            {t(locale, 'fileContent.switchToPreview')}
          </button>
        ) : null}
      </div>
      {canLoadFullContent ? (
        <button
          type="button"
          className="file-content-load-full"
          onClick={onLoadFullContent}
          disabled={loading}
        >
          {t(locale, 'fileContent.loadFull')}
        </button>
      ) : null}
      {noticeMessage ? (
        <p className="file-content-notice">
          {t(locale, 'fileContent.previewNotice', { detail: noticeMessage })}
        </p>
      ) : null}
      {errorMessage ? <p className="file-content-error">{errorMessage}</p> : null}
      {selectedFilePath && !loading && !errorMessage && canRenderContent ? (
        <pre className="file-content-view">{fileContent || ''}</pre>
      ) : null}
    </section>
  )
}
