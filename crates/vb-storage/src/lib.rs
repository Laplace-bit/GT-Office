mod agent_repository;
mod sqlite;

pub use agent_repository::SqliteAgentRepository;
pub use sqlite::{SqliteStorage, StorageError};

pub fn module_name() -> &'static str {
    "vb-storage"
}
