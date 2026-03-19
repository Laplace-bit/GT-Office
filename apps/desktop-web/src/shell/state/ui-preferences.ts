import type { Locale, TranslationKey } from '../i18n/ui-locale'

export type ThemeMode = 'graphite-light' | 'graphite-dark'
export type UiFont = 'sf-pro' | 'ibm-plex' | 'system-ui'
export type MonoFont = 'jetbrains-mono' | 'cascadia-code' | 'fira-code'
export type AmbientLightingIntensity = 'low' | 'medium' | 'high'
export type UiFontSize = 'small' | 'medium' | 'large' | 'xlarge'

export interface UiPreferences {
  locale: Locale
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  ambientLightingEnabled: boolean
  ambientLightingIntensity: AmbientLightingIntensity
}

const STORAGE_KEY = 'gtoffice.ui.preferences.v1'

export const defaultUiPreferences: UiPreferences = {
  locale: 'zh-CN',
  themeMode: 'graphite-light',
  uiFont: 'sf-pro',
  monoFont: 'jetbrains-mono',
  uiFontSize: 'medium',
  ambientLightingEnabled: true,
  ambientLightingIntensity: 'medium',
}

export const themeOptions: Array<{ value: ThemeMode; labelKey: TranslationKey }> = [
  { value: 'graphite-light', labelKey: 'themeOption.graphiteLight' },
  { value: 'graphite-dark', labelKey: 'themeOption.graphiteDark' },
]

export const uiFontOptions: Array<{ value: UiFont; label: string }> = [
  { value: 'sf-pro', label: 'SF Pro' },
  { value: 'ibm-plex', label: 'IBM Plex Sans' },
  { value: 'system-ui', label: 'System UI' },
]

export const monoFontOptions: Array<{ value: MonoFont; label: string }> = [
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'cascadia-code', label: 'Cascadia Code' },
  { value: 'fira-code', label: 'Fira Code' },
]

export const uiFontSizeOptions: Array<{ value: UiFontSize; labelKey: TranslationKey }> = [
  { value: 'small', labelKey: 'displayPreferences.fontSizeSmall' },
  { value: 'medium', labelKey: 'displayPreferences.fontSizeMedium' },
  { value: 'large', labelKey: 'displayPreferences.fontSizeLarge' },
  { value: 'xlarge', labelKey: 'displayPreferences.fontSizeXLarge' },
]

const uiFontSizeCssMap: Record<UiFontSize, string> = {
  small: '0.9286rem',
  medium: '1rem',
  large: '1.0714rem',
  xlarge: '1.1429rem',
}

const uiFontCssMap: Record<UiFont, string> = {
  'sf-pro': "'SF Pro Text', 'Segoe UI Variable', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
  'ibm-plex': "'IBM Plex Sans', 'Segoe UI Variable', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
  'system-ui': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const monoFontCssMap: Record<MonoFont, string> = {
  'jetbrains-mono': "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
  'cascadia-code': "'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
  'fira-code': "'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
}

export function loadUiPreferences(): UiPreferences {
  if (typeof window === 'undefined') {
    return defaultUiPreferences
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultUiPreferences
    }
    const parsed = JSON.parse(raw) as Partial<UiPreferences>
    return {
      locale: parsed.locale ?? defaultUiPreferences.locale,
      themeMode: parsed.themeMode ?? defaultUiPreferences.themeMode,
      uiFont: parsed.uiFont ?? defaultUiPreferences.uiFont,
      monoFont: parsed.monoFont ?? defaultUiPreferences.monoFont,
      uiFontSize:
        parsed.uiFontSize === 'small' || parsed.uiFontSize === 'medium' ||
        parsed.uiFontSize === 'large' || parsed.uiFontSize === 'xlarge'
          ? parsed.uiFontSize
          : defaultUiPreferences.uiFontSize,
      ambientLightingEnabled:
        typeof parsed.ambientLightingEnabled === 'boolean'
          ? parsed.ambientLightingEnabled
          : defaultUiPreferences.ambientLightingEnabled,
      ambientLightingIntensity:
        parsed.ambientLightingIntensity === 'low' ||
        parsed.ambientLightingIntensity === 'medium' ||
        parsed.ambientLightingIntensity === 'high'
          ? parsed.ambientLightingIntensity
          : defaultUiPreferences.ambientLightingIntensity,
    }
  } catch {
    return defaultUiPreferences
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

export function applyUiPreferences(preferences: UiPreferences): void {
  if (typeof document === 'undefined') {
    return
  }
  const root = document.documentElement
  root.dataset.theme = preferences.themeMode
  root.dataset.ambientLighting = preferences.ambientLightingEnabled ? 'on' : 'off'
  root.dataset.ambientIntensity = preferences.ambientLightingIntensity
  root.style.setProperty('--vb-font-ui', uiFontCssMap[preferences.uiFont])
  root.style.setProperty('--vb-font-mono', monoFontCssMap[preferences.monoFont])
  root.style.setProperty('--vb-font-size-base', uiFontSizeCssMap[preferences.uiFontSize])
}
