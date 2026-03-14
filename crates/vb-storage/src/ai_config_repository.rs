use crate::sqlite::SqliteStorage;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AiConfigRepositoryError {
    #[error("ai config storage error: {message}")]
    Storage { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigAuditLogInput {
    pub audit_id: String,
    pub workspace_id: String,
    pub agent: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub changed_keys_json: String,
    pub secret_refs_json: String,
    pub confirmed_by: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SqliteAiConfigRepository {
    storage: SqliteStorage,
}

impl SqliteAiConfigRepository {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    fn connection(&self) -> Result<rusqlite::Connection, AiConfigRepositoryError> {
        self.storage
            .open_connection()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })
    }

    pub fn ensure_schema(&self) -> Result<(), AiConfigRepositoryError> {
        let conn = self.connection()?;
        conn.execute_batch(AI_CONFIG_SCHEMA)
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        Ok(())
    }

    pub fn insert_audit_log(
        &self,
        input: &AiConfigAuditLogInput,
    ) -> Result<(), AiConfigRepositoryError> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT INTO ai_config_audit_logs (
                audit_id,
                workspace_id,
                agent,
                mode,
                provider_id,
                changed_keys_json,
                secret_refs_json,
                confirmed_by,
                created_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.audit_id,
                input.workspace_id,
                input.agent,
                input.mode,
                input.provider_id,
                input.changed_keys_json,
                input.secret_refs_json,
                input.confirmed_by,
                input.created_at_ms,
            ],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;
        Ok(())
    }
}

const AI_CONFIG_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS ai_config_audit_logs (
  audit_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_id TEXT,
  changed_keys_json TEXT NOT NULL,
  secret_refs_json TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_config_audit_logs_workspace_created
  ON ai_config_audit_logs(workspace_id, created_at_ms DESC);
"#;
