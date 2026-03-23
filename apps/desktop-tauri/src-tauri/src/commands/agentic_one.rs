use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager, State};

use vb_ai_config::agent_mcp_installed_for_workspace;
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
) -> Result<bool, String> {
    let workspace_root = workspace_id
        .as_deref()
        .map(|id| state.workspace_root_path(id))
        .transpose()?;

    tauri::async_runtime::spawn_blocking(move || {
        agent_mcp_installed_for_workspace(agent, workspace_root.as_deref())
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))
}

#[tauri::command]
pub async fn install_agent(window: tauri::Window, agent: AgentType) -> Result<(), String> {
    let status = AgentInstaller::install_status(agent);

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
        let verified = AgentInstaller::install_status(agent);
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
    let status = AgentInstaller::install_status(agent);

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

    let verified = AgentInstaller::install_status(agent);
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
    let workspace_root_for_check = workspace_root.clone();

    let already_installed = tauri::async_runtime::spawn_blocking(move || {
        agent_mcp_installed_for_workspace(agent, Some(workspace_root_for_check.as_path()))
    })
    .await
    .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?;

    if already_installed {
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

    let installer_path = resolve_existing_mcp_installer_path(&window)?;
    let target = match agent {
        AgentType::ClaudeCode => "claude",
        AgentType::Codex => "codex",
        AgentType::Gemini => "gemini",
    };

    let mut mcp_cmd = Command::new("node");
    configure_std_command(&mut mcp_cmd);
    mcp_cmd.arg(&installer_path).arg("--target").arg(target);
    if matches!(agent, AgentType::ClaudeCode) {
        mcp_cmd.arg("--workspace").arg(&workspace_root);
    }

    let mcp_output = run_command_capture_output(&mut mcp_cmd)
        .map_err(|error| format!("MCP installer failed to start: {error}"))?;
    if !mcp_output.status.success() {
        return Err(format!(
            "MCP installer failed: {}",
            format_command_failure(&mcp_output)
        ));
    }

    emit_progress(
        &window,
        &progress_event,
        format!(
            "ℹ️ MCP installer script: {}",
            installer_path.display()
        ),
    );
    let stdout = String::from_utf8_lossy(&mcp_output.stdout).trim().to_string();
    if !stdout.is_empty() {
        emit_progress(&window, &progress_event, stdout);
    }

    let stderr = String::from_utf8_lossy(&mcp_output.stderr).trim().to_string();
    if !stderr.is_empty() {
        emit_progress(&window, &progress_event, format!("⚠️ {stderr}"));
    }

    let mcp_status = mcp_output.status;
    if !mcp_status.success() {
        return Err(format!(
            "MCP installer exited with error code: {:?}",
            mcp_status.code()
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

fn format_command_failure(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    if !stdout.is_empty() {
        return stdout;
    }
    format!("exit code: {:?}", output.status.code())
}

fn run_command_capture_output(command: &mut Command) -> Result<std::process::Output, String> {
    command
        .output()
        .map_err(|error| format!("Failed to run process: {error}"))
}

fn installer_script_exists(path: &PathBuf) -> bool {
    path.exists() && path.is_file()
}

fn ensure_installer_script_exists(path: &PathBuf) -> Result<(), String> {
    if installer_script_exists(path) {
        Ok(())
    } else {
        Err(format!(
            "MCP installer script not found: {}",
            path.display()
        ))
    }
}

fn workspace_relative_installer_candidates() -> Vec<PathBuf> {
    let Ok(cwd) = std::env::current_dir() else {
        return Vec::new();
    };
    vec![
        cwd.join("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs"),
        cwd.join("../../tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs"),
        cwd.join("../../../tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs"),
    ]
}

fn resolve_existing_mcp_installer_path(window: &tauri::Window) -> Result<PathBuf, String> {
    if let Ok(resource_path) = window.app_handle().path().resource_dir() {
        let installer_script = resource_path.join("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs");
        if installer_script_exists(&installer_script) {
            return Ok(installer_script);
        }
    }

    for candidate in workspace_relative_installer_candidates() {
        if installer_script_exists(&candidate) {
            return Ok(candidate);
        }
    }

    let fallback = PathBuf::from("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs");
    ensure_installer_script_exists(&fallback)?;
    Ok(fallback)
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
