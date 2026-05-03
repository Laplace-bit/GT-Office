import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

interface GitNoticeBannerProps {
  locale: 'zh-CN' | 'en-US'
  message: string
  onDismiss: () => void
}

export const GitNoticeBanner = memo(function GitNoticeBanner({
  locale,
  message,
  onDismiss,
}: GitNoticeBannerProps) {
  return (
    <div className="git-pane__notice" role="status" aria-live="polite">
      <span className="git-pane__notice-dot" aria-hidden="true" />
      <span className="git-pane__notice-message">{message}</span>
      <button
        type="button"
        className="git-pane__notice-dismiss"
        onClick={onDismiss}
        aria-label={t(locale, 'settingsModal.close')}
        title={t(locale, 'settingsModal.close')}
      >
        <AppIcon name="x-mark" />
      </button>
    </div>
  )
})
