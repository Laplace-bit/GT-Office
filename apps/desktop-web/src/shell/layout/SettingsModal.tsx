import { DisplayPreferences } from './DisplayPreferences'
import { SettingsRuntimePane } from './SettingsRuntimePane'
import { t, type Locale } from '../i18n/ui-locale'
import type { AmbientLightingIntensity, MonoFont, ThemeMode, UiFont } from '../state/ui-preferences'

interface SettingsModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  ambientLightingEnabled: boolean
  ambientLightingIntensity: AmbientLightingIntensity
  onClose: () => void
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onAmbientLightingChange: (enabled: boolean) => void
  onAmbientLightingIntensityChange: (value: AmbientLightingIntensity) => void
}

export function SettingsModal({
  open,
  locale,
  workspaceId,
  themeMode,
  uiFont,
  monoFont,
  ambientLightingEnabled,
  ambientLightingIntensity,
  onClose,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onAmbientLightingChange,
  onAmbientLightingIntensityChange,
}: SettingsModalProps) {
  if (!open) {
    return null
  }

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="settings-modal panel" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <h2>{t(locale, 'settingsModal.title')}</h2>
            <p>{t(locale, 'settingsModal.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, 'settingsModal.close')}>
            {t(locale, 'settingsModal.close')}
          </button>
        </header>
        <DisplayPreferences
          locale={locale}
          themeMode={themeMode}
          uiFont={uiFont}
          monoFont={monoFont}
          ambientLightingEnabled={ambientLightingEnabled}
          ambientLightingIntensity={ambientLightingIntensity}
          onLocaleChange={onLocaleChange}
          onThemeModeChange={onThemeModeChange}
          onUiFontChange={onUiFontChange}
          onMonoFontChange={onMonoFontChange}
          onAmbientLightingChange={onAmbientLightingChange}
          onAmbientLightingIntensityChange={onAmbientLightingIntensityChange}
        />
        <SettingsRuntimePane locale={locale} workspaceId={workspaceId} />
      </section>
    </div>
  )
}
