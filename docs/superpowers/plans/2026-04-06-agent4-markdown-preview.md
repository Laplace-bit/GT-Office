# Markdown 预览实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Markdown 文档的编辑、预览、分屏三种模式

**Architecture:** 使用 react-markdown 渲染预览，创建 MarkdownSplitView 组件实现分屏，在 FileEditorPane 中添加模式切换 UI。

**Tech Stack:** React, TypeScript, SCSS, react-markdown, remark-gfm, rehype-highlight

---

## 文件结构

```
apps/desktop-web/src/
├── components/editor/
│   ├── MarkdownSplitView.tsx     # 分屏组件（新建）
│   └── MarkdownSplitView.scss    # 分屏样式（新建）
├── features/file-explorer/
│   ├── FileEditorPane.tsx        # 编辑器面板（修改）
│   └── FileEditorPane.scss       # 编辑器样式（修改）
└── shell/i18n/
    └── ui-locale.ts               # 国际化（修改）
```

---

## Task 1: 添加 Markdown 渲染依赖

**Files:**
- Modify: `apps/desktop-web/package.json`

- [ ] **Step 1: 添加依赖**

Run:
```bash
cd apps/desktop-web && pnpm add react-markdown remark-gfm rehype-highlight
```

- [ ] **Step 2: 验证安装**

Run: `cd apps/desktop-web && pnpm ls react-markdown`
Expected: 显示 `react-markdown 9.x.x`

- [ ] **Step 3: 提交依赖变更**

```bash
git add apps/desktop-web/package.json apps/desktop-web/pnpm-lock.yaml
git commit -m "feat(editor): add markdown rendering dependencies

- react-markdown for Markdown rendering
- remark-gfm for GitHub Flavored Markdown
- rehype-highlight for code block syntax highlighting

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 添加国际化文本

**Files:**
- Modify: `apps/desktop-web/src/shell/i18n/ui-locale.ts`

- [ ] **Step 1: 添加预览相关翻译**

在翻译映射中添加：

```typescript
// 在 TRANSLATIONS 对象中添加
'preview.mode.edit': { zh: '编辑', en: 'Edit' },
'preview.mode.preview': { zh: '预览', en: 'Preview' },
'preview.mode.split': { zh: '分屏', en: 'Split' },
'preview.loading': { zh: '加载中...', en: 'Loading...' },
'preview.error.loadFailed': { zh: '加载失败', en: 'Load failed' },
'preview.error.unsupported': { zh: '不支持的文件类型', en: 'Unsupported file type' },
'preview.error.tooLarge': { zh: '文件过大，建议使用外部程序打开', en: 'File too large, please open externally' },
'preview.openExternal': { zh: '外部打开', en: 'Open Externally' },
'image.zoomIn': { zh: '放大', en: 'Zoom in' },
'image.zoomOut': { zh: '缩小', en: 'Zoom out' },
'image.fitWindow': { zh: '适应窗口', en: 'Fit window' },
'image.originalSize': { zh: '原始大小', en: 'Original size' },
```

- [ ] **Step 2: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

---

## Task 3: 创建 Markdown 分屏组件

**Files:**
- Create: `apps/desktop-web/src/components/editor/MarkdownSplitView.tsx`
- Create: `apps/desktop-web/src/components/editor/MarkdownSplitView.scss`

- [ ] **Step 1: 创建 MarkdownSplitView.tsx**

```typescript
// MarkdownSplitView.tsx
import { useMemo, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Locale } from '@shell/i18n/ui-locale'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import './MarkdownSplitView.scss'

// 导入代码高亮样式
import 'highlight.js/styles/github-dark.css'

export type MarkdownViewMode = 'edit' | 'preview' | 'split'

interface MarkdownSplitViewProps {
  locale: Locale
  content: string
  filePath: string
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

export function MarkdownSplitView({
  locale,
  content,
  filePath,
  readOnly = false,
  onChange,
  onSave,
}: MarkdownSplitViewProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // 同步滚动（可选功能）
  const handleEditorScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!previewRef.current) return

    const target = e.target as HTMLDivElement
    const scrollRatio = target.scrollTop / (target.scrollHeight - target.clientHeight)
    const previewScrollHeight = previewRef.current.scrollHeight - previewRef.current.clientHeight

