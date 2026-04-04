// crates/vb-terminal-core/tests/scrollback_tests.rs

use vb_terminal_core::ScrollbackStore;

#[test]
fn test_scrollback_push_and_extract() {
    let mut store = ScrollbackStore::new(100);

    // Push some data
    store.push(b"line1\n".as_slice());
    store.push(b"line2\n".as_slice());

    // Extract all
    let content = store.extract_all();
    let text = String::from_utf8_lossy(&content);

    assert!(text.contains("line1"));
    assert!(text.contains("line2"));
}

#[test]
fn test_scrollback_ring_overflow() {
    let mut store = ScrollbackStore::new(10); // Very small buffer

    // Push more than capacity
    store.push(b"1234567890".as_slice()); // 10 bytes
    store.push(b"ABCDE".as_slice()); // 5 more, should wrap

    let content = store.extract_all();
    assert_eq!(content.len(), 10);
}

#[test]
fn test_scrollback_line_count() {
    let mut store = ScrollbackStore::new(1024);

    store.push(b"line1\nline2\nline3\n".as_slice());

    assert_eq!(store.total_lines(), 3);
}