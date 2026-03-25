import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AppIcon } from '@shell/ui/icons'
import { t } from '@shell/i18n/ui-locale'
import {
  isQuickCommandProviderId,
  isQuickCommandRailVisible,
  loadUiPreferences,
  UI_PREFERENCES_UPDATED_EVENT,
  type UiPreferences,
} from '@shell/state/ui-preferences'
import { buildStationActionRailModel } from './station-action-registry'
import { getStationActionDisplayLabel, type StationActionDescriptor } from './station-action-model'
import { resolveStationActionAriaLabel, resolveStationActionTooltip } from './station-action-copy'
import './StationActionDock.scss'

interface StationActionDockProps {
  actions: StationActionDescriptor[]
  compact?: boolean
  onAction: (action: StationActionDescriptor) => void
}

function StationActionDockView({ actions, compact = false, onAction }: StationActionDockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => loadUiPreferences())

  const { primaryActions } = useMemo(
    () => buildStationActionRailModel(actions, uiPreferences),
    [actions, uiPreferences],
  )
  const providerId = useMemo(() => {
    const providerKind = actions.find((action) => isQuickCommandProviderId(action.providerKind))?.providerKind
    return providerKind && isQuickCommandProviderId(providerKind) ? providerKind : null
  }, [actions])
  const locale = uiPreferences.locale

  const handleRailKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const currentButton = event.currentTarget
    const buttons = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>('[data-station-action-rail-button="true"]') ?? [],
    )
    const currentIndex = buttons.indexOf(currentButton)
    if (currentIndex < 0) {
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const nextButton = buttons[(currentIndex + direction + buttons.length) % buttons.length]
      nextButton?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      buttons[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      buttons[buttons.length - 1]?.focus()
      return
    }
  }, [])

  useEffect(() => {
    const syncPreferences = () => {
      setUiPreferences(loadUiPreferences())
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
  }, [])

  if (primaryActions.length === 0) {
    return null
  }

  if (providerId && !isQuickCommandRailVisible(providerId, uiPreferences)) {
    return null
  }

  return (
    <div ref={rootRef} className={['station-action-dock', compact ? 'is-compact' : ''].join(' ')}>
      <div className="station-action-dock-shell">
        <div
          ref={railRef}
          className="station-action-dock-rail"
          role="toolbar"
          aria-label={t(locale, 'quickCommands.rail.ariaLabel')}
        >
          {primaryActions.map((action) => {
            const displayLabel = getStationActionDisplayLabel(action)
            const tooltip = resolveStationActionTooltip(locale, action)
            return (
              <button
                key={action.id}
                type="button"
                data-station-action-rail-button="true"
                className={[
                  'station-action-dock-button',
                  action.dangerLevel ? `is-${action.dangerLevel}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(event) => {
                  event.stopPropagation()
                  onAction(action)
                }}
                onKeyDown={handleRailKeyDown}
                title={tooltip}
                aria-label={resolveStationActionAriaLabel(locale, action)}
                disabled={Boolean(action.disabled)}
              >
                <AppIcon name={action.icon} className="vb-icon station-action-dock-icon" aria-hidden="true" />
                <span className="station-action-dock-label">{displayLabel}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const StationActionDock = memo(StationActionDockView)
