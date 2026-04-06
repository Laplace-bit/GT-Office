# 文件编辑器与预览模块增强设计

## 概述

增强现有文件管理模块，实现：
1. 扩展代码编辑器对多种编程语言的支持
2. Markdown 文档预览（编辑/预览/分屏三种模式）
3. 多媒体文件预览（图片、视频、音频、PDF）
4. 高性能实现，计算与 IO 由后端处理

## 1. 模块架构

### 1.1 目录结构

```
apps/desktop-web/src/
├── features/
│   ├── file-explorer/              # 现有模块
│   │   ├── FileEditorPane.tsx      # 编辑器面板（增强语言支持）
│   │   ├── FileContentPane.tsx     # 保留为简单文本预览
│   │   └── ...
│   └── file-preview/               # 新模块：文件预览
│       ├── index.ts                # 导出入口
│       ├── FilePreviewPane.tsx     # 预览主组件（类型路由）
│       ├── FilePreviewPane.scss    # 预览样式
│       ├── previewers/             # 各类型预览器
│       │   ├── index.ts
│       │   ├── ImagePreviewer.tsx  # 图片预览
│       │   ├── VideoPreviewer.tsx  # 视频预览
│       │   ├── AudioPreviewer.tsx  # 音频预览
│       │   ├── PdfPreviewer.tsx    # PDF 预览
│       │   └── MarkdownPreviewer.tsx # Markdown 预览
│       ├── components/             # 共享组件
│       │   ├── PreviewProgress.tsx # 加载进度
│       │   └── PreviewError.tsx    # 错误展示
│       └── utils/
│           └── file-type-utils.ts  # 文件类型判断
├── components/
│   └── editor/
│       ├── CodeMirrorEditor.tsx    # 增强：更多语言支持
│       ├── CodeMirrorEditor.scss
│       ├── languages/              # 语言配置
│       │   ├── index.ts
│       │   └── language-extensions.ts
│       └── MarkdownSplitView.tsx  # Markdown 分屏组件
│
apps/desktop-tauri/src-tauri/src/commands/
├── file_explorer/
│   ├── mod.rs                      # 现有命令 + 新增预览命令
│   └── preview.rs                  # 预览相关后端处理（新增）
```

### 1.2 职责划分

| 模块 | 职责 |
|------|------|
| `FileEditorPane` | 纯文本编辑、代码高亮、Markdown 编辑模式 |
| `FilePreviewPane` | 多媒体文件预览路由与渲染 |
| `MarkdownSplitView` | Markdown 分屏编辑模式 |
| Tauri `preview.rs` | 文件元数据、分块读取、PDF 解析、图片缩略图生成 |

---

## 2. 文件类型系统

### 2.1 类型分类

```typescript
// file-type-utils.ts
export type FileCategory =
  | 'code'      // 代码文件 -> CodeMirror 编辑
  | 'markdown'  // Markdown -> 编辑器 + 可选预览
  | 'image'     // 图片 -> 预览器
  | 'video'     // 视频 -> 预览器
  | 'audio'     // 音频 -> 预览器
  | 'pdf'       // PDF -> 预览器
  | 'binary'    // 二进制 -> 外部打开或提示
  | 'unknown'   // 未知 -> 尝试文本编辑

export interface FileTypeResult {
  category: FileCategory
  language?: string      // CodeMirror language ID
  mimeType?: string
  requiresBackend?: boolean // 是否需要后端预处理
}
```

### 2.2 类型映射

```typescript
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  // 代码文件
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code',
  mjs: 'code', cjs: 'code', mts: 'code', cts: 'code',
  py: 'code', pyw: 'code', pyi: 'code',
  rs: 'code', go: 'code', java: 'code', kt: 'code', kts: 'code',
  swift: 'code', c: 'code', h: 'code', cc: 'code', cpp: 'code', hpp: 'code',
  cs: 'code', php: 'code', rb: 'code', lua: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code',
  sql: 'code',
  vue: 'code', svelte: 'code',

  // 数据格式（代码编辑）
  json: 'code', jsonc: 'code', json5: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  xml: 'code', ini: 'code', conf: 'code', cfg: 'code',

  // 样式
  css: 'code', scss: 'code', sass: 'code', less: 'code',
  html: 'code', htm: 'code',

  // Markdown
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',

  // 图片
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
  gif: 'image', svg: 'image', ico: 'image', bmp: 'image',
  heic: 'image', avif: 'image',

  // 视频
  mp4: 'video', mov: 'video', webm: 'video',
  mkv: 'video', avi: 'video', m4v: 'video',

  // 音频
  mp3: 'audio', wav: 'audio', flac: 'audio',
  aac: 'audio', m4a: 'audio', ogg: 'audio',

  // PDF
  pdf: 'pdf',
}
```

