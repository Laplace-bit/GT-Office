import type { GitStatusFile } from '@shell/integration/desktop-api'
import type { GitDiffScope } from '../useGitWorkspaceController'

export type GitDiscardKind = 'tracked' | 'untracked' | 'index-new'

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

export function getCompactRepoLabel(path: string, fallback = 'Workspace'): string {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedPath) {
    return fallback
  }
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) {
    return fallback
  }
  if (segments.length === 1) {
    return segments[0]
  }
  return segments.slice(-2).join('/')
}

export function getRepositoryDisplayLabel(
  repositoryPath: string,
  isWorkspaceRoot: boolean,
  workspaceRootLabel = 'Workspace',
): string {
  if (isWorkspaceRoot) {
    return workspaceRootLabel
  }
  return getCompactRepoLabel(repositoryPath, workspaceRootLabel)
}

export function getCompactPathTail(path: string, fallback = '.', maxSegments = 2): string {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedPath) {
    return fallback
  }
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) {
    return fallback
  }
  return segments.slice(-Math.max(1, maxSegments)).join('/')
}

export function getDirectoryLabel(path: string): string {
  const normalizedPath = path.trim().replace(/\/+$/, '')
  if (!normalizedPath) {
    return '.'
  }
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : '.'
}

export function hasStagedChanges(file: GitStatusFile): boolean {
  if (isUntrackedFile(file)) {
    return false
  }
  if (file.status.length >= 2) {
    const indexStatus = file.status[0] ?? ' '
    return indexStatus !== ' ' && indexStatus !== '?'
  }
  return file.staged
}

export function hasUnstagedChanges(file: GitStatusFile): boolean {
  if (isUntrackedFile(file)) {
    return true
  }
  if (file.status.length >= 2) {
    const worktreeStatus = file.status[1] ?? ' '
    return worktreeStatus !== ' '
  }
  return !file.staged && file.status.trim().length > 0
}

export function resolveDiffScope(_file: GitStatusFile, filter: 'staged' | 'unstaged'): GitDiffScope {
  if (filter === 'staged') {
    return 'staged'
  }
  return 'unstaged'
}

export function isUntrackedFile(file: GitStatusFile): boolean {
  return file.status.startsWith('??')
}

export function isIndexNewFile(file: GitStatusFile): boolean {
  const indexStatus = file.status[0] ?? ''
  return indexStatus === 'A'
}

export function resolveDiscardKind(file: GitStatusFile): GitDiscardKind {
  if (isUntrackedFile(file)) {
    return 'untracked'
  }
  if (isIndexNewFile(file)) {
    return 'index-new'
  }
  return 'tracked'
}
