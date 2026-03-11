use crate::{AgentProfile, AgentRole, AgentState, OrganizationDepartment, RoleStatus};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
    #[error("storage error: {message}")]
    Storage { message: String },
}

pub type AgentResult<T> = Result<T, AgentError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentInput {
    pub workspace_id: String,
    pub agent_id: Option<String>,
    pub name: String,
    pub role_id: String,
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    pub employee_no: Option<String>,
    pub state: AgentState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentInput {
    pub workspace_id: String,
    pub agent_id: String,
    pub name: String,
    pub role_id: String,
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    pub employee_no: Option<String>,
    pub state: AgentState,
}

pub trait AgentRepository: Send + Sync {
    fn ensure_schema(&self) -> AgentResult<()>;
    fn seed_defaults(&self, workspace_id: &str) -> AgentResult<()>;
    fn list_departments(&self, workspace_id: &str) -> AgentResult<Vec<OrganizationDepartment>>;
    fn list_roles(&self, workspace_id: &str) -> AgentResult<Vec<AgentRole>>;
    fn list_agents(&self, workspace_id: &str) -> AgentResult<Vec<AgentProfile>>;
    fn create_agent(&self, input: CreateAgentInput) -> AgentResult<AgentProfile>;
    fn update_agent(&self, input: UpdateAgentInput) -> AgentResult<AgentProfile>;
    fn delete_agent(&self, workspace_id: &str, agent_id: &str) -> AgentResult<bool>;
    fn upsert_role(&self, workspace_id: &str, role: AgentRole) -> AgentResult<AgentRole>;
    fn set_role_status(
        &self,
        workspace_id: &str,
        role_id: &str,
        status: RoleStatus,
    ) -> AgentResult<bool>;
}
