use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const LOG_REWIND_BYTES: u64 = 128 * 1024;
const RESCAN_INTERVAL_MS: u64 = 1_500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLogProvider {
    Claude,
    Codex,
    Gemini,
}

#[derive(Debug, Clone)]
pub struct SessionLogRuntime {
    pub provider: SessionLogProvider,
    pub resolved_cwd: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SessionLogRequest {
    pub dispatched_text: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionLogConfig {
    pub home_dir: Option<PathBuf>,
    pub claude_projects_root: Option<PathBuf>,
    pub codex_sessions_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLogHealth {
    Pending,
    Active,
    Stale,
    Failed,
}

#[derive(Debug, Clone)]
pub struct SessionLogPollOutcome {
    pub text: Option<String>,
    pub source_path: Option<PathBuf>,
    pub health: SessionLogHealth,
}

#[derive(Debug, Clone)]
pub enum SessionLogBinding {
    Claude(ClaudeSessionBinding),
    Codex(CodexSessionBinding),
}

impl SessionLogBinding {
    pub fn provider(&self) -> SessionLogProvider {
        match self {
            Self::Claude(_) => SessionLogProvider::Claude,
            Self::Codex(_) => SessionLogProvider::Codex,
        }
    }

    pub fn source_path(&self) -> Option<&Path> {
        match self {
            Self::Claude(binding) => binding.active_session_path.as_deref(),
            Self::Codex(binding) => binding.active_log_path.as_deref(),
        }
    }

    pub fn poll(&mut self) -> SessionLogPollOutcome {
        match self {
            Self::Claude(binding) => binding.poll(),
            Self::Codex(binding) => binding.poll(),
        }
    }
}

pub fn bind_session_log(
    runtime: &SessionLogRuntime,
    request: &SessionLogRequest,
) -> Option<SessionLogBinding> {
    bind_session_log_with_config(runtime, request, SessionLogConfig::default())
}

pub fn bind_session_log_with_config(
    runtime: &SessionLogRuntime,
    request: &SessionLogRequest,
    config: SessionLogConfig,
) -> Option<SessionLogBinding> {
    let prompt_fingerprint = normalize_message(&request.dispatched_text);
    if prompt_fingerprint.is_empty() {
        return None;
    }

    match runtime.provider {
        SessionLogProvider::Claude => Some(SessionLogBinding::Claude(ClaudeSessionBinding::new(
            runtime,
            prompt_fingerprint,
            config,
        ))),
        SessionLogProvider::Codex => Some(SessionLogBinding::Codex(CodexSessionBinding::new(
            runtime,
            prompt_fingerprint,
            config,
        ))),
        SessionLogProvider::Gemini => None,
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeSessionBinding {
    prompt_fingerprint: String,
    resolved_cwd: PathBuf,
    project_dir: PathBuf,
    active_session_path: Option<PathBuf>,
    initial_scan_offset: u64,
    offset: u64,
    carry: Vec<u8>,
    initialized: bool,
    anchor_found: bool,
    latest_text: String,
    health: SessionLogHealth,
    last_rescan_at_ms: u64,
}

impl ClaudeSessionBinding {
    fn new(
        runtime: &SessionLogRuntime,
        prompt_fingerprint: String,
        config: SessionLogConfig,
    ) -> Self {
        let projects_root = config.claude_projects_root.unwrap_or_else(|| {
            config
                .home_dir
                .or_else(resolve_user_home_dir)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".claude")
                .join("projects")
        });
        let project_dir = candidate_claude_project_dirs(&projects_root, &runtime.resolved_cwd)
            .into_iter()
            .find(|candidate| candidate.exists())
            .unwrap_or_else(|| {
                projects_root.join(claude_project_key_for_path(&runtime.resolved_cwd))
            });
        let preferred = resolve_latest_claude_session(&project_dir, &runtime.resolved_cwd);
        let initial_scan_offset = preferred
            .as_deref()
            .and_then(|path| rewind_offset(path, LOG_REWIND_BYTES))
            .unwrap_or(0);
        Self {
            prompt_fingerprint,
            resolved_cwd: runtime.resolved_cwd.clone(),
            project_dir,
            active_session_path: preferred,
            initial_scan_offset,
            offset: 0,
            carry: Vec::new(),
            initialized: false,
            anchor_found: false,
            latest_text: String::new(),
            health: SessionLogHealth::Pending,
            last_rescan_at_ms: 0,
        }
    }

    fn poll(&mut self) -> SessionLogPollOutcome {
        self.maybe_rescan();
        let Some(path) = self.active_session_path.clone() else {
            self.health = SessionLogHealth::Pending;
            return SessionLogPollOutcome {
                text: None,
                source_path: None,
                health: self.health,
            };
        };

        match read_jsonl_lines(&path, self.offset_for_next_read(), &mut self.carry) {
            Ok(read) => {
                self.offset = read.next_offset;
                self.initialized = true;
                for line in read.lines {
                    let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    if !self.anchor_found {
                        if extract_claude_role_text(&entry, "user")
                            .as_deref()
                            .is_some_and(|text| messages_match(text, &self.prompt_fingerprint))
                        {
                            self.anchor_found = true;
                            self.health = SessionLogHealth::Pending;
                        }
                        continue;
                    }

                    if let Some(text) = extract_claude_role_text(&entry, "assistant") {
                        self.latest_text = merge_reply_text(&self.latest_text, &text);
                    }
                }

                self.health = if self.anchor_found {
                    if self.latest_text.trim().is_empty() {
                        SessionLogHealth::Pending
                    } else {
                        SessionLogHealth::Active
                    }
                } else {
                    SessionLogHealth::Pending
                };
            }
            Err(_) => {
                self.health = SessionLogHealth::Failed;
            }
        }

        SessionLogPollOutcome {
            text: trimmed_option(&self.latest_text),
            source_path: self.active_session_path.clone(),
            health: self.health,
        }
    }

    fn offset_for_next_read(&self) -> u64 {
        if self.initialized {
            self.offset
        } else {
            self.initial_scan_offset
        }
    }

    fn maybe_rescan(&mut self) {
        let now = now_ms();
        let active_missing = self
            .active_session_path
            .as_ref()
            .is_some_and(|path| !path.exists());
        if !active_missing
            && self.last_rescan_at_ms != 0
            && now.saturating_sub(self.last_rescan_at_ms) < RESCAN_INTERVAL_MS
        {
            return;
        }
        self.last_rescan_at_ms = now;

        let latest = resolve_latest_claude_session(&self.project_dir, &self.resolved_cwd);
        let should_switch = match (&self.active_session_path, latest.as_ref()) {
            (None, Some(_)) => true,
            (Some(current), Some(candidate)) if !self.anchor_found => current != candidate,
            _ => false,
        };
        if should_switch {
            self.active_session_path = latest.clone();
            self.initial_scan_offset = latest
                .as_deref()
                .and_then(|path| rewind_offset(path, LOG_REWIND_BYTES))
                .unwrap_or(0);
            self.offset = 0;
            self.carry.clear();
            self.initialized = false;
        }
    }
}

#[derive(Debug, Clone)]
pub struct CodexSessionBinding {
    prompt_fingerprint: String,
    sessions_root: PathBuf,
    resolved_cwd: String,
    active_log_path: Option<PathBuf>,
    initial_scan_offset: u64,
    offset: u64,
    carry: Vec<u8>,
    initialized: bool,
    anchor_found: bool,
    latest_text: String,
    health: SessionLogHealth,
    last_rescan_at_ms: u64,
}

impl CodexSessionBinding {
    fn new(
        runtime: &SessionLogRuntime,
        prompt_fingerprint: String,
        config: SessionLogConfig,
    ) -> Self {
        let sessions_root = config.codex_sessions_root.unwrap_or_else(|| {
            config
                .home_dir
                .or_else(resolve_user_home_dir)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".codex")
                .join("sessions")
        });
        let resolved_cwd = normalize_path_key(&runtime.resolved_cwd);
        let preferred = resolve_latest_codex_log(&sessions_root, &resolved_cwd);
        let initial_scan_offset = preferred
            .as_deref()
            .and_then(|path| rewind_offset(path, LOG_REWIND_BYTES))
            .unwrap_or(0);
        Self {
            prompt_fingerprint,
            sessions_root,
            resolved_cwd,
            active_log_path: preferred,
            initial_scan_offset,
            offset: 0,
            carry: Vec::new(),
            initialized: false,
            anchor_found: false,
            latest_text: String::new(),
            health: SessionLogHealth::Pending,
            last_rescan_at_ms: 0,
        }
    }

    fn poll(&mut self) -> SessionLogPollOutcome {
        self.maybe_rescan();
        let Some(path) = self.active_log_path.clone() else {
            self.health = SessionLogHealth::Pending;
            return SessionLogPollOutcome {
                text: None,
                source_path: None,
                health: self.health,
            };
        };

        match read_jsonl_lines(&path, self.offset_for_next_read(), &mut self.carry) {
            Ok(read) => {
                self.offset = read.next_offset;
                self.initialized = true;
                for line in read.lines {
                    let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    if !self.anchor_found {
                        if extract_codex_user_text(&entry)
                            .as_deref()
                            .is_some_and(|text| messages_match(text, &self.prompt_fingerprint))
                        {
                            self.anchor_found = true;
                            self.health = SessionLogHealth::Pending;
                        }
                        continue;
                    }

                    if let Some(text) = extract_codex_assistant_text(&entry) {
                        self.latest_text = merge_reply_text(&self.latest_text, &text);
                    }
                }

                self.health = if self.anchor_found {
                    if self.latest_text.trim().is_empty() {
                        SessionLogHealth::Pending
                    } else {
                        SessionLogHealth::Active
                    }
                } else {
                    SessionLogHealth::Pending
                };
            }
            Err(_) => {
                self.health = SessionLogHealth::Failed;
            }
        }

        SessionLogPollOutcome {
            text: trimmed_option(&self.latest_text),
            source_path: self.active_log_path.clone(),
            health: self.health,
        }
    }

    fn offset_for_next_read(&self) -> u64 {
        if self.initialized {
            self.offset
        } else {
            self.initial_scan_offset
        }
    }

    fn maybe_rescan(&mut self) {
        let now = now_ms();
        let active_missing = self
            .active_log_path
            .as_ref()
            .is_some_and(|path| !path.exists());
        if !active_missing
            && self.last_rescan_at_ms != 0
            && now.saturating_sub(self.last_rescan_at_ms) < RESCAN_INTERVAL_MS
        {
            return;
        }
        self.last_rescan_at_ms = now;

        let latest = resolve_latest_codex_log(&self.sessions_root, &self.resolved_cwd);
        let should_switch = match (&self.active_log_path, latest.as_ref()) {
            (None, Some(_)) => true,
            (Some(current), Some(candidate)) if !self.anchor_found => current != candidate,
            _ => false,
        };
        if should_switch {
            self.active_log_path = latest.clone();
            self.initial_scan_offset = latest
                .as_deref()
                .and_then(|path| rewind_offset(path, LOG_REWIND_BYTES))
                .unwrap_or(0);
            self.offset = 0;
            self.carry.clear();
            self.initialized = false;
        }
    }
}

#[derive(Debug)]
struct JsonlRead {
    lines: Vec<String>,
    next_offset: u64,
}

fn read_jsonl_lines(
    path: &Path,
    offset: u64,
    carry: &mut Vec<u8>,
) -> Result<JsonlRead, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    let size = metadata.len();
    let start = offset.min(size);
    file.seek(SeekFrom::Start(start))?;

    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    let next_offset = start + data.len() as u64;

    let mut buffer = Vec::new();
    buffer.extend_from_slice(carry);
    buffer.extend_from_slice(&data);

    let mut lines = Vec::new();
    let mut slice = buffer.as_slice();
    loop {
        let Some(index) = slice.iter().position(|byte| *byte == b'\n') else {
            carry.clear();
            carry.extend_from_slice(slice);
            break;
        };
        let line = &slice[..index];
        let text = String::from_utf8_lossy(line).trim().to_string();
        if !text.is_empty() {
            lines.push(text);
        }
        slice = &slice[index + 1..];
    }

    Ok(JsonlRead { lines, next_offset })
}

fn resolve_user_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .filter(|path| !path.as_os_str().is_empty())
        })
}

