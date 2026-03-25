import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@shell/ui/icons'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  commandRailProviderCommandOptionsByProvider,
  defaultUiPreferences,
  isQuickCommandRailVisible,
  loadUiPreferences,
  saveUiPreferences,
  setQuickCommandRailVisibility,
  UI_PREFERENCES_UPDATED_EVENT,
  type CommandRailProviderId,
  type UiPreferences,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
} from '@shell/state/ui-preferences'

import './ProviderQuickCommands.scss'

interface ProviderQuickCommandsProps {
  locale: Locale
  providerId: CommandRailProviderId
}

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

function updateQuickCommandPreferences(updater: (current: UiPreferences) => UiPreferences): void {
  const current = loadUiPreferences()
  const next = updater(current)
  saveUiPreferences(next)
  window.dispatchEvent(new Event(UI_PREFERENCES_UPDATED_EVENT))
}

export function ProviderQuickCommands({ locale, providerId }: ProviderQuickCommandsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    isQuickCommandRailVisible(providerId, loadUiPreferences()),
  )
  const [pinnedCommandIds, setPinnedCommandIds] = useState<string[]>(() => {
    const preferences = loadUiPreferences()
    return (
      preferences.pinnedCommandIdsByProvider[providerId] ??
      defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
      []
    )
  })
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null)

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = loadUiPreferences()
      setIsVisible(isQuickCommandRailVisible(providerId, preferences))
      setPinnedCommandIds(
        preferences.pinnedCommandIdsByProvider[providerId] ??
          defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
          [],
      )
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== 'gtoffice.ui.preferences.v1') {
        return
      }
      syncPreferences()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, syncPreferences)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, syncPreferences)
    }
  }, [providerId])

  const options = useMemo(
    () =>
      (commandRailProviderCommandOptionsByProvider[providerId] ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        description: t(locale, resolveQuickCommandDescriptionKey(providerId, option.id)),
      })),
    [locale, providerId],
  )

  const pinnedSet = useMemo(() => new Set(dedupeCommandIds(pinnedCommandIds)), [pinnedCommandIds])
  const activeOption = options.find((option) => option.id === activeCommandId) ?? options[0] ?? null
  const providerCopy = quickCommandProviderCopyByProvider[providerId]

  if (options.length === 0) {
    return null
  }

  const toggleCommand = (commandId: string) => {
    updateQuickCommandPreferences((current) => {
      const currentPinnedIds =
        current.pinnedCommandIdsByProvider[providerId] ??
        defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
        []
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

  const toggleVisibility = () => {
    updateQuickCommandPreferences((current) => {
      const next = setQuickCommandRailVisibility(
        providerId,
        !isQuickCommandRailVisible(providerId, current),
        current,
      )
      return next
    })
  }

  return (
    <section className="provider-quick-commands" aria-label={t(locale, providerCopy.titleKey)}>
      <div
        className={`provider-quick-commands__summary ${isExpanded ? 'is-expanded' : ''}`}
      >
        <button
          type="button"
          className="provider-quick-commands__summary-main"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded((current) => !current)
          }}
          aria-expanded={isExpanded}
        >
          <div className="provider-quick-commands__summary-copy">
            <strong>{t(locale, 'quickCommands.section.title')}</strong>
            <span>{t(locale, providerCopy.descriptionKey)}</span>
          </div>
          <div className="provider-quick-commands__summary-meta">
            <span className="provider-quick-commands__count">
              {t(locale, 'quickCommands.section.count', {
                count: String(pinnedSet.size),
              })}
            </span>
            <span className="provider-quick-commands__summary-icon" aria-hidden="true">
              <AppIcon name={isExpanded ? 'collapse' : 'expand'} width={14} height={14} />
            </span>
          </div>
        </button>
        <button
          type="button"
          className={`provider-quick-commands__switch ${isVisible ? 'is-on' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            toggleVisibility()
          }}
          aria-pressed={isVisible}
          aria-label={t(locale, 'quickCommands.section.visibility')}
        >
          <span className="provider-quick-commands__switch-thumb" />
        </button>
      </div>

      {isExpanded && (
        <div className="provider-quick-commands__panel">
          <p className="provider-quick-commands__hint">{t(locale, 'quickCommands.section.hint')}</p>
          <div className="provider-quick-commands__chip-grid" role="list">
            {options.map((option) => {
              const isPinned = pinnedSet.has(option.id)
              const isActive = activeOption?.id === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="listitem"
                  className={`provider-quick-commands__chip ${isPinned ? 'is-active' : ''} ${
                    isActive ? 'is-focused' : ''
                  }`}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleCommand(option.id)
                  }}
                  onPointerEnter={() => setActiveCommandId(option.id)}
                  onPointerLeave={() => setActiveCommandId(null)}
                  onFocus={() => setActiveCommandId(option.id)}
                  onBlur={() => setActiveCommandId(null)}
                  aria-pressed={isPinned}
                  aria-label={`${option.label}: ${option.description}`}
                  title={option.description}
                >
                  <span className="provider-quick-commands__chip-label">{option.label}</span>
                  <span className="provider-quick-commands__chip-state" aria-hidden="true">
                    {isPinned
                      ? t(locale, 'quickCommands.section.shown')
                      : t(locale, 'quickCommands.section.hidden')}
                  </span>
                </button>
              )
            })}
          </div>

          {activeOption && (
            <div className="provider-quick-commands__detail" aria-live="polite">
              <div className="provider-quick-commands__detail-head">
                <strong>{activeOption.label}</strong>
                <span>
                  {pinnedSet.has(activeOption.id)
                    ? t(locale, 'quickCommands.section.shown')
                    : t(locale, 'quickCommands.section.hidden')}
                </span>
              </div>
              <p>{activeOption.description}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
