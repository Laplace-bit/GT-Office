import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type AppUpdateCheckResponse,
  type AppUpdateProgressPayload,
  type AppUpdateStatusResponse,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { addNotification } from '@/stores/notification'
import { computeHasAvailableUpdate } from './update-preferences-model'

export interface AppUpdateState {
  loading: boolean
  checking: boolean
  installing: boolean
  enabled: boolean
  updateAvailable: boolean
  currentVersion: string | null
  latestVersion: string | null
  notes: string | null
  publishedAt: string | null
  repository: string | null
  manifestUrl: string | null
  releasePageUrl: string | null
  unavailableReason: string | null
  errorCode: string | null
  errorDetail: string | null
  lastCheckedAt: number | null
  progress: AppUpdateProgressPayload | null
}

const INITIAL_STATE: AppUpdateState = {
  loading: false,
  checking: false,
  installing: false,
  enabled: false,
  updateAvailable: false,
  currentVersion: null,
  latestVersion: null,
  notes: null,
  publishedAt: null,
  repository: null,
  manifestUrl: null,
  releasePageUrl: null,
  unavailableReason: null,
  errorCode: null,
  errorDetail: null,
  lastCheckedAt: null,
  progress: null,
}

function applyStatus(state: AppUpdateState, status: AppUpdateStatusResponse): AppUpdateState {
  return {
    ...state,
    enabled: status.enabled,
    updateAvailable: false,
    currentVersion: status.currentVersion,
    repository: status.repository,
    manifestUrl: status.manifestUrl,
    releasePageUrl: status.releasesUrl,
    unavailableReason: status.unavailableReason ?? null,
  }
}

function applyCheckResponse(state: AppUpdateState, response: AppUpdateCheckResponse): AppUpdateState {
  return {
    ...state,
    enabled: response.enabled,
    updateAvailable: response.updateAvailable,
    currentVersion: response.currentVersion,
    latestVersion: response.version ?? null,
    notes: response.notes ?? null,
    publishedAt: response.publishedAt ?? null,
    repository: response.repository,
    manifestUrl: response.manifestUrl,
    releasePageUrl: response.releasePageUrl,
    unavailableReason: response.unavailableReason ?? null,
    errorCode: response.errorCode ?? null,
    errorDetail: response.errorDetail ?? null,
    lastCheckedAt: Date.now(),
  }
}

