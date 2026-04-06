# 后端预览命令实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Rust 后端的文件预览支持命令，包括文件元数据检测、图片缩略图生成、PDF 渲染

**Architecture:** 在 `file_explorer` 模块下新增 `preview.rs`，实现高性能文件预览能力。使用 `image` crate 处理图片，`pdfium-render` 渲染 PDF。

**Tech Stack:** Rust, Tauri, image crate, pdfium-render

---

## 文件结构

```
apps/desktop-tauri/src-tauri/src/commands/file_explorer/
├── mod.rs                      # 现有命令 + 注册新命令（修改）
└── preview.rs                  # 预览命令（新建）

apps/desktop-tauri/src-tauri/
└── Cargo.toml                  # 添加依赖（修改）
```

---

## Task 1: 添加 Rust 依赖

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/Cargo.toml`

- [ ] **Step 1: 添加预览相关依赖**

在 `[dependencies]` 部分添加：

```toml
# 预览增强
image = "0.25"
mime_guess = "2.0"
content_inspector = "0.2"
pdfium-render = "0.8"
base64 = "0.22"
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/desktop-tauri/src-tauri && cargo check`
Expected: 依赖下载成功，无编译错误

- [ ] **Step 3: 提交依赖变更**

```bash
git add apps/desktop-tauri/src-tauri/Cargo.toml apps/desktop-tauri/src-tauri/Cargo.lock
git commit -m "feat(tauri): add preview-related dependencies

- image for thumbnail generation
- mime_guess for MIME type detection
- content_inspector for binary detection
- pdfium-render for PDF rendering
- base64 for image encoding

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 创建 preview.rs 基础结构

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/commands/file_explorer/preview.rs`

- [ ] **Step 1: 创建 preview.rs 文件**

```rust
// preview.rs
//! 文件预览相关命令
//!
//! 提供文件元数据检测、图片缩略图生成、PDF 渲染等能力

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs::File;
use std::io::Read;

// ============================================================
// 类型定义
// ============================================================

/// 文件元信息响应
#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfoResponse {
    /// 文件路径
    pub path: String,
    /// 文件大小（字节）
    pub size: u64,
    /// MIME 类型
    pub mime_type: String,
    /// 是否为二进制文件
    pub is_binary: bool,
    /// 是否为大文件
    /// - 文本文件: > 1MB
    /// - 媒体文件: > 10MB
    pub is_large: bool,
    /// 文件类别
    /// code, markdown, image, video, audio, pdf, binary, unknown
    pub category: String,
}

/// 缩略图响应
#[derive(Debug, Serialize, Deserialize)]
pub struct ThumbnailResponse {
    /// Base64 编码的图片数据
    pub data: String,
    /// 缩略图宽度
    pub width: u32,
    /// 缩略图高度
    pub height: u32,
    /// 原始图片宽度
    pub original_width: u32,
    /// 原始图片高度
    pub original_height: u32,
}

/// PDF 信息响应
#[derive(Debug, Serialize, Deserialize)]
pub struct PdfInfoResponse {
    /// 页数
    pub page_count: u32,
    /// 页面宽度（点）
    pub page_width: f32,
    /// 页面高度（点）
    pub page_height: f32,
    /// 标题
    pub title: Option<String>,
    /// 作者
    pub author: Option<String>,
}

/// PDF 页面渲染响应
#[derive(Debug, Serialize, Deserialize)]
pub struct PdfPageResponse {
    /// Base64 编码的 PNG 图片数据
    pub image_data: String,
    /// 渲染宽度
    pub width: u32,
    /// 渲染高度
    pub height: u32,
}

// ============================================================
// 辅助函数
// ============================================================

/// 根据扩展名判断文件类别
fn get_category_from_extension(ext: &str) -> &'static str {
    let ext = ext.to_lowercase();
    match ext.as_str() {
        // 代码文件
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "mts" | "cts"
        | "py" | "pyw" | "pyi"
        | "rs" | "go" | "java" | "kt" | "kts" | "swift"
        | "c" | "h" | "cc" | "cpp" | "hpp"
        | "cs" | "php" | "rb" | "lua"
        | "sh" | "bash" | "zsh" | "fish" | "ps1"
        | "sql" | "vue" | "svelte" => "code",

        // 数据格式
        "json" | "jsonc" | "json5" | "yaml" | "yml" | "toml"
        | "xml" | "ini" | "conf" | "cfg" => "code",

        // 样式
        "css" | "scss" | "sass" | "less" | "html" | "htm" => "code",

        // Markdown
        "md" | "mdx" | "markdown" => "markdown",

        // 图片
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"
        | "ico" | "bmp" | "heic" | "avif" => "image",

        // 视频
        "mp4" | "mov" | "webm" | "mkv" | "avi" | "m4v" => "video",

        // 音频
        "mp3" | "wav" | "flac" | "aac" | "m4a" | "ogg" => "audio",

        // PDF
        "pdf" => "pdf",

        // 二进制
        "exe" | "app" | "dmg" | "msi" | "bin" => "binary",

        _ => "unknown",
    }
}

