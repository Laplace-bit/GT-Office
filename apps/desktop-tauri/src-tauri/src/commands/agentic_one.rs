use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

use gt_tools::agent_installer::{
    AgentInstallAttempt, AgentInstallDiagnosticCode, AgentInstallProgressEvent,
    AgentInstallProgressPhase, AgentInstallStatus, AgentInstaller, AgentType, AgentUninstallAction,
};

use crate::process_utils::configure_std_command;

struct CommandExecutionResult {
    status: Option<std::process::ExitStatus>,
    combined_output: String,
    timed_out: bool,
}

impl CommandExecutionResult {
    fn success(&self) -> bool {
        self.status.is_some_and(|status| status.success()) && !self.timed_out
    }
}

#[tauri::command]
pub async fn agent_install_status(agent: AgentType) -> Result<AgentInstallStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(AgentInstaller::install_status(agent)))
        .await
        .map_err(|error| format!("AGENT_INSTALL_STATUS_TASK_FAILED: {error}"))?
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
        AgentInstallProgressPhase::Preparing,
        format!("Preparing {name} installation..."),
        None,
        None,
        None,
    );

    let plan = AgentInstaller::build_install_plan(agent);
    let mut install_succeeded = false;

    for (index, attempt) in plan.attempts.iter().enumerate() {
        emit_progress(
            &window,
            &progress_event,
            attempt.phase,
            attempt.label.clone(),
            None,
            Some(attempt.id.clone()),
            None,
        );

        let execution = match run_progress_command(attempt) {
            Ok(result) => result,
            Err(error) => {
                let diagnostic = AgentInstaller::classify_install_failure(&error, false);
                let message = AgentInstaller::install_failure_message(agent, diagnostic);
                emit_progress(
                    &window,
                    &progress_event,
                    AgentInstallProgressPhase::Failed,
                    message.clone(),
                    Some(error),
                    Some(attempt.id.clone()),
                    Some(diagnostic),
                );
                return Err(message);
            }
        };

        if execution.success() {
            install_succeeded = true;
            break;
        }

        let diagnostic = AgentInstaller::classify_install_failure(
            &execution.combined_output,
            execution.timed_out,
        );
        let should_retry = plan.attempts.get(index + 1).is_some()
            && attempt
                .retryable_diagnostics
                .iter()
                .any(|candidate| candidate == &diagnostic);

        tracing::warn!(
            agent = ?agent,
            attempt = %attempt.id,
            diagnostic = ?diagnostic,
            "agent install attempt failed"
        );

        if should_retry {
            emit_progress(
                &window,
                &progress_event,
                AgentInstallProgressPhase::Installing,
                format!("Continuing {name} installation..."),
                None,
                Some(attempt.id.clone()),
                Some(diagnostic),
            );
            continue;
        }

        let message = AgentInstaller::install_failure_message(agent, diagnostic);
        emit_progress(
            &window,
            &progress_event,
            AgentInstallProgressPhase::Failed,
            message.clone(),
            None,
            Some(attempt.id.clone()),
            Some(diagnostic),
        );
        return Err(message);
    }

    if !install_succeeded {
        let diagnostic = default_install_failure_code(&status);
        let message = AgentInstaller::install_failure_message(agent, diagnostic);
        emit_progress(
            &window,
            &progress_event,
            AgentInstallProgressPhase::Failed,
            message.clone(),
            None,
            None,
            Some(diagnostic),
        );
        return Err(message);
    }

    emit_progress(
        &window,
        &progress_event,
        AgentInstallProgressPhase::Verifying,
        format!("Verifying {name} installation..."),
        None,
        None,
        None,
    );

    ensure_global_shell_path_for_local_bin(&window, &progress_event);
    AgentInstaller::invalidate_install_status_cache(Some(agent));
    let verified = AgentInstaller::install_status_fresh(agent);
    if !verified.installed {
        let diagnostic = AgentInstallDiagnosticCode::VerificationFailed;
        let message = AgentInstaller::install_failure_message(agent, diagnostic);
        emit_progress(
            &window,
            &progress_event,
            AgentInstallProgressPhase::Failed,
            message.clone(),
            None,
            None,
            Some(diagnostic),
        );
        return Err(message);
    }
    if let Some(issue) = verified
        .issues
        .iter()
        .find(|issue| issue.contains("fresh shell still may not resolve"))
    {
        emit_progress(
            &window,
            &progress_event,
            AgentInstallProgressPhase::Verifying,
            issue.clone(),
            None,
            None,
            None,
        );
    }

    emit_progress(
        &window,
        &progress_event,
        AgentInstallProgressPhase::Completed,
        format!("{name} installed."),
        None,
        None,
        None,
    );

    Ok(())
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
    emit_progress(
        &window,
        &progress_event,
        AgentInstallProgressPhase::Preparing,
        format!("Removing {name}..."),
        None,
        None,
        None,
    );

    let action = AgentInstaller::get_uninstall_action(agent)
        .ok_or_else(|| format!("Automatic uninstall is not available for {name}."))?;

    match action {
        AgentUninstallAction::Command { program, args } => {
            let attempt = AgentInstallAttempt {
                id: format!("{}-uninstall", AgentInstaller::executable_name(agent)),
                label: format!("Removing {name}..."),
                phase: AgentInstallProgressPhase::Installing,
                program,
                args,
                env: Default::default(),
                timeout_ms: 5 * 60 * 1000,
                retryable_diagnostics: Vec::new(),
            };
            let execution = run_progress_command(&attempt)?;
            if !execution.success() {
                let diagnostic = AgentInstaller::classify_install_failure(
                    &execution.combined_output,
                    execution.timed_out,
                );
                let message = AgentInstaller::uninstall_failure_message(agent, diagnostic);
                emit_progress(
                    &window,
                    &progress_event,
                    AgentInstallProgressPhase::Failed,
                    message.clone(),
                    None,
                    Some(attempt.id),
                    Some(diagnostic),
                );
                return Err(message);
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

    emit_progress(
        &window,
        &progress_event,
        AgentInstallProgressPhase::Completed,
        format!("{name} removed."),
        None,
        None,
        None,
    );
    Ok(())
}

fn emit_progress(
    window: &tauri::Window,
    event: &str,
    phase: AgentInstallProgressPhase,
    message: String,
    detail: Option<String>,
    attempt_id: Option<String>,
    diagnostic_code: Option<AgentInstallDiagnosticCode>,
) {
    let _ = window.emit(
        event,
        AgentInstallProgressEvent {
            phase,
            message,
            detail,
            attempt_id,
            diagnostic_code,
        },
    );
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
                AgentInstallProgressPhase::Verifying,
                "Finishing shell integration...".to_string(),
                Some(format!(
                    "Failed to create {} for global CLI exposure: {}",
                    local_bin.display(),
                    error
                )),
                None,
                None,
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
                        AgentInstallProgressPhase::Verifying,
                        "Finishing shell integration...".to_string(),
                        Some(format!("Failed to read {}: {}", rc_path.display(), error)),
                        None,
                        None,
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
                        AgentInstallProgressPhase::Verifying,
                        "Finishing shell integration...".to_string(),
                        Some(format!("Failed to update {}: {}", rc_path.display(), error)),
                        None,
                        None,
                    );
                    continue;
                }
            };

            if let Err(error) = file.write_all(block.as_bytes()) {
                emit_progress(
                    window,
                    progress_event,
                    AgentInstallProgressPhase::Verifying,
                    "Finishing shell integration...".to_string(),
                    Some(format!(
                        "Failed to write PATH export into {}: {}",
                        rc_path.display(),
                        error
                    )),
                    None,
                    None,
                );
                continue;
            }
            updated.push(rc_name.to_string());
        }

        if !updated.is_empty() {
            emit_progress(
                window,
                progress_event,
                AgentInstallProgressPhase::Verifying,
                "Finishing shell integration...".to_string(),
                Some(format!(
                    "Added ~/.local/bin PATH export to {}. Reopen terminal sessions to apply.",
                    updated.join(", ")
                )),
                None,
                None,
            );
        }
    }
}

