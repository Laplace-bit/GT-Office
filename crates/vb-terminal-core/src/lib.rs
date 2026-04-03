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