import { useEffect, useState } from 'react'
import { localeOptions, t, type Locale } from '@shell/i18n/ui-locale'
import {
  commandRailProviderCommandOptionsByProvider,
  defaultUiPreferences,
  loadUiPreferences,
  monoFontOptions,
  themeOptions,
  UI_PREFERENCES_UPDATED_EVENT,
  saveUiPreferences,
  uiFontOptions,
  uiFontSizeOptions,
  type CommandRailProviderId,
  type MonoFont,
  type ThemeMode,
  type UiFont,
  type UiFontSize,
  type UiPreferences,
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

type CommandRailPreferencesState = Pick<
  UiPreferences,
  'showCommandRail' | 'pinnedCommandIdsByProvider'
>

const commandRailProviderIds: CommandRailProviderId[] = ['claude', 'codex']

function dedupeCommandIds(commandIds: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  commandIds.forEach((commandId) => {
    if (!commandId || seen.has(commandId)) {
      return
    }
    seen.add(commandId)
    result.push(commandId)
  })

  return result
}

function readCommandRailPreferences(): CommandRailPreferencesState {
  const preferences = loadUiPreferences()
  return {
    showCommandRail: preferences.showCommandRail,
    pinnedCommandIdsByProvider: preferences.pinnedCommandIdsByProvider,
  }
}

function getProviderTitle(locale: Locale, providerId: CommandRailProviderId): string {
  if (providerId === 'claude') {
    return t(locale, 'Pinned Claude commands', 'Pinned Claude commands')
  }
  return t(locale, 'Pinned Codex commands', 'Pinned Codex commands')
}

function getProviderDescription(locale: Locale, providerId: CommandRailProviderId): string {
  if (providerId === 'claude') {
    return t(
      locale,
      'Choose which Claude slash commands stay in the primary rail.',
      'Choose which Claude slash commands stay in the primary rail.',
    )
  }
  return t(
    locale,
    'Choose which Codex slash commands and presets stay in the primary rail.',
    'Choose which Codex slash commands and presets stay in the primary rail.',
  )
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
  const [commandRailPreferences, setCommandRailPreferences] = useState<CommandRailPreferencesState>(
    () => readCommandRailPreferences(),
  )

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'gtoffice.ui.preferences.v1') {
        return
      }
      setCommandRailPreferences(readCommandRailPreferences())
    }

    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const updateCommandRailPreferences = (
    updater: (current: UiPreferences) => UiPreferences,
  ) => {
    const current = loadUiPreferences()
    const next = updater(current)
    saveUiPreferences(next)
    window.dispatchEvent(new Event(UI_PREFERENCES_UPDATED_EVENT))
    setCommandRailPreferences({
      showCommandRail: next.showCommandRail,
      pinnedCommandIdsByProvider: next.pinnedCommandIdsByProvider,
    })
  }

  const toggleRailVisibility = () => {
    updateCommandRailPreferences((current) => ({
      ...current,
      showCommandRail: !current.showCommandRail,
    }))
  }

  const togglePinnedCommand = (providerId: CommandRailProviderId, commandId: string) => {
    updateCommandRailPreferences((current) => {
      const currentPinnedIds =
        current.pinnedCommandIdsByProvider[providerId] ??
        defaultUiPreferences.pinnedCommandIdsByProvider[providerId]
      const normalizedPinnedIds = dedupeCommandIds(currentPinnedIds)
      const nextPinnedIds = normalizedPinnedIds.includes(commandId)
        ? normalizedPinnedIds.filter((id) => id !== commandId)
        : [...normalizedPinnedIds, commandId]

      return {
        ...current,
        pinnedCommandIdsByProvider: {
          ...current.pinnedCommandIdsByProvider,
          [providerId]: nextPinnedIds,
        },
      }
    })
  }

  const resetCommandRailPreferences = () => {
    updateCommandRailPreferences((current) => ({
      ...current,
      showCommandRail: defaultUiPreferences.showCommandRail,
      showWorkspaceActionsInRail: defaultUiPreferences.showWorkspaceActionsInRail,
      pinnedCommandIdsByProvider: defaultUiPreferences.pinnedCommandIdsByProvider,
    }))
  }

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

      <div className="settings-group-title">{t(locale, 'Command Rail', 'Command Rail')}</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'Show command rail', 'Show command rail')}</strong>
            <span>
              {t(
                locale,
                'Keep the provider-native command rail visible beneath the terminal.',
                'Keep the provider-native command rail visible beneath the terminal.',
              )}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className={`display-preferences-switch ${
                commandRailPreferences.showCommandRail ? 'on' : ''
              }`}
              onClick={toggleRailVisibility}
              aria-pressed={commandRailPreferences.showCommandRail}
              aria-label={t(locale, 'Show command rail', 'Show command rail')}
            >
              <span className="display-preferences-switch-thumb" />
            </button>
          </div>
        </div>
        {commandRailProviderIds.map((providerId) => {
          const providerOptions = commandRailProviderCommandOptionsByProvider[providerId]
          const pinnedCommandIds =
            commandRailPreferences.pinnedCommandIdsByProvider[providerId] ??
            defaultUiPreferences.pinnedCommandIdsByProvider[providerId]
          const pinnedCommandIdSet = new Set(dedupeCommandIds(pinnedCommandIds))

          return (
            <div className="settings-row command-rail-preferences-row" key={providerId}>
              <div className="settings-row-label">
                <strong>{getProviderTitle(locale, providerId)}</strong>
                <span>{getProviderDescription(locale, providerId)}</span>
              </div>
              <div className="settings-row-control command-rail-preferences-control">
                <div className="command-rail-chip-list" role="group" aria-label={getProviderTitle(locale, providerId)}>
                  {providerOptions.map((option) => {
                    const isPinned = pinnedCommandIdSet.has(option.id)
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`command-rail-chip ${isPinned ? 'is-active' : ''}`}
                        onClick={() => togglePinnedCommand(providerId, option.id)}
                        aria-pressed={isPinned}
                        title={option.label}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
        <div className="settings-row command-rail-reset-row">
          <div className="settings-row-label">
            <strong>{t(locale, 'Reset command rail defaults', 'Reset command rail defaults')}</strong>
            <span>
              {t(
                locale,
                'Restore the default command rail visibility and pinned provider-native entries.',
                'Restore the default command rail visibility and pinned provider-native entries.',
              )}
            </span>
          </div>
          <div className="settings-row-control">
            <button type="button" className="command-rail-reset-button" onClick={resetCommandRailPreferences}>
              {t(locale, 'Reset to defaults', 'Reset to defaults')}
            </button>
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
