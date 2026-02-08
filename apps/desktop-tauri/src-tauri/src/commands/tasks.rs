use serde_json::{json, Value};

#[tauri::command]
pub fn task_list(scope: Option<String>) -> Result<Value, String> {
    Ok(json!({ "scope": scope.unwrap_or_else(|| "global".to_string()), "tasks": [] }))
}

#[tauri::command]
pub fn changefeed_query(
    workspace_id: String,
    session_id: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": workspace_id,
        "sessionId": session_id,
        "limit": limit.unwrap_or(100),
        "events": []
    }))
}
