/**
 * Language ID type and detection/mapping utilities for Monaco Editor.
 * Preserves the same LanguageId set from the CodeMirror era for API compatibility,
 * but maps each to its Monaco language identifier.
 */

export type LanguageId =
  // JavaScript family
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  // Scripting languages
  | 'python'
  | 'ruby'
  | 'lua'
  | 'shell'
  | 'powershell'
  | 'bat'
  // Systems languages
  | 'rust'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'swift'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'php'
  // Data formats
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'sql'
  | 'graphql'
  | 'protobuf'
  // Markup / style languages
  | 'markdown'
  | 'html'
  | 'css'
  | 'scss'
  | 'less'
  // Infrastructure
  | 'dockerfile'
  // Frameworks
  | 'vue'
  | 'svelte'
  // Default
  | 'plain'

/**
 * Map LanguageId to Monaco editor language identifier.
 * Monaco uses these identifiers to activate syntax highlighting and language services.
 */
const LANGUAGE_TO_MONACO: Record<LanguageId, string> = {
  // JavaScript family
  javascript: 'javascript',
  typescript: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',

  // Scripting languages
  python: 'python',
  ruby: 'ruby',
  lua: 'lua',
  shell: 'shell',
  powershell: 'powershell',
  bat: 'bat',

  // Systems languages
  rust: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',

  // Data formats
  json: 'json',
  yaml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  protobuf: 'protobuf',

  // Markup / style languages
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',

  // Infrastructure
  dockerfile: 'dockerfile',

  // Frameworks
  vue: 'html',
  svelte: 'html',

  // Default
  plain: 'plaintext',
}

/**
 * Convert a LanguageId to a Monaco language identifier string.
 */
export function toMonacoLanguageId(langId: LanguageId): string {
  return LANGUAGE_TO_MONACO[langId] ?? 'plaintext'
}

/**
 * File extension to LanguageId mapping.
 * Preserved from the CodeMirror era for consistency.
 */
const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = {
  // JavaScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // TypeScript
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',

  // JSX/TSX
  jsx: 'jsx',
  tsx: 'tsx',

  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',

  // Ruby
  rb: 'ruby',
  rbi: 'ruby',

  // Lua
  lua: 'lua',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',

  // PowerShell
  ps1: 'powershell',
  psm1: 'powershell',

  // Batch
  bat: 'bat',
  cmd: 'bat',

  // Rust
  rs: 'rust',

  // Go
  go: 'go',

  // Java
  java: 'java',

  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',

  // Swift
  swift: 'swift',

  // C/C++
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cxx: 'cpp',

  // C#
  cs: 'csharp',

  // PHP
  php: 'php',

  // JSON
  json: 'json',
  jsonc: 'json',
  json5: 'json',

  // YAML
  yaml: 'yaml',
  yml: 'yaml',

  // TOML
  toml: 'toml',

  // XML
  xml: 'xml',

  // SQL
  sql: 'sql',

  // GraphQL
  graphql: 'graphql',
  gql: 'graphql',

  // Protobuf
  proto: 'protobuf',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',

  // HTML
  html: 'html',
  htm: 'html',

  // CSS
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',

  // Vue
  vue: 'vue',

  // Svelte
  svelte: 'svelte',
}

/**
 * Filename (without extension) to LanguageId mapping.
 */
const BASENAME_TO_LANGUAGE: Record<string, LanguageId> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
  justfile: 'shell',
  procfile: 'shell',
}

/**
 * Detect language from file path.
 * @param filePath - File path or filename
 * @returns LanguageId for the file, or 'plain' if unknown
 */
export function detectLanguageFromPath(filePath: string | null): LanguageId {
  if (!filePath) return 'plain'

  const normalized = filePath.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''

  const baseName = fileName.toLowerCase()
  if (BASENAME_TO_LANGUAGE[baseName]) {
    return BASENAME_TO_LANGUAGE[baseName]
  }

  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    const ext = baseName.slice(dotIndex + 1)
    if (EXTENSION_TO_LANGUAGE[ext]) {
      return EXTENSION_TO_LANGUAGE[ext]
    }
  }

  return 'plain'
}