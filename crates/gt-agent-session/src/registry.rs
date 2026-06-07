use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{SessionError, SessionResult};
use crate::git_diff::GitSessionDiff;
use crate::summary::extract_session_title;
use crate::types::{
    GtoSession, Lifecycle, MergeResult, Provider, ProviderSessionCandidate, SessionCard,
    SessionDetail, SessionStats,
};

const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS gto_sessions (
  gto_session_id     TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  station_id         TEXT NOT NULL,
  provider           TEXT NOT NULL,
  provider_session_id TEXT,
  provider_log_path  TEXT,
  terminal_session_id TEXT,
  lifecycle          TEXT NOT NULL DEFAULT 'live',
  title              TEXT,
  cwd                TEXT NOT NULL,
  started_at_ms     INTEGER NOT NULL,
  ended_at_ms       INTEGER,
  last_activity_at_ms INTEGER NOT NULL,
  created_at_ms      INTEGER NOT NULL,
  updated_at_ms      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_ws_agent
  ON gto_sessions(workspace_id, agent_id, last_activity_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle
  ON gto_sessions(lifecycle);

CREATE TABLE IF NOT EXISTS session_stats (
  gto_session_id      TEXT PRIMARY KEY REFERENCES gto_sessions(gto_session_id),
  git_start_commit     TEXT,
  git_end_commit       TEXT,
  files_changed        INTEGER DEFAULT 0,
  insertions           INTEGER DEFAULT 0,
  deletions            INTEGER DEFAULT 0,
  commits_ahead       INTEGER DEFAULT 0,
  updated_at_ms        INTEGER NOT NULL
);
";

pub struct SessionRegistry {
    db_path: PathBuf,
    conn: Mutex<Connection>,
}

impl SessionRegistry {
    pub fn open(db_path: PathBuf) -> SessionResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;",
        )?;
        let registry = Self {
            db_path,
            conn: Mutex::new(conn),
        };
        registry.ensure_schema()?;
        Ok(registry)
    }

    pub fn ensure_schema(&self) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(())
    }

    pub fn insert(&self, session: &GtoSession) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        conn.execute(
            "INSERT INTO gto_sessions (gto_session_id, workspace_id, agent_id, station_id, provider, provider_session_id, provider_log_path, terminal_session_id, lifecycle, title, cwd, started_at_ms, ended_at_ms, last_activity_at_ms, created_at_ms, updated_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                session.gto_session_id, session.workspace_id, session.agent_id,
                session.station_id, session.provider.as_str(),
                session.provider_session_id, session.provider_log_path,
                session.terminal_session_id, session.lifecycle.as_str(),
                session.title, session.cwd, session.started_at_ms,
                session.ended_at_ms, session.last_activity_at_ms,
                session.created_at_ms, session.updated_at_ms
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, gto_session_id: &str) -> SessionResult<Option<GtoSession>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT gto_session_id, workspace_id, agent_id, station_id, provider, provider_session_id, provider_log_path, terminal_session_id, lifecycle, title, cwd, started_at_ms, ended_at_ms, last_activity_at_ms, created_at_ms, updated_at_ms FROM gto_sessions WHERE gto_session_id = ?1"
        )?;
        let row = stmt
            .query_row(params![gto_session_id], |row| Ok(row_to_session(row)))
            .optional()?;
        Ok(row)
    }

    pub fn list_by_workspace(
        &self,
        workspace_id: &str,
        limit: u32,
        offset: u32,
    ) -> SessionResult<Vec<GtoSession>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT gto_session_id, workspace_id, agent_id, station_id, provider, provider_session_id, provider_log_path, terminal_session_id, lifecycle, title, cwd, started_at_ms, ended_at_ms, last_activity_at_ms, created_at_ms, updated_at_ms FROM gto_sessions WHERE workspace_id = ?1 ORDER BY last_activity_at_ms DESC LIMIT ?2 OFFSET ?3"
        )?;
        let rows = stmt.query_map(params![workspace_id, limit, offset], |row| {
            Ok(row_to_session(row))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn list_cards_by_workspace(
        &self,
        workspace_id: &str,
        provider: Option<Provider>,
        limit: u32,
        offset: u32,
    ) -> SessionResult<Vec<SessionCard>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let map_row = |row: &rusqlite::Row| {
            Ok(SessionCard {
                gto_session_id: row.get(0)?,
                workspace_id: row.get(1)?,
                agent_id: row.get(2)?,
                provider: Provider::from_str_opt(&row.get::<_, String>(3)?)
                    .unwrap_or(Provider::Claude),
                lifecycle: Lifecycle::from_str_opt(&row.get::<_, String>(4)?)
                    .unwrap_or(Lifecycle::Stopped),
                provider_session_id: row.get(5)?,
                title: row.get(6)?,
                cwd: row.get(7)?,
                started_at_ms: row.get(8)?,
                last_activity_at_ms: row.get(9)?,
                files_changed: row.get(10)?,
                insertions: row.get(11)?,
                deletions: row.get(12)?,
                commits_ahead: row.get(13)?,
            })
        };
        if let Some(provider) = provider {
            let mut stmt = conn.prepare(
                "SELECT s.gto_session_id, s.workspace_id, s.agent_id, s.provider, s.lifecycle, s.provider_session_id, s.title, s.cwd, s.started_at_ms, s.last_activity_at_ms, COALESCE(st.files_changed,0), COALESCE(st.insertions,0), COALESCE(st.deletions,0), COALESCE(st.commits_ahead,0) FROM gto_sessions s LEFT JOIN session_stats st ON s.gto_session_id = st.gto_session_id WHERE s.workspace_id = ?1 AND s.provider = ?2 ORDER BY s.last_activity_at_ms DESC LIMIT ?3 OFFSET ?4",
            )?;
            let rows = stmt.query_map(
                params![workspace_id, provider.as_str(), limit, offset],
                map_row,
            )?;
            return Ok(rows.filter_map(|r| r.ok()).collect());
        }
        let mut stmt = conn.prepare(
            "SELECT s.gto_session_id, s.workspace_id, s.agent_id, s.provider, s.lifecycle, s.provider_session_id, s.title, s.cwd, s.started_at_ms, s.last_activity_at_ms, COALESCE(st.files_changed,0), COALESCE(st.insertions,0), COALESCE(st.deletions,0), COALESCE(st.commits_ahead,0) FROM gto_sessions s LEFT JOIN session_stats st ON s.gto_session_id = st.gto_session_id WHERE s.workspace_id = ?1 ORDER BY s.last_activity_at_ms DESC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![workspace_id, limit, offset], map_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_detail(&self, gto_session_id: &str) -> SessionResult<Option<SessionDetail>> {
        let session = self.get(gto_session_id)?;
        let Some(session) = session else {
            return Ok(None);
        };
        let stats = self.get_stats(gto_session_id)?;
        Ok(Some(SessionDetail { session, stats }))
    }

    pub fn update_lifecycle(
        &self,
        gto_session_id: &str,
        lifecycle: Lifecycle,
        terminal_session_id: Option<&str>,
    ) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let now = now_ms();
        let ended_at_ms: Option<u64> = if lifecycle == Lifecycle::Stopped {
            Some(now)
        } else {
            None
        };
        conn.execute(
            "UPDATE gto_sessions SET lifecycle = ?1, terminal_session_id = ?2, ended_at_ms = ?3, updated_at_ms = ?4 WHERE gto_session_id = ?5",
            params![lifecycle.as_str(), terminal_session_id, ended_at_ms, now, gto_session_id],
        )?;
        Ok(())
    }

    pub fn update_title(&self, gto_session_id: &str, title: &str) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        conn.execute(
            "UPDATE gto_sessions SET title = ?1, updated_at_ms = ?2 WHERE gto_session_id = ?3",
            params![title, now_ms(), gto_session_id],
        )?;
        Ok(())
    }

    pub fn update_stats(&self, stats: &SessionStats) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO session_stats (gto_session_id, git_start_commit, git_end_commit, files_changed, insertions, deletions, commits_ahead, updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![stats.gto_session_id, stats.git_start_commit, stats.git_end_commit, stats.files_changed, stats.insertions, stats.deletions, stats.commits_ahead, stats.updated_at_ms],
        )?;
        Ok(())
    }

    pub fn get_stats(&self, gto_session_id: &str) -> SessionResult<Option<SessionStats>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT gto_session_id, git_start_commit, git_end_commit, files_changed, insertions, deletions, commits_ahead, updated_at_ms FROM session_stats WHERE gto_session_id = ?1"
        )?;
        let row = stmt
            .query_row(params![gto_session_id], |row| {
                Ok(SessionStats {
                    gto_session_id: row.get(0)?,
                    git_start_commit: row.get(1)?,
                    git_end_commit: row.get(2)?,
                    files_changed: row.get(3)?,
                    insertions: row.get(4)?,
                    deletions: row.get(5)?,
                    commits_ahead: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn mark_all_live_stopped(&self) -> SessionResult<u64> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let changed = conn.execute(
            "UPDATE gto_sessions SET lifecycle = 'stopped', terminal_session_id = NULL, updated_at_ms = ?1 WHERE lifecycle = 'live'",
            params![now_ms()],
        )?;
        Ok(changed as u64)
    }

    pub fn update_last_activity(
        &self,
        gto_session_id: &str,
        activity_ms: u64,
    ) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        conn.execute(
            "UPDATE gto_sessions SET last_activity_at_ms = ?1, updated_at_ms = ?1 WHERE gto_session_id = ?2",
            params![activity_ms, gto_session_id],
        )?;
        Ok(())
    }

    pub fn merge_candidates(
        &self,
        candidates: &[ProviderSessionCandidate],
        workspace_id: &str,
    ) -> SessionResult<MergeResult> {
        let mut new_count: u32 = 0;
        let mut updated_count: u32 = 0;
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        for c in candidates {
            let log_path_str = c.log_path.to_string_lossy().to_string();
            let title = extract_session_title(&c.log_path, c.provider);
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) FROM gto_sessions WHERE provider_log_path = ?1",
                params![log_path_str],
                |row| Ok(row.get::<_, i64>(0)? > 0),
            )?;
            if exists {
                conn.execute(
                    "UPDATE gto_sessions SET last_activity_at_ms = ?1, updated_at_ms = ?1, title = COALESCE(title, ?2) WHERE provider_log_path = ?3",
                    params![c.modified_at_ms, title, log_path_str],
                )?;
                updated_count += 1;
            } else {
                let session_id = uuid::Uuid::new_v4().to_string();
                let now = now_ms();
                conn.execute(
                    "INSERT INTO gto_sessions (gto_session_id, workspace_id, agent_id, station_id, provider, provider_session_id, provider_log_path, lifecycle, title, cwd, started_at_ms, last_activity_at_ms, created_at_ms, updated_at_ms)
                     VALUES (?1,?2,'unknown','unknown',?3,?4,?5,'stopped',?6,?7,?8,?8,?8,?8)",
                    params![
                        session_id,
                        workspace_id,
                        c.provider.as_str(),
                        c.provider_session_id,
                        log_path_str,
                        title,
                        c.cwd.to_string_lossy().to_string(),
                        c.modified_at_ms.max(now),
                    ],
                )?;
                new_count += 1;
            }
        }
        Ok(MergeResult {
            new_count,
            updated_count,
        })
    }

    /// Fill `title` for sessions that were imported before title extraction existed.
    pub fn backfill_missing_titles(
        &self,
        workspace_id: &str,
        provider: Option<Provider>,
        limit: u32,
    ) -> SessionResult<u32> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let mut stmt = match provider {
            Some(_) => conn.prepare(
                "SELECT gto_session_id, provider, provider_log_path FROM gto_sessions
                 WHERE workspace_id = ?1 AND provider = ?2 AND title IS NULL AND provider_log_path IS NOT NULL
                 ORDER BY last_activity_at_ms DESC LIMIT ?3",
            )?,
            None => conn.prepare(
                "SELECT gto_session_id, provider, provider_log_path FROM gto_sessions
                 WHERE workspace_id = ?1 AND title IS NULL AND provider_log_path IS NOT NULL
                 ORDER BY last_activity_at_ms DESC LIMIT ?2",
            )?,
        };

        let rows: Vec<(String, String, String)> = match provider {
            Some(provider_filter) => stmt
                .query_map(
                    params![workspace_id, provider_filter.as_str(), limit],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?,
            None => stmt
                .query_map(params![workspace_id, limit], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?,
        };
        drop(stmt);

        let mut updated: u32 = 0;
        for (gto_session_id, provider_str, log_path) in rows {
            let Some(provider) = Provider::from_str_opt(&provider_str) else {
                continue;
            };
            let Some(title) = extract_session_title(Path::new(&log_path), provider) else {
                continue;
            };
            let changed = conn.execute(
                "UPDATE gto_sessions SET title = ?1, updated_at_ms = ?2 WHERE gto_session_id = ?3 AND title IS NULL",
                params![title, now_ms(), gto_session_id],
            )?;
            if changed > 0 {
                updated += 1;
            }
        }
        Ok(updated)
    }

    pub fn launch_session(
        &self,
        workspace_id: &str,
        station_id: &str,
        agent_id: &str,
        provider: Provider,
        cwd: &str,
        terminal_session_id: Option<&str>,
    ) -> SessionResult<String> {
        let gto_session_id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let session = GtoSession {
            gto_session_id: gto_session_id.clone(),
            workspace_id: workspace_id.to_string(),
            agent_id: agent_id.to_string(),
            station_id: station_id.to_string(),
            provider,
            provider_session_id: None,
            provider_log_path: None,
            terminal_session_id: terminal_session_id.map(str::to_string),
            lifecycle: Lifecycle::Live,
            title: None,
            cwd: cwd.to_string(),
            started_at_ms: now,
            ended_at_ms: None,
            last_activity_at_ms: now,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.insert(&session)?;
        if let Some(start_commit) = GitSessionDiff::capture_commit(Path::new(cwd)) {
            self.update_stats(&SessionStats {
                gto_session_id: gto_session_id.clone(),
                git_start_commit: Some(start_commit),
                git_end_commit: None,
                files_changed: 0,
                insertions: 0,
                deletions: 0,
                commits_ahead: 0,
                updated_at_ms: now,
            })?;
        }
        Ok(gto_session_id)
    }

    pub fn resume_bind(
        &self,
        gto_session_id: &str,
        terminal_session_id: &str,
        station_id: &str,
        agent_id: &str,
    ) -> SessionResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| SessionError::Storage(e.to_string()))?;
        let now = now_ms();
        conn.execute(
            "UPDATE gto_sessions SET lifecycle = 'live', terminal_session_id = ?1, station_id = ?2, agent_id = ?3, ended_at_ms = NULL, last_activity_at_ms = ?4, updated_at_ms = ?4 WHERE gto_session_id = ?5",
            params![terminal_session_id, station_id, agent_id, now, gto_session_id],
        )?;
        Ok(())
    }

    pub fn finalize_stopped_stats(&self, gto_session_id: &str) -> SessionResult<()> {
        let session = self.get(gto_session_id)?;
        let Some(session) = session else {
            return Ok(());
        };
        let cwd = Path::new(&session.cwd);
        let Some(end_commit) = GitSessionDiff::capture_commit(cwd) else {
            return Ok(());
        };
        let existing = self.get_stats(gto_session_id)?;
        let Some(start_commit) = existing
            .as_ref()
            .and_then(|stats| stats.git_start_commit.clone())
            .or_else(|| GitSessionDiff::capture_commit(cwd))
        else {
            return Ok(());
        };
        let mut stats = match GitSessionDiff::compute_stats(cwd, &start_commit, &end_commit)? {
            Some(stats) => stats,
            None => SessionStats {
                gto_session_id: gto_session_id.to_string(),
                git_start_commit: Some(start_commit),
                git_end_commit: Some(end_commit.clone()),
                files_changed: 0,
                insertions: 0,
                deletions: 0,
                commits_ahead: 0,
                updated_at_ms: now_ms(),
            },
        };
        stats.gto_session_id = gto_session_id.to_string();
        stats.git_end_commit = Some(end_commit);
        self.update_stats(&stats)?;
        Ok(())
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }
}

