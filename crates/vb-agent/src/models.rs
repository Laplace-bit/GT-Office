use serde::{Deserialize, Serialize};

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
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
