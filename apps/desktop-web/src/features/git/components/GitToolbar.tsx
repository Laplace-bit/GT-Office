import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'
import { getRepositoryDisplayLabel } from './git-helpers'

interface GitToolbarProps {
  controller: GitWorkspaceController
}

export const GitToolbar = memo(function GitToolbar({ controller }: GitToolbarProps) {
  const {
    locale,
    isGitRepository,
    summary,
    repositories,
    currentRepositoryPath,
    actionLoading,
    remoteActionLoading,
    fetch,
    pull,
    push,
    refreshAll,
  } = controller
  const activeRepository = repositories.find(
    (repository) => repository.repositoryPath === currentRepositoryPath,
  )
  const activeRepositoryLabel = activeRepository
    ? getRepositoryDisplayLabel(
        activeRepository.repositoryPath,
        activeRepository.root,
        t(locale, 'git.repositories.workspaceRoot'),
      )
    : null

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
        {repositories.length > 1 && activeRepositoryLabel ? (
          <span
            className="git-pane__repo-chip git-pane__repo-chip--active"
            title={currentRepositoryPath || t(locale, 'git.repositories.workspaceRoot')}
          >
            <span className="git-pane__repo-chip-dot" aria-hidden="true" />
            {activeRepositoryLabel}
          </span>
        ) : null}
      </div>
      <div className="git-pane__header-actions">
        <GitIconButton icon="refresh" label={t(locale, 'fileTree.refresh')} onClick={() => void refreshAll()} disabled={Boolean(actionLoading)} />
        <GitIconButton icon="cloud-download" label={t(locale, 'git.action.fetch')} onClick={() => void fetch()} disabled={!isGitRepository || Boolean(remoteActionLoading)} />
        <GitIconButton icon="arrow-down" label={t(locale, 'git.action.pull')} onClick={() => void pull()} disabled={!isGitRepository || Boolean(remoteActionLoading)} />
        <GitIconButton icon="arrow-up" label={t(locale, 'git.action.push')} onClick={() => void push()} disabled={!isGitRepository || Boolean(remoteActionLoading)} />
      </div>
    </header>
  )
})