---

## 3. 代码编辑器语言扩展

### 3.1 新增语言支持

使用 CodeMirror 官方语言包：

| 语言 | 包名 | 扩展名 |
|------|------|--------|
| Shell/Bash | `@codemirror/lang-shell` | .sh, .bash, .zsh |
| YAML | `@codemirror/lang-yaml` | .yaml, .yml |
| TOML | `@codemirror/lang-toml` | .toml |
| SQL | `@codemirror/lang-sql` | .sql |
| XML | `@codemirror/lang-xml` | .xml |
| Java | `@codemirror/lang-java` | .java |
| C/C++ | `@codemirror/lang-cpp` | .c, .h, .cpp, .hpp |
| C# | `@codemirror/lang-csharp` | .cs |
| Go | `@codemirror/lang-go` | .go |
| PHP | `@codemirror/lang-php` | .php |
| Kotlin | `@codemirror/lang-kotlin` | .kt, .kts |
| Swift | `@codemirror/lang-swift` | .swift |
| Ruby | `@codemirror/lang-ruby` | .rb |
| Lua | `@codemirror/lang-lua` | .lua |
| Vue | `@codemirror/lang-vue` | .vue |
| Svelte | `@codemirror/lang-svelte` | .svelte |

### 3.2 语言加载策略

```typescript
// language-extensions.ts
import { Compartment, type Extension } from '@codemirror/state'

// 已安装的语言包
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
// 新增官方语言包
import { shell } from '@codemirror/lang-shell'
import { yaml } from '@codemirror/lang-yaml'
import { toml } from '@codemirror/lang-toml'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { csharp } from '@codemirror/lang-csharp'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { kotlin } from '@codemirror/lang-kotlin'
import { swift } from '@codemirror/lang-swift'
import { ruby } from '@codemirror/lang-ruby'
import { lua } from '@codemirror/lang-lua'
import { vue } from '@codemirror/lang-vue'
import { svelte } from '@codemirror/lang-svelte'

export type LanguageId =
  | 'javascript' | 'typescript' | 'jsx' | 'tsx'
  | 'python' | 'rust' | 'json' | 'markdown' | 'css' | 'html'
  | 'shell' | 'yaml' | 'toml' | 'sql' | 'xml'
  | 'java' | 'cpp' | 'csharp' | 'go' | 'php'
  | 'kotlin' | 'swift' | 'ruby' | 'lua'
  | 'vue' | 'svelte'
  | 'plain'

const LANGUAGE_EXTENSIONS: Record<LanguageId, Extension> = {
  javascript: javascript(),
  typescript: javascript({ typescript: true }),
  jsx: javascript({ jsx: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  python: python(),
  rust: rust(),
  json: json(),
  markdown: markdown(),
  css: css(),
  html: html(),
  shell: shell(),
  yaml: yaml(),
  toml: toml(),
  sql: sql(),
  xml: xml(),
  java: java(),
  cpp: cpp(),
  csharp: csharp(),
  go: go(),
  php: php(),
  kotlin: kotlin(),
  swift: swift(),
  ruby: ruby(),
  lua: lua(),
  vue: vue(),
  svelte: svelte(),
  plain: [],
}

export function getLanguageExtension(langId: LanguageId): Extension {
  return LANGUAGE_EXTENSIONS[langId] ?? []
}
```

### 3.3 语言检测优化

