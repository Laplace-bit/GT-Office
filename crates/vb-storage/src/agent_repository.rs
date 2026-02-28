use crate::sqlite::SqliteStorage;
use rusqlite::{params, OptionalExtension};
use vb_agent::{
    AgentError, AgentProfile, AgentRepository, AgentResult, AgentRole, AgentState,
    CreateAgentInput, OrganizationDepartment, RoleStatus, DEFAULT_DEPARTMENTS, DEFAULT_ROLES,
};

#[derive(Debug, Clone)]
pub struct SqliteAgentRepository {
    storage: SqliteStorage,
}

impl SqliteAgentRepository {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    fn now_ms() -> i64 {
        let now = std::time::SystemTime::now();
        let since_epoch = now
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        since_epoch.as_millis() as i64
    }

    fn connection(&self) -> AgentResult<rusqlite::Connection> {
        self.storage
            .open_connection()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })
    }
}

const AGENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS org_departments (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS agent_roles (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role_key TEXT NOT NULL,
  role_name TEXT NOT NULL,
  department_id TEXT NOT NULL,
  charter_path TEXT,
  policy_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (id, workspace_id),
  UNIQUE (workspace_id, role_key),
  FOREIGN KEY (department_id, workspace_id)
    REFERENCES org_departments(id, workspace_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  state TEXT NOT NULL,
  employee_no TEXT,
  policy_snapshot_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (id, workspace_id),
  FOREIGN KEY (role_id, workspace_id)
    REFERENCES agent_roles(id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_agent_roles_workspace_key
  ON agent_roles(workspace_id, role_key);
CREATE INDEX IF NOT EXISTS idx_agent_roles_workspace_department
  ON agent_roles(workspace_id, department_id);
CREATE INDEX IF NOT EXISTS idx_agents_workspace_role
  ON agents(workspace_id, role_id);
"#;

impl AgentRepository for SqliteAgentRepository {
    fn ensure_schema(&self) -> AgentResult<()> {
        let conn = self.connection()?;
        conn.execute_batch(AGENT_SCHEMA)
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        Ok(())
    }

    fn seed_defaults(&self, workspace_id: &str) -> AgentResult<()> {
        let mut conn = self.connection()?;
        let now_ms = Self::now_ms();
        let tx = conn.transaction().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        for dept in DEFAULT_DEPARTMENTS.iter() {
            tx.execute(
                "INSERT OR IGNORE INTO org_departments (id, workspace_id, name, description, order_index, is_system, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
                params![
                    dept.id,
                    workspace_id,
                    dept.name,
                    dept.description,
                    dept.order_index,
                    now_ms,
                    now_ms,
                ],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        }

        for role in DEFAULT_ROLES.iter() {
            tx.execute(
                "INSERT OR IGNORE INTO agent_roles (id, workspace_id, role_key, role_name, department_id, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', 1, 'active', 1, ?7, ?8)",
                params![
                    role.id,
                    workspace_id,
                    role.role_key,
                    role.role_name,
                    role.department_id,
                    role.charter_path,
                    now_ms,
                    now_ms,
                ],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        }

        tx.execute(
            "UPDATE agent_roles SET status = 'deprecated', updated_at_ms = ?1 WHERE workspace_id = ?2 AND is_system = 1 AND role_key IN ('implementation', 'review', 'test', 'release')",
            params![now_ms, workspace_id],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        tx.commit().map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        Ok(())
    }

    fn list_departments(&self, workspace_id: &str) -> AgentResult<Vec<OrganizationDepartment>> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, description, order_index, is_system, created_at_ms, updated_at_ms FROM org_departments WHERE workspace_id = ?1 ORDER BY order_index, name",
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                Ok(OrganizationDepartment {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    order_index: row.get(4)?,
                    is_system: row.get::<_, i32>(5)? != 0,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                })
            })
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(result)
    }

    fn list_roles(&self, workspace_id: &str) -> AgentResult<Vec<AgentRole>> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, role_key, role_name, department_id, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms FROM agent_roles WHERE workspace_id = ?1 ORDER BY department_id, role_key",
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                let status: String = row.get(8)?;
                Ok(AgentRole {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    role_key: row.get(2)?,
                    role_name: row.get(3)?,
                    department_id: row.get(4)?,
                    charter_path: row.get(5)?,
                    policy_json: row.get(6)?,
                    version: row.get(7)?,
                    status: RoleStatus::from_str(status.as_str()),
                    is_system: row.get::<_, i32>(9)? != 0,
                    created_at_ms: row.get(10)?,
                    updated_at_ms: row.get(11)?,
                })
            })
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(result)
    }

    fn list_agents(&self, workspace_id: &str) -> AgentResult<Vec<AgentProfile>> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, role_id, state, employee_no, policy_snapshot_id, created_at_ms, updated_at_ms FROM agents WHERE workspace_id = ?1 ORDER BY created_at_ms",
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                let state: String = row.get(4)?;
                Ok(AgentProfile {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    role_id: row.get(3)?,
                    state: AgentState::from_str(state.as_str()),
                    employee_no: row.get(5)?,
                    policy_snapshot_id: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                })
            })
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?);
        }
        Ok(result)
    }

    fn create_agent(&self, input: CreateAgentInput) -> AgentResult<AgentProfile> {
        if input.name.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "agent name is required".to_string(),
            });
        }
        if input.role_id.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "role_id is required".to_string(),
            });
        }

        let conn = self.connection()?;
        let role_exists: Option<String> = conn
            .query_row(
                "SELECT id FROM agent_roles WHERE workspace_id = ?1 AND id = ?2",
                params![input.workspace_id, input.role_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        if role_exists.is_none() {
            return Err(AgentError::InvalidArgument {
                message: "role_id not found".to_string(),
            });
        }

        let now_ms = Self::now_ms();
        let agent_id = input
            .agent_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, role_id, state, employee_no, policy_snapshot_id, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
            params![
                agent_id,
                input.workspace_id,
                input.name,
                input.role_id,
                input.state.as_str(),
                input.employee_no,
                now_ms,
                now_ms,
            ],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        Ok(AgentProfile {
            id: agent_id,
            workspace_id: input.workspace_id,
            name: input.name,
            role_id: input.role_id,
            state: input.state,
            employee_no: input.employee_no,
            policy_snapshot_id: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        })
    }

    fn upsert_role(&self, workspace_id: &str, role: AgentRole) -> AgentResult<AgentRole> {
        let conn = self.connection()?;
        let now_ms = Self::now_ms();
        conn.execute(
            "INSERT INTO agent_roles (id, workspace_id, role_key, role_name, department_id, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id, workspace_id) DO UPDATE SET role_key = excluded.role_key, role_name = excluded.role_name, department_id = excluded.department_id, charter_path = excluded.charter_path, policy_json = excluded.policy_json, version = excluded.version, status = excluded.status, is_system = excluded.is_system, updated_at_ms = excluded.updated_at_ms",
            params![
                role.id,
                workspace_id,
                role.role_key,
                role.role_name,
                role.department_id,
                role.charter_path,
                role.policy_json,
                role.version,
                role.status.as_str(),
                if role.is_system { 1 } else { 0 },
                role.created_at_ms,
                now_ms,
            ],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        Ok(AgentRole {
            updated_at_ms: now_ms,
            workspace_id: workspace_id.to_string(),
            ..role
        })
    }

    fn set_role_status(
        &self,
        workspace_id: &str,
        role_id: &str,
        status: RoleStatus,
    ) -> AgentResult<bool> {
        let conn = self.connection()?;
        let now_ms = Self::now_ms();
        let updated = conn
            .execute(
                "UPDATE agent_roles SET status = ?1, updated_at_ms = ?2 WHERE workspace_id = ?3 AND id = ?4",
                params![status.as_str(), now_ms, workspace_id, role_id],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        Ok(updated > 0)
    }
}
