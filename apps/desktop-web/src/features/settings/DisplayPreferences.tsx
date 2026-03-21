import { localeOptions, t, type Locale } from '@shell/i18n/ui-locale'
import {
  monoFontOptions,
  themeOptions,
  uiFontOptions,
  uiFontSizeOptions,
  type MonoFont,
  type ThemeMode,
  type UiFont,
  type UiFontSize,
} from '@shell/state/ui-preferences'
import './DisplayPreferences.scss'

interface DisplayPreferencesProps {
  locale: Locale
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onUiFontSizeChange: (value: UiFontSize) => void
}

export function DisplayPreferences({
  locale,
  themeMode,
  uiFont,
  monoFont,
  uiFontSize,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onUiFontSizeChange,
}: DisplayPreferencesProps) {
  return (
    <div className="display-preferences" aria-label={t(locale, 'displayPreferences.title')}>
      <div className="settings-group-title">{t(locale, 'displayPreferences.language')}</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'displayPreferences.language')}</strong>
            <span>{t(locale, '选择界面显示的语言', 'Choose the display language for the interface.')}</span>
          </div>
          <div className="settings-row-control">
            <select className="settings-select" value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
              {localeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group-title">{t(locale, 'displayPreferences.theme')}</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'displayPreferences.theme')}</strong>
            <span>{t(locale, '自定义应用的外观配色', 'Customize the appearance of the application.')}</span>
          </div>
          <div className="settings-row-control">
            <select
              className="settings-select"
              value={themeMode}
              onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
            >
            {themeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(locale, option.labelKey)}
              </option>
            ))}
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group-title">{t(locale, 'displayPreferences.uiFont')}</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'displayPreferences.uiFont')}</strong>
            <span>{t(locale, '界面主要文字字体', 'Primary font for the interface text.')}</span>
          </div>
          <div className="settings-row-control">
            <select className="settings-select" value={uiFont} onChange={(event) => onUiFontChange(event.target.value as UiFont)}>
              {uiFontOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'displayPreferences.monoFont')}</strong>
            <span>{t(locale, '代码与等宽文字字体', 'Font for code and monospace text.')}</span>
          </div>
          <div className="settings-row-control">
            <select
              className="settings-select"
              value={monoFont}
              onChange={(event) => onMonoFontChange(event.target.value as MonoFont)}
            >
              {monoFontOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'displayPreferences.fontSize')}</strong>
            <span>{t(locale, '全局文字大小缩放', 'Global text size scaling.')}</span>
          </div>
          <div className="settings-row-control">
            <select
              className="settings-select"
              value={uiFontSize}
              onChange={(event) => onUiFontSizeChange(event.target.value as UiFontSize)}
            >
              {uiFontSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(locale, option.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

    </div>
  )
}
