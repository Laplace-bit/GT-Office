use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
use tracing::warn;

use crate::{
    app_state::AppState,
    channel_adapter_runtime,
    commands::tool_adapter,
    connectors,
    local_bridge,
};

static STARTED: AtomicBool = AtomicBool::new(false);

pub fn spawn_deferred_startup_services(app: &AppHandle, state: &AppState) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = app.clone();
    let startup_state = state.clone();

    std::thread::spawn(move || {
        if let Err(error) =
            tool_adapter::restore_persisted_channel_state(&app_handle, &startup_state)
        {
            warn!(error = %error, "restore persisted channel state failed");
        }
        local_bridge::spawn(app_handle.clone(), startup_state.clone());
        channel_adapter_runtime::spawn(app_handle.clone(), startup_state.clone());
        connectors::feishu::websocket::spawn_supervisor(app_handle.clone(), startup_state.clone());
        connectors::telegram::spawn_polling_worker(app_handle.clone(), startup_state.clone());
        connectors::wechat::spawn_polling_supervisor(app_handle.clone(), startup_state.clone());
        tool_adapter::spawn_external_reply_flush_worker(app_handle, startup_state);
    });
}
