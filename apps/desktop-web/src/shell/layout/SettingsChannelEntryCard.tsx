import { t, type Locale } from '../i18n/ui-locale'

interface SettingsChannelEntryCardProps {
  locale: Locale
  workspaceId: string | null
  onOpenManager: () => void
}

export function SettingsChannelEntryCard({
  locale,
  workspaceId,
  onOpenManager,
}: SettingsChannelEntryCardProps) {
  return (
    <section
      className="settings-channel-entry-card"
      aria-label={t(locale, 'settings.channel.entry.title')}
    >
      <header className="settings-channel-entry-header">
        <div>
          <h3>{t(locale, 'settings.channel.entry.title')}</h3>
          <p>{t(locale, 'settings.channel.entry.subtitle')}</p>
        </div>
        <button type="button" onClick={onOpenManager}>
          {t(locale, 'settings.channel.entry.open')}
        </button>
      </header>
      <ul className="settings-channel-entry-meta">
        <li>
          <span>{t(locale, 'settings.channel.entry.workspace')}</span>
          <strong>{workspaceId ?? t(locale, 'workspace.label.unbound')}</strong>
        </li>
        <li>
          <span>{t(locale, 'settings.channel.entry.defaultMode')}</span>
          <strong>{t(locale, 'settings.channel.entry.defaultModeValue')}</strong>
        </li>
        <li>
          <span>{t(locale, 'settings.channel.entry.webhookRequirement')}</span>
          <strong>{t(locale, 'settings.channel.entry.webhookRequirementValue')}</strong>
        </li>
      </ul>
    </section>
  )
}