fn claude_project_key_for_path(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

fn candidate_claude_project_dirs(root: &Path, work_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for candidate in [
        env::var_os("PWD").map(PathBuf::from),
        Some(work_dir.to_path_buf()),
    ] {
        let Some(candidate) = candidate else {
            continue;
        };
        let key = claude_project_key_for_path(&candidate);
        if seen.insert(key.clone()) {
            candidates.push(root.join(key));
        }
        if let Ok(resolved) = candidate.canonicalize() {
            let key = claude_project_key_for_path(&resolved);
            if seen.insert(key.clone()) {
                candidates.push(root.join(key));
            }
        }
    }
    candidates
}

fn resolve_latest_claude_session(project_dir: &Path, work_dir: &Path) -> Option<PathBuf> {
    let index_candidate = resolve_claude_session_from_index(project_dir, work_dir);
    if index_candidate.is_some() {
        return index_candidate;
    }

    let mut latest = None;
    let mut latest_mtime = -1_i128;
    for entry in fs::read_dir(project_dir).ok()? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let mtime = path
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(system_time_to_millis)
            .unwrap_or(0);
        if mtime as i128 >= latest_mtime {
            latest = Some(path);
            latest_mtime = mtime as i128;
        }
    }
    latest
}

fn resolve_claude_session_from_index(project_dir: &Path, work_dir: &Path) -> Option<PathBuf> {
    let index_path = project_dir.join("sessions-index.json");
    let payload = fs::read_to_string(index_path).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&payload).ok()?;
    let entries = json.get("entries")?.as_array()?;
    let work_dir_key = normalize_path_key(work_dir);

    let mut latest = None;
    let mut latest_mtime = -1_i128;
    for entry in entries {
        if entry
            .get("isSidechain")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
        {
            continue;
        }
        let project_path = entry.get("projectPath").and_then(serde_json::Value::as_str);
        if let Some(project_path) = project_path {
            if normalize_path_key(project_path) != work_dir_key {
                continue;
            }
        } else {
            continue;
        }
        let full_path = entry
            .get("fullPath")
            .and_then(serde_json::Value::as_str)
            .map(PathBuf::from)?;
        if !full_path.exists() {
            continue;
        }
        let mtime = entry
            .get("fileMtime")
            .and_then(serde_json::Value::as_i64)
            .map(|value| value.max(0) as u64)
            .or_else(|| {
                full_path
                    .metadata()
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .and_then(system_time_to_millis)
            })
            .unwrap_or(0);
        if mtime as i128 >= latest_mtime {
            latest = Some(full_path);
            latest_mtime = mtime as i128;
        }
    }
    latest
}

