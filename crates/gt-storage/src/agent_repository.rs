use crate::sqlite::SqliteStorage;
use gt_agent::{
    AgentError, AgentProfile, AgentRepository, AgentResult, AgentScope, AgentState,
    CreateAgentInput, UpdateAgentInput,
};
use rusqlite::params;

#[derive(Debug, Clone)]
pub struct SqliteAgentRepository {
    storage: SqliteStorage,
}

impl SqliteAgentRepository {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    fn connection(&self) -> AgentResult<rusqlite::Connection> {
        self.storage
            .open_connection()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })
    }

    pub fn reset_workspace_state_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        workspace_id: &str,
    ) -> AgentResult<()> {
        tx.execute(
            "DELETE FROM agents WHERE workspace_id = ?1",
            params![workspace_id],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        Ok(())
    }

    fn migrate_legacy_schema(conn: &rusqlite::Connection) -> AgentResult<()> {
        let columns = conn
            .prepare("PRAGMA table_info(agents)")
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        if columns
            .iter()
            .any(|column| column == "role_id" || column == "role_workspace_id")
        {
            conn.execute_batch(
                r#"
                PRAGMA foreign_keys = OFF;
                BEGIN IMMEDIATE;
                CREATE TABLE agents__without_roles (
                  id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
                  tool TEXT NOT NULL DEFAULT 'codex', workdir TEXT,
                  custom_workdir INTEGER NOT NULL DEFAULT 0, scope TEXT NOT NULL DEFAULT 'station',
                  state TEXT NOT NULL, employee_no TEXT, policy_snapshot_id TEXT,
                  launch_command TEXT, order_index INTEGER NOT NULL DEFAULT 0,
                  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
                  PRIMARY KEY (id, workspace_id)
                );
                INSERT INTO agents__without_roles
                SELECT id, workspace_id, name, tool, workdir, custom_workdir,
                  COALESCE(scope, 'station'), state, employee_no, policy_snapshot_id,
                  launch_command, COALESCE(order_index, 0), created_at_ms, updated_at_ms
                FROM agents;
                DROP TABLE agents;
                ALTER TABLE agents__without_roles RENAME TO agents;
                COMMIT;
                PRAGMA foreign_keys = ON;
            "#,
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        }
        conn.execute_batch("DROP TABLE IF EXISTS deleted_system_role_seeds; DROP TABLE IF EXISTS agent_roles; DROP TABLE IF EXISTS org_departments;")
            .map_err(|error| AgentError::Storage { message: error.to_string() })
    }
}

const AGENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
  tool TEXT NOT NULL DEFAULT 'codex', workdir TEXT,
  custom_workdir INTEGER NOT NULL DEFAULT 0, scope TEXT NOT NULL DEFAULT 'station',
  state TEXT NOT NULL, employee_no TEXT, policy_snapshot_id TEXT,
  launch_command TEXT, order_index INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (id, workspace_id)
);
"#;

impl AgentRepository for SqliteAgentRepository {
    fn ensure_schema(&self) -> AgentResult<()> {
        let conn = self.connection()?;
        conn.execute_batch(AGENT_SCHEMA)
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        Self::migrate_legacy_schema(&conn)
    }

