import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'

interface CommitFormProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
}

export const CommitForm = memo(function CommitForm({
  controller,
  collapsed,
  onToggle,
}: CommitFormProps) {
  const {
    locale,
    isGitRepository,
    hasStagedFiles,
    actionLoading,
    commitMessage,
    setCommitMessage,
    commit,
  } = controller

  return (
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={t(locale, 'git.commit.title')}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="git-section__content">
          <div className="git-commit-form">
            <input
              type="text"
              className="git-commit-form__input"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t(locale, 'git.commit.placeholder')}
              disabled={!isGitRepository}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && hasStagedFiles && commitMessage.trim()) {
                  e.preventDefault()
                  void commit()
                }
              }}
            />
            <div className="git-commit-form__actions">
              <GitIconButton
                icon="git-commit"
                label={t(locale, 'git.action.commit')}
                onClick={() => void commit()}
                disabled={!isGitRepository || !hasStagedFiles || !commitMessage.trim() || Boolean(actionLoading)}
                variant="primary"
                showLabel
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
})
