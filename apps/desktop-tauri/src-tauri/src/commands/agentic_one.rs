use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager, State};

use vb_agent::AgentRepository;
use vb_ai_config::{
    agent_mcp_installed_for_workspace, agent_mcp_status_for_workspace, AiAgentMcpStatus,
};
use vb_storage::{SqliteAgentRepository, SqliteStorage};
use vb_tools::agent_installer::{
    AgentInstallStatus, AgentInstaller, AgentType, AgentUninstallAction,
};

use crate::{app_state::AppState, process_utils::configure_std_command};

#[tauri::command]
pub async fn agent_install_status(agent: AgentType) -> Result<AgentInstallStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(AgentInstaller::install_status(agent)))
        .await
        .map_err(|error| format!("AGENT_INSTALL_STATUS_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn agent_mcp_install_status(
    agent: AgentType,
    workspace_id: Option<String>,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<AiAgentMcpStatus, String> {
    let workspace_root = workspace_id
        .as_deref()
        .map(|id| state.workspace_root_path(id))
        .transpose()?;
    let app_handle = window.app_handle().clone();

    tauri::async_runtime::spawn_blocking(move || match agent {
        AgentType::ClaudeCode => {
            let project_roots = resolve_provider_project_roots(
                &app_handle,
                workspace_id.as_deref(),
                workspace_root.as_deref(),
                "claude",
            )?;
            Ok(aggregate_project_mcp_status(AgentType::ClaudeCode, &project_roots))
        }
        AgentType::Gemini => {
            let project_roots = resolve_provider_project_roots(
                &app_handle,
                workspace_id.as_deref(),
                workspace_root.as_deref(),
                "gemini",
            )?;
            Ok(aggregate_project_mcp_status(AgentType::Gemini, &project_roots))
        }
        _ => Ok(agent_mcp_status_for_workspace(agent, workspace_root.as_deref())),
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn install_agent(window: tauri::Window, agent: AgentType) -> Result<(), String> {
    let status = AgentInstaller::install_status_fresh(agent);

    if status.installed {
        return Ok(());
    }

    // 1. 环境预检
    if !status.install_available {
        return Err(status.issues.join(" "));
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{}", event_id);
    emit_progress(
        &window,
        &progress_event,
        format!("🚀 Initiating {} deployment...", name),
    );

    let (cmd_name, args) = AgentInstaller::get_install_command(agent);
    let status = run_progress_command(&window, &progress_event, &cmd_name, &args)?;

    if status.success() {
        ensure_global_shell_path_for_local_bin(&window, &progress_event);
        AgentInstaller::invalidate_install_status_cache(Some(agent));
        let verified = AgentInstaller::install_status_fresh(agent);
        if !verified.installed {
            return Err(format!(
                "{} installer exited successfully, but GT Office still cannot verify `{} --version`.",
                name,
                AgentInstaller::executable_name(agent)
            ));
        }
        if let Some(issue) = verified
            .issues
            .iter()
            .find(|issue| issue.contains("fresh shell still may not resolve"))
        {
            emit_progress(&window, &progress_event, format!("⚠️ {issue}"));
        }

        emit_progress(&window, &progress_event, format!("✅ {} installed.", name));

        Ok(())
    } else {
        Err(format!(
            "{} installation exited with error code: {:?}",
            name,
            status.code()
        ))
    }
}

#[tauri::command]
pub async fn uninstall_agent(window: tauri::Window, agent: AgentType) -> Result<(), String> {
    let status = AgentInstaller::install_status_fresh(agent);

    if !status.installed {
        return Ok(());
    }

    if !status.uninstall_available {
        return Err(status.issues.join(" "));
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{event_id}");
    emit_progress(&window, &progress_event, format!("🧹 Removing {name}..."));

    let action = AgentInstaller::get_uninstall_action(agent)
        .ok_or_else(|| format!("Automatic uninstall is not available for {name}."))?;

    match action {
        AgentUninstallAction::Command { program, args } => {
            let status = run_progress_command(&window, &progress_event, &program, &args)?;
            if !status.success() {
                return Err(format!(
                    "{name} uninstall exited with error code: {:?}",
                    status.code()
                ));
            }
        }
        AgentUninstallAction::RemovePaths { paths } => {
            remove_paths_with_progress(&window, &progress_event, &paths)?;
        }
    }

    AgentInstaller::invalidate_install_status_cache(Some(agent));
    let verified = AgentInstaller::install_status_fresh(agent);
    if verified.installed {
        return Err(format!(
            "{name} uninstall completed, but GT Office still detects `{}` at {}.",
            AgentInstaller::executable_name(agent),
            verified
                .executable
                .unwrap_or_else(|| "an unknown path".to_string())
        ));
    }

    emit_progress(&window, &progress_event, format!("✅ {name} removed."));
    Ok(())
}

#[tauri::command]
pub async fn install_agent_mcp(
    window: tauri::Window,
    agent: AgentType,
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let project_roots = match agent {
        AgentType::ClaudeCode => {
            resolve_provider_project_roots(
                window.app_handle(),
                Some(&workspace_id),
                Some(&workspace_root),
                "claude",
            )?
        }
        AgentType::Gemini => {
            resolve_provider_project_roots(
                window.app_handle(),
                Some(&workspace_id),
                Some(&workspace_root),
                "gemini",
            )?
        }
        _ => vec![workspace_root.clone()],
    };

    if !matches!(agent, AgentType::ClaudeCode | AgentType::Gemini)
        && tauri::async_runtime::spawn_blocking({
            let workspace_root_for_check = workspace_root.clone();
            move || agent_mcp_installed_for_workspace(agent, Some(workspace_root_for_check.as_path()))
        })
        .await
        .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?
    {
        return Ok(());
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{event_id}");
    emit_progress(
        &window,
        &progress_event,
        format!("🚀 Installing GT Office MCP bridge for {name}..."),
    );

    if let Some(local_entry) = resolve_local_bundled_mcp_server_entry(&window) {
        let home_dir = user_home_dir().ok_or_else(|| {
            "Unable to resolve user home directory for MCP installation.".to_string()
        })?;
        emit_progress(
            &window,
            &progress_event,
            format!(
                "ℹ️ Using bundled local MCP sidecar: {}",
                local_entry.command.display()
            ),
        );
        let project_roots_for_install = project_roots.clone();
        tauri::async_runtime::spawn_blocking(move || {
            install_agent_mcp_at_home(agent, &project_roots_for_install, &home_dir, &local_entry)
        })
        .await
        .map_err(|error| format!("MCP local install task failed: {error}"))??;
    } else {
        return Err("Bundled Rust MCP sidecar was not found. Reinstall GT Office or rebuild the desktop resources.".to_string());
    }

    let verified_roots = project_roots.clone();
    let verified_ok = tauri::async_runtime::spawn_blocking(move || {
        verified_roots.iter().all(|project_root| {
            !matches!(
                agent_mcp_status_for_workspace(agent, Some(project_root.as_path())),
                AiAgentMcpStatus::NotInstalled
            )
        })
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?;
    if !verified_ok {
        return Err(format!(
            "GT Office MCP bridge install did not complete cleanly for {name}; one or more project scopes are still missing the MCP entry."
        ));
    }

    let _ = state.invalidate_ai_config_snapshot_cache(&workspace_id);
    emit_progress(
        &window,
        &progress_event,
        format!("✅ GT Office MCP bridge installed for {name}."),
    );
    Ok(())
}

#[tauri::command]
pub async fn uninstall_agent_mcp(
    window: tauri::Window,
    agent: AgentType,
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let project_roots = match agent {
        AgentType::ClaudeCode => {
            resolve_provider_project_roots(
                window.app_handle(),
                Some(&workspace_id),
                Some(&workspace_root),
                "claude",
            )?
        }
        AgentType::Gemini => {
            resolve_provider_project_roots(
                window.app_handle(),
                Some(&workspace_id),
                Some(&workspace_root),
                "gemini",
            )?
        }
        _ => vec![workspace_root.clone()],
    };

    let current_installed = tauri::async_runtime::spawn_blocking({
        let project_roots_for_check = project_roots.clone();
        move || {
            project_roots_for_check.iter().any(|project_root| {
                !matches!(
                    agent_mcp_status_for_workspace(agent, Some(project_root.as_path())),
                    AiAgentMcpStatus::NotInstalled
                )
            })
        }
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?;

    if !current_installed {
        return Ok(());
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{event_id}");
    emit_progress(
        &window,
        &progress_event,
        format!("🧹 Removing GT Office MCP bridge for {name}..."),
    );

    let home_dir = user_home_dir()
        .ok_or_else(|| "Unable to resolve user home directory for MCP uninstall.".to_string())?;
    let project_roots_for_uninstall = project_roots.clone();

    tauri::async_runtime::spawn_blocking(move || {
        uninstall_agent_mcp_at_home(agent, &project_roots_for_uninstall, &home_dir)
    })
    .await
    .map_err(|error| format!("MCP local uninstall task failed: {error}"))??;

    let verified_roots = project_roots.clone();
    let verified_ok = tauri::async_runtime::spawn_blocking(move || {
        verified_roots.iter().all(|project_root| {
            matches!(
                agent_mcp_status_for_workspace(agent, Some(project_root.as_path())),
                AiAgentMcpStatus::NotInstalled
            )
        })
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?;

    if !verified_ok {
        return Err(format!(
            "GT Office MCP bridge uninstall did not complete cleanly for {name}; one or more project scopes still keep the MCP entry."
        ));
    }

    let _ = state.invalidate_ai_config_snapshot_cache(&workspace_id);
    emit_progress(
        &window,
        &progress_event,
        format!("✅ GT Office MCP bridge removed for {name}."),
    );
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalMcpServerEntry {
    command: PathBuf,
    args: Vec<String>,
}

fn resolve_local_bundled_mcp_server_entry(window: &tauri::Window) -> Option<LocalMcpServerEntry> {
    let mut candidate_dirs = Vec::new();
    if let Ok(path) = window.app_handle().path().resource_dir() {
        candidate_dirs.push(path);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("apps/desktop-tauri/src-tauri/binaries"));
    }

    for dir in candidate_dirs {
        if let Some(entry) = resolve_local_bundled_mcp_server_entry_from_dir(&dir) {
            return Some(entry);
        }
    }

    None
}

fn resolve_local_bundled_mcp_server_entry_from_dir(dir: &Path) -> Option<LocalMcpServerEntry> {
    let exact_name = if cfg!(target_os = "windows") {
        "gto-agent-mcp-sidecar.exe".to_string()
    } else {
        "gto-agent-mcp-sidecar".to_string()
    };
    let exact_path = dir.join(&exact_name);
    if exact_path.is_file() {
        return Some(LocalMcpServerEntry {
            command: exact_path,
            args: vec!["serve".to_string()],
        });
    }

    let prefix = "gto-agent-mcp-sidecar-";
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(prefix) {
            continue;
        }
        if cfg!(target_os = "windows") && !name.ends_with(".exe") {
            continue;
        }
        return Some(LocalMcpServerEntry {
            command: path,
            args: vec!["serve".to_string()],
        });
    }

    None
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
}

fn resolve_agent_repository(app: &tauri::AppHandle) -> Result<SqliteAgentRepository, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    let db_path = base_dir.join("gtoffice.db");
    let storage = SqliteStorage::new(db_path).map_err(|error| error.to_string())?;
    Ok(SqliteAgentRepository::new(storage))
}

fn resolve_provider_project_roots(
    app: &tauri::AppHandle,
    workspace_id: Option<&str>,
    workspace_root: Option<&Path>,
    provider_hint: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut roots = std::collections::BTreeSet::new();
    if let Some(workspace_root) = workspace_root {
        roots.insert(workspace_root.to_path_buf());
    }

    let Some(workspace_id) = workspace_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(roots.into_iter().collect());
    };
    let Some(workspace_root) = workspace_root else {
        return Ok(roots.into_iter().collect());
    };

    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(|error| error.to_string())?;
    let agents = repo.list_agents(workspace_id).map_err(|error| error.to_string())?;
    for agent in agents {
        if !agent
            .tool
            .trim()
            .to_ascii_lowercase()
            .contains(provider_hint)
        {
            continue;
        }
        let Some(workdir) = agent.workdir.as_deref().filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        roots.insert(workspace_root.join(workdir));
    }

    Ok(roots.into_iter().collect())
}

fn aggregate_project_mcp_status(agent: AgentType, project_roots: &[PathBuf]) -> AiAgentMcpStatus {
    let mut saw_legacy = false;
    let mut saw_installed = false;
    for project_root in project_roots {
        match agent_mcp_status_for_workspace(agent, Some(project_root.as_path())) {
            AiAgentMcpStatus::NotInstalled => return AiAgentMcpStatus::NotInstalled,
            AiAgentMcpStatus::InstalledLegacyNode => {
                saw_legacy = true;
                saw_installed = true;
            }
            AiAgentMcpStatus::InstalledSidecar => {
                saw_installed = true;
            }
        }
    }

    if saw_legacy {
        AiAgentMcpStatus::InstalledLegacyNode
    } else if saw_installed {
        AiAgentMcpStatus::InstalledSidecar
    } else {
        AiAgentMcpStatus::NotInstalled
    }
}

fn emit_progress(window: &tauri::Window, event: &str, message: String) {
    let _ = window.emit(event, message);
}

fn ensure_global_shell_path_for_local_bin(window: &tauri::Window, progress_event: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = window;
        let _ = progress_event;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let Some(home) = user_home_dir() else {
            return;
        };
        let local_bin = home.join(".local").join("bin");
        if let Err(error) = fs::create_dir_all(&local_bin) {
            emit_progress(
                window,
                progress_event,
                format!(
                    "⚠️ Failed to create {} for global CLI exposure: {}",
                    local_bin.display(),
                    error
                ),
            );
            return;
        }

        let marker_start = "# >>> GT Office local-bin >>>";
        let marker_end = "# <<< GT Office local-bin <<<";
        let export_line = "export PATH=\"$HOME/.local/bin:$PATH\"";
        let block = format!("\n{marker_start}\n{export_line}\n{marker_end}\n");
        let rc_files = [
            ".zshrc",
            ".zprofile",
            ".bashrc",
            ".bash_profile",
            ".profile",
        ];
        let mut updated = Vec::new();

        for rc_name in rc_files {
            let rc_path = home.join(rc_name);
            let existing = match fs::read_to_string(&rc_path) {
                Ok(content) => content,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
                Err(error) => {
                    emit_progress(
                        window,
                        progress_event,
                        format!("⚠️ Failed to read {}: {}", rc_path.display(), error),
                    );
                    continue;
                }
            };

            if existing.contains(export_line) || existing.contains(marker_start) {
                continue;
            }

            let mut file = match OpenOptions::new().create(true).append(true).open(&rc_path) {
                Ok(file) => file,
                Err(error) => {
                    emit_progress(
                        window,
                        progress_event,
                        format!("⚠️ Failed to update {}: {}", rc_path.display(), error),
                    );
                    continue;
                }
            };

            if let Err(error) = file.write_all(block.as_bytes()) {
                emit_progress(
                    window,
                    progress_event,
                    format!(
                        "⚠️ Failed to write PATH export into {}: {}",
                        rc_path.display(),
                        error
                    ),
                );
                continue;
            }
            updated.push(rc_name.to_string());
        }

        if !updated.is_empty() {
            emit_progress(
                window,
                progress_event,
                format!(
                    "ℹ️ Added ~/.local/bin PATH export to {}. Reopen terminal sessions to apply.",
                    updated.join(", ")
                ),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "gtoffice-agentic-one-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&base).expect("create temp dir");
        base
    }

    #[test]
    fn resolve_local_bundled_mcp_server_entry_prefers_exact_sidecar_name() {
        let dir = temp_dir("mcp-sidecar-exact");
        let sidecar_name = if cfg!(target_os = "windows") {
            "gto-agent-mcp-sidecar.exe"
        } else {
            "gto-agent-mcp-sidecar"
        };
        let sidecar_path = dir.join(sidecar_name);
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");

        let entry =
            resolve_local_bundled_mcp_server_entry_from_dir(&dir).expect("resolve bundled entry");

        assert_eq!(entry.command, sidecar_path);
        assert_eq!(entry.args, vec!["serve".to_string()]);
    }

    #[test]
    fn resolve_local_bundled_mcp_server_entry_accepts_suffixed_release_sidecar_name() {
        let dir = temp_dir("mcp-sidecar-suffixed");
        let sidecar_name = if cfg!(target_os = "windows") {
            "gto-agent-mcp-sidecar-x86_64-pc-windows-msvc.exe"
        } else {
            "gto-agent-mcp-sidecar-aarch64-apple-darwin"
        };
        let sidecar_path = dir.join(sidecar_name);
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");

        let entry =
            resolve_local_bundled_mcp_server_entry_from_dir(&dir).expect("resolve suffixed entry");

        assert_eq!(entry.command, sidecar_path);
        assert_eq!(entry.args, vec!["serve".to_string()]);
    }

    #[test]
    fn install_then_uninstall_mcp_updates_claude_project_config_end_to_end() {
        let dir = temp_dir("mcp-claude-e2e");
        let home = dir.join("home");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(&home).expect("create home");
        fs::create_dir_all(&workspace_root).expect("create workspace");
        fs::create_dir_all(home.join(".claude")).expect("create claude dir");

        let other_workspace = dir.join("other-workspace");
        fs::create_dir_all(&other_workspace).expect("create other workspace");
        fs::write(
            home.join(".claude.json"),
            format!(
                r#"{{
  "projects": {{
    "{}": {{
      "mcpServers": {{
        "gto-agent-bridge": {{
          "type": "stdio",
          "command": "/Applications/GT Office.app/Contents/Resources/gto-agent-mcp-sidecar"
        }}
      }}
    }}
  }}
}}
"#,
                other_workspace.display()
            ),
        )
        .expect("seed claude project config");

        let sidecar_path = dir.join("gto-agent-mcp-sidecar");
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");
        let local_entry = LocalMcpServerEntry {
            command: sidecar_path,
            args: vec!["serve".to_string()],
        };

        let project_roots = vec![workspace_root.clone()];
        install_agent_mcp_at_home(AgentType::ClaudeCode, &project_roots, &home, &local_entry)
            .expect("install mcp");

        let after_install: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".claude.json")).expect("read claude config"),
        )
        .expect("parse claude config");
        assert!(after_install
            .pointer(&format!(
                "/projects/{}/mcpServers/gto-agent-bridge/command",
                workspace_root.display().to_string().replace('/', "~1")
            ))
            .is_some());
        assert!(after_install
            .pointer(&format!(
                "/projects/{}/mcpServers/gto-agent-bridge/command",
                other_workspace.display().to_string().replace('/', "~1")
            ))
            .is_some());
        assert!(after_install
            .get("mcpServers")
            .and_then(Value::as_object)
            .is_none_or(|servers| !servers.contains_key("gto-agent-bridge")));

        uninstall_agent_mcp_at_home(AgentType::ClaudeCode, &project_roots, &home)
            .expect("uninstall mcp");

        let after_uninstall: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".claude.json")).expect("read claude config"),
        )
        .expect("parse claude config");
        assert!(after_uninstall
            .pointer(&format!(
                "/projects/{}/mcpServers/gto-agent-bridge",
                workspace_root.display().to_string().replace('/', "~1")
            ))
            .is_none());
        assert!(after_uninstall
            .pointer(&format!(
                "/projects/{}/mcpServers/gto-agent-bridge/command",
                other_workspace.display().to_string().replace('/', "~1")
            ))
            .is_some());
    }

    #[test]
    fn install_then_uninstall_mcp_updates_all_claude_project_roots_in_workspace() {
        let dir = temp_dir("mcp-claude-multi-root");
        let home = dir.join("home");
        let workspace_root = dir.join("workspace");
        let agent_root = workspace_root.join(".gtoffice").join("calude");
        fs::create_dir_all(&home).expect("create home");
        fs::create_dir_all(&workspace_root).expect("create workspace");
        fs::create_dir_all(&agent_root).expect("create agent root");
        fs::write(agent_root.join("CLAUDE.md"), "# agent\n").expect("write prompt");

        let sidecar_path = dir.join("gto-agent-mcp-sidecar");
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");
        let local_entry = LocalMcpServerEntry {
            command: sidecar_path,
            args: vec!["serve".to_string()],
        };

        let project_roots = vec![workspace_root.clone(), agent_root.clone()];
        install_agent_mcp_at_home(AgentType::ClaudeCode, &project_roots, &home, &local_entry)
            .expect("install mcp");

        let after_install: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".claude.json")).expect("read claude config"),
        )
        .expect("parse claude config");
        for project_root in [&workspace_root, &agent_root] {
            assert!(after_install
                .pointer(&format!(
                    "/projects/{}/mcpServers/gto-agent-bridge/command",
                    project_root.display().to_string().replace('/', "~1")
                ))
                .is_some());
        }

        uninstall_agent_mcp_at_home(AgentType::ClaudeCode, &project_roots, &home)
            .expect("uninstall mcp");

        let after_uninstall: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".claude.json")).expect("read claude config"),
        )
        .expect("parse claude config");
        for project_root in [&workspace_root, &agent_root] {
            assert!(after_uninstall
                .pointer(&format!(
                    "/projects/{}/mcpServers/gto-agent-bridge",
                    project_root.display().to_string().replace('/', "~1")
                ))
                .is_none());
        }
    }

    #[test]
    fn install_then_uninstall_mcp_updates_all_gemini_project_roots_in_workspace() {
        let dir = temp_dir("mcp-gemini-multi-root");
        let home = dir.join("home");
        let workspace_root = dir.join("workspace");
        let agent_root = workspace_root.join(".gtoffice").join("gemini-agent");
        fs::create_dir_all(&home).expect("create home");
        fs::create_dir_all(&workspace_root).expect("create workspace");
        fs::create_dir_all(&agent_root).expect("create agent root");
        fs::write(agent_root.join("GEMINI.md"), "# agent\n").expect("write prompt");

        let sidecar_path = dir.join("gto-agent-mcp-sidecar");
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");
        let local_entry = LocalMcpServerEntry {
            command: sidecar_path,
            args: vec!["serve".to_string()],
        };

        let project_roots = vec![workspace_root.clone(), agent_root.clone()];
        install_agent_mcp_at_home(AgentType::Gemini, &project_roots, &home, &local_entry)
            .expect("install mcp");

        let user_after_install: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".gemini").join("settings.json"))
                .expect("read user gemini config"),
        )
        .expect("parse user gemini config");
        assert!(user_after_install
            .pointer("/mcpServers/gto-agent-bridge/command")
            .is_some());

        for project_root in [&workspace_root, &agent_root] {
            let project_after_install: Value = serde_json::from_str(
                &fs::read_to_string(project_root.join(".gemini").join("settings.json"))
                    .expect("read project gemini config"),
            )
            .expect("parse project gemini config");
            assert!(project_after_install
                .pointer("/mcpServers/gto-agent-bridge/command")
                .is_some());
        }

        uninstall_agent_mcp_at_home(AgentType::Gemini, &project_roots, &home)
            .expect("uninstall mcp");

        let user_after_uninstall: Value = serde_json::from_str(
            &fs::read_to_string(home.join(".gemini").join("settings.json"))
                .expect("read user gemini config"),
        )
        .expect("parse user gemini config");
        assert!(user_after_uninstall
            .pointer("/mcpServers/gto-agent-bridge")
            .is_none());

        for project_root in [&workspace_root, &agent_root] {
            let project_after_uninstall: Value = serde_json::from_str(
                &fs::read_to_string(project_root.join(".gemini").join("settings.json"))
                    .expect("read project gemini config"),
            )
            .expect("parse project gemini config");
            assert!(project_after_uninstall
                .pointer("/mcpServers/gto-agent-bridge")
                .is_none());
        }
    }

    #[test]
    fn install_agent_mcp_writes_runtime_env_for_codex_sidecar_config() {
        let dir = temp_dir("mcp-codex-runtime-env");
        let home = dir.join("home");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(&home).expect("create home");
        fs::create_dir_all(&workspace_root).expect("create workspace");

        let sidecar_path = dir.join("gto-agent-mcp-sidecar");
        fs::write(&sidecar_path, b"#!/bin/sh\n").expect("write sidecar");
        let local_entry = LocalMcpServerEntry {
            command: sidecar_path,
            args: vec!["serve".to_string()],
        };

        let project_roots = vec![workspace_root.clone()];
        install_agent_mcp_at_home(AgentType::Codex, &project_roots, &home, &local_entry)
            .expect("install codex mcp");

        let codex_config =
            fs::read_to_string(home.join(".codex").join("config.toml")).expect("read codex config");
        assert!(
            codex_config.contains("GTO_MCP_RUNTIME_FILE"),
            "expected codex MCP config to include explicit runtime path override, got:\n{codex_config}"
        );
    }
}

