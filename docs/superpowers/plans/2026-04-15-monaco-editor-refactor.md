# Monaco Editor Refactor — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CodeMirror 6 with Monaco Editor across GT Office, achieving VS Code-level editing experience while preserving all existing functionality (syntax highlighting, multi-tab, save, find/replace, Markdown split view).

**Architecture:** Create a `MonacoEditor` component with the same props interface as `CodeMirrorEditor`, enabling a drop-in replacement in `FileEditorPane` and `MarkdownSplitView`. Monaco's multi-model system replaces manual viewState management. Language detection maps existing `LanguageId` values to Monaco language IDs. Monaco's built-in search UI replaces the custom CodeMirror search panel.

**Tech Stack:** `monaco-editor` (^0.52+), `@monaco-editor/react` (^4.7+), Vite web workers, SCSS design tokens

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/desktop-web/src/shell/integration/monaco-env.ts` | CREATE | MonacoEnvironment + web workers setup, loaded before app |
| `apps/desktop-web/src/components/editor/monaco-languages.ts` | CREATE | LanguageId type + detectLanguageFromPath + toMonacoLanguageId mapping |
| `apps/desktop-web/src/components/editor/MonacoEditor.tsx` | CREATE | Core Monaco editor React component (drop-in replacement for CodeMirrorEditor) |
| `apps/desktop-web/src/components/editor/MonacoEditor.scss` | CREATE | Monaco theme CSS using --vb-* design tokens |
| `apps/desktop-web/src/components/editor/CodeMirrorEditor.tsx` | DELETE | Old editor — replaced by MonacoEditor |
| `apps/desktop-web/src/components/editor/CodeMirrorEditor.scss` | DELETE | Old CodeMirror styles |
| `apps/desktop-web/src/components/editor/lucide-icon-nodes.ts` | DELETE | Monaco has built-in search UI, no custom icons needed |
| `apps/desktop-web/src/components/editor/languages/language-extensions.ts` | DELETE | Replaced by monaco-languages.ts |
| `apps/desktop-web/src/components/editor/languages/index.ts` | DELETE | Old barrel export |
| `apps/desktop-web/src/components/editor/index.ts` | MODIFY | Export MonacoEditor instead of CodeMirrorEditor, remove MarkdownSplitView internal re-export of CodeMirror |
| `apps/desktop-web/src/components/editor/MarkdownSplitView.tsx` | MODIFY | Replace CodeMirrorEditor with MonacoEditor |
| `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx` | MODIFY | Switch import from CodeMirrorEditor to MonacoEditor |
| `apps/desktop-web/src/shell/layout/ShellRoot.shared.ts` | MODIFY | Update `isCodeEditorKeyboardTarget` to use `.monaco-editor` selector |
| `apps/desktop-web/src/main.tsx` | MODIFY | Import monaco-env.ts before App renders |
| `apps/desktop-web/package.json` | MODIFY | Remove @codemirror/* packages, add monaco-editor + @monaco-editor/react |
| `docs/DEPENDENCIES.md` | MODIFY | Move codemirror to removed, add monaco-editor to P1 |

---

### Task 1: Install Monaco dependencies and remove CodeMirror packages

**Files:**
- Modify: `apps/desktop-web/package.json`
- Modify: `docs/DEPENDENCIES.md`

- [ ] **Step 1: Remove CodeMirror packages and add Monaco packages**

```bash
cd /Users/dzlin/work/GT-Office/apps/desktop-web
pnpm remove codemirror @codemirror/lang-cpp @codemirror/lang-css @codemirror/lang-go @codemirror/lang-html @codemirror/lang-java @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-php @codemirror/lang-python @codemirror/lang-rust @codemirror/lang-sql @codemirror/lang-vue @codemirror/lang-xml @codemirror/lang-yaml @codemirror/legacy-modes @replit/codemirror-lang-csharp @replit/codemirror-lang-svelte
pnpm add monaco-editor @monaco-editor/react
```

- [ ] **Step 2: Update DEPENDENCIES.md**

In `docs/DEPENDENCIES.md`, change the P1 code editor row from:

```
| Code editor | `codemirror` + language packages | In-app code editing |
```

to:

```
| Code editor | `monaco-editor` + `@monaco-editor/react` | In-app code editing (VS Code editor core) |
```

And add a changelog entry:

```
| 2026-04-15 | Replaced | codemirror + language packages | Replaced by monaco-editor for VS Code parity |
| 2026-04-15 | Added | monaco-editor, @monaco-editor/react | VS Code editor core for in-app editing |
```

- [ ] **Step 3: Commit dependency changes**

```bash
cd /Users/dzlin/work/GT-Office
git add apps/desktop-web/package.json apps/desktop-web/pnpm-lock.yaml docs/DEPENDENCIES.md
git commit -m "feat(editor): replace codemirror with monaco-editor dependencies"
```

---

### Task 2: Create monaco-env.ts — MonacoEnvironment and web workers setup

**Files:**
- Create: `apps/desktop-web/src/shell/integration/monaco-env.ts`

- [ ] **Step 1: Create monaco-env.ts**

Create `apps/desktop-web/src/shell/integration/monaco-env.ts`:

```typescript
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  },
}

