use std::fs;
use std::path::{Path, PathBuf};

use rfd::FileDialog;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Manager, State};

use crate::app_state::AppState;

const GTO_WRAPPER_MARKER: &str = "# Managed by GT Office: gto cli";
const GTO_SKILL_DIR_NAME: &str = "gto-agent-communication";
const GTO_SKILL_MARKER_FILE: &str = ".gto-managed.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GtoCliStatusResponse {
    pub installed: bool,
    pub managed: bool,
    pub command_path: Option<String>,
    pub target_script_path: Option<String>,
    pub node_ready: bool,
    pub install_available: bool,
    pub uninstall_available: bool,
    pub issue: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GtoSkillStatusResponse {
    pub installed: bool,
    pub managed: bool,
    pub target_dir: Option<String>,
    pub source_dir: Option<String>,
    pub install_available: bool,
    pub uninstall_available: bool,
    pub issue: Option<String>,
}

#[tauri::command]
pub fn system_pick_directory(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = FileDialog::new();
    if let Some(path) = default_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_directory(path);
    }

    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn system_gto_doctor(state: State<'_, AppState>) -> Result<Value, String> {
    let snapshot = state.task_service.doctor_external_snapshot();
    let runtime = crate::channel_adapter_runtime::runtime_snapshot();
    let runtime_running = runtime.is_some();
    let runtime_metrics = runtime.as_ref().map(|item| item.metrics.clone());
    let rate_limited = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.rate_limited)
        .unwrap_or(0);
    let timeout_count = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.timeouts)
        .unwrap_or(0);
    let internal_errors = runtime_metrics
        .as_ref()
        .map(|metrics| metrics.internal_errors)
        .unwrap_or(0);
    let suggestions = vec![
        json!({
            "code": "CHECK_CHANNEL_BINDINGS",
            "message": "Verify channel bindings include workspace_id + target_agent_id for each inbound source.",
        }),
        json!({
            "code": "CHECK_ACCESS_POLICY",
            "message": "Default access policy is pairing. Approve trusted identities before expecting task dispatch.",
        }),
        json!({
            "code": "CHECK_IDEMPOTENCY_WINDOW",
            "message": "If duplicate deliveries appear, inspect idempotency cache entries and upstream message IDs.",
        }),
        json!({
            "code": "CHECK_WEBHOOK_ENDPOINTS",
            "message": "Use channel_adapter_status runtime.feishuWebhook/runtime.telegramWebhook to bind bot webhook callbacks.",
        }),
        json!({
            "code": "CHECK_RUNTIME_METRICS",
            "message": "Inspect runtime.metrics for rate_limited/timeouts/internal_errors before troubleshooting route/access logic.",
        }),
    ];
    Ok(json!({
        "ok": runtime_running,
        "runtime": runtime,
        "runtimeMetrics": runtime_metrics,
        "summary": snapshot,
        "checks": [
            {
                "id": "channel_adapter_runtime",
                "ok": runtime_running,
                "detail": if runtime_running {
                    "webhook adapter runtime is listening"
                } else {
                    "webhook adapter runtime is not ready"
                },
            },
            {
                "id": "external_dispatch_state",
                "ok": true,
                "detail": "external route/access/idempotency state loaded",
            },
            {
                "id": "external_runtime_stability",
                "ok": rate_limited == 0 && timeout_count == 0 && internal_errors == 0,
                "detail": format!(
                    "rate_limited={}, timeouts={}, internal_errors={}",
                    rate_limited, timeout_count, internal_errors
                ),
            }
        ],
        "suggestions": suggestions,
    }))
}

