use thiserror::Error;

#[derive(Debug, Error, Clone)]
pub enum SessionError {
    #[error("storage error: {0}")]
    Storage(String),

    #[error("scan error: {0}")]
    Scan(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("session not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),
}

impl From<rusqlite::Error> for SessionError {
    fn from(err: rusqlite::Error) -> Self {
        SessionError::Storage(err.to_string())
    }
}

impl From<std::io::Error> for SessionError {
    fn from(err: std::io::Error) -> Self {
        SessionError::Scan(err.to_string())
    }
}

pub type SessionResult<T> = Result<T, SessionError>;