fn default_install_failure_code(status: &AgentInstallStatus) -> AgentInstallDiagnosticCode {
    if status.requires_node && !status.node_ready {
        return AgentInstallDiagnosticCode::NodeMissing;
    }
    if status.requires_node && !status.npm_ready {
        return AgentInstallDiagnosticCode::NpmMissing;
    }
    AgentInstallDiagnosticCode::Unknown
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

fn run_progress_command(attempt: &AgentInstallAttempt) -> Result<CommandExecutionResult, String> {
    let mut command = Command::new(&attempt.program);
    configure_std_command(&mut command);
    let mut child = command
        .args(&attempt.args)
        .envs(&attempt.env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;
    let output = Arc::new(Mutex::new(Vec::<String>::new()));

    let stdout_output = Arc::clone(&output);
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(mut collected) = stdout_output.lock() {
                collected.push(trimmed.to_string());
            }
        }
    });

    let stderr_output = Arc::clone(&output);
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(mut collected) = stderr_output.lock() {
                collected.push(trimmed.to_string());
            }
        }
    });

    let started_at = Instant::now();
    let timeout = Duration::from_millis(attempt.timeout_ms);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    timed_out = true;
                    terminate_process_tree(&mut child);
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("Process wait failed: {error}")),
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let combined_output = output
        .lock()
        .map(|lines| lines.join("\n"))
        .unwrap_or_default();

    Ok(CommandExecutionResult {
        status,
        combined_output,
        timed_out,
    })
}

