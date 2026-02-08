import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gitgraph, Orientation, TemplateName, templateExtend } from '@gitgraph/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { html as renderDiffHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import {
  desktopApi,
  type GitBranchEntry,
  type GitCommitEntry,
  type GitStashEntry,
  type GitStatusFile,
  type GitStatusResponse,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'

type GitFileFilter = 'all' | 'staged' | 'unstaged'

interface UseGitWorkspaceControllerInput {
  locale: Locale
  workspaceId: string | null
  summary: GitStatusResponse | null
  onRefreshSummary: (workspaceId: string | null) => Promise<void>
}

interface GitGraphCommitView {
  branch: string
  hash: string
  subject: string
  author: string
  refs: string[]
}

export interface GitWorkspaceController {
  locale: Locale
  workspaceId: string | null
  summary: GitStatusResponse | null
  stagedFiles: GitStatusFile[]
  unstagedFiles: GitStatusFile[]
  visibleFiles: GitStatusFile[]
  hasStagedFiles: boolean
  hasUnstagedFiles: boolean
  filter: GitFileFilter
  setFilter: (filter: GitFileFilter) => void
  selectedPath: string | null
  selectPath: (path: string) => void
  diffLoading: boolean
  renderedDiffHtml: string
  metaLoading: boolean
  actionLoading: string | null
  errorMessage: string | null
  commitMessage: string
  setCommitMessage: (message: string) => void
  stashMessage: string
  setStashMessage: (message: string) => void
  checkoutTarget: string
  setCheckoutTarget: (target: string) => void
  newBranchName: string
  setNewBranchName: (name: string) => void
  selectedBranchEntry: GitBranchEntry | null
  logEntries: GitCommitEntry[]
  historyLoading: boolean
  hasMoreHistory: boolean
  branches: GitBranchEntry[]
  stashEntries: GitStashEntry[]
  graphCommits: GitGraphCommitView[]
  refreshAll: () => Promise<void>
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardPath: (path: string, includeUntracked?: boolean) => Promise<void>
  commit: () => Promise<void>
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  checkout: () => Promise<void>
  createBranch: () => Promise<void>
  deleteBranch: () => Promise<void>
  stashPush: () => Promise<void>
  stashPop: (stash: string | null) => Promise<void>
  loadOlderHistory: () => Promise<void>
  resetToLatestHistory: () => Promise<void>
}

const ROW_HEIGHT = 30
const OVERSCAN_ROWS = 18
const HISTORY_PAGE_SIZE = 80
const STASH_LIMIT = 30

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

function formatGitTimestamp(value: string, locale: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function parseBranchNamesFromRefs(refs: string[]): string[] {
  const localRefs: string[] = []
  for (const ref of refs) {
    const trimmed = ref.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed.startsWith('tag: ')) {
      continue
    }
    if (trimmed.startsWith('HEAD -> ')) {
      const target = trimmed.slice('HEAD -> '.length).trim()
      if (target && !target.includes('/')) {
        localRefs.push(target)
      }
      continue
    }
    if (!trimmed.includes('/')) {
      localRefs.push(trimmed)
    }
  }
  return localRefs
}

function buildGraphCommits(
  entries: GitCommitEntry[],
  primaryBranch: string,
): GitGraphCommitView[] {
  if (entries.length === 0) {
    return []
  }
  const chronological = [...entries].reverse()
  const hashBranchMap = new Map<string, string>()
  const graph: GitGraphCommitView[] = []

  for (const entry of chronological) {
    const localRefs = parseBranchNamesFromRefs(entry.refs)
    const parentBranch = entry.parents[0] ? hashBranchMap.get(entry.parents[0]) : null
    const branch = localRefs[0] ?? parentBranch ?? (primaryBranch || 'main')
    hashBranchMap.set(entry.commit, branch)
    graph.push({
      branch,
      hash: entry.shortCommit,
      subject: entry.summary,
      author: entry.authorName,
      refs: entry.refs,
    })
  }

  return graph
}

