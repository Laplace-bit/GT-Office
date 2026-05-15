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
    runtime: info?.runtime === 'tauri' ? 'tauri' : 'web',
  }
}

export function buildSettingsAboutSections(
  locale: Locale,
  info?: SettingsAboutAppInfo | null,
): SettingsAboutSection[] {
  const normalized = normalizeSettingsAboutAppInfo(info)
  const runtimeLabel = normalized.runtime === 'tauri' ? 'Desktop (Tauri)' : 'Web'

  return [
    {
      id: 'identity',
      title: locale === 'zh-CN' ? '应用信息' : 'Identity',
      items: [
        { label: locale === 'zh-CN' ? '名称' : 'Name', value: normalized.name },
        { label: locale === 'zh-CN' ? '版本' : 'Version', value: normalized.version },
      ],
    },
    {
      id: 'footprint',
      title: locale === 'zh-CN' ? '足迹' : 'Footprint',
      items: [
        { label: locale === 'zh-CN' ? '配置' : 'Config', value: '.gtoffice/config.json' },
        { label: locale === 'zh-CN' ? '标识符' : 'Identifier', value: normalized.identifier },
      ],
    },
    {
      id: 'runtime',
      title: locale === 'zh-CN' ? '运行时' : 'Runtime',
      items: [
        { label: locale === 'zh-CN' ? '平台' : 'Platform', value: runtimeLabel },
        {
          label: locale === 'zh-CN' ? 'Tauri 版本' : 'Tauri Version',
          value: normalized.tauriVersion,
        },
      ],
    },
  ]
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
