import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'

interface BranchSectionProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
}

export const BranchSection = memo(function BranchSection({
  controller,
  collapsed,
  onToggle,
}: BranchSectionProps) {
  const {
    locale,
    isGitRepository,
    branches,
    checkoutTarget,
    setCheckoutTarget,
    newBranchName,
    setNewBranchName,
    selectedBranchEntry,
    actionLoading,
    checkout,
    createBranch,
    deleteBranch,
  } = controller

  const currentBranchEntry = branches.find((branch) => branch.current) ?? null

  return (
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={t(locale, 'git.branch.title')}
        count={branches.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="git-section__content">
          <div className="git-branch-panel">
            <div className="git-branch-panel__current">
              <span className="git-branch-panel__label">{t(locale, 'git.branch.currentLabel')}</span>
              <div className="git-branch-panel__value-wrap">
                <code className="git-branch-panel__value">{currentBranchEntry?.name ?? '—'}</code>
                <span className="git-branch-panel__count">
                  {t(locale, 'git.branch.count', { count: branches.length })}
                </span>
              </div>
            </div>

            <div className="git-branch-grid">
              <section className="git-branch-card">
                <div className="git-branch-card__header">
                  <strong className="git-branch-card__title">
                    {t(locale, 'git.branch.switchSection')}
                  </strong>
                </div>
                <label className="git-field">
                  <span className="git-field__label">{t(locale, 'git.branch.targetLabel')}</span>
                  <select
                    className="git-branch-form__select"
                    value={checkoutTarget}
                    onChange={(e) => setCheckoutTarget(e.target.value)}
                    disabled={!isGitRepository}
                  >
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.current ? `✓ ${branch.name}` : branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="git-branch-card__actions">
                  <GitIconButton
                    icon="git-merge"
                    label={t(locale, 'git.action.checkout')}
                    onClick={() => void checkout()}
                    disabled={!isGitRepository || !checkoutTarget || Boolean(actionLoading)}
                    showLabel
                  />
                  <GitIconButton
                    icon="trash"
                    label={t(locale, 'git.action.deleteBranch')}
                    onClick={() => void deleteBranch()}
                    disabled={!isGitRepository || !checkoutTarget || selectedBranchEntry?.current || Boolean(actionLoading)}
                    variant="danger"
                    showLabel
                  />
                </div>
              </section>

              <section className="git-branch-card git-branch-card--primary">
                <div className="git-branch-card__header">
                  <strong className="git-branch-card__title">
                    {t(locale, 'git.branch.createSection')}
                  </strong>
                </div>
                <label className="git-field">
                  <span className="git-field__label">{t(locale, 'git.branch.createLabel')}</span>
                  <input
                    type="text"
                    className="git-branch-form__input"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder={t(locale, 'git.branch.createPlaceholder')}
                    disabled={!isGitRepository}
                  />
                </label>
                <div className="git-branch-card__actions">
                  <GitIconButton
                    icon="plus"
                    label={t(locale, 'git.action.createBranch')}
                    onClick={() => void createBranch()}
                    disabled={!isGitRepository || !newBranchName.trim() || Boolean(actionLoading)}
                    variant="primary"
                    showLabel
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  )
})
