export interface OpenedFileWatchEntry {
  path: string
  hydrated: boolean
  viewType: 'editor' | 'preview'
}

export function normalizeWatchPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalized.length > 0 ? normalized : '.'
}

function isRootWatchPath(path: string): boolean {
  return path === '.' || path === ''
}

export function watchPathAffectsOpenedPath(watchPath: string, openedPath: string): boolean {
  const normalizedWatchPath = normalizeWatchPath(watchPath)
  const normalizedOpenedPath = normalizeWatchPath(openedPath)

  if (isRootWatchPath(normalizedWatchPath)) {
    return true
  }
  if (normalizedWatchPath === normalizedOpenedPath) {
    return true
  }
  return normalizedOpenedPath.startsWith(`${normalizedWatchPath}/`)
}

export function resolveOpenedEditorPathsForWatchEvent(
  openedFiles: OpenedFileWatchEntry[],
  changedPaths: string[],
): string[] {
  if (openedFiles.length === 0 || changedPaths.length === 0) {
    return []
  }

  const normalizedChangedPaths = changedPaths.map(normalizeWatchPath)
  const affectedPaths = new Set<string>()
  for (const file of openedFiles) {
    if (!file.hydrated || file.viewType !== 'editor') {
      continue
    }
    if (normalizedChangedPaths.some((changedPath) => watchPathAffectsOpenedPath(changedPath, file.path))) {
      affectedPaths.add(file.path)
    }
  }
  return Array.from(affectedPaths)
}
