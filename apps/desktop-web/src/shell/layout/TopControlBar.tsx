import { t, type Locale } from '../i18n/ui-locale'
import type { AppIconName } from '../ui/icons'
import { AppIcon } from '../ui/icons'

interface TopControlBarProps {
  locale: Locale
  workspacePath: string
  connectionLabel: string
  nativeWindowTop: boolean
  nativeWindowTopMacOs: boolean
  nativeWindowTopLinux: boolean
  windowMaximized: boolean
  onPickWorkspaceDirectory: () => void
  onOpenSettings: () => void
  onWindowMinimize: () => void
  onWindowToggleMaximize: () => void
  onWindowClose: () => void
}

interface TopActionButton {
  key: string
  label: string
  action?: () => void
  icon: AppIconName
  disabled?: boolean
}

function extractWorkspacePathCandidate(workspacePath: string, connectionLabel: string): string {
  const direct = workspacePath.trim()
  if (direct) {
    return direct
  }
  const label = connectionLabel.trim()
  if (!label) {
    return ''
  }
  const zhMarker = '已绑定 '
  const zhIndex = label.indexOf(zhMarker)
  if (zhIndex >= 0) {
    return label.slice(zhIndex + zhMarker.length).trim()
  }
  const lower = label.toLowerCase()
  const enMarker = 'bound to '
  const enIndex = lower.indexOf(enMarker)
  if (enIndex >= 0) {
    return label.slice(enIndex + enMarker.length).trim()
  }
  return ''
}

function formatWorkspacePathForDisplay(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '')
  if (!trimmed) {
    return ''
  }
  const withoutExtendedPrefix = trimmed.replace(/^\\\\\?\\/, '').replace(/^\/\/\?\//, '')
  const wslDriveMatch = withoutExtendedPrefix.match(/^\/mnt\/([a-zA-Z])\/(.*)$/)
  if (wslDriveMatch) {
    const [, drive, rest] = wslDriveMatch
    const normalizedRest = rest.replace(/\//g, '\\')
    return `${drive.toUpperCase()}:\\${normalizedRest}`
  }
  if (/^[a-zA-Z]:[\\/]/.test(withoutExtendedPrefix)) {
    return withoutExtendedPrefix.replace(/\//g, '\\')
  }
  if (withoutExtendedPrefix.startsWith('\\\\')) {
    return withoutExtendedPrefix.replace(/\//g, '\\')
  }
  return withoutExtendedPrefix.replace(/\\/g, '/')
}

export function TopControlBar({
  locale,
  workspacePath,
  connectionLabel,
  nativeWindowTop,
  nativeWindowTopMacOs,
  nativeWindowTopLinux,
  windowMaximized,
  onPickWorkspaceDirectory,
  onOpenSettings,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
}: TopControlBarProps) {
  const windowPlatform = nativeWindowTopMacOs
    ? 'macos'
    : nativeWindowTopLinux
      ? 'linux'
      : nativeWindowTop
        ? 'windows'
        : 'web'
  const workspacePathCandidate = extractWorkspacePathCandidate(workspacePath, connectionLabel)
  const displayWorkspacePath = formatWorkspacePathForDisplay(workspacePathCandidate)
  const workspacePathFallback = t(locale, 'workspace.label.unbound')
  const workspacePathText = displayWorkspacePath || workspacePathFallback
  const actionButtons: TopActionButton[] = [
    {
      key: 'pick-workspace',
      label: t(locale, 'topControlBar.pickWorkspaceDirectory'),
      action: onPickWorkspaceDirectory,
      icon: 'folder-open' as AppIconName,
    },
    {
      key: 'batch-launch',
      label: t(locale, 'topControlBar.batchLaunchAgents'),
      icon: 'bolt' as AppIconName,
      disabled: true,
    },
    {
      key: 'open-settings',
      label: t(locale, 'topControlBar.openSettings'),
      action: onOpenSettings,
      icon: 'settings' as AppIconName,
    },
  ]
  const windowActionButtons: TopActionButton[] = [
    {
      key: 'window-minimize',
      label: t(locale, 'topControlBar.minimizeWindow'),
      action: onWindowMinimize,
      icon: 'minus' as AppIconName,
    },
    {
      key: 'window-maximize',
      label: windowMaximized
        ? t(locale, 'topControlBar.restoreWindow')
        : t(locale, 'topControlBar.maximizeWindow'),
      action: onWindowToggleMaximize,
      icon: windowMaximized ? ('collapse' as AppIconName) : ('expand' as AppIconName),
    },
    {
      key: 'window-close',
      label: t(locale, 'topControlBar.closeWindow'),
      action: onWindowClose,
      icon: 'close' as AppIconName,
    },
  ]

  const topClassNames = [
    'vb-top-control-bar',
    `window-platform-${windowPlatform}`,
    nativeWindowTop ? 'native-window-top' : '',
    nativeWindowTopMacOs ? 'native-window-top-macos' : '',
    nativeWindowTopLinux ? 'native-window-top-linux' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const renderWindowControls = () => (
    <div className="vb-window-controls" role="toolbar" aria-label={t(locale, 'topControlBar.windowControls')}>
      {windowActionButtons.map((btn) => (
        <button
          key={btn.key}
          type="button"
          onClick={btn.action}
          className={`vb-window-action-button ${btn.key}`}
          aria-label={btn.label}
          data-tooltip={btn.label}
        >
          <AppIcon name={btn.icon} className="vb-icon vb-icon-top-action" aria-hidden="true" />
        </button>
      ))}
    </div>
  )

  return (
    <header className={topClassNames}>
      {nativeWindowTop && windowPlatform === 'macos' ? renderWindowControls() : null}
      <div className="vb-top-control-leading">
        <div className="vb-top-actions" role="toolbar" aria-label={t(locale, 'topControlBar.openWorkspace')}>
          {actionButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={btn.action}
              className="vb-top-action-button"
              aria-label={btn.label}
              data-tooltip={btn.label}
              disabled={btn.disabled}
            >
              <AppIcon name={btn.icon} className="vb-icon vb-icon-top-action" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div
          className="vb-workspace-badge"
          data-tauri-drag-region={nativeWindowTop ? '' : undefined}
          onDoubleClick={nativeWindowTop ? onWindowToggleMaximize : undefined}
          title={workspacePathText}
        >
          <span className="vb-workspace-path">{workspacePathText}</span>
        </div>
      </div>
      {nativeWindowTop ? (
        <div
          className="titlebar-drag-region"
          data-tauri-drag-region=""
          aria-hidden="true"
          onDoubleClick={onWindowToggleMaximize}
        />
      ) : null}
      {nativeWindowTop && windowPlatform !== 'macos' ? renderWindowControls() : null}
    </header>
  )
}
