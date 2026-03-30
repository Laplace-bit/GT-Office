use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
                "version": 1,
                "entries": {
                    "codex": {
                        "checkedAtMs": now_ms,
                        "status": {
                            "installed": true,
                            "executable": executable.display().to_string(),
                            "requiresNode": true,
                            "nodeReady": true,
                            "npmReady": true,
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
                "version": 1,
                "entries": {
                    "codex": {
                        "checkedAtMs": now_ms,
                        "status": {
                            "installed": true,
                            "executable": executable.display().to_string(),
                            "requiresNode": true,
                            "nodeReady": true,
                            "npmReady": true,
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
    fn install_mcp_bridge_config_writes_codex_toml_and_managed_policy() {
        let dir = temp_dir("mcp-codex-config");
        with_test_home(&dir, |home| {
            let workspace_root = dir.join("workspace");
            fs::create_dir_all(&workspace_root).expect("create workspace");

            let mut env = BTreeMap::new();
            env.insert(
                "GTO_MCP_RUNTIME_FILE".to_string(),
                home.join(".gtoffice/mcp/runtime.json").display().to_string(),
            );

            AgentInstaller::install_mcp_bridge_config(
                home,
                &workspace_root,
                &["codex"],
                "/Applications/GT Office.app/Contents/Resources/gto-agent-mcp-sidecar",
                &["serve"],
                &env,
            )
            .expect("install mcp config");

            let codex_config = home.join(".codex/config.toml");
            let codex_text = fs::read_to_string(&codex_config).expect("read codex config");
            assert!(codex_text.contains("[mcp_servers.gto-agent-bridge]"));
            assert!(
                codex_text.contains("command = \"/Applications/GT Office.app/Contents/Resources/gto-agent-mcp-sidecar\"")
            );
            assert!(codex_text.contains("args = [\"serve\"]"));
            assert!(codex_text.contains("GTO_MCP_RUNTIME_FILE"));

            let managed_policy = home.join(".gtoffice/mcp/agent-communication.md");
            let policy_text = fs::read_to_string(&managed_policy).expect("read global policy");
            assert!(policy_text.contains("gto-agent-bridge"));

            let codex_rules = home.join(".codex/AGENTS.md");
            let codex_rules_text = fs::read_to_string(&codex_rules).expect("read codex rules");
            assert!(codex_rules_text.contains("# BEGIN gto-agent-bridge"));
        });
    }

    #[test]
    fn install_mcp_bridge_config_writes_claude_project_and_legacy_entries() {
        let dir = temp_dir("mcp-claude-config");
        with_test_home(&dir, |home| {
            let workspace_root = dir.join("workspace");
            fs::create_dir_all(&workspace_root).expect("create workspace");

            let mut env = BTreeMap::new();
            env.insert(
                "GTO_MCP_RUNTIME_FILE".to_string(),
                home.join(".gtoffice/mcp/runtime.json").display().to_string(),
            );
            env.insert(
                "GTO_AGENT_COMMUNICATION_POLICY_FILE".to_string(),
                home.join(".gtoffice/mcp/agent-communication.md").display().to_string(),
            );

            AgentInstaller::install_mcp_bridge_config(
                home,
                &workspace_root,
                &["claude"],
                "/Applications/GT Office.app/Contents/Resources/gto-agent-mcp-sidecar",
                &["serve"],
                &env,
            )
            .expect("install claude mcp config");

            let claude_legacy = home.join(".claude/settings.json");
            let legacy_text = fs::read_to_string(&claude_legacy).expect("read claude legacy config");
            assert!(legacy_text.contains("\"gto-agent-bridge\""));
            assert!(legacy_text.contains("\"command\": \"/Applications/GT Office.app/Contents/Resources/gto-agent-mcp-sidecar\""));

            let claude_modern = home.join(".claude.json");
            let modern_text = fs::read_to_string(&claude_modern).expect("read claude modern config");
            assert!(modern_text.contains("\"projects\""));
            assert!(modern_text.contains(workspace_root.to_string_lossy().as_ref()));
            assert!(modern_text.contains("\"gto-agent-bridge\""));

            let claude_rules = home.join(".claude/CLAUDE.md");
            let claude_rules_text = fs::read_to_string(&claude_rules).expect("read claude rules");
            assert!(claude_rules_text.contains("# BEGIN gto-agent-bridge"));
        });
    }
}

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
    pub npm_ready: bool,
    pub install_available: bool,
    pub uninstall_available: bool,
    pub detected_by: Vec<String>,
    pub issues: Vec<String>,
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

const AGENT_INSTALL_STATUS_CACHE_VERSION: u32 = 1;
const AGENT_INSTALL_STATUS_POSITIVE_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const AGENT_INSTALL_STATUS_NEGATIVE_TTL_MS: u64 = 15 * 60 * 1000;
const MCP_SERVER_ID: &str = "gto-agent-bridge";
const MCP_MANAGED_BEGIN: &str = "# BEGIN gto-agent-bridge";
const MCP_MANAGED_END: &str = "# END gto-agent-bridge";
const MCP_POLICY_ENV_KEY: &str = "GTO_AGENT_COMMUNICATION_POLICY_FILE";

#[derive(Debug, Clone)]
struct DetectionResult {
    executable: Option<PathBuf>,
    detected_by: Vec<String>,
    shell_ready: bool,
}

#[derive(Debug, Clone)]
pub enum AgentUninstallAction {
    Command { program: String, args: Vec<String> },
    RemovePaths { paths: Vec<PathBuf> },
}

pub struct AgentInstaller;

impl AgentInstaller {
    pub fn install_mcp_bridge_config(
        home_dir: &Path,
        workspace_root: &Path,
        targets: &[&str],
        command: &str,
        args: &[&str],
        env_vars: &BTreeMap<String, String>,
    ) -> Result<(), String> {
        let home_dir = home_dir.to_path_buf();
        let workspace_root = workspace_root.to_path_buf();
        let global_policy = home_dir.join(".gtoffice").join("mcp").join("agent-communication.md");
        let policy_body = Self::build_mcp_communication_policy();
        Self::ensure_managed_markdown(&global_policy, &policy_body)?;

        let mut env = env_vars.clone();
        env.entry(MCP_POLICY_ENV_KEY.to_string())
            .or_insert_with(|| global_policy.display().to_string());

        let entry = McpServerEntry {
            command: command.to_string(),
            args: args.iter().map(|value| (*value).to_string()).collect(),
            env,
        };

        for target in targets {
            match target.trim().to_ascii_lowercase().as_str() {
                "claude" => {
                    Self::ensure_json_mcp_server(
                        &home_dir.join(".claude").join("settings.json"),
                        &entry,
                    )?;
                    Self::ensure_claude_project_mcp_server(
                        &home_dir.join(".claude.json"),
                        &entry,
                        &workspace_root,
                    )?;
                    Self::ensure_managed_markdown(
                        &home_dir.join(".claude").join("CLAUDE.md"),
                        &policy_body,
                    )?;
                }
                "codex" => {
                    Self::ensure_codex_toml(
                        &home_dir.join(".codex").join("config.toml"),
                        &entry,
                    )?;
                    Self::ensure_managed_markdown(
                        &home_dir.join(".codex").join("AGENTS.md"),
                        &policy_body,
                    )?;
                }
                "gemini" => {
                    Self::ensure_json_mcp_server(
                        &home_dir.join(".gemini").join("settings.json"),
                        &entry,
                    )?;
                    Self::ensure_managed_markdown(
                        &home_dir.join(".gemini").join("GEMINI.md"),
                        &policy_body,
                    )?;
                }
                "qwen" => {
                    Self::ensure_json_mcp_server(
                        &home_dir.join(".qwen").join("settings.json"),
                        &entry,
                    )?;
                    Self::ensure_managed_markdown(
                        &home_dir.join(".qwen").join("QWEN.md"),
                        &policy_body,
                    )?;
                }
                other => {
                    return Err(format!("unsupported MCP install target: {other}"));
                }
            }
        }

        Ok(())
    }

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
            Self::find_executable("npm").executable.is_some()
                || Self::command_succeeds("npm", &["-v"])
        } else {
            false
        };
        let mut issues = Vec::new();

        if requires_node && !node_ready {
            issues.push(
                "Node.js runtime not found in PATH or common installation directories.".to_string(),
            );
        }
        if requires_node && !npm_ready {
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
            AgentType::Codex | AgentType::Gemini => detection.executable.is_some() && npm_ready,
        };
        if matches!(agent, AgentType::ClaudeCode)
            && detection.executable.is_some()
            && !uninstall_available
        {
            issues.push("Claude CLI uninstall source could not be identified automatically; remove it with the original installer or package manager.".to_string());
        }

        let status = AgentInstallStatus {
            installed: detection.executable.is_some(),
            executable: detection
                .executable
                .as_ref()
                .map(|path| path.display().to_string()),
            requires_node,
            node_ready,
            npm_ready,
            install_available: match agent {
                AgentType::ClaudeCode => true,
                AgentType::Codex | AgentType::Gemini => npm_ready,
            },
            uninstall_available,
            detected_by: detection.detected_by,
            issues,
        };

        Self::store_cached_install_status(agent, &status);
        status
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
                    vec![
                        "/C".to_string(),
                        "npm install -g --prefix \"%USERPROFILE%\\.local\" @openai/codex"
                            .to_string(),
                    ],
                ),
                AgentType::Gemini => (
                    "cmd".to_string(),
                    vec![
                        "/C".to_string(),
                        "npm install -g --prefix \"%USERPROFILE%\\.local\" @google/gemini-cli"
                            .to_string(),
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
                    vec![
                        "-lc".to_string(),
                        "mkdir -p \"$HOME/.local/bin\" && npm install -g --prefix \"$HOME/.local\" @openai/codex".to_string(),
                    ],
                ),
                AgentType::Gemini => (
                    "bash".to_string(),
                    vec![
                        "-lc".to_string(),
                        "mkdir -p \"$HOME/.local/bin\" && npm install -g --prefix \"$HOME/.local\" @google/gemini-cli".to_string(),
                    ],
                ),
            }
        }
    }

    pub fn get_uninstall_action(agent: AgentType) -> Option<AgentUninstallAction> {
        let executable = Self::install_status(agent).executable.map(PathBuf::from)?;

        match agent {
            AgentType::Codex => Some(Self::npm_uninstall_action("@openai/codex")),
            AgentType::Gemini => Some(Self::npm_uninstall_action("@google/gemini-cli")),
            AgentType::ClaudeCode => Self::claude_uninstall_action_for_path(&executable),
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

    fn common_binary_dirs() -> Vec<PathBuf> {
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
        matches!(command_name, "codex" | "gemini")
    }

    fn find_node_runtime_dir() -> Option<PathBuf> {
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
        if cfg!(target_os = "windows") {
            AgentUninstallAction::Command {
                program: "cmd".to_string(),
                args: vec![
                    "/C".to_string(),
                    format!(
                        "npm uninstall -g --prefix \"%USERPROFILE%\\.local\" {package_name} || npm uninstall -g {package_name}"
                    ),
                ],
            }
        } else {
            AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    format!(
                        "npm uninstall -g --prefix \"$HOME/.local\" {package_name} || npm uninstall -g {package_name}"
                    ),
                ],
            }
        }
    }

    fn claude_uninstall_action_for_path(executable: &Path) -> Option<AgentUninstallAction> {
        let path_text = executable.display().to_string();
        if path_text.contains("node_modules") || path_text.contains("npm") {
            return Some(Self::npm_uninstall_action("@anthropic-ai/claude-code"));
        }
        if path_text.contains("/opt/homebrew/bin") || path_text.contains("/usr/local/bin") {
            return Some(AgentUninstallAction::Command {
                program: "bash".to_string(),
                args: vec![
                    "-lc".to_string(),
                    "brew uninstall --cask claude-code".to_string(),
                ],
            });
        }
        if cfg!(target_os = "windows")
            && (path_text.contains("Anthropic.ClaudeCode") || path_text.ends_with("claude.exe"))
        {
            let paths = Self::claude_native_remove_paths();
            if !paths.is_empty() {
                return Some(AgentUninstallAction::RemovePaths { paths });
            }
            return None;
        }
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

    fn build_mcp_communication_policy() -> String {
        [
            "# GT Office Agent Communication Policy",
            "",
            "When communicating with another GT Office agent, use the `gto-agent-bridge` MCP by default.",
            "",
            "- Use `gto_get_agent_directory` to discover agents and reuse `workspaceId` and `agentId` from that result.",
            "- Use `gto_dispatch_task` when you need another agent to execute or answer in its own terminal.",
            "- Use `gto_report_status` for short replies and progress updates.",
            "- Use `gto_handover` for completion summaries, blockers, and next steps.",
            "- Do not rely on plain terminal-only replies when an MCP reply is expected.",
            "",
        ]
        .join("\n")
    }

    fn ensure_managed_markdown(path: &Path, body: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create managed markdown dir {} failed: {error}", parent.display()))?;
        }

        let current = fs::read_to_string(path).unwrap_or_default();
        let mut next_lines = Vec::new();
        let mut skipping = false;
        for line in current.lines() {
            let trimmed = line.trim();
            if trimmed == MCP_MANAGED_BEGIN {
                skipping = true;
                continue;
            }
            if trimmed == MCP_MANAGED_END {
                skipping = false;
                continue;
            }
            if !skipping {
                next_lines.push(line.to_string());
            }
        }
        let mut next = next_lines.join("\n").trim_end().to_string();
        if !next.is_empty() {
            next.push_str("\n\n");
        }
        next.push_str(MCP_MANAGED_BEGIN);
        next.push('\n');
        next.push_str(body.trim());
        next.push('\n');
        next.push_str(MCP_MANAGED_END);
        next.push('\n');
        fs::write(path, next)
            .map_err(|error| format!("write managed markdown {} failed: {error}", path.display()))
    }

    fn ensure_json_mcp_server(path: &Path, entry: &McpServerEntry) -> Result<(), String> {
        let mut root = Self::read_json_root(path)?;
        let object = root
            .as_object_mut()
            .ok_or_else(|| format!("invalid JSON root for {}", path.display()))?;
        let mcp_servers = object
            .entry("mcpServers".to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        let servers_object = mcp_servers
            .as_object_mut()
            .ok_or_else(|| format!("invalid mcpServers root for {}", path.display()))?;
        servers_object.insert(MCP_SERVER_ID.to_string(), entry.to_json());
        Self::write_json(path, &root)
    }

    fn ensure_claude_project_mcp_server(
        path: &Path,
        entry: &McpServerEntry,
        workspace_root: &Path,
    ) -> Result<(), String> {
        let mut root = Self::read_json_root(path)?;
        let object = root
            .as_object_mut()
            .ok_or_else(|| format!("invalid JSON root for {}", path.display()))?;

        let projects = object
            .entry("projects".to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        let projects_object = projects
            .as_object_mut()
            .ok_or_else(|| format!("invalid projects root for {}", path.display()))?;
        let project_entry = projects_object
            .entry(workspace_root.display().to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        let project_object = project_entry
            .as_object_mut()
            .ok_or_else(|| format!("invalid Claude project entry for {}", path.display()))?;
        let project_servers = project_object
            .entry("mcpServers".to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        let project_servers_object = project_servers
            .as_object_mut()
            .ok_or_else(|| format!("invalid Claude project mcpServers for {}", path.display()))?;
        project_servers_object.insert(MCP_SERVER_ID.to_string(), entry.to_claude_json());

        let root_servers = object
            .entry("mcpServers".to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        let root_servers_object = root_servers
            .as_object_mut()
            .ok_or_else(|| format!("invalid Claude root mcpServers for {}", path.display()))?;
        root_servers_object.insert(MCP_SERVER_ID.to_string(), entry.to_claude_json());

        Self::write_json(path, &root)
    }

    fn ensure_codex_toml(path: &Path, entry: &McpServerEntry) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create codex config dir {} failed: {error}", parent.display()))?;
        }
        let current = fs::read_to_string(path).unwrap_or_default();
        let next = entry.render_codex_toml(&current);
        fs::write(path, next)
            .map_err(|error| format!("write codex config {} failed: {error}", path.display()))
    }

    fn read_json_root(path: &Path) -> Result<Value, String> {
        if !path.exists() {
            return Ok(json!({}));
        }
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("read JSON config {} failed: {error}", path.display()))?;
        serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("parse JSON config {} failed: {error}", path.display()))
    }

    fn write_json(path: &Path, value: &Value) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create JSON config dir {} failed: {error}", parent.display()))?;
        }
        let raw = serde_json::to_string_pretty(value)
            .map_err(|error| format!("serialize JSON config {} failed: {error}", path.display()))?;
        fs::write(path, format!("{raw}\n"))
            .map_err(|error| format!("write JSON config {} failed: {error}", path.display()))
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

#[derive(Debug, Clone)]
struct McpServerEntry {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

impl McpServerEntry {
    fn to_json(&self) -> Value {
        json!({
            "command": self.command,
            "args": self.args,
            "env": self.env,
        })
    }

    fn to_claude_json(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.command,
            "args": self.args,
            "env": self.env,
        })
    }

    fn render_codex_toml(&self, current: &str) -> String {
        let mut lines = Vec::new();
        let mut skipping = false;
        let mut in_legacy_table = false;

        for line in current.lines() {
            let trimmed = line.trim();
            if trimmed == MCP_MANAGED_BEGIN {
                skipping = true;
                continue;
            }
            if trimmed == MCP_MANAGED_END {
                skipping = false;
                continue;
            }
            if skipping {
                continue;
            }
            if trimmed.starts_with("[mcp_servers.") {
                in_legacy_table = trimmed == format!("[mcp_servers.{MCP_SERVER_ID}]");
                if in_legacy_table {
                    continue;
                }
            }
            if in_legacy_table {
                if trimmed.starts_with('[') {
                    in_legacy_table = false;
                } else {
                    continue;
                }
            }
            lines.push(line.to_string());
        }

        let mut next = lines.join("\n").trim_end().to_string();
        if !next.is_empty() {
            next.push_str("\n\n");
        }
        next.push_str(MCP_MANAGED_BEGIN);
        next.push('\n');
        next.push_str(&format!("[mcp_servers.{MCP_SERVER_ID}]\n"));
        next.push_str(&format!("command = {}\n", toml_quote(&self.command)));
        let args_literal = self
            .args
            .iter()
            .map(|value| toml_quote(value))
            .collect::<Vec<_>>()
            .join(", ");
        next.push_str(&format!("args = [{args_literal}]\n"));
        let env_literal = self
            .env
            .iter()
            .map(|(key, value)| format!("{key} = {}", toml_quote(value)))
            .collect::<Vec<_>>()
            .join(", ");
        next.push_str(&format!("env = {{ {env_literal} }}\n"));
        next.push_str("startup_timeout_sec = 20\n");
        next.push_str(MCP_MANAGED_END);
        next.push('\n');
        next
    }
}

fn toml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
