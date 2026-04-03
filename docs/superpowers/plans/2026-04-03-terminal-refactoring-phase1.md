# Terminal Refactoring Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `vb-terminal-core` crate with VT Engine and Binary Channel infrastructure.

**Architecture:** New crate `vb-terminal-core` with VT state engine (vt100), ring buffer scrollback, and three-state output router. Existing `vb-terminal` becomes a thin re-export layer. New Tauri commands for Binary Channel and session activation.

**Tech Stack:** Rust, vt100 crate, portable-pty, Tauri v2 Channel API

---

## File Structure

### New Files (Create)
```
crates/vb-terminal-core/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── session.rs          # TerminalSessionState
│   ├── vt_engine.rs        # VtEngine wrapper
│   ├── scrollback.rs       # Ring buffer scrollback
│   ├── output_router.rs    # Three-state dispatch
│   ├── snapshot.rs         # RenderedScreen generation
│   └── types.rs            # Public types
└── tests/
    ├── vt_engine_tests.rs
    ├── scrollback_tests.rs
    └── output_router_tests.rs
```

### Modified Files
```
Cargo.toml                          # Add vb-terminal-core to workspace
crates/vb-terminal/Cargo.toml       # Add dependency on vb-terminal-core
crates/vb-terminal/src/lib.rs      # Re-export from vb-terminal-core
apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs  # New commands
```

---

## Task 1: Create vb-terminal-core Crate Skeleton

**Files:**
- Create: `crates/vb-terminal-core/Cargo.toml`
- Create: `crates/vb-terminal-core/src/lib.rs`
- Modify: `Cargo.toml` (workspace root)

- [ ] **Step 1: Create Cargo.toml for vb-terminal-core**

```toml
# crates/vb-terminal-core/Cargo.toml
[package]
name = "vb-terminal-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
thiserror = { workspace = true }
tracing = { workspace = true }
tokio = { workspace = true, features = ["sync", "time"] }
vt100 = "0.15"
portable-pty = "0.8"

[dev-dependencies]
pretty_assertions = "1"
```

- [ ] **Step 2: Create src/lib.rs skeleton**

```rust
// crates/vb-terminal-core/src/lib.rs

//! vb-terminal-core: Terminal session state management with VT engine
//!
//! This crate provides:
//! - VT100 state engine for terminal emulation
//! - Ring buffer scrollback storage
//! - Three-state output routing (Active/Visible/Hidden)
//! - Rendered screen snapshot generation

pub mod types;
pub mod scrollback;
pub mod vt_engine;
pub mod output_router;
pub mod snapshot;

pub use types::*;
pub use scrollback::ScrollbackStore;
pub use vt_engine::VtEngine;
pub use output_router::{OutputRouter, SessionVisibility};
pub use snapshot::RenderedScreen;
```

- [ ] **Step 3: Create types.rs**

```rust
// crates/vb-terminal-core/src/types.rs

use serde::{Deserialize, Serialize};

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
```

- [ ] **Step 4: Add to workspace**

```toml
# Cargo.toml (append to members array)
members = [
  # ... existing members ...
  "crates/vb-terminal-core",
]
```

- [ ] **Step 5: Verify crate compiles**

Run: `cargo check -p vb-terminal-core`
Expected: PASS (may warn about unused items)

- [ ] **Step 6: Commit skeleton**

```bash
git add crates/vb-terminal-core/Cargo.toml
git add crates/vb-terminal-core/src/lib.rs
git add crates/vb-terminal-core/src/types.rs
git add Cargo.toml
git commit -m "feat(terminal-core): create crate skeleton

- Add vb-terminal-core to workspace
- Define module structure
- Add core types for visibility and output"
```

---

## Task 2: Implement Scrollback Ring Buffer

