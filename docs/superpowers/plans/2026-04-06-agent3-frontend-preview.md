# 前端预览模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建独立的 `file-preview` 模块，实现图片、视频、音频预览器

**Architecture:** 在 `features/file-preview/` 下创建独立模块，包含类型判断工具和各类型预览器组件。使用 Tauri 的 `convertFileSrc` 加载本地文件。

**Tech Stack:** React, TypeScript, SCSS, Tauri, react-zoom-pan-pinch

---

## 文件结构

```
apps/desktop-web/src/features/file-preview/
├── index.ts                    # 模块导出
├── FilePreviewPane.tsx         # 预览主组件（类型路由）
├── FilePreviewPane.scss        # 预览样式
├── utils/
│   └── file-type-utils.ts      # 文件类型判断
├── previewers/
│   ├── index.ts                # 预览器导出
│   ├── ImagePreviewer.tsx      # 图片预览
│   ├── ImagePreviewer.scss
│   ├── VideoPreviewer.tsx      # 视频预览
│   ├── VideoPreviewer.scss
│   └── AudioPreviewer.tsx      # 音频预览
│       └── AudioPreviewer.scss
└── components/
    ├── PreviewProgress.tsx      # 加载进度
    └── PreviewError.tsx        # 错误展示
```

---

## Task 1: 创建模块目录结构

**Files:**
- Create: 目录结构

- [ ] **Step 1: 创建目录**

Run:
```bash
mkdir -p apps/desktop-web/src/features/file-preview/utils
mkdir -p apps/desktop-web/src/features/file-preview/previewers
mkdir -p apps/desktop-web/src/features/file-preview/components
```

---

## Task 2: 实现文件类型判断工具

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/utils/file-type-utils.ts`

- [ ] **Step 1: 创建 file-type-utils.ts**

```typescript
// file-type-utils.ts
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
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code',
  mjs: 'code', cjs: 'code', mts: 'code', cts: 'code',
  py: 'code', pyw: 'code', pyi: 'code',
  rs: 'code', go: 'code', java: 'code', kt: 'code', kts: 'code',
  swift: 'code', c: 'code', h: 'code', cc: 'code', cpp: 'code', hpp: 'code',
  cs: 'code', php: 'code', rb: 'code', lua: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code',
  sql: 'code', vue: 'code', svelte: 'code',
  json: 'code', jsonc: 'code', json5: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  xml: 'code', ini: 'code', conf: 'code', cfg: 'code',
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

  // 二进制
  exe: 'binary', app: 'binary', dmg: 'binary', msi: 'binary', bin: 'binary',
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
```

- [ ] **Step 2: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

---

## Task 3: 创建共享组件

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/components/PreviewProgress.tsx`
- Create: `apps/desktop-web/src/features/file-preview/components/PreviewError.tsx`

- [ ] **Step 1: 创建 PreviewProgress.tsx**

```typescript
// PreviewProgress.tsx
import { Loader2 } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './PreviewProgress.scss'

interface PreviewProgressProps {
  locale: Locale
  message?: string
}

export function PreviewProgress({ locale, message }: PreviewProgressProps) {
  return (
    <div className="preview-progress">
      <Loader2 className="preview-progress-icon" aria-hidden="true" />
      <span className="preview-progress-text">
        {message || t(locale, 'preview.loading')}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: 创建 PreviewProgress.scss**

```scss
// PreviewProgress.scss
.preview-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  height: 100%;
  color: var(--text-secondary);
}

.preview-progress-icon {
  width: 2rem;
  height: 2rem;
  animation: spin 1s linear infinite;
}

