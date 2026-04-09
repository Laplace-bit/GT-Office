use super::{
    build_fs_delete_response, build_fs_list_dir_response, build_fs_move_response,
    build_fs_read_file_response, build_fs_search_files_response, build_fs_search_text_response,
    build_fs_write_file_response, ensure_copy_target_is_safe, ensure_directory_target_is_creatable,
    is_likely_binary, resolve_target_path, sanitize_relative_path, search_file_matches,
    search_text_matches, FileSearchMatch, FileSystemEntry, SearchMatch, SearchTicket,
};
use gt_settings::{
    DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES, DEFAULT_FS_FULL_READ_HARD_MAX_BYTES,
    DEFAULT_FS_PREVIEW_MAX_BYTES,
};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn create() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("gtoffice-fs-cmd-test-{seed}"));
        fs::create_dir_all(&path).expect("failed to create temp dir");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn sanitize_rejects_parent_traversal() {
    let err = sanitize_relative_path("../secret").expect_err("expected invalid path");
    assert!(err.contains("parent traversal"));
}

#[test]
fn resolve_existing_file_inside_workspace() {
    let tmp = TempDir::create();
    let file = tmp.path.join("a.txt");
    fs::write(&file, "hello").expect("write file");
    let canonical_root = tmp.path.canonicalize().expect("canonical root");
    let resolved = resolve_target_path(&canonical_root, "a.txt", true, Some(false))
        .expect("resolve file path");
    assert_eq!(resolved, file.canonicalize().expect("canonical file"));
}

#[test]
fn resolve_rejects_absolute_path() {
    let tmp = TempDir::create();
    let canonical_root = tmp.path.canonicalize().expect("canonical root");
    let abs_path = if cfg!(windows) {
        "C:\\Windows\\System32"
    } else {
        "/etc/passwd"
    };
    let err = resolve_target_path(&canonical_root, abs_path, true, None)
        .expect_err("expected absolute path rejection");
    assert!(err.contains("absolute path"));
}

#[test]
fn fs_list_dir_payload_keeps_contract_fields() {
    let payload = build_fs_list_dir_response(
        "ws-1",
        ".",
        1,
        &[FileSystemEntry {
            path: "src".to_string(),
            name: "src".to_string(),
            kind: "dir".to_string(),
            size_bytes: None,
        }],
    );
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], ".");
    assert_eq!(payload["depth"], 1);
    assert_eq!(payload["entries"][0]["path"], "src");
    assert_eq!(payload["entries"][0]["kind"], "dir");
}

#[test]
fn fs_read_file_payload_keeps_contract_fields() {
    let payload =
        build_fs_read_file_response("ws-1", "README.md", "hello", "utf-8", 5, 5, true, false);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], "README.md");
    assert_eq!(payload["content"], "hello");
    assert_eq!(payload["encoding"], "utf-8");
    assert_eq!(payload["sizeBytes"], 5);
    assert_eq!(payload["previewBytes"], 5);
    assert_eq!(payload["previewable"], true);
    assert_eq!(payload["truncated"], false);
}

#[test]
fn fs_write_file_payload_keeps_contract_fields() {
    let payload = build_fs_write_file_response("ws-1", "README.md", 12);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], "README.md");
    assert_eq!(payload["bytes"], 12);
    assert_eq!(payload["written"], true);
}

#[test]
fn fs_delete_payload_keeps_contract_fields() {
    let payload = build_fs_delete_response("ws-1", "README.md", "file", true);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], "README.md");
    assert_eq!(payload["kind"], "file");
    assert_eq!(payload["deleted"], true);
}

#[test]
fn fs_move_payload_keeps_contract_fields() {
    let payload = build_fs_move_response("ws-1", "a.md", "b.md", "file", true);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["fromPath"], "a.md");
    assert_eq!(payload["toPath"], "b.md");
    assert_eq!(payload["kind"], "file");
    assert_eq!(payload["moved"], true);
}

#[test]
fn create_dir_rejects_existing_file_target() {
    let tmp = TempDir::create();
    let target = tmp.path.join("notes.txt");
    fs::write(&target, "hello").expect("write file");

    let err = ensure_directory_target_is_creatable(&target, "notes.txt")
        .expect_err("expected existing file conflict");
    assert!(err.contains("FS_CREATE_DIR_CONFLICT"));
}

