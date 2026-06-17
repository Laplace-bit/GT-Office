import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  desktopApi,
  type GitCommitDetailResponse,
  type GitDiffExpansionResponse,
} from '@shell/integration/desktop-api'
import type { GitWorkspaceController } from '../useGitWorkspaceController'
import { buildRepositoryScopeKey } from '../controllers/repository-selection-model'
import { DiffViewer } from '../DiffViewer'
import { GitGraphView } from '../GitGraphView'
import { MergeConflictPanel } from './MergeConflictPanel'
import { describeUnknownError, getRepositoryDisplayLabel } from './git-helpers'

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
    currentRepositoryPath,
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
    isMerging,
    mergeConflicts,
    resolveConflict,
    continueMerge,
    abortMerge,
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
  const scopeRef = useRef({
    workspaceId,
    currentRepositoryPath,
    selectedPath,
    selectedDiffScope,
    selectedOldPath: null as string | null,
    selectedCommit: null as string | null,
  })
  const diffSwitchDisabled = !isGitRepository || (!selectedPath && !showDiffView)
  const currentViewLabel = showDiffView
    ? t(locale, 'git.history.view.diff')
    : t(locale, 'git.history.view.latest')
  const selectedOldPath = structuredDiff?.oldPath ?? null
  const activeRepository = summary?.repositories.find(
    (repository) => repository.repositoryPath === currentRepositoryPath,
  ) ?? null
  const repositoryLabel = activeRepository
    ? getRepositoryDisplayLabel(
        activeRepository.repositoryPath,
        activeRepository.root,
        t(locale, 'git.repositories.workspaceRoot'),
      )
    : null
  const showRepositoryLabel = (summary?.repositories.length ?? 0) > 1 && Boolean(repositoryLabel)
  scopeRef.current = {
    workspaceId,
    currentRepositoryPath,
    selectedPath,
    selectedDiffScope,
    selectedOldPath,
    selectedCommit,
  }
  const openInEditorDisabled = !selectedPath || structuredDiff?.isDeleted || !onOpenInEditor

  const isCurrentExpandedDiffRequest = useCallback(
    (
      requestWorkspaceId: string,
      requestRepositoryPath: string | null,
      requestPath: string,
      requestScope: typeof selectedDiffScope,
      requestOldPath: string | null,
    ) => {
      const current = scopeRef.current
      return (
        current.workspaceId === requestWorkspaceId &&
        current.currentRepositoryPath === requestRepositoryPath &&
        current.selectedPath === requestPath &&
        current.selectedDiffScope === requestScope &&
        current.selectedOldPath === requestOldPath
      )
    },
    [],
  )

  const isCurrentCommitDetailRequest = useCallback(
    (requestWorkspaceId: string, requestRepositoryPath: string | null, requestCommit: string) => {
      const current = scopeRef.current
      return (
        current.workspaceId === requestWorkspaceId &&
        current.currentRepositoryPath === requestRepositoryPath &&
        current.selectedCommit === requestCommit
      )
    },
    [],
  )

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
  }, [currentRepositoryPath, workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedPath || !showDiffView || !fullFileExpanded) {
      expandedDiffFileSeqRef.current += 1
      if (!selectedPath) {
        setExpandedDiffFile(null)
      }
      setExpandedDiffFileLoading(false)
      setExpandedDiffFileError(null)
      return
    }

    const cacheKey = `${buildRepositoryScopeKey(workspaceId, currentRepositoryPath)}:${selectedPath}:${selectedDiffScope}:${selectedOldPath ?? ''}`
    const cached = expandedDiffFileCacheRef.current.get(cacheKey)
    if (cached) {
      setExpandedDiffFile(cached)
      setExpandedDiffFileError(null)
      setExpandedDiffFileLoading(false)
      expandedDiffFileSeqRef.current += 1
      return
    }

    const requestWorkspaceId = workspaceId
    const requestRepositoryPath = currentRepositoryPath
    const requestPath = selectedPath
    const requestScope = selectedDiffScope
    const requestOldPath = selectedOldPath
    const seq = expandedDiffFileSeqRef.current + 1
    expandedDiffFileSeqRef.current = seq
    setExpandedDiffFile(null)
    setExpandedDiffFileLoading(true)
    setExpandedDiffFileError(null)

    void desktopApi
      .gitDiffFileExpansion(
        requestWorkspaceId,
        requestPath,
        requestOldPath,
        requestScope === 'staged',
        requestRepositoryPath,
      )
      .then((response) => {
        if (
          expandedDiffFileSeqRef.current !== seq ||
          !isCurrentExpandedDiffRequest(
            requestWorkspaceId,
            requestRepositoryPath,
            requestPath,
            requestScope,
            requestOldPath,
          )
        ) {
          return
        }
        expandedDiffFileCacheRef.current.set(cacheKey, response)
        setExpandedDiffFile(response)
      })
      .catch((error) => {
        if (
          expandedDiffFileSeqRef.current !== seq ||
          !isCurrentExpandedDiffRequest(
            requestWorkspaceId,
            requestRepositoryPath,
            requestPath,
            requestScope,
            requestOldPath,
          )
        ) {
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
        if (
          expandedDiffFileSeqRef.current === seq &&
          isCurrentExpandedDiffRequest(
            requestWorkspaceId,
            requestRepositoryPath,
            requestPath,
            requestScope,
            requestOldPath,
          )
        ) {
          setExpandedDiffFileLoading(false)
        }
      })
  }, [
    fullFileExpanded,
    isCurrentExpandedDiffRequest,
    locale,
    selectedDiffScope,
    currentRepositoryPath,
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
        scopeRef.current = { ...scopeRef.current, selectedCommit: null }
        setSelectedCommitDetail(null)
        setCommitDetailLoading(false)
        setCommitDetailError(null)
        commitDetailSeqRef.current += 1
        return
      }

      setSelectedCommit(hash)
      scopeRef.current = { ...scopeRef.current, selectedCommit: hash }
      setCommitDetailError(null)
      commitDetailSeqRef.current += 1
      const seq = commitDetailSeqRef.current
      const requestWorkspaceId = workspaceId
      const requestRepositoryPath = currentRepositoryPath
      const requestCommit = hash

      const cacheKey = `${buildRepositoryScopeKey(requestWorkspaceId, requestRepositoryPath)}:${requestCommit}`
      const cached = commitDetailCacheRef.current.get(cacheKey)
      if (cached) {
        setSelectedCommitDetail(cached)
        setCommitDetailLoading(false)
        return
      }

      setSelectedCommitDetail(null)
      setCommitDetailLoading(true)

      void desktopApi
        .gitCommitDetail(requestWorkspaceId, requestCommit, requestRepositoryPath)
        .then((detail) => {
          if (
            commitDetailSeqRef.current !== seq ||
            !isCurrentCommitDetailRequest(requestWorkspaceId, requestRepositoryPath, requestCommit)
          ) {
            return
          }
          commitDetailCacheRef.current.set(cacheKey, detail)
          setSelectedCommitDetail(detail)
        })
        .catch((error) => {
          if (
            commitDetailSeqRef.current !== seq ||
            !isCurrentCommitDetailRequest(requestWorkspaceId, requestRepositoryPath, requestCommit)
          ) {
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
          if (
            commitDetailSeqRef.current === seq &&
            isCurrentCommitDetailRequest(requestWorkspaceId, requestRepositoryPath, requestCommit)
          ) {
            setCommitDetailLoading(false)
          }
        })
    },
    [currentRepositoryPath, isCurrentCommitDetailRequest, locale, selectedCommit, workspaceId],
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
          {showRepositoryLabel && repositoryLabel ? (
            <span className="git-pane__repo-chip" title={currentRepositoryPath ?? repositoryLabel}>
              {repositoryLabel}
            </span>
          ) : null}
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
            <span className="git-history-switch__icon-wrap" aria-hidden="true">
              <AppIcon name="git-commit" className="git-history-switch__icon" />
            </span>
            <span className="git-history-switch__track" aria-hidden="true">
              <span className="git-history-switch__thumb" />
            </span>
          </button>
        </div>
      </header>

      {errorMessage ? <div className="git-pane__error">{errorMessage}</div> : null}

      {/* Content: Mutually exclusive views */}
      <div className="git-pane__content git-history-pane__content">
        {isMerging ? (
          <MergeConflictPanel
            conflicts={mergeConflicts}
            onResolve={(path, side) => void resolveConflict(path, side)}
            onContinue={() => void continueMerge()}
            onAbort={() => void abortMerge()}
            locale={locale}
          />
        ) : showDiffView ? (
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
            scope={selectedDiffScope}
            onStageHunk={async (filePath, patch) => {
              if (workspaceId) {
                await desktopApi.gitStageHunk(workspaceId, filePath, patch, currentRepositoryPath)
                controller.invalidateDiffCache()
              }
            }}
            onUnstageHunk={async (filePath, patch) => {
              if (workspaceId) {
                await desktopApi.gitUnstageHunk(workspaceId, filePath, patch, currentRepositoryPath)
                controller.invalidateDiffCache()
              }
            }}
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
            onCherryPick={controller.cherryPick}
            onRevert={controller.revert}
            onReset={controller.reset}
            onCreateBranch={controller.createBranchFromCommit}
          />
        )}
      </div>
    </section>
  )
}
