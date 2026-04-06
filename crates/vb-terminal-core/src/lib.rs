//! vb-terminal-core: Terminal session state management with VT engine
//!
//! This crate provides:
//! - VT100 state engine for terminal emulation
//! - Ring buffer scrollback storage
//! - Three-state output routing (Active/Visible/Hidden)
//! - Rendered screen snapshot generation

pub mod output_router;
pub mod scrollback;
pub mod snapshot;
pub mod types;
pub mod vt_engine;

pub use output_router::{OutputRouter, SessionVisibility};
pub use scrollback::ScrollbackStore;
pub use snapshot::{RenderedScreen, TerminalSnapshot};
pub use types::*;
pub use vt_engine::VtEngine;
