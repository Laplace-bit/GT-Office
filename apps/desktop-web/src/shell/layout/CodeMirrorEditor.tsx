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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { t, type Locale } from '../i18n/ui-locale'
import './CodeMirrorEditor.scss'

export interface CodeMirrorEditorProps {
  locale: Locale
  content: string
  filePath: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
  commandRequest?: CodeEditorCommandRequest | null
}

type LanguageId = 'javascript' | 'typescript' | 'python' | 'rust' | 'json' | 'markdown' | 'css' | 'html' | 'plain'
export type CodeEditorCommandType = 'find' | 'replace' | 'findNext' | 'findPrevious'
export interface CodeEditorCommandRequest {
  type: CodeEditorCommandType
  nonce: number
}

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

function focusSearchField(view: EditorView, fieldName: 'search' | 'replace') {
  if (typeof window === 'undefined') {
    return
  }
  window.requestAnimationFrame(() => {
    const panel = view.dom.querySelector('.cm-panel.cm-search')
    if (!(panel instanceof HTMLElement)) {
      return
    }
    const field = panel.querySelector(`input[name="${fieldName}"]`)
    if (field instanceof HTMLInputElement) {
      field.focus()
      field.select()
    }
  })
}

function openFindPanel(view: EditorView): boolean {
  const opened = openSearchPanel(view)
  focusSearchField(view, 'search')
  return opened
}

function openReplacePanel(view: EditorView): boolean {
  const opened = openSearchPanel(view)
  focusSearchField(view, 'replace')
  return opened
}

function buildSearchPhrases(locale: Locale): Record<string, string> {
  return {
    Find: t(locale, '查找', 'Find'),
    Replace: t(locale, '替换', 'Replace'),
    next: t(locale, '下一项', 'next'),
    previous: t(locale, '上一项', 'previous'),
    select: t(locale, '全部', 'all'),
    'match case': t(locale, '区分大小写', 'match case'),
    regexp: t(locale, '正则', 'regexp'),
    'by word': t(locale, '整词匹配', 'by word'),
    replace: t(locale, '替换', 'replace'),
    'replace all': t(locale, '全部替换', 'replace all'),
    close: t(locale, '关闭', 'close'),
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
  search({ top: true }),
  highlightSelectionMatches(),
  keymap.of([
    { key: 'Mod-f', run: openFindPanel, preventDefault: true },
    { key: 'Mod-h', run: openReplacePanel, preventDefault: true },
    { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
    { key: 'Mod-g', run: gotoLine, preventDefault: true },
    { key: 'Escape', run: closeSearchPanel },
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
  ]),
]

// 使用 SCSS 处理绝大部分样式，这里只保留最小结构配置
const themeExtension = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto' }
})

export function CodeMirrorEditor({
  locale,
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
  commandRequest = null,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(content)
  const filePathRef = useRef(filePath)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const commandNonceRef = useRef(0)
  const languageCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  const phrasesCompartment = useRef(new Compartment())

  // 同步 refs
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  // 初始化编辑器 - 只执行一次
  useEffect(() => {
    const container = containerRef.current
    if (!container || viewRef.current) return

    const langId = detectLanguage(filePathRef.current)
    const langExt = getLanguageExtension(langId)

    const extensions: Extension[] = [
      minimalSetup,
      themeExtension,
      languageCompartment.current.of(langExt ?? []),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      phrasesCompartment.current.of(EditorState.phrases.of(buildSearchPhrases(locale))),
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

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: phrasesCompartment.current.reconfigure(EditorState.phrases.of(buildSearchPhrases(locale))),
    })
  }, [locale])

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

  useEffect(() => {
    const view = viewRef.current
    if (!view || !commandRequest) {
      return
    }
    if (commandRequest.nonce <= commandNonceRef.current) {
      return
    }
    commandNonceRef.current = commandRequest.nonce
    view.focus()
    switch (commandRequest.type) {
      case 'find': {
        openFindPanel(view)
        break
      }
      case 'replace': {
        openReplacePanel(view)
        break
      }
      case 'findNext': {
        if (!findNext(view)) {
          openFindPanel(view)
        }
        break
      }
      case 'findPrevious': {
        if (!findPrevious(view)) {
          openFindPanel(view)
        }
        break
      }
      default:
        break
    }
  }, [commandRequest])

  // 自动为搜索面板的图标按钮添加 Tooltip (title)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const applySearchPanelTitles = () => {
      const searchPanel = container.querySelector('.cm-panel.cm-search')
      if (searchPanel) {
        const phrases = buildSearchPhrases(locale)
        // 映射按钮 name 到 phrase key
        const nameMap: Record<string, string> = {
          next: 'next',
          prev: 'previous',
          all: 'all',
          select: 'all', // CodeMirror uses "select" for Select All
          replace: 'replace',
          replaceAll: 'replace all',
          close: 'close',
        }

        searchPanel.querySelectorAll('button').forEach((btn) => {
          const name = btn.getAttribute('name')
          const ariaLabel = btn.getAttribute('aria-label')
          const targetName = name || ariaLabel

          if (targetName && nameMap[targetName]) {
            btn.setAttribute('title', phrases[nameMap[targetName]])
          }
        })

        searchPanel.querySelectorAll('label').forEach((label) => {
          const text = label.innerText.trim()
          if (text) label.setAttribute('title', text)
        })
      }
    }

    applySearchPanelTitles()

    const observer = new MutationObserver(() => {
      applySearchPanelTitles()
    })

    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [locale])

  return (
    <div
      ref={containerRef}
      className="codemirror-editor-container"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  )
}
