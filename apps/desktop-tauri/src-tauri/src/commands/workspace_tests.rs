use super::{
    build_window_active_response, build_workspace_close_response, build_workspace_open_response,
    build_workspace_restore_response, build_workspace_switch_response,
};
use serde_json::json;
use vb_abstractions::WorkspaceSessionSnapshot;

#[test]
fn window_active_response_contains_workspace_id() {
    let payload = build_window_active_response("main", Some("ws-1".to_string()));
    assert_eq!(payload["windowLabel"], "main");
    assert_eq!(payload["workspaceId"], "ws-1");
}

#[test]
fn window_active_response_uses_null_when_unbound() {
    let payload = build_window_active_response("main", None);
    assert_eq!(payload["windowLabel"], "main");
    assert!(payload["workspaceId"].is_null());
}

#[test]
fn workspace_open_response_keeps_contract_fields() {
    let payload = build_workspace_open_response("ws-1", "repo", "/tmp/repo");
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["name"], "repo");
    assert_eq!(payload["root"], "/tmp/repo");
}

#[test]
fn workspace_close_response_keeps_contract_fields() {
    let payload = build_workspace_close_response("ws-1", true);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["closed"], true);
}

#[test]
fn workspace_restore_response_keeps_contract_fields() {
    let payload = build_workspace_restore_response(
        "ws-1",
        &WorkspaceSessionSnapshot {
            windows: vec![json!({"id":"w1"})],
            tabs: vec![json!({"id":"t1"})],
            terminals: vec![json!({"id":"p1"})],
        },
    );
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["windows"][0]["id"], "w1");
    assert_eq!(payload["tabs"][0]["id"], "t1");
    assert_eq!(payload["terminals"][0]["id"], "p1");
}

#[test]
fn workspace_switch_response_keeps_contract_fields() {
    let payload = build_workspace_switch_response("ws-2");
    assert_eq!(payload["activeWorkspaceId"], "ws-2");
}