.preview-progress-text {
  font-size: 0.875rem;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: 创建 PreviewError.tsx**

```typescript
// PreviewError.tsx
import { AlertCircle, ExternalLink } from 'lucide-react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './PreviewError.scss'

interface PreviewErrorProps {
  locale: Locale
  type: 'load-failed' | 'unsupported' | 'too-large'
  message?: string
  onOpenExternal?: () => void
}

export function PreviewError({
  locale,
  type,
  message,
  onOpenExternal,
}: PreviewErrorProps) {
  const defaultMessages: Record<string, string> = {
    'load-failed': t(locale, 'preview.error.loadFailed'),
    unsupported: t(locale, 'preview.error.unsupported'),
    'too-large': t(locale, 'preview.error.tooLarge'),
  }

  return (
    <div className="preview-error">
      <AlertCircle className="preview-error-icon" aria-hidden="true" />
      <span className="preview-error-text">
        {message || defaultMessages[type] || defaultMessages.unsupported}
      </span>
      {onOpenExternal && (
        <button
          type="button"
          className="preview-error-external"
          onClick={onOpenExternal}
        >
          <ExternalLink className="preview-error-external-icon" aria-hidden="true" />
          <span>{t(locale, 'preview.openExternal')}</span>
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 创建 PreviewError.scss**

```scss
// PreviewError.scss
.preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  height: 100%;
  color: var(--text-secondary);
}

.preview-error-icon {
  width: 2rem;
  height: 2rem;
  color: var(--color-error);
}

.preview-error-text {
  font-size: 0.875rem;
  text-align: center;
  max-width: 20rem;
}

.preview-error-external {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: var(--accent-color);
  background: transparent;
  border: 1px solid var(--accent-color);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--accent-color-alpha-10);
  }
}

.preview-error-external-icon {
  width: 1rem;
  height: 1rem;
}
```

---

## Task 4: 实现图片预览器

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/previewers/ImagePreviewer.tsx`
- Create: `apps/desktop-web/src/features/file-preview/previewers/ImagePreviewer.scss`

- [ ] **Step 1: 添加 react-zoom-pan-pinch 依赖**

Run: `cd apps/desktop-web && pnpm add react-zoom-pan-pinch`

- [ ] **Step 2: 创建 ImagePreviewer.tsx**

```typescript
// ImagePreviewer.tsx
import { useState, useCallback } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { PreviewProgress } from '../components/PreviewProgress'
import { PreviewError } from '../components/PreviewError'
import { PREVIEW_LIMITS } from '../utils/file-type-utils'
import './ImagePreviewer.scss'

interface ImagePreviewerProps {
  locale: Locale
  filePath: string
  fileSize: number
  onOpenExternal?: () => void
}

export function ImagePreviewer({
  locale,
  filePath,
  fileSize,
  onOpenExternal,
}: ImagePreviewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)

  const isTooLarge = fileSize > PREVIEW_LIMITS.image.maxInlineSize
  const src = convertFileSrc(filePath)

  const handleLoad = useCallback(() => {
    setLoading(false)
  }, [])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(t(locale, 'preview.error.loadFailed'))
  }, [locale])

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(s * 1.25, 5))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(s / 1.25, 0.1))
  }, [])

  const handleFitWindow = useCallback(() => {
    setScale(1)
  }, [])

  if (isTooLarge) {
    return (
      <PreviewError
        locale={locale}
        type="too-large"
        onOpenExternal={onOpenExternal}
      />
    )
  }

  return (
    <div className="image-previewer">
      {/* 控制栏 */}
      <div className="image-previewer-controls">
        <button
          type="button"
          className="image-previewer-btn"
          onClick={handleZoomIn}
          title={t(locale, 'image.zoomIn')}
          aria-label={t(locale, 'image.zoomIn')}
        >
          <ZoomIn className="image-previewer-btn-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="image-previewer-btn"
          onClick={handleZoomOut}
          title={t(locale, 'image.zoomOut')}
          aria-label={t(locale, 'image.zoomOut')}
        >
          <ZoomOut className="image-previewer-btn-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="image-previewer-btn"
          onClick={handleFitWindow}
          title={t(locale, 'image.fitWindow')}
          aria-label={t(locale, 'image.fitWindow')}
        >
          <Maximize2 className="image-previewer-btn-icon" aria-hidden="true" />
        </button>
        <span className="image-previewer-scale">{Math.round(scale * 100)}%</span>
      </div>

      {/* 图片容器 */}
      <div className="image-previewer-content">
        {loading && <PreviewProgress locale={locale} />}
        {error && (
          <PreviewError
            locale={locale}
            type="load-failed"
            message={error}
            onOpenExternal={onOpenExternal}
          />
        )}
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={5}
          centerOnInit
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <img
              src={src}
              alt=""
              className="image-previewer-img"
              onLoad={handleLoad}
              onError={handleError}
              style={{ display: loading || error ? 'none' : 'block' }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 创建 ImagePreviewer.scss**

```scss
// ImagePreviewer.scss
.image-previewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.image-previewer-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
}