fn extract_claude_role_text(entry: &serde_json::Value, role: &str) -> Option<String> {
    let entry_type = entry.get("type")?.as_str()?.trim().to_ascii_lowercase();
    if entry_type != role {
        let message = entry.get("message")?;
        if message.get("role")?.as_str()?.trim().to_ascii_lowercase() != role {
            return None;
        }
        return extract_claude_content_text(message.get("content")?);
    }
    if let Some(message) = entry.get("message") {
        if let Some(content) = message.get("content") {
            return extract_claude_content_text(content);
        }
    }
    extract_claude_content_text(entry.get("content")?)
}

fn extract_claude_content_text(content: &serde_json::Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return trimmed_option(text);
    }
    let items = content.as_array()?;
    let mut texts = Vec::new();
    for item in items {
        let item_type = item
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if matches!(
            item_type,
            "thinking" | "thinking_delta" | "tool_use" | "tool_result"
        ) {
            continue;
        }
        if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
            if !text.trim().is_empty() {
                texts.push(text.trim().to_string());
            }
        }
    }
    trimmed_option(&texts.join("\n"))
}

fn resolve_latest_codex_log(root: &Path, normalized_cwd: &str) -> Option<PathBuf> {
    let mut latest = None;
    let mut latest_mtime = -1_i128;
    let entries = walk_jsonl_files(root);
    for path in entries {
        if extract_codex_log_cwd(&path).as_deref() != Some(normalized_cwd) {
            continue;
        }
        let mtime = path
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(system_time_to_millis)
            .unwrap_or(0);
        if mtime as i128 >= latest_mtime {
            latest = Some(path);
            latest_mtime = mtime as i128;
        }
    }
    latest
}

