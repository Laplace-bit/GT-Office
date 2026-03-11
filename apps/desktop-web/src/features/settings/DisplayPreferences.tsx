import { localeOptions, t, type Locale, type TranslationKey } from '@shell/i18n/ui-locale'
import {
  monoFontOptions,
  themeOptions,
  uiFontOptions,
  uiFontSizeOptions,
  type AmbientLightingIntensity,
  type MonoFont,
  type ThemeMode,
  type UiFont,
  type UiFontSize,
} from '@shell/state/ui-preferences'

interface DisplayPreferencesProps {
  locale: Locale
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  ambientLightingEnabled: boolean
  ambientLightingIntensity: AmbientLightingIntensity
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onUiFontSizeChange: (value: UiFontSize) => void
  onAmbientLightingChange: (enabled: boolean) => void
  onAmbientLightingIntensityChange: (value: AmbientLightingIntensity) => void
}

export function DisplayPreferences({
  locale,
  themeMode,
  uiFont,
  monoFont,
  uiFontSize,
  ambientLightingEnabled,
  ambientLightingIntensity,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onUiFontSizeChange,
  onAmbientLightingChange,
  onAmbientLightingIntensityChange,
}: DisplayPreferencesProps) {
  const ambientOptions: Array<{ value: AmbientLightingIntensity; key: TranslationKey }> = [
    { value: 'low', key: 'displayPreferences.ambientIntensityLow' },
    { value: 'medium', key: 'displayPreferences.ambientIntensityMedium' },
    { value: 'high', key: 'displayPreferences.ambientIntensityHigh' },
  ]

  return (
    <div className="display-preferences" aria-label={t(locale, 'displayPreferences.title')}>
      <label>
        {t(locale, 'displayPreferences.language')}
        <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
          {localeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(locale, 'displayPreferences.theme')}
        <select
          value={themeMode}
          onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
        >
        {themeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {t(locale, option.labelKey)}
          </option>
        ))}
        </select>
      </label>
      <label>
        {t(locale, 'displayPreferences.uiFont')}
        <select value={uiFont} onChange={(event) => onUiFontChange(event.target.value as UiFont)}>
          {uiFontOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(locale, 'displayPreferences.monoFont')}
        <select
          value={monoFont}
          onChange={(event) => onMonoFontChange(event.target.value as MonoFont)}
        >
          {monoFontOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(locale, 'displayPreferences.fontSize')}
        <select
          value={uiFontSize}
          onChange={(event) => onUiFontSizeChange(event.target.value as UiFontSize)}
        >
          {uiFontSizeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t(locale, option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="display-preferences-ambient-row">
        <div className="display-preferences-ambient-copy">
          <strong>{t(locale, 'displayPreferences.ambientLighting')}</strong>
          <span>{t(locale, 'displayPreferences.ambientLightingHint')}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ambientLightingEnabled}
          className={`display-preferences-switch ${ambientLightingEnabled ? 'on' : 'off'}`}
          onClick={() => {
            onAmbientLightingChange(!ambientLightingEnabled)
          }}
        >
          <span className="display-preferences-switch-thumb" aria-hidden="true" />
        </button>
      </div>
      <div className="display-preferences-ambient-intensity-row">
        <span>{t(locale, 'displayPreferences.ambientIntensity')}</span>
        <div className="display-preferences-segmented">
          {ambientOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={ambientLightingIntensity === option.value ? 'active' : ''}
              aria-pressed={ambientLightingIntensity === option.value}
              onClick={() => {
                onAmbientLightingIntensityChange(option.value)
              }}
            >
              {t(locale, option.key)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
