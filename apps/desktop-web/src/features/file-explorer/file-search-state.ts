interface FileSearchMatchLike {
  path: string
  name: string
}

interface FileSearchEntry {
  path: string
  name: string
  kind: 'file'
}

export function resolveFileSearchEntries(matches: FileSearchMatchLike[]): FileSearchEntry[] {
  const dedup = new Map<string, FileSearchEntry>()

  for (const match of matches) {
    if (!dedup.has(match.path)) {
      dedup.set(match.path, {
        path: match.path,
        name: match.name,
        kind: 'file',
      })
    }
  }

  return Array.from(dedup.values())
}
