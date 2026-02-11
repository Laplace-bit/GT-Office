import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension, Compartment } from '@codemirror/state'
import {
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'

export interface CodeMirrorEditorProps {
  content: string
  filePath: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

type LanguageId = 'javascript' | 'typescript' | 'python' | 'rust' | 'json' | 'markdown' | 'css' | 'html' | 'plain'

function detectLanguage(filePath: string | null): LanguageId {
  if (!filePath) return 'plain'
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return 'javascript'
    case 'ts': case 'mts': case 'cts': case 'tsx': return 'typescript'
    case 'py': case 'pyw': case 'pyi': return 'python'
    case 'rs': return 'rust'
    case 'json': case 'jsonc': case 'json5': return 'json'
    case 'md': case 'mdx': case 'markdown': return 'markdown'
    case 'css': case 'scss': case 'sass': case 'less': return 'css'
    case 'html': case 'htm': case 'vue': case 'svelte': return 'html'
    default: return 'plain'
  }
}

function getLanguageExtension(languageId: LanguageId): Extension | null {
  switch (languageId) {
    case 'javascript': return javascript({ jsx: true })
    case 'typescript': return javascript({ jsx: true, typescript: true })
    case 'python': return python()
    case 'rust': return rust()
    case 'json': return json()
    case 'markdown': return markdown()
    case 'css': return css()
    case 'html': return html()
    default: return null
  }
}

// 精简的编辑器配置，移除不必要的功能
const minimalSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
  ]),
]

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--vb-bg-secondary)',
    color: 'var(--vb-text-primary)',
    height: '100%',
  },
  '.cm-content': {
    caretColor: 'var(--vb-accent)',
    fontFamily: 'var(--vb-font-mono)',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--vb-accent)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--vb-accent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vb-bg-tertiary)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--vb-accent-light)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--vb-bg-primary)',
    color: 'var(--vb-text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--vb-border-subtle)',
    position: 'sticky',
    left: 0,
    zIndex: 1,
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--vb-bg-tertiary)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-line': {
    padding: '0 4px',
  },
})

export function CodeMirrorEditor({
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(content)
  const filePathRef = useRef(filePath)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const languageCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())

  // 同步 refs
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  // 初始化编辑器 - 只执行一次
  useEffect(() => {
    const container = containerRef.current
    if (!container || viewRef.current) return

    const langId = detectLanguage(filePathRef.current)
    const langExt = getLanguageExtension(langId)

    const extensions: Extension[] = [
      minimalSetup,
      darkTheme,
      languageCompartment.current.of(langExt ?? []),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      keymap.of([{
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.()
          return true
        },
      }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString()
          if (newContent !== contentRef.current) {
            contentRef.current = newContent
            onChangeRef.current?.(newContent)
          }
        }
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({
        doc: contentRef.current,
        extensions,
      }),
      parent: container,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // 空依赖，只在挂载时执行

  // 文件路径变化时更新语言（不重建编辑器）
  useEffect(() => {
    const view = viewRef.current
    if (!view || filePath === filePathRef.current) return

    filePathRef.current = filePath
    const langId = detectLanguage(filePath)
    const langExt = getLanguageExtension(langId)

    view.dispatch({
      effects: languageCompartment.current.reconfigure(langExt ?? []),
    })
  }, [filePath])

  // readOnly 变化时更新（不重建编辑器）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly])

  // 外部内容变化时同步（仅文件切换时）
  useEffect(() => {
    const view = viewRef.current
    if (!view || content === contentRef.current) return

    contentRef.current = content
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    })
  }, [content])

  return (
    <div
      ref={containerRef}
      className="codemirror-editor-container"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  )
}
