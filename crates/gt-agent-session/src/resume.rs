use std::path::Path;

use crate::types::{GtoSession, Provider, ResumeCheck, ResumeStep, SessionRelaunchMode, SessionStats};

pub struct ResumeService;

impl ResumeService {
    /// Build the shell command that starts the provider CLI in resume mode (non-interactive TUI flags).
    pub fn build_resume_launch_command(session: &GtoSession) -> Option<String> {
        Self::build_relaunch_launch_command(Some(session), session.provider, SessionRelaunchMode::Resume)
    }

    pub fn build_relaunch_launch_command(
        session: Option<&GtoSession>,
        provider: Provider,
        mode: SessionRelaunchMode,
    ) -> Option<String> {
        match mode {
            SessionRelaunchMode::ContinueLast => Some(match provider {
                Provider::Claude => "claude --continue".to_string(),
                Provider::Codex => "codex resume --last".to_string(),
            }),
            SessionRelaunchMode::ForkLast => Some(match provider {
                Provider::Claude => "claude --fork-session --continue".to_string(),
                Provider::Codex => "codex fork --last".to_string(),
            }),
            SessionRelaunchMode::Fork => {
                let session = session?;
                if session.provider != provider {
                    return None;
                }
                match provider {
                    Provider::Claude => resolve_provider_session_id(session)
                        .map(|id| format!("claude --fork-session --resume {id}"))
                        .or_else(|| Some("claude --fork-session --continue".to_string())),
                    Provider::Codex => resolve_provider_session_id(session).map(|id| format!("codex fork {id}"))
                        .or_else(|| Some("codex fork --last".to_string())),
                }
            }
            SessionRelaunchMode::Resume => {
                let session = session?;
                if session.provider != provider {
                    return None;
                }
                match provider {
                    Provider::Claude => {
                        if let Some(id) = resolve_provider_session_id(session) {
                            Some(format!("claude --resume {id}"))
                        } else {
                            Some("claude --continue".to_string())
                        }
                    }
                    Provider::Codex => {
                        if let Some(id) = resolve_provider_session_id(session) {
                            Some(format!("codex resume {id}"))
                        } else {
                            Some("codex resume --last".to_string())
                        }
                    }
                }
            }
        }
    }

    pub fn build_resume_commands(session: &GtoSession) -> Vec<ResumeStep> {
        let Some(command) = Self::build_resume_launch_command(session) else {
            return Vec::new();
        };
        vec![ResumeStep::StartCli { command }]
    }

    pub fn build_relaunch_commands(
        session: Option<&GtoSession>,
        provider: Provider,
        mode: SessionRelaunchMode,
    ) -> Vec<ResumeStep> {
        let Some(command) = Self::build_relaunch_launch_command(session, provider, mode) else {
            return Vec::new();
        };
        vec![ResumeStep::StartCli { command }]
    }

    pub fn validate_resumable(session: &GtoSession) -> ResumeCheck {
        let Some(log_path) = &session.provider_log_path else {
            return ResumeCheck::CanResume;
        };
        let path = Path::new(log_path);
        if !path.exists() {
            return ResumeCheck::LogFileMissing;
        }
        match std::fs::metadata(path) {
            Ok(meta) if meta.len() == 0 => ResumeCheck::LogFileCorrupted,
            Ok(_) => ResumeCheck::CanResume,
            Err(_) => ResumeCheck::LogFileMissing,
        }
    }

    pub fn format_handover_prefix(title: &str, stats: &SessionStats) -> String {
        let last_commit_placeholder = stats.git_end_commit.as_deref().unwrap_or("—");
        crate::git_diff::build_handover_text(title, stats, Some(last_commit_placeholder))
    }
}

/// Provider session id: explicit field, else Claude jsonl stem / Codex rollout id from path.
pub fn resolve_provider_session_id(session: &GtoSession) -> Option<String> {
    if let Some(id) = session
        .provider_session_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return Some(id.to_string());
    }
    session
        .provider_log_path
        .as_ref()
        .and_then(|p| provider_session_id_from_log_path(session.provider, Path::new(p)))
}

