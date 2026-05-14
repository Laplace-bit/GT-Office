import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'

interface StashDialogProps {
  controller: GitWorkspaceController
}

export const StashDialog = memo(function StashDialog({ controller }: StashDialogProps) {
  const {
    locale,
    isGitRepository,
    hasUnstagedFiles,
    actionLoading,
    stashMessage,
    setStashMessage,
    stashEntries,
    stashPush,
    stashPop,
  } = controller

  return (
    <>
      <div className="git-stash-form">
        <div className="git-stash-form__row">
          <input
            type="text"
            className="git-stash-form__input"
            value={stashMessage}
            onChange={(e) => setStashMessage(e.target.value)}
            placeholder={t(locale, 'git.stash.messagePlaceholder')}
            disabled={!isGitRepository}
          />
          <GitIconButton
            icon="archive"
            label={t(locale, 'git.action.stashPush')}
            onClick={() => void stashPush()}
            disabled={!isGitRepository || !hasUnstagedFiles || Boolean(actionLoading)}
            showLabel
          />
        </div>
      </div>
      {stashEntries.length > 0 && (
        <div className="git-stash-list">
          {stashEntries.map((entry) => (
            <div className="git-stash-item" key={entry.stash}>
              <div className="git-stash-item__info">
                <code className="git-stash-item__id">{entry.stash}</code>
                <span className="git-stash-item__summary">{entry.summary}</span>
              </div>
              <GitIconButton
                icon="arrow-down"
                label={t(locale, 'git.action.stashPop')}
                onClick={() => void stashPop(entry.stash)}
                disabled={!isGitRepository || Boolean(actionLoading)}
                size="sm"
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
})