#[tauri::command]
pub fn system_gto_cli_status(app: tauri::AppHandle) -> Result<GtoCliStatusResponse, String> {
    let command_path = gto_command_path()?;
    let target_script_path = resolve_gto_script_path(&app);
    let node_ready = command_exists("node");
    let installed = command_path.exists();
    let managed = installed && wrapper_is_managed(&command_path);
    let uninstall_available = installed && managed;
    let install_available = target_script_path.is_some() && node_ready;

    Ok(GtoCliStatusResponse {
        installed,
        managed,
        command_path: Some(command_path.display().to_string()),
        target_script_path: target_script_path
            .as_ref()
            .map(|path| path.display().to_string()),
        node_ready,
        install_available,
        uninstall_available,
        issue: if target_script_path.is_none() {
            Some("GTO_CLI_SOURCE_NOT_FOUND".to_string())
        } else if !node_ready {
            Some("NODE_NOT_FOUND".to_string())
        } else if installed && !managed {
            Some("GTO_CLI_EXTERNAL_INSTALL".to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub fn system_gto_cli_install(app: tauri::AppHandle) -> Result<GtoCliStatusResponse, String> {
    let command_path = gto_command_path()?;
    let target_script_path = resolve_gto_script_path(&app).ok_or_else(|| {
        "GTO_CLI_SOURCE_NOT_FOUND: unable to resolve bundled or local gto entry".to_string()
    })?;
    if !command_exists("node") {
        return Err("GTO_CLI_NODE_NOT_FOUND: node is required to run gto".to_string());
    }

    install_gto_wrapper(&command_path, &target_script_path)?;

    system_gto_cli_status(app)
}

#[tauri::command]
pub fn system_gto_skill_status(
    app: tauri::AppHandle,
    agent: String,
) -> Result<GtoSkillStatusResponse, String> {
    let target_dir = gto_skill_target_dir(&agent)?;
    let source_dir = resolve_gto_skill_source_dir(&app);
    let installed = target_dir.join("SKILL.md").is_file();
    let managed = installed && skill_is_managed(&target_dir);
    Ok(GtoSkillStatusResponse {
        installed,
        managed,
        target_dir: Some(target_dir.display().to_string()),
        source_dir: source_dir.as_ref().map(|path| path.display().to_string()),
        install_available: source_dir.is_some(),
        uninstall_available: installed && managed,
        issue: if source_dir.is_none() {
            Some("GTO_SKILL_SOURCE_NOT_FOUND".to_string())
        } else if installed && !managed {
            Some("GTO_SKILL_EXTERNAL_INSTALL".to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn system_gto_skill_install(
    app: tauri::AppHandle,
    agent: String,
) -> Result<GtoSkillStatusResponse, String> {
    let source_dir = resolve_gto_skill_source_dir(&app).ok_or_else(|| {
        "GTO_SKILL_SOURCE_NOT_FOUND: unable to resolve gto skill source".to_string()
    })?;
    let target_dir = gto_skill_target_dir(&agent)?;
    let install_result = tauri::async_runtime::spawn_blocking(move || {
        install_gto_skill_tree(&source_dir, &target_dir)
    })
    .await
    .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: join failed: {error}"))?;
    install_result?;
    system_gto_skill_status(app, agent)
}

#[tauri::command]
pub async fn system_gto_skill_uninstall(
    app: tauri::AppHandle,
    agent: String,
) -> Result<GtoSkillStatusResponse, String> {
    let target_dir = gto_skill_target_dir(&agent)?;
    let uninstall_result =
        tauri::async_runtime::spawn_blocking(move || uninstall_gto_skill_tree(&target_dir))
            .await
            .map_err(|error| format!("GTO_SKILL_UNINSTALL_FAILED: join failed: {error}"))?;
    uninstall_result?;
    system_gto_skill_status(app, agent)
}

#[tauri::command]
pub fn system_gto_cli_uninstall(app: tauri::AppHandle) -> Result<GtoCliStatusResponse, String> {
    let command_path = gto_command_path()?;
    if command_path.exists() {
        if !wrapper_is_managed(&command_path) {
            return Err(
                "GTO_CLI_UNINSTALL_REFUSED: existing gto command is not managed by GT Office"
                    .to_string(),
            );
        }
        fs::remove_file(&command_path)
            .map_err(|error| format!("GTO_CLI_UNINSTALL_FAILED: remove failed: {error}"))?;
    }
    system_gto_cli_status(app)
}

fn command_exists(command: &str) -> bool {
    std::process::Command::new(command)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn gto_command_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "GTO_CLI_HOME_NOT_FOUND: unable to resolve user home".to_string())?;
    Ok(home
        .join(".local")
        .join("bin")
        .join(if cfg!(target_os = "windows") {
            "gto.cmd"
        } else {
            "gto"
        }))
}

fn wrapper_is_managed(path: &Path) -> bool {
    fs::read_to_string(path)
        .map(|content| content.contains(GTO_WRAPPER_MARKER))
        .unwrap_or(false)
}

fn install_gto_wrapper(command_path: &Path, target_script_path: &Path) -> Result<(), String> {
    if let Some(parent) = command_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("GTO_CLI_INSTALL_FAILED: create dir failed: {error}"))?;
    }

    if command_path.exists() {
        let metadata = fs::symlink_metadata(command_path)
            .map_err(|error| format!("GTO_CLI_INSTALL_FAILED: stat failed: {error}"))?;
        if metadata.file_type().is_dir() {
            return Err("GTO_CLI_INSTALL_FAILED: command path points to a directory".to_string());
        }
        let replaceable = metadata.file_type().is_symlink() || wrapper_is_managed(command_path);
        if !replaceable {
            return Err(
                "GTO_CLI_INSTALL_REFUSED: existing gto command is not managed by GT Office"
                    .to_string(),
            );
        }
        fs::remove_file(command_path).map_err(|error| {
            format!("GTO_CLI_INSTALL_FAILED: remove existing command failed: {error}")
        })?;
    }

    let script_body = if cfg!(target_os = "windows") {
        format!(
            "@echo off\r\nREM {marker}\r\nnode \"{target}\" %*\r\n",
            marker = GTO_WRAPPER_MARKER,
            target = target_script_path.display()
        )
    } else {
        format!(
            "#!/bin/sh\n{marker}\nexec node \"{target}\" \"$@\"\n",
            marker = GTO_WRAPPER_MARKER,
            target = target_script_path.display()
        )
    };
    fs::write(command_path, script_body)
        .map_err(|error| format!("GTO_CLI_INSTALL_FAILED: write wrapper failed: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(command_path)
            .map_err(|error| format!("GTO_CLI_INSTALL_FAILED: stat failed: {error}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(command_path, perms)
            .map_err(|error| format!("GTO_CLI_INSTALL_FAILED: chmod failed: {error}"))?;
    }

    Ok(())
}

fn resolve_gto_script_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("gto.mjs"));
        candidates.push(resource_dir.join("gto").join("bin").join("gto.mjs"));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("gto").join("bin").join("gto.mjs"));
            candidates.push(
                parent
                    .join("..")
                    .join("Resources")
                    .join("gto")
                    .join("bin")
                    .join("gto.mjs"),
            );
            candidates.push(
                parent
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("tools")
                    .join("gto")
                    .join("bin")
                    .join("gto.mjs"),
            );
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("tools").join("gto").join("bin").join("gto.mjs"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn resolve_gto_skill_source_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(GTO_SKILL_DIR_NAME));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("..")
                .join("..")
                .join("..")
                .join(".codex")
                .join("skills")
                .join("gto-agent-communication"),
        );
        candidates.push(
            cwd.join(".codex")
                .join("skills")
                .join("gto-agent-communication"),
        );
    }
    candidates.push(
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".codex")
            .join("skills")
            .join(GTO_SKILL_DIR_NAME),
    );
    candidates
        .into_iter()
        .find(|path| path.join("SKILL.md").is_file())
}

fn gto_skill_target_dir(agent: &str) -> Result<PathBuf, String> {
    let home = user_home_dir()?;
    gto_skill_target_dir_from_home(&home, agent)
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        fs::remove_dir_all(dst)
            .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: clear target failed: {error}"))?;
    }
    fs::create_dir_all(dst)
        .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: create target failed: {error}"))?;
    for entry in fs::read_dir(src)
        .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: read source failed: {error}"))?
    {
        let entry = entry.map_err(|error| {
            format!("GTO_SKILL_INSTALL_FAILED: read source entry failed: {error}")
        })?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: copy failed: {error}"))?;
        }
    }
    Ok(())
}

fn user_home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "GTO_SKILL_HOME_NOT_FOUND: unable to resolve user home".to_string())
}

