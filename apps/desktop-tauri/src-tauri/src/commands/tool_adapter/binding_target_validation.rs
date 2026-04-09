use gt_agent::AgentRepository;
use gt_storage::SqliteAgentRepository;

pub(crate) fn validate_binding_target_selector(
    repo: &SqliteAgentRepository,
    workspace_id: &str,
    target_selector: &str,
) -> Result<(), String> {
    let target_selector = target_selector.trim();
    if target_selector.is_empty() {
        return Err("CHANNEL_BINDING_TARGET_INVALID: target selector is required".to_string());
    }
    if target_selector.starts_with("role:") {
        return Ok(());
    }

    let exists = repo
        .list_agents(workspace_id)
        .map_err(|error| format!("CHANNEL_BINDING_TARGET_INVALID: {error}"))?
        .into_iter()
        .any(|agent| agent.id == target_selector);
    if exists {
        Ok(())
    } else {
        Err(format!(
            "CHANNEL_TARGET_NOT_AVAILABLE: direct target '{}' was not found in workspace '{}'",
            target_selector, workspace_id
        ))
    }
}
