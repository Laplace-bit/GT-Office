import { t, type Locale } from '../../shell/i18n/ui-locale.js'
import {
  isQuickCommandProviderId,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandPreferenceId,
} from '../../shell/state/ui-preferences.js'

interface StationActionCopyDescriptor {
  id: string
  label: string
  slashCommand?: string
  tooltip?: string
  providerKind: string
  disabledReason?: string
}

function resolveLocalizedDisabledReason(
  locale: Locale,
  action: StationActionCopyDescriptor,
): string | null {
  const key = resolveQuickCommandDisabledReasonKey(
    isQuickCommandProviderId(action.providerKind) ? action.providerKind : null,
    action.disabledReason,
  )

  if (!key) {
    return null
  }

  return t(locale, key)
}

export function resolveStationActionPreferenceKey(action: StationActionCopyDescriptor): string {
  return resolveQuickCommandPreferenceId(action.slashCommand, action.id)
}

export function resolveStationActionTooltip(
  locale: Locale,
  action: StationActionCopyDescriptor,
): string {
  const localizedDisabledReason = resolveLocalizedDisabledReason(locale, action)
  if (localizedDisabledReason) {
    return localizedDisabledReason
  }

  if (isQuickCommandProviderId(action.providerKind)) {
    return t(
      locale,
      resolveQuickCommandDescriptionKey(action.providerKind, resolveStationActionPreferenceKey(action)),
    )
  }

  return action.tooltip ?? action.slashCommand ?? action.label
}

export function resolveStationActionAriaLabel(
  locale: Locale,
  action: StationActionCopyDescriptor,
): string {
  const label = action.slashCommand ?? action.label
  const description = resolveStationActionTooltip(locale, action)
  return description === label ? label : `${label}: ${description}`
}