export function useAppUpdate(options: {
  locale: Locale
  skippedVersion: string | null
  onAutoCheckChange: (value: boolean) => void
  onSkipVersionChange: (value: string | null) => void
}) {
  const { locale, skippedVersion, onAutoCheckChange, onSkipVersionChange } = options
  const [state, setState] = useState<AppUpdateState>(INITIAL_STATE)
  const notifiedVersionRef = useRef<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    setState((current) => ({ ...current, loading: true }))
    try {
      const status = await desktopApi.settingsUpdateStatus()
      setState((current) => ({ ...applyStatus(current, status), loading: false }))
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        errorCode: 'UPDATE_STATUS_FAILED',
        errorDetail: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [])

  const checkForUpdates = useCallback(
    async (options?: { silent?: boolean; notifyIfAvailable?: boolean }) => {
      if (!desktopApi.isTauriRuntime()) {
        return null
      }

      setState((current) => ({ ...current, checking: true, errorCode: null, errorDetail: null }))
      try {
        const response = await desktopApi.settingsUpdateCheck()
        setState((current) => ({ ...applyCheckResponse(current, response), checking: false }))

        if (
          response.updateAvailable &&
          response.version &&
          response.version !== skippedVersion &&
          options?.notifyIfAvailable &&
          notifiedVersionRef.current !== response.version
        ) {
          notifiedVersionRef.current = response.version
          addNotification({
            type: 'info',
            message: t(
              locale,
              `GT Office ${response.version} 已可更新，请在设置中查看并安装。`,
              `GT Office ${response.version} is available. Open Settings to review and install it.`,
            ),
            duration: 8000,
          })
        }

        if (!options?.silent && response.errorDetail) {
          addNotification({
            type: 'warning',
            message: t(locale, `检查更新失败：${response.errorDetail}`, `Update check failed: ${response.errorDetail}`),
            duration: 7000,
          })
        }

        return response
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        setState((current) => ({
          ...current,
          checking: false,
          errorCode: 'UPDATE_CHECK_FAILED',
          errorDetail: detail,
        }))
        if (!options?.silent) {
          addNotification({
            type: 'warning',
            message: t(locale, `检查更新失败：${detail}`, `Update check failed: ${detail}`),
            duration: 7000,
          })
        }
        return null
      }
    },
    [skippedVersion],
  )

  const installUpdate = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return null
    }
    setState((current) => ({ ...current, installing: true, progress: null, errorCode: null, errorDetail: null }))
    try {
      const response = await desktopApi.settingsUpdateDownloadAndInstall()
      setState((current) => ({
        ...current,
        installing: false,
        latestVersion: response.version ?? current.latestVersion,
        releasePageUrl: response.releasePageUrl,
        repository: response.repository,
        manifestUrl: response.manifestUrl,
        errorCode: response.errorCode ?? null,
        errorDetail: response.errorDetail ?? null,
      }))
      if (response.started) {
        addNotification({
          type: 'success',
          message: t(
            locale,
            `更新 ${response.version ?? ''} 已下载，安装即将开始。`,
            `Update ${response.version ?? ''} downloaded. Installation is starting.`,
          ),
          duration: 6000,
        })
      } else if (response.errorDetail) {
        addNotification({
          type: 'warning',
          message: t(locale, `安装更新失败：${response.errorDetail}`, `Update install failed: ${response.errorDetail}`),
          duration: 8000,
        })
      }
      return response
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setState((current) => ({
        ...current,
        installing: false,
        errorCode: 'UPDATE_INSTALL_FAILED',
        errorDetail: detail,
      }))
      addNotification({
        type: 'warning',
        message: t(locale, `安装更新失败：${detail}`, `Update install failed: ${detail}`),
        duration: 8000,
      })
      return null
    }
  }, [locale])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    let cancelled = false
    let cleanup = () => {}
    void desktopApi.subscribeAppUpdateProgress((payload) => {
      if (cancelled) {
        return
      }
      setState((current) => {
        const downloadedBytes =
          payload.stage === 'progress'
            ? (current.progress?.downloadedBytes ?? 0) + payload.downloadedBytes
            : payload.downloadedBytes
        return {
          ...current,
          installing: payload.stage !== 'finished' && payload.stage !== 'error',
          progress: {
            ...payload,
            downloadedBytes,
          },
          errorCode: payload.stage === 'error' ? current.errorCode ?? 'UPDATE_INSTALL_FAILED' : current.errorCode,
          errorDetail: payload.stage === 'error' ? payload.detail ?? current.errorDetail : current.errorDetail,
        }
      })
    }).then((unlisten) => {
      if (cancelled) {
        unlisten()
        return
      }
      cleanup = unlisten
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  const hasAvailableUpdate = useMemo(
    () =>
      computeHasAvailableUpdate({
        enabled: state.enabled,
        updateAvailable: state.updateAvailable,
        latestVersion: state.latestVersion,
        skippedVersion,
      }),
    [skippedVersion, state.enabled, state.latestVersion, state.updateAvailable],
  )

  return {
    state,
    hasAvailableUpdate,
    skippedVersion,
    refreshStatus,
    checkForUpdates,
    installUpdate,
    openReleasePage: () => {
      if (state.releasePageUrl) {
        return desktopApi.systemOpenUrl(state.releasePageUrl)
      }
      return Promise.resolve()
    },
    setAutoCheckOnLaunch: onAutoCheckChange,
    skipVersion: (version: string | null) => onSkipVersionChange(version),
  }
}
