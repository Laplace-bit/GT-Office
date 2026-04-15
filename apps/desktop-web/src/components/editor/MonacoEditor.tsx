import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditorAPI } from 'monaco-editor'
import { detectLanguageFromPath, toMonacoLanguageId } from './monaco-languages'
import type { Locale } from '@shell/i18n/ui-locale'
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

function resolveThemeName(): string {
  if (typeof document === 'undefined') return 'gt-office-light'
  const theme = document.documentElement.getAttribute('data-theme')
  return theme === 'graphite-dark' ? 'gt-office-dark' : 'gt-office-light'
}

function configureTypeScriptDefaults(monaco: Monaco) {
  // Disable semantic validation — Monaco cannot resolve project node_modules/tsconfig,
  // so import statements would produce false "Cannot find module" errors.
  // Syntax validation remains enabled to catch real syntax errors.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
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
  locale: _locale,
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
  commandRequest = null,
}: MonacoEditorProps) {
  const editorRef = useRef<MonacoEditorAPI.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const commandNonceRef = useRef(0)
  const contentRef = useRef(content)
  const isExternalUpdateRef = useRef(false)
  const [themeName, setThemeName] = useState(resolveThemeName)

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

    // Skip setValue if model already has the same content — preserves undo history
    if (model.getValue() === content) {
      contentRef.current = content
      return
    }

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
      configureTypeScriptDefaults(monaco)
      themesDefined = true
    }
    monaco.editor.setTheme(resolveThemeName())

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

  // Theme switching — keep React state and Monaco in sync with data-theme
  useEffect(() => {
    const applyTheme = () => {
      const next = resolveThemeName()
      setThemeName(next)
      monacoRef.current?.editor.setTheme(next)
    }

    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="monaco-editor-container">
      <Editor
        height="100%"
        language={language}
        path={filePath ?? 'untitled'}
        defaultValue=""
        value={content}
        theme={themeName}
        onChange={(_value) => {
          // onChange is handled via onDidChangeModelContent in onMount
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