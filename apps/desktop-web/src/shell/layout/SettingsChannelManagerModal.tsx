import { SettingsChannelOnboardingPane } from './SettingsChannelOnboardingPane'
import { t, type Locale } from '../i18n/ui-locale'

interface SettingsChannelManagerModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  onClose: () => void
}

export function SettingsChannelManagerModal({
  open,
  locale,
  workspaceId,
  onClose,
}: SettingsChannelManagerModalProps) {
  if (!open) {
    return null
  }

  return (
    <div
      className="settings-channel-manager-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="settings-channel-manager-modal panel" role="dialog" aria-modal="true">
        <header className="settings-channel-manager-header">
          <div>
            <h2>{t(locale, 'settings.channel.manager.title')}</h2>
            <p>{t(locale, 'settings.channel.manager.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, 'settingsModal.close')}>
            {t(locale, 'settingsModal.close')}
          </button>
        </header>
        <SettingsChannelOnboardingPane locale={locale} workspaceId={workspaceId} />
      </section>
    </div>
  )
}
