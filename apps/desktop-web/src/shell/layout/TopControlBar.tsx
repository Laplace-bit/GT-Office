import type { MouseEvent as ReactMouseEvent } from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import type { AppIconName } from '../ui/icons'
import { AppIcon } from '../ui/icons'
import type { WindowPlatform } from './window-performance-policy'
import './TopControlBar.scss'

interface TopControlBarProps {
  locale: Locale
  workspacePath: string
  connectionLabel: string
  windowPlatform: WindowPlatform
  nativeWindowTop: boolean
  nativeWindowTopMacOs: boolean
  nativeWindowTopLinux: boolean
  windowMaximized: boolean
  performanceDebugEnabled: boolean
  onPickWorkspaceDirectory: () => void
  onBatchLaunchAgents: () => void
  batchLaunchDisabled: boolean
  onOpenSettings: () => void
  // TODO: 性能调试按钮暂时隐藏
  // onTogglePerformanceDebug: () => void
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
  windowPlatform,
  nativeWindowTop,
  nativeWindowTopMacOs,
  nativeWindowTopLinux,
  windowMaximized,
  performanceDebugEnabled,
  onPickWorkspaceDirectory,
  onBatchLaunchAgents,
  batchLaunchDisabled,
  onOpenSettings,
  // onTogglePerformanceDebug,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
}: TopControlBarProps) {
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
      action: onBatchLaunchAgents,
      icon: 'bolt' as AppIconName,
      disabled: batchLaunchDisabled,
    },
    {
      key: 'open-settings',
      label: t(locale, 'topControlBar.openSettings'),
      action: onOpenSettings,
      icon: 'settings' as AppIconName,
    },
    // TODO: 性能调试按钮暂时隐藏，默认已开启
    // {
    //   key: 'toggle-performance-debug',
    //   label: performanceDebugEnabled
    //     ? t(locale, 'topControlBar.performanceDebug.disable')
    //     : t(locale, 'topControlBar.performanceDebug.enable'),
    //   action: onTogglePerformanceDebug,
    //   icon: 'activity' as AppIconName,
    // },
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
  const orderedWindowActionButtons =
    windowPlatform === 'macos'
      ? [
          windowActionButtons[2],
          windowActionButtons[0],
          windowActionButtons[1],
        ]
      : windowActionButtons

  const topClassNames = [
    'vb-top-control-bar',
    `window-platform-${windowPlatform}`,
    nativeWindowTop ? 'native-window-top' : '',
    nativeWindowTopMacOs ? 'native-window-top-macos' : '',
    nativeWindowTopLinux ? 'native-window-top-linux' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const workspaceBadgeDragRegion = nativeWindowTopLinux ? '' : undefined
  const headerDragRegion =
    nativeWindowTop && windowPlatform !== 'macos' ? '' : undefined

  const handleTitlebarDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (windowPlatform !== 'windows') {
      return
    }
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    if (target.closest("button,input,textarea,select,a,[role='button'],[contenteditable='true']")) {
      return
    }
    onWindowToggleMaximize()
  }

  const renderWindowControls = () => (
    <div className="vb-window-controls" role="toolbar" aria-label={t(locale, 'topControlBar.windowControls')}>
      {orderedWindowActionButtons.map((btn) => (
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
    <header
      className={topClassNames}
      data-tauri-drag-region={headerDragRegion}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="vb-top-control-leading">
        <div className="vb-top-actions" role="toolbar" aria-label={t(locale, 'topControlBar.openWorkspace')}>
          {actionButtons.map((btn) => (
            <span key={btn.key} className="vb-top-action-tooltip-anchor" title={btn.label}>
              <button
                type="button"
                onClick={btn.action}
                className={[
                  'vb-top-action-button',
                  btn.key === 'toggle-performance-debug' ? 'with-label' : '',
                  btn.key === 'toggle-performance-debug' && performanceDebugEnabled ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={btn.label}
                title={btn.label}
                disabled={btn.disabled}
              >
                <AppIcon name={btn.icon} className="vb-icon vb-icon-top-action" aria-hidden="true" />
                {btn.key === 'toggle-performance-debug' ? (
                  <span className="vb-top-action-label">Perf</span>
                ) : null}
              </button>
            </span>
          ))}
        </div>
        <div
          className="vb-workspace-badge"
          data-tauri-drag-region={workspaceBadgeDragRegion}
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
        />
      ) : null}
      {nativeWindowTop && windowPlatform !== 'macos' ? renderWindowControls() : null}
    </header>
  )
}