fn gto_skill_target_dir_from_home(home: &Path, agent: &str) -> Result<PathBuf, String> {
    match agent {
        "claude" => Ok(home.join(".claude").join("skills").join(GTO_SKILL_DIR_NAME)),
        "codex" => Ok(home.join(".codex").join("skills").join(GTO_SKILL_DIR_NAME)),
        "gemini" => Ok(home.join(".gemini").join("skills").join(GTO_SKILL_DIR_NAME)),
        _ => Err(format!(
            "GTO_SKILL_TARGET_UNSUPPORTED: unsupported agent {agent}"
        )),
    }
}

fn gto_skill_marker_path(target_dir: &Path) -> PathBuf {
    target_dir.join(GTO_SKILL_MARKER_FILE)
}

fn skill_is_managed(target_dir: &Path) -> bool {
    gto_skill_marker_path(target_dir).is_file()
}

fn install_gto_skill_tree(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    if target_dir.exists() {
        fs::remove_dir_all(target_dir)
            .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: clear target failed: {error}"))?;
    }
    copy_dir_all(source_dir, target_dir)?;
    let marker_body = json!({
        "managedBy": "GT Office",
        "skill": GTO_SKILL_DIR_NAME,
    })
    .to_string();
    fs::write(gto_skill_marker_path(target_dir), marker_body)
        .map_err(|error| format!("GTO_SKILL_INSTALL_FAILED: write marker failed: {error}"))?;
    Ok(())
}

