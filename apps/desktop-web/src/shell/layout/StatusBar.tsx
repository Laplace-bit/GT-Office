import { t, type Locale } from '../i18n/ui-locale'

interface StatusBarProps {
  locale: Locale
  activeWorkspaceLabel: string
  gitBranch: string
  gitChangedFiles: number
  agentOnline: number
  agentTotal: number
  terminalSessions: number
}

export function StatusBar({
  locale,
  activeWorkspaceLabel,
  gitBranch,
  gitChangedFiles,
  agentOnline,
  agentTotal,
  terminalSessions,
}: StatusBarProps) {
  const workspaceLabel = activeWorkspaceLabel.trim() || '-'
  const branchLabel = gitBranch.trim() || '-'
  const changedFilesCount = Math.max(0, gitChangedFiles)

  return (
    <footer className="status-bar" aria-label="Agent status bar">
      <div className="status-bar__item status-bar__item--workspace" title={workspaceLabel}>
        <span className="status-bar__label">{t(locale, 'statusBar.activeWorkspace')}</span>
        <span className="status-bar__value status-bar__value--workspace">{workspaceLabel}</span>
      </div>
      <div className="status-bar__item status-bar__item--agents">
        <span className="status-bar__label">{t(locale, 'statusBar.agentsOnline')}</span>
        <span className="status-bar__value">{agentOnline}/{agentTotal}</span>
      </div>
      <div className="status-bar__item status-bar__item--terminals">
        <span className="status-bar__label">{t(locale, 'statusBar.terminalSessions')}</span>
        <span className="status-bar__value">{terminalSessions}</span>
      </div>
      <div className="status-bar__item status-bar__item--branch" title={branchLabel}>
        <span className="status-bar__label">Git {t(locale, 'statusBar.gitBranch')}</span>
        <span className="status-bar__value status-bar__value--mono">{branchLabel}</span>
      </div>
      <div className="status-bar__item status-bar__item--changes">
        <span className="status-bar__label">{t(locale, 'statusBar.gitChanges')}</span>
        <span className="status-bar__value">{changedFilesCount}</span>
      </div>
    </footer>
  )
}
