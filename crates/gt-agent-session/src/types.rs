use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Provider::Claude),
            "codex" => Some(Provider::Codex),
            _ => None,
        }
    }
}

/// How to start the provider CLI from session history (maps to native flags).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionRelaunchMode {
    Resume,
    ContinueLast,
    Fork,
    ForkLast,
}

impl SessionRelaunchMode {
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "resume" => Some(Self::Resume),
            "continue_last" | "continueLast" => Some(Self::ContinueLast),
            "fork" => Some(Self::Fork),
            "fork_last" | "forkLast" => Some(Self::ForkLast),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Lifecycle {
    Live,
    Stopped,
    Archived,
}

impl Lifecycle {
    pub fn as_str(&self) -> &'static str {
        match self {
            Lifecycle::Live => "live",
            Lifecycle::Stopped => "stopped",
            Lifecycle::Archived => "archived",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "live" => Some(Lifecycle::Live),
            "stopped" => Some(Lifecycle::Stopped),
            "archived" => Some(Lifecycle::Archived),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GtoSession {
    pub gto_session_id: String,
    pub workspace_id: String,
    pub agent_id: String,
    pub station_id: String,
    pub provider: Provider,
    pub provider_session_id: Option<String>,
    pub provider_log_path: Option<String>,
    pub terminal_session_id: Option<String>,
    pub lifecycle: Lifecycle,
    pub title: Option<String>,
    pub cwd: String,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    pub last_activity_at_ms: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub gto_session_id: String,
    pub git_start_commit: Option<String>,
    pub git_end_commit: Option<String>,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
    pub commits_ahead: u32,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCard {
    pub gto_session_id: String,
    pub workspace_id: String,
    pub agent_id: String,
    pub provider: Provider,
    pub lifecycle: Lifecycle,
    pub provider_session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: String,
    pub started_at_ms: u64,
    pub last_activity_at_ms: u64,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
    pub commits_ahead: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    #[serde(flatten)]
    pub session: GtoSession,
    pub stats: Option<SessionStats>,
}

#[derive(Debug, Clone)]
pub struct ProviderSessionCandidate {
    pub provider: Provider,
    pub provider_session_id: Option<String>,
    pub log_path: std::path::PathBuf,
    pub cwd: std::path::PathBuf,
    pub modified_at_ms: u64,
    pub first_user_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResumeStep {
    StartCli { command: String },
    WaitMs { ms: u64 },
    InjectCommand { command: String },
    InjectSubmit { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResumeCheck {
    CanResume,
    LogFileMissing,
    LogFileCorrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub new_count: u32,
    pub updated_count: u32,
}