**Files:**
- Create: `crates/vb-terminal-core/src/scrollback.rs`
- Create: `crates/vb-terminal-core/tests/scrollback_tests.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/vb-terminal-core/tests/scrollback_tests.rs

use vb_terminal_core::ScrollbackStore;

#[test]
fn test_scrollback_push_and_extract() {
    let mut store = ScrollbackStore::new(100);
    
    // Push some data
    store.push(b"line1\n".as_slice());
    store.push(b"line2\n".as_slice());
    
    // Extract all
    let content = store.extract_all();
    let text = String::from_utf8_lossy(&content);
    
    assert!(text.contains("line1"));
    assert!(text.contains("line2"));
}

#[test]
fn test_scrollback_ring_overflow() {
    let mut store = ScrollbackStore::new(10); // Very small buffer
    
    // Push more than capacity
    store.push(b"1234567890".as_slice()); // 10 bytes
    store.push(b"ABCDE".as_slice());      // 5 more, should wrap
    
    let content = store.extract_all();
    assert_eq!(content.len(), 10);
}

#[test]
fn test_scrollback_line_count() {
    let mut store = ScrollbackStore::new(1024);
    
    store.push(b"line1\nline2\nline3\n".as_slice());
    
    assert_eq!(store.total_lines(), 3);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vb-terminal-core --test scrollback_tests`
Expected: FAIL (ScrollbackStore not implemented)

- [ ] **Step 3: Implement ScrollbackStore**

```rust
// crates/vb-terminal-core/src/scrollback.rs

use std::time::{SystemTime, UNIX_EPOCH};

/// Ring buffer for terminal scrollback storage
pub struct ScrollbackStore {
    buffer: Vec<u8>,
    write_pos: usize,
    total_lines: usize,
    max_bytes: usize,
}

impl ScrollbackStore {
    /// Create a new scrollback store with specified byte capacity
    pub fn new(max_bytes: usize) -> Self {
        let capacity = max_bytes.max(1024); // Minimum 1KB
        Self {
            buffer: vec![0; capacity],
            write_pos: 0,
            total_lines: 0,
            max_bytes: capacity,
        }
    }
    
    /// Push a chunk of bytes into the buffer
    pub fn push(&mut self, chunk: &[u8]) {
        for &byte in chunk {
            self.buffer[self.write_pos] = byte;
            self.write_pos = (self.write_pos + 1) % self.max_bytes;
        }
        self.total_lines += chunk.iter().filter(|&&b| b == b'\n').count();
    }
    
    /// Extract all content from the ring buffer
    /// Returns bytes in chronological order
    pub fn extract_all(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.max_bytes);
        // Read from write_pos to end
        result.extend_from_slice(&self.buffer[self.write_pos..]);
        // Read from start to write_pos
        result.extend_from_slice(&self.buffer[..self.write_pos]);
        result
    }
    
    /// Get total line count
    pub fn total_lines(&self) -> usize {
        self.total_lines
    }
    
    /// Get current byte count (always equals max_bytes after first fill)
    pub fn byte_count(&self) -> usize {
        self.max_bytes
    }
    
    /// Clear the buffer
    pub fn clear(&mut self) {
        self.buffer.fill(0);
        self.write_pos = 0;
        self.total_lines = 0;
    }
}

fn now_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p vb-terminal-core --test scrollback_tests`
Expected: PASS

- [ ] **Step 5: Commit scrollback implementation**

```bash
git add crates/vb-terminal-core/src/scrollback.rs
git add crates/vb-terminal-core/tests/scrollback_tests.rs
git commit -m "feat(terminal-core): implement ring buffer scrollback

- Push bytes with ring buffer overflow
- Extract all content in chronological order
- Track line count"
```

---

## Task 3: Implement VT Engine

