import { memo, useMemo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { shouldShowRepositorySection } from '../controllers/repository-selection-model'
import {
  getRepositoryDisplayLabel,
} from './git-helpers'
import { GitIconButton } from './GitIconButton'
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

  if (!shouldShowRepositorySection(repositories)) {
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
              const state = repository.state ?? 'ready'
              const isReady = state === 'ready'
              const isSubmodule = repository.kind === 'submodule'
              const isInitializing =
                controller.actionLoading === `submodule-update:${repository.repositoryPath}`
              const stateLabel = state === 'uninitialized'
                ? t(locale, 'git.repositories.uninitialized')
                : state === 'invalid'
                  ? t(locale, 'git.repositories.invalid')
                  : null
              const changeCount = repository.totalChanges ?? repository.files.length
              return (
                <div
                  key={repository.repositoryPath}
                  className={`git-repo-row ${isActive ? 'git-repo-row--active' : ''} ${!isReady ? 'git-repo-row--unavailable' : ''}`}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="git-repo-row__select"
                    onClick={() => setCurrentRepositoryPath(repository.repositoryPath)}
                    disabled={!isReady}
                    aria-pressed={isActive}
                    title={`${repository.repositoryPath || '.'}${stateLabel ? ` - ${stateLabel}` : ''}`}
                  >
                    <span className="git-repo-row__main">
                      <span className="git-repo-row__title">
                        <AppIcon
                          name={isSubmodule ? 'link' : 'folder-open'}
                          className="git-repo-row__icon"
                        />
                        <span className="git-repo-row__name">{label}</span>
                      </span>
                      <span className="git-repo-row__meta">
                        {isSubmodule && isReady ? (
                          <span className="git-repo-row__kind">
                            {t(locale, 'git.repositories.submodule')}
                          </span>
                        ) : null}
                        <span className="git-repo-row__branch">
                          {stateLabel ?? repository.branch}
                        </span>
                      </span>
                    </span>
                    {changeCount > 0 ? (
                      <span
                        className="git-repo-row__count"
                        title={t(locale, 'git.files.count', { count: changeCount })}
                      >
                        {changeCount}
                      </span>
                    ) : null}
                  </button>
                  {state === 'uninitialized' ? (
                    <GitIconButton
                      icon={isInitializing ? 'activity' : 'cloud-download'}
                      label={t(
                        locale,
                        isInitializing
                          ? 'git.repositories.initializing'
                          : 'git.repositories.initialize',
                      )}
                      onClick={() => void controller.initializeSubmodule(repository.repositoryPath)}
                      disabled={Boolean(controller.actionLoading)}
                      size="sm"
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
})
