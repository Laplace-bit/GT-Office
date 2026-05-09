import type { FsEntry } from '@shell/integration/desktop-api'

function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '.' || trimmed === './') {
    return '.'
  }
  return trimmed.replace(/^\.\/+/, '').replace(/\/+$/, '')
}

function parentDirectory(path: string): string {
  const normalized = normalizeDirectoryPath(path)
  if (normalized === '.') {
    return '.'
  }
  const index = normalized.lastIndexOf('/')
  if (index < 0) {
    return '.'
  }
  return normalized.slice(0, index)
}

function leafName(path: string): string {
  const normalized = normalizeDirectoryPath(path)
  if (normalized === '.') {
    return '.'
  }
  const index = normalized.lastIndexOf('/')
  if (index < 0) {
    return normalized
  }
  return normalized.slice(index + 1)
}

export function sanitizeDirectoryEntries(
  entries: FsEntry[],
  directoryPath: string,
): FsEntry[] {
  const normalizedDirectory = normalizeDirectoryPath(directoryPath)
  const seen = new Set<string>()
  const sanitized: FsEntry[] = []

  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.name !== 'string') {
      continue
    }
    if (entry.kind !== 'dir' && entry.kind !== 'file') {
      continue
    }

    const normalizedPath = normalizeDirectoryPath(entry.path)
    if (!normalizedPath || normalizedPath === '.') {
      continue
    }
    if (parentDirectory(normalizedPath) !== normalizedDirectory) {
      continue
    }
    if (leafName(normalizedPath) !== entry.name.trim()) {
      continue
    }
    if (seen.has(normalizedPath)) {
      continue
    }
    seen.add(normalizedPath)
    sanitized.push({
      ...entry,
      path: normalizedPath,
      name: entry.name.trim(),
    })
  }

  return sanitized
}
