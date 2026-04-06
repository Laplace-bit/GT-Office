import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

// Official CodeMirror language packages
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { php } from '@codemirror/lang-php'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { vue } from '@codemirror/lang-vue'

// Third-party language packages
import { csharp } from '@replit/codemirror-lang-csharp'
import { svelte } from '@replit/codemirror-lang-svelte'

// Legacy modes for languages without official packages
import { shell as shellParser } from '@codemirror/legacy-modes/mode/shell'
import { ruby as rubyParser } from '@codemirror/legacy-modes/mode/ruby'
import { lua as luaParser } from '@codemirror/legacy-modes/mode/lua'
import { toml as tomlParser } from '@codemirror/legacy-modes/mode/toml'
import { swift as swiftParser } from '@codemirror/legacy-modes/mode/swift'

/**
 * Supported language IDs for syntax highlighting
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
  // Markup languages
  | 'markdown'
  | 'html'
  | 'css'
  // Frameworks
  | 'vue'
  | 'svelte'
  // Default
  | 'plain'

/**
 * Helper to create StreamLanguage from legacy parsers
 * Casts through unknown to work around minor version incompatibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyLang(parser: any): Extension {
  return StreamLanguage.define(parser as never) as Extension
}

/**
 * Language extension configuration map
 */
const LANGUAGE_EXTENSIONS: Record<LanguageId, Extension> = {
  // JavaScript family
  javascript: javascript(),
  typescript: javascript({ typescript: true }),
  jsx: javascript({ jsx: true }),
  tsx: javascript({ jsx: true, typescript: true }),

  // Scripting languages
  python: python(),
  ruby: legacyLang(rubyParser),
  lua: legacyLang(luaParser),
  shell: legacyLang(shellParser),

  // Systems languages
  rust: rust(),
  go: go(),
  java: java(),
  kotlin: [], // No official support, fallback to plain
  swift: legacyLang(swiftParser),
  c: cpp(),
  cpp: cpp(),
  csharp: csharp(),
  php: php(),

  // Data formats
  json: json(),
  yaml: yaml(),
  toml: legacyLang(tomlParser),
  xml: xml(),
  sql: sql(),

  // Markup languages
  markdown: markdown(),
  html: html(),
  css: css(),

  // Frameworks
  vue: vue(),
  svelte: svelte(),

  // Default
  plain: [],
}

/**
 * Get language extension by language ID
 * @param langId - Language identifier
 * @returns CodeMirror extension for the language, or empty array for unknown languages
 */
export function getLanguageExtension(langId: LanguageId): Extension {
  return LANGUAGE_EXTENSIONS[langId] ?? []
}

/**
 * File extension to language ID mapping
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

  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',

  // HTML
  html: 'html',
  htm: 'html',

  // CSS
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',

  // Vue
  vue: 'vue',

  // Svelte
  svelte: 'svelte',
}

/**
 * Filename (without extension) to language ID mapping
 */
const BASENAME_TO_LANGUAGE: Record<string, LanguageId> = {
  dockerfile: 'shell',
  makefile: 'shell',
  justfile: 'shell',
  procfile: 'shell',
}

/**
 * Detect language from file path
 * @param filePath - File path or filename
 * @returns Language ID for the file, or 'plain' if unknown
 */
export function detectLanguageFromPath(filePath: string | null): LanguageId {
  if (!filePath) return 'plain'

  // Normalize path separators
  const normalized = filePath.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''

  // Check full filename (without extension)
  const baseName = fileName.toLowerCase()
  if (BASENAME_TO_LANGUAGE[baseName]) {
    return BASENAME_TO_LANGUAGE[baseName]
  }

  // Check extension
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    const ext = baseName.slice(dotIndex + 1)
    if (EXTENSION_TO_LANGUAGE[ext]) {
      return EXTENSION_TO_LANGUAGE[ext]
    }
  }

  return 'plain'
}