fn provider_session_id_from_log_path(provider: Provider, path: &Path) -> Option<String> {
    match provider {
        Provider::Claude => path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.is_empty() && s.contains('-')),
        Provider::Codex => {
            let stem = path.file_stem()?.to_string_lossy();
            // rollout-YYYY-MM-DDThh-mm-ss-<uuid> → take segment after last hyphen group
            stem.strip_prefix("rollout-")
                .and_then(|rest| rest.rsplit_once('-').map(|(_, uuid)| uuid.to_string()))
                .or_else(|| Some(stem.to_string()))
                .filter(|s| !s.is_empty())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{GtoSession, Lifecycle, Provider, SessionStats};
    use std::fs;

    fn make_session(provider: Provider, log_path: Option<&str>, provider_session_id: Option<&str>) -> GtoSession {
        GtoSession {
            gto_session_id: "s1".to_string(),
            workspace_id: "ws1".to_string(),
            agent_id: "a1".to_string(),
            station_id: "st1".to_string(),
            provider,
            provider_session_id: provider_session_id.map(|s| s.to_string()),
            provider_log_path: log_path.map(|s| s.to_string()),
            terminal_session_id: None,
            lifecycle: Lifecycle::Stopped,
            title: Some("test".to_string()),
            cwd: "/tmp".to_string(),
            started_at_ms: 0,
            ended_at_ms: None,
            last_activity_at_ms: 0,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn test_claude_resume_command_with_id() {
        let session = make_session(
            Provider::Claude,
            Some("/tmp/550e8400-e29b-41d4-a716-446655440000.jsonl"),
            None,
        );
        assert_eq!(
            ResumeService::build_resume_launch_command(&session).as_deref(),
            Some("claude --resume 550e8400-e29b-41d4-a716-446655440000")
        );
    }

    #[test]
    fn test_claude_resume_command_continue_fallback() {
        let session = make_session(Provider::Claude, None, None);
        assert_eq!(
            ResumeService::build_resume_launch_command(&session).as_deref(),
            Some("claude --continue")
        );
    }

    #[test]
    fn test_codex_resume_command_with_id() {
        let session = make_session(Provider::Codex, None, Some("abc-uuid"));
        assert_eq!(
            ResumeService::build_resume_launch_command(&session).as_deref(),
            Some("codex resume abc-uuid")
        );
    }

    #[test]
    fn test_codex_resume_command_last_fallback() {
        let session = make_session(Provider::Codex, None, None);
        assert_eq!(
            ResumeService::build_resume_launch_command(&session).as_deref(),
            Some("codex resume --last")
        );
    }

    #[test]
    fn test_build_resume_commands_single_start() {
        let session = make_session(Provider::Codex, None, Some("id1"));
        let steps = ResumeService::build_resume_commands(&session);
        assert_eq!(steps.len(), 1);
        assert!(matches!(&steps[0], ResumeStep::StartCli { command } if command == "codex resume id1"));
    }

    #[test]
    fn test_validate_resumable_exists() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        fs::write(&file, "content").unwrap();
        let session = make_session(Provider::Claude, Some(file.to_string_lossy().as_ref()), None);
        assert_eq!(ResumeService::validate_resumable(&session), ResumeCheck::CanResume);
    }

    #[test]
    fn test_validate_resumable_missing() {
        let session = make_session(Provider::Claude, Some("/nonexistent/file.jsonl"), None);
        assert_eq!(ResumeService::validate_resumable(&session), ResumeCheck::LogFileMissing);
    }

    #[test]
    fn test_claude_fork_with_id() {
        let session = make_session(
            Provider::Claude,
            Some("/tmp/550e8400-e29b-41d4-a716-446655440000.jsonl"),
            None,
        );
        assert_eq!(
            ResumeService::build_relaunch_launch_command(
                Some(&session),
                Provider::Claude,
                SessionRelaunchMode::Fork,
            )
            .as_deref(),
            Some("claude --fork-session --resume 550e8400-e29b-41d4-a716-446655440000")
        );
    }

    #[test]
    fn test_claude_fork_last_global() {
        assert_eq!(
            ResumeService::build_relaunch_launch_command(None, Provider::Claude, SessionRelaunchMode::ForkLast)
                .as_deref(),
            Some("claude --fork-session --continue")
        );
    }

    #[test]
    fn test_codex_fork_with_id() {
        let session = make_session(Provider::Codex, None, Some("abc-uuid"));
        assert_eq!(
            ResumeService::build_relaunch_launch_command(Some(&session), Provider::Codex, SessionRelaunchMode::Fork)
                .as_deref(),
            Some("codex fork abc-uuid")
        );
    }

    #[test]
    fn test_codex_continue_last_global() {
        assert_eq!(
            ResumeService::build_relaunch_launch_command(
                None,
                Provider::Codex,
                SessionRelaunchMode::ContinueLast,
            )
            .as_deref(),
            Some("codex resume --last")
        );
    }

    #[test]
    fn test_handover_prefix() {
        let stats = SessionStats {
            gto_session_id: "s1".to_string(),
            git_start_commit: Some("abc".to_string()),
            git_end_commit: Some("def456 fix: bug".to_string()),
            files_changed: 2,
            insertions: 10,
            deletions: 5,
            commits_ahead: 1,
            updated_at_ms: 0,
        };
        let text = ResumeService::format_handover_prefix("Fix bug", &stats);
        assert!(text.contains("Fix bug"));
        assert!(text.contains("2 files"));
    }
}