fn terminate_process_tree(child: &mut std::process::Child) {
    let pid = child.id();
    tracing::warn!(pid, "install command timed out; terminating process tree");

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        configure_std_command(&mut command);
        let _ = command
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        terminate_process_tree_unix(pid);
    }

    let _ = child.kill();
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree_unix(root_pid: u32) {
    let mut descendants = collect_descendant_pids(root_pid);
    descendants.sort_unstable();
    descendants.dedup();

    for pid in descendants.iter().rev() {
        send_unix_signal(*pid, "-TERM");
    }
    send_unix_signal(root_pid, "-TERM");
    std::thread::sleep(Duration::from_millis(200));
    for pid in descendants.iter().rev() {
        send_unix_signal(*pid, "-KILL");
    }
    send_unix_signal(root_pid, "-KILL");
}

#[cfg(not(target_os = "windows"))]
fn collect_descendant_pids(root_pid: u32) -> Vec<u32> {
    let mut command = Command::new("ps");
    configure_std_command(&mut command);
    let Ok(output) = command.args(["-axo", "pid=,ppid="]).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut children_by_parent: std::collections::BTreeMap<u32, Vec<u32>> =
        std::collections::BTreeMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split_whitespace();
        let Some(pid_text) = parts.next() else {
            continue;
        };
        let Some(ppid_text) = parts.next() else {
            continue;
        };
        let Ok(pid) = pid_text.parse::<u32>() else {
            continue;
        };
        let Ok(ppid) = ppid_text.parse::<u32>() else {
            continue;
        };
        children_by_parent.entry(ppid).or_default().push(pid);
    }

    let mut collected = Vec::new();
    let mut stack = vec![root_pid];
    while let Some(parent) = stack.pop() {
        if let Some(children) = children_by_parent.get(&parent) {
            for child in children {
                collected.push(*child);
                stack.push(*child);
            }
        }
    }

    collected
}

#[cfg(not(target_os = "windows"))]
fn send_unix_signal(pid: u32, signal: &str) {
    let mut command = Command::new("kill");
    configure_std_command(&mut command);
    let _ = command.args([signal, &pid.to_string()]).status();
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
            AgentInstallProgressPhase::Installing,
            format!("Removing {}...", path.display()),
            None,
            None,
            None,
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

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    #[test]
    fn timed_out_install_attempt_terminates_child_tree() {
        let attempt = AgentInstallAttempt {
            id: "timeout-tree".to_string(),
            label: "timeout test".to_string(),
            phase: AgentInstallProgressPhase::Installing,
            program: "bash".to_string(),
            args: vec![
                "-lc".to_string(),
                "sleep 5 & child=$!; wait \"$child\"".to_string(),
            ],
            env: Default::default(),
            timeout_ms: 200,
            retryable_diagnostics: Vec::new(),
        };

        let started_at = Instant::now();
        let result = run_progress_command(&attempt).expect("run timeout command");
        assert!(result.timed_out);
        assert!(started_at.elapsed() < Duration::from_secs(3));
    }
}
