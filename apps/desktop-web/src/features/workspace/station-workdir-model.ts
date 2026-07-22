function normalizeRelativePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/^\/\/\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  if (/^[A-Za-z]:/.test(normalized)) {
    return ''
  }
  if (!normalized || normalized === '.') {
    return ''
  }
  if (normalized.split('/').some((segment) => segment === '..' || segment.includes(':'))) {
    return ''
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  return segments.join('/')
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

export function buildAgentWorkdirRel(_agentName: string): string {
  return '.'
}

export function resolveAgentWorkdirAbs(workspaceRoot: string, agentWorkdirRel: string): string {
  const { root: normalizedRoot, separator } = normalizeRootForJoin(workspaceRoot)
  const normalizedRel = normalizeRelativePath(agentWorkdirRel)
  if (!normalizedRel) {
    return normalizedRoot
  }
  const normalizedRelForOs = normalizedRel.split('/').join(separator)
  if (!normalizedRoot) {
    return `${separator}${normalizedRelForOs}`
  }
  if (normalizedRoot.endsWith(separator)) {
    return `${normalizedRoot}${normalizedRelForOs}`
  }
  return `${normalizedRoot}${separator}${normalizedRelForOs}`
}

export function isWorkspaceRootWorkdir(agentWorkdirRel: string | null | undefined): boolean {
  return normalizeRelativePath(agentWorkdirRel ?? '') === ''
}

export function buildAgentWorkspaceMarkerPath(agentWorkdirRel: string): string {
  const normalizedRel = normalizeRelativePath(agentWorkdirRel)
  return normalizedRel ? `${normalizedRel}/.agent-workspace` : '.agent-workspace'
}
