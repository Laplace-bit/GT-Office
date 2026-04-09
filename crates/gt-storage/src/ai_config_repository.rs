use crate::sqlite::SqliteStorage;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedClaudeProviderInput {
    pub workspace_id: String,
    pub saved_provider_id: Option<String>,
    pub fingerprint: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub auth_scheme: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub settings_json: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_applied_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedClaudeProviderRecord {
    pub saved_provider_id: String,
    pub workspace_id: String,
    pub fingerprint: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub auth_scheme: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub settings_json: Option<String>,
    pub is_active: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_applied_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAiProviderInput {
    pub agent: String,
    pub saved_provider_id: Option<String>,
    pub fingerprint: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub extra_json: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_applied_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAiProviderRecord {
    pub agent: String,
    pub saved_provider_id: String,
    pub fingerprint: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub extra_json: String,
    pub is_active: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_applied_at_ms: i64,
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
        let _ = conn.execute(
            "ALTER TABLE ai_config_saved_claude_providers ADD COLUMN settings_json TEXT",
            [],
        );
        Ok(())
    }

    pub fn reset_workspace_state_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        workspace_id: &str,
    ) -> Result<(), AiConfigRepositoryError> {
        tx.execute(
            "DELETE FROM ai_config_audit_logs WHERE workspace_id = ?1",
            params![workspace_id],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;
        tx.execute(
            "DELETE FROM ai_config_saved_claude_providers WHERE workspace_id = ?1",
            params![workspace_id],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;

        Ok(())
    }

    pub fn reset_workspace_state(&self, workspace_id: &str) -> Result<(), AiConfigRepositoryError> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        self.reset_workspace_state_in_tx(&tx, workspace_id)?;

        tx.commit()
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

    pub fn query_audit_logs(
        &self,
        workspace_id: &str,
        agent: &str,
        limit: usize,
    ) -> Result<Vec<AiConfigAuditLogInput>, AiConfigRepositoryError> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT 
                    audit_id,
                    workspace_id,
                    agent,
                    mode,
                    provider_id,
                    changed_keys_json,
                    secret_refs_json,
                    confirmed_by,
                    created_at_ms
                FROM ai_config_audit_logs
                WHERE workspace_id = ?1 AND agent = ?2
                ORDER BY created_at_ms DESC
                LIMIT ?3",
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let rows = stmt
            .query_map(params![workspace_id, agent, limit], |row| {
                Ok(AiConfigAuditLogInput {
                    audit_id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    agent: row.get(2)?,
                    mode: row.get(3)?,
                    provider_id: row.get(4)?,
                    changed_keys_json: row.get(5)?,
                    secret_refs_json: row.get(6)?,
                    confirmed_by: row.get(7)?,
                    created_at_ms: row.get(8)?,
                })
            })
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(results)
    }

    pub fn upsert_saved_claude_provider(
        &self,
        input: &SavedClaudeProviderInput,
    ) -> Result<SavedClaudeProviderRecord, AiConfigRepositoryError> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let existing_by_fingerprint = tx
            .query_row(
                "SELECT
                    saved_provider_id,
                    workspace_id,
                    fingerprint,
                    mode,
                    provider_id,
                    provider_name,
                    base_url,
                    model,
                    auth_scheme,
                    secret_ref,
                    has_secret,
                    settings_json,
                    is_active,
                    created_at_ms,
                    updated_at_ms,
                    last_applied_at_ms
                 FROM ai_config_saved_claude_providers
                 WHERE workspace_id = ?1 AND fingerprint = ?2",
                params![input.workspace_id, input.fingerprint],
                map_saved_claude_provider_row,
            )
            .optional()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let existing_by_id = input
            .saved_provider_id
            .as_ref()
            .map(|saved_provider_id| {
                tx.query_row(
                    "SELECT
                        saved_provider_id,
                        workspace_id,
                        fingerprint,
                        mode,
                        provider_id,
                        provider_name,
                        base_url,
                        model,
                        auth_scheme,
                        secret_ref,
                        has_secret,
                        settings_json,
                        is_active,
                        created_at_ms,
                        updated_at_ms,
                        last_applied_at_ms
                     FROM ai_config_saved_claude_providers
                     WHERE workspace_id = ?1 AND saved_provider_id = ?2",
                    params![input.workspace_id, saved_provider_id],
                    map_saved_claude_provider_row,
                )
                .optional()
            })
            .transpose()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?
            .flatten();

        tx.execute(
            "UPDATE ai_config_saved_claude_providers
             SET is_active = 0
             WHERE workspace_id = ?1",
            params![input.workspace_id],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;

        let saved_provider_id = input
            .saved_provider_id
            .clone()
            .or_else(|| {
                existing_by_fingerprint
                    .as_ref()
                    .map(|item| item.saved_provider_id.clone())
            })
            .unwrap_or_else(|| format!("claude-provider:{}", Uuid::new_v4()));
        let created_at_ms = existing_by_id
            .as_ref()
            .or(existing_by_fingerprint.as_ref())
            .map(|item| item.created_at_ms)
            .unwrap_or(input.created_at_ms);

        tx.execute(
            "INSERT INTO ai_config_saved_claude_providers (
                saved_provider_id,
                workspace_id,
                fingerprint,
                mode,
                provider_id,
                provider_name,
                base_url,
                model,
                auth_scheme,
                secret_ref,
                has_secret,
                settings_json,
                is_active,
                created_at_ms,
                updated_at_ms,
                last_applied_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?14, ?15)
            ON CONFLICT(saved_provider_id) DO UPDATE SET
                fingerprint = excluded.fingerprint,
                mode = excluded.mode,
                provider_id = excluded.provider_id,
                provider_name = excluded.provider_name,
                base_url = excluded.base_url,
                model = excluded.model,
                auth_scheme = excluded.auth_scheme,
                secret_ref = excluded.secret_ref,
                has_secret = excluded.has_secret,
                settings_json = excluded.settings_json,
                is_active = 1,
                updated_at_ms = excluded.updated_at_ms,
                last_applied_at_ms = excluded.last_applied_at_ms",
            params![
                saved_provider_id,
                input.workspace_id,
                input.fingerprint,
                input.mode,
                input.provider_id,
                input.provider_name,
                input.base_url,
                input.model,
                input.auth_scheme,
                input.secret_ref,
                input.has_secret,
                input.settings_json,
                created_at_ms,
                input.updated_at_ms,
                input.last_applied_at_ms,
            ],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;

        tx.commit()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        self.get_saved_claude_provider(&input.workspace_id, &saved_provider_id)?
            .ok_or_else(|| AiConfigRepositoryError::Storage {
                message: "saved Claude provider missing after upsert".to_string(),
            })
    }

    pub fn list_saved_claude_providers(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<SavedClaudeProviderRecord>, AiConfigRepositoryError> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    saved_provider_id,
                    workspace_id,
                    fingerprint,
                    mode,
                    provider_id,
                    provider_name,
                    base_url,
                    model,
                    auth_scheme,
                    secret_ref,
                    has_secret,
                    settings_json,
                    is_active,
                    created_at_ms,
                    updated_at_ms,
                    last_applied_at_ms
                FROM ai_config_saved_claude_providers
                 WHERE workspace_id = ?1
                 ORDER BY created_at_ms DESC, saved_provider_id DESC",
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let rows = stmt
            .query_map(params![workspace_id], map_saved_claude_provider_row)
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(results)
    }

    pub fn get_saved_claude_provider(
        &self,
        workspace_id: &str,
        saved_provider_id: &str,
    ) -> Result<Option<SavedClaudeProviderRecord>, AiConfigRepositoryError> {
        let conn = self.connection()?;
        conn.query_row(
            "SELECT
                saved_provider_id,
                workspace_id,
                fingerprint,
                mode,
                provider_id,
                provider_name,
                base_url,
                model,
                auth_scheme,
                secret_ref,
                has_secret,
                settings_json,
                is_active,
                created_at_ms,
                updated_at_ms,
                last_applied_at_ms
             FROM ai_config_saved_claude_providers
             WHERE workspace_id = ?1 AND saved_provider_id = ?2",
            params![workspace_id, saved_provider_id],
            map_saved_claude_provider_row,
        )
        .optional()
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })
    }

    pub fn set_active_saved_claude_provider(
        &self,
        workspace_id: &str,
        saved_provider_id: &str,
        last_applied_at_ms: i64,
    ) -> Result<Option<SavedClaudeProviderRecord>, AiConfigRepositoryError> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let updated = tx
            .execute(
                "UPDATE ai_config_saved_claude_providers
                 SET is_active = CASE WHEN saved_provider_id = ?2 THEN 1 ELSE 0 END,
                     last_applied_at_ms = CASE WHEN saved_provider_id = ?2 THEN ?3 ELSE last_applied_at_ms END
                 WHERE workspace_id = ?1",
                params![workspace_id, saved_provider_id, last_applied_at_ms],
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        tx.commit()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        if updated == 0 {
            return Ok(None);
        }
        self.get_saved_claude_provider(workspace_id, saved_provider_id)
    }

    pub fn delete_saved_claude_provider(
        &self,
        workspace_id: &str,
        saved_provider_id: &str,
    ) -> Result<bool, AiConfigRepositoryError> {
        let conn = self.connection()?;
        let deleted = conn
            .execute(
                "DELETE FROM ai_config_saved_claude_providers WHERE workspace_id = ?1 AND saved_provider_id = ?2",
                params![workspace_id, saved_provider_id],
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        Ok(deleted > 0)
    }

    pub fn upsert_saved_provider(
        &self,
        input: &SavedAiProviderInput,
    ) -> Result<SavedAiProviderRecord, AiConfigRepositoryError> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let existing_by_fingerprint = tx
            .query_row(
                "SELECT
                    agent,
                    saved_provider_id,
                    fingerprint,
                    mode,
                    provider_id,
                    provider_name,
                    base_url,
                    model,
                    secret_ref,
                    has_secret,
                    extra_json,
                    is_active,
                    created_at_ms,
                    updated_at_ms,
                    last_applied_at_ms
                 FROM ai_config_saved_providers
                 WHERE agent = ?1 AND fingerprint = ?2",
                params![input.agent, input.fingerprint],
                map_saved_ai_provider_row,
            )
            .optional()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let existing_by_id = input
            .saved_provider_id
            .as_ref()
            .map(|saved_provider_id| {
                tx.query_row(
                    "SELECT
                        agent,
                        saved_provider_id,
                        fingerprint,
                        mode,
                        provider_id,
                        provider_name,
                        base_url,
                        model,
                        secret_ref,
                        has_secret,
                        extra_json,
                        is_active,
                        created_at_ms,
                        updated_at_ms,
                        last_applied_at_ms
                     FROM ai_config_saved_providers
                     WHERE agent = ?1 AND saved_provider_id = ?2",
                    params![input.agent, saved_provider_id],
                    map_saved_ai_provider_row,
                )
                .optional()
            })
            .transpose()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?
            .flatten();

        tx.execute(
            "UPDATE ai_config_saved_providers
             SET is_active = 0
             WHERE agent = ?1",
            params![input.agent],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;

        let saved_provider_id = input
            .saved_provider_id
            .clone()
            .or_else(|| {
                existing_by_fingerprint
                    .as_ref()
                    .map(|item| item.saved_provider_id.clone())
            })
            .unwrap_or_else(|| format!("provider:{}", Uuid::new_v4()));
        let created_at_ms = existing_by_id
            .as_ref()
            .or(existing_by_fingerprint.as_ref())
            .map(|item| item.created_at_ms)
            .unwrap_or(input.created_at_ms);

        tx.execute(
            "INSERT INTO ai_config_saved_providers (
                agent,
                saved_provider_id,
                fingerprint,
                mode,
                provider_id,
                provider_name,
                base_url,
                model,
                secret_ref,
                has_secret,
                extra_json,
                is_active,
                created_at_ms,
                updated_at_ms,
                last_applied_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?13, ?14)
            ON CONFLICT(saved_provider_id) DO UPDATE SET
                agent = excluded.agent,
                fingerprint = excluded.fingerprint,
                mode = excluded.mode,
                provider_id = excluded.provider_id,
                provider_name = excluded.provider_name,
                base_url = excluded.base_url,
                model = excluded.model,
                secret_ref = excluded.secret_ref,
                has_secret = excluded.has_secret,
                extra_json = excluded.extra_json,
                is_active = 1,
                updated_at_ms = excluded.updated_at_ms,
                last_applied_at_ms = excluded.last_applied_at_ms",
            params![
                input.agent,
                saved_provider_id,
                input.fingerprint,
                input.mode,
                input.provider_id,
                input.provider_name,
                input.base_url,
                input.model,
                input.secret_ref,
                input.has_secret,
                input.extra_json,
                created_at_ms,
                input.updated_at_ms,
                input.last_applied_at_ms,
            ],
        )
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })?;

        tx.commit()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        self.get_saved_provider(&input.agent, &saved_provider_id)?
            .ok_or_else(|| AiConfigRepositoryError::Storage {
                message: "saved provider missing after upsert".to_string(),
            })
    }

    pub fn list_saved_providers(
        &self,
        agent: &str,
    ) -> Result<Vec<SavedAiProviderRecord>, AiConfigRepositoryError> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    agent,
                    saved_provider_id,
                    fingerprint,
                    mode,
                    provider_id,
                    provider_name,
                    base_url,
                    model,
                    secret_ref,
                    has_secret,
                    extra_json,
                    is_active,
                    created_at_ms,
                    updated_at_ms,
                    last_applied_at_ms
                 FROM ai_config_saved_providers
                 WHERE agent = ?1
                 ORDER BY created_at_ms DESC, saved_provider_id DESC",
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let rows = stmt
            .query_map(params![agent], map_saved_ai_provider_row)
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(results)
    }

    pub fn get_saved_provider(
        &self,
        agent: &str,
        saved_provider_id: &str,
    ) -> Result<Option<SavedAiProviderRecord>, AiConfigRepositoryError> {
        let conn = self.connection()?;
        conn.query_row(
            "SELECT
                agent,
                saved_provider_id,
                fingerprint,
                mode,
                provider_id,
                provider_name,
                base_url,
                model,
                secret_ref,
                has_secret,
                extra_json,
                is_active,
                created_at_ms,
                updated_at_ms,
                last_applied_at_ms
             FROM ai_config_saved_providers
             WHERE agent = ?1 AND saved_provider_id = ?2",
            params![agent, saved_provider_id],
            map_saved_ai_provider_row,
        )
        .optional()
        .map_err(|error| AiConfigRepositoryError::Storage {
            message: error.to_string(),
        })
    }

    pub fn set_active_saved_provider(
        &self,
        agent: &str,
        saved_provider_id: &str,
        last_applied_at_ms: i64,
    ) -> Result<Option<SavedAiProviderRecord>, AiConfigRepositoryError> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        let updated = tx
            .execute(
                "UPDATE ai_config_saved_providers
                 SET is_active = CASE WHEN saved_provider_id = ?2 THEN 1 ELSE 0 END,
                     last_applied_at_ms = CASE WHEN saved_provider_id = ?2 THEN ?3 ELSE last_applied_at_ms END
                 WHERE agent = ?1",
                params![agent, saved_provider_id, last_applied_at_ms],
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        tx.commit()
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;

        if updated == 0 {
            return Ok(None);
        }
        self.get_saved_provider(agent, saved_provider_id)
    }

    pub fn delete_saved_provider(
        &self,
        agent: &str,
        saved_provider_id: &str,
    ) -> Result<bool, AiConfigRepositoryError> {
        let conn = self.connection()?;
        let deleted = conn
            .execute(
                "DELETE FROM ai_config_saved_providers WHERE agent = ?1 AND saved_provider_id = ?2",
                params![agent, saved_provider_id],
            )
            .map_err(|error| AiConfigRepositoryError::Storage {
                message: error.to_string(),
            })?;
        Ok(deleted > 0)
    }
}

