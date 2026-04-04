use serde::Serialize;

/// Session visibility state for output routing
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionVisibility {
    /// Currently active - raw byte stream forwarded directly
    Active,
    /// Visible but not active - low frequency snapshot push
    Visible,
    /// Hidden - only maintain VT state, no push
    Hidden,
}

/// Output chunk with sequence number
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub session_id: String,
    pub seq: u64,
    pub data: Vec<u8>,
    pub ts_ms: u64,
}

/// Configuration for output router
pub struct OutputRouterConfig {
    pub batch_window_ms: u64,
    pub scrollback_max_lines: usize,
    pub scrollback_max_bytes: usize,
}

impl Default for OutputRouterConfig {
    fn default() -> Self {
        Self {
            batch_window_ms: 8,
            scrollback_max_lines: 10000,
            scrollback_max_bytes: 4 * 1024 * 1024, // 4MB
        }
    }
}
