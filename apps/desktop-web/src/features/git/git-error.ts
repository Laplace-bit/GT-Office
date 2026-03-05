const NON_GIT_REPOSITORY_MARKERS = [
  'git_repo_invalid',
  'not a git repository',
  'must be run in a work tree',
]

function toErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return ''
}

export function isNotGitRepositoryError(error: unknown): boolean {
  const text = toErrorText(error).toLowerCase()
  if (!text) {
    return false
  }
  return NON_GIT_REPOSITORY_MARKERS.some((marker) => text.includes(marker))
}
