use serde_json::{json, Value};

#[tauri::command]
pub fn ai_config_read_snapshot(
    workspace_id: String,
    allow: Option<String>,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "allow": allow.unwrap_or_else(|| "strict".to_string()),
        "snapshot": {},
        "masking": []
    }))
}

#[tauri::command]
pub fn ai_config_preview_patch(
    workspace_id: String,
    scope: String,
    patch: Value,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "scope": scope,
        "patch": patch,
        "allowed": true,
        "diff": {},
        "warnings": []
    }))
}

#[tauri::command]
pub fn ai_config_apply_patch(
    workspace_id: String,
    preview_id: String,
    confirmed_by: String,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "previewId": preview_id,
        "confirmedBy": confirmed_by,
        "applied": true,
        "auditId": "audit-stub"
    }))
}
