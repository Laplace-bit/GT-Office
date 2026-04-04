// crates/vb-terminal-core/tests/integration_tests.rs

use vb_terminal_core::{OutputRouter, SessionVisibility, OutputRouterConfig};

#[test]
fn test_full_session_lifecycle() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    // Register session
    router.register_session("test-session", 24, 80);
    assert!(router.get_session_visibility("test-session").is_some());

    // Set active
    router.set_visibility("test-session", SessionVisibility::Active);

    // Process output
    router.dispatch_output("test-session", b"$ echo hello\n".as_slice());
    router.dispatch_output("test-session", b"hello\n".as_slice());

    // Flush batch
    let batches = router.flush_active_batches();
    assert!(!batches.is_empty());

    // Get rendered screen
    router.activate_session("test-session");
    let screen = router.get_rendered_screen("test-session").unwrap();
    assert!(screen.content.len() > 0);

    // Deactivate
    router.set_visibility("test-session", SessionVisibility::Hidden);
    router.dispatch_output("test-session", b"more output\n".as_slice());

    // Hidden session should not produce batches
    let batches = router.flush_active_batches();
    assert!(batches.is_empty());

    // Cleanup
    router.unregister_session("test-session");
    assert!(router.get_session_visibility("test-session").is_none());
}

#[test]
fn test_multiple_sessions_visibility_switching() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    // Register 3 sessions
    router.register_session("session-1", 24, 80);
    router.register_session("session-2", 24, 80);
    router.register_session("session-3", 24, 80);

    // Activate session-1
    router.activate_session("session-1");
    assert!(router.get_session_visibility("session-1") == Some(SessionVisibility::Active));

    // Switch to session-2
    router.activate_session("session-2");
    assert!(router.get_session_visibility("session-2") == Some(SessionVisibility::Active));
    assert!(router.get_session_visibility("session-1") == Some(SessionVisibility::Visible));

    // Output to active session-2
    router.dispatch_output("session-2", b"test".as_slice());
    let batches = router.flush_active_batches();
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].0, "session-2");
}

#[test]
fn test_visibility_state_transitions() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session", 24, 80);

    // Hidden by default
    assert!(router.get_session_visibility("session") == Some(SessionVisibility::Hidden));

    // Transition to Visible
    router.set_visibility("session", SessionVisibility::Visible);
    assert!(router.get_session_visibility("session") == Some(SessionVisibility::Visible));

    // Transition to Active
    router.set_visibility("session", SessionVisibility::Active);
    assert!(router.get_session_visibility("session") == Some(SessionVisibility::Active));

    // Transition back to Hidden
    router.set_visibility("session", SessionVisibility::Hidden);
    assert!(router.get_session_visibility("session") == Some(SessionVisibility::Hidden));
}