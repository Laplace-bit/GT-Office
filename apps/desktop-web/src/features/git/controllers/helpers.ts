import type { GitStatusFile } from '@shell/integration/desktop-api'
import type { GitCommitEntry } from '@shell/integration/desktop-api'
import type { GitDiffScope, GitFileFilter, GitGraphCommitView } from './types'

// ============================================
// Error Helpers
// ============================================
export function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

// ============================================
// Status File Classification
// ============================================
export function hasStagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return false
  }
  if (file.status.length >= 2) {
    const indexStatus = file.status[0] ?? ' '
    return indexStatus !== ' ' && indexStatus !== '?'
  }
  return file.staged
}

export function hasUnstagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return true
  }
  if (file.status.length >= 2) {
    const worktreeStatus = file.status[1] ?? ' '
    return worktreeStatus !== ' '
  }
  return !file.staged && file.status.trim().length > 0
}

export function resolveDiffScope(_file: GitStatusFile, filter: GitFileFilter): GitDiffScope {
  if (filter === 'staged') {
    return 'staged'
  }
  return 'unstaged'
}

// ============================================
// Graph Helpers
// ============================================
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

export function buildGraphCommits(
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
