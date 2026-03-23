import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon, type AppIconName } from '@shell/ui/icons'
import {
  desktopApi,
  type GitCommitDetailResponse,
  type GitDiffExpansionResponse,
  type GitStatusFile,
} from '@shell/integration/desktop-api'
import {
  ROW_HEIGHT,
  OVERSCAN_ROWS,
  type GitDiffScope,
  type GitWorkspaceController,
} from './useGitWorkspaceController'
import { DiffViewer } from './DiffViewer'
import { GitGraphView } from './GitGraphView'
import {
  actualPxToRem,
  scaleDesignPxToActualPx,
  useRootFontSizePx,
} from './git-font-scale'

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

function getFileName(path: string): string {
  const normalizedPath = path.trim().replace(/\/+$/, '')
  if (!normalizedPath) {
    return path
  }
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath
}

function hasStagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return false
  }
  if (file.status.length >= 2) {
    const indexStatus = file.status[0] ?? ' '
    return indexStatus !== ' ' && indexStatus !== '?'
  }
  return file.staged
}

function hasUnstagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return true
  }
  if (file.status.length >= 2) {
    const worktreeStatus = file.status[1] ?? ' '
    return worktreeStatus !== ' '
  }
  return !file.staged && file.status.trim().length > 0
}

function resolveDiffScope(file: GitStatusFile, filter: 'all' | 'staged' | 'unstaged'): GitDiffScope {
  if (filter === 'staged') {
    return 'staged'
  }
  if (filter === 'unstaged') {
    return 'unstaged'
  }
  return hasUnstagedChanges(file) ? 'unstaged' : 'staged'
}

const MIN_CHANGES_SECTION_BASE_HEIGHT = 180

// ============================================
// Icon Button Component - Reusable button with icon
// ============================================
interface GitIconButtonProps {
  icon: AppIconName
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'success' | 'danger'
  size?: 'sm' | 'md'
  showLabel?: boolean
  title?: string
}

