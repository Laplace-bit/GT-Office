use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

use vb_tools::agent_installer::{
    AgentInstallStatus, AgentInstaller, AgentType, AgentUninstallAction,
};

use crate::process_utils::configure_std_command;

#[tauri::command]
pub async fn agent_install_status(agent: AgentType) -> Result<AgentInstallStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(AgentInstaller::install_status(agent)))
        .await
        .map_err(|error| format!("AGENT_INSTALL_STATUS_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn agent_mcp_install_status(agent: AgentType) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(check_mcp_installed(agent)))
        .await
        .map_err(|error| format!("AGENT_MCP_STATUS_TASK_FAILED: {error}"))?
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
pub async fn install_agent_mcp(window: tauri::Window, agent: AgentType) -> Result<(), String> {
    if check_mcp_installed(agent) {
        return Ok(());
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{event_id}");
    window
        .emit(
            &progress_event,
            format!("🚀 Installing GT Office MCP bridge for {name}..."),
        )
        .unwrap();

    let installer_path = resolve_mcp_installer_path(&window);
    let target = match agent {
        AgentType::ClaudeCode => "claude",
        AgentType::Codex => "codex",
        AgentType::Gemini => "gemini",
    };

    let mut mcp_cmd = Command::new("node");
    configure_std_command(&mut mcp_cmd);
    mcp_cmd.arg(installer_path).arg("--target").arg(target);

    let mcp_status = mcp_cmd
        .status()
        .map_err(|e| format!("MCP installer failed to start: {}", e))?;
    if !mcp_status.success() {
        return Err(format!(
            "MCP installer exited with error code: {:?}",
            mcp_status.code()
        ));
    }

    window
        .emit(
            &progress_event,
            format!("✅ GT Office MCP bridge installed for {name}."),
        )
        .unwrap();
    Ok(())
}

fn resolve_mcp_installer_path(window: &tauri::Window) -> PathBuf {
    let resource_path = window
        .app_handle()
        .path()
        .resource_dir()
        .unwrap_or_default();
    let installer_script = resource_path.join("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs");
    if installer_script.exists() {
        installer_script
    } else {
        PathBuf::from("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs")
    }
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

fn check_mcp_installed(agent: AgentType) -> bool {
    let Some(home) = user_home_dir() else {
        return false;
    };

    let paths = match agent {
        AgentType::ClaudeCode => vec![
            home.join(".claude.json"),
            home.join(".claude").join("settings.json"),
        ],
        AgentType::Codex => vec![home.join(".codex").join("config.toml")],
        AgentType::Gemini => vec![home.join(".gemini").join("settings.json")],
    };

    paths.iter().any(|path| file_contains_bridge_marker(path))
}

fn file_contains_bridge_marker(path: &Path) -> bool {
    path.exists()
        && std::fs::read_to_string(path)
            .map(|content| content.contains("gto-agent-bridge"))
            .unwrap_or(false)
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