fn walk_jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(walk_jsonl_files(&path));
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    files
}

fn extract_codex_log_cwd(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let first_line = content.lines().next()?;
    let entry = serde_json::from_str::<serde_json::Value>(first_line).ok()?;
    if entry.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let cwd = entry
        .get("payload")?
        .get("cwd")?
        .as_str()
        .map(normalize_path_key)?;
    Some(cwd)
}

fn extract_codex_user_text(entry: &serde_json::Value) -> Option<String> {
    let payload = entry.get("payload");
    match entry.get("type").and_then(serde_json::Value::as_str) {
        Some("event_msg") => {
            let payload = payload?;
            if payload.get("type")?.as_str()? != "user_message" {
                return None;
            }
            payload.get("message")?.as_str().and_then(trimmed_option)
        }
        Some("response_item") => {
            let payload = payload?;
            if payload.get("type")?.as_str()? != "message"
                || payload.get("role")?.as_str()? != "user"
            {
                return None;
            }
            let content = payload.get("content")?.as_array()?;
            let mut texts = Vec::new();
            for item in content {
                if item.get("type").and_then(serde_json::Value::as_str) != Some("input_text") {
                    continue;
                }
                if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
                    if !text.trim().is_empty() {
                        texts.push(text.trim().to_string());
                    }
                }
            }
            trimmed_option(&texts.join("\n"))
        }
        _ => None,
    }
}