**Files:**
- Create: `crates/vb-terminal-core/src/vt_engine.rs`
- Create: `crates/vb-terminal-core/tests/vt_engine_tests.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/vb-terminal-core/tests/vt_engine_tests.rs

use vb_terminal_core::VtEngine;

#[test]
fn test_vt_engine_process_text() {
    let mut engine = VtEngine::new(24, 80);
    
    engine.process(b"Hello, World!");
    
    let screen = engine.rendered_screen("test-session".to_string());
    assert!(screen.content.contains("Hello"));
}

#[test]
fn test_vt_engine_resize() {
    let mut engine = VtEngine::new(24, 80);
    
    engine.process(b"Test content");
    engine.resize(40, 120);
    
    let screen = engine.rendered_screen("test".to_string());
    assert_eq!(screen.cols, 120);
    assert_eq!(screen.rows, 40);
}

#[test]
fn test_vt_engine_cursor_position() {
    let mut engine = VtEngine::new(24, 80);
    
    engine.process(b"ABC");
    
    let screen = engine.rendered_screen("test".to_string());
    // Cursor should be after "ABC" at column 3
    assert_eq!(screen.cursor_col, 3);
    assert_eq!(screen.cursor_row, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vb-terminal-core --test vt_engine_tests`
Expected: FAIL (VtEngine not implemented)

- [ ] **Step 3: Implement VtEngine**

```rust
// crates/vb-terminal-core/src/vt_engine.rs

use crate::snapshot::RenderedScreen;
use crate::scrollback::ScrollbackStore;
use vt100::Parser;

/// VT100 terminal emulator engine
pub struct VtEngine {
    parser: Parser,
    cols: u16,
    rows: u16,
    scrollback: ScrollbackStore,
}

impl VtEngine {
    /// Create a new VT engine with specified dimensions
    pub fn(rows: u16, cols: u16) -> Self {
        let scrollback_lines = 4000; // Default scrollback
        Self {
            parser: Parser::new(rows, cols, scrollback_lines),
            cols,
            rows,
            scrollback: ScrollbackStore::new(4 * 1024 * 1024), // 4MB
        }
    }
    
    /// Create with custom scrollback size
    pub fn with_scrollback(rows: u16, cols: u16, scrollback_max_bytes: usize) -> Self {
        let scrollback_lines = 4000;
        Self {
            parser: Parser::new(rows, cols, scrollback_lines),
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
        
        // Build content string
        let content = screen.contents_formatted().into_bytes();
        
        RenderedScreen {
            session_id,
            revision: 0, // Will be set by caller
            content,
            cols: self.cols,
            rows: self.rows,
            cursor_row: screen.cursor_position().0 as u32,
            cursor_col: screen.cursor_position().1 as u32,
            scrollback_lines: self.scrollback.total_lines() as u32,
            title: screen.title().map(String::from),
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
```

- [ ] **Step 4: Update lib.rs to include vt_engine**

```rust
// crates/vb-terminal-core/src/lib.rs (update)
pub mod types;
pub mod scrollback;
pub mod vt_engine;
pub mod output_router;
pub mod snapshot;

pub use types::*;
pub use scrollback::ScrollbackStore;
pub use vt_engine::VtEngine;
pub use output_router::{OutputRouter, SessionVisibility};
pub use snapshot::RenderedScreen;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p vb-terminal-core --test vt_engine_tests`
Expected: PASS

- [ ] **Step 6: Commit VT engine implementation**

```bash
git add crates/vb-terminal-core/src/vt_engine.rs
git add crates/vb-terminal-core/tests/vt_engine_tests.rs
git commit -m "feat(terminal-core): implement VT100 engine wrapper

- Wrap vt100::Parser with GT Office API
- Process bytes and track scrollback
- Generate rendered screen snapshots"
```

---

## Task 4: Implement RenderedScreen Snapshot

**Files:**
- Create: `crates/vb-terminal-core/src/snapshot.rs`

- [ ] **Step 1: Implement RenderedScreen struct**

```rust
// crates/vb-terminal-core/src/snapshot.rs

use serde::{Deserialize, Serialize};

/// Rendered screen from VT state
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
```

- [ ] **Step 2: Update types.rs**

