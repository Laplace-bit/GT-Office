use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window};
use uuid::Uuid;

use crate::app_state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceDetachedStationPayload {
    station_id: String,
    name: String,
    role: String,
    tool: String,
    agent_workdir_rel: String,
    role_workdir_rel: Option<String>,
    workspace_id: String,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceDetachedCustomLayoutPayload {
    columns: u8,
    rows: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceOpenDetachedWindowPayload {
    workspace_id: String,
    container_id: String,
    title: String,
    active_station_id: Option<String>,
    layout_mode: Option<String>,
    custom_layout: Option<SurfaceDetachedCustomLayoutPayload>,
    topmost: Option<bool>,
    stations: Vec<SurfaceDetachedStationPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceDetachedWindowQueryPayload {
    window_label: String,
    container_id: String,
    workspace_id: String,
    title: String,
    active_station_id: Option<String>,
    layout_mode: Option<String>,
    custom_layout: Option<SurfaceDetachedCustomLayoutPayload>,
    topmost: bool,
    stations: Vec<SurfaceDetachedStationPayload>,
}

fn sanitized_window_label(seed: &str) -> String {
    let sanitized = seed
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let fallback = if sanitized.is_empty() {
        "surface".to_string()
    } else {
        sanitized
    };
    let suffix = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    format!("surface-{fallback}-{suffix}")
}

fn build_detached_window_url(
    query_payload: &SurfaceDetachedWindowQueryPayload,
) -> Result<WebviewUrl, String> {
    let raw = serde_json::to_vec(query_payload)
        .map_err(|error| format!("SURFACE_PAYLOAD_SERIALIZE_FAILED: {error}"))?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
    Ok(WebviewUrl::App(
        format!("index.html?surface=detached&payload={encoded}").into(),
    ))
}

fn resolve_window(
    window_label: Option<String>,
    window: &Window,
) -> Result<(tauri::AppHandle, tauri::WebviewWindow), String> {
    let app: tauri::AppHandle = window.app_handle().clone();
    if let Some(label) = window_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
        let target = app
            .get_webview_window(label)
            .ok_or_else(|| format!("SURFACE_WINDOW_NOT_FOUND: window '{label}' is unavailable"))?;
        return Ok((app, target));
    }

    let current = app
        .get_webview_window(window.label())
        .ok_or_else(|| "SURFACE_WINDOW_NOT_FOUND: current window is unavailable".to_string())?;
    Ok((app, current))
}

fn emit_surface_window_updated(
    app: &tauri::AppHandle,
    window_label: &str,
    topmost: bool,
) -> Result<(), String> {
    app.emit(
        "surface/window_updated",
        json!({
            "windowLabel": window_label,
            "topmost": topmost,
        }),
    )
    .map_err(|error| format!("SURFACE_EVENT_EMIT_FAILED: {error}"))
}

#[tauri::command]
pub fn surface_open_detached_window(
    payload: SurfaceOpenDetachedWindowPayload,
    state: State<'_, AppState>,
    window: Window,
) -> Result<serde_json::Value, String> {
    let workspace_id = payload.workspace_id.trim();
    let container_id = payload.container_id.trim();
    if workspace_id.is_empty() {
        return Err("SURFACE_INVALID_PARAMS: workspaceId is required".to_string());
    }
    if container_id.is_empty() {
        return Err("SURFACE_INVALID_PARAMS: containerId is required".to_string());
    }
    if payload.stations.is_empty() {
        return Err("SURFACE_INVALID_PARAMS: stations are required".to_string());
    }

    let app = window.app_handle();
    let window_label = sanitized_window_label(container_id);
    let topmost = payload.topmost.unwrap_or(false);
    let query_payload = SurfaceDetachedWindowQueryPayload {
        window_label: window_label.clone(),
        container_id: container_id.to_string(),
        workspace_id: workspace_id.to_string(),
        title: payload.title.trim().to_string(),
        active_station_id: payload.active_station_id,
        layout_mode: payload.layout_mode,
        custom_layout: payload.custom_layout,
        topmost,
        stations: payload.stations,
    };

    let surface_window_builder = WebviewWindowBuilder::new(
        app,
        &window_label,
        build_detached_window_url(&query_payload)?,
    )
    .title(if query_payload.title.trim().is_empty() {
        "GT Office Surface"
    } else {
        query_payload.title.as_str()
    })
    .inner_size(1180.0, 780.0)
    .min_inner_size(720.0, 520.0)
    .resizable(true)
    .decorations(true)
    .shadow(true)
    .accept_first_mouse(true)
    .always_on_top(topmost);

    #[cfg(target_os = "macos")]
    let surface_window_builder = surface_window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let surface_window = surface_window_builder
        .build()
        .map_err(|error| format!("SURFACE_WINDOW_CREATE_FAILED: {error}"))?;

    state.bind_window_workspace(&window_label, workspace_id)?;
    emit_surface_window_updated(app, &window_label, topmost)?;

    let app_handle = app.clone();
    let state_handle = state.inner().clone();
    let close_window_label = window_label.clone();
    surface_window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = state_handle.clear_window_workspace(&close_window_label);
            let _ = app_handle.emit(
                "surface/window_closed",
                json!({
                    "windowLabel": close_window_label,
                }),
            );
        }
    });

    Ok(json!({
        "windowLabel": window_label,
        "created": true,
    }))
}

