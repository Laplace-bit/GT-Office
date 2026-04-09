use crate::sqlite::SqliteStorage;
use rusqlite::{params, OptionalExtension};
use gt_agent::{
    prompt_file_name_for_tool, prompt_file_relative_path, AgentError, AgentProfile,
    AgentRepository, AgentResult, AgentRole, AgentRoleScope, AgentState, CreateAgentInput,
    OrganizationDepartment, RoleStatus, UpdateAgentInput, DEFAULT_DEPARTMENTS, DEFAULT_ROLES,
    GLOBAL_ROLE_WORKSPACE_ID,
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

    fn default_department_id() -> &'static str {
        "dept_delivery_engineering"
    }

    fn normalize_department_id(input: &str) -> &'static str {
        if input.trim().is_empty() {
            Self::default_department_id()
        } else {
            Self::default_department_id()
        }
    }

    fn hydrate_agent_profile(mut agent: AgentProfile) -> AgentProfile {
        if let Some(workdir) = agent.workdir.as_deref() {
            agent.prompt_file_name =
                prompt_file_name_for_tool(agent.tool.as_str()).map(str::to_string);
            agent.prompt_file_relative_path =
                prompt_file_relative_path(workdir, agent.tool.as_str());
        }
        agent
    }

    fn agents_table_uses_legacy_role_foreign_key(
        conn: &rusqlite::Connection,
    ) -> AgentResult<bool> {
        let mut stmt = conn
            .prepare("PRAGMA foreign_key_list(agents)")
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;

        let mut legacy_pairs = Vec::new();
        let mut migrated_pairs = Vec::new();
        for row in rows {
            let (fk_id, table_name, from_column, to_column) =
                row.map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?;
            if table_name != "agent_roles" {
                continue;
            }
            match fk_id {
                0 => legacy_pairs.push((from_column.clone(), to_column.clone())),
                1 => migrated_pairs.push((from_column, to_column)),
                _ => migrated_pairs.push((from_column, to_column)),
            }
        }

        if legacy_pairs.is_empty() && migrated_pairs.is_empty() {
            return Ok(false);
        }

        let has_legacy_workspace_fk = legacy_pairs
            .iter()
            .any(|(from, to)| from == "workspace_id" && to == "workspace_id");
        let has_role_workspace_fk = legacy_pairs
            .iter()
            .chain(migrated_pairs.iter())
            .any(|(from, to)| from == "role_workspace_id" && to == "workspace_id");

        Ok(has_legacy_workspace_fk && !has_role_workspace_fk)
    }

    fn migrate_agents_table_role_foreign_key(
        conn: &rusqlite::Connection,
    ) -> AgentResult<()> {
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = OFF;
            BEGIN IMMEDIATE;
            CREATE TABLE agents__gto_migrated (
              id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              name TEXT NOT NULL,
              role_id TEXT NOT NULL,
              role_workspace_id TEXT NOT NULL DEFAULT '',
              tool TEXT NOT NULL DEFAULT 'codex cli',
              workdir TEXT,
              custom_workdir INTEGER NOT NULL DEFAULT 0,
              state TEXT NOT NULL,
              employee_no TEXT,
              policy_snapshot_id TEXT,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              PRIMARY KEY (id, workspace_id),
              FOREIGN KEY (role_id, role_workspace_id)
                REFERENCES agent_roles(id, workspace_id)
                ON DELETE RESTRICT
            );
            INSERT INTO agents__gto_migrated (
              id,
              workspace_id,
              name,
              role_id,
              role_workspace_id,
              tool,
              workdir,
              custom_workdir,
              state,
              employee_no,
              policy_snapshot_id,
              created_at_ms,
              updated_at_ms
            )
            SELECT
              id,
              workspace_id,
              name,
              role_id,
              COALESCE(NULLIF(role_workspace_id, ''), workspace_id),
              tool,
              workdir,
              custom_workdir,
              state,
              employee_no,
              policy_snapshot_id,
              created_at_ms,
              updated_at_ms
            FROM agents;
            DROP TABLE agents;
            ALTER TABLE agents__gto_migrated RENAME TO agents;
            CREATE INDEX IF NOT EXISTS idx_agents_workspace_role
              ON agents(workspace_id, role_id);
            COMMIT;
            PRAGMA foreign_keys = ON;
            "#,
        )
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
  scope TEXT NOT NULL DEFAULT 'workspace',
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
  role_workspace_id TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT 'codex cli',
  workdir TEXT,
  custom_workdir INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  employee_no TEXT,
  policy_snapshot_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (id, workspace_id),
  FOREIGN KEY (role_id, role_workspace_id)
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
        let existing_agent_columns = {
            let mut stmt =
                conn.prepare("PRAGMA table_info(agents)")
                    .map_err(|error| AgentError::Storage {
                        message: error.to_string(),
                    })?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?;
            let mut columns = Vec::new();
            for row in rows {
                columns.push(row.map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?);
            }
            columns
        };
        let existing_role_columns = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(agent_roles)")
                .map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?;
            let mut columns = Vec::new();
            for row in rows {
                columns.push(row.map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?);
            }
            columns
        };
        for statement in [
            (
                "tool",
                "ALTER TABLE agents ADD COLUMN tool TEXT NOT NULL DEFAULT 'codex cli'",
            ),
            ("workdir", "ALTER TABLE agents ADD COLUMN workdir TEXT"),
            (
                "custom_workdir",
                "ALTER TABLE agents ADD COLUMN custom_workdir INTEGER NOT NULL DEFAULT 0",
            ),
            (
                "role_workspace_id",
                "ALTER TABLE agents ADD COLUMN role_workspace_id TEXT NOT NULL DEFAULT ''",
            ),
        ] {
            if existing_agent_columns
                .iter()
                .any(|column| column == statement.0)
            {
                continue;
            }
            conn.execute(statement.1, [])
                .map_err(|error| AgentError::Storage {
                    message: error.to_string(),
                })?;
        }
        if !existing_role_columns.iter().any(|column| column == "scope") {
            conn.execute(
                "ALTER TABLE agent_roles ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'",
                [],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        }
        conn.execute(
            "UPDATE agents SET role_workspace_id = workspace_id WHERE role_workspace_id = '' OR role_workspace_id IS NULL",
            [],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        conn.execute(
            "UPDATE agent_roles SET scope = 'global' WHERE workspace_id = ?1 AND scope != 'global'",
            params![GLOBAL_ROLE_WORKSPACE_ID],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        if Self::agents_table_uses_legacy_role_foreign_key(&conn)? {
            Self::migrate_agents_table_role_foreign_key(&conn)?;
        }
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

        if workspace_id == GLOBAL_ROLE_WORKSPACE_ID {
            for role in DEFAULT_ROLES.iter() {
                tx.execute(
                    "INSERT OR IGNORE INTO agent_roles (id, workspace_id, role_key, role_name, department_id, scope, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, 'global', ?6, '{}', 1, 'active', 1, ?7, ?8)",
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
                "SELECT id, workspace_id, role_key, role_name, department_id, scope, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms
                 FROM agent_roles
                 WHERE workspace_id IN (?1, ?2)
                 ORDER BY CASE WHEN workspace_id = ?1 THEN 0 ELSE 1 END, role_name COLLATE NOCASE, role_key COLLATE NOCASE",
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map(params![workspace_id, GLOBAL_ROLE_WORKSPACE_ID], |row| {
                let scope: String = row.get(5)?;
                let status: String = row.get(9)?;
                Ok(AgentRole {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    role_key: row.get(2)?,
                    role_name: row.get(3)?,
                    department_id: row.get(4)?,
                    scope: AgentRoleScope::from_str(scope.as_str()),
                    charter_path: row.get(6)?,
                    policy_json: row.get(7)?,
                    version: row.get(8)?,
                    status: RoleStatus::from_str(status.as_str()),
                    is_system: row.get::<_, i32>(10)? != 0,
                    created_at_ms: row.get(11)?,
                    updated_at_ms: row.get(12)?,
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
                "SELECT id, workspace_id, name, role_id, tool, workdir, custom_workdir, state, employee_no, policy_snapshot_id, created_at_ms, updated_at_ms
                 FROM agents WHERE workspace_id = ?1 ORDER BY created_at_ms",
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                let state: String = row.get(7)?;
                Ok(Self::hydrate_agent_profile(AgentProfile {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    role_id: row.get(3)?,
                    tool: row.get(4)?,
                    workdir: row.get(5)?,
                    custom_workdir: row.get::<_, i32>(6)? != 0,
                    state: AgentState::from_str(state.as_str()),
                    employee_no: row.get(8)?,
                    policy_snapshot_id: row.get(9)?,
                    prompt_file_name: None,
                    prompt_file_relative_path: None,
                    created_at_ms: row.get(10)?,
                    updated_at_ms: row.get(11)?,
                }))
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
        if input.tool.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "tool is required".to_string(),
            });
        }

        let conn = self.connection()?;
        let role_scope_owner: Option<String> = conn
            .query_row(
                "SELECT workspace_id FROM agent_roles WHERE id = ?1 AND workspace_id IN (?2, ?3)",
                params![input.role_id, input.workspace_id, GLOBAL_ROLE_WORKSPACE_ID],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let Some(role_workspace_id) = role_scope_owner else {
            return Err(AgentError::InvalidArgument {
                message: "role_id not found".to_string(),
            });
        };

        let now_ms = Self::now_ms();
        let agent_id = input
            .agent_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        conn.execute(
            "INSERT INTO agents (id, workspace_id, name, role_id, role_workspace_id, tool, workdir, custom_workdir, state, employee_no, policy_snapshot_id, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
            params![
                agent_id,
                input.workspace_id,
                input.name,
                input.role_id,
                role_workspace_id,
                input.tool,
                input.workdir,
                if input.custom_workdir { 1 } else { 0 },
                input.state.as_str(),
                input.employee_no,
                now_ms,
                now_ms,
            ],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;

        Ok(Self::hydrate_agent_profile(AgentProfile {
            id: agent_id,
            workspace_id: input.workspace_id,
            name: input.name,
            role_id: input.role_id,
            tool: input.tool,
            workdir: input.workdir,
            custom_workdir: input.custom_workdir,
            state: input.state,
            employee_no: input.employee_no,
            policy_snapshot_id: None,
            prompt_file_name: None,
            prompt_file_relative_path: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        }))
    }

    fn update_agent(&self, input: UpdateAgentInput) -> AgentResult<AgentProfile> {
        if input.agent_id.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "agent_id is required".to_string(),
            });
        }
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
        if input.tool.trim().is_empty() {
            return Err(AgentError::InvalidArgument {
                message: "tool is required".to_string(),
            });
        }

        let conn = self.connection()?;
        let existing_agent: Option<(i64, Option<String>)> = conn
            .query_row(
                "SELECT created_at_ms, policy_snapshot_id FROM agents WHERE workspace_id = ?1 AND id = ?2",
                params![input.workspace_id, input.agent_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let Some((created_at_ms, policy_snapshot_id)) = existing_agent else {
            return Err(AgentError::InvalidArgument {
                message: "agent_id not found".to_string(),
            });
        };
        let role_scope_owner: Option<String> = conn
            .query_row(
                "SELECT workspace_id FROM agent_roles WHERE id = ?1 AND workspace_id IN (?2, ?3)",
                params![input.role_id, input.workspace_id, GLOBAL_ROLE_WORKSPACE_ID],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        let Some(role_workspace_id) = role_scope_owner else {
            return Err(AgentError::InvalidArgument {
                message: "role_id not found".to_string(),
            });
        };

        let now_ms = Self::now_ms();
        conn.execute(
            "UPDATE agents SET name = ?1, role_id = ?2, role_workspace_id = ?3, tool = ?4, workdir = ?5, custom_workdir = ?6, state = ?7, employee_no = ?8, updated_at_ms = ?9 WHERE workspace_id = ?10 AND id = ?11",
            params![
                input.name,
                input.role_id,
                role_workspace_id,
                input.tool,
                input.workdir,
                if input.custom_workdir { 1 } else { 0 },
                input.state.as_str(),
                input.employee_no,
                now_ms,
                input.workspace_id,
                input.agent_id,
            ],
        )
        .map_err(|error| AgentError::Storage {
            message: error.to_string(),
        })?;
        Ok(Self::hydrate_agent_profile(AgentProfile {
            id: input.agent_id,
            workspace_id: input.workspace_id,
            name: input.name,
            role_id: input.role_id,
            tool: input.tool,
            workdir: input.workdir,
            custom_workdir: input.custom_workdir,
            state: input.state,
            employee_no: input.employee_no,
            policy_snapshot_id,
            prompt_file_name: None,
            prompt_file_relative_path: None,
            created_at_ms,
            updated_at_ms: now_ms,
        }))
    }

    fn delete_agent(&self, workspace_id: &str, agent_id: &str) -> AgentResult<bool> {
        let conn = self.connection()?;
        let deleted = conn
            .execute(
                "DELETE FROM agents WHERE workspace_id = ?1 AND id = ?2",
                params![workspace_id, agent_id],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        Ok(deleted > 0)
    }

    fn upsert_role(&self, workspace_id: &str, role: AgentRole) -> AgentResult<AgentRole> {
        self.seed_defaults(workspace_id)?;
        let conn = self.connection()?;
        let now_ms = Self::now_ms();
        let scope = if workspace_id == GLOBAL_ROLE_WORKSPACE_ID {
            AgentRoleScope::Global
        } else {
            role.scope.clone()
        };
        conn.execute(
            "INSERT INTO agent_roles (id, workspace_id, role_key, role_name, department_id, scope, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id, workspace_id) DO UPDATE SET role_key = excluded.role_key, role_name = excluded.role_name, department_id = excluded.department_id, scope = excluded.scope, charter_path = excluded.charter_path, policy_json = excluded.policy_json, version = excluded.version, status = excluded.status, is_system = excluded.is_system, updated_at_ms = excluded.updated_at_ms",
            params![
                role.id,
                workspace_id,
                role.role_key,
                role.role_name,
                Self::normalize_department_id(role.department_id.as_str()),
                scope.as_str(),
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
            department_id: Self::normalize_department_id(role.department_id.as_str()).to_string(),
            scope,
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

    fn delete_role(&self, workspace_id: &str, role_id: &str) -> AgentResult<bool> {
        let conn = self.connection()?;
        let assigned_agents: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM agents WHERE role_id = ?1 AND role_workspace_id = ?2",
                params![role_id, workspace_id],
                |row| row.get(0),
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        if assigned_agents > 0 {
            return Err(AgentError::InvalidArgument {
                message: "role is still assigned to one or more agents".to_string(),
            });
        }
        let deleted = conn
            .execute(
                "DELETE FROM agent_roles WHERE workspace_id = ?1 AND id = ?2",
                params![workspace_id, role_id],
            )
            .map_err(|error| AgentError::Storage {
                message: error.to_string(),
            })?;
        Ok(deleted > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use gt_agent::{AgentRoleScope, AgentState, RoleStatus};

    fn test_repo(label: &str) -> SqliteAgentRepository {
        let db_path = std::env::temp_dir().join(format!(
            "gt-storage-agent-repo-{label}-{}.db",
            uuid::Uuid::new_v4()
        ));
        if db_path.exists() {
            let _ = std::fs::remove_file(&db_path);
        }
        let storage = SqliteStorage::new(&db_path).expect("create sqlite storage");
        let repo = SqliteAgentRepository::new(storage);
        repo.ensure_schema().expect("ensure schema");
        repo
    }

    fn repo_for_db_path(db_path: &Path) -> SqliteAgentRepository {
        let storage = SqliteStorage::new(db_path).expect("create sqlite storage");
        SqliteAgentRepository::new(storage)
    }

    fn install_legacy_agent_schema(db_path: &Path) {
        if db_path.exists() {
            let _ = std::fs::remove_file(db_path);
        }
        let connection = rusqlite::Connection::open(db_path).expect("open sqlite db");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE org_departments (
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
                CREATE TABLE agent_roles (
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
                CREATE TABLE agents (
                  id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  role_id TEXT NOT NULL,
                  tool TEXT NOT NULL DEFAULT 'codex cli',
                  workdir TEXT,
                  custom_workdir INTEGER NOT NULL DEFAULT 0,
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
                CREATE INDEX idx_agent_roles_workspace_key
                  ON agent_roles(workspace_id, role_key);
                CREATE INDEX idx_agent_roles_workspace_department
                  ON agent_roles(workspace_id, department_id);
                CREATE INDEX idx_agents_workspace_role
                  ON agents(workspace_id, role_id);
                "#,
            )
            .expect("install legacy schema");
    }

    fn global_workspace_id() -> &'static str {
        "__global__"
    }

    fn sample_role(
        workspace_id: &str,
        role_id: &str,
        role_key: &str,
        role_name: &str,
    ) -> AgentRole {
        AgentRole {
            id: role_id.to_string(),
            workspace_id: workspace_id.to_string(),
            role_key: role_key.to_string(),
            role_name: role_name.to_string(),
            department_id: String::new(),
            scope: if workspace_id == global_workspace_id() {
                AgentRoleScope::Global
            } else {
                AgentRoleScope::Workspace
            },
            charter_path: None,
            policy_json: Some("{}".to_string()),
            version: 1,
            status: RoleStatus::Active,
            is_system: false,
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    #[test]
    fn list_roles_includes_global_and_workspace_roles() {
        let repo = test_repo("list-roles");
        repo.upsert_role(
            global_workspace_id(),
            sample_role(
                global_workspace_id(),
                "role_global_strategy",
                "strategy",
                "Global Strategy",
            ),
        )
        .expect("save global role");
        repo.upsert_role(
            "ws_alpha",
            sample_role(
                "ws_alpha",
                "role_workspace_architect",
                "architect",
                "Workspace Architect",
            ),
        )
        .expect("save workspace role");

        let roles = repo.list_roles("ws_alpha").expect("list roles");

        assert!(roles.iter().any(|role| role.id == "role_global_strategy"));
        assert!(roles
            .iter()
            .any(|role| role.id == "role_workspace_architect"));
    }

    #[test]
    fn create_agent_accepts_role_from_global_scope() {
        let repo = test_repo("global-role-agent");
        repo.upsert_role(
            global_workspace_id(),
            sample_role(
                global_workspace_id(),
                "role_global_architect",
                "architect",
                "Global Architect",
            ),
        )
        .expect("save global role");

        let created = repo.create_agent(CreateAgentInput {
            workspace_id: "ws_alpha".to_string(),
            agent_id: Some("agent_alpha".to_string()),
            name: "Alpha".to_string(),
            role_id: "role_global_architect".to_string(),
            tool: "codex".to_string(),
            workdir: Some(".gtoffice/alpha".to_string()),
            custom_workdir: false,
            employee_no: None,
            state: AgentState::Ready,
        });

        assert!(created.is_ok(), "expected global roles to be assignable");
    }

    #[test]
    fn ensure_schema_migrates_legacy_agents_foreign_key_for_global_roles() {
        let db_path = std::env::temp_dir().join(format!(
            "gt-storage-agent-repo-legacy-fk-{}.db",
            uuid::Uuid::new_v4()
        ));
        install_legacy_agent_schema(&db_path);

        let repo = repo_for_db_path(&db_path);
        repo.ensure_schema().expect("migrate legacy schema");
        repo.seed_defaults(global_workspace_id())
            .expect("seed global defaults");
        repo.seed_defaults("ws_alpha")
            .expect("seed workspace defaults");

        let created = repo.create_agent(CreateAgentInput {
            workspace_id: "ws_alpha".to_string(),
            agent_id: Some("agent_alpha".to_string()),
            name: "Alpha".to_string(),
            role_id: "global_role_manager".to_string(),
            tool: "codex".to_string(),
            workdir: Some(".gtoffice/alpha".to_string()),
            custom_workdir: false,
            employee_no: None,
            state: AgentState::Ready,
        });

        assert!(
            created.is_ok(),
            "expected legacy schema migration to preserve global role assignment, got: {created:?}"
        );
    }
}
