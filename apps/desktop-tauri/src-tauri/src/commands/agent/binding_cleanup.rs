use gt_task::{ChannelRouteBinding, TaskService};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DirectBindingCleanupMode {
    Rebind { replacement_agent_id: String },
    Disable,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectBindingCleanupResult {
    pub matched_count: usize,
    pub updated_count: usize,
    pub deleted_count: usize,
    pub disabled_count: usize,
    pub rebound_to_agent_id: Option<String>,
}

pub(crate) fn collect_direct_agent_binding_dependencies(
    task_service: &TaskService,
    workspace_id: &str,
    agent_id: &str,
) -> Vec<ChannelRouteBinding> {
    task_service
        .list_route_bindings(Some(workspace_id))
        .into_iter()
        .filter(|binding| {
            !binding.target_agent_id.trim().is_empty()
                && !binding.target_agent_id.starts_with("role:")
                && binding.target_agent_id == agent_id
        })
        .collect()
}

pub(crate) fn apply_direct_agent_binding_cleanup(
    task_service: &TaskService,
    workspace_id: &str,
    agent_id: &str,
    mode: DirectBindingCleanupMode,
) -> Result<DirectBindingCleanupResult, String> {
    let dependencies =
        collect_direct_agent_binding_dependencies(task_service, workspace_id, agent_id);
    let matched_count = dependencies.len();
    let mut result = DirectBindingCleanupResult {
        matched_count,
        updated_count: 0,
        deleted_count: 0,
        disabled_count: 0,
        rebound_to_agent_id: None,
    };

    for binding in dependencies {
        match &mode {
            DirectBindingCleanupMode::Rebind {
                replacement_agent_id,
            } => {
                let mut updated = binding.clone();
                updated.target_agent_id = replacement_agent_id.trim().to_string();
                updated.enabled = true;
                task_service.upsert_route_binding(updated);
                result.updated_count += 1;
                result.rebound_to_agent_id = Some(replacement_agent_id.trim().to_string());
            }
            DirectBindingCleanupMode::Disable => {
                let mut updated = binding.clone();
                updated.enabled = false;
                task_service.upsert_route_binding(updated);
                result.updated_count += 1;
                result.disabled_count += 1;
            }
            DirectBindingCleanupMode::Delete => {
                if task_service.delete_route_binding(binding) {
                    result.deleted_count += 1;
                }
            }
        }
    }

    Ok(result)
}
