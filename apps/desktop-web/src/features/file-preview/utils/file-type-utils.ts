/**
 * 文件类型判断工具
 */

export type FileCategory =
  | 'code'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'binary'
  | 'unknown'

export interface FileTypeResult {
  category: FileCategory
  extension: string
  mimeType: string
}

// 扩展名到类别的映射
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  // 代码文件
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  mjs: 'code',
  cjs: 'code',
  mts: 'code',
  cts: 'code',
  py: 'code',
  pyw: 'code',
  pyi: 'code',
  rs: 'code',
  go: 'code',
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
  sql: 'code',
  vue: 'code',
  svelte: 'code',
  json: 'code',
  jsonc: 'code',
  json5: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  xml: 'code',
  ini: 'code',
  conf: 'code',
  cfg: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  html: 'code',
  htm: 'code',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',

  // 图片
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

  // 视频
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',

  // 音频
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  m4a: 'audio',
  ogg: 'audio',

  // PDF
  pdf: 'pdf',

  // 二进制
  exe: 'binary',
  app: 'binary',
  dmg: 'binary',
  msi: 'binary',
  bin: 'binary',
}

// 扩展名到 MIME 类型的映射
const EXTENSION_MIME: Record<string, string> = {
  // 图片
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',

  // 视频
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',

  // 音频
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',

  // PDF
  pdf: 'application/pdf',
}

/**
 * 从文件路径提取扩展名
 */
function extractExtension(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const fileName = normalized.split('/').pop() || ''
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    return fileName.slice(dotIndex + 1).toLowerCase()
  }
  return ''
}

/**
 * 判断文件类型
 */
export function categorizeFile(filePath: string | null): FileTypeResult {
  if (!filePath) {
    return { category: 'unknown', extension: '', mimeType: '' }
  }

  const ext = extractExtension(filePath)
  const category = EXTENSION_CATEGORY[ext] || 'unknown'
  const mimeType = EXTENSION_MIME[ext] || 'application/octet-stream'

  return { category, extension: ext, mimeType }
}

/**
 * 判断是否为媒体文件（图片/视频/音频）
 */
export function isMediaFile(filePath: string | null): boolean {
  const { category } = categorizeFile(filePath)
  return category === 'image' || category === 'video' || category === 'audio'
}

/**
 * 判断是否为可预览文件
 */
export function isPreviewable(filePath: string | null): boolean {
  const { category } = categorizeFile(filePath)
  return ['image', 'video', 'audio', 'pdf', 'markdown'].includes(category)
}

/**
 * 预览大小限制配置
 */
export const PREVIEW_LIMITS = {
  image: {
    maxInlineSize: 10 * 1024 * 1024, // 10MB
    thumbnailSize: 800,
  },
  video: {
    maxInlineSize: 50 * 1024 * 1024, // 50MB
  },
  audio: {
    maxInlineSize: 20 * 1024 * 1024, // 20MB
  },
  pdf: {
    maxInlineSize: 20 * 1024 * 1024, // 20MB
  },
} as const