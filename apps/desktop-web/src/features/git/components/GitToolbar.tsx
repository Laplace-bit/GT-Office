import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'
import { GitMoreMenu } from './GitMoreMenu'

interface GitToolbarProps {
  controller: GitWorkspaceController
  onOpenBranches: () => void
  onOpenStash: () => void
  onOpenTags: () => void
}

export const GitToolbar = memo(function GitToolbar({
  controller,
  onOpenBranches,
  onOpenStash,
  onOpenTags,
}: GitToolbarProps) {
  const {
    locale,
    isGitRepository,
    summary,
    actionLoading,
    remoteActionLoading,
    fetch,
    pull,
    push,
    refreshAll,
  } = controller

  return (
    <header className="git-pane__header">
      <div className="git-pane__header-actions">
        <GitIconButton icon="refresh" label={t(locale, 'fileTree.refresh')} onClick={() => void refreshAll()} disabled={Boolean(actionLoading)} />
        <GitIconButton icon="cloud-download" label={t(locale, 'git.action.fetch')} onClick={() => void fetch()} disabled={!isGitRepository || Boolean(remoteActionLoading)} />
        <GitIconButton icon="arrow-down" label={t(locale, 'git.action.pull')} onClick={() => void pull()} disabled={!isGitRepository || Boolean(remoteActionLoading)} badge={summary?.behind ? summary.behind : undefined} />
        <GitIconButton icon="arrow-up" label={t(locale, 'git.action.push')} onClick={() => void push()} disabled={!isGitRepository || Boolean(remoteActionLoading)} badge={summary?.ahead ? summary.ahead : undefined} />
        <span className="git-pane__header-divider" />
        <GitMoreMenu
          locale={locale}
          onOpenBranches={onOpenBranches}
          onOpenStash={onOpenStash}
          onOpenTags={onOpenTags}
        />
      </div>
    </header>
  )
})