.image-previewer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
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
}

.image-previewer-btn-icon {
  width: 1rem;
  height: 1rem;
}

.image-previewer-scale {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.image-previewer-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.image-previewer-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
```

---

## Task 5: 实现视频预览器

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/previewers/VideoPreviewer.tsx`
- Create: `apps/desktop-web/src/features/file-preview/previewers/VideoPreviewer.scss`

- [ ] **Step 1: 创建 VideoPreviewer.tsx**

```typescript
// VideoPreviewer.tsx
import { convertFileSrc } from '@tauri-apps/api/core'
import './VideoPreviewer.scss'

interface VideoPreviewerProps {
  filePath: string
}

export function VideoPreviewer({ filePath }: VideoPreviewerProps) {
  const src = convertFileSrc(filePath)

  return (
    <div className="video-previewer">
      <video
        className="video-previewer-player"
        controls
        preload="metadata"
      >
        <source src={src} />
        {/* 浏览器不支持 video 标签 */}
      </video>
    </div>
  )
}
```

- [ ] **Step 2: 创建 VideoPreviewer.scss**

```scss
// VideoPreviewer.scss
.video-previewer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: #000;
}

.video-previewer-player {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}

// 自定义 video 控件样式（可选）
video::-webkit-media-controls-panel {
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
}
```

---

## Task 6: 实现音频预览器

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/previewers/AudioPreviewer.tsx`
- Create: `apps/desktop-web/src/features/file-preview/previewers/AudioPreviewer.scss`

- [ ] **Step 1: 创建 AudioPreviewer.tsx**

```typescript
// AudioPreviewer.tsx
import { Music } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './AudioPreviewer.scss'

interface AudioPreviewerProps {
  locale: Locale
  filePath: string
}

export function AudioPreviewer({ locale, filePath }: AudioPreviewerProps) {
  const src = convertFileSrc(filePath)
  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="audio-previewer">
      <div className="audio-previewer-cover">
        <Music className="audio-previewer-icon" aria-hidden="true" />
      </div>
      <div className="audio-previewer-info">
        <span className="audio-previewer-name">{fileName}</span>
      </div>
      <audio
        className="audio-previewer-player"
        controls
        preload="metadata"
      >
        <source src={src} />
      </audio>
    </div>
  )
}
```

- [ ] **Step 2: 创建 AudioPreviewer.scss**

```scss
// AudioPreviewer.scss
.audio-previewer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  height: 100%;
  padding: 2rem;
  background: var(--bg-secondary);
}

.audio-previewer-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8rem;
  height: 8rem;
  background: var(--bg-primary);
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.audio-previewer-icon {
  width: 3rem;
  height: 3rem;
  color: var(--text-secondary);
}

.audio-previewer-info {
  text-align: center;
}

.audio-previewer-name {
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
}