fn row_to_session(row: &rusqlite::Row) -> GtoSession {
    GtoSession {
        gto_session_id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        agent_id: row.get(2).unwrap_or_default(),
        station_id: row.get(3).unwrap_or_default(),
        provider: row
            .get::<_, String>(4)
            .ok()
            .and_then(|s| Provider::from_str_opt(&s))
            .unwrap_or(Provider::Claude),
        provider_session_id: row.get(5).unwrap_or(None),
        provider_log_path: row.get(6).unwrap_or(None),
        terminal_session_id: row.get(7).unwrap_or(None),
        lifecycle: row
            .get::<_, String>(8)
            .ok()
            .and_then(|s| Lifecycle::from_str_opt(&s))
            .unwrap_or(Lifecycle::Stopped),
        title: row.get(9).unwrap_or(None),
        cwd: row.get(10).unwrap_or_default(),
        started_at_ms: row.get(11).unwrap_or(0),
        ended_at_ms: row.get(12).unwrap_or(None),
        last_activity_at_ms: row.get(13).unwrap_or(0),
        created_at_ms: row.get(14).unwrap_or(0),
        updated_at_ms: row.get(15).unwrap_or(0),
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{GtoSession, Lifecycle, Provider, ProviderSessionCandidate};

    fn temp_registry() -> SessionRegistry {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("sessions.db");
        SessionRegistry::open(db_path).unwrap()
    }

    fn make_session(id: &str, ws: &str, provider: Provider, lifecycle: Lifecycle) -> GtoSession {
        let now = now_ms();
        GtoSession {
            gto_session_id: id.to_string(),
            workspace_id: ws.to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "station-1".to_string(),
            provider,
            provider_session_id: None,
            provider_log_path: Some(format!("/tmp/{}.jsonl", id)),
            terminal_session_id: if lifecycle == Lifecycle::Live {
                Some("term-1".to_string())
            } else {
                None
            },
            lifecycle,
            title: Some("test session".to_string()),
            cwd: "/tmp".to_string(),
            started_at_ms: now,
            ended_at_ms: None,
            last_activity_at_ms: now,
            created_at_ms: now,
            updated_at_ms: now,
        }
    }

    #[test]
    fn test_schema_creates_tables() {
        let r = temp_registry();
        let conn = r.conn.lock().unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row: &rusqlite::Row| row.get(0))
            .unwrap()
            .filter_map(|r: Result<String, _>| r.ok())
            .collect();
        assert!(tables.contains(&"gto_sessions".to_string()));
        assert!(tables.contains(&"session_stats".to_string()));
    }

    #[test]
    fn test_schema_idempotent() {
        let r = temp_registry();
        assert!(r.ensure_schema().is_ok());
        assert!(r.ensure_schema().is_ok());
    }

    #[test]
    fn test_insert_and_get() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        let got = r.get("s1").unwrap().unwrap();
        assert_eq!(got.gto_session_id, "s1");
        assert_eq!(got.provider, Provider::Claude);
        assert_eq!(got.lifecycle, Lifecycle::Live);
    }

    #[test]
    fn test_get_nonexistent() {
        assert!(temp_registry().get("nope").unwrap().is_none());
    }

    #[test]
    fn test_list_by_workspace() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        r.insert(&make_session(
            "s2",
            "ws1",
            Provider::Codex,
            Lifecycle::Stopped,
        ))
        .unwrap();
        r.insert(&make_session(
            "s3",
            "ws2",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        assert_eq!(r.list_by_workspace("ws1", 100, 0).unwrap().len(), 2);
        assert_eq!(r.list_by_workspace("ws2", 100, 0).unwrap().len(), 1);
    }

    #[test]
    fn test_list_cards_join() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        r.update_stats(&SessionStats {
            gto_session_id: "s1".into(),
            git_start_commit: Some("abc".into()),
            git_end_commit: Some("def".into()),
            files_changed: 3,
            insertions: 42,
            deletions: 8,
            commits_ahead: 2,
            updated_at_ms: now_ms(),
        })
        .unwrap();
        let cards = r.list_cards_by_workspace("ws1", None, 100, 0).unwrap();
        assert_eq!(cards[0].files_changed, 3);
        assert_eq!(cards[0].insertions, 42);
    }

    #[test]
    fn test_list_cards_without_stats() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        let cards = r.list_cards_by_workspace("ws1", None, 100, 0).unwrap();
        assert_eq!(cards[0].files_changed, 0);
    }

    #[test]
    fn test_list_cards_by_provider() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        r.insert(&make_session(
            "s2",
            "ws1",
            Provider::Codex,
            Lifecycle::Stopped,
        ))
        .unwrap();
        let claude_cards = r
            .list_cards_by_workspace("ws1", Some(Provider::Claude), 100, 0)
            .unwrap();
        let codex_cards = r
            .list_cards_by_workspace("ws1", Some(Provider::Codex), 100, 0)
            .unwrap();
        assert_eq!(claude_cards.len(), 1);
        assert_eq!(codex_cards.len(), 1);
        assert_eq!(claude_cards[0].provider, Provider::Claude);
        assert_eq!(codex_cards[0].provider, Provider::Codex);
    }

    #[test]
    fn test_update_lifecycle() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        r.update_lifecycle("s1", Lifecycle::Stopped, None).unwrap();
        assert_eq!(r.get("s1").unwrap().unwrap().lifecycle, Lifecycle::Stopped);
    }

    #[test]
    fn test_update_lifecycle_resume() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        r.update_lifecycle("s1", Lifecycle::Live, Some("term-new"))
            .unwrap();
        assert_eq!(
            r.get("s1").unwrap().unwrap().terminal_session_id.as_deref(),
            Some("term-new")
        );
    }

    #[test]
    fn test_mark_all_live_stopped() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        r.insert(&make_session("s2", "ws1", Provider::Codex, Lifecycle::Live))
            .unwrap();
        r.insert(&make_session(
            "s3",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        assert_eq!(r.mark_all_live_stopped().unwrap(), 2);
        assert_eq!(r.get("s1").unwrap().unwrap().lifecycle, Lifecycle::Stopped);
    }

    #[test]
    fn test_update_and_get_stats() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        r.update_stats(&SessionStats {
            gto_session_id: "s1".into(),
            git_start_commit: Some("abc".into()),
            git_end_commit: Some("def".into()),
            files_changed: 5,
            insertions: 100,
            deletions: 20,
            commits_ahead: 3,
            updated_at_ms: now_ms(),
        })
        .unwrap();
        let stats = r.get_stats("s1").unwrap().unwrap();
        assert_eq!(stats.files_changed, 5);
        assert_eq!(stats.commits_ahead, 3);
    }

    #[test]
    fn test_merge_candidates_new() {
        let r = temp_registry();
        let result = r
            .merge_candidates(
                &[ProviderSessionCandidate {
                    provider: Provider::Claude,
                    provider_session_id: None,
                    log_path: PathBuf::from("/tmp/claude-1.jsonl"),
                    cwd: PathBuf::from("/tmp"),
                    modified_at_ms: now_ms(),
                    first_user_message: None,
                }],
                "ws1",
            )
            .unwrap();
        assert_eq!(result.new_count, 1);
        assert_eq!(result.updated_count, 0);
    }

    #[test]
    fn test_merge_candidates_dedup() {
        let r = temp_registry();
        let c = ProviderSessionCandidate {
            provider: Provider::Claude,
            provider_session_id: None,
            log_path: PathBuf::from("/tmp/claude-1.jsonl"),
            cwd: PathBuf::from("/tmp"),
            modified_at_ms: now_ms(),
            first_user_message: None,
        };
        r.merge_candidates(std::slice::from_ref(&c), "ws1").unwrap();
        let result = r.merge_candidates(&[c], "ws1").unwrap();
        assert_eq!(result.new_count, 0);
        assert_eq!(result.updated_count, 1);
    }

    #[test]
    fn test_get_detail() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Stopped,
        ))
        .unwrap();
        let detail = r.get_detail("s1").unwrap().unwrap();
        assert!(detail.stats.is_none());
    }

    #[test]
    fn test_update_title() {
        let r = temp_registry();
        r.insert(&make_session(
            "s1",
            "ws1",
            Provider::Claude,
            Lifecycle::Live,
        ))
        .unwrap();
        r.update_title("s1", "new title").unwrap();
        assert_eq!(
            r.get("s1").unwrap().unwrap().title.as_deref(),
            Some("new title")
        );
    }
}