fn uninstall_gto_skill_tree(target_dir: &Path) -> Result<(), String> {
    if !target_dir.exists() {
        return Ok(());
    }
    if !skill_is_managed(target_dir) {
        return Err(
            "GTO_SKILL_UNINSTALL_REFUSED: existing skill directory is not managed by GT Office"
                .to_string(),
        );
    }
    fs::remove_dir_all(target_dir)
        .map_err(|error| format!("GTO_SKILL_UNINSTALL_FAILED: remove failed: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gto-system-test-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn install_gto_wrapper_replaces_existing_symlink_with_managed_wrapper() {
        let dir = temp_dir("replace-symlink");
        let command_path = dir.join("gto");
        let target = dir.join("gto.mjs");
        fs::write(&target, "console.log('ok')\n").expect("write target");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &command_path).expect("create symlink");
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &command_path).expect("create symlink");

        install_gto_wrapper(&command_path, &target).expect("install wrapper");

        let body = fs::read_to_string(&command_path).expect("read wrapper");
        assert!(body.contains(GTO_WRAPPER_MARKER));
        assert!(body.contains(target.to_string_lossy().as_ref()));
    }

    #[test]
    fn wrapper_is_managed_detects_installed_wrapper() {
        let dir = temp_dir("managed-wrapper");
        let command_path = dir.join("gto");
        fs::write(&command_path, format!("#!/bin/sh\n{GTO_WRAPPER_MARKER}\n"))
            .expect("write wrapper");
        assert!(wrapper_is_managed(&command_path));
    }

    #[test]
    fn copy_dir_all_copies_skill_tree() {
        let dir = temp_dir("copy-skill");
        let src = dir.join("src");
        let dst = dir.join("dst");
        fs::create_dir_all(src.join("agents")).expect("create source");
        fs::write(src.join("SKILL.md"), "---\nname: x\ndescription: y\n---\n")
            .expect("write skill");
        fs::write(src.join("agents").join("openai.yaml"), "interface:\n").expect("write yaml");

        copy_dir_all(&src, &dst).expect("copy skill");

        assert!(dst.join("SKILL.md").is_file());
        assert!(dst.join("agents").join("openai.yaml").is_file());
    }

    #[test]
    fn gto_skill_target_dir_uses_agent_specific_directories() {
        let home = PathBuf::from("/tmp/gto-home");
        assert_eq!(
            gto_skill_target_dir_from_home(&home, "claude").unwrap(),
            home.join(".claude").join("skills").join(GTO_SKILL_DIR_NAME)
        );
        assert_eq!(
            gto_skill_target_dir_from_home(&home, "codex").unwrap(),
            home.join(".codex").join("skills").join(GTO_SKILL_DIR_NAME)
        );
        assert_eq!(
            gto_skill_target_dir_from_home(&home, "gemini").unwrap(),
            home.join(".gemini").join("skills").join(GTO_SKILL_DIR_NAME)
        );
    }

    #[test]
    fn install_gto_skill_tree_marks_directory_as_managed() {
        let dir = temp_dir("install-managed-skill");
        let src = dir.join("src");
        let dst = dir.join("dst");
        fs::create_dir_all(&src).expect("create src");
        fs::write(src.join("SKILL.md"), "# skill\n").expect("write skill");

        install_gto_skill_tree(&src, &dst).expect("install skill");

        assert!(dst.join("SKILL.md").is_file());
        assert!(skill_is_managed(&dst));
        assert!(gto_skill_marker_path(&dst).is_file());
    }

    #[test]
    fn install_gto_skill_tree_replaces_external_skill_directory() {
        let dir = temp_dir("replace-external-skill");
        let src = dir.join("src");
        let dst = dir.join("dst");
        fs::create_dir_all(&src).expect("create src");
        fs::write(src.join("SKILL.md"), "# skill\n").expect("write skill");
        fs::create_dir_all(&dst).expect("create dst");
        fs::write(dst.join("SKILL.md"), "# external\n").expect("write external skill");

        install_gto_skill_tree(&src, &dst).expect("replace external skill");
        let body = fs::read_to_string(dst.join("SKILL.md")).expect("read installed skill");
        assert_eq!(body, "# skill\n");
        assert!(skill_is_managed(&dst));
    }
}
