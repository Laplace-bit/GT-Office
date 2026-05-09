function normalizeRelativePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/^\/\/\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')

  if (!normalized || normalized === '.') {
    return ''
  }

  return normalized
    .split('/')
    .filter((segment) => segment && segment !== '.')
    .join('/')
}

function normalizeRootForJoin(workspaceRoot: string): { root: string; separator: '\\' | '/' } {
  const raw = workspaceRoot.trim()
  const separator: '\\' | '/' = raw.includes('\\') ? '\\' : '/'
  if (!raw) {
    return {
      root: '',
      separator,
    }
  }

  if (raw === '/' || raw === '\\') {
    return {
      root: separator,
      separator,
    }
  }

  const stripped = raw.replace(/[\\/]+$/, '')
  if (!stripped) {
    return {
      root: separator,
      separator,
    }
  }

  if (/^[A-Za-z]:$/.test(stripped)) {
    return {
      root: `${stripped}${separator}`,
      separator,
    }
  }

  if (/^\\\\\?\\[A-Za-z]:$/.test(stripped)) {
    return {
      root: `${stripped}\\`,
      separator: '\\',
    }
  }

  return {
    root: stripped,
    separator,
  }
}

export function resolveWorkspaceAbsolutePath(
  workspaceRoot: string | null | undefined,
  workspaceRelativePath: string,
): string {
  if (!workspaceRoot) {
    return workspaceRelativePath
  }

  const { root: normalizedRoot, separator } = normalizeRootForJoin(workspaceRoot)
  const normalizedRelative = normalizeRelativePath(workspaceRelativePath)
  if (!normalizedRelative) {
    return normalizedRoot || workspaceRoot
  }

  const relativeForOs = normalizedRelative.split('/').join(separator)
  if (!normalizedRoot) {
    return `${separator}${relativeForOs}`
  }
  if (normalizedRoot.endsWith(separator)) {
    return `${normalizedRoot}${relativeForOs}`
  }
  return `${normalizedRoot}${separator}${relativeForOs}`
}
