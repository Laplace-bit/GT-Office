use serde_json::{json, Value};

#[tauri::command]
pub fn security_health() -> Result<Value, String> {
    Ok(json!({ "ok": true, "policy": "workspace_scoped" }))
}

#[cfg(test)]
#[path = "tests/security_tests.rs"]
mod tests;