fn map_saved_claude_provider_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<SavedClaudeProviderRecord> {
    Ok(SavedClaudeProviderRecord {
        saved_provider_id: row.get(0)?,
        workspace_id: row.get(1)?,
        fingerprint: row.get(2)?,
        mode: row.get(3)?,
        provider_id: row.get(4)?,
        provider_name: row.get(5)?,
        base_url: row.get(6)?,
        model: row.get(7)?,
        auth_scheme: row.get(8)?,
        secret_ref: row.get(9)?,
        has_secret: row.get(10)?,
        settings_json: row.get(11)?,
        is_active: row.get::<_, i64>(12)? != 0,
        created_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
        last_applied_at_ms: row.get(15)?,
    })
}

fn map_saved_ai_provider_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedAiProviderRecord> {
    Ok(SavedAiProviderRecord {
        agent: row.get(0)?,
        saved_provider_id: row.get(1)?,
        fingerprint: row.get(2)?,
        mode: row.get(3)?,
        provider_id: row.get(4)?,
        provider_name: row.get(5)?,
        base_url: row.get(6)?,
        model: row.get(7)?,
        secret_ref: row.get(8)?,
        has_secret: row.get(9)?,
        extra_json: row.get(10)?,
        is_active: row.get::<_, i64>(11)? != 0,
        created_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
        last_applied_at_ms: row.get(14)?,
    })
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

CREATE TABLE IF NOT EXISTS ai_config_saved_claude_providers (
  saved_provider_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_id TEXT,
  provider_name TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  auth_scheme TEXT,
  secret_ref TEXT,
  has_secret INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_applied_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_saved_claude_workspace_fingerprint
  ON ai_config_saved_claude_providers(workspace_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_ai_config_saved_claude_workspace_active
  ON ai_config_saved_claude_providers(workspace_id, is_active, last_applied_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_ai_config_saved_claude_workspace_created
  ON ai_config_saved_claude_providers(workspace_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS ai_config_saved_providers (
  saved_provider_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_id TEXT,
  provider_name TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  secret_ref TEXT,
  has_secret INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_applied_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_saved_provider_agent_fingerprint
  ON ai_config_saved_providers(agent, fingerprint);

CREATE INDEX IF NOT EXISTS idx_ai_config_saved_provider_agent_active
  ON ai_config_saved_providers(agent, is_active, last_applied_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_ai_config_saved_provider_agent_created
  ON ai_config_saved_providers(agent, created_at_ms DESC);
"#;