```rust
// crates/vb-terminal-core/src/types.rs (append)

impl SessionVisibility {
    pub fn is_active(&self) -> bool {
        matches!(self, SessionVisibility::Active)
    }
    
    pub fn is_visible(&self) -> bool {
        matches!(self, SessionVisibility::Visible | SessionVisibility::Active)
    }
}
```

- [ ] **Step 3: Verify crate compiles**

Run: `cargo check -p vb-terminal-core`
Expected: PASS

- [ ] **Step 4: Commit snapshot types**

```bash
git add crates/vb-terminal-core/src/snapshot.rs
git commit -m "feat(terminal-core): add RenderedScreen and TerminalSnapshot types

- RenderedScreen for full terminal content
- TerminalSnapshot for inactive display"
```

---

## Task 5: Implement Output Router

**Files:**
- Create: `crates/vb-terminal-core/src/output_router.rs`
- Create: `crates/vb-terminal-core/tests/output_router_tests.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/vb-terminal-core/tests/output_router_tests.rs

use vb_terminal_core::{OutputRouter, SessionVisibility, OutputRouterConfig};

#[test]
fn test_router_dispatch_active() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);
    
    router.register_session("session-1", 24, 80);
    router.set_visibility("session-1", SessionVisibility::Active);
    
    // Dispatch output
    router.dispatch_output("session-1", b"test output".as_slice());
    
    // Should have batched output
    let batches = router.flush_active_batches();
    assert_eq!(batches.len(), 1);
    assert!(batches[0].1.contains(&b't'));
}

#[test]
fn test_router_dispatch_hidden() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);
    
    router.register_session("session-2", 24, 80);
    router.set_visibility("session-2", SessionVisibility::Hidden);
    
    router.dispatch_output("session-2", b"hidden output".as_slice());
    
    // No batches for hidden session
    let batches = router.flush_active_batches();
    assert!(batches.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vb-terminal-core --test output_router_tests`
Expected: FAIL (OutputRouter not implemented)

- [ ] **Step 3: Implement OutputRouter**