    fn reset_workspace_state(&self, workspace_id: &str) -> AgentResult<()> {
        let mut conn = self.connection()?;
        let tx = conn.transaction().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        self.reset_workspace_state_in_tx(&tx, workspace_id)?;
        tx.commit().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })
    }

    fn list_agents(&self, workspace_id: &str) -> AgentResult<Vec<AgentProfile>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT id, workspace_id, name, tool, workdir, custom_workdir, scope, state, employee_no, policy_snapshot_id, launch_command, order_index, created_at_ms, updated_at_ms FROM agents WHERE workspace_id = ?1 ORDER BY order_index, created_at_ms")
            .map_err(|error| AgentError::Storage { message: error.to_string() })?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                let state: String = row.get(7)?;
                let scope: String = row.get(6)?;
                Ok(AgentProfile {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    tool: row.get(3)?,
                    workdir: row.get(4)?,
                    custom_workdir: row.get::<_, i32>(5)? != 0,
                    scope: AgentScope::from_storage_str(&scope),
                    state: AgentState::from_storage_str(&state),
                    employee_no: row.get(8)?,
                    policy_snapshot_id: row.get(9)?,
                    launch_command: row.get(10)?,
                    order_index: row.get(11)?,
                    prompt_file_name: None,
                    prompt_file_relative_path: None,
                    created_at_ms: row.get(12)?,
                    updated_at_ms: row.get(13)?,
                })
            })
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })
    }

    fn create_agent(&self, input: CreateAgentInput) -> AgentResult<AgentProfile> {
        if input.name.trim().is_empty() || input.tool.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "agent name and tool are required".to_string(),
            });
        }
        let conn = self.connection()?;
        let id = input
            .agent_id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let order_index = input.order_index.unwrap_or_else(|| {
            conn.query_row(
                "SELECT COALESCE(MAX(order_index), 0) + 1 FROM agents WHERE workspace_id = ?1",
                params![input.workspace_id],
                |row| row.get(0),
            )
            .unwrap_or(1)
        });
        let now = Self::now_ms();
        conn.execute("INSERT INTO agents (id, workspace_id, name, tool, workdir, custom_workdir, scope, state, employee_no, policy_snapshot_id, launch_command, order_index, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, ?13)", params![id, input.workspace_id, input.name, input.tool, input.workdir, if input.custom_workdir { 1 } else { 0 }, input.scope.as_str(), input.state.as_str(), input.employee_no, input.launch_command, order_index, now, now])
            .map_err(|error| AgentError::Storage { message: error.to_string() })?;
        self.list_agents(&input.workspace_id)?
            .into_iter()
            .find(|agent| agent.id == id)
            .ok_or(AgentError::Storage {
                message: "created agent was not found".to_string(),
            })
    }

    fn update_agent(&self, input: UpdateAgentInput) -> AgentResult<AgentProfile> {
        let conn = self.connection()?;
        let updated = conn.execute("UPDATE agents SET name = ?1, tool = ?2, workdir = ?3, custom_workdir = ?4, state = ?5, employee_no = ?6, launch_command = ?7, updated_at_ms = ?8 WHERE workspace_id = ?9 AND id = ?10", params![input.name, input.tool, input.workdir, if input.custom_workdir { 1 } else { 0 }, input.state.as_str(), input.employee_no, input.launch_command, Self::now_ms(), input.workspace_id, input.agent_id])
            .map_err(|error| AgentError::Storage { message: error.to_string() })?;
        if updated == 0 {
            return Err(AgentError::InvalidArgument {
                message: "agent_id not found".to_string(),
            });
        }
        self.list_agents(&input.workspace_id)?
            .into_iter()
            .find(|agent| agent.id == input.agent_id)
            .ok_or(AgentError::Storage {
                message: "updated agent was not found".to_string(),
            })
    }

    fn delete_agent(&self, workspace_id: &str, agent_id: &str) -> AgentResult<bool> {
        let conn = self.connection()?;
        Ok(conn
            .execute(
                "DELETE FROM agents WHERE workspace_id = ?1 AND id = ?2",
                params![workspace_id, agent_id],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?
            > 0)
    }

    fn reorder_agents(&self, workspace_id: &str, ordered_ids: Vec<String>) -> AgentResult<()> {
        let mut conn = self.connection()?;
        let tx = conn.transaction().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute("UPDATE agents SET order_index = ?1, updated_at_ms = ?2 WHERE workspace_id = ?3 AND id = ?4", params![index as i32 + 1, Self::now_ms(), workspace_id, id]).map_err(|error| AgentError::Storage { message: error.to_string() })?;
        }
        tx.commit().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })
    }
}