loader.config({ monaco })
```

- [ ] **Step 2: Add early import in main.tsx**

In `apps/desktop-web/src/main.tsx`, add this import as the first import (before `App.tsx`):

```typescript
import './shell/integration/monaco-env'
```

The file should look like:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shell/integration/monaco-env'
import './styles/index.scss'
import App from './App.tsx'
import { applyUiPreferences, loadUiPreferences } from './shell/state/ui-preferences.ts'

applyUiPreferences(loadUiPreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop-web/src/shell/integration/monaco-env.ts apps/desktop-web/src/main.tsx
git commit -m "feat(editor): add Monaco environment and web workers setup"
```

---

### Task 3: Create monaco-languages.ts — Language ID mapping

**Files:**
- Create: `apps/desktop-web/src/components/editor/monaco-languages.ts`

- [ ] **Step 1: Create monaco-languages.ts**

Create `apps/desktop-web/src/components/editor/monaco-languages.ts`:

```typescript
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
  ruby: 'plaintext',
  lua: 'plaintext',
  shell: 'plaintext',

  // Systems languages
  rust: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'plaintext',
  swift: 'plaintext',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',

  // Data formats
  json: 'json',
  yaml: 'yaml',
  toml: 'plaintext',
  xml: 'xml',
  sql: 'sql',

  // Markup languages
  markdown: 'markdown',
  html: 'html',
  css: 'css',

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
 * Filename (without extension) to LanguageId mapping.
 */
const BASENAME_TO_LANGUAGE: Record<string, LanguageId> = {
  dockerfile: 'shell',
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/components/editor/monaco-languages.ts
git commit -m "feat(editor): add Monaco language detection and ID mapping"
```

---

### Task 4: Create MonacoEditor.tsx — Core editor component

**Files:**
- Create: `apps/desktop-web/src/components/editor/MonacoEditor.tsx`

This is the largest task. The component must:
1. Accept the same props interface as CodeMirrorEditor (locale, content, filePath, readOnly, onChange, onSave, commandRequest)
2. Use Monaco's multi-model system via `path` prop for per-file models
3. Dispatch `onChange` on content changes
4. Handle `onSave` via `Cmd/Ctrl+S`
5. Map `commandRequest` to Monaco built-in actions
6. Support `readOnly` mode
7. Support theme switching (light/dark)

- [ ] **Step 1: Create MonacoEditor.tsx**

Create `apps/desktop-web/src/components/editor/MonacoEditor.tsx`:

