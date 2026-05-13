import { memo, useCallback, useMemo, useState } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { GitDiffScope, GitWorkspaceController } from '../useGitWorkspaceController'
import { actualPxToRem } from '../git-font-scale'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'
import { GitFileRow } from './GitFileRow'
import {
  getCompactPathTail,
  getCompactRepoLabel,
  getDirectoryLabel,
  hasStagedChanges,
  hasUnstagedChanges,
  resolveDiffScope,
  resolveDiscardKind,
  type GitDiscardKind,
} from './git-helpers'

interface ChangesSectionProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
  changesSectionHeight: number | null
  rootFontSizePx: number
  viewportRef: React.RefObject<HTMLDivElement | null>
  fileVirtualizer: Virtualizer<HTMLDivElement, Element>
  onDiscardConfirm: (path: string, discardKind: GitDiscardKind) => void
}

export const ChangesSection = memo(function ChangesSection({
  controller,
  collapsed,
  onToggle,
  changesSectionHeight,
  rootFontSizePx,
  viewportRef,
  fileVirtualizer,
  onDiscardConfirm,
}: ChangesSectionProps) {
  const [viewMode, setViewMode] = useState<'list' | 'directory'>('list')
  const {
    locale,
    isGitRepository,
    summary,
    visibleFiles,
    filter,
    setFilter,
    selectedPath,
    selectPath,
    hasStagedFiles,
    hasUnstagedFiles,
    actionLoading,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    preloadDiff,
  } = controller

  const totalFiles = summary?.files.length ?? 0
  const showStageAllAction = filter !== 'staged'
  const showUnstageAllAction = filter !== 'unstaged'
  const directoryGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        repoLabel: string | null
        directoryLabel: string
        files: typeof visibleFiles
      }
    >()

    for (const file of visibleFiles) {
      const repoLabel = file.repositoryPath
        ? getCompactRepoLabel(file.repositoryPath)
        : null
      const directorySource = file.repoRelativePath || file.path
      const directoryLabel = getDirectoryLabel(directorySource)
      const key = `${repoLabel ?? ''}::${directoryLabel}`
      const existing = groups.get(key)
      if (existing) {
        existing.files.push(file)
        continue
      }
      groups.set(key, {
        key,
        repoLabel,
        directoryLabel,
        files: [file],
      })
    }

    return Array.from(groups.values()).sort((left, right) => left.key.localeCompare(right.key))
  }, [visibleFiles])

  const handleSelectPath = useCallback(
    (path: string, scope: GitDiffScope) => selectPath(path, scope),
    [selectPath],
  )
  const handlePreloadDiff = useCallback(
    (path: string, scope: GitDiffScope) => preloadDiff(path, scope),
    [preloadDiff],
  )
  const handleStagePath = useCallback((path: string) => void stagePath(path), [stagePath])
  const handleUnstagePath = useCallback((path: string) => void unstagePath(path), [unstagePath])
  const handleDiscardPath = useCallback(
    (path: string, discardKind: GitDiscardKind) => onDiscardConfirm(path, discardKind),
    [onDiscardConfirm],
  )

  return (
    <section
      className={`git-section git-section--changes ${!collapsed ? 'git-section--expanded' : ''}`}
      style={
        !collapsed && changesSectionHeight
          ? { height: actualPxToRem(changesSectionHeight, rootFontSizePx) }
          : undefined
      }
    >
      <GitSectionHeader
        title={t(locale, 'git.files.title')}
        count={totalFiles}
        countLabel={t(locale, 'git.files.countLabel')}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="git-section__content">
          {/* Filter Chips */}
          <div className="git-filter-bar">
            <div className="git-filter-bar__primary">
              <div className="git-filter-chips" role="group">
                {(['all', 'staged', 'unstaged'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`git-filter-chip ${filter === f ? 'git-filter-chip--active' : ''}`}
                    onClick={() => setFilter(f)}
                  >
                    {t(locale, `git.filter.${f}`)}
                  </button>
                ))}
              </div>
              <div className="git-view-toggle" role="group" aria-label={t(locale, 'git.files.view.ariaLabel')}>
                <button
                  type="button"
                  className={`git-view-toggle__btn ${viewMode === 'list' ? 'git-view-toggle__btn--active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title={t(locale, 'git.files.view.list')}
                  aria-label={t(locale, 'git.files.view.list')}
                >
                  <AppIcon name="file-text" className="git-view-toggle__icon" />
                </button>
                <button
                  type="button"
                  className={`git-view-toggle__btn ${viewMode === 'directory' ? 'git-view-toggle__btn--active' : ''}`}
                  onClick={() => setViewMode('directory')}
                  title={t(locale, 'git.files.view.directory')}
                  aria-label={t(locale, 'git.files.view.directory')}
                >
                  <AppIcon name="files" className="git-view-toggle__icon" />
                </button>
              </div>
            </div>
            <div className="git-filter-actions">
              {showStageAllAction ? (
                <GitIconButton
                  icon="check"
                  label={t(locale, 'git.action.stageAll')}
                  onClick={() => void stageAll()}
                  disabled={!isGitRepository || !hasUnstagedFiles || Boolean(actionLoading)}
                  variant="success"
                  size="sm"
                  title={t(locale, 'git.action.stageAll')}
                />
              ) : null}
              {showUnstageAllAction ? (
                <GitIconButton
                  icon="x-mark"
                  label={t(locale, 'git.action.unstageAll')}
                  onClick={() => void unstageAll()}
                  disabled={!isGitRepository || !hasStagedFiles || Boolean(actionLoading)}
                  size="sm"
                  title={t(locale, 'git.action.unstageAll')}
                />
              ) : null}
            </div>
          </div>

          {viewMode === 'list' ? (
            <div ref={viewportRef} className="git-file-list">
              <div
                className="git-file-list__inner"
                style={{ height: actualPxToRem(fileVirtualizer.getTotalSize(), rootFontSizePx) }}
              >
                {fileVirtualizer.getVirtualItems().map((virtualItem) => {
                  const file = visibleFiles[virtualItem.index]
                  if (!file) return null
                  const isActive = selectedPath === file.path
                  const fileHasStagedChanges = hasStagedChanges(file)
                  const fileHasUnstagedChanges = hasUnstagedChanges(file)
                  const discardKind = resolveDiscardKind(file)
                  const diffScope = resolveDiffScope(file, filter)
                  const actionMode =
                    filter === 'staged'
                      ? 'staged'
                      : filter === 'unstaged'
                        ? 'unstaged'
                        : fileHasStagedChanges && fileHasUnstagedChanges
                          ? 'mixed'
                          : fileHasStagedChanges
                            ? 'staged'
                            : 'unstaged'
                  return (
                    <GitFileRow
                      key={file.path}
                      file={file}
                      isActive={isActive}
                      locale={locale}
                      actionLoading={actionLoading}
                      actionMode={actionMode}
                      onSelect={() => handleSelectPath(file.path, diffScope)}
                      onPreload={() => handlePreloadDiff(file.path, diffScope)}
                      onStage={() => handleStagePath(file.path)}
                      onUnstage={() => handleUnstagePath(file.path)}
                      onDiscard={() => handleDiscardPath(file.path, discardKind)}
                      style={{ transform: `translateY(${actualPxToRem(virtualItem.start, rootFontSizePx)})` }}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="git-directory-list">
              {directoryGroups.map((group) => (
                <section key={group.key} className="git-directory-group">
                  <header className="git-directory-group__header">
                    <div className="git-directory-group__title">
                      <AppIcon name="folder-open" className="git-directory-group__icon" />
                      <span
                        className="git-directory-group__name"
                        title={
                          group.directoryLabel === '.'
                            ? t(locale, 'git.files.view.rootDirectory')
                            : group.directoryLabel
                        }
                      >
                        {group.directoryLabel === '.'
                          ? t(locale, 'git.files.view.rootDirectory')
                          : getCompactPathTail(group.directoryLabel)}
                      </span>
                      {group.repoLabel ? (
                        <span className="git-directory-group__repo">{group.repoLabel}</span>
                      ) : null}
                    </div>
                    <span className="git-directory-group__count">{group.files.length}</span>
                  </header>
                  <div className="git-directory-group__files">
                    {group.files.map((file) => {
                      const isActive = selectedPath === file.path
                      const fileHasStagedChanges = hasStagedChanges(file)
                      const fileHasUnstagedChanges = hasUnstagedChanges(file)
                      const discardKind = resolveDiscardKind(file)
                      const diffScope = resolveDiffScope(file, filter)
                      const actionMode =
                        filter === 'staged'
                          ? 'staged'
                          : filter === 'unstaged'
                            ? 'unstaged'
                            : fileHasStagedChanges && fileHasUnstagedChanges
                              ? 'mixed'
                              : fileHasStagedChanges
                                ? 'staged'
                                : 'unstaged'
                      return (
                        <GitFileRow
                          key={file.path}
                          file={file}
                          isActive={isActive}
                          locale={locale}
                          actionLoading={actionLoading}
                          actionMode={actionMode}
                          onSelect={() => handleSelectPath(file.path, diffScope)}
                          onPreload={() => handlePreloadDiff(file.path, diffScope)}
                          onStage={() => handleStagePath(file.path)}
                          onUnstage={() => handleUnstagePath(file.path)}
                          onDiscard={() => handleDiscardPath(file.path, discardKind)}
                          style={undefined}
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
})
