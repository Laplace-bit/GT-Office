pub mod discovery;
pub mod error;
pub mod git_diff;
pub mod registry;
pub mod resume;
pub mod scanner;
pub mod summary;
pub mod types;

pub use discovery::{run_discovery, DiscoveryCache, DiscoveryResult};
pub use error::{SessionError, SessionResult};
pub use git_diff::{build_handover_text, GitSessionDiff};
pub use registry::SessionRegistry;
pub use resume::{resolve_provider_session_id, ResumeService};
pub use scanner::ProviderScanner;
pub use summary::{extract_first_user_message, extract_session_title};
pub use types::{SessionRelaunchMode, *};

pub fn module_name() -> &'static str {
    "gt-agent-session"
}
