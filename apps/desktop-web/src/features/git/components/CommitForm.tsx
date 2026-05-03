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
    amendMode,
    setAmendMode,
    commit,
  } = controller

  const firstLine = commitMessage.split('\n')[0] || ''

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
            <textarea
              className="git-commit-form__input"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t(locale, 'git.commit.placeholder')}
              disabled={!isGitRepository}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void commit()
                }
              }}
            />
            <div className="git-commit-form__meta">
              <label className="git-commit-form__amend-toggle">
                <input
                  type="checkbox"
                  checked={amendMode}
                  onChange={(e) => setAmendMode(e.target.checked)}
                  disabled={!isGitRepository}
                />
                <span>{t(locale, 'git.commit.amend')}</span>
              </label>
              <div className="git-commit-form__info">
                <span className={`git-commit-form__char-count ${firstLine.length > 50 ? 'git-commit-form__char-count--over' : ''}`}>
                  {firstLine.length}/50
                </span>
                <span className="git-commit-form__shortcut-hint">
                  {t(locale, 'git.commit.shortcut')}
                </span>
              </div>
            </div>
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
