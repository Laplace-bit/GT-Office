use super::{
    fs_get_file_info, fs_image_thumbnail, get_category_from_extension, get_mime_type,
    is_binary_file,
};
use base64::Engine;
use image::{ImageBuffer, Rgba};
use std::fs;
use uuid::Uuid;

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gtoffice-preview-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn category_from_extension_covers_preview_file_families() {
    assert_eq!(get_category_from_extension("RS"), "code");
    assert_eq!(get_category_from_extension("mdx"), "markdown");
    assert_eq!(get_category_from_extension("webp"), "image");
    assert_eq!(get_category_from_extension("mkv"), "video");
    assert_eq!(get_category_from_extension("flac"), "audio");
    assert_eq!(get_category_from_extension("pdf"), "pdf");
    assert_eq!(get_category_from_extension("dmg"), "binary");
    assert_eq!(get_category_from_extension("unknown-ext"), "unknown");
}

#[test]
fn mime_and_binary_detection_handle_text_and_nul_bytes() {
    let dir = temp_dir("binary");
    let text_path = dir.join("note.md");
    let bin_path = dir.join("blob.bin");
    fs::write(&text_path, "# hello\n").expect("write text");
    fs::write(&bin_path, b"\0\0\0abc").expect("write binary");

    assert_eq!(get_mime_type(&text_path), "text/markdown");
    assert!(!is_binary_file(&text_path));
    assert!(is_binary_file(&bin_path));
    assert!(is_binary_file(&dir.join("missing.bin")));

    let _ = fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn file_info_classifies_text_and_binary_files() {
    let dir = temp_dir("info");
    let text_path = dir.join("config.json");
    let bin_path = dir.join("archive.bin");
    fs::write(&text_path, "{\"ok\":true}\n").expect("write text");
    fs::write(&bin_path, b"\0\0\0abc").expect("write binary");

    let text_info = fs_get_file_info(text_path.to_string_lossy().to_string())
        .await
        .expect("text info");
    assert_eq!(text_info.category, "code");
    assert_eq!(text_info.mime_type, "application/json");
    assert!(!text_info.is_binary);
    assert!(!text_info.is_large);

    let binary_info = fs_get_file_info(bin_path.to_string_lossy().to_string())
        .await
        .expect("binary info");
    assert_eq!(binary_info.category, "binary");
    assert!(binary_info.is_binary);

    let _ = fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn image_thumbnail_preserves_aspect_ratio_and_returns_png_base64() {
    let dir = temp_dir("thumbnail");
    let image_path = dir.join("wide.png");
    let image = ImageBuffer::from_pixel(80, 40, Rgba([255u8, 0, 0, 255]));
    image.save(&image_path).expect("save image");

    let thumbnail = fs_image_thumbnail(image_path.to_string_lossy().to_string(), 20)
        .await
        .expect("thumbnail");

    assert_eq!(thumbnail.original_width, 80);
    assert_eq!(thumbnail.original_height, 40);
    assert_eq!(thumbnail.width, 20);
    assert_eq!(thumbnail.height, 10);
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(thumbnail.data)
        .expect("decode thumbnail");
    assert!(decoded.starts_with(b"\x89PNG\r\n\x1a\n"));

    let _ = fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn preview_commands_report_missing_or_invalid_files() {
    let dir = temp_dir("errors");
    let missing_path = dir.join("missing.txt");
    let invalid_image_path = dir.join("not-image.png");
    fs::write(&invalid_image_path, "not image data").expect("write invalid image");

    let file_info_error = fs_get_file_info(missing_path.to_string_lossy().to_string())
        .await
        .expect_err("missing file should fail");
    assert!(file_info_error.starts_with("Failed to read file metadata:"));

    let image_error = fs_image_thumbnail(invalid_image_path.to_string_lossy().to_string(), 32)
        .await
        .expect_err("invalid image should fail");
    assert!(image_error.starts_with("Failed to open image:"));

    let _ = fs::remove_dir_all(&dir);
}
