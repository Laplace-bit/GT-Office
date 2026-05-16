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

#[cfg(test)]
mod tests {
    use super::{keymap_list, keymap_reset, keymap_update_binding};

    #[test]
    fn keymap_list_returns_empty_bindings_for_workspace() {
        let payload = keymap_list(Some("ws-1".to_string())).expect("keymap list");

        assert_eq!(payload["workspaceId"], "ws-1");
        assert!(payload["bindings"].as_array().expect("bindings").is_empty());
    }

    #[test]
    fn keymap_update_binding_returns_saved_contract() {
        let payload = keymap_update_binding(
            "workspace".to_string(),
            "terminal.submit".to_string(),
            "Cmd+Enter".to_string(),
        )
        .expect("keymap update");

        assert_eq!(payload["scope"], "workspace");
        assert_eq!(payload["commandId"], "terminal.submit");
        assert_eq!(payload["keystroke"], "Cmd+Enter");
        assert_eq!(payload["saved"], true);
        assert!(payload["conflicts"]
            .as_array()
            .expect("conflicts")
            .is_empty());
    }

    #[test]
    fn keymap_reset_can_reset_scope_or_single_command() {
        let scope_reset = keymap_reset("global".to_string(), None).expect("scope reset");
        assert_eq!(scope_reset["scope"], "global");
        assert!(scope_reset["commandId"].is_null());
        assert_eq!(scope_reset["reset"], true);

        let command_reset =
            keymap_reset("workspace".to_string(), Some("terminal.submit".to_string()))
                .expect("command reset");
        assert_eq!(command_reset["scope"], "workspace");
        assert_eq!(command_reset["commandId"], "terminal.submit");
        assert_eq!(command_reset["reset"], true);
    }
}