```rust
// crates/vb-terminal-core/src/output_router.rs

use crate::types::{OutputRouterConfig, SessionVisibility, OutputChunk};
use crate::vt_engine::VtEngine;
use crate::snapshot::RenderedScreen;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Terminal session state managed by output router
pub struct TerminalSessionState {
    pub session_id: String,
    pub workspace_id: String,
    pub visibility: SessionVisibility,
    pub vt_engine: VtEngine,
    pub output_seq: u64,
    pub batch_buffer: Vec<u8>,
    pub batch_dirty: bool,
    pub hidden_unread_bytes: u64,
}

/// Three-state output router
pub struct OutputRouter {
    sessions: HashMap<String, TerminalSessionState>,
    config: OutputRouterConfig,
}

impl OutputRouter {
    pub fn new(config: OutputRouterConfig) -> Self {
        Self {
            sessions: HashMap::new(),
            config,
        }
    }
    
    /// Register a new terminal session
    pub fn register_session(&mut self, session_id: &str, rows: u16, cols: u16) {
        let vt_engine = VtEngine::with_scrollback(
            rows,
            cols,
            self.config.scrollback_max_bytes,
        );
        
        self.sessions.insert(session_id.to_string(), TerminalSessionState {
            session_id: session_id.to_string(),
            workspace_id: String::new(),
            visibility: SessionVisibility::Hidden,
            vt_engine,
            output_seq: 0,
            batch_buffer: Vec::new(),
            batch_dirty: false,
            hidden_unread_bytes: 0,
        });
    }
    
    /// Set session visibility
    pub fn set_visibility(&mut self, session_id: &str, visibility: SessionVisibility) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.visibility = visibility;
        }
    }
    
    /// Dispatch PTY output to session
    pub fn dispatch_output(&mut self, session_id: &str, chunk: &[u8]) {
        let Some(session) = self.sessions.get_mut(session_id) else {
            return;
        };
        
        // Always update VT state
        session.vt_engine.process(chunk);
        session.output_seq += 1;
        
        match session.visibility {
            SessionVisibility::Active => {
                session.batch_buffer.extend_from_slice(chunk);
                session.batch_dirty = true;
            }
            SessionVisibility::Visible => {
                // Mark for snapshot update (handled separately)
                session.hidden_unread_bytes += chunk.len() as u64;
            }
            SessionVisibility::Hidden => {
                session.hidden_unread_bytes += chunk.len() as u64;
            }
        }
    }
    
    /// Flush active session batches
    pub fn flush_active_batches(&mut self) -> Vec<(String, Vec<u8>)> {
        self.sessions
            .iter_mut()
            .filter(|(_, s)| s.visibility == SessionVisibility::Active && s.batch_dirty)
            .map(|(id, s)| {
                let batch = std::mem::take(&mut s.batch_buffer);
                s.batch_dirty = false;
                (id.clone(), batch)
            })
            .collect()
    }
    
    /// Get rendered screen for session activation
    pub fn get_rendered_screen(&self, session_id: &str) -> Option<RenderedScreen> {
        let session = self.sessions.get(session_id)?;
        let mut screen = session.vt_engine.rendered_screen(session_id.to_string());
        screen.revision = session.output_seq;
        Some(screen)
    }
    
    /// Activate a session (switch from another)
    pub fn activate_session(&mut self, session_id: &str) -> Option<RenderedScreen> {
        // Deactivate all other sessions
        for (id, session) in self.sessions.iter_mut() {
            if id != session_id {
                session.visibility = SessionVisibility::Visible;
            }
        }
        
        // Activate target session
        let session = self.sessions.get_mut(session_id)?;
        session.visibility = SessionVisibility::Active;
        session.hidden_unread_bytes = 0;
        
        // Return rendered screen
        let mut screen = session.vt_engine.rendered_screen(session_id.to_string());
        screen.revision = session.output_seq;
        Some(screen)
    }
    
    /// Resize session terminal
    pub fn resize_session(&mut self, session_id: &str, rows: u16, cols: u16) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.vt_engine.resize(rows, cols);
        }
    }
    
    /// Remove session
    pub fn remove_session(&mut self, session_id: &str) -> bool {
        self.sessions.remove(session_id).is_some()
    }
    
    /// Check if session exists
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }
}

fn now_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p vb-terminal-core --test output_router_tests`
Expected: PASS

- [ ] **Step 5: Commit output router**

```bash
git add crates/vb-terminal-core/src/output_router.rs
git add crates/vb-terminal-core/tests/output_router_tests.rs
git commit -m "feat(terminal-core): implement three-state output router

- Active: batch output for direct forwarding
- Visible: track unread bytes for snapshot
- Hidden: maintain VT state only"
```

---

## Task 6: Update vb-terminal to Re-export vb-terminal-core

**Files:**
- Modify: `crates/vb-terminal/Cargo.toml`
- Modify: `crates/vb-terminal/src/lib.rs`

- [ ] **Step 1: Add dependency to vb-terminal**

```toml
# crates/vb-terminal/Cargo.toml (add to dependencies)
vt100 = "0.15"
vb-terminal-core = { path = "../vb-terminal-core" }
```

- [ ] **Step 2: Update vb-terminal lib.rs to re-export**

```rust
// crates/vb-terminal/src/lib.rs (add at top after imports)

// Re-export from vb-terminal-core
pub use vb_terminal_core::{
    SessionVisibility,
    OutputRouter,
    OutputRouterConfig,
    RenderedScreen,
    TerminalSnapshot,
    VtEngine,
    ScrollbackStore,
};

// Keep existing exports below...
```

- [ ] **Step 3: Verify everything compiles**

Run: `cargo check -p vb-terminal`
Expected: PASS

- [ ] **Step 4: Commit vb-terminal update**

```bash
git add crates/vb-terminal/Cargo.toml
git add crates/vb-terminal/src/lib.rs
git commit -m "feat(vb-terminal): re-export vb-terminal-core types

- Add vb-terminal-core dependency
- Re-export core types for backward compatibility"
```

