import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import './FileContentPane.scss'

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
  const modeLabel = t(
    locale,
    readMode === 'full' ? 'fileContent.modeFull' : 'fileContent.modePreview',
  )

  return (
    <section className="panel file-content-pane file-content-window">
      <header className="file-content-header">
        <div className="file-content-header-copy">
          <span className="file-content-eyebrow">Preview Surface</span>
          <div>
            <h2>{t(locale, 'fileContent.title')}</h2>
            <p>{selectedFilePath ?? t(locale, 'fileContent.noFileSelected')}</p>
          </div>
        </div>
        <div className="file-content-mode-row">
          <span className="file-content-mode-badge">{modeLabel}</span>
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
      </header>

      <div className="file-content-toolbar">
        {canLoadFullContent ? (
          <button
            type="button"
            className="file-content-load-full"
            onClick={onLoadFullContent}
            disabled={loading}
          >
            {t(locale, 'fileContent.loadFull')}
          </button>
        ) : (
          <span className="file-content-toolbar-spacer" aria-hidden="true" />
        )}
        {noticeMessage ? (
          <p className="file-content-notice">
            {t(locale, 'fileContent.previewNotice', { detail: noticeMessage })}
          </p>
        ) : null}
      </div>

      {errorMessage ? <p className="file-content-error">{errorMessage}</p> : null}

      <div className="file-content-body">
        {!workspaceId ? (
          <p className="file-content-empty">{t(locale, 'fileContent.bindWorkspace')}</p>
        ) : null}
        {workspaceId && !selectedFilePath ? (
          <p className="file-content-empty">{t(locale, 'fileContent.selectFileHint')}</p>
        ) : null}
        {loading ? <p className="file-content-empty">{t(locale, 'fileContent.loading')}</p> : null}
        {selectedFilePath && !loading && !errorMessage && canRenderContent ? (
          <pre className="file-content-view">{fileContent || ''}</pre>
        ) : null}
      </div>
    </section>
  )
}