#[test]
fn create_dir_allows_existing_directory_target() {
    let tmp = TempDir::create();
    let target = tmp.path.join("docs");
    fs::create_dir_all(&target).expect("create dir");

    ensure_directory_target_is_creatable(&target, "docs")
        .expect("existing directory should be allowed");
}

#[test]
fn copy_rejects_directory_target_inside_source_tree() {
    let tmp = TempDir::create();
    let source = tmp.path.join("src");
    let target = source.join("copy");
    fs::create_dir_all(&source).expect("create source dir");

    let err = ensure_copy_target_is_safe(&source, &target, true)
        .expect_err("expected recursive copy rejection");
    assert!(err.contains("target path cannot be inside source directory"));
}

#[test]
fn copy_allows_file_target_inside_source_parent_tree() {
    let tmp = TempDir::create();
    let source = tmp.path.join("src").join("main.rs");
    let target = tmp.path.join("src").join("main-copy.rs");
    fs::create_dir_all(source.parent().expect("parent")).expect("create dir");
    fs::write(&source, "fn main() {}").expect("write file");

    ensure_copy_target_is_safe(&source, &target, false).expect("file copy should be allowed");
}

#[test]
fn fs_search_payload_keeps_contract_fields() {
    let payload = build_fs_search_text_response(
        "ws-1",
        "workspace",
        Some("*.md".to_string()),
        vec![SearchMatch {
            path: "README.md".to_string(),
            line: 12,
            preview: "workspace model".to_string(),
        }],
    );
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["query"], "workspace");
    assert_eq!(payload["glob"], "*.md");
    assert_eq!(payload["matches"][0]["path"], "README.md");
    assert_eq!(payload["matches"][0]["line"], 12);
}

#[test]
fn fs_search_files_payload_keeps_contract_fields() {
    let payload = build_fs_search_files_response(
        "ws-1",
        "task",
        vec![FileSearchMatch {
            path: "docs/task-center.md".to_string(),
            name: "task-center.md".to_string(),
        }],
    );
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["query"], "task");
    assert_eq!(payload["matches"][0]["path"], "docs/task-center.md");
    assert_eq!(payload["matches"][0]["name"], "task-center.md");
}

#[test]
fn search_text_matches_finds_literal_content() {
    let tmp = TempDir::create();
    fs::write(tmp.path.join("a.txt"), "hello needle world").expect("write file");
    fs::write(tmp.path.join("b.txt"), "no hit").expect("write file");

    let matches = search_text_matches(
        &tmp.path,
        "needle",
        None,
        20,
        SearchTicket::new("test-search-literal"),
    )
    .expect("search");
    assert_eq!(matches.len(), 1);
    let first = &matches[0];
    assert_eq!(first.path, "a.txt");
    assert_eq!(first.line, 1);
}

#[test]
fn search_text_matches_treats_query_as_fixed_string() {
    let tmp = TempDir::create();
    fs::write(tmp.path.join("a.txt"), "literal [abc] token").expect("write file");

    let matches = search_text_matches(
        &tmp.path,
        "[abc]",
        None,
        20,
        SearchTicket::new("test-search-fixed"),
    )
    .expect("search");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].preview, "literal [abc] token");
}

#[test]
fn search_file_matches_finds_by_file_name() {
    let tmp = TempDir::create();
    fs::create_dir_all(tmp.path.join("docs")).expect("create docs dir");
    fs::create_dir_all(tmp.path.join("src")).expect("create src dir");
    fs::write(tmp.path.join("docs/task-center.md"), "# task center").expect("write file");
    fs::write(tmp.path.join("src/main.rs"), "fn main() {}").expect("write file");

    let matches = search_file_matches(
        &tmp.path,
        "task",
        20,
        SearchTicket::new("test-search-files"),
    )
    .expect("search");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].path, "docs/task-center.md");
    assert_eq!(matches[0].name, "task-center.md");
}

#[test]
fn full_read_limit_is_larger_than_preview_limit() {
    assert!(DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES > DEFAULT_FS_PREVIEW_MAX_BYTES);
    assert!(DEFAULT_FS_FULL_READ_HARD_MAX_BYTES >= DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES);
}

#[test]
fn binary_detector_accepts_plain_text() {
    assert!(!is_likely_binary("workspace".as_bytes()));
}

#[test]
fn binary_detector_rejects_nul_bytes() {
    assert!(is_likely_binary(&[0, 159, 146, 150]));
}