const GitIconButton = memo(function GitIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  variant = 'default',
  size = 'md',
  showLabel = false,
  title,
}: GitIconButtonProps) {
  return (
    <button
      type="button"
      className={`git-icon-btn git-icon-btn--${variant} git-icon-btn--${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
    >
      <AppIcon name={icon} className="git-icon-btn__icon" />
      {showLabel && <span className="git-icon-btn__label">{label}</span>}
    </button>
  )
})

// ============================================
// Section Header Component
// ============================================
interface GitSectionHeaderProps {
  title: string
  count?: number
  countLabel?: string
  collapsed?: boolean
  onToggle?: () => void
}

const GitSectionHeader = memo(function GitSectionHeader({
  title,
  count,
  countLabel,
  collapsed,
  onToggle,
}: GitSectionHeaderProps) {
  return (
    <header className="git-section-header" onClick={onToggle}>
      {onToggle && (
        <AppIcon
          name={collapsed ? 'chevron-right' : 'chevron-down'}
          className="git-section-header__toggle"
        />
      )}
      <strong className="git-section-header__title">{title}</strong>
      {count !== undefined && (
        <span className="git-section-header__count">
          {count} {countLabel}
        </span>
      )}
    </header>
  )
})

// ============================================
// High-Performance File Row Component
// ============================================
interface GitFileRowProps {
  file: GitStatusFile
  isActive: boolean
  locale: 'zh-CN' | 'en-US'
  actionLoading: string | null
  actionMode: 'staged' | 'unstaged' | 'mixed'
  onSelect: () => void
  onPreload: () => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  style: React.CSSProperties
}

const GitFileRow = memo(function GitFileRow({
  file,
  isActive,
  locale,
  actionLoading,
  actionMode,
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
  style,
}: GitFileRowProps) {
  const fileName = getFileName(file.path)
  return (
    <div
      className={`git-file-row ${isActive ? 'git-file-row--active' : ''}`}
      style={style}
    >
      <button
        type="button"
        className="git-file-row__select"
        onClick={onSelect}
        onMouseEnter={onPreload}
        title={file.path}
        aria-label={file.path}
      >
        <span
          className={`git-file-row__status ${file.staged ? 'git-file-row__status--staged' : 'git-file-row__status--unstaged'}`}
        >
          {file.status || '—'}
        </span>
        <span className="git-file-row__path">{fileName}</span>
      </button>
      <div className="git-file-row__actions">
        {actionMode === 'staged' ? (
          <GitIconButton
            icon="undo"
            label={t(locale, 'git.action.unstage')}
            onClick={onUnstage}
            disabled={Boolean(actionLoading)}
            size="sm"
          />
        ) : actionMode === 'mixed' ? (
          <>
            <GitIconButton
              icon="check"
              label={t(locale, 'git.action.stage')}
              onClick={onStage}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="success"
            />
            <GitIconButton
              icon="undo"
              label={t(locale, 'git.action.unstage')}
              onClick={onUnstage}
              disabled={Boolean(actionLoading)}
              size="sm"
            />
            <GitIconButton
              icon="rotate-ccw"
              label={t(locale, 'git.action.discard')}
              onClick={() => onDiscard()}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="danger"
            />
          </>
        ) : (
          <>
            <GitIconButton
              icon="check"
              label={t(locale, 'git.action.stage')}
              onClick={onStage}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="success"
            />
            <GitIconButton
              icon="rotate-ccw"
              label={t(locale, 'git.action.discard')}
              onClick={() => onDiscard()}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="danger"
            />
          </>
        )}
      </div>
    </div>
  )
})

interface GitDiscardConfirmDialogProps {
  locale: 'zh-CN' | 'en-US'
  path: string
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}

const GitDiscardConfirmDialog = memo(function GitDiscardConfirmDialog({
  locale,
  path,
  loading,
  onClose,
  onConfirm,
}: GitDiscardConfirmDialogProps) {
  const fileName = getFileName(path)
  return (
    <div className="git-confirm-modal-overlay" onClick={loading ? undefined : onClose}>
      <section
        className="git-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-discard-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="git-confirm-modal__header">
          <span className="git-confirm-modal__eyebrow">{t(locale, 'git.confirm.discardEyebrow')}</span>
          <h3 id="git-discard-confirm-title">{t(locale, 'git.confirm.discardTitle')}</h3>
        </header>
        <div className="git-confirm-modal__body">
          <div className="git-confirm-modal__path-card" title={path}>
            <strong className="git-confirm-modal__path-name">{fileName}</strong>
          </div>
        </div>
        <footer className="git-confirm-modal__footer">
          <button type="button" className="v-btn v-btn-secondary" onClick={onClose} disabled={loading}>
            {t(locale, 'git.action.cancel')}
          </button>
          <button
            type="button"
            className="v-btn v-btn-danger git-confirm-modal__danger-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            <span className="git-confirm-modal__danger-signal" aria-hidden="true" />
            {t(locale, 'git.action.discard')}
          </button>
        </footer>
      </section>
    </div>
  )
})

interface GitNoticeBannerProps {
  locale: 'zh-CN' | 'en-US'
  message: string
  onDismiss: () => void
}

const GitNoticeBanner = memo(function GitNoticeBanner({
  locale,
  message,
  onDismiss,
}: GitNoticeBannerProps) {
  return (
    <div className="git-pane__notice" role="status" aria-live="polite">
      <span className="git-pane__notice-message">{message}</span>
      <button
        type="button"
        className="git-pane__notice-dismiss"
        onClick={onDismiss}
        aria-label={t(locale, 'settingsModal.close')}
        title={t(locale, 'settingsModal.close')}
      >
        <AppIcon name="x-mark" />
      </button>
    </div>
  )
})

// ============================================
// Git Operations Pane Component
// ============================================
interface GitOperationsPaneProps {
  controller: GitWorkspaceController
}

export function GitOperationsPane({ controller }: GitOperationsPaneProps) {
  const {
    locale,
    workspaceId,
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
    errorMessage,
    repositoryNotice,
    dismissRepositoryNotice,
    commitMessage,
    setCommitMessage,
    stashMessage,
    setStashMessage,
    checkoutTarget,
    setCheckoutTarget,
    newBranchName,
    setNewBranchName,
    selectedBranchEntry,
    branches,
    stashEntries,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    discardPath,
    commit,
    checkout,
    createBranch,
    deleteBranch,
    stashPush,
    stashPop,
    fetch,
    pull,
    push,
    refreshAll,
    refreshSummary,
    preloadDiff,
  } = controller

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    commit: true,
    branches: true,
    stash: true,
  })
  const [discardConfirmState, setDiscardConfirmState] = useState<{
    path: string
    includeUntracked: boolean
  } | null>(null)
  const [changesSectionHeight, setChangesSectionHeight] = useState<number | null>(null)
  const rootFontSizePx = useRootFontSizePx()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const filterRefreshInitializedRef = useRef(false)

  useEffect(() => {
    filterRefreshInitializedRef.current = false
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }
    void refreshAll()
  }, [refreshAll, workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }
    if (!filterRefreshInitializedRef.current) {
      filterRefreshInitializedRef.current = true
      return
    }
    void refreshSummary()
  }, [filter, refreshSummary, workspaceId])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const fileRowHeight = scaleDesignPxToActualPx(ROW_HEIGHT, rootFontSizePx)

  const fileVirtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => fileRowHeight,
    overscan: OVERSCAN_ROWS,
  })

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  useEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) {
      return
    }

    const updateChangesSectionHeight = () => {
      if (collapsedSections.changes) {
        setChangesSectionHeight(null)
        return
      }
      const minHeight = scaleDesignPxToActualPx(MIN_CHANGES_SECTION_BASE_HEIGHT, rootFontSizePx)
      setChangesSectionHeight(Math.max(minHeight, Math.floor(contentElement.clientHeight * 0.5)))
    }

    updateChangesSectionHeight()
    const observer = new ResizeObserver(updateChangesSectionHeight)
    observer.observe(contentElement)
    return () => {
      observer.disconnect()
    }
  }, [collapsedSections.changes, rootFontSizePx])

  useEffect(() => {
    fileVirtualizer.measure()
  }, [fileRowHeight, fileVirtualizer])

  // Memoized callbacks for file actions
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
    (path: string, isUntracked: boolean) =>
      setDiscardConfirmState({
        path,
        includeUntracked: isUntracked,
      }),
    [],
  )
  const closeDiscardConfirm = useCallback(() => {
    if (actionLoading === 'discard') {
      return
    }
    setDiscardConfirmState(null)
  }, [actionLoading])
  const confirmDiscardPath = useCallback(async () => {
    if (!discardConfirmState) {
      return
    }
    try {
      await discardPath(discardConfirmState.path, discardConfirmState.includeUntracked)
    } finally {
      setDiscardConfirmState(null)
    }
  }, [discardConfirmState, discardPath])

  const totalFiles = summary?.files.length ?? 0
  const currentBranchEntry = branches.find((branch) => branch.current) ?? null
  const showStageAllAction = filter !== 'staged'
  const showUnstageAllAction = filter !== 'unstaged'
  const discardConfirmModal = discardConfirmState ? (
    <GitDiscardConfirmDialog
      locale={locale}
      path={discardConfirmState.path}
      loading={actionLoading === 'discard'}
      onClose={closeDiscardConfirm}
      onConfirm={() => void confirmDiscardPath()}
    />
  ) : null

  if (!workspaceId) {
    return (
      <>
        <section className="git-pane git-ops-pane">
          <div className="git-pane__empty">
            <AppIcon name="git" className="git-pane__empty-icon" />
            <h2>{t(locale, 'pane.git.title')}</h2>
            <p>{t(locale, 'git.workspaceRequired')}</p>
          </div>
        </section>
        {discardConfirmModal}
      </>
    )
  }

  return (
    <>
      <section className="git-pane git-ops-pane">
        {/* Header */}
        <header className="git-pane__header">
          <div className="git-pane__header-left">
            <AppIcon name="git-branch" className="git-pane__branch-icon" />
            <div className="git-pane__branch-info">
              <span className="git-pane__branch-name">{summary?.branch || (isGitRepository ? 'main' : '—')}</span>
              <span className="git-pane__branch-status">
                {summary ? (
                  <>
                    <span className="git-pane__ahead">↑{summary.ahead}</span>
                    <span className="git-pane__behind">↓{summary.behind}</span>
                  </>
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>
          <div className="git-pane__header-actions">
            <GitIconButton icon="refresh" label={t(locale, 'fileTree.refresh')} onClick={() => void refreshAll()} disabled={Boolean(actionLoading)} />
            <GitIconButton icon="cloud-download" label={t(locale, 'git.action.fetch')} onClick={() => void fetch()} disabled={!isGitRepository || Boolean(actionLoading)} />
            <GitIconButton icon="arrow-down" label={t(locale, 'git.action.pull')} onClick={() => void pull()} disabled={!isGitRepository || Boolean(actionLoading)} />
            <GitIconButton icon="arrow-up" label={t(locale, 'git.action.push')} onClick={() => void push()} disabled={!isGitRepository || Boolean(actionLoading)} />
          </div>
        </header>

        {repositoryNotice ? (
          <GitNoticeBanner
            locale={locale}
            message={repositoryNotice}
            onDismiss={dismissRepositoryNotice}
          />
        ) : null}
        {errorMessage ? <div className="git-pane__error">{errorMessage}</div> : null}

        {/* Scrollable content area */}
        <div ref={contentRef} className="git-pane__content">
          {/* Changes Section */}
          <section
            className={`git-section git-section--changes ${!collapsedSections.changes ? 'git-section--expanded' : ''}`}
            style={
              !collapsedSections.changes && changesSectionHeight
                ? { height: actualPxToRem(changesSectionHeight, rootFontSizePx) }
                : undefined
            }
          >
            <GitSectionHeader
              title={t(locale, 'git.files.title')}
              count={totalFiles}
              countLabel={t(locale, 'git.files.countLabel')}
              collapsed={collapsedSections.changes}
              onToggle={() => toggleSection('changes')}
            />
            {!collapsedSections.changes && (
              <div className="git-section__content">
                {/* Filter Chips */}
                <div className="git-filter-bar">
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

                {/* File List with Virtual Scrolling */}
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
                      const isUntracked = file.status.startsWith('??')
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
                          onDiscard={() => handleDiscardPath(file.path, isUntracked)}
                          style={{ transform: `translateY(${actualPxToRem(virtualItem.start, rootFontSizePx)})` }}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Commit Section */}
          <section className={`git-section ${!collapsedSections.commit ? 'git-section--expanded' : ''}`}>
            <GitSectionHeader
              title={t(locale, 'git.commit.title')}
              collapsed={collapsedSections.commit}
              onToggle={() => toggleSection('commit')}
            />
            {!collapsedSections.commit && (
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

          {/* Branch Section */}
          <section className={`git-section ${!collapsedSections.branches ? 'git-section--expanded' : ''}`}>
            <GitSectionHeader
              title={t(locale, 'git.branch.title')}
              count={branches.length}
              collapsed={collapsedSections.branches}
              onToggle={() => toggleSection('branches')}
            />
            {!collapsedSections.branches && (
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

          {/* Stash Section */}
          <section className={`git-section ${!collapsedSections.stash ? 'git-section--expanded' : ''}`}>
            <GitSectionHeader
              title={t(locale, 'git.stash.title')}
              count={stashEntries.length}
              collapsed={collapsedSections.stash}
              onToggle={() => toggleSection('stash')}
            />
            {!collapsedSections.stash && (
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
        </div>
      </section>
      {discardConfirmModal}
    </>
  )
}

// ============================================
// ============================================
// Git History Pane Component
// ============================================
interface GitHistoryPaneProps {
  controller: GitWorkspaceController
  onOpenInEditor?: (path: string) => void
}

export function GitHistoryPane({ controller, onOpenInEditor }: GitHistoryPaneProps) {
  const {
    locale,
    workspaceId,
    isGitRepository,
    summary,
    diffLoading,
    structuredDiff,
    diffViewMode,
    setDiffViewMode,
    showDiffView,
    setShowDiffView,
    logEntries,
    selectedPath,
    selectedDiffScope,
    historyLoading,
    hasMoreHistory,
    loadOlderHistory,
    resetToLatestHistory,
    errorMessage,
  } = controller

  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [selectedCommitDetail, setSelectedCommitDetail] =
    useState<GitCommitDetailResponse | null>(null)
  const [commitDetailLoading, setCommitDetailLoading] = useState(false)
  const [commitDetailError, setCommitDetailError] = useState<string | null>(null)
  const [fullFileExpanded, setFullFileExpanded] = useState(false)
  const [expandedDiffFile, setExpandedDiffFile] = useState<GitDiffExpansionResponse | null>(null)
  const [expandedDiffFileLoading, setExpandedDiffFileLoading] = useState(false)
  const [expandedDiffFileError, setExpandedDiffFileError] = useState<string | null>(null)
  const commitDetailCacheRef = useRef<Map<string, GitCommitDetailResponse>>(new Map())
  const expandedDiffFileCacheRef = useRef<Map<string, GitDiffExpansionResponse>>(new Map())
  const commitDetailSeqRef = useRef(0)
  const expandedDiffFileSeqRef = useRef(0)
  const diffSwitchDisabled = !isGitRepository || (!selectedPath && !showDiffView)
  const currentViewLabel = showDiffView
    ? t(locale, 'git.history.view.diff')
    : t(locale, 'git.history.view.latest')
  const selectedOldPath = structuredDiff?.oldPath ?? null
  const openInEditorDisabled = !selectedPath || structuredDiff?.isDeleted || !onOpenInEditor

  const handleToggleView = useCallback(() => {
    if (diffSwitchDisabled) {
      return
    }
    setShowDiffView(!showDiffView)
  }, [diffSwitchDisabled, setShowDiffView, showDiffView])

  const handleToggleFullFile = useCallback(() => {
    if (!selectedPath) {
      return
    }
    setFullFileExpanded((prev) => !prev)
  }, [selectedPath])

  const handleOpenInEditor = useCallback(() => {
    if (!selectedPath || openInEditorDisabled) {
      return
    }
    onOpenInEditor?.(selectedPath)
  }, [onOpenInEditor, openInEditorDisabled, selectedPath])

  useEffect(() => {
    setSelectedCommit(null)
    setSelectedCommitDetail(null)
    setCommitDetailLoading(false)
    setCommitDetailError(null)
    setFullFileExpanded(false)
    setExpandedDiffFile(null)
    setExpandedDiffFileLoading(false)
    setExpandedDiffFileError(null)
    commitDetailCacheRef.current.clear()
    expandedDiffFileCacheRef.current.clear()
    commitDetailSeqRef.current += 1
    expandedDiffFileSeqRef.current += 1
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedPath || !showDiffView || !fullFileExpanded) {
      if (!selectedPath) {
        setExpandedDiffFile(null)
      }
      setExpandedDiffFileLoading(false)
      setExpandedDiffFileError(null)
      return
    }

    const cacheKey = `${workspaceId}:${selectedPath}:${selectedDiffScope}:${selectedOldPath ?? ''}`
    const cached = expandedDiffFileCacheRef.current.get(cacheKey)
    if (cached) {
      setExpandedDiffFile(cached)
      setExpandedDiffFileError(null)
      setExpandedDiffFileLoading(false)
      return
    }

    const seq = expandedDiffFileSeqRef.current + 1
    expandedDiffFileSeqRef.current = seq
    setExpandedDiffFile(null)
    setExpandedDiffFileLoading(true)
    setExpandedDiffFileError(null)

    void desktopApi
      .gitDiffFileExpansion(workspaceId, selectedPath, selectedOldPath, selectedDiffScope === 'staged')
      .then((response) => {
        if (expandedDiffFileSeqRef.current !== seq) {
          return
        }
        expandedDiffFileCacheRef.current.set(cacheKey, response)
        setExpandedDiffFile(response)
      })
      .catch((error) => {
        if (expandedDiffFileSeqRef.current !== seq) {
          return
        }
        setExpandedDiffFile(null)
        setExpandedDiffFileError(
          t(locale, 'git.diff.expandLoadFailed', {
            detail: describeUnknownError(error),
          }),
        )
      })
      .finally(() => {
        if (expandedDiffFileSeqRef.current === seq) {
          setExpandedDiffFileLoading(false)
        }
      })
  }, [
    fullFileExpanded,
    locale,
    selectedDiffScope,
    selectedOldPath,
    selectedPath,
    showDiffView,
    workspaceId,
  ])

  const handleSelectCommit = useCallback(
    (hash: string) => {
      if (!workspaceId) {
        return
      }

      if (selectedCommit === hash) {
        setSelectedCommit(null)
        setSelectedCommitDetail(null)
        setCommitDetailLoading(false)
        setCommitDetailError(null)
        commitDetailSeqRef.current += 1
        return
      }

      setSelectedCommit(hash)
      setCommitDetailError(null)
      commitDetailSeqRef.current += 1
      const seq = commitDetailSeqRef.current

      const cacheKey = `${workspaceId}:${hash}`
      const cached = commitDetailCacheRef.current.get(cacheKey)
      if (cached) {
        setSelectedCommitDetail(cached)
        setCommitDetailLoading(false)
        return
      }

      setSelectedCommitDetail(null)
      setCommitDetailLoading(true)

      void desktopApi
        .gitCommitDetail(workspaceId, hash)
        .then((detail) => {
          if (commitDetailSeqRef.current !== seq) {
            return
          }
          commitDetailCacheRef.current.set(cacheKey, detail)
          setSelectedCommitDetail(detail)
        })
        .catch((error) => {
          if (commitDetailSeqRef.current !== seq) {
            return
          }
          setCommitDetailError(
            t(locale, 'git.history.detail.loadFailed', {
              detail: describeUnknownError(error),
            }),
          )
          setSelectedCommitDetail(null)
        })
        .finally(() => {
          if (commitDetailSeqRef.current === seq) {
            setCommitDetailLoading(false)
          }
        })
    },
    [locale, selectedCommit, workspaceId],
  )

  if (!workspaceId) {
    return (
      <section className="git-pane git-history-pane">
        <div className="git-pane__empty">
          <AppIcon name="git" className="git-pane__empty-icon" />
          <h2>{t(locale, 'git.history.title')}</h2>
          <p>{t(locale, 'git.workspaceRequired')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="git-pane git-history-pane">
      {/* Header with branch info */}
      <header className="git-pane__header">
        <div className="git-pane__header-left">
          <AppIcon name="git-branch" className="git-pane__branch-icon" />
          <div className="git-pane__branch-info">
            <span className="git-pane__branch-name">{summary?.branch || (isGitRepository ? 'main' : '—')}</span>
            <span className="git-pane__branch-status">
              {summary ? (
                <>
                  <span className="git-pane__ahead">↑{summary.ahead}</span>
                  <span className="git-pane__behind">↓{summary.behind}</span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
          <span className="git-pane__commit-count">
            {t(locale, 'git.history.count', { count: logEntries.length })}
          </span>
        </div>
        <div className="git-pane__header-actions">
          <button
            type="button"
            className={`git-history-switch ${showDiffView ? 'git-history-switch--on' : 'git-history-switch--off'}`}
            onClick={handleToggleView}
            disabled={diffSwitchDisabled}
            role="switch"
            aria-checked={showDiffView}
            aria-label={t(locale, 'git.history.view.switchAria', {
              target: currentViewLabel,
            })}
            title={
              diffSwitchDisabled
                ? t(locale, 'git.history.view.switchDisabled')
                : t(locale, 'git.history.view.switchAria', {
                    target: currentViewLabel,
                  })
            }
          >
            <span className="git-history-switch__label">{currentViewLabel}</span>
            <span className="git-history-switch__track" aria-hidden="true">
              <span className="git-history-switch__thumb" />
            </span>
          </button>
        </div>
      </header>

      {errorMessage ? <div className="git-pane__error">{errorMessage}</div> : null}

      {/* Content: Mutually exclusive views */}
      <div className="git-pane__content git-history-pane__content">
        {showDiffView ? (
          <DiffViewer
            diff={structuredDiff}
            mode={diffViewMode}
            loading={diffLoading}
            path={selectedPath}
            diffScope={selectedDiffScope}
            locale={locale}
            onModeChange={setDiffViewMode}
            fullFileExpanded={fullFileExpanded}
            fullFile={expandedDiffFile}
            fullFileLoading={expandedDiffFileLoading}
            fullFileError={expandedDiffFileError}
            onToggleFullFile={handleToggleFullFile}
            onOpenInEditor={handleOpenInEditor}
            openInEditorDisabled={openInEditorDisabled}
          />
        ) : (
          <GitGraphView
            entries={logEntries}
            locale={locale}
            historyLoading={historyLoading}
            hasMoreHistory={hasMoreHistory}
            selectedCommit={selectedCommit}
            selectedCommitDetail={selectedCommitDetail}
            commitDetailLoading={commitDetailLoading}
            commitDetailError={commitDetailError}
            onSelectCommit={handleSelectCommit}
            onLoadMore={loadOlderHistory}
            onResetToLatest={resetToLatestHistory}
          />
        )}
      </div>
    </section>
  )
}
