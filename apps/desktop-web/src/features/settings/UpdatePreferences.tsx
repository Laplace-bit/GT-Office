import { t, type Locale } from '@shell/i18n/ui-locale'
import type { AppUpdateState } from './useAppUpdate'
import { getUpdateUnavailableReasonMessage } from './update-preferences-model'
import './UpdatePreferences.scss'

interface UpdatePreferencesProps {
  locale: Locale
  autoCheckOnLaunch: boolean
  skippedVersion: string | null
  hasAvailableUpdate: boolean
  updateState: AppUpdateState
  onAutoCheckOnLaunchChange: (value: boolean) => void
  onCheckForUpdates: () => void
  onInstallUpdate: () => void
  onOpenReleasePage: () => void
  onSkipVersion: (value: string | null) => void
}

function formatPublishedAt(value: string | null, locale: Locale): string {
  if (!value) {
    return t(locale, '未发布', 'Not published')
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour12: false,
  })
}

export function UpdatePreferences({
  locale,
  autoCheckOnLaunch,
  skippedVersion,
  hasAvailableUpdate,
  updateState,
  onAutoCheckOnLaunchChange,
  onCheckForUpdates,
  onInstallUpdate,
  onOpenReleasePage,
  onSkipVersion,
}: UpdatePreferencesProps) {
  const progressPercent = updateState.progress?.contentLength
    ? Math.min(100, Math.round((updateState.progress.downloadedBytes / updateState.progress.contentLength) * 100))
    : null

  return (
    <div className="update-preferences" aria-label={t(locale, '应用更新', 'App updates')}>
      <div className="settings-group-title">{t(locale, '应用更新', 'App updates')}</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, '启动时自动检查更新', 'Check for updates on launch')}</strong>
            <span>
              {t(locale, '使用 GitHub Release 检查新版本，不会静默安装。', 'Use GitHub Releases to detect new versions without silent installs.')}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className={`update-preferences-toggle ${autoCheckOnLaunch ? 'active' : ''}`}
              onClick={() => onAutoCheckOnLaunchChange(!autoCheckOnLaunch)}
            >
              <span className="update-preferences-toggle-thumb" />
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, '当前版本', 'Current version')}</strong>
            <span>
              {updateState.enabled
                ? t(locale, '当前渠道：稳定版', 'Current channel: stable')
                : getUpdateUnavailableReasonMessage(updateState.unavailableReason, locale)}
            </span>
          </div>
          <div className="settings-row-control update-preferences-meta">
            <span>{updateState.currentVersion ?? 'Unknown'}</span>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, '最新状态', 'Latest status')}</strong>
            <span>
              {updateState.unavailableReason
                ? getUpdateUnavailableReasonMessage(updateState.unavailableReason, locale)
                : hasAvailableUpdate
                  ? t(locale, '已发现可安装的新版本。', 'A newer signed release is ready to install.')
                  : t(locale, '没有发现比当前版本更新的稳定版。', 'No newer stable release is available.')}
            </span>
          </div>
          <div className="settings-row-control update-preferences-actions">
            <button
              type="button"
              className="settings-action-button"
              onClick={onCheckForUpdates}
              disabled={updateState.checking || updateState.installing}
            >
              {updateState.checking
                ? t(locale, '检查中…', 'Checking…')
                : t(locale, '检查更新', 'Check for updates')}
            </button>
            <button
              type="button"
              className="settings-action-button primary"
              onClick={onInstallUpdate}
              disabled={!hasAvailableUpdate || updateState.installing}
            >
              {updateState.installing
                ? t(locale, '安装中…', 'Installing…')
                : t(locale, '下载并安装', 'Download and install')}
            </button>
            <button
              type="button"
              className="settings-action-button"
              onClick={onOpenReleasePage}
              disabled={!updateState.releasePageUrl}
            >
              {t(locale, '查看 Release', 'Open release page')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, '候选版本', 'Candidate version')}</strong>
            <span>
              {updateState.notes
                ? t(locale, '来自 GitHub Release 说明。', 'Pulled from the GitHub Release notes.')
                : t(locale, '还没有可展示的更新说明。', 'No release notes are available yet.')}
            </span>
          </div>
          <div className="settings-row-control update-preferences-meta">
            <span>{updateState.latestVersion ?? t(locale, '无', 'None')}</span>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t(locale, '发布时间', 'Published at')}</strong>
            <span>{t(locale, '按本地时区展示。', 'Shown in your local timezone.')}</span>
          </div>
          <div className="settings-row-control update-preferences-meta">
            <span>{formatPublishedAt(updateState.publishedAt, locale)}</span>
          </div>
        </div>
        {updateState.progress ? (
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>{t(locale, '下载进度', 'Download progress')}</strong>
              <span>{updateState.progress.detail ?? updateState.progress.stage}</span>
            </div>
            <div className="settings-row-control update-preferences-progress-block">
              <div className="update-preferences-progress-bar">
                <span style={{ width: `${progressPercent ?? 0}%` }} />
              </div>
              <span className="update-preferences-progress-text">
                {progressPercent === null ? t(locale, '准备中', 'Preparing') : `${progressPercent}%`}
              </span>
            </div>
          </div>
        ) : null}
        {updateState.latestVersion ? (
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>{t(locale, '版本提示控制', 'Version prompt controls')}</strong>
              <span>
                {skippedVersion === updateState.latestVersion
                  ? t(locale, '当前版本已被标记为跳过。', 'This version is currently skipped.')
                  : t(locale, '可以跳过当前版本，直到后续发布出现。', 'Skip this version until a newer release appears.')}
              </span>
            </div>
            <div className="settings-row-control update-preferences-actions">
              <button
                type="button"
                className="settings-action-button"
                onClick={() => onSkipVersion(updateState.latestVersion)}
                disabled={!hasAvailableUpdate}
              >
                {t(locale, '跳过此版本', 'Skip this version')}
              </button>
              <button
                type="button"
                className="settings-action-button"
                onClick={() => onSkipVersion(null)}
                disabled={!skippedVersion}
              >
                {t(locale, '恢复提示', 'Resume prompts')}
              </button>
            </div>
          </div>
        ) : null}
        {updateState.notes ? (
          <div className="update-preferences-notes">
            <pre>{updateState.notes}</pre>
          </div>
        ) : null}
        {updateState.errorDetail ? (
          <div className="update-preferences-error" role="status" aria-live="polite">
            {updateState.errorCode ? `${updateState.errorCode}: ` : ''}
            {updateState.errorDetail}
          </div>
        ) : null}
      </div>
    </div>
  )
}
