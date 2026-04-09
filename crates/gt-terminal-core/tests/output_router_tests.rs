// crates/gt-terminal-core/tests/output_router_tests.rs

use gt_terminal_core::{OutputRouter, OutputRouterConfig, SessionVisibility};

#[test]
fn test_router_dispatch_active() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Active);

    // Dispatch output
    router.dispatch_output("session-1", b"test output".as_slice());

    // Should have batched output
    let batches = router.flush_active_batches();
    assert_eq!(batches.len(), 1);
    assert!(batches[0].1.contains(&b't'));
}

#[test]
fn test_router_dispatch_hidden() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-2", 24, 80);
    router.set_visibility("session-2", SessionVisibility::Hidden);

    router.dispatch_output("session-2", b"hidden output".as_slice());

    // No batches for hidden session
    let batches = router.flush_active_batches();
    assert!(batches.is_empty());
}

#[test]
fn test_router_activate_session() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.register_session("session-2", 24, 80);

    // Activate first session
    router.set_visibility("session-1", SessionVisibility::Active);
    router.dispatch_output("session-1", b"hello".as_slice());

    // Activate second session - should switch
    let screen = router.activate_session("session-2");
    assert!(screen.is_some());

    // First session should now be visible, not active
    router.dispatch_output("session-1", b"more".as_slice());
    let batches = router.flush_active_batches();
    assert!(batches.is_empty()); // session-1 is no longer active
}

#[test]
fn test_router_visibility_transitions() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);

    // Default is Hidden
    router.dispatch_output("session-1", b"hidden".as_slice());
    assert!(router.flush_active_batches().is_empty());

    // Set to Visible
    router.set_visibility("session-1", SessionVisibility::Visible);
    router.dispatch_output("session-1", b"visible".as_slice());
    assert!(router.flush_active_batches().is_empty()); // Visible doesn't batch

    // Set to Active
    router.set_visibility("session-1", SessionVisibility::Active);
    router.dispatch_output("session-1", b"active".as_slice());
    let batches = router.flush_active_batches();
    assert_eq!(batches.len(), 1);
}

#[test]
fn test_router_unregister_session() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Active);
    router.dispatch_output("session-1", b"data".as_slice());

    // Unregister should remove session
    router.unregister_session("session-1");

    // Should not find session
    assert!(router.get_session_visibility("session-1").is_none());
}

#[test]
fn test_router_multiple_active_batches() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Active);

    // Multiple dispatches should accumulate
    router.dispatch_output("session-1", b"first".as_slice());
    router.dispatch_output("session-1", b"second".as_slice());
    router.dispatch_output("session-1", b"third".as_slice());

    let batches = router.flush_active_batches();
    assert_eq!(batches.len(), 1);
    // Should contain all outputs concatenated
    let output = &batches[0].1;
    assert!(output.windows(5).any(|w| w == b"first"));
    assert!(output.windows(6).any(|w| w == b"second"));
    assert!(output.windows(5).any(|w| w == b"third"));
}

#[test]
fn test_router_get_unread_bytes() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Visible);

    router.dispatch_output("session-1", b"some data".as_slice());

    // Visible sessions should track unread bytes
    let unread = router.get_unread_bytes("session-1");
    assert!(unread.is_some());
    assert_eq!(unread.unwrap(), b"some data".len() as u64);
}

#[test]
fn test_router_clear_unread_bytes() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Visible);
    router.dispatch_output("session-1", b"data".as_slice());

    assert!(router.get_unread_bytes("session-1").unwrap() > 0);

    router.clear_unread_bytes("session-1");

    assert_eq!(router.get_unread_bytes("session-1").unwrap(), 0);
}

#[test]
fn test_router_get_rendered_screen() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);

    router.register_session("session-1", 24, 80);
    router.dispatch_output("session-1", b"hello world".as_slice());

    let screen = router.get_rendered_screen("session-1");
    assert!(screen.is_some());
    let screen = screen.unwrap();
    assert_eq!(screen.session_id, "session-1");
    assert_eq!(screen.cols, 80);
    assert_eq!(screen.rows, 24);
}
