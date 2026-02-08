import { t, type Locale } from '../i18n/ui-locale'
import type { AppIconName } from '../ui/icons'
import { AppIcon } from '../ui/icons'

interface TopControlBarProps {
  locale: Locale
  activeWorkspaceLabel: string
  workspacePath: string
  connectionLabel: string
  nativeWindowTop: boolean
  nativeWindowTopMacOs: boolean
  nativeWindowTopLinux: boolean
  onWorkspacePathChange: (value: string) => void
  onPickWorkspaceDirectory: () => void
  onRefreshGit: () => void
  onOpenSettings: () => void
}

export function TopControlBar({
  locale,
  activeWorkspaceLabel,
  workspacePath,
  connectionLabel,
  nativeWindowTop,
  nativeWindowTopMacOs,
  nativeWindowTopLinux,
  onWorkspacePathChange,
  onPickWorkspaceDirectory,
  onRefreshGit,
  onOpenSettings,
}: TopControlBarProps) {
  const topClassNames = [
    'vb-top-control-bar',
    nativeWindowTop ? 'native-window-top' : '',
    nativeWindowTopMacOs ? 'native-window-top-macos' : '',
    nativeWindowTopLinux ? 'native-window-top-linux' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={topClassNames}>
      <div className="vb-top-control-leading">
        <div className="vb-workspace-badge" data-tauri-drag-region={nativeWindowTop ? '' : undefined}>
          <strong>{activeWorkspaceLabel}</strong>
          <span>{connectionLabel}</span>
        </div>
        {nativeWindowTop ? (
          <div className="titlebar-drag-region" data-tauri-drag-region="" aria-hidden="true" />
        ) : null}
      </div>
      <div className="vb-top-actions" role="toolbar" aria-label={t(locale, 'topControlBar.commandPalette')}>
        <input
          type="text"
          value={workspacePath}
          placeholder={t(locale, 'topControlBar.workspacePathPlaceholder')}
          onChange={(event) => onWorkspacePathChange(event.target.value)}
          className="vb-top-workspace-input"
        />
        {[
          { label: t(locale, 'topControlBar.pickWorkspaceDirectory'), action: onPickWorkspaceDirectory, icon: 'folder-open' as AppIconName },
          { label: t(locale, 'topControlBar.refreshGit'), action: onRefreshGit, icon: 'refresh' as AppIconName },
          { label: t(locale, 'topControlBar.openSettings'), action: onOpenSettings, icon: 'settings' as AppIconName },
        ].map((btn, i) => (
          <button
            key={i}
            type="button"
            onClick={btn.action}
            className="vb-top-action-button"
          >
            <AppIcon name={btn.icon} className="vb-icon vb-icon-top-action" aria-hidden="true" />
            {btn.label}
          </button>
        ))}
        {[
          { label: t(locale, 'topControlBar.commandPalette'), icon: 'command' as AppIconName },
          { label: t(locale, 'topControlBar.batchLaunchAgents'), icon: 'bolt' as AppIconName },
        ].map((btn, i) => (
          <button key={`mock-${i}`} type="button" className="vb-top-action-button subtle">
            <AppIcon name={btn.icon} className="vb-icon vb-icon-top-action" aria-hidden="true" />
            {btn.label}
          </button>
        ))}
      </div>
    </header>
  )
}
