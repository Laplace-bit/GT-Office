use crate::{AgentProfile, AgentScope, AgentState};
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
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    #[serde(default)]
    pub scope: AgentScope,
    pub employee_no: Option<String>,
    pub state: AgentState,
    pub launch_command: Option<String>,
    pub order_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentInput {
    pub workspace_id: String,
    pub agent_id: String,
    pub name: String,
    pub tool: String,
    pub workdir: Option<String>,
    pub custom_workdir: bool,
    pub employee_no: Option<String>,
    pub state: AgentState,
    pub launch_command: Option<String>,
}

pub trait AgentRepository: Send + Sync {
    fn ensure_schema(&self) -> AgentResult<()>;
    fn reset_workspace_state(&self, workspace_id: &str) -> AgentResult<()>;
    fn list_agents(&self, workspace_id: &str) -> AgentResult<Vec<AgentProfile>>;
    fn create_agent(&self, input: CreateAgentInput) -> AgentResult<AgentProfile>;
    fn update_agent(&self, input: UpdateAgentInput) -> AgentResult<AgentProfile>;
    fn delete_agent(&self, workspace_id: &str, agent_id: &str) -> AgentResult<bool>;
    fn reorder_agents(&self, workspace_id: &str, ordered_ids: Vec<String>) -> AgentResult<()>;
}
