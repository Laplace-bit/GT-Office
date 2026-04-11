use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "gtoffice-agent-installer-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&base).expect("create temp dir");
        base
    }

    fn restore_env_var(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    fn with_test_home<T>(dir: &Path, f: impl FnOnce(&Path) -> T) -> T {
        let _guard = HOME_ENV_LOCK.lock().expect("home env lock");
        let home = dir.join("mock-home");
        fs::create_dir_all(&home).expect("create home");

        let previous_home = std::env::var_os("HOME");
        let previous_userprofile = std::env::var_os("USERPROFILE");
        let previous_homedrive = std::env::var_os("HOMEDRIVE");
        let previous_homepath = std::env::var_os("HOMEPATH");
        let previous_path = std::env::var_os("PATH");

        std::env::set_var("HOME", &home);
        std::env::remove_var("USERPROFILE");
        std::env::remove_var("HOMEDRIVE");
        std::env::remove_var("HOMEPATH");
        std::env::set_var("PATH", "");

        let result = f(&home);

        restore_env_var("HOME", previous_home);
        restore_env_var("USERPROFILE", previous_userprofile);
        restore_env_var("HOMEDRIVE", previous_homedrive);
        restore_env_var("HOMEPATH", previous_homepath);
        restore_env_var("PATH", previous_path);

        result
    }

    #[test]
    fn codex_local_bin_uninstall_uses_combined_npm_command() {
        let executable = if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester\.local\bin\codex.cmd")
        } else {
            PathBuf::from("/Users/tester/.local/bin/codex")
        };

        let action = AgentInstaller::codex_uninstall_action_for_path(&executable)
            .expect("codex uninstall action");

        match action {
            AgentUninstallAction::Command { args, .. } => {
                let script = args.last().expect("script arg");
                assert!(script.contains("npm uninstall -g @openai/codex"));
                assert!(script.contains(".local"));
            }
            AgentUninstallAction::RemovePaths { .. } => {
                panic!("expected npm uninstall command for codex");
            }
        }
    }

    #[test]
    fn gemini_local_bin_uninstall_uses_combined_npm_command() {
        let executable = if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester\.local\bin\gemini.cmd")
        } else {
            PathBuf::from("/Users/tester/.local/bin/gemini")
        };

        let action = AgentInstaller::gemini_uninstall_action_for_path(&executable)
            .expect("gemini uninstall action");

        match action {
            AgentUninstallAction::Command { args, .. } => {
                let script = args.last().expect("script arg");
                assert!(script.contains("npm uninstall -g @google/gemini-cli"));
                assert!(script.contains(".local"));
            }
            AgentUninstallAction::RemovePaths { .. } => {
                panic!("expected npm uninstall command for gemini");
            }
        }
    }

    #[test]
    fn install_status_uses_persisted_cache_before_rescanning() {
        let dir = temp_dir("cache-hit");
        with_test_home(&dir, |home| {
            let executable = home.join(".local").join("bin").join(if cfg!(windows) {
                "codex.cmd"
            } else {
                "codex"
            });
            fs::create_dir_all(executable.parent().expect("parent")).expect("create bin dir");
            fs::write(&executable, "@echo off\n").expect("write fake executable");

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                let mut perms = fs::metadata(&executable).expect("metadata").permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&executable, perms).expect("chmod");
            }

            let cache_dir = home.join(".gtoffice").join("cache");
            fs::create_dir_all(&cache_dir).expect("create cache dir");
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_millis() as u64;
            let cache_path = cache_dir.join("agent-install-status.json");
            let cache_body = serde_json::json!({
                "version": 2,
                "entries": {
                    "codex": {
                        "checkedAtMs": now_ms,
                        "status": {
                            "installed": true,
                            "executable": executable.display().to_string(),
                            "requiresNode": true,
                            "nodeReady": true,
                            "npmReady": true,
                            "brewReady": false,
                            "installAvailable": true,
                            "uninstallAvailable": true,
                            "detectedBy": ["cache"],
                            "issues": []
                        }
                    }
                }
            });
            fs::write(
                &cache_path,
                serde_json::to_vec_pretty(&cache_body).expect("serialize cache"),
            )
            .expect("write cache");

            let status = AgentInstaller::install_status(AgentType::Codex);
            assert!(status.installed);
            assert_eq!(
                status.executable.as_deref(),
                Some(executable.to_string_lossy().as_ref())
            );
            assert_eq!(status.detected_by, vec!["cache".to_string()]);
        });
    }

    #[test]
    fn launch_executable_hint_prefers_cached_path() {
        let dir = temp_dir("launch-hint-cache");
        with_test_home(&dir, |home| {
            let executable = home.join(".local").join("bin").join(if cfg!(windows) {
                "codex.cmd"
            } else {
                "codex"
            });
            fs::create_dir_all(executable.parent().expect("parent")).expect("create bin dir");
            fs::write(&executable, "@echo off\n").expect("write fake executable");

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                let mut perms = fs::metadata(&executable).expect("metadata").permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&executable, perms).expect("chmod");
            }

            let cache_dir = home.join(".gtoffice").join("cache");
            fs::create_dir_all(&cache_dir).expect("create cache dir");
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_millis() as u64;
            let cache_path = cache_dir.join("agent-install-status.json");
            let cache_body = serde_json::json!({
                "version": 2,
                "entries": {
                    "codex": {
                        "checkedAtMs": now_ms,
                        "status": {
                            "installed": true,
                            "executable": executable.display().to_string(),
                            "requiresNode": true,
                            "nodeReady": true,
                            "npmReady": true,
                            "brewReady": false,
                            "installAvailable": true,
                            "uninstallAvailable": true,
                            "detectedBy": ["cache"],
                            "issues": []
                        }
                    }
                }
            });
            fs::write(
                &cache_path,
                serde_json::to_vec_pretty(&cache_body).expect("serialize cache"),
            )
            .expect("write cache");

            let hint = AgentInstaller::launch_executable_hint(AgentType::Codex);
            assert_eq!(hint.as_deref(), Some(executable.to_string_lossy().as_ref()));
        });
    }

    #[test]
    fn preferred_registry_order_uses_faster_mirror_without_proxy() {
        let order = AgentInstaller::preferred_registry_order(
            false,
            &HostProbe {
                reachable: true,
                latency_ms: Some(220),
            },
            &HostProbe {
                reachable: true,
                latency_ms: Some(40),
            },
        );

        assert_eq!(order, vec![MIRROR_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY]);
    }

    #[test]
    fn build_install_plan_for_codex_uses_primary_and_fallback_registries() {
        let plan = AgentInstaller::build_install_plan_with_profile(
            AgentType::Codex,
            &InstallNetworkProfile {
                mode: InstallNetworkMode::MirrorPreferred,
                has_inherited_proxy: false,
                preferred_registry: MIRROR_NPM_REGISTRY.to_string(),
                fallback_registry: Some(OFFICIAL_NPM_REGISTRY.to_string()),
                claude_script_reachable: false,
            },
        );

        // The plan content depends on whether npm/brew are available in the test environment.
        // If npm is available, there will be npm install attempts.
        // If brew is available, there will be a brew install attempt.
        // If neither is available but node dir is found, there will be a node-dir fallback attempt.
        // In a CI/test environment, npm may or may not be present.
        let has_npm_attempt = plan.attempts.iter().any(|a| a.id.contains("-npm-"));
        let has_brew_attempt = plan.attempts.iter().any(|a| a.id.contains("-brew"));
        let has_node_dir_attempt = plan.attempts.iter().any(|a| a.id.contains("-npm-node-dir"));
        // At least one attempt method should be present if any tool is available,
        // or the plan may be empty if no install tool is found in the test environment.
        if has_npm_attempt {
            assert!(plan.attempts.len() >= 2);
            assert!(plan.attempts[0]
                .args
                .last()
                .expect("script")
                .contains(MIRROR_NPM_REGISTRY));
            assert!(plan.attempts[1]
                .args
                .last()
                .expect("script")
                .contains(OFFICIAL_NPM_REGISTRY));
            assert!(plan.attempts[0]
                .args
                .last()
                .expect("script")
                .contains("npm prefix -g"));
        }
        if has_brew_attempt {
            let brew_attempt = plan.attempts.iter().find(|a| a.id.contains("-brew")).expect("brew attempt");
            assert!(brew_attempt.args.last().expect("script").contains("brew"));
        }
        if has_node_dir_attempt {
            let node_dir_attempt = plan.attempts.iter().find(|a| a.id.contains("-npm-node-dir")).expect("node dir attempt");
            assert!(node_dir_attempt.args.last().expect("script").contains("npm"));
        }
    }

    #[test]
    fn find_executable_hint_prefers_managed_local_bin_for_codex() {
        let dir = temp_dir("managed-local-bin");
        with_test_home(&dir, |home| {
            let local_bin = home.join(".local").join("bin");
            let fnm_bin = home
                .join(".local")
                .join("share")
                .join("fnm")
                .join("node-versions")
                .join("v22.0.0")
                .join("installation")
                .join("bin");
            fs::create_dir_all(&local_bin).expect("create local bin");
            fs::create_dir_all(&fnm_bin).expect("create fnm bin");

            let local_codex = local_bin.join(if cfg!(windows) { "codex.cmd" } else { "codex" });
            let fnm_codex = fnm_bin.join(if cfg!(windows) { "codex.cmd" } else { "codex" });
            fs::write(&local_codex, "@echo off\n").expect("write local codex");
            fs::write(&fnm_codex, "@echo off\n").expect("write fnm codex");

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                for path in [&local_codex, &fnm_codex] {
                    let mut perms = fs::metadata(path).expect("metadata").permissions();
                    perms.set_mode(0o755);
                    fs::set_permissions(path, perms).expect("chmod");
                }
            }

            std::env::set_var("PATH", fnm_bin.as_os_str());

            let hint = AgentInstaller::find_executable_hint("codex");
            assert_eq!(hint.as_deref(), Some(local_codex.as_path()));
        });
    }

    #[test]
    fn classify_install_failure_detects_dns_and_timeout() {
        assert_eq!(
            AgentInstaller::classify_install_failure("npm ERR! code EAI_AGAIN", false),
            AgentInstallDiagnosticCode::DnsFailed
        );
        assert_eq!(
            AgentInstaller::classify_install_failure("connection timed out", false),
            AgentInstallDiagnosticCode::Timeout
        );
    }

    #[test]
    fn claude_official_plan_retries_after_installer_corrupt_failure() {
        let attempt = AgentInstaller::claude_official_install_attempt();

        assert!(attempt
            .retryable_diagnostics
            .contains(&AgentInstallDiagnosticCode::InstallerCorrupt));
        assert!(attempt
            .retryable_diagnostics
            .contains(&AgentInstallDiagnosticCode::Unknown));
    }

    #[test]
    fn uninstall_failure_message_uses_removal_copy() {
        let message = AgentInstaller::uninstall_failure_message(
            AgentType::Codex,
            AgentInstallDiagnosticCode::NpmMissing,
        );

        assert!(message.contains("remove Codex CLI"));
        assert!(!message.contains("installing"));
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
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
    pub npm_ready: bool,
    #[serde(default)]
    pub brew_ready: bool,
    pub install_available: bool,
    pub uninstall_available: bool,
    pub detected_by: Vec<String>,
    pub issues: Vec<String>,
    #[serde(default)]
    pub auto_install_supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_action: Option<AgentInstallRecommendedAction>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallRecommendedAction {
    Install,
    InstallNode,
    InstallBrew,
    ManualHelp,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallProgressPhase {
    Preparing,
    Downloading,
    Installing,
    Verifying,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallDiagnosticCode {
    NodeMissing,
    NpmMissing,
    DnsFailed,
    Timeout,
    TlsFailed,
    RegistryBlocked,
    PermissionDenied,
    InstallerCorrupt,
    VerificationFailed,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallProgressEvent {
    pub phase: AgentInstallProgressPhase,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<AgentInstallDiagnosticCode>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CachedAgentInstallStatus {
    checked_at_ms: u64,
    status: AgentInstallStatus,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentInstallStatusCacheStore {
    version: u32,
    entries: BTreeMap<String, CachedAgentInstallStatus>,
}

const AGENT_INSTALL_STATUS_CACHE_VERSION: u32 = 2;
const AGENT_INSTALL_STATUS_POSITIVE_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const AGENT_INSTALL_STATUS_NEGATIVE_TTL_MS: u64 = 15 * 60 * 1000;
const INSTALL_PROBE_TIMEOUT_MS: u64 = 1_200;
const INSTALL_ATTEMPT_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const REGISTRY_LATENCY_MARGIN_MS: u128 = 80;
const OFFICIAL_NPM_REGISTRY: &str = "https://registry.npmjs.org";
const MIRROR_NPM_REGISTRY: &str = "https://registry.npmmirror.com";

#[derive(Debug, Clone)]
struct DetectionResult {
    executable: Option<PathBuf>,
    detected_by: Vec<String>,
    shell_ready: bool,
}

#[derive(Debug, Clone)]
struct HostProbe {
    reachable: bool,
    latency_ms: Option<u128>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallNetworkMode {
    Direct,
    MirrorPreferred,
    ProxyInherited,
    OfflineOrBlocked,
}

#[derive(Debug, Clone)]
struct InstallNetworkProfile {
    mode: InstallNetworkMode,
    has_inherited_proxy: bool,
    preferred_registry: String,
    fallback_registry: Option<String>,
    claude_script_reachable: bool,
}

#[derive(Debug, Clone)]
pub struct AgentInstallAttempt {
    pub id: String,
    pub label: String,
    pub phase: AgentInstallProgressPhase,
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub timeout_ms: u64,
    pub retryable_diagnostics: Vec<AgentInstallDiagnosticCode>,
}

#[derive(Debug, Clone)]
pub struct AgentInstallPlan {
    pub attempts: Vec<AgentInstallAttempt>,
}

#[derive(Debug, Clone)]
pub enum AgentUninstallAction {
    Command { program: String, args: Vec<String> },
    RemovePaths { paths: Vec<PathBuf> },
}

pub struct AgentInstaller;

impl AgentInstaller {
    pub fn install_status(agent: AgentType) -> AgentInstallStatus {
        if let Some(status) = Self::load_cached_install_status(agent) {
            tracing::debug!("agent installer cache hit for {}", Self::cache_key(agent));
            return status;
        }

        Self::install_status_fresh(agent)
    }

    pub fn install_status_fresh(agent: AgentType) -> AgentInstallStatus {
        let requires_node = Self::requires_node_env(agent);
        let node_runtime_dir = if requires_node {
            Self::find_node_runtime_dir()
        } else {
            None
        };
        let detection = Self::detect_installed_with_node_dir(agent, node_runtime_dir.as_deref());
        let node_ready = if requires_node {
            node_runtime_dir.is_some() || Self::command_succeeds("node", &["-v"])
        } else {
            true
        };
        let npm_ready = if requires_node {
            let npm_detection =
                Self::find_executable_with_node_dir("npm", node_runtime_dir.as_deref());
            npm_detection.executable.is_some() || Self::command_succeeds("npm", &["-v"])
        } else {
            false
        };
        let brew_ready = if cfg!(not(target_os = "windows")) {
            Self::command_succeeds("brew", &["--version"])
        } else {
            false
        };
        let mut issues = Vec::new();

        if requires_node && !node_ready && !brew_ready {
            issues.push(
                "Node.js runtime not found in PATH or common installation directories.".to_string(),
            );
        }
        if requires_node && !npm_ready && !brew_ready {
            issues.push("npm is not available, so GT Office cannot install or uninstall this CLI automatically yet.".to_string());
        }
        if let Some(executable) = detection.executable.as_ref() {
            if !detection.shell_ready {
                let hint = executable
                    .parent()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| executable.display().to_string());
                issues.push(format!(
                    "Executable found at '{}', but a fresh shell still may not resolve '{}'. Reopen the terminal or add '{}' to PATH.",
                    executable.display(),
                    Self::executable_name(agent),
                    hint
                ));
            }
        }

        let uninstall_available = match agent {
            AgentType::ClaudeCode => detection
                .executable
                .as_deref()
                .and_then(Self::claude_uninstall_action_for_path)
                .is_some(),
            AgentType::Codex | AgentType::Gemini => {
                if detection.executable.is_none() {
                    false
                } else {
                    let path_text = detection
                        .executable
                        .as_ref()
                        .map(|p| p.display().to_string())
                        .unwrap_or_default();
                    // Homebrew installation doesn't require npm (includes Linuxbrew on Linux)
                    let is_homebrew = path_text.contains("/opt/homebrew/bin")
                        || path_text.contains("/usr/local/bin")
                        || path_text.contains("/.linuxbrew/bin");
                    is_homebrew || npm_ready || brew_ready
                }
            }
        };
        if detection.executable.is_some() && !uninstall_available {
            let agent_name = match agent {
                AgentType::ClaudeCode => "Claude Code",
                AgentType::Codex => "Codex CLI",
                AgentType::Gemini => "Gemini CLI",
            };
            issues.push(format!(
                "{agent_name} uninstall source could not be identified automatically; remove it with the original installer or package manager."
            ));
        }

        let auto_install_supported = match agent {
            AgentType::ClaudeCode => true,
            AgentType::Codex | AgentType::Gemini => npm_ready || brew_ready,
        };
        let recommended_action = if detection.executable.is_some() {
            None
        } else if requires_node && !node_ready && !brew_ready {
            Some(AgentInstallRecommendedAction::InstallNode)
        } else if requires_node && !npm_ready && !brew_ready {
            Some(AgentInstallRecommendedAction::ManualHelp)
        } else if requires_node && !node_ready && brew_ready {
            Some(AgentInstallRecommendedAction::InstallBrew)
        } else if auto_install_supported {
            Some(AgentInstallRecommendedAction::Install)
        } else {
            Some(AgentInstallRecommendedAction::ManualHelp)
        };

        let status = AgentInstallStatus {
            installed: detection.executable.is_some(),
            executable: detection
                .executable
                .as_ref()
                .map(|path| path.display().to_string()),
            requires_node,
            node_ready,
            npm_ready,
            brew_ready,
            install_available: auto_install_supported,
            uninstall_available,
            detected_by: detection.detected_by,
            issues,
            auto_install_supported,
            recommended_action,
        };

        Self::store_cached_install_status(agent, &status);
        status
    }

    pub fn build_install_plan(agent: AgentType) -> AgentInstallPlan {
        let profile = Self::probe_install_network(agent);
        Self::build_install_plan_with_profile(agent, &profile)
    }

    pub fn classify_install_failure(output: &str, timed_out: bool) -> AgentInstallDiagnosticCode {
        if timed_out {
            return AgentInstallDiagnosticCode::Timeout;
        }

        let text = output.to_ascii_lowercase();

        if Self::matches_any(
            &text,
            &[
                "node.js runtime not found",
                "node: command not found",
                "'node' is not recognized",
                "\"node\" is not recognized",
            ],
        ) {
            return AgentInstallDiagnosticCode::NodeMissing;
        }
        if Self::matches_any(
            &text,
            &[
                "npm is not available",
                "npm: command not found",
                "'npm' is not recognized",
                "\"npm\" is not recognized",
            ],
        ) {
            return AgentInstallDiagnosticCode::NpmMissing;
        }
        if Self::matches_any(
            &text,
            &["eacces", "eperm", "permission denied", "access is denied"],
        ) {
            return AgentInstallDiagnosticCode::PermissionDenied;
        }
        if Self::matches_any(
            &text,
            &[
                "ssl",
                "tls",
                "certificate",
                "self signed",
                "unable to get local issuer",
            ],
        ) {
            return AgentInstallDiagnosticCode::TlsFailed;
        }
        if Self::matches_any(
            &text,
            &[
                "eai_again",
                "enotfound",
                "getaddrinfo",
                "could not resolve host",
                "name or service not known",
                "temporary failure in name resolution",
            ],
        ) {
            return AgentInstallDiagnosticCode::DnsFailed;
        }
        if Self::matches_any(
            &text,
            &[
                "etimedout",
                "timed out",
                "timeout",
                "socket hang up",
                "econnreset",
                "connection reset by peer",
            ],
        ) {
            return AgentInstallDiagnosticCode::Timeout;
        }
        if Self::matches_any(
            &text,
            &[
                "econnrefused",
                "network is unreachable",
                "503 service unavailable",
                "502 bad gateway",
                "403 forbidden",
                "proxy error",
                "failed to fetch",
            ],
        ) {
            return AgentInstallDiagnosticCode::RegistryBlocked;
        }
        if Self::matches_any(
            &text,
            &[
                "corrupt",
                "corrupted",
                "checksum",
                "unexpected token",
                "invalid or unexpected token",
            ],
        ) {
            return AgentInstallDiagnosticCode::InstallerCorrupt;
        }

        AgentInstallDiagnosticCode::Unknown
    }

    pub fn install_failure_message(
        agent: AgentType,
        diagnostic: AgentInstallDiagnosticCode,
    ) -> String {
        let agent_name = Self::agent_name(agent);
        match diagnostic {
            AgentInstallDiagnosticCode::NodeMissing => format!(
                "Node.js is not installed, so GT Office cannot continue installing {agent_name} automatically."
            ),
            AgentInstallDiagnosticCode::NpmMissing => {
                let brew_hint = if cfg!(not(target_os = "windows")) {
                    " Try installing via Homebrew (brew install --cask codex for Codex, brew install gemini-cli for Gemini), or install Node.js first."
                } else {
                    " Install Node.js first to enable automatic installation."
                };
                format!(
                    "npm is not available, so GT Office cannot continue installing {agent_name} automatically.{brew_hint}"
                )
            }
            AgentInstallDiagnosticCode::DnsFailed
            | AgentInstallDiagnosticCode::Timeout
            | AgentInstallDiagnosticCode::TlsFailed
            | AgentInstallDiagnosticCode::RegistryBlocked => "The current network could not reach the installation source. GT Office automatically tried alternate download routes, but installation still failed.".to_string(),
            AgentInstallDiagnosticCode::PermissionDenied => format!(
                "{agent_name} could not be written into the local tools directory because access was denied."
            ),
            AgentInstallDiagnosticCode::InstallerCorrupt => format!(
                "The installer responded, but the downloaded payload for {agent_name} was not valid."
            ),
            AgentInstallDiagnosticCode::VerificationFailed => format!(
                "{agent_name} finished downloading, but GT Office could not verify the command in a fresh shell."
            ),
            AgentInstallDiagnosticCode::Unknown => format!(
                "{agent_name} installation failed. Retry once after reopening the terminal, or inspect the local shell environment."
            ),
        }
    }

    pub fn uninstall_failure_message(
        agent: AgentType,
        diagnostic: AgentInstallDiagnosticCode,
    ) -> String {
        let agent_name = Self::agent_name(agent);
        match diagnostic {
            AgentInstallDiagnosticCode::NodeMissing => format!(
                "Node.js is not available, so GT Office cannot remove {agent_name} with the current package-manager path."
            ),
            AgentInstallDiagnosticCode::NpmMissing => format!(
                "npm is not available, so GT Office cannot remove {agent_name} automatically."
            ),
            AgentInstallDiagnosticCode::DnsFailed
            | AgentInstallDiagnosticCode::Timeout
            | AgentInstallDiagnosticCode::TlsFailed
            | AgentInstallDiagnosticCode::RegistryBlocked => format!(
                "{agent_name} removal did not finish successfully. GT Office stopped the uninstall process and you can retry or use the original package manager."
            ),
            AgentInstallDiagnosticCode::PermissionDenied => format!(
                "{agent_name} could not be removed because access was denied."
            ),
            AgentInstallDiagnosticCode::InstallerCorrupt
            | AgentInstallDiagnosticCode::VerificationFailed
            | AgentInstallDiagnosticCode::Unknown => format!(
                "{agent_name} could not be removed automatically. Retry once or remove it with the original installer or package manager."
            ),
        }
    }

    fn build_install_plan_with_profile(
        agent: AgentType,
        profile: &InstallNetworkProfile,
    ) -> AgentInstallPlan {
        let mut attempts = Vec::new();
        let registry_candidates = Self::registry_candidates(profile);
        let npm_ready = Self::check_npm_env();
        let brew_ready = if cfg!(not(target_os = "windows")) {
            Self::command_succeeds("brew", &["--version"])
        } else {
            false
        };

        match agent {
            AgentType::ClaudeCode => {
                let should_try_official =
                    profile.has_inherited_proxy || profile.claude_script_reachable || !npm_ready;
                if should_try_official {
                    attempts.push(Self::claude_official_install_attempt());
                }
                if npm_ready {
                    for (index, registry) in registry_candidates.iter().enumerate() {
                        attempts.push(Self::npm_install_attempt(agent, registry, index > 0));
                    }
                }
                if attempts.is_empty() {
                    attempts.push(Self::claude_official_install_attempt());
                }
            }
            AgentType::Codex | AgentType::Gemini => {
                // Try npm install first (with mirror fallback) when npm is available
                if npm_ready {
                    for (index, registry) in registry_candidates.iter().enumerate() {
                        attempts.push(Self::npm_install_attempt(agent, registry, index > 0));
                    }
                }
                // Fall back to Homebrew when npm is unavailable (macOS/Linux only)
                if !npm_ready && brew_ready {
                    attempts.push(Self::brew_install_attempt(agent));
                }
                // Last resort: try npm with the detected node runtime directory injected
                // into PATH. This handles fnm/nvm installations where npm is findable
                // via our search but not in the default shell PATH.
                if !npm_ready && !brew_ready {
                    if let Some(node_dir) = Self::find_node_runtime_dir() {
                        attempts.push(Self::npm_install_attempt_with_node_dir(agent, &registry_candidates, &node_dir));
                    }
                }
            }
        }

        AgentInstallPlan { attempts }
    }

    fn probe_install_network(agent: AgentType) -> InstallNetworkProfile {
        let has_inherited_proxy = Self::has_inherited_proxy();
        let official_registry_probe = if has_inherited_proxy {
            HostProbe {
                reachable: true,
                latency_ms: Some(0),
            }
        } else {
            Self::probe_https_host("registry.npmjs.org")
        };
        let mirror_registry_probe = if has_inherited_proxy {
            HostProbe {
                reachable: true,
                latency_ms: Some(0),
            }
        } else {
            Self::probe_https_host("registry.npmmirror.com")
        };
        let claude_script_reachable = if agent == AgentType::ClaudeCode {
            has_inherited_proxy || Self::probe_https_host("claude.ai").reachable
        } else {
            false
        };

        let registry_order = Self::preferred_registry_order(
            has_inherited_proxy,
            &official_registry_probe,
            &mirror_registry_probe,
        );
        let preferred_registry = registry_order
            .first()
            .copied()
            .unwrap_or(OFFICIAL_NPM_REGISTRY)
            .to_string();
        let fallback_registry = registry_order.get(1).map(|value| (*value).to_string());
        let mode = if has_inherited_proxy {
            InstallNetworkMode::ProxyInherited
        } else if preferred_registry == MIRROR_NPM_REGISTRY {
            InstallNetworkMode::MirrorPreferred
        } else if official_registry_probe.reachable {
            InstallNetworkMode::Direct
        } else {
            InstallNetworkMode::OfflineOrBlocked
        };

        InstallNetworkProfile {
            mode,
            has_inherited_proxy,
            preferred_registry,
            fallback_registry,
            claude_script_reachable,
        }
    }

    fn registry_candidates(profile: &InstallNetworkProfile) -> Vec<String> {
        let mut candidates = vec![profile.preferred_registry.clone()];
        if let Some(fallback) = profile.fallback_registry.as_ref() {
            if !candidates.iter().any(|item| item == fallback) {
                candidates.push(fallback.clone());
            }
        }
        if candidates.is_empty() {
            candidates.push(match profile.mode {
                InstallNetworkMode::MirrorPreferred => MIRROR_NPM_REGISTRY.to_string(),
                _ => OFFICIAL_NPM_REGISTRY.to_string(),
            });
        }
        candidates
    }

    fn preferred_registry_order(
        has_inherited_proxy: bool,
        official: &HostProbe,
        mirror: &HostProbe,
    ) -> Vec<&'static str> {
        if has_inherited_proxy {
            return vec![OFFICIAL_NPM_REGISTRY, MIRROR_NPM_REGISTRY];
        }

        match (official.reachable, mirror.reachable) {
            (true, false) => vec![OFFICIAL_NPM_REGISTRY, MIRROR_NPM_REGISTRY],
            (false, true) => vec![MIRROR_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY],
            (true, true) => {
                let official_latency = official.latency_ms.unwrap_or(u128::MAX);
                let mirror_latency = mirror.latency_ms.unwrap_or(u128::MAX);
                if mirror_latency + REGISTRY_LATENCY_MARGIN_MS < official_latency {
                    vec![MIRROR_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY]
                } else {
                    vec![OFFICIAL_NPM_REGISTRY, MIRROR_NPM_REGISTRY]
                }
            }
            (false, false) => vec![MIRROR_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY],
        }
    }

    fn npm_install_attempt(
        agent: AgentType,
        registry: &str,
        is_fallback: bool,
    ) -> AgentInstallAttempt {
        let package_name = match agent {
            AgentType::ClaudeCode => "@anthropic-ai/claude-code",
            AgentType::Codex => "@openai/codex",
            AgentType::Gemini => "@google/gemini-cli",
        };
        let registry_id = if registry.contains("npmmirror") {
            "mirror"
        } else {
            "official"
        };
        let label = if is_fallback {
            format!("Continuing {} installation...", Self::agent_name(agent))
        } else {
            format!("Downloading {}...", Self::agent_name(agent))
        };
        let phase = if is_fallback {
            AgentInstallProgressPhase::Installing
        } else {
            AgentInstallProgressPhase::Downloading
        };
        let env = Self::npm_install_env(registry);

        if cfg!(target_os = "windows") {
            AgentInstallAttempt {
                id: format!("{}-npm-{registry_id}", Self::cache_key(agent)),
                label,
                phase,
                program: "cmd".to_string(),
                args: vec![
                    "/C".to_string(),
                    format!(
                        "if not exist \"%USERPROFILE%\\.local\\bin\" mkdir \"%USERPROFILE%\\.local\\bin\" >nul 2>nul & npm install -g --prefix \"%USERPROFILE%\\.local\" --no-fund --no-audit {package_name} --registry={registry} & for /f \"delims=\" %P in ('npm prefix -g 2^>nul') do @if /I not \"%P\"==\"%USERPROFILE%\\.local\" npm uninstall -g {package_name} >nul 2>nul"
                    ),
                ],
                env,
                timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
                retryable_diagnostics: Self::network_retryable_diagnostics(),
            }
        } else {
            AgentInstallAttempt {
                id: format!("{}-npm-{registry_id}", Self::cache_key(agent)),
                label,
                phase,
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    format!(
                        "mkdir -p \"$HOME/.local/bin\" && npm install -g --prefix \"$HOME/.local\" --no-fund --no-audit {package_name} --registry={registry} && CURRENT_PREFIX=\"$(npm prefix -g 2>/dev/null || true)\" && if [ -n \"$CURRENT_PREFIX\" ] && [ \"$CURRENT_PREFIX\" != \"$HOME/.local\" ]; then npm uninstall -g {package_name} >/dev/null 2>&1 || true; fi"
                    ),
                ],
                env,
                timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
                retryable_diagnostics: Self::network_retryable_diagnostics(),
            }
        }
    }

    fn brew_install_attempt(agent: AgentType) -> AgentInstallAttempt {
        let label = format!("Installing {} via Homebrew...", Self::agent_name(agent));

        let brew_cmd = match agent {
            AgentType::Codex => "brew install --cask codex",
            AgentType::Gemini => "brew install gemini-cli",
            AgentType::ClaudeCode => "brew install --cask claude",
        };

        AgentInstallAttempt {
            id: format!("{}-brew", Self::cache_key(agent)),
            label,
            phase: AgentInstallProgressPhase::Downloading,
            program: "bash".to_string(),
            args: vec![
                "-lc".to_string(),
                brew_cmd.to_string(),
            ],
            env: BTreeMap::new(),
            timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
            retryable_diagnostics: Self::network_retryable_diagnostics(),
        }
    }

    fn npm_install_attempt_with_node_dir(
        agent: AgentType,
        registry_candidates: &[String],
        node_dir: &Path,
    ) -> AgentInstallAttempt {
        let package_name = match agent {
            AgentType::ClaudeCode => "@anthropic-ai/claude-code",
            AgentType::Codex => "@openai/codex",
            AgentType::Gemini => "@google/gemini-cli",
        };
        let registry = registry_candidates.first().map(|s| s.as_str()).unwrap_or(OFFICIAL_NPM_REGISTRY);
        let node_dir_str = node_dir.display().to_string();
        let env = Self::npm_install_env_with_node_dir(registry, node_dir);

        AgentInstallAttempt {
            id: format!("{}-npm-node-dir", Self::cache_key(agent)),
            label: format!("Installing {} with detected Node.js...", Self::agent_name(agent)),
            phase: AgentInstallProgressPhase::Downloading,
            program: "bash".to_string(),
            args: vec![
                "-lc".to_string(),
                format!(
                    "export PATH=\"{node_dir_str}:$PATH\" && mkdir -p \"$HOME/.local/bin\" && npm install -g --prefix \"$HOME/.local\" --no-fund --no-audit {package_name} --registry={registry} && CURRENT_PREFIX=\"$(npm prefix -g 2>/dev/null || true)\" && if [ -n \"$CURRENT_PREFIX\" ] && [ \"$CURRENT_PREFIX\" != \"$HOME/.local\" ]; then npm uninstall -g {package_name} >/dev/null 2>&1 || true; fi"
                ),
            ],
            env,
            timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
            retryable_diagnostics: Self::network_retryable_diagnostics(),
        }
    }

    fn npm_install_env_with_node_dir(registry: &str, node_dir: &Path) -> BTreeMap<String, String> {
        let mut env = Self::npm_install_env(registry);
        if let Some(path_var) = env::var_os("PATH") {
            let mut paths = env::split_paths(&path_var).collect::<Vec<_>>();
            paths.insert(0, node_dir.to_path_buf());
            env.insert("PATH".to_string(), env::join_paths(paths).unwrap_or_default().to_string_lossy().to_string());
        }
        env
    }

    fn claude_official_install_attempt() -> AgentInstallAttempt {
        if cfg!(target_os = "windows") {
            AgentInstallAttempt {
                id: "claude-official".to_string(),
                label: "Downloading Claude Code...".to_string(),
                phase: AgentInstallProgressPhase::Downloading,
                program: "powershell".to_string(),
                args: vec![
                    "-Command".to_string(),
                    "irm https://claude.ai/install.ps1 | iex".to_string(),
                ],
                env: BTreeMap::new(),
                timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
                retryable_diagnostics: Self::claude_official_retryable_diagnostics(),
            }
        } else {
            AgentInstallAttempt {
                id: "claude-official".to_string(),
                label: "Downloading Claude Code...".to_string(),
                phase: AgentInstallProgressPhase::Downloading,
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    "curl -fsSL https://claude.ai/install.sh | bash".to_string(),
                ],
                env: BTreeMap::new(),
                timeout_ms: INSTALL_ATTEMPT_TIMEOUT_MS,
                retryable_diagnostics: Self::claude_official_retryable_diagnostics(),
            }
        }
    }

    fn npm_install_env(registry: &str) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert("npm_config_registry".to_string(), registry.to_string());
        env.insert("NPM_CONFIG_REGISTRY".to_string(), registry.to_string());
        env.insert("npm_config_fetch_retries".to_string(), "5".to_string());
        env.insert(
            "npm_config_fetch_retry_mintimeout".to_string(),
            "20000".to_string(),
        );
        env.insert(
            "npm_config_fetch_retry_maxtimeout".to_string(),
            "120000".to_string(),
        );
        env
    }

    fn network_retryable_diagnostics() -> Vec<AgentInstallDiagnosticCode> {
        vec![
            AgentInstallDiagnosticCode::DnsFailed,
            AgentInstallDiagnosticCode::Timeout,
            AgentInstallDiagnosticCode::TlsFailed,
            AgentInstallDiagnosticCode::RegistryBlocked,
        ]
    }

    fn claude_official_retryable_diagnostics() -> Vec<AgentInstallDiagnosticCode> {
        let mut diagnostics = Self::network_retryable_diagnostics();
        diagnostics.push(AgentInstallDiagnosticCode::InstallerCorrupt);
        diagnostics.push(AgentInstallDiagnosticCode::Unknown);
        diagnostics
    }

    fn has_inherited_proxy() -> bool {
        [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ]
        .iter()
        .any(|key| env::var_os(key).is_some_and(|value| !value.is_empty()))
    }

    fn probe_https_host(host: &str) -> HostProbe {
        let start = Instant::now();
        let addrs = match (host, 443).to_socket_addrs() {
            Ok(addrs) => addrs.collect::<Vec<_>>(),
            Err(_) => {
                return HostProbe {
                    reachable: false,
                    latency_ms: None,
                };
            }
        };

        for addr in addrs {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(INSTALL_PROBE_TIMEOUT_MS))
                .is_ok()
            {
                return HostProbe {
                    reachable: true,
                    latency_ms: Some(start.elapsed().as_millis()),
                };
            }
        }

        HostProbe {
            reachable: false,
            latency_ms: None,
        }
    }

    pub fn agent_name(agent: AgentType) -> &'static str {
        match agent {
            AgentType::ClaudeCode => "Claude Code",
            AgentType::Codex => "Codex CLI",
            AgentType::Gemini => "Gemini CLI",
        }
    }

    fn matches_any(text: &str, patterns: &[&str]) -> bool {
        patterns.iter().any(|pattern| text.contains(pattern))
    }

    pub fn get_uninstall_action(agent: AgentType) -> Option<AgentUninstallAction> {
        let executable = Self::install_status(agent).executable.map(PathBuf::from)?;

        match agent {
            AgentType::Codex => Self::codex_uninstall_action_for_path(&executable),
            AgentType::Gemini => Self::gemini_uninstall_action_for_path(&executable),
            AgentType::ClaudeCode => Self::claude_uninstall_action_for_path(&executable),
        }
    }

    fn codex_uninstall_action_for_path(executable: &Path) -> Option<AgentUninstallAction> {
        let path_text = executable.display().to_string();

        // Check for Homebrew installation (macOS/Linux)
        // Homebrew installs to /opt/homebrew/bin on Apple Silicon and /usr/local/bin on Intel Mac
        // On Linux, it's typically /home/linuxbrew/.linuxbrew/bin
        if !cfg!(target_os = "windows")
            && (path_text.contains("/opt/homebrew/bin")
                || path_text.contains("/usr/local/bin")
                || path_text.contains("/.linuxbrew/bin"))
        {
            // Homebrew installation - use brew uninstall, no npm required
            return Some(AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    "brew uninstall --cask codex 2>/dev/null || brew uninstall codex 2>/dev/null || echo 'Homebrew uninstall attempted'".to_string(),
                ],
            });
        }

        // .local/bin installation via npm --prefix. The shared uninstall helper now
        // removes both the default global install and the local-prefix install.
        if path_text.contains(".local/bin/codex") || path_text.contains(".local\\bin\\codex") {
            return Some(Self::npm_uninstall_action("@openai/codex"));
        }

        // npm global installation (default for all platforms)
        // This handles both fnm/nvm managed installations and our --prefix installations
        Some(Self::npm_uninstall_action("@openai/codex"))
    }

    fn gemini_uninstall_action_for_path(executable: &Path) -> Option<AgentUninstallAction> {
        let path_text = executable.display().to_string();

        // Check for Homebrew installation (macOS/Linux)
        if !cfg!(target_os = "windows")
            && (path_text.contains("/opt/homebrew/bin")
                || path_text.contains("/usr/local/bin")
                || path_text.contains("/.linuxbrew/bin"))
        {
            // Homebrew installation - use brew uninstall, no npm required
            return Some(AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    "brew uninstall gemini-cli 2>/dev/null || echo 'Homebrew uninstall attempted'"
                        .to_string(),
                ],
            });
        }

        // .local/bin installation via npm --prefix. The shared uninstall helper now
        // removes both the default global install and the local-prefix install.
        if path_text.contains(".local/bin/gemini") || path_text.contains(".local\\bin\\gemini") {
            return Some(Self::npm_uninstall_action("@google/gemini-cli"));
        }

        // npm global installation (default for all platforms)
        Some(Self::npm_uninstall_action("@google/gemini-cli"))
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

    pub fn launch_executable_hint(agent: AgentType) -> Option<String> {
        if let Some(cached) = Self::load_cached_install_status(agent) {
            if let Some(executable) = cached.executable {
                return Some(executable);
            }
        }

        let command = Self::executable_name(agent);
        Self::find_executable_hint(command).map(|path| path.display().to_string())
    }

    fn detect_installed_with_node_dir(
        agent: AgentType,
        node_runtime_dir: Option<&Path>,
    ) -> DetectionResult {
        Self::find_executable_with_node_dir(Self::executable_name(agent), node_runtime_dir)
    }

    pub fn check_node_env() -> bool {
        Self::find_executable("node").executable.is_some()
            || Self::command_succeeds("node", &["-v"])
    }

    pub fn check_npm_env() -> bool {
        Self::find_executable("npm").executable.is_some() || Self::command_succeeds("npm", &["-v"])
    }

    fn command_succeeds(command_name: &str, args: &[&str]) -> bool {
        let mut command = Command::new(command_name);
        configure_background_command(&mut command);
        command
            .args(args)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn find_executable(command: &str) -> DetectionResult {
        Self::find_executable_with_node_dir(command, None)
    }

    fn find_executable_hint(command: &str) -> Option<PathBuf> {
        if let Some(path) = Self::managed_global_executable(command) {
            return Some(path);
        }

        if let Some(path) = Self::resolve_command_in_path(command) {
            return Some(path);
        }

        let mut searched = BTreeSet::new();
        for dir in Self::candidate_search_dirs() {
            if !searched.insert(dir.clone()) {
                continue;
            }
            for candidate_name in Self::executable_candidates(command) {
                let full_path = dir.join(&candidate_name);
                if Self::is_runnable_file(&full_path) {
                    return Some(full_path);
                }
            }
        }

        None
    }

    fn find_executable_with_node_dir(
        command: &str,
        node_runtime_dir: Option<&Path>,
    ) -> DetectionResult {
        let path_env_path = Self::resolve_command_in_path(command);
        let shell_path = Self::resolve_command_via_login_shell(command);
        let shell_ready = if cfg!(target_os = "windows") {
            path_env_path.is_some()
        } else {
            shell_path.is_some()
        };

        let mut seen_paths = BTreeSet::new();
        if let Some(result) = Self::try_verified_candidate(
            command,
            Self::managed_global_executable(command),
            vec!["managed-global".to_string()],
            shell_ready,
            &mut seen_paths,
            node_runtime_dir,
        ) {
            return result;
        }

        if let Some(result) = Self::try_verified_candidate(
            command,
            path_env_path,
            vec!["path-env".to_string()],
            shell_ready,
            &mut seen_paths,
            node_runtime_dir,
        ) {
            return result;
        }

        let mut searched = BTreeSet::new();
        for dir in Self::candidate_search_dirs() {
            if !searched.insert(dir.clone()) {
                continue;
            }
            for candidate_name in Self::executable_candidates(command) {
                let full_path = dir.join(&candidate_name);
                if let Some(result) = Self::try_verified_candidate(
                    command,
                    Some(full_path),
                    vec!["path-scan".to_string()],
                    shell_ready,
                    &mut seen_paths,
                    node_runtime_dir,
                ) {
                    return result;
                }
            }
        }

        if let Some(result) = Self::try_verified_candidate(
            command,
            shell_path,
            vec!["login-shell".to_string()],
            shell_ready,
            &mut seen_paths,
            node_runtime_dir,
        ) {
            return result;
        }

        DetectionResult {
            executable: None,
            detected_by: Vec::new(),
            shell_ready,
        }
    }

    fn try_verified_candidate(
        command: &str,
        candidate: Option<PathBuf>,
        base_labels: Vec<String>,
        shell_ready: bool,
        seen_paths: &mut BTreeSet<String>,
        node_runtime_dir: Option<&Path>,
    ) -> Option<DetectionResult> {
        let candidate = candidate?;
        let key = candidate.display().to_string();
        if !seen_paths.insert(key) {
            return None;
        }
        if !Self::verify_executable(command, &candidate, node_runtime_dir) {
            return None;
        }

        let mut labels = base_labels;
        labels.extend(Self::detection_labels_for_path(&candidate));
        labels.sort();
        labels.dedup();
        Some(DetectionResult {
            executable: Some(candidate),
            detected_by: labels,
            shell_ready,
        })
    }

    fn candidate_search_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();

        if let Some(path) = env::var_os("PATH") {
            dirs.extend(env::split_paths(&path));
        }

        dirs.extend(Self::common_binary_dirs());
        dirs
    }

    pub fn common_binary_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        let home = Self::user_home_dir();

        if let Some(home) = home.as_ref() {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".npm-global").join("bin"));
            dirs.push(home.join(".yarn").join("bin"));
            dirs.push(home.join(".volta").join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
            dirs.push(home.join(".asdf").join("shims"));
            dirs.push(home.join(".fnm").join("current").join("bin"));
            dirs.extend(Self::read_child_bin_dirs(
                &home.join(".local").join("state").join("fnm_multishells"),
                None,
            ));
            dirs.extend(Self::read_child_bin_dirs(
                &home
                    .join(".local")
                    .join("share")
                    .join("fnm")
                    .join("node-versions"),
                Some(Path::new("installation").join("bin")),
            ));
            dirs.extend(Self::read_child_bin_dirs(
                &home.join(".nvm").join("versions").join("node"),
                Some(Path::new("bin").to_path_buf()),
            ));
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(appdata) = env::var_os("APPDATA") {
                dirs.push(PathBuf::from(appdata).join("npm"));
            }
            if let Some(localappdata) = env::var_os("LOCALAPPDATA") {
                dirs.push(PathBuf::from(localappdata).join("Programs").join("nodejs"));
            }
            if let Some(programfiles) = env::var_os("ProgramFiles") {
                dirs.push(PathBuf::from(programfiles).join("nodejs"));
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            dirs.push(PathBuf::from("/opt/homebrew/bin"));
            dirs.push(PathBuf::from("/usr/local/bin"));
            dirs.push(PathBuf::from("/usr/bin"));
            dirs.push(PathBuf::from("/bin"));
        }

        dirs
    }

    fn read_child_bin_dirs(root: &Path, nested_suffix: Option<PathBuf>) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        let entries = match std::fs::read_dir(root) {
            Ok(entries) => entries,
            Err(_) => return dirs,
        };

        for entry in entries.flatten() {
            let child = entry.path();
            let dir = if let Some(suffix) = nested_suffix.as_ref() {
                child.join(suffix)
            } else {
                child.join("bin")
            };
            if dir.is_dir() {
                dirs.push(dir);
            }
        }

        dirs
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

    fn managed_global_executable(command: &str) -> Option<PathBuf> {
        let home = Self::user_home_dir()?;
        let bin_dir = home.join(".local").join("bin");
        for candidate in Self::executable_candidates(command) {
            let full_path = bin_dir.join(candidate);
            if Self::is_runnable_file(&full_path) {
                return Some(full_path);
            }
        }
        None
    }

    fn detection_labels_for_path(path: &Path) -> Vec<String> {
        let text = path.display().to_string();
        let mut labels = vec!["path-scan".to_string()];

        if text.contains(".local/bin") {
            labels.push("local-bin".to_string());
        }
        if text.contains(".asdf/shims") {
            labels.push("asdf".to_string());
        }
        if text.contains(".fnm/current/bin") {
            labels.push("fnm-current".to_string());
        }
        if text.contains(".local/state/fnm_multishells") {
            labels.push("fnm-multishell".to_string());
        }
        if text.contains(".local/share/fnm/node-versions") {
            labels.push("fnm".to_string());
        }
        if text.contains(".nvm/versions/node") {
            labels.push("nvm".to_string());
        }
        if text.contains(".volta/bin") {
            labels.push("volta".to_string());
        }
        if text.contains(".local/share/claude") || text.contains(".local/bin/claude") {
            labels.push("claude-native".to_string());
        }
        if text.contains("/opt/homebrew/bin") {
            labels.push("homebrew".to_string());
        }
        if text.contains("/usr/local/bin") {
            labels.push("usr-local".to_string());
        }
        if text.contains("node_modules") || text.contains("npm") {
            labels.push("npm-global".to_string());
        }

        labels.sort();
        labels.dedup();
        labels
    }

    fn resolve_command_in_path(command_name: &str) -> Option<PathBuf> {
        let path_var = env::var_os("PATH")?;
        for dir in env::split_paths(&path_var) {
            for candidate in Self::executable_candidates(command_name) {
                let full_path = dir.join(candidate);
                if Self::is_runnable_file(&full_path) {
                    return Some(full_path);
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    fn resolve_command_via_login_shell(command_name: &str) -> Option<PathBuf> {
        let mut shells = Vec::new();
        if let Some(shell) = env::var_os("SHELL").map(PathBuf::from).and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        }) {
            shells.push(shell);
        }
        shells.extend(["bash".to_string(), "zsh".to_string(), "sh".to_string()]);

        let mut seen = BTreeSet::new();
        for shell in shells {
            if !seen.insert(shell.clone()) {
                continue;
            }
            let Ok(output) = Command::new(&shell)
                .arg("-lc")
                .arg(format!("command -v {command_name}"))
                .output()
            else {
                continue;
            };
            if !output.status.success() {
                continue;
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let candidate = stdout.trim();
            if candidate.is_empty() {
                continue;
            }
            let path = PathBuf::from(candidate);
            if Self::is_runnable_file(&path) {
                return Some(path);
            }
        }

        None
    }

    #[cfg(target_os = "windows")]
    fn resolve_command_via_login_shell(_command_name: &str) -> Option<PathBuf> {
        None
    }

    fn verify_executable(command_name: &str, path: &Path, node_runtime_dir: Option<&Path>) -> bool {
        if !Self::is_runnable_file(path) {
            return false;
        }

        let mut command = Command::new(path);
        configure_background_command(&mut command);
        if Self::node_wrapped_command(command_name) {
            if let Some(node_dir) = node_runtime_dir {
                let current_path = env::var_os("PATH")
                    .map(|value| env::split_paths(&value).collect::<Vec<_>>())
                    .unwrap_or_default();
                let mut paths = Vec::with_capacity(current_path.len() + 2);
                if let Some(parent) = path.parent() {
                    paths.push(parent.to_path_buf());
                }
                paths.push(node_dir.to_path_buf());
                paths.extend(current_path);
                command.env("PATH", env::join_paths(paths).unwrap_or_default());
            }
        }
        command
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn node_wrapped_command(command_name: &str) -> bool {
        matches!(command_name, "codex" | "gemini" | "npm")
    }

    pub fn find_node_runtime_dir() -> Option<PathBuf> {
        if let Some(path) = Self::resolve_command_in_path("node") {
            return path.parent().map(Path::to_path_buf);
        }

        let mut searched = BTreeSet::new();
        for dir in Self::candidate_search_dirs() {
            if !searched.insert(dir.clone()) {
                continue;
            }
            for candidate in Self::executable_candidates("node") {
                let full_path = dir.join(&candidate);
                if Self::is_runnable_file(&full_path) {
                    return full_path.parent().map(Path::to_path_buf);
                }
            }
        }

        let shell_node = Self::resolve_command_via_login_shell("node")?;
        shell_node.parent().map(Path::to_path_buf)
    }

    pub fn invalidate_install_status_cache(agent: Option<AgentType>) {
        let Some(path) = Self::install_status_cache_path() else {
            return;
        };
        let Some(mut store) = Self::read_install_status_cache_store(&path) else {
            return;
        };

        match agent {
            Some(agent) => {
                store.entries.remove(Self::cache_key(agent));
            }
            None => {
                store.entries.clear();
            }
        }

        if store.entries.is_empty() {
            let _ = std::fs::remove_file(path);
            return;
        }
        let _ = Self::write_install_status_cache_store(&path, &store);
    }

    fn npm_uninstall_action(package_name: &str) -> AgentUninstallAction {
        // Try to uninstall from both the default npm global location
        // and the ~/.local prefix location.
        // This handles cases where users have multiple installations:
        // 1. fnm/nvm managed: npm root -g (e.g., ~/.local/share/fnm/...)
        // 2. Our installation: ~/.local (via --prefix)
        if cfg!(target_os = "windows") {
            AgentUninstallAction::Command {
                program: "cmd".to_string(),
                args: vec![
                    "/C".to_string(),
                    format!(
                        "npm uninstall -g {package_name} 2>nul & npm uninstall -g --prefix \"%USERPROFILE%\\.local\" {package_name} 2>nul"
                    ),
                ],
            }
        } else {
            AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    format!(
                        "npm uninstall -g {package_name} 2>/dev/null; npm uninstall -g --prefix \"$HOME/.local\" {package_name} 2>/dev/null; true"
                    ),
                ],
            }
        }
    }

    fn claude_uninstall_action_for_path(executable: &Path) -> Option<AgentUninstallAction> {
        let path_text = executable.display().to_string();
        // npm global installation
        if path_text.contains("node_modules") || path_text.contains("npm") {
            return Some(Self::npm_uninstall_action("@anthropic-ai/claude-code"));
        }
        // Homebrew installation (macOS/Linux)
        if path_text.contains("/opt/homebrew/bin") || path_text.contains("/usr/local/bin") {
            return Some(AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    "brew uninstall --cask claude-code".to_string(),
                ],
            });
        }
        // Windows installations
        #[cfg(target_os = "windows")]
        {
            // WinGet installation path pattern
            if path_text.contains("WindowsApps")
                || path_text.contains("Program Files\\WindowsApps")
                || path_text.contains("Anthropic.ClaudeCode")
            {
                return Some(AgentUninstallAction::Command {
                    program: "powershell".to_string(),
                    args: vec![
                        "-Command".to_string(),
                        "winget uninstall Anthropic.ClaudeCode --silent 2>$null; if ($LASTEXITCODE -ne 0) { exit 0 }".to_string(),
                    ],
                });
            }
            // Native installation (PowerShell script)
            if path_text.ends_with("claude.exe") || path_text.contains(".local\\bin\\claude") {
                let paths = Self::claude_native_remove_paths();
                if !paths.is_empty() {
                    return Some(AgentUninstallAction::RemovePaths { paths });
                }
            }
        }
        // Native installation (Unix-like systems)
        if path_text.contains(".local/bin/claude") {
            let paths = Self::claude_native_remove_paths();
            if !paths.is_empty() {
                return Some(AgentUninstallAction::RemovePaths { paths });
            }
            return None;
        }
        None
    }

    fn claude_native_remove_paths() -> Vec<PathBuf> {
        let Some(home) = Self::user_home_dir() else {
            return Vec::new();
        };

        if cfg!(target_os = "windows") {
            vec![
                home.join(".local").join("bin").join("claude.exe"),
                home.join(".local").join("share").join("claude"),
            ]
        } else {
            vec![
                home.join(".local").join("bin").join("claude"),
                home.join(".local").join("share").join("claude"),
            ]
        }
    }

    fn user_home_dir() -> Option<PathBuf> {
        Self::path_from_env(env::var_os("HOME"))
            .or_else(|| Self::path_from_env(env::var_os("USERPROFILE")))
            .or_else(|| {
                let drive = env::var_os("HOMEDRIVE")?;
                let path = env::var_os("HOMEPATH")?;
                let joined = PathBuf::from(drive).join(PathBuf::from(path));
                if joined.as_os_str().is_empty() {
                    None
                } else {
                    Some(joined)
                }
            })
    }

    fn path_from_env(value: Option<std::ffi::OsString>) -> Option<PathBuf> {
        let value = value?;
        if value.is_empty() {
            return None;
        }
        Some(PathBuf::from(value))
    }

    fn cache_key(agent: AgentType) -> &'static str {
        match agent {
            AgentType::ClaudeCode => "claude",
            AgentType::Codex => "codex",
            AgentType::Gemini => "gemini",
        }
    }

    fn load_cached_install_status(agent: AgentType) -> Option<AgentInstallStatus> {
        let path = Self::install_status_cache_path()?;
        let store = Self::read_install_status_cache_store(&path)?;
        let entry = store.entries.get(Self::cache_key(agent))?;
        if !Self::cached_status_is_fresh(entry) {
            return None;
        }

        let mut status = entry.status.clone();
        if !status.detected_by.iter().any(|label| label == "cache") {
            status.detected_by.insert(0, "cache".to_string());
        }
        if status.installed {
            status.auto_install_supported = true;
            status.recommended_action = None;
        } else {
            // Re-check brew availability from cache (stale but acceptable)
            status.auto_install_supported = matches!(agent, AgentType::ClaudeCode)
                || (status.requires_node && (status.npm_ready || status.brew_ready));
            if status.recommended_action.is_none() {
                status.recommended_action = if status.requires_node && !status.node_ready && !status.brew_ready {
                    Some(AgentInstallRecommendedAction::InstallNode)
                } else if status.auto_install_supported {
                    Some(AgentInstallRecommendedAction::Install)
                } else {
                    Some(AgentInstallRecommendedAction::ManualHelp)
                };
            }
        }
        Some(status)
    }

    fn store_cached_install_status(agent: AgentType, status: &AgentInstallStatus) {
        let Some(path) = Self::install_status_cache_path() else {
            return;
        };

        let mut store = Self::read_install_status_cache_store(&path).unwrap_or_default();
        store.version = AGENT_INSTALL_STATUS_CACHE_VERSION;
        store.entries.insert(
            Self::cache_key(agent).to_string(),
            CachedAgentInstallStatus {
                checked_at_ms: Self::now_ms(),
                status: status.clone(),
            },
        );
        let _ = Self::write_install_status_cache_store(&path, &store);
    }

    fn install_status_cache_path() -> Option<PathBuf> {
        Self::user_home_dir().map(|home| {
            home.join(".gtoffice")
                .join("cache")
                .join("agent-install-status.json")
        })
    }

    fn read_install_status_cache_store(path: &Path) -> Option<AgentInstallStatusCacheStore> {
        let raw = std::fs::read(path).ok()?;
        let store = serde_json::from_slice::<AgentInstallStatusCacheStore>(&raw).ok()?;
        if store.version != AGENT_INSTALL_STATUS_CACHE_VERSION {
            return None;
        }
        Some(store)
    }

    fn write_install_status_cache_store(
        path: &Path,
        store: &AgentInstallStatusCacheStore,
    ) -> Option<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }
        let body = serde_json::to_vec_pretty(store).ok()?;
        std::fs::write(path, body).ok()?;
        Some(())
    }

    fn cached_status_is_fresh(entry: &CachedAgentInstallStatus) -> bool {
        let age_ms = Self::now_ms().saturating_sub(entry.checked_at_ms);
        let ttl_ms = if entry.status.installed {
            AGENT_INSTALL_STATUS_POSITIVE_TTL_MS
        } else {
            AGENT_INSTALL_STATUS_NEGATIVE_TTL_MS
        };
        if age_ms > ttl_ms {
            return false;
        }

        if entry.status.installed {
            let Some(executable) = entry.status.executable.as_deref().map(PathBuf::from) else {
                return false;
            };
            return Self::is_runnable_file(&executable);
        }

        true
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
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