.audio-previewer-player {
  width: 100%;
  max-width: 24rem;
  height: 2.5rem;
}
```

---

## Task 7: 创建预览器导出

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/previewers/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
// previewers/index.ts
export { ImagePreviewer } from './ImagePreviewer'
export { VideoPreviewer } from './VideoPreviewer'
export { AudioPreviewer } from './AudioPreviewer'
```

---

## Task 8: 创建预览主组件

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/FilePreviewPane.tsx`
- Create: `apps/desktop-web/src/features/file-preview/FilePreviewPane.scss`

- [ ] **Step 1: 创建 FilePreviewPane.tsx**

```typescript
// FilePreviewPane.tsx
import type { Locale } from '@shell/i18n/ui-locale'
import { categorizeFile, isPreviewable } from './utils/file-type-utils'
import { ImagePreviewer, VideoPreviewer, AudioPreviewer } from './previewers'
import { PreviewError } from './components/PreviewError'
import './FilePreviewPane.scss'

interface FilePreviewPaneProps {
  locale: Locale
  workspaceId: string | null
  filePath: string | null
  fileSize: number
  onOpenExternal?: () => void
}

export function FilePreviewPane({
  locale,
  workspaceId,
  filePath,
  fileSize,
  onOpenExternal,
}: FilePreviewPaneProps) {
  if (!workspaceId) {
    return (
      <div className="file-preview-pane">
        <div className="file-preview-empty">
          {locale === 'zh' ? '请先绑定工作区' : 'Please bind a workspace first'}
        </div>
      </div>
    )
  }

  if (!filePath) {
    return (
      <div className="file-preview-pane">
        <div className="file-preview-empty">
          {locale === 'zh' ? '选择文件以预览' : 'Select a file to preview'}
        </div>
      </div>
    )
  }

  const fileType = categorizeFile(filePath)

  if (!isPreviewable(filePath)) {
    return (
      <div className="file-preview-pane">
        <PreviewError
          locale={locale}
          type="unsupported"
          onOpenExternal={onOpenExternal}
        />
      </div>
    )
  }

  const renderPreviewer = () => {
    switch (fileType.category) {
      case 'image':
        return (
          <ImagePreviewer
            locale={locale}
            filePath={filePath}
            fileSize={fileSize}
            onOpenExternal={onOpenExternal}
          />
        )
      case 'video':
        return <VideoPreviewer filePath={filePath} />
      case 'audio':
        return <AudioPreviewer locale={locale} filePath={filePath} />
      default:
        return (
          <PreviewError
            locale={locale}
            type="unsupported"
            onOpenExternal={onOpenExternal}
          />
        )
    }
  }

  return (
    <section className="file-preview-pane panel">
      {renderPreviewer()}
    </section>
  )
}
```

- [ ] **Step 2: 创建 FilePreviewPane.scss**

```scss
// FilePreviewPane.scss
.file-preview-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.file-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
```

---

## Task 9: 创建模块导出

**Files:**
- Create: `apps/desktop-web/src/features/file-preview/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
// index.ts
export { FilePreviewPane } from './FilePreviewPane'
export { categorizeFile, isPreviewable, isMediaFile } from './utils/file-type-utils'
export type { FileCategory, FileTypeResult } from './utils/file-type-utils'
export { ImagePreviewer, VideoPreviewer, AudioPreviewer } from './previewers'
```

- [ ] **Step 2: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: 提交前端预览模块**

```bash
git add apps/desktop-web/src/features/file-preview/
git commit -m "feat(preview): create file-preview module with image/video/audio previewers

- Add file-type-utils for file categorization
- Implement ImagePreviewer with zoom/pan support
- Implement VideoPreviewer with native video element
- Implement AudioPreviewer with styled player
- Add PreviewProgress and PreviewError components
- Create FilePreviewPane as main preview router

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm build` 成功
- [ ] 文件类型判断正确
- [ ] 图片预览支持缩放和拖拽
- [ ] 视频播放正常
- [ ] 音频播放正常
- [ ] 大文件显示错误提示