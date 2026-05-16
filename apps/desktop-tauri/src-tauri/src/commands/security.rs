use serde_json::{json, Value};

#[tauri::command]
pub fn security_health() -> Result<Value, String> {
    Ok(json!({ "ok": true, "policy": "workspace_scoped" }))
}

#[cfg(test)]
mod tests {
    use super::security_health;

    #[test]
    fn security_health_reports_workspace_scoped_policy() {
        let payload = security_health().expect("security health");

        assert_eq!(payload["ok"], true);
        assert_eq!(payload["policy"], "workspace_scoped");
    }
}
