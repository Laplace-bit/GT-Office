use serde::{Deserialize, Serialize};

pub const GLOBAL_ROLE_WORKSPACE_ID: &str = "__global__";
const DEFAULT_AGENT_WORKDIR_ROOT: &str = ".gtoffice";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Ready,
    Paused,
    Blocked,
    Terminated,
}

impl AgentState {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentState::Ready => "ready",
            AgentState::Paused => "paused",
            AgentState::Blocked => "blocked",
            AgentState::Terminated => "terminated",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "paused" => AgentState::Paused,
            "blocked" => AgentState::Blocked,
            "terminated" => AgentState::Terminated,
            _ => AgentState::Ready,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoleStatus {
    Active,
    Deprecated,
    Disabled,
}

impl RoleStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoleStatus::Active => "active",
            RoleStatus::Deprecated => "deprecated",
            RoleStatus::Disabled => "disabled",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "deprecated" => RoleStatus::Deprecated,
            "disabled" => RoleStatus::Disabled,
            _ => RoleStatus::Active,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRoleScope {
    Global,
    Workspace,
}

impl AgentRoleScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentRoleScope::Global => "global",
            AgentRoleScope::Workspace => "workspace",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "global" => AgentRoleScope::Global,
            _ => AgentRoleScope::Workspace,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationDepartment {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: Option<String>,
    pub order_index: i32,
    pub is_system: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRole {
    pub id: String,
    pub workspace_id: String,
    pub role_key: String,
    pub role_name: String,
    pub department_id: String,
    pub scope: AgentRoleScope,
    pub charter_path: Option<String>,
    pub policy_json: Option<String>,
    pub version: i64,
    pub status: RoleStatus,
    pub is_system: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub role_id: String,
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    pub state: AgentState,
    pub employee_no: Option<String>,
    pub policy_snapshot_id: Option<String>,
    pub prompt_file_name: Option<String>,
    pub prompt_file_relative_path: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

fn normalize_tool_provider_key(tool: &str) -> &'static str {
    let normalized = tool.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        "claude"
    } else if normalized.contains("gemini") {
        "gemini"
    } else {
        "codex"
    }
}

pub fn prompt_file_name_for_tool(tool: &str) -> Option<&'static str> {
    match normalize_tool_provider_key(tool) {
        "claude" => Some("CLAUDE.md"),
        "codex" => Some("AGENTS.md"),
        "gemini" => Some("GEMINI.md"),
        _ => None,
    }
}

pub fn default_prompt_content(agent_name: &str, tool: &str) -> String {
    let file_name = prompt_file_name_for_tool(tool).unwrap_or("AGENTS.md");
    format!(
        "# {agent_name}\n\n这是 {file_name}。\n\n它用于定义这个 Agent 的系统提示词、协作边界和输出偏好。\n你可以直接在这里输入要求；留空时系统会写入这段默认说明。\n"
    )
}

pub fn normalize_agent_slug(value: &str) -> String {
    let lowered = value.trim().to_ascii_lowercase();
    let mut output = String::with_capacity(lowered.len());
    let mut last_was_dash = false;
    for ch in lowered.chars() {
        let allowed =
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-');
        if allowed {
            output.push(ch);
            last_was_dash = false;
            continue;
        }
        if !last_was_dash {
            output.push('-');
            last_was_dash = true;
        }
    }
    let normalized = output.trim_matches('-').to_string();
    if normalized.is_empty() {
        "agent".to_string()
    } else {
        normalized
    }
}

pub fn default_agent_workdir(name: &str) -> String {
    format!(
        "{DEFAULT_AGENT_WORKDIR_ROOT}/{}",
        normalize_agent_slug(name)
    )
}

pub fn prompt_file_relative_path(workdir: &str, tool: &str) -> Option<String> {
    let file_name = prompt_file_name_for_tool(tool)?;
    let normalized_workdir = workdir.trim().trim_matches('/');
    if normalized_workdir.is_empty() {
        return Some(file_name.to_string());
    }
    Some(format!("{normalized_workdir}/{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::{default_agent_workdir, prompt_file_name_for_tool, prompt_file_relative_path};

    #[test]
    fn default_agent_workdir_uses_shallow_gtoffice_root() {
        assert_eq!(
            default_agent_workdir("My Product Agent"),
            ".gtoffice/my-product-agent"
        );
        assert_eq!(default_agent_workdir("  "), ".gtoffice/agent");
    }

    #[test]
    fn prompt_file_metadata_matches_supported_providers() {
        assert_eq!(prompt_file_name_for_tool("claude"), Some("CLAUDE.md"));
        assert_eq!(prompt_file_name_for_tool("codex"), Some("AGENTS.md"));
        assert_eq!(prompt_file_name_for_tool("gemini"), Some("GEMINI.md"));
        assert_eq!(
            prompt_file_relative_path(".gtoffice/alpha", "codex"),
            Some(".gtoffice/alpha/AGENTS.md".to_string())
        );
    }
}
