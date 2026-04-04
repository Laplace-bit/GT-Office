//! Rendered screen snapshot generation

use serde::{Deserialize, Serialize};

/// Rendered terminal screen snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedScreen {
    pub session_id: String,
    pub revision: u64,
    pub content: Vec<u8>,
    pub cols: u16,
    pub rows: u16,
    pub cursor_row: u32,
    pub cursor_col: u32,
    pub scrollback_lines: u32,
    pub title: Option<String>,
}