#[tauri::command]
pub fn surface_close_window(
    window_label: Option<String>,
    window: Window,
) -> Result<serde_json::Value, String> {
    let (_, target) = resolve_window(window_label, &window)?;
    let target_label = target.label().to_string();
    target
        .close()
        .map_err(|error| format!("SURFACE_WINDOW_CLOSE_FAILED: {error}"))?;
    Ok(json!({
        "windowLabel": target_label,
        "closed": true,
    }))
}

#[tauri::command]
pub fn surface_set_window_topmost(
    window_label: Option<String>,
    topmost: bool,
    window: Window,
) -> Result<serde_json::Value, String> {
    let (app, target) = resolve_window(window_label, &window)?;
    let target_label = target.label().to_string();
    target
        .set_always_on_top(topmost)
        .map_err(|error| format!("SURFACE_WINDOW_TOPMOST_FAILED: {error}"))?;
    emit_surface_window_updated(&app, &target_label, topmost)?;
    Ok(json!({
        "windowLabel": target_label,
        "topmost": topmost,
        "updated": true,
    }))
}

#[tauri::command]
pub fn surface_start_window_dragging(
    window_label: Option<String>,
    window: Window,
) -> Result<serde_json::Value, String> {
    let (_, target) = resolve_window(window_label, &window)?;
    let target_label = target.label().to_string();
    target
        .start_dragging()
        .map_err(|error| format!("SURFACE_WINDOW_DRAG_FAILED: {error}"))?;
    Ok(json!({
        "windowLabel": target_label,
        "started": true,
    }))
}

#[tauri::command]
pub fn surface_bridge_post(
    target_window_label: String,
    payload: Value,
    window: Window,
) -> Result<serde_json::Value, String> {
    let target_label = target_window_label.trim();
    if target_label.is_empty() {
        return Err("SURFACE_INVALID_PARAMS: targetWindowLabel is required".to_string());
    }
    let app: tauri::AppHandle = window.app_handle().clone();
    app.get_webview_window(target_label).ok_or_else(|| {
        format!("SURFACE_WINDOW_NOT_FOUND: window '{target_label}' is unavailable")
    })?;
    app.emit_to(
        target_label,
        "surface/bridge",
        json!({
            "sourceWindowLabel": window.label(),
            "targetWindowLabel": target_label,
            "payload": payload,
        }),
    )
    .map_err(|error| format!("SURFACE_BRIDGE_EMIT_FAILED: {error}"))?;
    Ok(json!({
        "accepted": true,
        "targetWindowLabel": target_label,
    }))
}
