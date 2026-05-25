pub mod discovery;
pub mod error;
pub mod git_diff;
pub mod registry;
pub mod resume;
pub mod scanner;
pub mod summary;
pub mod types;

pub use discovery::{DiscoveryCache, DiscoveryResult, run_discovery};
pub use error::{SessionError, SessionResult};
pub use git_diff::{GitSessionDiff, build_handover_text};
pub use registry::SessionRegistry;
pub use resume::{ResumeService, resolve_provider_session_id};
pub use scanner::ProviderScanner;
pub use summary::{extract_first_user_message, extract_session_title};
pub use types::{SessionRelaunchMode, *};

pub fn module_name() -> &'static str {
    "gt-agent-session"
}