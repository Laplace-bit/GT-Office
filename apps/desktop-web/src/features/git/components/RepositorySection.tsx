import { memo, useMemo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import {
  getRepositoryDisplayLabel,
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
      })),
    [locale, repositories],
  )

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

  if (repositories.length <= 1) {
    return null
  }

  return (
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={`${t(locale, 'git.repositories.title')}${activeRepositoryLabel ? ` - ${activeRepositoryLabel}` : ''}`}
        count={repositories.length}
        countLabel={t(locale, 'git.repositories.countLabel')}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed ? (
        <div className="git-section__content">
          <div className="git-repo-list" role="list">
            {repositoryRows.map(({ repository, label }) => {
              const isActive = repository.repositoryPath === currentRepositoryPath
              return (
                <button
                  key={repository.repositoryPath}
                  type="button"
                  className={`git-repo-row ${isActive ? 'git-repo-row--active' : ''}`}
                  onClick={() => setCurrentRepositoryPath(repository.repositoryPath)}
                  title={repository.repositoryPath || '.'}
                >
                  <span className="git-repo-row__main">
                    <span className="git-repo-row__title">
                      <AppIcon name="folder-open" className="git-repo-row__icon" />
                      <span className="git-repo-row__name">{label}</span>
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