export function useGitWorkspaceController({
  locale,
  workspaceId,
  summary,
  onRefreshSummary,
}: UseGitWorkspaceControllerInput): GitWorkspaceController {
  const [filter, setFilter] = useState<GitFileFilter>('all')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diffPatch, setDiffPatch] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [metaLoading, setMetaLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [checkoutTarget, setCheckoutTarget] = useState<string>('')
  const [stashMessage, setStashMessage] = useState('')
  const [logEntries, setLogEntries] = useState<GitCommitEntry[]>([])
  const [historySkip, setHistorySkip] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [branches, setBranches] = useState<GitBranchEntry[]>([])
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([])
  const diffSeqRef = useRef(0)

  const stagedFiles = useMemo(
    () => (summary?.files ?? []).filter((item) => item.staged),
    [summary?.files],
  )
  const unstagedFiles = useMemo(
    () => (summary?.files ?? []).filter((item) => !item.staged),
    [summary?.files],
  )
  const visibleFiles = useMemo(() => {
    if (!summary) {
      return []
    }
    if (filter === 'staged') {
      return stagedFiles
    }
    if (filter === 'unstaged') {
      return unstagedFiles
    }
    return summary.files
  }, [filter, stagedFiles, summary, unstagedFiles])

  const hasStagedFiles = stagedFiles.length > 0
  const hasUnstagedFiles = unstagedFiles.length > 0
  const selectedBranchEntry = useMemo(
    () => branches.find((item) => item.name === checkoutTarget) ?? null,
    [branches, checkoutTarget],
  )

  const graphCommits = useMemo(
    () => buildGraphCommits(logEntries, summary?.branch ?? 'main'),
    [logEntries, summary?.branch],
  )

  const renderedDiffHtml = useMemo(() => {
    if (!diffPatch.trim()) {
      return ''
    }
    try {
      return renderDiffHtml(diffPatch, {
        drawFileList: false,
        matching: 'lines',
        outputFormat: 'line-by-line',
      })
    } catch {
      return `<pre>${diffPatch.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
    }
  }, [diffPatch])

  const fetchHistoryPage = useCallback(
    async (skip: number, mode: 'replace' | 'append') => {
      if (!workspaceId) {
        setLogEntries([])
        setHasMoreHistory(false)
        setHistorySkip(0)
        return
      }
      setHistoryLoading(true)
      try {
        const response = await desktopApi.gitLog(workspaceId, {
          limit: HISTORY_PAGE_SIZE,
          skip,
        })
        setLogEntries((prev) =>
          mode === 'append' ? [...prev, ...response.entries] : response.entries,
        )
        setHasMoreHistory(response.entries.length === HISTORY_PAGE_SIZE)
        setHistorySkip(skip)
      } finally {
        setHistoryLoading(false)
      }
    },
    [workspaceId],
  )

  const refreshMeta = useCallback(async () => {
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      setHasMoreHistory(false)
      setHistorySkip(0)
      return
    }
    setMetaLoading(true)
    try {
      const [branchResponse, stashResponse] = await Promise.all([
        desktopApi.gitListBranches(workspaceId, true),
        desktopApi.gitStashList(workspaceId, STASH_LIMIT),
      ])
      setBranches(branchResponse.branches)
      setStashEntries(stashResponse.entries)
      const currentBranch =
        branchResponse.branches.find((item) => item.current)?.name ??
        branchResponse.branches[0]?.name ??
        ''
      setCheckoutTarget((prev) => prev || currentBranch)
      await fetchHistoryPage(0, 'replace')
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(t(locale, 'git.error.metaLoad', { detail: describeUnknownError(error) }))
    } finally {
      setMetaLoading(false)
    }
  }, [fetchHistoryPage, locale, workspaceId])

  const refreshAll = useCallback(async () => {
    await onRefreshSummary(workspaceId)
    await refreshMeta()
  }, [onRefreshSummary, refreshMeta, workspaceId])

  const runAction = useCallback(
    async (actionKey: string, runner: () => Promise<void>) => {
      setActionLoading(actionKey)
      try {
        await runner()
        setErrorMessage(null)
      } catch (error) {
        setErrorMessage(describeUnknownError(error))
      } finally {
        setActionLoading(null)
      }
    },
    [],
  )

  const stagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !path) {
        return
      }
      await runAction('stage', async () => {
        await desktopApi.gitStage(workspaceId, [path])
        await refreshAll()
      })
    },
    [refreshAll, runAction, workspaceId],
  )

  const unstagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !path) {
        return
      }
      await runAction('unstage', async () => {
        await desktopApi.gitUnstage(workspaceId, [path])
        await refreshAll()
      })
    },
    [refreshAll, runAction, workspaceId],
  )

  const stageAll = useCallback(async () => {
    if (!workspaceId || unstagedFiles.length === 0) {
      return
    }
    await runAction('stage-all', async () => {
      await desktopApi.gitStage(
        workspaceId,
        unstagedFiles.map((item) => item.path),
      )
      await refreshAll()
    })
  }, [refreshAll, runAction, unstagedFiles, workspaceId])

  const unstageAll = useCallback(async () => {
    if (!workspaceId || stagedFiles.length === 0) {
      return
    }
    await runAction('unstage-all', async () => {
      await desktopApi.gitUnstage(
        workspaceId,
        stagedFiles.map((item) => item.path),
      )
      await refreshAll()
    })
  }, [refreshAll, runAction, stagedFiles, workspaceId])

  const discardPath = useCallback(
    async (path: string, includeUntracked = false) => {
      if (!workspaceId || !path) {
        return
      }
      if (!window.confirm(t(locale, 'git.confirm.discard', { path }))) {
        return
      }
      await runAction('discard', async () => {
        await desktopApi.gitDiscard(workspaceId, [path], includeUntracked)
        await refreshAll()
      })
    },
    [locale, refreshAll, runAction, workspaceId],
  )

  const commit = useCallback(async () => {
    const trimmed = commitMessage.trim()
    if (!workspaceId || !trimmed) {
      return
    }
    await runAction('commit', async () => {
      await desktopApi.gitCommit(workspaceId, trimmed)
      setCommitMessage('')
      await refreshAll()
    })
  }, [commitMessage, refreshAll, runAction, workspaceId])

  const fetch = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    await runAction('fetch', async () => {
      await desktopApi.gitFetch(workspaceId)
      await refreshAll()
    })
  }, [refreshAll, runAction, workspaceId])

  const pull = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    await runAction('pull', async () => {
      await desktopApi.gitPull(workspaceId)
      await refreshAll()
    })
  }, [refreshAll, runAction, workspaceId])

  const push = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    await runAction('push', async () => {
      await desktopApi.gitPush(workspaceId)
      await refreshAll()
    })
  }, [refreshAll, runAction, workspaceId])

  const checkout = useCallback(async () => {
    if (!workspaceId || !checkoutTarget.trim()) {
      return
    }
    await runAction('checkout', async () => {
      await desktopApi.gitCheckout(workspaceId, checkoutTarget.trim(), { create: false })
      await refreshAll()
    })
  }, [checkoutTarget, refreshAll, runAction, workspaceId])

  const createBranch = useCallback(async () => {
    const branch = newBranchName.trim()
    if (!workspaceId || !branch) {
      return
    }
    await runAction('create-branch', async () => {
      await desktopApi.gitCreateBranch(workspaceId, branch, null)
      setNewBranchName('')
      setCheckoutTarget(branch)
      await refreshAll()
    })
  }, [newBranchName, refreshAll, runAction, workspaceId])

  const deleteBranch = useCallback(async () => {
    if (!workspaceId || !checkoutTarget.trim()) {
      return
    }
    if (selectedBranchEntry?.current) {
      return
    }
    if (!window.confirm(t(locale, 'git.confirm.deleteBranch', { branch: checkoutTarget }))) {
      return
    }
    await runAction('delete-branch', async () => {
      await desktopApi.gitDeleteBranch(workspaceId, checkoutTarget, false)
      await refreshAll()
    })
  }, [checkoutTarget, locale, refreshAll, runAction, selectedBranchEntry?.current, workspaceId])

  const stashPush = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    await runAction('stash-push', async () => {
      await desktopApi.gitStashPush(workspaceId, {
        message: stashMessage.trim() || null,
      })
      setStashMessage('')
      await refreshAll()
    })
  }, [refreshAll, runAction, stashMessage, workspaceId])

  const stashPop = useCallback(
    async (stash: string | null) => {
      if (!workspaceId) {
        return
      }
      await runAction('stash-pop', async () => {
        await desktopApi.gitStashPop(workspaceId, stash)
        await refreshAll()
      })
    },
    [refreshAll, runAction, workspaceId],
  )

  const loadOlderHistory = useCallback(async () => {
    if (!workspaceId || historyLoading || !hasMoreHistory) {
      return
    }
    await fetchHistoryPage(historySkip + HISTORY_PAGE_SIZE, 'append')
  }, [fetchHistoryPage, hasMoreHistory, historyLoading, historySkip, workspaceId])

  const resetToLatestHistory = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  useEffect(() => {
    setFilter('all')
    setSelectedPath(null)
    setDiffPatch('')
    setCommitMessage('')
    setNewBranchName('')
    setStashMessage('')
    setCheckoutTarget('')
    setHistorySkip(0)
    setHasMoreHistory(false)
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      return
    }
    void refreshMeta()
  }, [refreshMeta, workspaceId])

  useEffect(() => {
    if (!summary || summary.files.length === 0) {
      setSelectedPath(null)
      setDiffPatch('')
      return
    }
    if (selectedPath && summary.files.some((item) => item.path === selectedPath)) {
      return
    }
    setSelectedPath(summary.files[0].path)
  }, [selectedPath, summary])

  useEffect(() => {
    if (!workspaceId || !selectedPath) {
      setDiffPatch('')
      return
    }
    const seq = diffSeqRef.current + 1
    diffSeqRef.current = seq
    setDiffLoading(true)
    void desktopApi
      .gitDiffFile(workspaceId, selectedPath)
      .then((response) => {
        if (diffSeqRef.current !== seq) {
          return
        }
        setDiffPatch(response.patch)
      })
      .catch((error) => {
        if (diffSeqRef.current !== seq) {
          return
        }
        setDiffPatch(`-- ${describeUnknownError(error)} --`)
      })
      .finally(() => {
        if (diffSeqRef.current === seq) {
          setDiffLoading(false)
        }
      })
  }, [selectedPath, workspaceId])

  return {
    locale,
    workspaceId,
    summary,
    stagedFiles,
    unstagedFiles,
    visibleFiles,
    hasStagedFiles,
    hasUnstagedFiles,
    filter,
    setFilter,
    selectedPath,
    selectPath: setSelectedPath,
    diffLoading,
    renderedDiffHtml,
    metaLoading,
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
    logEntries,
    historyLoading,
    hasMoreHistory,
    branches,
    stashEntries,
    graphCommits,
    refreshAll,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    discardPath,
    commit,
    fetch,
    pull,
    push,
    checkout,
    createBranch,
    deleteBranch,
    stashPush,
    stashPop,
    loadOlderHistory,
    resetToLatestHistory,
  }
}

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
  } = controller
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const fileVirtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  })
  const totalFiles = summary?.files.length ?? 0
  const aheadBehindCopy = summary
    ? t(locale, 'shell.git.summaryStatus', {
        branch: summary.branch,
        ahead: summary.ahead,
        behind: summary.behind,
      })
    : t(locale, 'shell.git.statusMissing')

  if (!workspaceId) {
    return (
      <section className="panel git-ops-pane">
        <h2>{t(locale, 'pane.git.title')}</h2>
        <p>{t(locale, 'git.workspaceRequired')}</p>
      </section>
    )
  }

  return (
    <section className="panel git-ops-pane">
      <header className="git-ops-header">
        <div className="git-ops-title">
          <span className="git-eyebrow">{t(locale, 'pane.git.title')}</span>
          <div className="git-ops-heading">
            <h2>{summary?.branch || t(locale, 'git.branch.title')}</h2>
            <span className="git-chip subtle">{aheadBehindCopy}</span>
          </div>
        </div>
        <div className="git-ops-metrics">
          <span className="git-badge success">↑ {summary?.ahead ?? 0}</span>
          <span className="git-badge warning">↓ {summary?.behind ?? 0}</span>
          <span className="git-badge muted">
            {totalFiles} {t(locale, 'git.files.title')}
          </span>
        </div>
      </header>

      <div className="git-ops-toolbar">
        <button type="button" onClick={() => void refreshAll()} disabled={Boolean(actionLoading)}>
          {t(locale, 'fileTree.refresh')}
        </button>
        <button type="button" onClick={() => void fetch()} disabled={Boolean(actionLoading)}>
          {t(locale, 'git.action.fetch')}
        </button>
        <button type="button" onClick={() => void pull()} disabled={Boolean(actionLoading)}>
          {t(locale, 'git.action.pull')}
        </button>
        <button type="button" onClick={() => void push()} disabled={Boolean(actionLoading)}>
          {t(locale, 'git.action.push')}
        </button>
      </div>

      <section className="git-ops-card">
        <header className="git-card-header">
          <strong>{t(locale, 'git.files.title')}</strong>
          <span>{t(locale, 'git.files.count', { count: totalFiles })}</span>
        </header>
        <div className="git-filter-chips" role="group" aria-label={t(locale, 'git.files.title')}>
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            {t(locale, 'git.filter.all')}
          </button>
          <button
            type="button"
            className={filter === 'staged' ? 'active' : ''}
            onClick={() => setFilter('staged')}
          >
            {t(locale, 'git.filter.staged')}
          </button>
          <button
            type="button"
            className={filter === 'unstaged' ? 'active' : ''}
            onClick={() => setFilter('unstaged')}
          >
            {t(locale, 'git.filter.unstaged')}
          </button>
        </div>

        <div className="git-ops-quick-actions">
          <button type="button" onClick={() => void stageAll()} disabled={!hasUnstagedFiles || Boolean(actionLoading)}>
            {t(locale, 'git.action.stageAll')}
          </button>
          <button
            type="button"
            onClick={() => void unstageAll()}
            disabled={!hasStagedFiles || Boolean(actionLoading)}
          >
            {t(locale, 'git.action.unstageAll')}
          </button>
        </div>

        <div ref={viewportRef} className="git-file-list git-file-list-compact">
          <div className="git-file-list-inner" style={{ height: `${fileVirtualizer.getTotalSize()}px` }}>
            {fileVirtualizer.getVirtualItems().map((virtualItem) => {
              const file = visibleFiles[virtualItem.index]
              if (!file) {
                return null
              }
              const isActive = selectedPath === file.path
              const isUntracked = file.status.startsWith('??')
              return (
                <div
                  key={file.path}
                  className={`git-file-row ${isActive ? 'active' : ''}`}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <button type="button" className="git-file-select" onClick={() => selectPath(file.path)}>
                    <span className={`git-status-chip ${file.staged ? 'staged' : 'unstaged'}`}>
                      <span className="git-status-dot" />
                      {file.status || '--'}
                    </span>
                    <span className="git-file-path">{file.path}</span>
                  </button>
                  {file.staged ? (
                    <button type="button" onClick={() => void unstagePath(file.path)} disabled={Boolean(actionLoading)}>
                      {t(locale, 'git.action.unstage')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void stagePath(file.path)} disabled={Boolean(actionLoading)}>
                      {t(locale, 'git.action.stage')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void discardPath(file.path, isUntracked)}
                    disabled={Boolean(actionLoading)}
                  >
                    {t(locale, 'git.action.discard')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="git-ops-card">
        <header className="git-card-header">
          <strong>{t(locale, 'git.commit.title')}</strong>
          <span>{hasStagedFiles ? t(locale, 'git.commit.ready') : t(locale, 'git.commit.empty')}</span>
        </header>
        <textarea
          rows={4}
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder={t(locale, 'git.commit.placeholder')}
        />
        <div className="git-card-controls">
          <button
            type="button"
            onClick={() => void commit()}
            disabled={!hasStagedFiles || !commitMessage.trim() || Boolean(actionLoading)}
          >
            {t(locale, 'git.action.commit')}
          </button>
          <button type="button" onClick={() => void stashPush()} disabled={!hasUnstagedFiles || Boolean(actionLoading)}>
            {t(locale, 'git.action.stashPush')}
          </button>
        </div>
        <input
          value={stashMessage}
          onChange={(event) => setStashMessage(event.target.value)}
          placeholder={t(locale, 'git.stash.messagePlaceholder')}
        />
      </section>

      <section className="git-ops-card">
        <header className="git-card-header">
          <strong>{t(locale, 'git.branch.title')}</strong>
          <span>{t(locale, 'git.branch.count', { count: branches.length })}</span>
        </header>
        <div className="git-card-controls">
          <select value={checkoutTarget} onChange={(event) => setCheckoutTarget(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.current ? `* ${branch.name}` : branch.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void checkout()} disabled={!checkoutTarget || Boolean(actionLoading)}>
            {t(locale, 'git.action.checkout')}
          </button>
          <button
            type="button"
            onClick={() => void deleteBranch()}
            disabled={!checkoutTarget || selectedBranchEntry?.current || Boolean(actionLoading)}
          >
            {t(locale, 'git.action.deleteBranch')}
          </button>
        </div>
        <div className="git-card-controls">
          <input
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder={t(locale, 'git.branch.createPlaceholder')}
          />
          <button type="button" onClick={() => void createBranch()} disabled={!newBranchName.trim() || Boolean(actionLoading)}>
            {t(locale, 'git.action.createBranch')}
          </button>
        </div>
      </section>

      <section className="git-ops-card">
        <header className="git-card-header">
          <strong>{t(locale, 'git.stash.title')}</strong>
          <span>{t(locale, 'git.stash.count', { count: stashEntries.length })}</span>
        </header>
        <div className="git-stash-list git-stash-list-compact">
          {stashEntries.length === 0 ? <span>{t(locale, 'git.stash.empty')}</span> : null}
          {stashEntries.slice(0, 8).map((entry) => (
            <div className="git-stash-row" key={entry.stash}>
              <div>
                <strong>{entry.stash}</strong>
                <p>{entry.summary}</p>
              </div>
              <button type="button" onClick={() => void stashPop(entry.stash)} disabled={Boolean(actionLoading)}>
                {t(locale, 'git.action.stashPop')}
              </button>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

interface GitHistoryPaneProps {
  controller: GitWorkspaceController
}

export function GitHistoryPane({ controller }: GitHistoryPaneProps) {
  const {
    locale,
    workspaceId,
    summary,
    diffLoading,
    renderedDiffHtml,
    logEntries,
    graphCommits,
    selectedPath,
    historyLoading,
    hasMoreHistory,
    loadOlderHistory,
    resetToLatestHistory,
  } = controller

  const gitGraphTemplate = useMemo(
    () =>
      templateExtend(TemplateName.Metro, {
        branch: {
          lineWidth: 3,
          spacing: 32,
          label: {
            font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
          },
        },
        commit: {
          spacing: 34,
          dot: {
            size: 5,
            strokeWidth: 2,
          },
          message: {
            font: '11px ui-sans-serif',
          },
        },
      }),
    [],
  )

  if (!workspaceId) {
    return (
      <section className="panel git-history-pane">
        <header className="git-pane-header">
          <h2>{t(locale, 'git.history.title')}</h2>
          <p>{t(locale, 'git.workspaceRequired')}</p>
        </header>
      </section>
    )
  }

  return (
    <section className="panel git-history-pane">
      <header className="git-pane-header">
        <div className="git-pane-summary">
          <h2>{t(locale, 'git.history.title')}</h2>
          <p>
            {summary
              ? t(locale, 'shell.git.summaryStatus', {
                  branch: summary.branch,
                  ahead: summary.ahead,
                  behind: summary.behind,
                })
              : t(locale, 'shell.git.statusMissing')}
          </p>
        </div>
      </header>

      <section className="git-card git-graph-card">
        <header className="git-card-header">
          <strong>{t(locale, 'git.graph.title')}</strong>
          <span>{t(locale, 'git.log.count', { count: logEntries.length })}</span>
        </header>
        <div className="git-graph-canvas">
          {graphCommits.length === 0 ? (
            <span>{t(locale, 'git.log.empty')}</span>
          ) : (
            <Gitgraph
              options={{
                orientation: Orientation.VerticalReverse,
                template: gitGraphTemplate,
              }}
            >
              {(gitgraph) => {
                const branchMap = new Map<string, any>()
                for (const commit of graphCommits) {
                  if (!branchMap.has(commit.branch)) {
                    branchMap.set(commit.branch, gitgraph.branch(commit.branch))
                  }
                  const refs = commit.refs.join(', ')
                  branchMap.get(commit.branch).commit({
                    subject: refs ? `${commit.subject}  [${refs}]` : commit.subject,
                    hash: commit.hash,
                    author: commit.author,
                  })
                }
              }}
            </Gitgraph>
          )}
        </div>
      </section>

      <div className="git-history-bottom">
        <section className="git-card git-log-card">
          <header className="git-card-header">
            <strong>{t(locale, 'git.log.title')}</strong>
            <span>{t(locale, 'git.log.count', { count: logEntries.length })}</span>
          </header>
          <div className="git-card-controls">
            <button
              type="button"
              onClick={() => void loadOlderHistory()}
              disabled={!hasMoreHistory || historyLoading}
            >
              {t(locale, 'git.history.loadOlder')}
            </button>
            <button
              type="button"
              onClick={() => void resetToLatestHistory()}
              disabled={historyLoading}
            >
              {t(locale, 'git.history.backToLatest')}
            </button>
          </div>
          <div className="git-log-list">
            {logEntries.length === 0 ? <span>{t(locale, 'git.log.empty')}</span> : null}
            {logEntries.map((entry) => (
              <article key={entry.commit} className="git-log-row">
                <div>
                  <strong>{entry.summary}</strong>
                  <p>
                    {entry.authorName} · {formatGitTimestamp(entry.authoredAt, locale)} ·{' '}
                    {entry.refs.join(', ') || '-'}
                  </p>
                </div>
                <code>{entry.shortCommit}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="git-card git-diff-card">
          <header className="git-card-header">
            <strong>{t(locale, 'git.diff.title')}</strong>
            <span>{selectedPath ?? t(locale, 'git.diff.none')}</span>
          </header>
          <div className="git-diff-body git-diff-renderer">
            {diffLoading ? (
              <span>{t(locale, 'git.diff.loading')}</span>
            ) : renderedDiffHtml ? (
              <div dangerouslySetInnerHTML={{ __html: renderedDiffHtml }} />
            ) : (
              <span>{t(locale, 'git.diff.empty')}</span>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
