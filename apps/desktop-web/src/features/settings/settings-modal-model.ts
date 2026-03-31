import { t, type Locale } from '../../shell/i18n/ui-locale.js'

export type SettingsTab = 'general' | 'shortcuts' | 'ai' | 'channels' | 'about'

export interface SettingsTabItem {
  id: SettingsTab
  label: string
}

export interface SettingsAboutAppInfo {
  name?: string | null
  version?: string | null
  identifier?: string | null
  tauriVersion?: string | null
  runtime?: 'tauri' | 'web' | null
}

export interface NormalizedSettingsAboutAppInfo {
  name: string
  version: string
  identifier: string
  tauriVersion: string
  runtime: 'tauri' | 'web'
}

export interface SettingsAboutSectionItem {
  label: string
  value: string
}

export interface SettingsAboutSection {
  id: 'identity' | 'footprint' | 'runtime'
  title: string
  description: string
  items: SettingsAboutSectionItem[]
}

const DEFAULT_SETTINGS_ABOUT_APP_INFO: NormalizedSettingsAboutAppInfo = {
  name: 'GT Office',
  version: 'Pending detection',
  identifier: 'dev.gtoffice.app',
  tauriVersion: 'Unavailable',
  runtime: 'web',
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
    identifier: trimOrNull(info?.identifier) ?? DEFAULT_SETTINGS_ABOUT_APP_INFO.identifier,
    tauriVersion: trimOrNull(info?.tauriVersion) ?? DEFAULT_SETTINGS_ABOUT_APP_INFO.tauriVersion,
    runtime: info?.runtime === 'tauri' ? 'tauri' : DEFAULT_SETTINGS_ABOUT_APP_INFO.runtime,
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

function resolveRuntimeLabel(locale: Locale, runtime: 'tauri' | 'web'): string {
  return runtime === 'tauri'
    ? t(locale, 'settingsModal.about.runtime.desktop')
    : t(locale, 'settingsModal.about.runtime.webPreview')
}

export function buildSettingsAboutSections(
  locale: Locale,
  info?: SettingsAboutAppInfo | null,
): SettingsAboutSection[] {
  const normalized = normalizeSettingsAboutAppInfo(info)

  return [
    {
      id: 'identity',
      title: t(locale, 'settingsModal.about.section.identity.title'),
      description: t(locale, 'settingsModal.about.section.identity.description'),
      items: [
        { label: t(locale, 'settingsModal.about.item.name'), value: normalized.name },
        { label: t(locale, 'settingsModal.about.item.version'), value: normalized.version },
        { label: t(locale, 'settingsModal.about.item.identifier'), value: normalized.identifier },
      ],
    },
    {
      id: 'footprint',
      title: t(locale, 'settingsModal.about.section.footprint.title'),
      description: t(locale, 'settingsModal.about.section.footprint.description'),
      items: [
        {
          label: t(locale, 'settingsModal.about.item.workspaceConfig'),
          value: '.gtoffice/config.json',
        },
        {
          label: t(locale, 'settingsModal.about.item.userSettings'),
          value: t(locale, 'settingsModal.about.value.userSettingsManaged'),
        },
        {
          label: t(locale, 'settingsModal.about.item.security'),
          value: t(locale, 'settingsModal.about.value.securityVault'),
        },
      ],
    },
    {
      id: 'runtime',
      title: t(locale, 'settingsModal.about.section.runtime.title'),
      description: t(locale, 'settingsModal.about.section.runtime.description'),
      items: [
        {
          label: t(locale, 'settingsModal.about.item.runtime'),
          value: resolveRuntimeLabel(locale, normalized.runtime),
        },
        {
          label: t(locale, 'settingsModal.about.item.tauriVersion'),
          value: normalized.tauriVersion,
        },
      ],
    },
  ]
}
