use rfd::FileDialog;
use serde_json::{json, Value};
use tauri::State;

use crate::app_state::AppState;

#[tauri::command]
pub fn system_pick_directory(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = FileDialog::new();
    if let Some(path) = default_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_directory(path);
    }

    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn system_gto_doctor(state: State<'_, AppState>) -> Result<Value, String> {
    let snapshot = state.task_service.doctor_external_snapshot();
    let runtime = crate::channel_adapter_runtime::runtime_snapshot();
    let runtime_running = runtime.is_some();
    let runtime_metrics = runtime.as_ref().map(|item| item.metrics.clone());
    let rate_limited = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.rate_limited)
        .unwrap_or(0);
    let timeout_count = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.timeouts)
        .unwrap_or(0);
    let internal_errors = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.internal_errors)
        .unwrap_or(0);
    let suggestions = vec![
        json!({
            "code": "CHECK_CHANNEL_BINDINGS",
            "message": "Verify channel bindings include workspace_id + target_agent_id for each inbound source.",
        }),
        json!({
            "code": "CHECK_ACCESS_POLICY",
            "message": "Default access policy is pairing. Approve trusted identities before expecting task dispatch.",
        }),
        json!({
            "code": "CHECK_IDEMPOTENCY_WINDOW",
            "message": "If duplicate deliveries appear, inspect idempotency cache entries and upstream message IDs.",
        }),
        json!({
            "code": "CHECK_WEBHOOK_ENDPOINTS",
            "message": "Use channel_adapter_status runtime.feishuWebhook/runtime.telegramWebhook to bind bot webhook callbacks.",
        }),
        json!({
            "code": "CHECK_RUNTIME_METRICS",
            "message": "Inspect runtime.metrics for rate_limited/timeouts/internal_errors before troubleshooting route/access logic.",
        }),
    ];
    Ok(json!({
        "ok": runtime_running,
        "runtime": runtime,
        "runtimeMetrics": runtime_metrics,
        "summary": snapshot,
        "checks": [
            {
                "id": "channel_adapter_runtime",
                "ok": runtime_running,
                "detail": if runtime_running {
                    "webhook adapter runtime is listening"
                } else {
                    "webhook adapter runtime is not ready"
                },
            },
            {
                "id": "external_dispatch_state",
                "ok": true,
                "detail": "external route/access/idempotency state loaded",
            },
            {
                "id": "external_runtime_stability",
                "ok": rate_limited == 0 && timeout_count == 0 && internal_errors == 0,
                "detail": format!(
                    "rate_limited={}, timeouts={}, internal_errors={}",
                    rate_limited, timeout_count, internal_errors
                ),
            }
        ],
        "suggestions": suggestions,
    }))
}
