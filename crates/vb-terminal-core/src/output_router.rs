//! Output routing for terminal sessions
//!
//! Manages the three-state output routing: Active, Visible, Hidden

use std::collections::HashMap;

use crate::snapshot::RenderedScreen;
use crate::types::*;
use crate::vt_engine::VtEngine;

/// Re-export visibility type
pub use crate::types::SessionVisibility;

/// Internal state for a terminal session
struct TerminalSessionState {
    /// VT engine for this session
    vt: VtEngine,
    /// Current visibility state
    visibility: SessionVisibility,
    /// Output sequence number for this session
    output_seq: u64,
    /// Unread bytes counter (for Visible sessions)
    unread_bytes: u64,
    /// Batched output buffer for Active sessions
    batch_buffer: Vec<u8>,
}

/// Output router for managing terminal output streams
pub struct OutputRouter {
    /// Configuration
    config: OutputRouterConfig,
    /// Session states indexed by session ID
    sessions: HashMap<String, TerminalSessionState>,
}

impl OutputRouter {
    /// Create a new output router with configuration
    pub fn new(config: OutputRouterConfig) -> Self {
        Self {
            config,
            sessions: HashMap::new(),
        }
    }

    /// Register a new terminal session
    pub fn register_session(&mut self, session_id: &str, rows: u16, cols: u16) {
        let vt = VtEngine::with_scrollback(rows, cols, self.config.scrollback_max_bytes);
        self.sessions.insert(
            session_id.to_string(),
            TerminalSessionState {
                vt,
                visibility: SessionVisibility::Hidden,
                output_seq: 0,
                unread_bytes: 0,
                batch_buffer: Vec::new(),
            },
        );
    }

    /// Unregister a terminal session
    pub fn unregister_session(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    /// Set visibility for a session
    pub fn set_visibility(&mut self, session_id: &str, visibility: SessionVisibility) {
        if let Some(state) = self.sessions.get_mut(session_id) {
            state.visibility = visibility;
        }
    }

    /// Get visibility for a session
    pub fn get_session_visibility(&self, session_id: &str) -> Option<SessionVisibility> {
        self.sessions.get(session_id).map(|s| s.visibility)
    }

    /// Dispatch output to a session
    ///
    /// For Active sessions: output is batched for direct forwarding
    /// For Visible sessions: unread_bytes counter is updated
    /// For Hidden sessions: only VT state is maintained
    pub fn dispatch_output(&mut self, session_id: &str, bytes: &[u8]) {
        let Some(state) = self.sessions.get_mut(session_id) else {
            return;
        };

        // Always update VT state
        state.vt.process(bytes);
        state.output_seq += 1;

        match state.visibility {
            SessionVisibility::Active => {
                // Batch output for direct forwarding
                state.batch_buffer.extend_from_slice(bytes);
            }
            SessionVisibility::Visible => {
                // Track unread bytes
                state.unread_bytes += bytes.len() as u64;
            }
            SessionVisibility::Hidden => {
                // Only maintain VT state, no batching
            }
        }
    }

    /// Flush and return all batched output for Active sessions
    ///
    /// Returns Vec<(session_id, bytes)> for all Active sessions
    pub fn flush_active_batches(&mut self) -> Vec<(String, Vec<u8>)> {
        let mut batches = Vec::new();

        for (session_id, state) in &mut self.sessions {
            if state.visibility == SessionVisibility::Active && !state.batch_buffer.is_empty() {
                let bytes = std::mem::take(&mut state.batch_buffer);
                batches.push((session_id.clone(), bytes));
            }
        }

        batches
    }

    /// Activate a session (make it the active terminal)
    ///
    /// Returns RenderedScreen for the newly activated session
    /// All other sessions become Visible (not Active)
    pub fn activate_session(&mut self, session_id: &str) -> Option<RenderedScreen> {
        // First, set all sessions to Visible
        for (id, state) in &mut self.sessions {
            if id != session_id && state.visibility == SessionVisibility::Active {
                state.visibility = SessionVisibility::Visible;
            }
        }

        // Then activate the target session
        if let Some(state) = self.sessions.get_mut(session_id) {
            state.visibility = SessionVisibility::Active;
            // Clear batch buffer on activation (fresh start)
            state.batch_buffer.clear();
            Some(state.vt.rendered_screen(session_id.to_string()))
        } else {
            None
        }
    }

    /// Get unread bytes counter for a Visible session
    pub fn get_unread_bytes(&self, session_id: &str) -> Option<u64> {
        self.sessions.get(session_id).map(|s| s.unread_bytes)
    }

    /// Clear unread bytes counter for a Visible session
    pub fn clear_unread_bytes(&mut self, session_id: &str) {
        if let Some(state) = self.sessions.get_mut(session_id) {
            state.unread_bytes = 0;
        }
    }

    /// Get rendered screen for a session
    pub fn get_rendered_screen(&self, session_id: &str) -> Option<RenderedScreen> {
        self.sessions
            .get(session_id)
            .map(|s| s.vt.rendered_screen(session_id.to_string()))
    }

    /// Resize a session's terminal
    pub fn resize_session(&mut self, session_id: &str, rows: u16, cols: u16) {
        if let Some(state) = self.sessions.get_mut(session_id) {
            state.vt.resize(rows, cols);
        }
    }
}