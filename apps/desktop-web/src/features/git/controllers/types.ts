import type {
  GitBranchEntry,
  GitCommitEntry,
  GitDiffStructuredResponse,
  GitRepositorySummary,
  GitStashEntry,
  GitStatusFile,
  GitStatusResponse,
} from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'

// ============================================
// Filter & Scope Types
// ============================================
export type GitFileFilter = 'all' | 'staged' | 'unstaged'
export type GitDiffScope = 'staged' | 'unstaged'

// ============================================
// Graph View
// ============================================
export interface GitGraphCommitView {
  branch: string
  hash: string
  subject: string
  author: string
  refs: string[]
}

// ============================================
// Controller Interface
// ============================================
export interface GitWorkspaceController {
  locale: Locale
  workspaceId: string | null
  isGitRepository: boolean
  summary: GitStatusResponse | null
  repositories: GitRepositorySummary[]
  currentRepositoryPath: string | null
  setCurrentRepositoryPath: (repositoryPath: string | null) => void
  stagedFiles: GitStatusFile[]
  unstagedFiles: GitStatusFile[]
  visibleFiles: GitStatusFile[]
  hasStagedFiles: boolean
  hasUnstagedFiles: boolean
  filter: GitFileFilter
  setFilter: (filter: GitFileFilter) => void
  selectedPath: string | null
  selectedDiffScope: GitDiffScope
  selectPath: (path: string, scope?: GitDiffScope) => void
  diffLoading: boolean
  /** Structured diff data for high-performance rendering */
  structuredDiff: GitDiffStructuredResponse | null
  /** Diff view mode: 'split' for side-by-side, 'unified' for inline */
  diffViewMode: 'split' | 'unified'
  setDiffViewMode: (mode: 'split' | 'unified') => void
  /** Whether diff view is currently active (hides history) */
  showDiffView: boolean
  setShowDiffView: (show: boolean) => void
  /** Preload diff for a path (hover preloading) */
  preloadDiff: (path: string, scope?: GitDiffScope) => void
  metaLoading: boolean
  actionLoading: string | null
  remoteActionLoading: 'fetch' | 'pull' | 'push' | 'tagPush' | null
  errorMessage: string | null
  repositoryNotice: string | null
  dismissRepositoryNotice: () => void
  commitMessage: string
  setCommitMessage: (message: string) => void
  amendMode: boolean
  setAmendMode: (amend: boolean) => void
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
  refreshSummary: () => Promise<void>
  invalidateDiffCache: () => void
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardPath: (path: string, includeUntracked?: boolean) => Promise<void>
  commit: () => Promise<void>
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  pushTag: (name: string, remote?: string) => Promise<void>
  checkout: () => Promise<void>
  checkoutTo: (target: string) => Promise<void>
  createBranch: () => Promise<void>
  deleteBranch: () => Promise<void>
  stashPush: () => Promise<void>
  stashPop: (stash: string | null) => Promise<void>
  loadOlderHistory: () => Promise<void>
  resetToLatestHistory: () => Promise<void>
  cherryPick: (commit: string) => Promise<void>
  revert: (commit: string) => Promise<void>
  reset: (commit: string, mode: 'soft' | 'mixed' | 'hard') => Promise<void>
  createBranchFromCommit: (commit: string) => Promise<void>
  mergeConflicts: string[]
  isMerging: boolean
  startMerge: (source: string) => Promise<void>
  continueMerge: () => Promise<void>
  abortMerge: () => Promise<void>
}

// ============================================
// Controller Input
// ============================================
export interface UseGitWorkspaceControllerInput {
  locale: Locale
  workspaceId: string | null
  summary: GitStatusResponse | null
  onRefreshSummary: (
    workspaceId: string | null,
    repositoryPath?: string | null,
  ) => Promise<void>
}

// ============================================
// Constants
// ============================================
export const ROW_HEIGHT = 40
export const OVERSCAN_ROWS = 25
export const HISTORY_PAGE_SIZE = 80
export const STASH_LIMIT = 30
export const DIFF_CACHE_SIZE = 30
export const DIFF_PRELOAD_DELAY_MS = 140

// ============================================
// Formatting
// ============================================
export function formatGitTimestamp(value: string, locale: Locale): string {
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
