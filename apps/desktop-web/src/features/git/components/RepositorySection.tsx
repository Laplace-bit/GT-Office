import { memo, useMemo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import {
  getRepositoryDisplayLabel,
  hasStagedChanges,
  hasUnstagedChanges,
} from './git-helpers'
import { GitSectionHeader } from './GitSectionHeader'

interface RepositorySectionProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
}

export const RepositorySection = memo(function RepositorySection({
  controller,
  collapsed,
  onToggle,
}: RepositorySectionProps) {
  const {
    locale,
    repositories,
    currentRepositoryPath,
    setCurrentRepositoryPath,
  } = controller

  const repositoryRows = useMemo(
    () =>
      repositories.map((repository) => ({
        repository,
        label: getRepositoryDisplayLabel(
          repository.repositoryPath,
          repository.root,
          t(locale, 'git.repositories.workspaceRoot'),
        ),
        stagedCount: repository.files.filter(hasStagedChanges).length,
        unstagedCount: repository.files.filter(hasUnstagedChanges).length,
      })),
    [locale, repositories],
  )

  if (repositories.length <= 1) {
    return null
  }

  return (
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={t(locale, 'git.repositories.title')}
        count={repositories.length}
        countLabel={t(locale, 'git.repositories.countLabel')}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed ? (
        <div className="git-section__content">
          <div className="git-repo-list" role="list">
            {repositoryRows.map(({ repository, label, stagedCount, unstagedCount }) => {
              const isActive = repository.repositoryPath === currentRepositoryPath
              return (
                <button
                  key={repository.repositoryPath}
                  type="button"
                  className={`git-repo-row ${isActive ? 'git-repo-row--active' : ''}`}
                  onClick={() => setCurrentRepositoryPath(repository.repositoryPath || null)}
                  title={repository.repositoryPath || '.'}
                >
                  <span className="git-repo-row__main">
                    <span className="git-repo-row__title">
                      <AppIcon name="folder-open" className="git-repo-row__icon" />
                      <span className="git-repo-row__name">{label}</span>
                      {isActive ? (
                        <span className="git-repo-row__active">
                          {t(locale, 'git.repositories.active')}
                        </span>
                      ) : null}
                    </span>
                    <span className="git-repo-row__branch">
                      <span className="git-repo-row__branch-name">{repository.branch || 'HEAD'}</span>
                      <span>↑{repository.ahead}</span>
                      <span>↓{repository.behind}</span>
                    </span>
                  </span>
                  <span className="git-repo-row__counts">
                    <span className="git-repo-row__count git-repo-row__count--staged">
                      {t(locale, 'git.repositories.staged')} {stagedCount}
                    </span>
                    <span className="git-repo-row__count git-repo-row__count--unstaged">
                      {t(locale, 'git.repositories.unstaged')} {unstagedCount}
                    </span>
                    <span className="git-repo-row__count">
                      {t(locale, 'git.repositories.total')} {repository.files.length}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
})