```typescript
import { useCallback, useEffect, useRef } from 'react'
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { detectLanguageFromPath, toMonacoLanguageId } from './monaco-languages'
import { t, type Locale } from '@shell/i18n/ui-locale'
import './MonacoEditor.scss'

export interface MonacoEditorProps {
  locale: Locale
  content: string
  filePath: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
  commandRequest?: MonacoEditorCommandRequest | null
}

export type CodeEditorCommandType = 'find' | 'replace' | 'findNext' | 'findPrevious' | 'gotoLine'

export interface MonacoEditorCommandRequest {
  type: CodeEditorCommandType
  nonce: number
  line?: number
  targetPath?: string | null
}

function getThemeName(): string {
  if (typeof document === 'undefined') return 'gt-office-light'
  const theme = document.documentElement.getAttribute('data-theme')
  return theme === 'graphite-dark' ? 'gt-office-dark' : 'gt-office-light'
}

function defineThemes(monaco: Monaco) {
  const baseTokens = [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C586C0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'operator', foreground: 'D4D4D4' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    { token: 'tag', foreground: '569CD6' },
    { token: 'attribute.name', foreground: '9CDCFE' },
    { token: 'attribute.value', foreground: 'CE9178' },
  ]

  monaco.editor.defineTheme('gt-office-light', {
    base: 'vs',
    inherit: true,
    rules: baseTokens.map((t) => ({
      ...t,
      foreground: t.foreground,
    })),
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1F2937',
      'editor.lineHighlightBackground': '#F3F4F6',
      'editorLineNumber.foreground': '#9CA3AF',
      'editorLineNumber.activeForeground': '#3B82F6',
      'editor.selectionBackground': '#ADD6FF',
      'editorCursor.foreground': '#3B82F6',
      'editor.inactiveSelectionBackground': '#E5E7EB',
      'editorGutter.background': '#FAFAFA',
    },
  })

  monaco.editor.defineTheme('gt-office-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: baseTokens,
    colors: {
      'editor.background': '#1E1E1E',
      'editor.foreground': '#D4D4D4',
      'editor.lineHighlightBackground': '#2A2D2E',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#C6C6C6',
      'editor.selectionBackground': '#264F78',
      'editorCursor.foreground': '#AEAFAD',
      'editor.inactiveSelectionBackground': '#3A3D41',
      'editorGutter.background': '#1E1E1E',
    },
  })
}

let themesDefined = false

export function MonacoEditor({
  locale,
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
  commandRequest = null,
}: MonacoEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const commandNonceRef = useRef(0)
  const contentRef = useRef(content)
  const filePathRef = useRef(filePath)
  const isExternalUpdateRef = useRef(false)

  // Sync refs
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  // Sync external content changes (file switch, external reload)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || content === contentRef.current) return

    const model = editor.getModel()
    if (!model) return

    isExternalUpdateRef.current = true
    editor.pushUndoStop()
    model.setValue(content)
    contentRef.current = content
    isExternalUpdateRef.current = false
  }, [content])

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    if (!themesDefined) {
      defineThemes(monaco)
      themesDefined = true
    }
    monaco.editor.setTheme(getThemeName())

    // Content change listener
    editor.onDidChangeModelContent(() => {
      if (isExternalUpdateRef.current) return
      const value = editor.getValue()
      if (value !== contentRef.current) {
        contentRef.current = value
        onChangeRef.current?.(value)
      }
    })

    // Save keybinding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })
  }, [])

  // Language detection
  const language = filePath
    ? toMonacoLanguageId(detectLanguageFromPath(filePath))
    : 'plaintext'

  // Handle command requests
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !commandRequest) return
    if (commandRequest.targetPath && commandRequest.targetPath !== filePath) return
    if (commandRequest.nonce <= commandNonceRef.current) return

    commandNonceRef.current = commandRequest.nonce
    editor.focus()

    switch (commandRequest.type) {
      case 'find':
        editor.getAction('actions.find')?.run()
        break
      case 'replace':
        editor.getAction('editor.action.startFindReplaceAction')?.run()
        break
      case 'findNext':
        editor.getAction('editor.action.nextMatchFindAction')?.run()
        break
      case 'findPrevious':
        editor.getAction('editor.action.previousMatchFindAction')?.run()
        break
      case 'gotoLine': {
        editor.getAction('editor.action.gotoLine')?.run()
        if (typeof commandRequest.line === 'number' && Number.isFinite(commandRequest.line)) {
          // After gotoLine panel opens, reveal the target line
          const lineNumber = Math.max(1, Math.trunc(commandRequest.line))
          setTimeout(() => {
            editor.revealLineInCenter(lineNumber)
            editor.setPosition({ lineNumber, column: 1 })
          }, 100)
        }
        break
      }
    }
  }, [commandRequest, filePath])

  // Theme switching
  useEffect(() => {
    if (!monacoRef.current) return
    monacoRef.current.editor.setTheme(getThemeName())

    const observer = new MutationObserver(() => {
      monacoRef.current?.editor.setTheme(getThemeName())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  // Clean up models for closed files
  useEffect(() => {
    return () => {
      if (filePath) {
        const model = monacoRef.current?.editor.getModel(
          monacoRef.current?.Uri.parse(`file:///${filePath}`),
        )
        model?.dispose()
      }
    }
  }, [filePath])

  return (
    <div className="monaco-editor-container">
      <Editor
        height="100%"
        language={language}
        path={filePath ?? 'untitled'}
        defaultValue=""
        value={content}
        theme={getThemeName()}
        onChange={(value) => {
          // onChange is handled via onDidChangeModelContent in onMount
          // This is a fallback for model switches
        }}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: 'var(--vb-font-mono)',
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'off',
          folding: true,
          foldingHighlight: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          padding: { top: 4 },
          scrollbar: {
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
          },
          contextmenu: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
        }}
        loading={<div className="monaco-editor-loading" />}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/components/editor/MonacoEditor.tsx
