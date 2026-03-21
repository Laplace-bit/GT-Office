use std::collections::BTreeSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

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
    pub fn install_status(agent: AgentType) -> AgentInstallStatus {
        let detection = Self::detect_installed(agent);
        let requires_node = Self::requires_node_env(agent);
        let node_ready = if requires_node {
            Self::check_node_env()
        } else {
            true
        };
        let npm_ready = if requires_node {
            Self::check_npm_env()
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
            AgentType::ClaudeCode => Self::get_uninstall_action(agent).is_some(),
            AgentType::Codex | AgentType::Gemini => detection.executable.is_some() && npm_ready,
        };
        if matches!(agent, AgentType::ClaudeCode)
            && detection.executable.is_some()
            && !uninstall_available
        {
            issues.push("Claude CLI uninstall source could not be identified automatically; remove it with the original installer or package manager.".to_string());
        }

        AgentInstallStatus {
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
        let detection = Self::detect_installed(agent);
        let executable = detection.executable?;

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

    fn detect_installed(agent: AgentType) -> DetectionResult {
        Self::find_executable(Self::executable_name(agent))
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
        let mut searched = BTreeSet::new();
        let mut candidates: Vec<(PathBuf, Vec<String>)> = Vec::new();

        if let Some(path) = Self::resolve_command_in_path(command) {
            candidates.push((path, vec!["path-env".to_string()]));
        }

        for dir in Self::candidate_search_dirs() {
            if !searched.insert(dir.clone()) {
                continue;
            }
            for candidate in Self::executable_candidates(command) {
                let full_path = dir.join(&candidate);
                if Self::is_runnable_file(&full_path) {
                    candidates.push((full_path, vec!["path-scan".to_string()]));
                }
            }
        }

        let shell_path = Self::resolve_command_via_login_shell(command);
        let shell_ready = shell_path.is_some();
        if let Some(path) = shell_path {
            candidates.push((path, vec!["login-shell".to_string()]));
        }

        let mut seen_paths = BTreeSet::new();
        for (candidate, base_labels) in candidates {
            let key = candidate.display().to_string();
            if !seen_paths.insert(key) {
                continue;
            }
            if Self::verify_executable(command, &candidate) {
                let mut labels = base_labels;
                labels.extend(Self::detection_labels_for_path(&candidate));
                labels.sort();
                labels.dedup();
                return DetectionResult {
                    executable: Some(candidate),
                    detected_by: labels,
                    shell_ready,
                };
            }
        }

        DetectionResult {
            executable: None,
            detected_by: Vec::new(),
            shell_ready,
        }
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

    fn verify_executable(command_name: &str, path: &Path) -> bool {
        if !Self::is_runnable_file(path) {
            return false;
        }

        let mut command = Command::new(path);
        configure_background_command(&mut command);
        if Self::node_wrapped_command(command_name) {
            if let Some(node_dir) = Self::find_node_runtime_dir() {
                let current_path = env::var_os("PATH")
                    .map(|value| env::split_paths(&value).collect::<Vec<_>>())
                    .unwrap_or_default();
                let mut paths = Vec::with_capacity(current_path.len() + 2);
                if let Some(parent) = path.parent() {
                    paths.push(parent.to_path_buf());
                }
                paths.push(node_dir);
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
