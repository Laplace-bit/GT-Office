import { t, type Locale } from '../../shell/i18n/ui-locale.js'

export function computeHasAvailableUpdate(input: {
  enabled: boolean
  updateAvailable: boolean
  latestVersion: string | null
  skippedVersion: string | null
}): boolean {
  return Boolean(
    input.enabled &&
      input.updateAvailable &&
      input.latestVersion &&
      input.latestVersion !== input.skippedVersion,
  )
}

export function getUpdateUnavailableReasonMessage(reason: string | null, locale: Locale): string {
  switch (reason) {
    case 'UPDATER_PUBKEY_MISSING':
      return t(
        locale,
        '缺少 updater 公钥配置，当前只能查看版本信息，不能校验升级包。',
        'The updater public key is missing, so the app cannot verify update packages yet.',
      )
    default:
      return t(
        locale,
        '更新检查当前不可用，请先配置 updater 公钥与签名发布产物。',
        'Update checks are currently unavailable until the updater public key and signed release artifacts are configured.',
      )
  }
}