git commit -m "feat(editor): add MonacoEditor component with VS Code editing experience"
```

---

### Task 5: Create MonacoEditor.scss — Theme styles

**Files:**
- Create: `apps/desktop-web/src/components/editor/MonacoEditor.scss`

- [ ] **Step 1: Create MonacoEditor.scss**

Create `apps/desktop-web/src/components/editor/MonacoEditor.scss`:

```scss
@use '../../styles/tokens/responsive' as *;

.monaco-editor-container {
  height: 100%;
  position: relative;
  overflow: hidden;

  .monaco-editor-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vb-text-muted);
    font-size: #{rem(13)};
  }
}

/* Monaco Editor CSS overrides using GT Office design tokens */
.monaco-editor {
  --vscode-editor-background: var(--vb-surface);
  --vscode-editor-foreground: var(--vb-text);
  --vscode-editor-font-family: var(--vb-font-mono);
  --vscode-editor-font-size: #{rem(13)};
  --vscode-editor-line-height: 1.5;

  /* Override scrollbar to match app style */
  .scroll-decoration {
    display: none;
  }

  /* Minimize the default Monaco chrome */
  .overflow-guard {
    border: none;
  }
}

/* Light theme overrides */
[data-theme='graphite-light'] .monaco-editor,
:not([data-theme]) .monaco-editor {
  background: var(--vb-surface) !important;
}

/* Dark theme overrides */
[data-theme='graphite-dark'] .monaco-editor {
  background: var(--vb-surface) !important;
}

/* Ensure the container fills its parent */
.monaco-editor-container .monaco-editor,
.monaco-editor-container .overflow-guard {
  height: 100% !important;
}

/* Search widget styling — keep minimal overrides, Monaco has good defaults */
.monaco-editor .find-widget {
  font-family: var(--vb-font-mono);
  font-size: #{rem(12)};
}

