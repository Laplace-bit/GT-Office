use std::io;

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("protocol codec error: {0}")]
    Codec(#[from] Box<bincode::ErrorKind>),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("path denied: {0}")]
    PathDenied(String),
    #[error("search error: {0}")]
    Search(String),
    #[error("terminal error: {0}")]
    Terminal(String),
}

impl DaemonError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "IO_ERROR",
            Self::Codec(_) => "PROTOCOL_CODEC_ERROR",
            Self::Protocol(_) => "PROTOCOL_ERROR",
            Self::PathDenied(_) => "SECURITY_PATH_DENIED",
            Self::Search(_) => "SEARCH_ERROR",
            Self::Terminal(_) => "TERMINAL_ERROR",
        }
    }
}

pub type DaemonResult<T> = Result<T, DaemonError>;
