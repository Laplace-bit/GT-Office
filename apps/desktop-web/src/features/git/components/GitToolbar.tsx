import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'

interface GitToolbarProps {
  controller: GitWorkspaceController
}

export const GitToolbar = memo(function GitToolbar({ controller }: GitToolbarProps) {
  const {
    locale,
    isGitRepository,
    summary,
    actionLoading,
    fetch,
    pull,
    push,
    refreshAll,
  } = controller

  return (
    <header className="git-pane__header">
      <div className="git-pane__header-left">
        <AppIcon name="git-branch" className="git-pane__branch-icon" />
        <div className="git-pane__branch-info">
          <span className="git-pane__branch-name">{summary?.branch || (isGitRepository ? 'main' : '—')}</span>
          <span className="git-pane__branch-status">
            {summary ? (
              <>
                <span className="git-pane__ahead">↑{summary.ahead}</span>
                <span className="git-pane__behind">↓{summary.behind}</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>
      <div className="git-pane__header-actions">
        <GitIconButton icon="refresh" label={t(locale, 'fileTree.refresh')} onClick={() => void refreshAll()} disabled={Boolean(actionLoading)} />
        <GitIconButton icon="cloud-download" label={t(locale, 'git.action.fetch')} onClick={() => void fetch()} disabled={!isGitRepository || Boolean(actionLoading)} />
        <GitIconButton icon="arrow-down" label={t(locale, 'git.action.pull')} onClick={() => void pull()} disabled={!isGitRepository || Boolean(actionLoading)} />
        <GitIconButton icon="arrow-up" label={t(locale, 'git.action.push')} onClick={() => void push()} disabled={!isGitRepository || Boolean(actionLoading)} />
      </div>
    </header>
  )
})