```typescript
// 基于扩展名的快速检测
function detectLanguageFromExtension(ext: string): LanguageId | null {
  const map: Record<string, LanguageId> = {
    // JavaScript
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    // TypeScript
    ts: 'typescript', mts: 'typescript', cts: 'typescript',
    // JSX/TSX
    jsx: 'jsx', tsx: 'tsx',
    // Others
    py: 'python', pyw: 'python', pyi: 'python',
    rs: 'rust',
    json: 'json', jsonc: 'json', json5: 'json',
    md: 'markdown', mdx: 'markdown', markdown: 'markdown',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    html: 'html', htm: 'html',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    xml: 'xml',
    java: 'java',
    c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    php: 'php',
    kt: 'kotlin', kts: 'kotlin',
    swift: 'swift',
    rb: 'ruby',
    lua: 'lua',
    vue: 'vue',
    svelte: 'svelte',
  }
  return map[ext] ?? null
}

// 基于文件名的检测（Dockerfile, Makefile 等）
function detectLanguageFromBasename(basename: string): LanguageId | null {
  const lower = basename.toLowerCase()
  const map: Record<string, LanguageId> = {
    dockerfile: 'shell',
    makefile: 'shell',
    justfile: 'shell',
  }
  return map[lower] ?? null
}
```

---

## 4. Markdown 预览方案

### 4.1 模式切换

```
┌─────────────────────────────────────────────────────┐
│  [编辑模式]  <->  [预览模式]  <->  [分屏模式]        │
│       ^__________________________________|          │
└─────────────────────────────────────────────────────┘
```

**状态管理：**
```typescript
type MarkdownViewMode = 'edit' | 'preview' | 'split'
```

### 4.2 组件结构

```typescript
// MarkdownSplitView.tsx
interface MarkdownSplitViewProps {
  locale: Locale
  content: string
  filePath: string
  readOnly?: boolean
  onChange?: (content: string) => void
  onSave?: () => void
}

// 使用 react-markdown 渲染预览
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
```

### 4.3 依赖

```json
{
  "react-markdown": "^9.0.0",
  "remark-gfm": "^4.0.0",
  "rehype-highlight": "^7.0.0"
}
```

---

## 5. 多媒体预览器

### 5.1 预览主组件

```typescript
// FilePreviewPane.tsx
interface FilePreviewPaneProps {
  locale: Locale
  workspaceId: string | null
  filePath: string | null
  fileSize: number
  onClose?: () => void
}

// 根据文件类型路由到对应预览器
function FilePreviewPane({ locale, workspaceId, filePath, fileSize }: FilePreviewPaneProps) {
  const fileType = categorizeFile(filePath)

  switch (fileType.category) {
    case 'image':
      return <ImagePreviewer filePath={filePath} fileSize={fileSize} />
    case 'video':
      return <VideoPreviewer filePath={filePath} />
    case 'audio':
      return <AudioPreviewer filePath={filePath} />
    case 'pdf':
      return <PdfPreviewer filePath={filePath} fileSize={fileSize} />
    default:
      return <PreviewError locale={locale} type="unsupported" />
  }
}
```

### 5.2 图片预览器

**功能：**
- 原生 `<img>` 标签渲染
- 缩放（放大/缩小/适应窗口）
- 拖拽平移
- 加载进度
- 大图警告（> 10MB）

**实现：**
```typescript
// ImagePreviewer.tsx
interface ImagePreviewerProps {
  filePath: string
  fileSize: number
}

function ImagePreviewer({ filePath, fileSize }: ImagePreviewerProps) {
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 使用 Tauri 资产协议加载本地文件
  const src = convertFileSrc(filePath)

  return (
    <div className="image-previewer">
      {loading && <PreviewProgress />}
      {error && <PreviewError type="load-failed" message={error} />}
      <TransformWrapper scale={scale}>
        <img src={src} onLoad={...} onError={...} />
      </TransformWrapper>
    </div>
  )
}
```

### 5.3 视频预览器

**功能：**
- 原生 `<video>` 标签
- 播放控制（播放/暂停/进度）
- 音量控制
- 全屏模式

```typescript
// VideoPreviewer.tsx
function VideoPreviewer({ filePath }: VideoPreviewerProps) {
  const src = convertFileSrc(filePath)
  return (
    <div className="video-previewer">
      <video controls preload="metadata">
        <source src={src} />
      </video>
    </div>
  )
}
```

### 5.4 音频预览器

**功能：**
- 样式化播放器（非浏览器默认）
- 波形可视化（可选，后续增强）
- 播放控制

