//! VT100 terminal emulator engine

use crate::scrollback::ScrollbackStore;
use crate::snapshot::RenderedScreen;
use vt100::Parser;

/// Default scrollback buffer size in lines
const DEFAULT_SCROLLBACK_LINES: usize = 4000;

/// Default scrollback storage size in bytes (4MB)
const DEFAULT_SCROLLBACK_BYTES: usize = 4 * 1024 * 1024;

/// VT100 terminal emulator engine
pub struct VtEngine {
    parser: Parser,
    cols: u16,
    rows: u16,
    scrollback: ScrollbackStore,
}

impl VtEngine {
    /// Create a new VT engine with specified dimensions
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: Parser::new(rows, cols, DEFAULT_SCROLLBACK_LINES),
            cols,
            rows,
            scrollback: ScrollbackStore::new(DEFAULT_SCROLLBACK_BYTES),
        }
    }

    /// Create with custom scrollback size
    pub fn with_scrollback(rows: u16, cols: u16, scrollback_max_bytes: usize) -> Self {
        Self {
            parser: Parser::new(rows, cols, DEFAULT_SCROLLBACK_LINES),
            cols,
            rows,
            scrollback: ScrollbackStore::new(scrollback_max_bytes),
        }
    }

    /// Process incoming bytes
    pub fn process(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
        self.scrollback.push(bytes);
    }

    /// Resize terminal
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows, cols);
        self.rows = rows;
        self.cols = cols;
    }

    /// Generate rendered screen snapshot
    pub fn rendered_screen(&self, session_id: String) -> RenderedScreen {
        let screen = self.parser.screen();

        // Build content - contents_formatted already returns Vec<u8>
        let content = screen.contents_formatted();

        let title = screen.title();
        let title = if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        };

        RenderedScreen {
            session_id,
            revision: 0, // Will be set by caller
            content,
            cols: self.cols,
            rows: self.rows,
            cursor_row: screen.cursor_position().0 as u32,
            cursor_col: screen.cursor_position().1 as u32,
            scrollback_lines: self.scrollback.total_lines() as u32,
            title,
        }
    }

    /// Get scrollback content for session switch
    pub fn scrollback_content(&self) -> Vec<u8> {
        self.scrollback.extract_all()
    }

    /// Get current terminal size
    pub fn size(&self) -> (u16, u16) {
        (self.rows, self.cols)
    }
}
