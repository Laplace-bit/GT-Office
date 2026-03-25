import { messages, type TranslationKey } from './messages.js'
import { supportedLocales, type Locale } from './locale-types.js'

type TranslationParams = Record<string, string | number | undefined>

export function isTranslationKey(value: string): value is TranslationKey {
  return Object.prototype.hasOwnProperty.call(messages, value)
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template
  }
  return Object.entries(params).reduce((acc, [key, value]) => {
    const safeValue = value ?? ''
    return acc.split(`{${key}}`).join(String(safeValue))
  }, template)
}

// Backward-compatible translator:
// 1) Key mode: t(locale, 'settings.title', { ... })
// 2) Legacy mode: t(locale, '中文文案', 'English copy')
export function t(locale: Locale, key: TranslationKey, params?: TranslationParams): string
export function t(locale: Locale, zh: string, en: string, params?: TranslationParams): string
export function t(
  locale: Locale,
  keyOrZh: TranslationKey | string,
  paramsOrEn?: TranslationParams | string,
  maybeParams?: TranslationParams,
): string {
  if (
    typeof keyOrZh === 'string' &&
    isTranslationKey(keyOrZh) &&
    (paramsOrEn === undefined || typeof paramsOrEn !== 'string')
  ) {
    const entry = messages[keyOrZh]
    const template = entry[locale] ?? entry['en-US']
    return interpolate(template, paramsOrEn as TranslationParams | undefined)
  }

  const zh = String(keyOrZh)
  const en = typeof paramsOrEn === 'string' ? paramsOrEn : zh
  const params = (typeof paramsOrEn === 'string'
    ? maybeParams
    : paramsOrEn) as TranslationParams | undefined
  const template = locale === 'zh-CN' ? zh : en
  return interpolate(template, params)
}

export function translateMaybeKey(locale: Locale, value: string): string
export function translateMaybeKey(
  locale: Locale,
  value: string | null | undefined,
): string | null | undefined
export function translateMaybeKey(
  locale: Locale,
  value: string | null | undefined,
): string | null | undefined {
  if (value == null) {
    return value
  }
  return isTranslationKey(value) ? t(locale, value) : value
}

const localeLabels: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
}

export const localeOptions = supportedLocales.map((value) => ({
  value,
  label: localeLabels[value],
}))

export type { Locale }

export type { TranslationKey }
