import type { GitStatusFile } from '@shell/integration/desktop-api'
import type { GitDiffScope } from '../useGitWorkspaceController'

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

export function getFileName(path: string): string {
  const normalizedPath = path.trim().replace(/\/+$/, '')
  if (!normalizedPath) {
    return path
  }
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath
}

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

export function resolveDiffScope(file: GitStatusFile, filter: 'all' | 'staged' | 'unstaged'): GitDiffScope {
  if (filter === 'staged') {
    return 'staged'
  }
  if (filter === 'unstaged') {
    return 'unstaged'
  }
  return hasUnstagedChanges(file) ? 'unstaged' : 'staged'
}
