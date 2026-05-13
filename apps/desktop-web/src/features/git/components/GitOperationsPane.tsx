import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  ROW_HEIGHT,
  OVERSCAN_ROWS,
  type GitWorkspaceController,
} from '../useGitWorkspaceController'
import { useGitTags } from '../tags/useGitTags'
import {
  scaleDesignPxToActualPx,
  useRootFontSizePx,
} from '../git-font-scale'
import { GitToolbar } from './GitToolbar'
import { RepositorySection } from './RepositorySection'
import { ChangesSection } from './ChangesSection'
import { CommitForm } from './CommitForm'
import { BranchSection } from './BranchSection'
import { StashSection } from './StashSection'
import { TagSection } from './TagSection'
import { GitNoticeBanner } from './GitNoticeBanner'
import { GitConfirmDialog } from './GitConfirmDialog'
import type { GitDiscardKind } from './git-helpers'

const MIN_CHANGES_SECTION_BASE_HEIGHT = 180

interface GitOperationsPaneProps {
  controller: GitWorkspaceController
}

export function GitOperationsPane({ controller }: GitOperationsPaneProps) {
  const {
    locale,
    workspaceId,
    visibleFiles,
    metaLoading,
    errorMessage,
    repositoryNotice,
    dismissRepositoryNotice,
    discardPath,
    refreshAll,
    summary,
    branches,
    stashEntries,
    logEntries,
  } = controller

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    repositories: false,
    commit: true,
    branches: true,
    stash: true,
    tags: true,
  })
  const tagsExpanded = !(collapsedSections.tags ?? true)
  const { tags, loading: tagsLoading, createTag, deleteTag } = useGitTags(
    workspaceId,
    controller.currentRepositoryPath,
    controller.isGitRepository,
    tagsExpanded,
  )
  const [discardConfirmState, setDiscardConfirmState] = useState<{
    path: string
    includeUntracked: boolean
    discardKind: GitDiscardKind
  } | null>(null)
  const [changesSectionHeight, setChangesSectionHeight] = useState<number | null>(null)
  const rootFontSizePx = useRootFontSizePx()
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        refreshAll()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [refreshAll])

  useEffect(() => {
    if (!workspaceId) {
      return
    }
    if (metaLoading) {
      return
    }
    const hasLoadedMeta = branches.length > 0 || stashEntries.length > 0 || logEntries.length > 0
    if (summary || hasLoadedMeta || repositoryNotice) {
      return
    }

    const timerId = window.setTimeout(() => {
      void refreshAll()
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [
    branches.length,
    logEntries.length,
    metaLoading,
    refreshAll,
    repositoryNotice,
    stashEntries.length,
    summary,
    workspaceId,
  ])

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

  // Keyboard shortcuts: ⌘R refresh, Esc close dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        controller.refreshAll()
      }
      if (e.key === 'Escape') {
        setDiscardConfirmState(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controller.refreshAll])

  useEffect(() => {
    fileVirtualizer.measure()
  }, [fileRowHeight, fileVirtualizer])

  const handleDiscardConfirm = useCallback((path: string, discardKind: GitDiscardKind) => {
    setDiscardConfirmState({
      path,
      includeUntracked: discardKind === 'untracked',
      discardKind,
    })
  }, [])
  const closeDiscardConfirm = useCallback(() => {
    if (controller.actionLoading === 'discard') {
      return
    }
    setDiscardConfirmState(null)
  }, [controller.actionLoading])
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

  const discardConfirmModal = discardConfirmState ? (
    <GitConfirmDialog
      locale={locale}
      path={discardConfirmState.path}
      discardKind={discardConfirmState.discardKind}
      loading={controller.actionLoading === 'discard'}
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
        <GitToolbar controller={controller} />

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
          <RepositorySection
            controller={controller}
            collapsed={collapsedSections.repositories ?? false}
            onToggle={() => toggleSection('repositories')}
          />

          <ChangesSection
            controller={controller}
            collapsed={collapsedSections.changes ?? false}
            onToggle={() => toggleSection('changes')}
            changesSectionHeight={changesSectionHeight}
            rootFontSizePx={rootFontSizePx}
            viewportRef={viewportRef}
            fileVirtualizer={fileVirtualizer}
            onDiscardConfirm={handleDiscardConfirm}
          />

          <CommitForm
            controller={controller}
            collapsed={collapsedSections.commit ?? true}
            onToggle={() => toggleSection('commit')}
          />

          <BranchSection
            controller={controller}
            collapsed={collapsedSections.branches ?? true}
            onToggle={() => toggleSection('branches')}
          />

          <StashSection
            controller={controller}
            collapsed={collapsedSections.stash ?? true}
            onToggle={() => toggleSection('stash')}
          />

          <TagSection
            tags={tags}
            loading={tagsLoading}
            locale={locale}
            isGitRepository={controller.isGitRepository}
            actionLoading={controller.actionLoading}
            remoteActionLoading={controller.remoteActionLoading}
            onCreateTag={createTag}
            onDeleteTag={deleteTag}
            onPushTag={controller.pushTag}
            collapsed={collapsedSections.tags ?? true}
            onToggle={() => toggleSection('tags')}
          />
        </div>
      </section>
      {discardConfirmModal}
    </>
  )
}
