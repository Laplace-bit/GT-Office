import { Loader2 } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './PreviewProgress.scss'

interface PreviewProgressProps {
  locale: Locale
  message?: string
}

export function PreviewProgress({ locale, message }: PreviewProgressProps) {
  return (
    <div className="preview-progress">
      <Loader2 className="preview-progress-icon" aria-hidden="true" />
      <span className="preview-progress-text">
        {message || t(locale, 'preview.loading')}
      </span>
    </div>
  )
}