function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\\?\\[A-Za-z]:[\\/]/.test(path)
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || isWindowsAbsolutePath(path)
}

function normalizeRelativePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function normalizeRootForJoin(workspaceRoot: string): { root: string; separator: '\\' | '/' } {
  const raw = workspaceRoot.trim()
  const separator: '\\' | '/' = raw.includes('\\') ? '\\' : '/'

  if (!raw) {
    return { root: '', separator }
  }

  if (raw === '/' || raw === '\\') {
    return { root: separator, separator }
  }

  const stripped = raw.replace(/[\\/]+$/, '')
  if (!stripped) {
    return { root: separator, separator }
  }

  if (/^[A-Za-z]:$/.test(stripped)) {
    return { root: `${stripped}${separator}`, separator }
  }

  if (/^\\\\\?\\[A-Za-z]:$/.test(stripped)) {
    return { root: `${stripped}\\`, separator: '\\' }
  }

  return { root: stripped, separator }
}

export function resolveMediaPreviewPath(workspaceRoot: string | null, filePath: string): string | null {
  const trimmedPath = filePath.trim()
  if (!trimmedPath) {
    return trimmedPath
  }

  if (isAbsolutePath(trimmedPath)) {
    return trimmedPath
  }

  if (!workspaceRoot?.trim()) {
    return null
  }

  const normalizedRelativePath = normalizeRelativePath(trimmedPath)
  const { root, separator } = normalizeRootForJoin(workspaceRoot)
  const relativeForOs = normalizedRelativePath.split('/').join(separator)

  if (!root) {
    return relativeForOs
  }

  if (root.endsWith(separator)) {
    return `${root}${relativeForOs}`
  }

  return `${root}${separator}${relativeForOs}`
}