/* Loading state */
.monaco-editor-container .monaco-editor-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vb-text-muted);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/components/editor/MonacoEditor.scss
git commit -m "feat(editor): add Monaco editor styles using GT Office design tokens"
```

---

### Task 6: Update barrel exports and remove CodeMirror files

**Files:**
- Modify: `apps/desktop-web/src/components/editor/index.ts`
- Delete: `apps/desktop-web/src/components/editor/CodeMirrorEditor.tsx`
- Delete: `apps/desktop-web/src/components/editor/CodeMirrorEditor.scss`
- Delete: `apps/desktop-web/src/components/editor/lucide-icon-nodes.ts`
- Delete: `apps/desktop-web/src/components/editor/languages/language-extensions.ts`
- Delete: `apps/desktop-web/src/components/editor/languages/index.ts`

- [ ] **Step 1: Update index.ts to export MonacoEditor instead of CodeMirrorEditor**

Replace the contents of `apps/desktop-web/src/components/editor/index.ts` with:

```typescript
export { MonacoEditor } from './MonacoEditor'
export type { MonacoEditorProps, MonacoEditorCommandRequest, CodeEditorCommandType } from './MonacoEditor'
export { MarkdownRenderer } from './MarkdownRenderer'
export { MarkdownSplitView } from './MarkdownSplitView'
export type { MarkdownViewMode } from './MarkdownSplitView'
export { detectLanguageFromPath, toMonacoLanguageId } from './monaco-languages'
export type { LanguageId } from './monaco-languages'
```

- [ ] **Step 2: Delete CodeMirror files**

```bash
rm apps/desktop-web/src/components/editor/CodeMirrorEditor.tsx
rm apps/desktop-web/src/components/editor/CodeMirrorEditor.scss
rm apps/desktop-web/src/components/editor/lucide-icon-nodes.ts
rm apps/desktop-web/src/components/editor/languages/language-extensions.ts
rm apps/desktop-web/src/components/editor/languages/index.ts
```

If the `languages/` directory is empty after deletion, remove it:
```bash
rmdir apps/desktop-web/src/components/editor/languages 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add -A apps/desktop-web/src/components/editor/
git commit -m "refactor(editor): switch barrel exports to Monaco, remove CodeMirror files"
```

---

### Task 7: Update MarkdownSplitView to use MonacoEditor

**Files:**
- Modify: `apps/desktop-web/src/components/editor/MarkdownSplitView.tsx`

- [ ] **Step 1: Update MarkdownSplitView.tsx**

Replace the import and usage of `CodeMirrorEditor` with `MonacoEditor`. The sync scroll logic changes because Monaco exposes its scroll container differently than CodeMirror.

Full replacement for `apps/desktop-web/src/components/editor/MarkdownSplitView.tsx`:

```typescript
import { useRef, useCallback, useEffect } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { MonacoEditor } from './MonacoEditor'
import { MarkdownRenderer } from './MarkdownRenderer'
import './MarkdownSplitView.scss'

// Import code highlighting styles for markdown preview
import 'highlight.js/styles/github-dark.css'

export type MarkdownViewMode = 'edit' | 'preview' | 'split'

