use serde_json::{json, Value};

#[tauri::command]
pub fn tool_list_profiles(workspace_id: String) -> Result<Value, String> {
    Ok(json!({ "workspaceId": workspace_id, "profiles": [] }))
}

#[tauri::command]
pub fn tool_launch(
    workspace_id: String,
    profile_id: String,
    context: Option<Value>,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "profileId": profile_id,
        "context": context,
        "toolSessionId": "tool-session-stub",
        "terminalSessionId": "term-session-stub"
    }))
}

#[tauri::command]
pub fn tool_validate_profile(profile: Value) -> Result<Value, String> {
    Ok(json!({ "profile": profile, "valid": true, "warnings": [] }))
}
