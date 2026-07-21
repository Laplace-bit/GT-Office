import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  type GitDiffScope,
  type GitWorkspaceController,
} from '../useGitWorkspaceController'
import { actualPxToRem, scaleDesignPxToActualPx } from '../git-font-scale'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'
import { GitFileRow } from './GitFileRow'
import { GitDirectoryTree } from './GitDirectoryTree'
import {
  resolveDiffScope,
  resolveDiscardKind,
  type GitDiscardKind,
} from './git-helpers'

interface ChangesSectionProps {
  controller: GitWorkspaceController
  collapsed: boolean
  onToggle: () => void
  rootFontSizePx: number
  onDiscardConfirm: (path: string, discardKind: GitDiscardKind) => void
  onDiscardAllConfirm: (paths: string[], includeUntracked: boolean) => void
}

type ChangeGroupKey = 'staged' | 'unstaged'

type ChangeListRow =
  | {
      type: 'group'
      key: ChangeGroupKey
      count: number
      actionable: boolean
      disabled: boolean
    }
  | {
      type: 'file'
      key: string
      group: ChangeGroupKey
      file: GitWorkspaceController['stagedFiles'][number]
    }

const GROUP_ROW_HEIGHT = 30

export const ChangesSection = memo(function ChangesSection({
  controller,
  collapsed,
  onToggle,
  rootFontSizePx,
  onDiscardConfirm,
  onDiscardAllConfirm,
}: ChangesSectionProps) {
  const [viewMode, setViewMode] = useState<'list' | 'directory'>('list')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<ChangeGroupKey, boolean>>({
    staged: false,
    unstaged: false,
  })
  const {
    locale,
    isGitRepository,
    summary,
    setFilter,
    selectedPath,
    selectPath,
    stagedFiles,
    unstagedFiles,
    hasStagedFiles,
    hasUnstagedFiles,
    actionLoading,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    preloadDiff,
  } = controller

  const totalFiles = summary?.totalChanges ?? summary?.files.length ?? 0
  const bulkActionsDisabled = Boolean(summary?.truncated)

  const toggleGroup = useCallback((group: ChangeGroupKey) => {
    setCollapsedGroups((current) => ({ ...current, [group]: !current[group] }))
  }, [])

  const handleSelectPath = useCallback(
    (path: string, scope: GitDiffScope) => {
      setFilter(scope)
      selectPath(path, scope)
    },
    [selectPath, setFilter],
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
  const handleDiscardAll = useCallback(() => {
    if (bulkActionsDisabled) {
      return
    }
    const paths = unstagedFiles.map((file) => file.path)
    if (paths.length === 0) {
      return
    }
    const includeUntracked = unstagedFiles.some((file) => resolveDiscardKind(file) === 'untracked')
    onDiscardAllConfirm(paths, includeUntracked)
  }, [bulkActionsDisabled, onDiscardAllConfirm, unstagedFiles])

  const repositoryPath =
    stagedFiles[0]?.repositoryPath ?? unstagedFiles[0]?.repositoryPath ?? undefined

  const renderGroupHeader = useCallback(
    (
      group: ChangeGroupKey,
      options?: { staticPosition?: boolean; style?: CSSProperties },
    ) => {
      const isStaged = group === 'staged'
      const isExpanded = !collapsedGroups[group]
      const count = isStaged ? stagedFiles.length : unstagedFiles.length
      const actionable = isStaged ? hasStagedFiles : hasUnstagedFiles
      const disabled = isStaged
        ? bulkActionsDisabled || !isGitRepository || !hasStagedFiles || Boolean(actionLoading)
        : bulkActionsDisabled || !isGitRepository || !hasUnstagedFiles || Boolean(actionLoading)
      const title = isStaged
        ? t(locale, 'git.repositories.staged')
        : t(locale, 'git.filter.unstaged')
      const actionLabel = isStaged
        ? t(locale, 'git.action.unstageAll')
        : t(locale, 'git.action.stageAll')
      const actionIcon = isStaged ? 'undo' : 'check'
      return (
        <div
          className={`git-file-group-row ${options?.staticPosition ? 'git-file-group-row--static' : ''}`}
          style={options?.style}
        >
          <button
            type="button"
            className="git-file-group-row__toggle"
            onClick={() => toggleGroup(group)}
            aria-expanded={isExpanded}
          >
            <AppIcon
              name={isExpanded ? 'chevron-down' : 'chevron-right'}
              className="git-file-group-row__chevron"
            />
            <span className="git-file-group-row__title">{title}</span>
            <span className="git-file-group-row__count">{count}</span>
          </button>
          {actionable ? (
            <div className="git-file-group-row__actions">
              {!isStaged ? (
                <GitIconButton
                  icon="trash"
                  label={t(locale, 'git.action.discardAll')}
                  onClick={handleDiscardAll}
                  disabled={disabled}
                  size="sm"
                  variant="danger"
                  title={t(locale, 'git.action.discardAll')}
                />
              ) : null}
              <GitIconButton
                icon={actionIcon}
                label={actionLabel}
                onClick={() => void (isStaged ? unstageAll() : stageAll())}
                disabled={disabled}
                size="sm"
                variant={isStaged ? 'default' : 'success'}
                title={actionLabel}
              />
            </div>
          ) : null}
        </div>
      )
    },
    [
      actionLoading,
      bulkActionsDisabled,
      collapsedGroups,
      handleDiscardAll,
      hasStagedFiles,
      hasUnstagedFiles,
      isGitRepository,
      locale,
      stageAll,
      stagedFiles.length,
      toggleGroup,
      unstageAll,
      unstagedFiles.length,
    ],
  )

  const fileRowHeight = scaleDesignPxToActualPx(ROW_HEIGHT, rootFontSizePx)
  const groupRowHeight = scaleDesignPxToActualPx(GROUP_ROW_HEIGHT, rootFontSizePx)
  const listRows = useMemo<ChangeListRow[]>(() => {
    const rows: ChangeListRow[] = [
      {
        type: 'group',
        key: 'staged',
        count: stagedFiles.length,
        actionable: hasStagedFiles,
        disabled: bulkActionsDisabled || !isGitRepository || !hasStagedFiles || Boolean(actionLoading),
      },
    ]

    if (!collapsedGroups.staged) {
      rows.push(
        ...stagedFiles.map((file) => ({
          type: 'file' as const,
          key: `staged:${file.path}`,
          group: 'staged' as const,
          file,
        })),
      )
    }

    rows.push({
      type: 'group',
      key: 'unstaged',
      count: unstagedFiles.length,
      actionable: hasUnstagedFiles,
      disabled: bulkActionsDisabled || !isGitRepository || !hasUnstagedFiles || Boolean(actionLoading),
    })

    if (!collapsedGroups.unstaged) {
      rows.push(
        ...unstagedFiles.map((file) => ({
          type: 'file' as const,
          key: `unstaged:${file.path}`,
          group: 'unstaged' as const,
          file,
        })),
      )
    }

    return rows
  }, [
    actionLoading,
    bulkActionsDisabled,
    collapsedGroups.staged,
    collapsedGroups.unstaged,
    hasStagedFiles,
    hasUnstagedFiles,
    isGitRepository,
    stagedFiles,
    unstagedFiles,
  ])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const fileVirtualizer = useVirtualizer({
    count: listRows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => (listRows[index]?.type === 'group' ? groupRowHeight : fileRowHeight),
    overscan: OVERSCAN_ROWS,
  })

  useLayoutEffect(() => {
    if (viewMode !== 'list') {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      fileVirtualizer.measure()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [collapsedGroups.staged, collapsedGroups.unstaged, fileVirtualizer, listRows.length, viewMode])

  return (
    <section
      className={`git-section git-section--changes ${!collapsed ? 'git-section--expanded' : ''}`}
    >
      <GitSectionHeader
        title={t(locale, 'git.files.title')}
        count={totalFiles}
        countVariant="tag"
        collapsed={collapsed}
        onToggle={onToggle}
        actions={
          <div
            className="git-view-toggle"
            role="group"
            aria-label={t(locale, 'git.files.view.ariaLabel')}
          >
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
        }
      />
      {!collapsed && (
        <div className="git-section__content">
          {summary?.truncated ? (
            <p className="git-files-truncated-note" role="status">
              {t(locale, 'git.files.truncated', {
                shown: summary.files.length,
                total: summary.totalChanges,
              })}
            </p>
          ) : null}
          {viewMode === 'list' ? (
            <div ref={viewportRef} className="git-file-list">
              <div
                className="git-file-list__inner"
                style={{ height: actualPxToRem(fileVirtualizer.getTotalSize(), rootFontSizePx) }}
              >
                {fileVirtualizer.getVirtualItems().map((virtualItem) => {
                  const row = listRows[virtualItem.index]
                  if (!row) return null
                  const style = { transform: `translateY(${actualPxToRem(virtualItem.start, rootFontSizePx)})` }
                  if (row.type === 'group') {
                    return (
                      <div key={`group:${row.key}`}>
                        {renderGroupHeader(row.key, { style })}
                      </div>
                    )
                  }

                  const { file, group } = row
                  const isActive = selectedPath === file.path
                  const discardKind = resolveDiscardKind(file)
                  const diffScope = resolveDiffScope(file, group)
                  return (
                    <GitFileRow
                      key={row.key}
                      file={file}
                      isActive={isActive}
                      locale={locale}
                      actionLoading={actionLoading}
                      actionMode={group}
                      onSelect={() => handleSelectPath(file.path, diffScope)}
                      onPreload={() => handlePreloadDiff(file.path, diffScope)}
                      onStage={() => handleStagePath(file.path)}
                      onUnstage={() => handleUnstagePath(file.path)}
                      onDiscard={() => handleDiscardPath(file.path, discardKind)}
                      style={style}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="git-file-list git-file-list--directory">
              <div className="git-file-groups">
                <section className="git-file-group">
                  {renderGroupHeader('staged', { staticPosition: true })}
                  {!collapsedGroups.staged ? (
                    <div className="git-file-group__body">
                      {stagedFiles.length > 0 ? (
                        <GitDirectoryTree
                          files={stagedFiles}
                          repositoryPath={repositoryPath}
                          locale={locale}
                          actionLoading={actionLoading}
                          filter="staged"
                          selectedPath={selectedPath}
                          onSelect={handleSelectPath}
                          onPreload={handlePreloadDiff}
                          onStage={handleStagePath}
                          onUnstage={handleUnstagePath}
                          onDiscard={handleDiscardPath}
                        />
                      ) : (
                        <div className="git-file-group__empty">
                          {t(locale, 'git.commit.empty')}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>

                <section className="git-file-group">
                  {renderGroupHeader('unstaged', { staticPosition: true })}
                  {!collapsedGroups.unstaged ? (
                    <div className="git-file-group__body">
                      {unstagedFiles.length > 0 ? (
                        <GitDirectoryTree
                          files={unstagedFiles}
                          repositoryPath={repositoryPath}
                          locale={locale}
                          actionLoading={actionLoading}
                          filter="unstaged"
                          selectedPath={selectedPath}
                          onSelect={handleSelectPath}
                          onPreload={handlePreloadDiff}
                          onStage={handleStagePath}
                          onUnstage={handleUnstagePath}
                          onDiscard={handleDiscardPath}
                        />
                      ) : (
                        <div className="git-file-group__empty">
                          {t(locale, 'git.files.noChanges')}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
})