interface MarkdownSplitViewProps {
  locale: Locale
  content: string
  filePath: string
  workspaceRoot: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

export function MarkdownSplitView({
  locale,
  content,
  filePath,
  workspaceRoot,
  readOnly = false,
  onChange,
  onSave,
}: MarkdownSplitViewProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const syncingPaneRef = useRef<'editor' | 'preview' | null>(null)

  const syncScrollPosition = useCallback(
    (source: HTMLElement, target: HTMLElement, sourcePane: 'editor' | 'preview') => {
      if (syncingPaneRef.current && syncingPaneRef.current !== sourcePane) {
        return
      }
      const sourceScrollable = source.scrollHeight - source.clientHeight
      const targetScrollable = target.scrollHeight - target.clientHeight
      if (sourceScrollable <= 0 || targetScrollable <= 0) {
        return
      }
      syncingPaneRef.current = sourcePane
      const ratio = source.scrollTop / sourceScrollable
      target.scrollTop = ratio * targetScrollable
      window.requestAnimationFrame(() => {
        if (syncingPaneRef.current === sourcePane) {
          syncingPaneRef.current = null
        }
      })
    },
    [],
  )

  useEffect(() => {
    // Monaco uses .monaco-scrollable-element > .scrollable-element as its scroll container
    const editorScroller = editorContainerRef.current?.querySelector<HTMLElement>(
      '.monaco-scrollable-element .scrollable-element',
    ) ?? editorContainerRef.current?.querySelector<HTMLElement>('.monaco-editor .scrollable-element')
    const previewScroller = previewRef.current
    if (!editorScroller || !previewScroller) {
      return
    }

    const handleEditorScroll = () => syncScrollPosition(editorScroller, previewScroller, 'editor')
    const handlePreviewScroll = () => syncScrollPosition(previewScroller, editorScroller, 'preview')

    editorScroller.addEventListener('scroll', handleEditorScroll)
    previewScroller.addEventListener('scroll', handlePreviewScroll)
    return () => {
      editorScroller.removeEventListener('scroll', handleEditorScroll)
      previewScroller.removeEventListener('scroll', handlePreviewScroll)
    }
  }, [syncScrollPosition, content, filePath])

  return (
    <div className="markdown-split-view">
      {/* Editor panel */}
      <div ref={editorContainerRef} className="markdown-split-editor">
        <MonacoEditor
          locale={locale}
          content={content}
          filePath={filePath}
          readOnly={readOnly}
          onChange={onChange}
          onSave={onSave}
        />
      </div>

      {/* Divider */}
      <div className="markdown-split-divider" />

      {/* Preview panel */}
      <div ref={previewRef} className="markdown-split-preview">
        <div className="markdown-preview-content">
          <MarkdownRenderer content={content} filePath={filePath} workspaceRoot={workspaceRoot} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/components/editor/MarkdownSplitView.tsx
git commit -m "refactor(editor): update MarkdownSplitView to use MonacoEditor"
```

---

### Task 8: Update FileEditorPane to use MonacoEditor

**Files:**
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`

- [ ] **Step 1: Update imports in FileEditorPane.tsx**

In `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`, change the import from:

```typescript
import {
  CodeMirrorEditor,
  MarkdownRenderer,
  MarkdownSplitView,
  type CodeEditorCommandRequest,
  type MarkdownViewMode,
} from '@/components/editor'
```

to:

```typescript
import {
  MonacoEditor,
  MarkdownRenderer,
  MarkdownSplitView,
  type MonacoEditorCommandRequest as CodeEditorCommandRequest,
  type MarkdownViewMode,
} from '@/components/editor'
```

Then change the `MemoizedEditor` definition from:

```typescript
const MemoizedEditor = memo(
  CodeMirrorEditor,
  (prev, next) =>
    prev.locale === next.locale &&
    prev.content === next.content &&
    prev.filePath === next.filePath &&
    prev.readOnly === next.readOnly &&
    isSameCommandRequest(prev.commandRequest, next.commandRequest)
)
```

to:

```typescript
const MemoizedEditor = memo(
  MonacoEditor,
  (prev, next) =>
    prev.locale === next.locale &&
    prev.content === next.content &&
    prev.filePath === next.filePath &&
    prev.readOnly === next.readOnly &&
    isSameCommandRequest(prev.commandRequest, next.commandRequest)
)
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx
git commit -m "refactor(editor): switch FileEditorPane to use MonacoEditor"
```

---

### Task 9: Update ShellRoot.shared.ts keyboard target selector

**Files:**
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.shared.ts`

- [ ] **Step 1: Update isCodeEditorKeyboardTarget**

In `apps/desktop-web/src/shell/layout/ShellRoot.shared.ts`, change the `isCodeEditorKeyboardTarget` function (around line 343-345) from:

```typescript
export function isCodeEditorKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.cm-editor, .codemirror-editor-container'))
}
```

to:

```typescript
export function isCodeEditorKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.monaco-editor, .monaco-editor-container'))
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop-web/src/shell/layout/ShellRoot.shared.ts
git commit -m "fix(editor): update keyboard target selector for Monaco editor"
```

---

### Task 10: Typecheck and build verification

**Files:** None — verification only

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/dzlin/work/GT-Office
pnpm --filter desktop-web typecheck
```

Expected: No type errors related to editor components.

If there are type errors, fix them. Common issues:
- Any remaining imports of `CodeMirrorEditor` or `CodeEditorCommandRequest` from old paths
- The `MarkdownSplitView` re-export might need updating
- The `commandRequest` prop type alignment between `MonacoEditorCommandRequest` and `CodeEditorCommandRequest`

- [ ] **Step 2: Run Vite build**

```bash
cd /Users/dzlin/work/GT-Office
pnpm --filter desktop-web build
```

Expected: Successful build with Monaco workers bundled correctly.

- [ ] **Step 3: Run Tauri build check**

```bash
cd /Users/dzlin/work/GT-Office
pnpm build:tauri
```

Expected: Successful Tauri build.

- [ ] **Step 4: Manual smoke test**

Start the dev server:
```bash
cd /Users/dzlin/work/GT-Office/apps/desktop-web
pnpm dev
```

Verify:
1. Open a TypeScript file — syntax highlighting works, Cmd+S saves
2. Open a JSON file — syntax highlighting + validation works
3. Open a Markdown file — edit mode shows Monaco, preview mode shows react-markdown, split mode shows both
4. Switch between file tabs — content and cursor position preserved
5. Cmd+F opens find, Cmd+H opens find/replace
6. Toggle dark/light theme — Monaco theme follows
7. Open a file >1MB — opens in read-only mode
8. Check that `isCodeEditorKeyboardTarget` works (keyboard shortcuts trigger in editor)

- [ ] **Step 5: Commit any verification fixes**

```bash
git add -A
git commit -m "fix(editor): address typecheck and build issues from Monaco migration"
```

---

### Task 11: Clean up unused CodeMirror dependencies from imports

**Files:**
- Search all files in `apps/desktop-web/src/` for remaining `@codemirror` or `codemirror` imports

- [ ] **Step 1: Search for remaining CodeMirror references**

```bash
cd /Users/dzlin/work/GT-Office
grep -rn "codemirror\|@codemirror\|CodeMirror" apps/desktop-web/src/ --include="*.ts" --include="*.tsx" --include="*.scss"
```

Expected: No results (all references should be gone). If any remain, remove or update them.

- [ ] **Step 2: Verify pnpm lock file is clean**

```bash
cd /Users/dzlin/work/GT-Office
pnpm install
```

Expected: No warnings about missing codemirror packages.

- [ ] **Step 3: Commit cleanup**

```bash
git add -A
git commit -m "chore(editor): clean up remaining CodeMirror references"
```

---

### Task 12: Update WORKFLOWS.md documentation reference

**Files:**
- Modify: `docs/WORKFLOWS.md`

- [ ] **Step 1: Update CodeMirror reference in WORKFLOWS.md**

In `docs/WORKFLOWS.md`, change line 19 from:

```
2. **Open** — Double-click or use quick open to view a file. Text files open in the CodeMirror editor; images, PDFs, and media open in the unified preview tab.
```

to:

```
2. **Open** — Double-click or use quick open to view a file. Text files open in the Monaco editor; images, PDFs, and media open in the unified preview tab.
```

And line 21 from:

```
4. **Edit** — CodeMirror-powered editor with language extensions (JavaScript, Python, Rust, JSON, Markdown, CSS, HTML). Edits are saved explicitly.
```

to:

```
4. **Edit** — Monaco-powered editor with language support (JavaScript, TypeScript, Python, Rust, JSON, Markdown, CSS, HTML) and VS Code editing experience. Edits are saved explicitly.
```

- [ ] **Step 2: Commit**

```bash
git add docs/WORKFLOWS.md
git commit -m "docs: update editor references from CodeMirror to Monaco"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every design doc section maps to a task (MonacoEditor, monaco-languages, MonacoEditor.scss, monaco-env, MarkdownSplitView, FileEditorPane, ShellRoot.shared, main.tsx, DEPENDENCIES.md)
- [x] **Placeholder scan:** No TBD/TODO/placeholders — all code is provided in full
- [x] **Type consistency:** `MonacoEditorCommandRequest` type matches `CodeEditorCommandRequest` in `ShellRoot.shared.ts` (aliased in FileEditorPane import). `LanguageId` type preserved identically. `detectLanguageFromPath` signature preserved. `MarkdownViewMode` type exported from MarkdownSplitView as before.
- [x] **No spec gaps:** commandRequest mapping, theme switching, content sync, save keybinding, readOnly, language detection, Markdown split view, keyboard target selector — all covered.