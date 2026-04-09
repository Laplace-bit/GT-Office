use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage path invalid: {message}")]
    InvalidPath { message: String },
    #[error("storage io error: {message}")]
    Io { message: String },
    #[error("storage connection error: {message}")]
    Connection { message: String },
}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        StorageError::Io {
            message: error.to_string(),
        }
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        StorageError::Connection {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SqliteStorage {
    path: PathBuf,
}

impl SqliteStorage {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        } else {
            return Err(StorageError::InvalidPath {
                message: "missing parent directory".to_string(),
            });
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn open_connection(&self) -> Result<Connection, StorageError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
        let conn = Connection::open_with_flags(&self.path, flags)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;\
             PRAGMA journal_mode = WAL;\
             PRAGMA busy_timeout = 2000;",
        )?;
        Ok(conn)
    }
}
