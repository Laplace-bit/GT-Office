import { memo, useCallback, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from '../i18n/ui-locale'
import { AppIcon, type AppIconName } from '../ui/icons'
import { type GitStatusFile } from '../integration/desktop-api'
import {
  ROW_HEIGHT,
  OVERSCAN_ROWS,
  type GitWorkspaceController,
} from './useGitWorkspaceController'
import { DiffViewer } from './DiffViewer'
import { GitGraphView } from './GitGraphView'
import './diff-viewer.css'

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
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
  style,
}: GitFileRowProps) {
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
      >
        <span
          className={`git-file-row__status ${file.staged ? 'git-file-row__status--staged' : 'git-file-row__status--unstaged'}`}
        >
          {file.status || '—'}
        </span>
        <span className="git-file-row__path">{file.path}</span>
      </button>
      <div className="git-file-row__actions">
        {file.staged ? (
          <GitIconButton
            icon="x-mark"
            label={t(locale, 'git.action.unstage')}
            onClick={onUnstage}
            disabled={Boolean(actionLoading)}
            size="sm"
          />
        ) : (
          <GitIconButton
            icon="check"
            label={t(locale, 'git.action.stage')}
            onClick={onStage}
            disabled={Boolean(actionLoading)}
            size="sm"
            variant="success"
          />
        )}
        <GitIconButton
          icon="trash"
          label={t(locale, 'git.action.discard')}
          onClick={() => onDiscard()}
          disabled={Boolean(actionLoading)}
          size="sm"
          variant="danger"
        />
      </div>
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
    preloadDiff,
  } = controller

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const fileVirtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  })

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Memoized callbacks for file actions
  const handleSelectPath = useCallback((path: string) => selectPath(path), [selectPath])
  const handlePreloadDiff = useCallback((path: string) => preloadDiff(path), [preloadDiff])
  const handleStagePath = useCallback((path: string) => void stagePath(path), [stagePath])
  const handleUnstagePath = useCallback((path: string) => void unstagePath(path), [unstagePath])
  const handleDiscardPath = useCallback(
    (path: string, isUntracked: boolean) => void discardPath(path, isUntracked),
    [discardPath],
  )

  const totalFiles = summary?.files.length ?? 0

  if (!workspaceId) {
    return (
      <section className="git-pane git-ops-pane">
        <div className="git-pane__empty">
          <AppIcon name="git" className="git-pane__empty-icon" />
          <h2>{t(locale, 'pane.git.title')}</h2>
          <p>{t(locale, 'git.workspaceRequired')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="git-pane git-ops-pane">
      {/* Header */}
      <header className="git-pane__header">
        <div className="git-pane__header-left">
          <AppIcon name="git-branch" className="git-pane__branch-icon" />
          <div className="git-pane__branch-info">
            <span className="git-pane__branch-name">{summary?.branch || 'main'}</span>
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
          <GitIconButton icon="cloud-download" label={t(locale, 'git.action.fetch')} onClick={() => void fetch()} disabled={Boolean(actionLoading)} />
          <GitIconButton icon="arrow-down" label={t(locale, 'git.action.pull')} onClick={() => void pull()} disabled={Boolean(actionLoading)} />
          <GitIconButton icon="arrow-up" label={t(locale, 'git.action.push')} onClick={() => void push()} disabled={Boolean(actionLoading)} />
        </div>
      </header>

      {errorMessage ? <div className="git-pane__error">{errorMessage}</div> : null}

      {/* Scrollable content area */}
      <div className="git-pane__content">
        {/* Changes Section */}
        <section className="git-section">
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
                  <GitIconButton
                    icon="check"
                    label={t(locale, 'git.action.stageAll')}
                    onClick={() => void stageAll()}
                    disabled={!hasUnstagedFiles || Boolean(actionLoading)}
                    variant="success"
                    size="sm"
                    title={t(locale, 'git.action.stageAll')}
                  />
                  <GitIconButton
                    icon="x-mark"
                    label={t(locale, 'git.action.unstageAll')}
                    onClick={() => void unstageAll()}
                    disabled={!hasStagedFiles || Boolean(actionLoading)}
                    size="sm"
                    title={t(locale, 'git.action.unstageAll')}
                  />
                </div>
              </div>

              {/* File List with Virtual Scrolling */}
              <div ref={viewportRef} className="git-file-list">
                <div
                  className="git-file-list__inner"
                  style={{ height: `${fileVirtualizer.getTotalSize()}px` }}
                >
                  {fileVirtualizer.getVirtualItems().map((virtualItem) => {
                    const file = visibleFiles[virtualItem.index]
                    if (!file) return null
                    const isActive = selectedPath === file.path
                    const isUntracked = file.status.startsWith('??')
                    return (
                      <GitFileRow
                        key={file.path}
                        file={file}
                        isActive={isActive}
                        locale={locale}
                        actionLoading={actionLoading}
                        onSelect={() => handleSelectPath(file.path)}
                        onPreload={() => handlePreloadDiff(file.path)}
                        onStage={() => handleStagePath(file.path)}
                        onUnstage={() => handleUnstagePath(file.path)}
                        onDiscard={() => handleDiscardPath(file.path, isUntracked)}
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Commit Section */}
        <section className="git-section">
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
                    disabled={!hasStagedFiles || !commitMessage.trim() || Boolean(actionLoading)}
                    variant="primary"
                    showLabel
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Branch Section */}
        <section className="git-section">
          <GitSectionHeader
            title={t(locale, 'git.branch.title')}
            count={branches.length}
            collapsed={collapsedSections.branches}
            onToggle={() => toggleSection('branches')}
          />
          {!collapsedSections.branches && (
            <div className="git-section__content">
              <div className="git-branch-form">
                <div className="git-branch-form__row">
                  <select
                    className="git-branch-form__select"
                    value={checkoutTarget}
                    onChange={(e) => setCheckoutTarget(e.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.current ? `✓ ${branch.name}` : branch.name}
                      </option>
                    ))}
                  </select>
                  <GitIconButton
                    icon="git-merge"
                    label={t(locale, 'git.action.checkout')}
                    onClick={() => void checkout()}
                    disabled={!checkoutTarget || Boolean(actionLoading)}
                  />
                  <GitIconButton
                    icon="trash"
                    label={t(locale, 'git.action.deleteBranch')}
                    onClick={() => void deleteBranch()}
                    disabled={!checkoutTarget || selectedBranchEntry?.current || Boolean(actionLoading)}
                    variant="danger"
                  />
                </div>
                <div className="git-branch-form__row">
                  <input
                    type="text"
                    className="git-branch-form__input"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder={t(locale, 'git.branch.createPlaceholder')}
                  />
                  <GitIconButton
                    icon="plus"
                    label={t(locale, 'git.action.createBranch')}
                    onClick={() => void createBranch()}
                    disabled={!newBranchName.trim() || Boolean(actionLoading)}
                    variant="primary"
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Stash Section */}
        <section className="git-section">
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
                  />
                  <GitIconButton
                    icon="archive"
                    label={t(locale, 'git.action.stashPush')}
                    onClick={() => void stashPush()}
                    disabled={!hasUnstagedFiles || Boolean(actionLoading)}
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
                        disabled={Boolean(actionLoading)}
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
  )
}

// ============================================
// ============================================
// Git History Pane Component
// ============================================
interface GitHistoryPaneProps {
  controller: GitWorkspaceController
}

export function GitHistoryPane({ controller }: GitHistoryPaneProps) {
  const {
    locale,
    workspaceId,
    summary,
    diffLoading,
    structuredDiff,
    diffViewMode,
    setDiffViewMode,
    showDiffView,
    setShowDiffView,
    logEntries,
    selectedPath,
    historyLoading,
    hasMoreHistory,
    loadOlderHistory,
    resetToLatestHistory,
    errorMessage,
  } = controller

  const handleSelectCommit = useCallback(
    (hash: string) => {
      // Future: load diff for this commit
      console.log('Selected commit:', hash)
    },
    [],
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
            <span className="git-pane__branch-name">{summary?.branch || 'main'}</span>
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
          <span className="git-pane__commit-count">{logEntries.length} commits</span>
        </div>
        <div className="git-pane__header-actions">
          {/* Show back button when in diff view */}
          {showDiffView && (
            <button
              type="button"
              className="git-icon-btn"
              onClick={() => setShowDiffView(false)}
              title={t(locale, 'git.history.backToLatest')}
            >
              <AppIcon name="chevron-left" className="git-icon-btn__icon" />
            </button>
          )}
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
            locale={locale}
            onModeChange={setDiffViewMode}
            onClose={() => setShowDiffView(false)}
          />
        ) : (
          <GitGraphView
            entries={logEntries}
            locale={locale}
            historyLoading={historyLoading}
            hasMoreHistory={hasMoreHistory}
            selectedCommit={null}
            onSelectCommit={handleSelectCommit}
            onLoadMore={loadOlderHistory}
            onResetToLatest={resetToLatestHistory}
          />
        )}
      </div>
    </section>
  )
}
