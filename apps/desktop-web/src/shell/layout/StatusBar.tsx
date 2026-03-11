import { t, type Locale } from '../i18n/ui-locale'
import type { GitBranchEntry } from '../integration/desktop-api'
import './StatusBar.scss'

interface StatusBarProps {
  locale: Locale
  gitBranch: string
  gitBranches: GitBranchEntry[]
  gitChangedFiles: number
  onCheckoutBranch: (target: string) => Promise<void>
  checkoutLoading: boolean
  agentOnline: number
  agentTotal: number
  terminalSessions: number
}

export function StatusBar({
  locale,
  gitBranch,
  gitBranches,
  gitChangedFiles,
  onCheckoutBranch,
  checkoutLoading,
  agentOnline,
  agentTotal,
  terminalSessions,
}: StatusBarProps) {
  const branchLabel = gitBranch.trim() || '-'
  const changedFilesCount = Math.max(0, gitChangedFiles)
  const hasCurrentBranch = gitBranches.some((branch) => branch.name === branchLabel)
  const branchDisabled = checkoutLoading || gitBranches.length === 0

  return (
    <footer className="status-bar" aria-label="Agent status bar">
      <div className="status-bar__item status-bar__item--branch" title={branchLabel}>
        <span className="status-bar__abbr" title={t(locale, 'statusBar.gitBranch')}>
          BR
        </span>
        <div
          className={`status-bar__branch-field ${branchDisabled ? 'status-bar__branch-field--disabled' : ''}`}
        >
          <select
            className="status-bar__branch-select custom-select"
            value={hasCurrentBranch ? branchLabel : ''}
            onChange={(event) => {
              const nextBranch = event.target.value.trim()
              if (!nextBranch || nextBranch === branchLabel || checkoutLoading) {
                return
              }
              void onCheckoutBranch(nextBranch)
            }}
            disabled={branchDisabled}
            title={branchLabel}
            aria-label={t(locale, 'statusBar.gitBranch')}
          >
            {!hasCurrentBranch ? (
              <option value="" disabled>
                {branchLabel}
              </option>
            ) : null}
            {gitBranches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.current ? `✓ ${branch.name}` : branch.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="status-bar__item status-bar__item--agents" title={t(locale, 'statusBar.agentsOnline')}>
        <span className="status-bar__abbr">AG</span>
        <span className="status-bar__value">{agentOnline}/{agentTotal}</span>
      </div>
      <div className="status-bar__item status-bar__item--terminals" title={t(locale, 'statusBar.terminalSessions')}>
        <span className="status-bar__abbr">TS</span>
        <span className="status-bar__value">{terminalSessions}</span>
      </div>
      <div className="status-bar__item status-bar__item--changes" title={t(locale, 'statusBar.gitChanges')}>
        <span className="status-bar__abbr">CHG</span>
        <span className="status-bar__value">{changedFilesCount}</span>
      </div>
    </footer>
  )
}