    previewRef.current.scrollTop = scrollRatio * previewScrollHeight
  }, [])

  // Markdown 渲染配置
  const markdownComponents = useMemo(() => ({
    // 自定义链接渲染，在新窗口打开外部链接
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
      return (
        <a
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      )
    },
    // 图片渲染
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img src={src} alt={alt} loading="lazy" />
    ),
  }), [])

  return (
    <div className="markdown-split-view">
      {/* 编辑器面板 */}
      <div
        ref={editorRef}
        className="markdown-split-editor"
        onScroll={handleEditorScroll}
      >
        <CodeMirrorEditor
          locale={locale}
          content={content}
          filePath={filePath}
          readOnly={readOnly}
          onChange={onChange}
          onSave={onSave}
        />
      </div>

      {/* 分隔线 */}
      <div className="markdown-split-divider" />

      {/* 预览面板 */}
      <div ref={previewRef} className="markdown-split-preview">
        <div className="markdown-preview-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 MarkdownSplitView.scss**

```scss
// MarkdownSplitView.scss
.markdown-split-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.markdown-split-editor {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.markdown-split-divider {
  width: 1px;
  background: var(--border-color);
  flex-shrink: 0;
}

.markdown-split-preview {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--bg-primary);
}

.markdown-preview-content {
  padding: 1rem;
  max-width: 48rem;
  margin: 0 auto;
}

// Markdown 样式
.markdown-preview-content {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--text-primary);

  // 标题
  h1, h2, h3, h4, h5, h6 {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.25;
  }

  h1 { font-size: 1.875rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
  h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
  h3 { font-size: 1.25rem; }
  h4 { font-size: 1rem; }
  h5 { font-size: 0.875rem; }
  h6 { font-size: 0.8125rem; color: var(--text-secondary); }

  // 段落
  p {
    margin: 0 0 1em;
  }

  // 列表
  ul, ol {
    margin: 0 0 1em;
    padding-left: 2em;
  }

  li {
    margin: 0.25em 0;
  }

  // 代码块
  pre {
    margin: 1em 0;
    padding: 1em;
    background: var(--bg-secondary);
    border-radius: 0.375rem;
    overflow-x: auto;
    font-size: 0.875rem;
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  // 行内代码
  p code, li code {
    padding: 0.125em 0.375em;
    background: var(--bg-secondary);
    border-radius: 0.25rem;
    font-size: 0.875em;
  }

  // 引用
  blockquote {
    margin: 1em 0;
    padding: 0.5em 1em;
    border-left: 0.25rem solid var(--accent-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }

  // 表格
  table {
    width: 100%;
    margin: 1em 0;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.5em 0.75em;
    border: 1px solid var(--border-color);
  }

  th {
    background: var(--bg-secondary);
    font-weight: 600;
  }

  // 水平线
  hr {
    margin: 1.5em 0;
    border: none;
    border-top: 1px solid var(--border-color);
  }

  // 图片
  img {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
  }

  // 链接
  a {
    color: var(--accent-color);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  // 任务列表
  input[type='checkbox'] {
    margin-right: 0.5em;
  }
}
```

- [ ] **Step 3: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 4: 提交分屏组件**

```bash
git add apps/desktop-web/src/components/editor/MarkdownSplitView.tsx
git add apps/desktop-web/src/components/editor/MarkdownSplitView.scss
git commit -m "feat(editor): create MarkdownSplitView component for split editing

- Add split view with editor and preview panels
- Implement synchronized scrolling (optional)
- Use react-markdown with GFM and syntax highlighting
- Add comprehensive Markdown styling

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 更新 CodeMirrorEditor 导出

**Files:**
- Modify: `apps/desktop-web/src/components/editor/index.ts`

- [ ] **Step 1: 添加 MarkdownSplitView 导出**

```typescript
// index.ts
export * from './CodeMirrorEditor'
export * from './MarkdownSplitView'
export * from './languages'
```

---

## Task 5: 创建模式切换组件

**Files:**
- Create: `apps/desktop-web/src/features/file-explorer/MarkdownModeToggle.tsx`

- [ ] **Step 1: 创建 MarkdownModeToggle.tsx**

```typescript
// MarkdownModeToggle.tsx
import { memo } from 'react'
import { Edit, Eye, Columns } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { MarkdownViewMode } from '@/components/editor'
import './MarkdownModeToggle.scss'

interface MarkdownModeToggleProps {
  locale: Locale
  mode: MarkdownViewMode
  onChange: (mode: MarkdownViewMode) => void
}

const MODE_CONFIG: { mode: MarkdownViewMode; icon: typeof Edit; labelKey: string }[] = [
  { mode: 'edit', icon: Edit, labelKey: 'preview.mode.edit' },
  { mode: 'preview', icon: Eye, labelKey: 'preview.mode.preview' },
  { mode: 'split', icon: Columns, labelKey: 'preview.mode.split' },
]

export const MarkdownModeToggle = memo(function MarkdownModeToggle({
  locale,
  mode,
  onChange,
}: MarkdownModeToggleProps) {
  return (
    <div className="markdown-mode-toggle" role="tablist">
      {MODE_CONFIG.map(({ mode: m, icon: Icon, labelKey }) => (
        <button
          key={m}
          type="button"
          className={`markdown-mode-btn ${mode === m ? 'active' : ''}`}
          onClick={() => onChange(m)}
          role="tab"
          aria-selected={mode === m}
          title={t(locale, labelKey)}
        >
          <Icon className="markdown-mode-icon" aria-hidden="true" />
          <span className="markdown-mode-label">{t(locale, labelKey)}</span>
        </button>
      ))}
    </div>
  )
})
```

- [ ] **Step 2: 创建 MarkdownModeToggle.scss**

```scss
// MarkdownModeToggle.scss
.markdown-mode-toggle {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--bg-secondary);
  border-radius: 0.375rem;
}

