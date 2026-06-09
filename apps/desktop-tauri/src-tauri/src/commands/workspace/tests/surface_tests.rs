use crate::commands::workspace::surface::{
    build_detached_window_url, build_workspace_window_url, sanitized_window_label,
    sanitized_workspace_window_label, workspace_window_title, SurfaceDetachedCustomLayoutPayload,
    SurfaceDetachedStationPayload, SurfaceDetachedWindowQueryPayload,
};
use base64::Engine;
use serde_json::Value;
use std::path::Path;
use tauri::WebviewUrl;

#[test]
fn surface_window_labels_are_sanitized_with_fallbacks() {
    assert_eq!(
        sanitized_window_label("deck:alpha/01"),
        "surface-deck-alpha-01"
    );
    assert_eq!(sanitized_window_label(" --- "), "surface-surface");
    assert_eq!(
        sanitized_workspace_window_label("workspace:alpha/01"),
        "workspace-workspace-alpha-01"
    );
    assert_eq!(
        sanitized_workspace_window_label("  "),
        "workspace-workspace"
    );
}

#[test]
fn workspace_window_title_uses_root_basename_or_workspace_id() {
    assert_eq!(
        workspace_window_title(Path::new("/tmp/GT Office"), "ws-1"),
        "GT Office"
    );
    assert_eq!(workspace_window_title(Path::new("/"), "ws-root"), "ws-root");
}

#[test]
fn workspace_window_url_carries_workspace_query() {
    let url = build_workspace_window_url("ws-1");
    match url {
        WebviewUrl::App(path) => {
            assert_eq!(path.to_string_lossy(), "index.html?workspace=ws-1")
        }
        other => panic!("unexpected url: {other:?}"),
    }
}

#[test]
fn detached_window_url_encodes_query_payload_as_url_safe_base64() {
    let station = SurfaceDetachedStationPayload {
        station_id: "agent-1".to_string(),
        name: "Analyst".to_string(),
        role: "analyst".to_string(),
        tool: "codex".to_string(),
        agent_workdir_rel: ".gtoffice/agent-1".to_string(),
        role_workdir_rel: Some(".gtoffice/roles/analyst".to_string()),
        workspace_id: "ws-1".to_string(),
        session_id: Some("session-1".to_string()),
    };
    let query = SurfaceDetachedWindowQueryPayload {
        window_label: "surface-deck".to_string(),
        container_id: "deck".to_string(),
        workspace_id: "ws-1".to_string(),
        title: "Ops Deck".to_string(),
        active_station_id: Some("agent-1".to_string()),
        fullscreen_station_id: Some("agent-1".to_string()),
        minimized_station_ids: Some(vec!["agent-1".to_string()]),
        layout_mode: Some("grid".to_string()),
        custom_layout: Some(SurfaceDetachedCustomLayoutPayload {
            columns: 2,
            rows: 1,
        }),
        topmost: true,
        stations: vec![station],
    };

    let url = build_detached_window_url(&query).expect("detached url");
    let WebviewUrl::App(path) = url else {
        panic!("unexpected url");
    };
    let raw = path.to_string_lossy();
    let encoded = raw
        .strip_prefix("index.html?surface=detached&payload=")
        .expect("payload prefix");
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .expect("decode payload");
    let payload: Value = serde_json::from_slice(&decoded).expect("payload json");

    assert_eq!(payload["windowLabel"], "surface-deck");
    assert_eq!(payload["containerId"], "deck");
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["title"], "Ops Deck");
    assert_eq!(payload["activeStationId"], "agent-1");
    assert_eq!(payload["fullscreenStationId"], "agent-1");
    assert_eq!(payload["minimizedStationIds"][0], "agent-1");
    assert_eq!(payload["layoutMode"], "grid");
    assert_eq!(payload["customLayout"]["columns"], 2);
    assert_eq!(payload["topmost"], true);
    assert_eq!(payload["stations"][0]["stationId"], "agent-1");
    assert_eq!(payload["stations"][0]["sessionId"], "session-1");
}