---

## Task 7: Add New Tauri Commands

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs`

- [ ] **Step 1: Add terminal_activate command**

```rust
// apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs
// Add after existing imports

use vb_terminal_core::{OutputRouter, SessionVisibility, RenderedScreen};
use std::sync::Mutex;

// Add to AppState or create new state field for OutputRouter
// For now, we'll use a placeholder that works with existing architecture

#[tauri::command]
pub fn terminal_activate(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    // Get session info
    let sessions = state.terminal_provider.list_sessions();
    if !sessions.iter().any(|s| s.session_id == session_id) {
        return Err(format!("TERMINAL_NOT_FOUND: session '{}' does not exist", session_id));
    }
    
    // For Phase 1, return a placeholder response
    // Full implementation requires OutputRouter integration
    Ok(json!({
        "sessionId": session_id,
        "revision": 0,
        "content": "",
        "cols": 80,
        "rows": 24,
        "cursorRow": 0,
        "cursorCol": 0,
        "scrollbackLines": 0,
        "title": null
    }))
}

#[tauri::command]
pub fn terminal_get_rendered_screen(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    // Placeholder for Phase 1
    Ok(json!({
        "sessionId": session_id,
        "revision": 0,
        "content": "",
        "cols": 80,
        "rows": 24,
        "cursorRow": 0,
        "cursorCol": 0,
        "scrollbackLines": 0,
        "title": null
    }))
}

#[tauri::command]
pub fn terminal_open_output_channel(
    session_id: String,
    channel: tauri::ipc::Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    // Placeholder for Phase 1 - Binary Channel setup
    Ok(json!({
        "sessionId": session_id,
        "channelBound": true
    }))
}
```

- [ ] **Step 2: Register new commands in main.rs**

Find the invoke_handler in `apps/desktop-tauri/src-tauri/src/main.rs` and add the new commands:

```rust
// In the invoke_handler, add:
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    terminal::terminal_activate,
    terminal::terminal_get_rendered_screen,
    terminal::terminal_open_output_channel,
])
```

- [ ] **Step 3: Verify Tauri app compiles**

Run: `cargo check -p gtoffice-desktop-tauri`
Expected: PASS

- [ ] **Step 4: Commit new Tauri commands**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/terminal/mod.rs
git add apps/desktop-tauri/src-tauri/src/main.rs
git commit -m "feat(terminal): add new Tauri commands for Binary Channel

- terminal_activate: switch active session
- terminal_get_rendered_screen: get terminal content
- terminal_open_output_channel: setup binary IPC"
```

---

## Task 8: Add Frontend TypeScript Types

**Files:**
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`

- [ ] **Step 1: Add RenderedScreen type**

```typescript
// apps/desktop-web/src/shell/integration/desktop-api.ts
// Add after existing terminal types

export interface RenderedScreen {
  sessionId: string
  revision: number
  content: number[]  // Vec<u8> serialized as array
  cols: number
  rows: number
  cursorRow: number
  cursorCol: number
  scrollbackLines: number
  title: string | null
}

export interface TerminalSnapshot {
  sessionId: string
  revision: number
  lastLines: string
  cursorRow: number
  totalLines: number
  unreadBytes: number
  timestamp: number
}

export interface OutputChunk {
  sessionId: string
  seq: number
  data: number[]
  tsMs: number
}
```

- [ ] **Step 2: Add API methods to desktopApi**

```typescript
// In desktopApi class, add:

async terminalActivate(sessionId: string): Promise<RenderedScreen> {
  return this.invoke('terminal_activate', { sessionId })
}

async terminalGetRenderedScreen(sessionId: string): Promise<RenderedScreen> {
  return this.invoke('terminal_get_rendered_screen', { sessionId })
}