```typescript
// AudioPreviewer.tsx
function AudioPreviewer({ filePath }: AudioPreviewerProps) {
  const src = convertFileSrc(filePath)
  return (
    <div className="audio-previewer">
      <audio controls preload="metadata">
        <source src={src} />
      </audio>
    </div>
  )
}
```

### 5.5 PDF 预览器

**方案：后端渲染 + 前端显示**

由于 PDF 渲染计算密集，使用 Rust 后端处理：

**Tauri Commands:**
```rust
// preview.rs
#[derive(Serialize)]
pub struct PdfInfoResponse {
    pub page_count: u32,
    pub page_width: f32,
    pub page_height: f32,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Serialize)]
pub struct PdfPageRequest {
    pub path: String,
    pub page: u32,
    pub scale: f32, // 1.0 = 100%
}

#[derive(Serialize)]
pub struct PdfPageResponse {
    pub image_data: String, // Base64 PNG
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn fs_pdf_get_info(path: String) -> Result<PdfInfoResponse, String> {
    // 使用 pdfium-render 解析 PDF 元信息
    // pdfium 是 Chrome 的 PDF 渲染引擎，渲染质量高
}

#[tauri::command]
pub async fn fs_pdf_render_page(
    path: String,
    page: u32,
    scale: f32,
) -> Result<PdfPageResponse, String> {
    // 渲染指定页面为 PNG
}
```

**前端组件：**
```typescript
// PdfPreviewer.tsx
function PdfPreviewer({ filePath, fileSize }: PdfPreviewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [pageData, setPageData] = useState<string | null>(null)

  useEffect(() => {
    // 获取 PDF 信息
    invoke('fs_pdf_get_info', { path: filePath })
      .then(setPdfInfo)
      .catch(...)
  }, [filePath])

  useEffect(() => {
    // 渲染当前页
    invoke('fs_pdf_render_page', {
      path: filePath,
      page: currentPage,
      scale
    }).then(data => setPageData(data.image_data))
  }, [filePath, currentPage, scale])

  return (
    <div className="pdf-previewer">
      {pdfInfo && (
        <PdfControls
          currentPage={currentPage}
          totalPages={pdfInfo.pageCount}
          scale={scale}
          onPageChange={setCurrentPage}
          onScaleChange={setScale}
        />
      )}
      {pageData && (
        <img src={`data:image/png;base64,${pageData}`} />
      )}
    </div>
  )
}
```

---

## 6. 后端性能优化

### 6.1 文件元数据命令

```rust
// file_explorer/mod.rs 新增

#[derive(Serialize)]
pub struct FileInfoResponse {
    pub path: String,
    pub size: u64,
    pub mime_type: String,
    pub is_binary: bool,
    pub is_large: bool, // > 1MB for text, > 10MB for media
    pub category: String, // code, markdown, image, video, audio, pdf, binary
}

#[tauri::command]
pub async fn fs_get_file_info(path: String) -> Result<FileInfoResponse, String> {
    // 1. 获取文件大小
    // 2. 检测 MIME 类型（magic number）
    // 3. 判断是否二进制
    // 4. 返回分类信息
}
```

### 6.2 分块读取命令

```rust
#[derive(Serialize)]
pub struct ChunkedReadRequest {
    pub path: String,
    pub offset: u64,
    pub length: u32,
}

#[derive(Serialize)]
pub struct ChunkedReadResponse {
    pub data: String, // Base64
    pub has_more: bool,
    pub total_size: u64,
}

#[tauri::command]
pub async fn fs_read_file_chunked(
    path: String,
    offset: u64,
    length: u32,
) -> Result<ChunkedReadResponse, String> {
    // 分块读取大文件，支持取消
}
```

### 6.3 缩略图生成

```rust
#[derive(Serialize)]
pub struct ThumbnailResponse {
    pub data: String, // Base64
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
}

#[tauri::command]
pub async fn fs_image_thumbnail(
    path: String,
    max_size: u32, // 最大边长
) -> Result<ThumbnailResponse, String> {
    // 使用 image crate 生成缩略图
    // 大图先生成缩略图，减少前端渲染压力
}
```

### 6.4 依赖（Rust）

