use serde_json::{json, Value};

#[tauri::command]
pub fn keymap_list(workspace_id: Option<String>) -> Result<Value, String> {
    Ok(json!({ "workspaceId": workspace_id, "bindings": [] }))
}

#[tauri::command]
pub fn keymap_update_binding(
    scope: String,
    command_id: String,
    keystroke: String,
) -> Result<Value, String> {
    Ok(json!({
        "scope": scope,
        "commandId": command_id,
        "keystroke": keystroke,
        "saved": true,
        "conflicts": []
    }))
}

#[tauri::command]
pub fn keymap_reset(scope: String, command_id: Option<String>) -> Result<Value, String> {
    Ok(json!({ "scope": scope, "commandId": command_id, "reset": true }))
}
