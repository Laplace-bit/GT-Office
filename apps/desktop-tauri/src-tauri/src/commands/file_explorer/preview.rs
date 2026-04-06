//! 文件预览相关命令
//!
//! 提供文件元数据检测、图片缩略图生成、PDF 渲染等能力

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

// ============================================================
// 类型定义
// ============================================================

/// 文件元信息响应
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
    use base64::Engine;
    use image::imageops::FilterType;

    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;

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
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&buffer);

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

    let pdfium = Pdfium::default();

    let document = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let page_count = document.pages().len() as u32;

    // 获取第一页尺寸作为默认页面尺寸
    let (page_width, page_height) = if page_count > 0 {
        // Use iterator to get first page
        let page = document
            .pages()
            .iter()
            .next()
            .ok_or("PDF has no pages".to_string())?;
        (
            page.width().value as f32,
            page.height().value as f32,
        )
    } else {
        (595.0, 842.0) // A4 默认尺寸
    };

    // TODO: Extract metadata when API is available
    // PdfMetadata API needs further investigation
    let title = None;
    let author = None;

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
    use base64::Engine;
    use pdfium_render::prelude::*;

    let pdfium = Pdfium::default();

    let document = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Use iterator to get specific page
    let pdf_page = document
        .pages()
        .iter()
        .nth(page as usize)
        .ok_or_else(|| format!("Page {} not found in PDF", page))?;

    // 渲染页面为位图
    let render_config = PdfRenderConfig::new()
        .set_target_width((pdf_page.width().value * scale) as i32)
        .set_target_height((pdf_page.height().value * scale) as i32);

    let bitmap = pdf_page
        .render_with_config(&render_config)
        .map_err(|e| format!("Failed to render page: {}", e))?;

    // 转换为 PNG via image crate
    let dynamic_image = bitmap.as_image();

    // 编码为 PNG
    let mut buffer = Vec::new();
    dynamic_image
        .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&buffer);

    Ok(PdfPageResponse {
        image_data: base64_data,
        width: bitmap.width() as u32,
        height: bitmap.height() as u32,
    })
}
