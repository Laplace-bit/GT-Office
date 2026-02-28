export type StationRole = 'manager' | 'product' | 'build' | 'quality_release'

export interface StationWorkdir {
  roleWorkdirRel: string
  agentWorkdirRel: string
}

const STATION_WORKDIR_ROOT = '.gtoffice/org'
const SAFE_SEGMENT_PATTERN = /[^a-z0-9._-]+/g

function normalizePathSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(SAFE_SEGMENT_PATTERN, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'unknown'
}

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

export function buildRoleWorkdirRel(role: StationRole): string {
  return `${STATION_WORKDIR_ROOT}/${normalizePathSegment(role)}`
}

export function buildAgentWorkdirRel(role: StationRole, stationId: string): string {
  return `${buildRoleWorkdirRel(role)}/${normalizePathSegment(stationId)}`
}

export function buildStationWorkdirs(role: StationRole, stationId: string): StationWorkdir {
  return {
    roleWorkdirRel: buildRoleWorkdirRel(role),
    agentWorkdirRel: buildAgentWorkdirRel(role, stationId),
  }
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

export function buildAgentWorkspaceMarkerPath(agentWorkdirRel: string): string {
  const normalizedRel = normalizeRelativePath(agentWorkdirRel)
  return normalizedRel ? `${normalizedRel}/.agent-workspace` : '.agent-workspace'
}
