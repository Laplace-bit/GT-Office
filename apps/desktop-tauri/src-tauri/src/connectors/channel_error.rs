use std::fmt;

#[derive(Debug, Clone, thiserror::Error)]
pub enum ChannelError {
    #[error("CHANNEL_AUTH_{category}: {detail}")]
    Auth { category: String, detail: String, retryable: bool },

    #[error("CHANNEL_PROVIDER_{status}: {detail}{provider_code_fmt}{http_status_fmt}")]
    Provider {
        status: String,
        detail: String,
        provider_code: Option<String>,
        http_status: Option<u16>,
        retryable: bool,
        provider_code_fmt: ProviderCodeFmt,
        http_status_fmt: HttpStatusFmt,
    },

    #[error("CHANNEL_PERMISSION_DENIED: {detail}{provider_code_fmt}")]
    PermissionDenied {
        detail: String,
        provider_code: Option<String>,
        provider_code_fmt: ProviderCodeFmt,
    },

    #[error("CHANNEL_VALIDATION: {detail}")]
    Validation { detail: String },

    #[error("CHANNEL_STORE_{operation}: {detail}")]
    Store { operation: String, detail: String },

    #[error("CHANNEL_TRANSPORT: {detail} (retryable={retryable})")]
    Transport { detail: String, retryable: bool },

    #[error("CHANNEL_TIMEOUT: {detail} (retryable={retryable})")]
    Timeout { detail: String, retryable: bool },

    #[error("CHANNEL_CANCELLED: {detail}")]
    Cancelled { detail: String },

    #[error("CHANNEL_CONFIG: {detail}")]
    Config { detail: String },

    #[error("CHANNEL_UNSUPPORTED: {detail}")]
    Unsupported { detail: String },
}

#[derive(Debug, Clone)]
pub struct ProviderCodeFmt(pub Option<String>);

impl fmt::Display for ProviderCodeFmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Some(code) => write!(f, " provider_code={}", code),
            None => Ok(()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpStatusFmt(pub Option<u16>);

impl fmt::Display for HttpStatusFmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(status) => write!(f, " http_status={}", status),
            None => Ok(()),
        }
    }
}

impl ChannelError {
    pub fn retryable(&self) -> bool {
        match self {
            ChannelError::Auth { retryable, .. } => *retryable,
            ChannelError::Provider { retryable, .. } => *retryable,
            ChannelError::PermissionDenied { .. } => false,
            ChannelError::Validation { .. } => false,
            ChannelError::Store { .. } => false,
            ChannelError::Transport { retryable, .. } => *retryable,
            ChannelError::Timeout { retryable, .. } => *retryable,
            ChannelError::Cancelled { .. } => false,
            ChannelError::Config { .. } => false,
            ChannelError::Unsupported { .. } => false,
        }
    }

    pub fn provider_unavailable(detail: impl Into<String>) -> Self {
        ChannelError::Provider {
            status: "UNAVAILABLE".to_string(),
            detail: detail.into(),
            provider_code: None,
            http_status: None,
            retryable: true,
            provider_code_fmt: ProviderCodeFmt(None),
            http_status_fmt: HttpStatusFmt(None),
        }
    }

    pub fn provider_denied(detail: impl Into<String>, provider_code: Option<String>) -> Self {
        ChannelError::Provider {
            status: "DENIED".to_string(),
            detail: detail.into(),
            provider_code: provider_code.clone(),
            http_status: None,
            retryable: false,
            provider_code_fmt: ProviderCodeFmt(provider_code),
            http_status_fmt: HttpStatusFmt(None),
        }
    }

    pub fn auth_failed(detail: impl Into<String>) -> Self {
        ChannelError::Auth {
            category: "FAILED".to_string(),
            detail: detail.into(),
            retryable: false,
        }
    }

    pub fn not_found(channel: impl Into<String>, account_id: impl Into<String>) -> Self {
        ChannelError::Store {
            operation: "NOT_FOUND".to_string(),
            detail: format!("{}: {}", channel.into(), account_id.into()),
        }
    }

    pub fn disabled(channel: impl Into<String>, account_id: impl Into<String>) -> Self {
        ChannelError::Store {
            operation: "DISABLED".to_string(),
            detail: format!("{}: {}", channel.into(), account_id.into()),
        }
    }

    pub fn send_invalid(detail: impl Into<String>) -> Self {
        ChannelError::Validation {
            detail: detail.into(),
        }
    }

    pub fn store_read(detail: impl Into<String>) -> Self {
        ChannelError::Store {
            operation: "READ".to_string(),
            detail: detail.into(),
        }
    }

    pub fn store_write(detail: impl Into<String>) -> Self {
        ChannelError::Store {
            operation: "WRITE".to_string(),
            detail: detail.into(),
        }
    }

    pub fn secret_load_failed(detail: impl Into<String>) -> Self {
        ChannelError::Config {
            detail: format!("Secret load failed: {}", detail.into()),
        }
    }
}

impl From<ChannelError> for String {
    fn from(err: ChannelError) -> Self {
        err.to_string()
    }
}

impl From<std::io::Error> for ChannelError {
    fn from(err: std::io::Error) -> Self {
        let retryable = matches!(
            err.kind(),
            std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::Interrupted
                | std::io::ErrorKind::WouldBlock
        );
        ChannelError::Transport {
            detail: err.to_string(),
            retryable,
        }
    }
}

impl From<reqwest::Error> for ChannelError {
    fn from(err: reqwest::Error) -> Self {
        let retryable = err.is_timeout() || err.is_connect() || err.is_request();
        ChannelError::Transport {
            detail: err.to_string(),
            retryable,
        }
    }
}

#[cfg(test)]
#[path = "channel_error_tests.rs"]
mod tests;
