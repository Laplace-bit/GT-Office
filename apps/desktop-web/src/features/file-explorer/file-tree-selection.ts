export function resolveExistingTreeSelectionPath(
  selectionPath: string | null | undefined,
  nodeKindsByPath: Record<string, 'dir' | 'file'>,
): string | undefined {
  const normalizedPath = typeof selectionPath === 'string' ? selectionPath.trim() : ''
  if (!normalizedPath) {
    return undefined
  }
  return Object.prototype.hasOwnProperty.call(nodeKindsByPath, normalizedPath)
    ? normalizedPath
    : undefined
}