/// 获取文件的 MIME 类型
fn get_mime_type(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

/// 检测文件是否为二进制
fn is_binary_file(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return true,
    };

    let mut buffer = [0u8; 8192];
    let bytes_read = match file.read(&mut buffer) {
        Ok(n) => n,
        Err(_) => return true,
    };

    content_inspector::inspect(&buffer[..bytes_read]).is_binary()
}

// ============================================================
// Tauri 命令
// ============================================================

/// 获取文件元信息
#[tauri::command]
pub async fn fs_get_file_info(path: String) -> Result<FileInfoResponse, String> {
    let path = Path::new(&path);

    // 获取文件大小
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let size = metadata.len();

    // 获取扩展名
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // 获取 MIME 类型
    let mime_type = get_mime_type(path);

    // 检测是否二进制
    let is_binary = is_binary_file(path);

    // 判断文件类别
    let category = if is_binary {
        // 对于已知二进制类型，使用扩展名判断
        let cat = get_category_from_extension(ext);
        if cat == "unknown" {
            "binary".to_string()
        } else {
            cat.to_string()
        }
    } else {
        get_category_from_extension(ext).to_string()
    };

    // 判断是否大文件
    let is_large = if is_binary {
        // 媒体文件: > 10MB
        size > 10 * 1024 * 1024
    } else {
        // 文本文件: > 1MB
        size > 1024 * 1024
    };

    Ok(FileInfoResponse {
        path: path.to_string_lossy().to_string(),
        size,
        mime_type,
        is_binary,
        is_large,
        category,
    })
}

/// 生成图片缩略图
#[tauri::command]
pub async fn fs_image_thumbnail(
    path: String,
    max_size: u32,
) -> Result<ThumbnailResponse, String> {
    use image::imageops::FilterType;

    let img = image::open(&path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    let original_width = img.width();
    let original_height = img.height();

    // 计算缩略图尺寸
    let (thumb_width, thumb_height) = if original_width > original_height {
        let ratio = max_size as f32 / original_width as f32;
        (max_size, (original_height as f32 * ratio) as u32)
    } else {
        let ratio = max_size as f32 / original_height as f32;
        ((original_width as f32 * ratio) as u32, max_size)
    };

    // 生成缩略图
    let thumbnail = img.resize(thumb_width, thumb_height, FilterType::Lanczos3);

    // 编码为 PNG
    let mut buffer = Vec::new();
    thumbnail
        .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    // Base64 编码
    let base64_data = base64::encode(&buffer);

    Ok(ThumbnailResponse {
        data: base64_data,
        width: thumb_width,
        height: thumb_height,
        original_width,
        original_height,
    })
}

/// 获取 PDF 信息
#[tauri::command]
pub async fn fs_pdf_get_info(path: String) -> Result<PdfInfoResponse, String> {
    use pdfium_render::prelude::*;

    let pdfium = Pdfium::default()
        .map_err(|e| format!("Failed to initialize PDFium: {}", e))?;

    let document = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let page_count = document.pages().len() as u32;

    // 获取第一页尺寸作为默认页面尺寸
    let (page_width, page_height) = if page_count > 0 {
        let page = document
            .pages()
            .get(0)
            .map_err(|e| format!("Failed to get first page: {}", e))?;
        (
            page.width().value as f32,
            page.height().value as f32,
        )
    } else {
        (595.0, 842.0) // A4 默认尺寸
    };

    // 提取元数据
    let title = document
        .metadata()
        .and_then(|m| m.title())
        .map(|s| s.to_string());
    let author = document
        .metadata()
        .and_then(|m| m.author())
        .map(|s| s.to_string());

    Ok(PdfInfoResponse {
        page_count,
        page_width,
        page_height,
        title,
        author,
    })
}

/// 渲染 PDF 页面
#[tauri::command]
pub async fn fs_pdf_render_page(
    path: String,
    page: u32,
    scale: f32,
) -> Result<PdfPageResponse, String> {
    use pdfium_render::prelude::*;

    let pdfium = Pdfium::default()
        .map_err(|e| format!("Failed to initialize PDFium: {}", e))?;

    let document = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let page_index = PdfPageIndex::new(page as usize)
        .map_err(|_| "Invalid page index".to_string())?;

    let pdf_page = document
        .pages()
        .get(page_index)
        .map_err(|e| format!("Failed to get page: {}", e))?;

    // 渲染页面为位图
    let render_config = PdfRenderConfig::new()
        .set_target_width((pdf_page.width().value * scale) as i32)
        .set_target_height((pdf_page.height().value * scale) as i32);

    let bitmap = pdf_page
        .render_with_config(&render_config)
        .map_err(|e| format!("Failed to render page: {}", e))?;

    // 转换为 PNG
    let png_data = bitmap
        .as_png_bytes()
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    let base64_data = base64::encode(&png_data);

    Ok(PdfPageResponse {
        image_data: base64_data,
        width: bitmap.width(),
        height: bitmap.height(),
    })
}
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/desktop-tauri/src-tauri && cargo check`
Expected: 无编译错误

- [ ] **Step 3: 提交预览模块**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/file_explorer/preview.rs
git commit -m "feat(tauri): implement preview commands for file metadata and rendering

- fs_get_file_info: detect file type, size, MIME, binary
- fs_image_thumbnail: generate image thumbnails
- fs_pdf_get_info: extract PDF metadata
- fs_pdf_render_page: render PDF pages to PNG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 注册命令到 mod.rs

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/file_explorer/mod.rs`

- [ ] **Step 1: 添加 preview 模块声明**

在 `mod.rs` 顶部添加：

```rust
pub mod preview;
```

- [ ] **Step 2: 导出 preview 命令**

在现有导出后添加：

```rust
pub use preview::{
    FileInfoResponse,
    ThumbnailResponse,
    PdfInfoResponse,
    PdfPageResponse,
    fs_get_file_info,
    fs_image_thumbnail,
    fs_pdf_get_info,
    fs_pdf_render_page,
};
```

- [ ] **Step 3: 验证编译**

Run: `cd apps/desktop-tauri/src-tauri && cargo check`
Expected: 无编译错误

- [ ] **Step 4: 提交模块注册**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/file_explorer/mod.rs
git commit -m "feat(tauri): register preview commands in file_explorer module

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 注册命令到 Tauri 入口

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs` 或 `main.rs`

- [ ] **Step 1: 查找命令注册位置**

Run: `grep -n "fs_list_dir" apps/desktop-tauri/src-tauri/src/lib.rs apps/desktop-tauri/src-tauri/src/main.rs apps/desktop-tauri/src-tauri/src/app_state.rs 2>/dev/null || true`

找到命令注册的 `invoke_handler` 部分。

- [ ] **Step 2: 添加新命令到 invoke_handler**

在现有 `fs_` 命令后添加：

```rust
// 在 invoke_handler 中添加
.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    commands::file_explorer::fs_get_file_info,
    commands::file_explorer::fs_image_thumbnail,
    commands::file_explorer::fs_pdf_get_info,
    commands::file_explorer::fs_pdf_render_page,
])
```

- [ ] **Step 3: 验证编译**

Run: `cd apps/desktop-tauri/src-tauri && cargo check`
Expected: 无编译错误

- [ ] **Step 4: 提交命令注册**

```bash
git add apps/desktop-tauri/src-tauri/src/lib.rs
git commit -m "feat(tauri): register preview commands in invoke_handler

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 添加前端 API 层

