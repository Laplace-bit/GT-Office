use gt_daemon::fileio::FileService;
use gt_daemon::protocol::ListDirRequest;

#[test]
fn list_dir_paginates() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir(tmp.path().join("b-dir")).expect("mkdir");
    std::fs::write(tmp.path().join("a-file.txt"), b"1").expect("write");
    std::fs::write(tmp.path().join("c-file.txt"), b"1").expect("write");

    let svc = FileService;
    let page1 = svc
        .list_dir(&ListDirRequest {
            workspace_root: tmp.path().to_string_lossy().to_string(),
            rel_path: ".".to_string(),
            cursor: Some(0),
            limit: Some(2),
            include_hidden: Some(true),
        })
        .expect("page1");

    assert_eq!(page1.entries.len(), 2);
    assert!(page1.entries[0].is_dir);
    assert!(page1.next_cursor.is_some());

    let page2 = svc
        .list_dir(&ListDirRequest {
            workspace_root: tmp.path().to_string_lossy().to_string(),
            rel_path: ".".to_string(),
            cursor: page1.next_cursor,
            limit: Some(2),
            include_hidden: Some(true),
        })
        .expect("page2");

    assert_eq!(page2.entries.len(), 1);
    assert!(page2.next_cursor.is_none());
}
