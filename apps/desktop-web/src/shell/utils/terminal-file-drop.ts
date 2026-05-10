export const TERMINAL_FILE_DROP_MIME = 'application/x-gt-office-terminal-file-path+json'

export interface TerminalFileDropPayload {
  relativePath: string
  absolutePath: string
  shellText: string
  label: string
}

type DragDataTransferLike = Pick<DataTransfer, 'getData' | 'setData' | 'types'>

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

function resolveWorkspaceAbsolutePath(
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

function resolveLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
}

function isTerminalFileDropPayload(value: unknown): value is TerminalFileDropPayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const payload = value as Partial<TerminalFileDropPayload>
  return (
    typeof payload.relativePath === 'string' &&
    typeof payload.absolutePath === 'string' &&
    typeof payload.shellText === 'string' &&
    typeof payload.label === 'string'
  )
}

export function buildTerminalFileDropPayload(
  workspaceRoot: string | null | undefined,
  relativePath: string,
): TerminalFileDropPayload {
  const absolutePath = resolveWorkspaceAbsolutePath(workspaceRoot, relativePath)
  const normalizedRelativePath = normalizeRelativePath(relativePath) || relativePath.trim()
  return {
    relativePath: normalizedRelativePath,
    absolutePath,
    shellText: ` @${normalizedRelativePath} `,
    label: resolveLabel(normalizedRelativePath) || resolveLabel(absolutePath) || absolutePath,
  }
}

export function writeTerminalFileDropPayload(
  dataTransfer: DragDataTransferLike,
  payload: TerminalFileDropPayload,
): void {
  dataTransfer.setData(TERMINAL_FILE_DROP_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', payload.shellText)
}

export function readTerminalFileDropPayload(
  dataTransfer: Pick<DataTransfer, 'getData'> | null | undefined,
): TerminalFileDropPayload | null {
  if (!dataTransfer) {
    return null
  }

  const raw = dataTransfer.getData(TERMINAL_FILE_DROP_MIME)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return isTerminalFileDropPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function hasTerminalFileDropPayload(
  types: ArrayLike<string> | readonly string[] | null | undefined,
): boolean {
  if (!types) {
    return false
  }
  return Array.from(types).includes(TERMINAL_FILE_DROP_MIME)
}
