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

/// Snapshot for inactive terminal display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    pub session_id: String,
    pub revision: u64,
    pub last_lines: String,
    pub cursor_row: u32,
    pub total_lines: u32,
    pub unread_bytes: u64,
    pub timestamp: u64,
}

impl RenderedScreen {
    /// Create a terminal snapshot for inactive display
    pub fn to_snapshot(&self, unread_bytes: u64, timestamp: u64) -> TerminalSnapshot {
        let last_lines = String::from_utf8_lossy(&self.content)
            .lines()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");

        TerminalSnapshot {
            session_id: self.session_id.clone(),
            revision: self.revision,
            last_lines,
            cursor_row: self.cursor_row,
            total_lines: self.scrollback_lines,
            unread_bytes,
            timestamp,
        }
    }
}