```toml
# Cargo.toml
[dependencies]
# 现有依赖...

# 新增预览相关
pdfium-render = "0.8"     # Chrome PDF 引擎，高性能渲染
image = "0.25"            # 图片处理
mime_guess = "2.0"        # MIME 类型
content_inspector = "0.2" # 二进制检测
```

---

## 7. 渐进加载策略

### 7.1 配置常量

```typescript
const PREVIEW_LIMITS = {
  // 文本文件
  text: {
    maxInlineSize: 1 * 1024 * 1024,  // 1MB
    chunkSize: 64 * 1024,             // 64KB chunks
  },
  // 图片
  image: {
    maxInlineSize: 10 * 1024 * 1024,  // 10MB
    thumbnailSize: 800,                 // 缩略图最大边长
  },
  // 视频
  video: {
    maxInlineSize: 50 * 1024 * 1024,  // 50MB
    useStreaming: true,                // 使用流式加载
  },
  // 音频
  audio: {
    maxInlineSize: 20 * 1024 * 1024,  // 20MB
  },
  // PDF
  pdf: {
    maxInlineSize: 20 * 1024 * 1024,  // 20MB
    pageCacheSize: 3,                  // 缓存页面数
  },
}
```

### 7.2 加载流程

```
用户打开文件
    │
    ▼
调用 fs_get_file_info
    │
    ├── category = 'code'/'markdown'
    │         │
    │         ├── size < 1MB -> 直接加载到 CodeMirror
    │         └── size >= 1MB -> 警告 + 分块加载 / 外部打开
    │
    ├── category = 'image'
    │         │
    │         ├── size < 10MB -> 直接渲染
    │         └── size >= 10MB -> 调用 fs_image_thumbnail 获取缩略图
    │
    ├── category = 'video'/'audio'
    │         │
    │         └── 使用 <video>/<audio> 流式加载（浏览器原生）
    │
    └── category = 'pdf'
              │
              ├── size < 20MB -> 调用 fs_pdf_get_info + 渲染首页
              └── size >= 20MB -> 警告 + 外部打开
```

---

## 8. UI 集成

### 8.1 FileEditorPane 增强

```typescript
// FileEditorPane.tsx 修改

function FileEditorPane({ ... }: FileEditorPaneProps) {
  const fileType = categorizeFile(activeFilePath)

  // Markdown 文件显示模式切换
  const showModeToggle = fileType.category === 'markdown'
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('edit')

  return (
    <section className="panel file-editor-pane">
      {showModeToggle && (
        <MarkdownModeToggle
          mode={viewMode}
          onChange={setViewMode}
        />
      )}

      {fileType.category === 'markdown' && viewMode === 'split' ? (
        <MarkdownSplitView {...props} />
      ) : (
        <CodeMirrorEditor {...props} />
      )}
    </section>
  )
}
```

### 8.2 新增 Tab 集成

当用户打开多媒体文件时，自动切换到预览模式：

```typescript
// useShellFileController.ts 修改

function handleFileOpen(path: string) {
  const fileType = categorizeFile(path)

  if (['image', 'video', 'audio', 'pdf'].includes(fileType.category)) {
    // 打开预览 Tab
    setActivePreviewFile(path)
  } else {
    // 打开编辑 Tab
    openFileInEditor(path)
  }
}
```

---

## 9. 国际化

新增翻译 key：

```typescript
// ui-locale.ts
{
  // 预览模式
  'preview.mode.edit': { zh: '编辑', en: 'Edit' },
  'preview.mode.preview': { zh: '预览', en: 'Preview' },
  'preview.mode.split': { zh: '分屏', en: 'Split' },

  // 加载状态
  'preview.loading': { zh: '加载中...', en: 'Loading...' },
  'preview.loadingPage': { zh: '正在加载第 {page} 页', en: 'Loading page {page}' },
  'preview.error.loadFailed': { zh: '加载失败', en: 'Load failed' },
  'preview.error.unsupported': { zh: '不支持的文件类型', en: 'Unsupported file type' },
  'preview.error.tooLarge': { zh: '文件过大，建议使用外部程序打开', en: 'File too large, please open externally' },

  // PDF 控制
  'pdf.page': { zh: '第 {current} 页，共 {total} 页', en: 'Page {current} of {total}' },
  'pdf.zoomIn': { zh: '放大', en: 'Zoom in' },
  'pdf.zoomOut': { zh: '缩小', en: 'Zoom out' },

  // 图片控制
  'image.zoomIn': { zh: '放大', en: 'Zoom in' },
  'image.zoomOut': { zh: '缩小', en: 'Zoom out' },
  'image.fitWindow': { zh: '适应窗口', en: 'Fit window' },
  'image.originalSize': { zh: '原始大小', en: 'Original size' },
}
```

