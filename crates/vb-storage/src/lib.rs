mod agent_repository;
mod ai_config_repository;
mod sqlite;

pub use agent_repository::SqliteAgentRepository;
pub use ai_config_repository::{
    AiConfigAuditLogInput, SavedClaudeProviderInput, SavedClaudeProviderRecord,
    SqliteAiConfigRepository,
};
pub use sqlite::{SqliteStorage, StorageError};

pub fn module_name() -> &'static str {
    "vb-storage"
}
