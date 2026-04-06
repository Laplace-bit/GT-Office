import { AlertCircle, ExternalLink } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './PreviewError.scss'

interface PreviewErrorProps {
  locale: Locale
  type: 'load-failed' | 'unsupported' | 'too-large'
  message?: string
  onOpenExternal?: () => void
}

export function PreviewError({
  locale,
  type,
  message,
  onOpenExternal,
}: PreviewErrorProps) {
  const defaultMessages: Record<string, string> = {
    'load-failed': t(locale, 'preview.error.loadFailed'),
    unsupported: t(locale, 'preview.error.unsupported'),
    'too-large': t(locale, 'preview.error.tooLarge'),
  }

  return (
    <div className="preview-error">
      <AlertCircle className="preview-error-icon" aria-hidden="true" />
      <span className="preview-error-text">
        {message || defaultMessages[type] || defaultMessages.unsupported}
      </span>
      {onOpenExternal && (
        <button
          type="button"
          className="preview-error-external"
          onClick={onOpenExternal}
        >
          <ExternalLink className="preview-error-external-icon" aria-hidden="true" />
          <span>{t(locale, 'preview.openExternal')}</span>
        </button>
      )}
    </div>
  )
}