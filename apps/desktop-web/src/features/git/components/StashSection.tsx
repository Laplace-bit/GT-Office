import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'

interface StashSectionProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
}

export const StashSection = memo(function StashSection({
  controller,
  collapsed,
  onToggle,
}: StashSectionProps) {
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
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={t(locale, 'git.stash.title')}
        count={stashEntries.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="git-section__content">
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
              {stashEntries.slice(0, 5).map((entry) => (
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
        </div>
      )}
    </section>
  )
})
