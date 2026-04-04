// crates/vb-terminal-core/tests/vt_engine_tests.rs

use vb_terminal_core::VtEngine;

#[test]
fn test_vt_engine_process_text() {
    let mut engine = VtEngine::new(24, 80);

    engine.process(b"Hello, World!");

    let screen = engine.rendered_screen("test-session".to_string());
    // The content should contain "Hello"
    assert!(String::from_utf8_lossy(&screen.content).contains("Hello"));
}

#[test]
fn test_vt_engine_resize() {
    let mut engine = VtEngine::new(24, 80);

    engine.process(b"Test content");
    engine.resize(40, 120);

    let screen = engine.rendered_screen("test".to_string());
    assert_eq!(screen.cols, 120);
    assert_eq!(screen.rows, 40);
}

#[test]
fn test_vt_engine_cursor_position() {
    let mut engine = VtEngine::new(24, 80);

    engine.process(b"ABC");

    let screen = engine.rendered_screen("test".to_string());
    // Cursor should be after "ABC" at column 3
    assert_eq!(screen.cursor_col, 3);
    assert_eq!(screen.cursor_row, 0);
}