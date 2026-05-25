use gt_agent_session::{
    DiscoveryCache, Provider, ProviderScanner, ResumeService, SessionRelaunchMode, run_discovery,
};
use gt_changefeed::{GitStatusSnapshot, SessionActivityEvent};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppState;

static DISCOVERY_CACHE: Mutex<Option<HashMap<String, DiscoveryCache>>> = Mutex::new(None);

fn discovery_cache_key(workspace_id: &str, provider: Option<Provider>) -> String {
    match provider {
        Some(provider) => format!("{workspace_id}:{}", provider.as_str()),
        None => workspace_id.to_string(),
    }
}

fn parse_provider(provider: Option<String>) -> Result<Option<Provider>, String> {
    match provider {
        None => Ok(None),
        Some(value) => Provider::from_str_opt(&value)
            .map(Some)
            .ok_or_else(|| format!("unsupported provider: {value}")),
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

#[tauri::command]
pub fn session_list(
    workspace_id: String,
    provider: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    let provider = parse_provider(provider)?;
    state
        .session_registry
        .backfill_missing_titles(&workspace_id, provider, limit)
        .map_err(|e| e.to_string())?;
    let cards = state
        .session_registry
        .list_cards_by_workspace(&workspace_id, provider, limit, offset)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "cards": cards, "limit": limit, "offset": offset }))
}

#[tauri::command]
pub fn session_discover(
    workspace_id: String,
    cwd: String,
    provider: Option<String>,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let provider = parse_provider(provider)?;
    let force = force.unwrap_or(false);
    let scanner = ProviderScanner::new(home_dir());
    let cache_key = discovery_cache_key(&workspace_id, provider);
    let mut cache_guard = DISCOVERY_CACHE.lock().map_err(|_| "discovery cache lock poisoned")?;
    let caches = cache_guard.get_or_insert_with(HashMap::new);
    let cache = caches
        .entry(cache_key)
        .or_insert_with(|| DiscoveryCache::new(30_000));
    let result = run_discovery(
        &state.session_registry,
        &scanner,
        cache,
        &workspace_id,
        PathBuf::from(&cwd).as_path(),
        provider,
        force,
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "cards": result.cards,
        "newCount": result.new_count,
        "updatedCount": result.updated_count,
    }))
}

#[tauri::command]
pub fn session_get(
    gto_session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let detail = state
        .session_registry
        .get_detail(&gto_session_id)
        .map_err(|e| e.to_string())?;
    match detail {
        Some(d) => Ok(json!({ "session": d.session, "stats": d.stats })),
        None => Ok(json!({ "session": null, "stats": null })),
    }
}

