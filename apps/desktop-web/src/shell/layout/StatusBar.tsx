import { t, type Locale } from '../i18n/ui-locale'

interface StatusBarProps {
  locale: Locale
  activeWorkspaceLabel: string
  gitBranch: string
  agentOnline: number
  agentTotal: number
  terminalSessions: number
}

export function StatusBar({
  locale,
  activeWorkspaceLabel,
  gitBranch,
  agentOnline,
  agentTotal,
  terminalSessions,
}: StatusBarProps) {
  return (
    <footer className="glass-panel flex items-center justify-between px-3 py-2 text-xs text-vb-text-muted select-none">
      <div className="flex items-center gap-4">
        <span>
          {t(locale, 'statusBar.activeWorkspace')}: <span className="text-vb-text">{activeWorkspaceLabel}</span>
        </span>
        <span>
          {t(locale, 'statusBar.agentsOnline')}: <span className="text-vb-text">{agentOnline}/{agentTotal}</span>
        </span>
        <span>{t(locale, 'statusBar.terminalSessions')}: {terminalSessions}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>{t(locale, 'statusBar.queueLatency')}: 180ms</span>
        <span>Git {t(locale, 'statusBar.gitBranch')}: <span className="font-mono text-vb-text">{gitBranch}</span></span>
        <span>{t(locale, 'statusBar.policyMode')}: strict</span>
        <span>{t(locale, 'statusBar.resourceUsage')}: 24% CPU / 1.4GB RAM</span>
      </div>
    </footer>
  )
}
