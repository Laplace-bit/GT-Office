import type { LucideIcon } from 'lucide-react'
import {
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileMusic,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideoCamera,
  Folder,
  FolderOpen,
} from 'lucide-react'

export type FileVisualKind =
  | 'folder'
  | 'code'
  | 'document'
  | 'data'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'config'
  | 'lock'
  | 'binary'
  | 'unknown'

export interface FileVisual {
  kind: FileVisualKind
  icon: LucideIcon
  badge: string | null
}

const MULTI_EXTENSION_KIND: Record<string, FileVisualKind> = {
  'tar.gz': 'archive',
  'tar.bz2': 'archive',
  'tar.xz': 'archive',
}

const EXTENSION_KIND: Record<string, FileVisualKind> = {
  // Code
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  mjs: 'code',
  cjs: 'code',
  rs: 'code',
  go: 'code',
  py: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  swift: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  rb: 'code',
  lua: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  ps1: 'code',

  // Document
  md: 'document',
  mdx: 'document',
  txt: 'document',
  rtf: 'document',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  ppt: 'document',
  pptx: 'document',

  // Data / markup
  json: 'data',
  jsonc: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  ini: 'data',
  conf: 'data',
  cfg: 'data',
  csv: 'data',
  tsv: 'data',
  xls: 'data',
  xlsx: 'data',
  xml: 'data',
  sql: 'data',

  // Image
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  ico: 'image',
  bmp: 'image',
  heic: 'image',
  avif: 'image',

  // Video
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',

  // Audio
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  m4a: 'audio',
  ogg: 'audio',

  // Archive
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  tgz: 'archive',

  // Lock / config
  lock: 'lock',
  env: 'config',

  // Binary / executable
  exe: 'binary',
  app: 'binary',
  dmg: 'binary',
  msi: 'binary',
  bin: 'binary',
}

const BASENAME_KIND: Record<string, FileVisualKind> = {
  dockerfile: 'config',
  makefile: 'config',
  justfile: 'config',
  procfile: 'config',
  '.env': 'config',
  '.env.local': 'config',
  '.env.production': 'config',
  '.env.development': 'config',
  '.gitignore': 'config',
  '.gitattributes': 'config',
  '.gitmodules': 'config',
  '.editorconfig': 'config',
  '.npmrc': 'config',
  '.yarnrc': 'config',
  '.prettierrc': 'config',
  '.eslintrc': 'config',
  readme: 'document',
  license: 'document',
  changelog: 'document',
}

const ICON_BY_KIND: Record<FileVisualKind, LucideIcon> = {
  folder: Folder,
  code: FileCode,
  document: FileType,
  data: FileSpreadsheet,
  image: FileImage,
  video: FileVideoCamera,
  audio: FileMusic,
  archive: FileArchive,
  config: FileCog,
  lock: FileLock,
  binary: FileTerminal,
  unknown: FileText,
}

const BADGE_ALIAS: Record<string, string> = {
  'tar.gz': 'TGZ',
  'tar.bz2': 'TBZ2',
  'tar.xz': 'TXZ',
  dockerfile: 'DOCKER',
  makefile: 'MAKE',
  justfile: 'JUST',
  procfile: 'PROC',
}

const CACHE = new Map<string, FileVisual>()

function normalizeName(pathOrName: string): string {
  const normalized = pathOrName.replaceAll('\\\\', '/')
  const segments = normalized.split('/')
  return (segments[segments.length - 1] || '').trim()
}

function getKindFromName(name: string): { kind: FileVisualKind; badgeSource: string | null } {
  const lowerName = name.toLowerCase()
  const multiExtension = Object.keys(MULTI_EXTENSION_KIND).find((suffix) => lowerName.endsWith(`.${suffix}`))
  if (multiExtension) {
    return { kind: MULTI_EXTENSION_KIND[multiExtension], badgeSource: multiExtension }
  }

  if (BASENAME_KIND[lowerName]) {
    return { kind: BASENAME_KIND[lowerName], badgeSource: lowerName }
  }

  const dotIndex = lowerName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < lowerName.length - 1) {
    const extension = lowerName.slice(dotIndex + 1)
    return { kind: EXTENSION_KIND[extension] ?? 'unknown', badgeSource: extension }
  }

  return { kind: 'unknown', badgeSource: null }
}

function toBadgeLabel(source: string | null): string | null {
  if (!source) {
    return null
  }
  const alias = BADGE_ALIAS[source]
  if (alias) {
    return alias
  }
  const compact = source.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (!compact) {
    return null
  }
  return compact.slice(0, 5)
}

export function resolveFileVisual(pathOrName: string, kind: 'dir' | 'file', expanded = false): FileVisual {
  if (kind === 'dir') {
    return {
      kind: 'folder',
      icon: expanded ? FolderOpen : Folder,
      badge: null,
    }
  }

  const fileName = normalizeName(pathOrName)
  const cacheKey = `file:${fileName.toLowerCase()}`
  const cached = CACHE.get(cacheKey)
  if (cached) {
    return cached
  }

  const resolved = getKindFromName(fileName)
  const visual: FileVisual = {
    kind: resolved.kind,
    icon: ICON_BY_KIND[resolved.kind],
    badge: toBadgeLabel(resolved.badgeSource),
  }
  CACHE.set(cacheKey, visual)
  return visual
}
