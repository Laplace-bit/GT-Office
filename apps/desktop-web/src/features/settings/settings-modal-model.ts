import { t, type Locale } from '../../shell/i18n/ui-locale.js'

export type SettingsTab = 'general' | 'shortcuts' | 'ai' | 'channels' | 'about'

export interface SettingsTabItem {
  id: SettingsTab
  label: string
}

export interface SettingsAboutAppInfo {
  name?: string | null
  version?: string | null
  runtime?: 'tauri' | 'web' | null
}

export interface NormalizedSettingsAboutAppInfo {
  name: string
  version: string
}

const DEFAULT_SETTINGS_ABOUT_APP_INFO: NormalizedSettingsAboutAppInfo = {
  name: 'GT Office',
  version: 'Pending detection',
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function buildSettingsTabItems(locale: Locale): SettingsTabItem[] {
  return [
    { id: 'general', label: t(locale, 'settingsModal.nav.general') },
    { id: 'shortcuts', label: t(locale, 'settingsModal.nav.shortcuts') },
    { id: 'ai', label: t(locale, 'settingsModal.nav.aiProviders') },
    { id: 'channels', label: t(locale, 'settingsModal.nav.channels') },
    { id: 'about', label: t(locale, 'settingsModal.nav.about') },
  ]
}

export function normalizeSettingsAboutAppInfo(
  info?: SettingsAboutAppInfo | null,
): NormalizedSettingsAboutAppInfo {
  return {
    name: trimOrNull(info?.name) ?? DEFAULT_SETTINGS_ABOUT_APP_INFO.name,
    version: trimOrNull(info?.version) ?? DEFAULT_SETTINGS_ABOUT_APP_INFO.version,
  }
}

export function buildSettingsAboutSummary(locale: Locale): string {
  return t(locale, 'settingsModal.about.summary')
}

export function buildSettingsAboutCapabilities(locale: Locale): string[] {
  return [
    t(locale, 'settingsModal.about.capability.workspaces'),
    t(locale, 'settingsModal.about.capability.files'),
    t(locale, 'settingsModal.about.capability.terminal'),
    t(locale, 'settingsModal.about.capability.git'),
    t(locale, 'settingsModal.about.capability.multiWindow'),
    t(locale, 'settingsModal.about.capability.aiProviders'),
    t(locale, 'settingsModal.about.capability.channels'),
  ]
}