.markdown-mode-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
}

.markdown-mode-icon {
  width: 0.875rem;
  height: 0.875rem;
}

.markdown-mode-label {
  font-weight: 500;
}
```

---

## Task 6: 集成到 FileEditorPane

**Files:**
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.tsx`
- Modify: `apps/desktop-web/src/features/file-explorer/FileEditorPane.scss`

- [ ] **Step 1: 更新 FileEditorPane.tsx 导入**

在文件顶部添加导入：

```typescript
import { useState, useMemo } from 'react'
import {
  CodeMirrorEditor,
  MarkdownSplitView,
  type MarkdownViewMode,
} from '@/components/editor'
import { MarkdownModeToggle } from './MarkdownModeToggle'
import { categorizeFile } from '@/features/file-preview'
```

- [ ] **Step 2: 添加模式状态**

在组件内部添加：

```typescript
// 在 FileEditorPane 函数组件内
const fileType = useMemo(() => categorizeFile(activeFilePath), [activeFilePath])
const isMarkdown = fileType.category === 'markdown'
const [viewMode, setViewMode] = useState<MarkdownViewMode>('edit')
```

- [ ] **Step 3: 添加模式切换 UI**

在标签栏下方添加：

```typescript
// 在 file-editor-tabs-wrapper 之后
{isMarkdown && activeFile && (
  <div className="file-editor-toolbar">
    <MarkdownModeToggle
      locale={locale}
      mode={viewMode}
      onChange={setViewMode}
    />
  </div>
)}
```

- [ ] **Step 4: 更新编辑器渲染逻辑**

替换现有的 MemoizedEditor 渲染：

```typescript
{activeFile && !loading && !errorMessage && canRenderContent && (
  <div className="file-editor-content">
    {isMarkdown && viewMode === 'preview' ? (
      // 纯预览模式
      <div className="markdown-preview-pane">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {activeFile.content}
        </ReactMarkdown>
      </div>
    ) : isMarkdown && viewMode === 'split' ? (
      // 分屏模式
      <MarkdownSplitView
        locale={locale}
        content={activeFile.content}
        filePath={activeFile.path}
        readOnly={isReadOnly}
        onChange={handleContentChange}
        onSave={handleSave}
      />
    ) : (
      // 编辑模式（包括非 Markdown 文件）
      <MemoizedEditor
        locale={locale}
        content={activeFile.content}
        filePath={activeFile.path}
        readOnly={isReadOnly}
        onChange={handleContentChange}
        onSave={handleSave}
        commandRequest={editorCommandRequest}
      />
    )}
  </div>
)}
```

- [ ] **Step 5: 添加必要的导入**

确保添加 react-markdown 导入：

```typescript
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
```

- [ ] **Step 6: 更新 FileEditorPane.scss**

添加工具栏样式：

```scss
// 在 FileEditorPane.scss 中添加
.file-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.markdown-preview-pane {
  padding: 1rem;
  overflow: auto;
  height: 100%;
  max-width: 48rem;
  margin: 0 auto;

  // 复用 MarkdownSplitView 的样式
  @import '@/components/editor/MarkdownSplitView.scss';
  
  .markdown-preview-content {
    // 样式继承
  }
}
```

- [ ] **Step 7: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 8: 提交集成变更**

```bash
git add apps/desktop-web/src/features/file-explorer/
git add apps/desktop-web/src/components/editor/index.ts
git commit -m "feat(editor): integrate Markdown preview modes into FileEditorPane

- Add MarkdownModeToggle component for mode switching
- Support edit, preview, and split modes for Markdown files
- Use react-markdown for preview rendering
- Add toolbar for Markdown mode toggle

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 验证和测试

**Files:**
- 无新文件

- [ ] **Step 1: 运行类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 2: 运行构建**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: 创建测试 Markdown 文件**

手动测试：
1. 打开一个 `.md` 文件
2. 验证编辑模式正常
3. 切换到预览模式，验证渲染正确
4. 切换到分屏模式，验证左右同步显示
5. 编辑内容，验证预览实时更新

---

## 验收标准

- [ ] Markdown 文件显示模式切换按钮
- [ ] 编辑模式正常工作（CodeMirror）
- [ ] 预览模式正确渲染 Markdown
- [ ] 分屏模式显示编辑器和预览
- [ ] GFM 语法支持（表格、任务列表、删除线）
- [ ] 代码块语法高亮
- [ ] 类型检查通过
- [ ] 构建成功