**Files:**
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`

- [ ] **Step 1: 添加类型定义**

在文件中添加类型：

```typescript
// 文件元信息
export interface FsFileInfoResponse {
  path: string
  size: number
  mime_type: string
  is_binary: boolean
  is_large: boolean
  category: string
}

// 缩略图响应
export interface FsThumbnailResponse {
  data: string // Base64
  width: number
  height: number
  original_width: number
  original_height: number
}

// PDF 信息
export interface FsPdfInfoResponse {
  page_count: number
  page_width: number
  page_height: number
  title: string | null
  author: string | null
}

// PDF 页面响应
export interface FsPdfPageResponse {
  image_data: string // Base64
  width: number
  height: number
}
```

- [ ] **Step 2: 添加 API 函数**

```typescript
export async function fsGetFileInfo(path: string): Promise<FsFileInfoResponse> {
  return invoke('fs_get_file_info', { path })
}

export async function fsImageThumbnail(
  path: string,
  maxSize: number
): Promise<FsThumbnailResponse> {
  return invoke('fs_image_thumbnail', { path, maxSize })
}

export async function fsPdfGetInfo(path: string): Promise<FsPdfInfoResponse> {
  return invoke('fs_pdf_get_info', { path })
}

export async function fsPdfRenderPage(
  path: string,
  page: number,
  scale: number
): Promise<FsPdfPageResponse> {
  return invoke('fs_pdf_render_page', { path, page, scale })
}
```

- [ ] **Step 3: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 4: 提交 API 层**

```bash
git add apps/desktop-web/src/shell/integration/desktop-api.ts
git commit -m "feat(api): add TypeScript bindings for preview commands

- Add FsFileInfoResponse, FsThumbnailResponse, FsPdfInfoResponse types
- Add fsGetFileInfo, fsImageThumbnail, fsPdfGetInfo, fsPdfRenderPage functions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] `cargo check` 无错误
- [ ] `pnpm typecheck` 无错误
- [ ] 所有命令正确注册到 Tauri
- [ ] API 类型定义正确
- [ ] 文件类型检测准确
- [ ] 图片缩略图生成正确
- [ ] PDF 信息提取正确