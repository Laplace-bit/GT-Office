#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ChannelError {
    #[error("CHANNEL_CONNECTOR_AUTH_{category}: {detail}")]
    Auth {
        category: String,
        detail: String,
        retryable: bool,
    },

    #[error("{provider_display}")]
    Provider {
        status: String,
        detail: String,
        provider_code: Option<String>,
        http_status: Option<u16>,
        retryable: bool,
        provider_display: String,
    },

    #[error("{permission_display}")]
    PermissionDenied {
        detail: String,
        provider_code: Option<String>,
        permission_display: String,
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

    pub fn starts_with(&self, prefix: &str) -> bool {
        self.to_string().starts_with(prefix)
    }

    pub fn contains(&self, needle: &str) -> bool {
        self.to_string().contains(needle)
    }

    fn format_provider_display(status: &str, detail: &str, provider_code: Option<&str>, http_status: Option<u16>) -> String {
        let status_upper = status.to_uppercase();
        let mut s = format!("CHANNEL_CONNECTOR_PROVIDER_{status_upper}: {detail}");
        if let Some(code) = provider_code {
            s.push_str(&format!(" provider_code={code}"));
        }
        if let Some(status) = http_status {
            s.push_str(&format!(" http_status={status}"));
        }
        s
    }

    fn format_permission_display(detail: &str, provider_code: Option<&str>) -> String {
        let mut s = format!("CHANNEL_CONNECTOR_PERMISSION_DENIED: {detail}");
        if let Some(code) = provider_code {
            s.push_str(&format!(" provider_code={code}"));
        }
        s
    }

    pub fn provider_unavailable(detail: impl Into<String>) -> Self {
        let detail = detail.into();
        ChannelError::Provider {
            status: "unavailable".to_string(),
            detail: detail.clone(),
            provider_code: None,
            http_status: None,
            retryable: true,
            provider_display: Self::format_provider_display("unavailable", &detail, None, None),
        }
    }

    pub fn provider_unavailable_with_code(detail: impl Into<String>, provider_code: String, http_status: Option<u16>) -> Self {
        let detail = detail.into();
        ChannelError::Provider {
            status: "unavailable".to_string(),
            detail: detail.clone(),
            provider_code: Some(provider_code.clone()),
            http_status,
            retryable: true,
            provider_display: Self::format_provider_display("unavailable", &detail, Some(&provider_code), http_status),
        }
    }

    pub fn provider_denied(detail: impl Into<String>, provider_code: Option<String>) -> Self {
        let detail = detail.into();
        ChannelError::PermissionDenied {
            detail: detail.clone(),
            provider_code: provider_code.clone(),
            permission_display: Self::format_permission_display(&detail, provider_code.as_deref()),
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
        ChannelError::Config {
            detail: format!("{} account {} not found", channel.into(), account_id.into()),
        }
    }

    pub fn disabled(channel: impl Into<String>, account_id: impl Into<String>) -> Self {
        ChannelError::Config {
            detail: format!("{} account {} is disabled", channel.into(), account_id.into()),
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
        ChannelError::Auth {
            category: "SECRET_LOAD_FAILED".to_string(),
            detail: detail.into(),
            retryable: false,
        }
    }

    pub fn invalid_response(detail: impl Into<String>, http_status: Option<u16>) -> Self {
        let detail = detail.into();
        ChannelError::Provider {
            status: "invalid_response".to_string(),
            detail: detail.clone(),
            provider_code: None,
            http_status,
            retryable: false,
            provider_display: Self::format_provider_display("invalid_response", &detail, None, http_status),
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