import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { addNotification } from '@/stores/notification'
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
import { GitFeatureDialog } from './GitFeatureDialog'
import { BranchDialog } from './BranchDialog'
import { StashDialog } from './StashDialog'
import { TagDialog } from './TagDialog'
import { GitConfirmDialog } from './GitConfirmDialog'
import type { GitDiscardKind } from './git-helpers'

type ActiveDialog = 'branches' | 'stash' | 'tags' | null

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
    changes: false,
    commit: true,
  })
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null)

  const tagsDialogOpen = activeDialog === 'tags'
  const { tags, loading: tagsLoading, createTag, deleteTag } = useGitTags(
    workspaceId,
    controller.currentRepositoryPath,
    controller.isGitRepository,
    tagsDialogOpen,
  )
  const [discardConfirmState, setDiscardConfirmState] = useState<{
    path: string
    includeUntracked: boolean
    discardKind: GitDiscardKind
  } | null>(null)
  const rootFontSizePx = useRootFontSizePx()

  // Convert repository notices and errors to toast notifications
  useEffect(() => {
    if (repositoryNotice) {
      addNotification({ type: 'warning', message: repositoryNotice })
      dismissRepositoryNotice()
    }
  }, [repositoryNotice, dismissRepositoryNotice])

  useEffect(() => {
    if (errorMessage) {
      addNotification({ type: 'error', message: errorMessage })
    }
  }, [errorMessage])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        refreshAll()
      }
      if (e.key === 'Escape' && activeDialog) {
        setActiveDialog(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [refreshAll, activeDialog])

  useEffect(() => {
    if (!workspaceId) {
      return
    }
    if (metaLoading) {
      return
    }
    const hasLoadedMeta = branches.length > 0 || stashEntries.length > 0 || logEntries.length > 0
    if (summary || hasLoadedMeta) {
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

  // Keyboard shortcuts: Esc close dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDiscardConfirmState(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  const openBranches = useCallback(() => setActiveDialog('branches'), [])
  const openStash = useCallback(() => setActiveDialog('stash'), [])
  const openTags = useCallback(() => setActiveDialog('tags'), [])
  const closeDialog = useCallback(() => setActiveDialog(null), [])

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
        <GitToolbar
          controller={controller}
          onOpenBranches={openBranches}
          onOpenStash={openStash}
          onOpenTags={openTags}
        />

        {/* Scrollable content area */}
        <div className="git-pane__content">
          <RepositorySection
            controller={controller}
            collapsed={collapsedSections.repositories ?? false}
            onToggle={() => toggleSection('repositories')}
          />

          <CommitForm
            controller={controller}
            collapsed={collapsedSections.commit ?? true}
            onToggle={() => toggleSection('commit')}
          />

          <ChangesSection
            controller={controller}
            collapsed={collapsedSections.changes ?? false}
            onToggle={() => toggleSection('changes')}
            rootFontSizePx={rootFontSizePx}
            viewportRef={viewportRef}
            fileVirtualizer={fileVirtualizer}
            onDiscardConfirm={handleDiscardConfirm}
          />
        </div>
      </section>

      {/* Feature dialogs */}
      <GitFeatureDialog
        open={activeDialog === 'branches'}
        onClose={closeDialog}
        title={t(locale, 'git.branch.title')}
        icon="git-branch"
        locale={locale}
      >
        <BranchDialog controller={controller} />
      </GitFeatureDialog>

      <GitFeatureDialog
        open={activeDialog === 'stash'}
        onClose={closeDialog}
        title={t(locale, 'git.stash.title')}
        icon="archive"
        locale={locale}
      >
        <StashDialog controller={controller} />
      </GitFeatureDialog>

      <GitFeatureDialog
        open={activeDialog === 'tags'}
        onClose={closeDialog}
        title={t(locale, 'git.tag.title')}
        icon="clock"
        locale={locale}
      >
        <TagDialog
          tags={tags}
          loading={tagsLoading}
          locale={locale}
          isGitRepository={controller.isGitRepository}
          actionLoading={controller.actionLoading}
          remoteActionLoading={controller.remoteActionLoading}
          onCreateTag={createTag}
          onDeleteTag={deleteTag}
          onPushTag={controller.pushTag}
        />
      </GitFeatureDialog>

      {discardConfirmModal}
    </>
  )
}