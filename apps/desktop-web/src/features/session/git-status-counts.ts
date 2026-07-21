import type { GitStatusFile } from '@shell/integration/desktop-api'

export interface GitStatusCounts {
  stagedFiles: number
  unstagedFiles: number
  untrackedFiles: number
}

export function countCompleteGitStatusFiles(
  files: readonly GitStatusFile[],
  truncated: boolean,
): GitStatusCounts | null {
  return truncated ? null : countGitStatusFiles(files)
}

export function countGitStatusFiles(files: readonly GitStatusFile[]): GitStatusCounts {
  let stagedFiles = 0
  let unstagedFiles = 0
  let untrackedFiles = 0

  for (const file of files) {
    const status = file.status
    const untracked = status.startsWith('??')
    if (untracked) {
      untrackedFiles += 1
      continue
    }

    if (status.length >= 2) {
      const indexStatus = status[0] ?? ' '
      const worktreeStatus = status[1] ?? ' '
      if (indexStatus !== ' ' && indexStatus !== '?') {
        stagedFiles += 1
      }
      if (worktreeStatus !== ' ') {
        unstagedFiles += 1
      }
      continue
    }

    if (file.staged) {
      stagedFiles += 1
    } else if (status.trim()) {
      unstagedFiles += 1
    }
  }

  return { stagedFiles, unstagedFiles, untrackedFiles }
}