async terminalOpenOutputChannel(sessionId: string): Promise<{ sessionId: string; channelBound: boolean }> {
  return this.invoke('terminal_open_output_channel', { sessionId })
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck --prefix apps/desktop-web`
Expected: PASS

- [ ] **Step 4: Commit frontend types**

```bash
git add apps/desktop-web/src/shell/integration/desktop-api.ts
git commit -m "feat(terminal): add frontend types for new terminal API

- RenderedScreen for full terminal content
- TerminalSnapshot for inactive display
- OutputChunk for binary channel"
```

---

## Task 9: Integration Test

**Files:**
- Create: `crates/vb-terminal-core/tests/integration_tests.rs`

- [ ] **Step 1: Write integration test**

```rust
// crates/vb-terminal-core/tests/integration_tests.rs

use vb_terminal_core::{OutputRouter, SessionVisibility, OutputRouterConfig};

#[test]
fn test_full_session_lifecycle() {
    let config = OutputRouterConfig::default();
    let mut router = OutputRouter::new(config);
    
    // Register session
    router.register_session("test-session", 24, 80);
    assert!(router.has_session("test-session"));
    
    // Set active
    router.set_visibility("test-session", SessionVisibility::Active);
    
    // Process output
    router.dispatch_output("test-session", b"$ echo hello\n".as_slice());
    router.dispatch_output("test-session", b"hello\n".as_slice());
    
    // Flush batch
    let batches = router.flush_active_batches();
    assert!(!batches.is_empty());
    
    // Get rendered screen
    router.activate_session("test-session");
    let screen = router.get_rendered_screen("test-session").unwrap();
    assert!(screen.content.len() > 0);
    
    // Deactivate
    router.set_visibility("test-session", SessionVisibility::Hidden);
    router.dispatch_output("test-session", b"more output\n".as_slice());
    
    // Hidden session should not produce batches
    let batches = router.flush_active_batches();
    assert!(batches.is_empty());
    
    // Cleanup
    assert!(router.remove_session("test-session"));
    assert!(!router.has_session("test-session"));
}
```

- [ ] **Step 2: Run integration test**

Run: `cargo test -p vb-terminal-core --test integration_tests`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `cargo test -p vb-terminal-core`
Expected: All tests PASS

- [ ] **Step 4: Commit integration test**

```bash
git add crates/vb-terminal-core/tests/integration_tests.rs
git commit -m "test(terminal-core): add session lifecycle integration test"
```

---

## Task 10: Final Verification and Cleanup

- [ ] **Step 1: Run full workspace check**

Run: `cargo check --workspace`
Expected: PASS

- [ ] **Step 2: Run clippy**

Run: `cargo clippy -p vb-terminal-core -- -D warnings`
Expected: PASS (fix any warnings)

- [ ] **Step 3: Run formatter**

Run: `cargo fmt -p vb-terminal-core`

- [ ] **Step 4: Run frontend typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Create summary commit**

```bash
git add -A
git commit -m "feat(terminal): complete Phase 1 - Backend VT Engine

vb-terminal-core crate:
- VT100 engine wrapper (vt100 crate)
- Ring buffer scrollback (4MB default)
- Three-state output router (Active/Visible/Hidden)
- RenderedScreen and TerminalSnapshot types

Integration:
- vb-terminal re-exports core types
- New Tauri commands (terminal_activate, etc)
- Frontend TypeScript types

Tests:
- scrollback_tests
- vt_engine_tests
- output_router_tests
- integration_tests"
```

---

## Verification Checklist

- [ ] `cargo test -p vb-terminal-core` passes
- [ ] `cargo check --workspace` passes
- [ ] `npm run typecheck` passes
- [ ] All new code has tests
- [ ] No clippy warnings
- [ ] Code formatted with rustfmt
- [ ] Commits follow conventional format

---

## Next Steps (Phase 2)

After Phase 1 is complete:
1. Implement `TerminalSurfaceController` in frontend
2. Create `ActiveTerminalSurface` component
3. Create `InactiveTerminalSnapshot` component
4. Connect Binary Channel to frontend
5. Integrate with ShellRoot