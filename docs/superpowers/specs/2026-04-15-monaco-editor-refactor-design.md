# Monaco Editor Refactor — Phase 1 Design

## Context

GT Office 当前使用 CodeMirror 6 作为代码编辑器，存在稳定性、性能、功能缺失和整体体验不佳的问题。目标是替换为 Monaco Editor（VS Code 的编辑器内核），整体对齐 VS Code 编辑体验。Phase 1 聚焦核心编辑器替换，保留现有功能不退化，diff 视图等增强功能留到后续迭代。

## Approach

**全量 Monaco 替换（@monaco-editor/react）**：所有文本编辑统一走 Monaco，利用 `path` prop 的多 model 机制天然支持多 tab 编辑。Markdown 编辑侧用 Monaco，预览侧保持 react-markdown。

## Key Decisions

1. **Props 接口保持兼容** — `MonacoEditor` 的接口与 `CodeMirrorEditor` 一致，上层 `FileEditorPane` 只需切换导入
2. **多 Model 机制** — 每个文件 path 对应一个 `ITextModel`，tab 切换自动保存/恢复 viewState
3. **语言映射 Phase 1** — Monaco 内置语言直接映射，无内置高亮的语言（shell/ruby/lua/toml/kotlin）先 fallback 为 `plaintext`
4. **Markdown 统一** — 编辑侧 Monaco，预览侧保持 `MarkdownRenderer`
5. **搜索面板** — 使用 Monaco 内置搜索 UI，删除自定义 Lucide 图标 hack
6. **Diff 视图** — Phase 1 不做，后续迭代启用 `DiffEditor`

## File Changes

| Action | File | Description |
|--------|------|-------------|
| NEW | `components/editor/MonacoEditor.tsx` | Core Monaco editor component |
| NEW | `components/editor/MonacoEditor.scss` | Monaco theme styles using `--vb-*` tokens |
| NEW | `components/editor/monaco-languages.ts` | Language ID mapping (LanguageId → Monaco) |
| NEW | `shell/integration/monaco-env.ts` | MonacoEnvironment + web workers config |
| MODIFY | `components/editor/index.ts` | Export MonacoEditor instead of CodeMirrorEditor |
| MODIFY | `features/file-explorer/FileEditorPane.tsx` | Switch import to Monaco |
| MODIFY | `components/editor/MarkdownSplitView.tsx` | CodeMirror → Monaco inside split view |
| DELETE | `components/editor/CodeMirrorEditor.tsx` | Old editor |
| DELETE | `components/editor/CodeMirrorEditor.scss` | Old styles |
| DELETE | `components/editor/lucide-icon-nodes.ts` | Monaco has built-in search UI |
| DELETE | `components/editor/languages/language-extensions.ts` | Replaced by monaco-languages.ts |
| DELETE | `components/editor/languages/index.ts` | Old barrel export |
| MODIFY | `apps/desktop-web/package.json` | Remove @codemirror/*, add @monaco-editor/react + monaco-editor |
| MODIFY | `docs/DEPENDENCIES.md` | Update whitelist |
| MODIFY | App entry (`main.tsx` or equiv) | Import monaco-env.ts early |

## MonacoEditor Component Interface

```typescript
export interface MonacoEditorProps {
  locale: Locale
  content: string
  filePath: string | null
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
  commandRequest?: CodeEditorCommandRequest | null
}
```

- `onMount`: Capture `editor` and `monaco` instances for command dispatch
- `path` prop: Pass `filePath` for multi-model support
- `onChange`: `editor.onDidChangeModelContent` listener
- `onSave`: `editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS)`
- `commandRequest`: Map to Monaco actions (find → actions.find, replace → startFindReplaceAction, etc.)
- `readOnly`: Via `options.readOnly`
- `locale`: Configure Monaco locale at initialization

## Language Mapping

| LanguageId | Monaco Language ID | Has Worker |
|-----------|-------------------|------------|
| javascript | javascript | Yes (IntelliSense) |
| typescript | typescript | Yes (IntelliSense) |
| jsx | javascript | Yes |
| tsx | typescript | Yes |
| python | python | Syntax only |
| rust | rust | Syntax only |
| css/scss/less | css/scss/less | Yes (IntelliSense) |
| html | html | Yes (IntelliSense) |
| json | json | Yes (validation) |
| markdown | markdown | Syntax only |
| yaml | yaml | Syntax only |
| xml | xml | Syntax only |
| sql | sql | Syntax only |
| go | go | Syntax only |
| java | java | Syntax only |
| php | php | Syntax only |
| c/cpp | c/cpp | Syntax only |
| csharp | csharp | Syntax only |
| vue | html | Fallback |
| svelte | html | Fallback |
| shell/ruby/lua/toml/kotlin/swift | plaintext | Fallback (Phase 1) |

## Monaco Theme

Custom theme using `monaco.editor.defineTheme()` with `--vb-*` CSS custom properties. Supports light/dark mode via `data-theme` attribute. Minimal CSS overrides for font, spacing, and border-radius to match GT Office design system.

## Markdown Strategy

- **Edit**: Monaco with `markdown` language mode
- **Preview**: Keep `MarkdownRenderer` (react-markdown + remark-gfm + rehype-highlight)
- **Split view**: `MarkdownSplitView` updated — left pane uses `MonacoEditor`, right pane unchanged
- **Sync scrolling**: Use `editor.getVisibleRanges()` to map visible lines to preview DOM positions

## Dependencies

**Remove**: All `@codemirror/*` and `codemirror` packages, `@replit/codemirror-lang-*`
**Add**: `monaco-editor` (^0.52+), `@monaco-editor/react` (^4.7+)
**Bundle size**: ~2-4MB vs current ~1.5MB — acceptable for Tauri desktop app

## Verification

1. `pnpm typecheck` passes
2. `pnpm build:tauri` succeeds
3. Manual test: open various file types (TS, JSON, CSS, MD, Rust, Python) — syntax highlighting works
4. Manual test: multi-tab editing — model/viewState preserved per tab
5. Manual test: Cmd+S save, Cmd+F find, Cmd+H replace, Cmd+G goto line
6. Manual test: Markdown split view — edit in Monaco, preview in react-markdown
7. Manual test: dark/light theme toggle — Monaco theme follows
8. Manual test: file watcher auto-refresh for unmodified files
9. Manual test: large file (>1MB) opens in read-only mode