fn run_progress_command(
    window: &tauri::Window,
    progress_event: &str,
    command_name: &str,
    args: &[String],
) -> Result<std::process::ExitStatus, String> {
    let mut command = Command::new(command_name);
    configure_std_command(&mut command);
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    let window_clone = window.clone();
    let event_id_clone = progress_event.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                if !l.trim().is_empty() {
                    let _ = window_clone.emit(&event_id_clone, l);
                }
            }
        }
    });

    let window_clone_err = window.clone();
    let event_id_err = progress_event.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                if !l.trim().is_empty() {
                    let _ = window_clone_err.emit(&event_id_err, format!("⚠️ {}", l));
                }
            }
        }
    });

    child
        .wait()
        .map_err(|e| format!("Process wait failed: {}", e))
}

fn remove_paths_with_progress(
    window: &tauri::Window,
    progress_event: &str,
    paths: &[PathBuf],
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No managed paths resolved for uninstall.".to_string());
    }

    for path in paths {
        emit_progress(
            window,
            progress_event,
            format!("Removing {}...", path.display()),
        );
        if !path.exists() {
            continue;
        }
        if path.is_dir() {
            std::fs::remove_dir_all(path)
                .map_err(|error| format!("Failed to remove {}: {}", path.display(), error))?;
        } else {
            std::fs::remove_file(path)
                .map_err(|error| format!("Failed to remove {}: {}", path.display(), error))?;
        }
    }

    Ok(())
}

