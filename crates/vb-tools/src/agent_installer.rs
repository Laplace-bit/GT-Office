use std::env;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum AgentType {
    ClaudeCode,
    Codex,
    Gemini,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallStatus {
    pub installed: bool,
    pub executable: Option<String>,
    pub requires_node: bool,
    pub node_ready: bool,
}

pub struct AgentInstaller;

impl AgentInstaller {
    pub fn install_status(agent: AgentType) -> AgentInstallStatus {
        let executable = Self::detect_installed(agent);
        let requires_node = Self::requires_node_env(agent);

        AgentInstallStatus {
            installed: executable.is_some(),
            executable,
            requires_node,
            node_ready: if requires_node {
                Self::check_node_env()
            } else {
                true
            },
        }
    }

    pub fn get_install_command(agent: AgentType) -> (String, Vec<String>) {
        if cfg!(target_os = "windows") {
            match agent {
                AgentType::ClaudeCode => (
                    "powershell".to_string(),
                    vec![
                        "-Command".to_string(),
                        "irm https://claude.ai/install.ps1 | iex".to_string(),
                    ],
                ),
                AgentType::Codex => (
                    "cmd".to_string(),
                    vec!["/C".to_string(), "npm install -g @openai/codex".to_string()],
                ),
                AgentType::Gemini => (
                    "cmd".to_string(),
                    vec![
                        "/C".to_string(),
                        "npm install -g @google/gemini-cli".to_string(),
                    ],
                ),
            }
        } else {
            match agent {
                AgentType::ClaudeCode => (
                    "bash".to_string(),
                    vec![
                        "-c".to_string(),
                        "curl -fsSL https://claude.ai/install.sh | bash".to_string(),
                    ],
                ),
                AgentType::Codex => (
                    "bash".to_string(),
                    vec!["-c".to_string(), "npm install -g @openai/codex".to_string()],
                ),
                AgentType::Gemini => (
                    "bash".to_string(),
                    vec![
                        "-c".to_string(),
                        "npm install -g @google/gemini-cli".to_string(),
                    ],
                ),
            }
        }
    }

    pub fn requires_node_env(agent: AgentType) -> bool {
        matches!(agent, AgentType::Codex | AgentType::Gemini)
    }

    pub fn executable_name(agent: AgentType) -> &'static str {
        match agent {
            AgentType::ClaudeCode => "claude",
            AgentType::Codex => "codex",
            AgentType::Gemini => "gemini",
        }
    }

    pub fn detect_installed(agent: AgentType) -> Option<String> {
        Self::find_executable(Self::executable_name(agent))
    }

    pub fn check_node_env() -> bool {
        Self::find_executable("node").is_some()
            || Command::new("node")
                .arg("-v")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
    }

    fn find_executable(command: &str) -> Option<String> {
        let path = env::var_os("PATH")?;

        for dir in env::split_paths(&path) {
            for candidate in Self::executable_candidates(command) {
                let full_path = dir.join(&candidate);
                if Self::is_runnable_file(&full_path) {
                    return Some(full_path.display().to_string());
                }
            }
        }

        None
    }

    fn executable_candidates(command: &str) -> Vec<String> {
        if cfg!(target_os = "windows") {
            let has_extension = Path::new(command).extension().is_some();
            let mut candidates = vec![command.to_string()];

            if !has_extension {
                candidates.extend(
                    [".exe", ".cmd", ".bat", ".com"]
                        .iter()
                        .map(|extension| format!("{command}{extension}")),
                );
            }

            candidates
        } else {
            vec![command.to_string()]
        }
    }

    fn is_runnable_file(path: &Path) -> bool {
        if !path.is_file() {
            return false;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            path.metadata()
                .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }

        #[cfg(not(unix))]
        {
            true
        }
    }
}