---

## 10. 前端依赖新增

```json
// package.json
{
  "dependencies": {
    // CodeMirror 语言包
    "@codemirror/lang-shell": "^6.0.0",
    "@codemirror/lang-yaml": "^6.0.0",
    "@codemirror/lang-toml": "^6.0.0",
    "@codemirror/lang-sql": "^6.0.0",
    "@codemirror/lang-xml": "^6.0.0",
    "@codemirror/lang-java": "^6.0.0",
    "@codemirror/lang-cpp": "^6.0.0",
    "@codemirror/lang-csharp": "^6.0.0",
    "@codemirror/lang-go": "^6.0.0",
    "@codemirror/lang-php": "^6.0.0",
    "@codemirror/lang-kotlin": "^6.0.0",
    "@codemirror/lang-swift": "^6.0.0",
    "@codemirror/lang-ruby": "^6.0.0",
    "@codemirror/lang-lua": "^6.0.0",
    "@codemirror/lang-vue": "^6.0.0",
    "@codemirror/lang-svelte": "^6.0.0",

    // Markdown 渲染
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",

    // 图片缩放
    "react-zoom-pan-pinch": "^3.0.0"
  }
}
```

---

## 11. 后端依赖新增

```toml
# Cargo.toml
[dependencies]
# 现有依赖...

# 预览增强
pdfium-render = "0.8"
image = "0.25"
mime_guess = "2.0"
content_inspector = "0.2"
```

---

## 12. 验收标准

### 12.1 代码编辑器

- [ ] 新增语言全部正确高亮
- [ ] 文件切换时语言自动检测
- [ ] 编辑、保存、撤销/重做正常工作
- [ ] 大文件（> 1MB）显示警告并可切换外部打开

### 12.2 Markdown 预览

- [ ] 编辑模式正常工作
- [ ] 预览模式正确渲染 Markdown
- [ ] 分屏模式左右同步滚动（可选）
- [ ] GFM 语法支持（表格、任务列表等）
- [ ] 代码块高亮

### 12.3 多媒体预览

- [ ] 图片正确显示，支持缩放和拖拽
- [ ] 视频播放正常，支持全屏
- [ ] 音频播放正常
- [ ] PDF 分页显示，支持缩放

### 12.4 性能

- [ ] 大文件打开不阻塞 UI
- [ ] 图片缩略图优先加载
- [ ] PDF 页面按需渲染
- [ ] 文件类型检测 < 100ms

---

## 13. 任务分解

| 任务 | 描述 | 依赖 |
|------|------|------|
| T-1 | 创建 `file-preview` 模块结构 | - |
| T-2 | 实现 `file-type-utils.ts` 类型判断 | T-1 |
| T-3 | 扩展 CodeMirror 语言支持 | - |
| T-4 | 实现 `ImagePreviewer` | T-1 |
| T-5 | 实现 `VideoPreviewer` | T-1 |
| T-6 | 实现 `AudioPreviewer` | T-1 |
| T-7 | 后端：实现 `fs_get_file_info` | - |
| T-8 | 后端：实现 `fs_image_thumbnail` | T-7 |
| T-9 | 后端：实现 PDF 渲染命令 | T-7 |
| T-10 | 实现 `PdfPreviewer` | T-9 |
| T-11 | 实现 Markdown 预览组件 | - |
| T-12 | 实现 `MarkdownSplitView` | T-11 |
| T-13 | 集成到 `FileEditorPane` | T-3, T-11, T-12 |
| T-14 | 集成到文件打开流程 | T-4, T-5, T-6, T-10, T-13 |
| T-15 | 国际化支持 | T-1 ~ T-14 |
| T-16 | 单元测试和集成测试 | T-1 ~ T-15 |