fn install_agent_mcp_at_home(
    agent: AgentType,
    project_roots: &[PathBuf],
    home_dir: &Path,
    local_entry: &LocalMcpServerEntry,
) -> Result<(), String> {
    let target = match agent {
        AgentType::ClaudeCode => "claude",
        AgentType::Codex => "codex",
        AgentType::Gemini => "gemini",
    };
    let command = local_entry.command.display().to_string();
    let arg_refs = local_entry
        .args
        .iter()
        .map(|value| value.as_str())
        .collect::<Vec<_>>();
    let env = local_mcp_env_overrides(home_dir);
    for project_root in project_roots {
        AgentInstaller::install_mcp_bridge_config(
            home_dir,
            project_root,
            &[target],
            &command,
            &arg_refs,
            &env,
        )?;
    }
    Ok(())
}

fn uninstall_agent_mcp_at_home(
    agent: AgentType,
    project_roots: &[PathBuf],
    home_dir: &Path,
) -> Result<(), String> {
    let target = match agent {
        AgentType::ClaudeCode => "claude",
        AgentType::Codex => "codex",
        AgentType::Gemini => "gemini",
    };
    for project_root in project_roots {
        AgentInstaller::uninstall_mcp_bridge_config(home_dir, project_root, &[target])?;
    }
    Ok(())
}

fn local_mcp_env_overrides(home_dir: &Path) -> std::collections::BTreeMap<String, String> {
    std::collections::BTreeMap::from([
        (
            "GTO_MCP_RUNTIME_FILE".to_string(),
            home_dir
                .join(".gtoffice")
                .join("mcp")
                .join("runtime.json")
                .display()
                .to_string(),
        ),
        (
            "GTO_MCP_DIRECTORY_FILE".to_string(),
            home_dir
                .join(".gtoffice")
                .join("mcp")
                .join("directory.json")
                .display()
                .to_string(),
        ),
    ])
}