fn extract_codex_assistant_text(entry: &serde_json::Value) -> Option<String> {
    let payload = entry.get("payload");
    match entry.get("type").and_then(serde_json::Value::as_str) {
        Some("response_item") => {
            let payload = payload?;
            if payload.get("type")?.as_str()? != "message"
                || payload.get("role")?.as_str()? != "assistant"
            {
                return None;
            }
            if let Some(content) = payload.get("content").and_then(serde_json::Value::as_array) {
                let mut texts = Vec::new();
                for item in content {
                    let item_type = item.get("type").and_then(serde_json::Value::as_str);
                    if !matches!(item_type, Some("output_text" | "text")) {
                        continue;
                    }
                    if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
                        if !text.trim().is_empty() {
                            texts.push(text.trim().to_string());
                        }
                    }
                }
                if !texts.is_empty() {
                    return Some(texts.join("\n"));
                }
            }
            payload
                .get("message")
                .and_then(serde_json::Value::as_str)
                .and_then(trimmed_option)
        }
        Some("event_msg") => {
            let payload = payload?;
            let payload_type = payload.get("type").and_then(serde_json::Value::as_str)?;
            if !matches!(
                payload_type,
                "agent_message" | "assistant_message" | "assistant" | "assistant_response"
            ) {
                return None;
            }
            payload
                .get("message")
                .or_else(|| payload.get("content"))
                .or_else(|| payload.get("text"))
                .and_then(serde_json::Value::as_str)
                .and_then(trimmed_option)
        }
        _ => None,
    }
}

fn rewind_offset(path: &Path, rewind_bytes: u64) -> Option<u64> {
    let size = path.metadata().ok()?.len();
    Some(size.saturating_sub(rewind_bytes))
}