#[tauri::command]
pub fn session_end(
    gto_session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .session_registry
        .update_lifecycle(&gto_session_id, gt_agent_session::Lifecycle::Stopped, None)
        .map_err(|e| e.to_string())?;
    state
        .session_registry
        .finalize_stopped_stats(&gto_session_id)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn session_launch(
    workspace_id: String,
    station_id: String,
    agent_id: String,
    provider: String,
    cwd: String,
    terminal_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let provider = Provider::from_str_opt(&provider)
        .ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let gto_session_id = state
        .session_registry
        .launch_session(
            &workspace_id,
            &station_id,
            &agent_id,
            provider,
            &cwd,
            terminal_session_id.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    Ok(json!({ "gtoSessionId": gto_session_id }))
}

#[tauri::command]
pub fn session_resume_bind(
    gto_session_id: String,
    terminal_session_id: String,
    station_id: String,
    agent_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .session_registry
        .resume_bind(&gto_session_id, &terminal_session_id, &station_id, &agent_id)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn session_resume_check(
    gto_session_id: Option<String>,
    relaunch_mode: Option<String>,
    expected_provider: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mode = relaunch_mode
        .as_deref()
        .and_then(SessionRelaunchMode::from_str_opt)
        .unwrap_or(SessionRelaunchMode::Resume);
    let expected = parse_provider(expected_provider)?;

    let needs_session = !matches!(
        mode,
        SessionRelaunchMode::ContinueLast | SessionRelaunchMode::ForkLast
    );

    if needs_session {
        let Some(gto_session_id) = gto_session_id.filter(|id| !id.trim().is_empty()) else {
            return Ok(json!({ "check": "not_found" }));
        };
        let session = state
            .session_registry
            .get(&gto_session_id)
            .map_err(|e| e.to_string())?;
        let Some(session) = session else {
            return Ok(json!({ "check": "not_found" }));
        };
        if let Some(expected) = expected {
            if session.provider != expected {
                return Ok(json!({ "check": "providerMismatch" }));
            }
        }
        let check = ResumeService::validate_resumable(&session);
        let launch_command =
            ResumeService::build_relaunch_launch_command(Some(&session), session.provider, mode);
        let steps = ResumeService::build_relaunch_commands(Some(&session), session.provider, mode);
        return Ok(json!({ "check": check, "launchCommand": launch_command, "steps": steps }));
    }

    let Some(provider) = expected else {
        return Err("expected_provider is required for continueLast and forkLast".to_string());
    };
    let launch_command = ResumeService::build_relaunch_launch_command(None, provider, mode);
    let steps = ResumeService::build_relaunch_commands(None, provider, mode);
    Ok(json!({
        "check": "canResume",
        "launchCommand": launch_command,
        "steps": steps,
    }))
}

#[tauri::command]
pub fn session_update_title(
    gto_session_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .session_registry
        .update_title(&gto_session_id, &title)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn session_changefeed_query(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let feed = state.session_change_feed.lock().map_err(|_| "lock poisoned")?;
    let snapshot = feed.last_snapshot(&workspace_id);
    Ok(json!({ "snapshot": snapshot }))
}

#[tauri::command]
pub fn session_changefeed_push(
    workspace_id: String,
    branch: String,
    dirty: bool,
    ahead: u32,
    behind: u32,
    staged_files: u32,
    unstaged_files: u32,
    untracked_files: u32,
    revision: u64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let snapshot = GitStatusSnapshot {
        workspace_id: workspace_id.clone(),
        available: true,
        branch: branch.clone(),
        dirty,
        ahead,
        behind,
        staged_files,
        unstaged_files,
        untracked_files,
        revision,
    };
    let mut feed = state.session_change_feed.lock().map_err(|_| "lock poisoned")?;
    let items = feed.on_git_updated(&snapshot);
    if !items.is_empty() {
        drop(feed);
        let event = SessionActivityEvent { items };
        let _ = app.emit("gtoffice:session-activity", &event);
        Ok(json!({ "emitted": true }))
    } else {
        Ok(json!({ "emitted": false }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gt_changefeed::{SessionActivityKind, SessionChangeFeed};

    #[test]
    fn test_changefeed_query_empty() {
        let mut feed = SessionChangeFeed::new();
        assert!(feed.last_snapshot("ws1").is_none());
    }

    #[test]
    fn test_changefeed_process_update() {
        let mut feed = SessionChangeFeed::new();
        let snapshot = GitStatusSnapshot {
            workspace_id: "ws1".to_string(),
            available: true,
            branch: "main".to_string(),
            dirty: false,
            ahead: 0,
            behind: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            revision: 1,
        };
        let items = feed.on_git_updated(&snapshot);
        assert!(items.is_empty());
        assert!(feed.last_snapshot("ws1").is_some());
    }

    #[test]
    fn test_changefeed_branch_switch() {
        let mut feed = SessionChangeFeed::new();
        feed.on_git_updated(&GitStatusSnapshot {
            workspace_id: "ws1".to_string(),
            available: true,
            branch: "main".to_string(),
            dirty: false,
            ahead: 0,
            behind: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            revision: 1,
        });
        let items = feed.on_git_updated(&GitStatusSnapshot {
            workspace_id: "ws1".to_string(),
            available: true,
            branch: "feature".to_string(),
            dirty: false,
            ahead: 2,
            behind: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            revision: 2,
        });
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|i| i.kind == SessionActivityKind::BranchSwitched));
        assert!(items.iter().any(|i| i.kind == SessionActivityKind::NewCommits));
    }

    #[test]
    fn test_home_dir_returns_path() {
        let path = home_dir();
        assert!(!path.as_os_str().is_empty());
    }
}