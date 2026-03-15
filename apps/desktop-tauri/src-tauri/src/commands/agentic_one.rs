use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

use vb_tools::agent_installer::{AgentInstallStatus, AgentInstaller, AgentType};

use crate::process_utils::configure_std_command;

#[tauri::command]
pub fn agent_install_status(agent: AgentType) -> Result<AgentInstallStatus, String> {
    Ok(AgentInstaller::install_status(agent))
}

#[tauri::command]
pub async fn install_agent(window: tauri::Window, agent: AgentType) -> Result<(), String> {
    let status = AgentInstaller::install_status(agent);

    if status.installed {
        return Ok(());
    }

    // 1. 环境预检
    if status.requires_node && !status.node_ready {
        return Err("Missing Node.js environment. Please install Node.js first.".to_string());
    }

    let (name, event_id) = match agent {
        AgentType::ClaudeCode => ("Claude Code", "claude"),
        AgentType::Codex => ("Codex CLI", "codex"),
        AgentType::Gemini => ("Gemini CLI", "gemini"),
    };

    let progress_event = format!("install-progress:{}", event_id);
    window
        .emit(
            &progress_event,
            format!("🚀 Initiating {} deployment...", name),
        )
        .unwrap();

    let (cmd_name, args) = AgentInstaller::get_install_command(agent);

    // 2. 使用管道启动进程
    let mut command = Command::new(cmd_name);
    configure_std_command(&mut command);
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    // 3. 实时读取 stdout 并推送
    let window_clone = window.clone();
    let event_id_clone = progress_event.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                // 过滤掉一些过长的重复进度字符，保持 UI 整洁
                if !l.trim().is_empty() {
                    let _ = window_clone.emit(&event_id_clone, l);
                }
            }
        }
    });

    // 4. 实时读取 stderr
    let window_clone_err = window.clone();
    let event_id_err = progress_event.clone();
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

    // 5. 等待结束
    let status = child
        .wait()
        .map_err(|e| format!("Process wait failed: {}", e))?;

    if status.success() {
        window
            .emit(
                &progress_event,
                format!("✅ {} base tool installed. Configuring MCP bridge...", name),
            )
            .unwrap();

        // Run MCP installer
        let resource_path = window
            .app_handle()
            .path()
            .resource_dir()
            .unwrap_or_default();
        let installer_script =
            resource_path.join("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs");

        // Fallback to relative path if resource_dir doesn't work (e.g. in dev)
        let installer_path = if installer_script.exists() {
            installer_script
        } else {
            std::path::PathBuf::from("tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs")
        };

        let mut mcp_cmd = Command::new("node");
        configure_std_command(&mut mcp_cmd);
        mcp_cmd.arg(installer_path);

        let mcp_status = mcp_cmd
            .status()
            .map_err(|e| format!("MCP installer failed to start: {}", e))?;
        if mcp_status.success() {
            window
                .emit(
                    &progress_event,
                    format!("🎉 {} fully deployed with MCP bridge!", name),
                )
                .unwrap();
        } else {
            window
                .emit(
                    &progress_event,
                    format!(
                        "⚠️ {} installed, but MCP bridge configuration failed.",
                        name
                    ),
                )
                .unwrap();
        }

        Ok(())
    } else {
        Err(format!(
            "{} installation exited with error code: {:?}",
            name,
            status.code()
        ))
    }
}