fn normalize_message(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn messages_match(candidate: &str, prompt_fingerprint: &str) -> bool {
    let candidate = normalize_message(candidate);
    if candidate.is_empty() || prompt_fingerprint.is_empty() {
        return false;
    }
    candidate == prompt_fingerprint
        || candidate.contains(prompt_fingerprint)
        || (prompt_fingerprint.len() >= 24 && prompt_fingerprint.contains(&candidate))
}

fn merge_reply_text(existing: &str, candidate: &str) -> String {
    let existing = existing.trim_end();
    let candidate = candidate.trim_end();
    if candidate.is_empty() {
        return existing.to_string();
    }
    if existing.is_empty() {
        return candidate.to_string();
    }
    if existing == candidate || existing.contains(candidate) {
        return existing.to_string();
    }
    if candidate.contains(existing) {
        return candidate.to_string();
    }

    let existing_lines: Vec<&str> = existing.lines().collect();
    let candidate_lines: Vec<&str> = candidate.lines().collect();
    let max_overlap = existing_lines.len().min(candidate_lines.len());
    for overlap in (1..=max_overlap).rev() {
        if existing_lines[existing_lines.len() - overlap..] == candidate_lines[..overlap] {
            let mut merged = existing_lines
                .iter()
                .map(|line| (*line).to_string())
                .collect::<Vec<_>>();
            merged.extend(
                candidate_lines[overlap..]
                    .iter()
                    .map(|line| (*line).to_string()),
            );
            return merged.join("\n");
        }
    }

    format!("{existing}\n{candidate}")
}

fn trimmed_option(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_path_key(value: impl AsRef<Path>) -> String {
    let value = value.as_ref();
    let normalized = value
        .canonicalize()
        .unwrap_or_else(|_| value.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn system_time_to_millis(value: std::time::SystemTime) -> Option<u64> {
    value
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn now_ms() -> u64 {
    system_time_to_millis(std::time::SystemTime::now()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("vb-session-log-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn claude_binding_reads_assistant_text_after_matching_user_message() {
        let root = temp_dir("claude");
        let work_dir = PathBuf::from("/tmp/work");
        let project_dir = root.join(claude_project_key_for_path(&work_dir));
        fs::create_dir_all(&project_dir).expect("create project dir");
        let session_path = project_dir.join("session.jsonl");
        fs::write(
            &session_path,
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"old\"}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ignore\"}]}}\n",
        )
        .expect("write baseline");

        let runtime = SessionLogRuntime {
            provider: SessionLogProvider::Claude,
            resolved_cwd: work_dir.clone(),
        };
        let mut binding = bind_session_log_with_config(
            &runtime,
            &SessionLogRequest {
                dispatched_text: "hello world".to_string(),
            },
            SessionLogConfig {
                claude_projects_root: Some(root.clone()),
                ..SessionLogConfig::default()
            },
        )
        .expect("bind session log");

        let mut appended = fs::read_to_string(&session_path).expect("read baseline");
        appended.push_str(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hello world\"}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"first\"}]}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"first\\nsecond\"}]}}\n",
        );
        fs::write(&session_path, appended).expect("append log");

        let outcome = binding.poll();
        assert_eq!(outcome.health, SessionLogHealth::Active);
        assert_eq!(outcome.text.as_deref(), Some("first\nsecond"));
        assert_eq!(outcome.source_path.as_deref(), Some(session_path.as_path()));
    }

    #[test]
    fn codex_binding_filters_logs_by_cwd_and_collects_assistant_message() {
        let root = temp_dir("codex");
        let work_dir = PathBuf::from("/tmp/project");
        let candidate_dir = root.join("2026/03/15");
        fs::create_dir_all(&candidate_dir).expect("create sessions dir");
        let session_path = candidate_dir.join("rollout.jsonl");
        fs::write(
            &session_path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"cwd\":\"{}\"}}}}\n\
{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"hello world\"}}]}}}}\n\
{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\",\"message\":\"partial\"}}}}\n\
{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{{\"type\":\"output_text\",\"text\":\"final answer\"}}]}}}}\n",
                work_dir.display()
            ),
        )
        .expect("write codex log");

        let runtime = SessionLogRuntime {
            provider: SessionLogProvider::Codex,
            resolved_cwd: work_dir.clone(),
        };
        let mut binding = bind_session_log_with_config(
            &runtime,
            &SessionLogRequest {
                dispatched_text: "hello world".to_string(),
            },
            SessionLogConfig {
                codex_sessions_root: Some(root.clone()),
                ..SessionLogConfig::default()
            },
        )
        .expect("bind session log");

        let outcome = binding.poll();
        assert_eq!(outcome.health, SessionLogHealth::Active);
        assert_eq!(outcome.text.as_deref(), Some("partial\nfinal answer"));
        assert_eq!(outcome.source_path.as_deref(), Some(session_path.as_path()));
    }
}
