use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
    sync::mpsc::{self, Receiver, Sender},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    runtime::Runtime,
    sync::mpsc::{self as tokio_mpsc, Sender as TokioSender},
    time::{interval, MissedTickBehavior},
};
use gt_abstractions::{
    AbstractionError, AbstractionResult, CommandPolicyEvaluator, TerminalCreateRequest,
    TerminalCwdMode, TerminalProvider, TerminalSession, WorkspaceService,
};

// Re-export from gt-terminal-core
pub use gt_terminal_core::{
    OutputRouter, OutputRouterConfig, RenderedScreen, ScrollbackStore, SessionVisibility,
    TerminalSnapshot, VtEngine,
};

pub fn module_name() -> &'static str {
    "gt-terminal"
}

fn now_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub chunk: Vec<u8>,
    pub seq: u64,
    pub ts_ms: u64,
}

#[derive(Debug, Clone)]
pub struct TerminalStateChangedEvent {
    pub session_id: String,
    pub from: String,
    pub to: String,
    pub ts_ms: u64,
}

#[derive(Debug, Clone)]
pub struct TerminalMetaEvent {
    pub session_id: String,
    pub unread_bytes: u64,
    pub unread_chunks: u64,
    pub tail_chunk: Vec<u8>,
    pub ts_ms: u64,
}

#[derive(Debug, Clone)]
pub enum TerminalRuntimeEvent {
    Output(TerminalOutputEvent),
    StateChanged(TerminalStateChangedEvent),
    Meta(TerminalMetaEvent),
}

const OUTPUT_RING_CAPACITY_BYTES: usize = 2 * 1024 * 1024;
const OUTPUT_AGGREGATION_WINDOW_MS: u64 = 12;
const HIDDEN_META_EMIT_WINDOW_MS: u64 = 280;
const VISIBLE_PENDING_CAP_BYTES: usize = 256 * 1024;
const HIDDEN_TAIL_PREVIEW_BYTES: usize = 2048;

#[derive(Debug, Clone)]
pub struct TerminalSnapshotChunk {
    pub chunk: Vec<u8>,
    pub current_seq: u64,
}

#[derive(Debug, Clone)]
pub struct TerminalDeltaChunk {
    pub chunk: Vec<u8>,
    pub from_seq: Option<u64>,
    pub to_seq: u64,
    pub current_seq: u64,
    pub gap: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionProcessInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub executable: String,
    pub args: String,
    pub depth: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionProcessSnapshot {
    pub session_id: String,
    pub root_pid: Option<u32>,
    pub current_process: Option<TerminalSessionProcessInfo>,
    pub processes: Vec<TerminalSessionProcessInfo>,
}

#[derive(Debug, Clone)]
struct DeltaReadResult {
    chunk: Vec<u8>,
    from_seq: Option<u64>,
    to_seq: u64,
    current_seq: u64,
    gap: bool,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct OutputFrame {
    seq: u64,
    chunk: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RawProcessEntry {
    pid: u32,
    parent_pid: Option<u32>,
    executable: String,
    args: String,
}

fn parse_prefixed_u32(input: &str) -> Option<(u32, &str)> {
    let trimmed = input.trim_start();
    let digit_count = trimmed.chars().take_while(|ch| ch.is_ascii_digit()).count();
    if digit_count == 0 {
        return None;
    }
    let value = trimmed[..digit_count].parse::<u32>().ok()?;
    Some((value, &trimmed[digit_count..]))
}

fn derive_executable_name(command_line: &str) -> String {
    let trimmed = command_line.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let token = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches('"')
        .trim_matches('\'');
    Path::new(token)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(token)
        .to_string()
}

fn parse_unix_process_table_line(line: &str) -> Option<RawProcessEntry> {
    let (pid, tail) = parse_prefixed_u32(line)?;
    let (parent_pid, args_tail) = parse_prefixed_u32(tail)?;
    let args = args_tail.trim().to_string();
    if args.is_empty() {
        return None;
    }
    Some(RawProcessEntry {
        pid,
        parent_pid: Some(parent_pid),
        executable: derive_executable_name(&args),
        args,
    })
}

#[cfg(not(target_os = "windows"))]
fn load_process_table() -> Result<Vec<RawProcessEntry>, String> {
    let output = ProcessCommand::new("ps")
        .args(["-axww", "-o", "pid=", "-o", "ppid=", "-o", "args="])
        .output()
        .map_err(|error| format!("TERMINAL_PROCESS_INSPECT_FAILED: unable to run ps: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "TERMINAL_PROCESS_INSPECT_FAILED: ps exited with status {}",
            output.status
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_unix_process_table_line)
        .collect())
}

#[cfg(target_os = "windows")]
fn load_process_table() -> Result<Vec<RawProcessEntry>, String> {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct WindowsProcessEntry {
        process_id: u32,
        parent_process_id: Option<u32>,
        name: Option<String>,
        command_line: Option<String>,
    }

    let output = ProcessCommand::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|error| {
            format!("TERMINAL_PROCESS_INSPECT_FAILED: unable to run PowerShell: {error}")
        })?;
    if !output.status.success() {
        return Err(format!(
            "TERMINAL_PROCESS_INSPECT_FAILED: PowerShell exited with status {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = stdout.trim();
    if raw.is_empty() || raw == "null" {
        return Ok(Vec::new());
    }

    let parsed: serde_json::Value = serde_json::from_str(raw).map_err(|error| {
        format!("TERMINAL_PROCESS_INSPECT_FAILED: invalid PowerShell JSON: {error}")
    })?;
    let items = match parsed {
        serde_json::Value::Array(items) => items,
        item => vec![item],
    };

    items
        .into_iter()
        .map(|item| {
            serde_json::from_value::<WindowsProcessEntry>(item).map(|process| RawProcessEntry {
                pid: process.process_id,
                parent_pid: process.parent_process_id,
                executable: process.name.unwrap_or_else(|| {
                    derive_executable_name(process.command_line.as_deref().unwrap_or_default())
                }),
                args: process.command_line.unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            format!("TERMINAL_PROCESS_INSPECT_FAILED: invalid process entry payload: {error}")
        })
}

fn build_process_tree(
    root_pid: u32,
    entries: &[RawProcessEntry],
) -> Vec<TerminalSessionProcessInfo> {
    let entry_by_pid = entries
        .iter()
        .cloned()
        .map(|entry| (entry.pid, entry))
        .collect::<HashMap<_, _>>();
    let Some(root) = entry_by_pid.get(&root_pid).cloned() else {
        return Vec::new();
    };

    let mut children_by_parent = HashMap::<u32, Vec<RawProcessEntry>>::new();
    entries.iter().cloned().for_each(|entry| {
        if let Some(parent_pid) = entry.parent_pid {
            children_by_parent
                .entry(parent_pid)
                .or_default()
                .push(entry);
        }
    });

    children_by_parent
        .values_mut()
        .for_each(|children| children.sort_by_key(|entry| entry.pid));

    let mut queue = VecDeque::from([(root, 0_u16)]);
    let mut visited = HashSet::new();
    let mut processes = Vec::new();

    while let Some((entry, depth)) = queue.pop_front() {
        if !visited.insert(entry.pid) {
            continue;
        }
        processes.push(TerminalSessionProcessInfo {
            pid: entry.pid,
            parent_pid: entry.parent_pid,
            executable: entry.executable.clone(),
            args: entry.args.clone(),
            depth,
        });
        if let Some(children) = children_by_parent.get(&entry.pid) {
            children.iter().cloned().for_each(|child| {
                queue.push_back((child, depth.saturating_add(1)));
            });
        }
    }

    processes
}

fn select_current_process(
    processes: &[TerminalSessionProcessInfo],
) -> Option<TerminalSessionProcessInfo> {
    if processes.is_empty() {
        return None;
    }

    let parent_pids = processes
        .iter()
        .filter_map(|process| process.parent_pid)
        .collect::<HashSet<_>>();

    processes
        .iter()
        .filter(|process| process.depth > 0 && !parent_pids.contains(&process.pid))
        .max_by_key(|process| (process.depth, process.pid))
        .cloned()
        .or_else(|| processes.iter().max_by_key(|process| process.pid).cloned())
}

#[derive(Clone)]
pub struct InMemoryTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    workspace_service: W,
    policy_evaluator: P,
    session_sequence: Arc<AtomicU64>,
    sessions: Arc<RwLock<HashMap<String, TerminalSession>>>,
}

impl<W, P> InMemoryTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    pub fn new(workspace_service: W, policy_evaluator: P) -> Self {
        Self {
            workspace_service,
            policy_evaluator,
            session_sequence: Arc::new(AtomicU64::new(0)),
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn has_session(&self, session_id: &str) -> bool {
        match self.sessions.read() {
            Ok(sessions) => sessions.contains_key(session_id),
            Err(_) => false,
        }
    }

    pub fn close_session(&self, session_id: &str) -> bool {
        match self.sessions.write() {
            Ok(mut sessions) => sessions.remove(session_id).is_some(),
            Err(_) => false,
        }
    }

    fn resolve_cwd(
        &self,
        root: &Path,
        request: &TerminalCreateRequest,
    ) -> AbstractionResult<PathBuf> {
        match request.cwd_mode {
            TerminalCwdMode::WorkspaceRoot => Ok(root.to_path_buf()),
            TerminalCwdMode::Custom => {
                let requested =
                    request
                        .cwd
                        .as_deref()
                        .ok_or_else(|| AbstractionError::InvalidArgument {
                            message: "FS_PATH_INVALID: custom cwd is required".to_string(),
                        })?;

                let requested = requested.trim();
                if requested.is_empty() {
                    return Err(AbstractionError::InvalidArgument {
                        message: "FS_PATH_INVALID: custom cwd cannot be empty".to_string(),
                    });
                }

                let requested_path = PathBuf::from(requested);
                let absolute_path = if requested_path.is_absolute() {
                    requested_path
                } else {
                    root.join(requested_path)
                };
                let canonical_path = canonicalize_existing_directory(&absolute_path)?;

                if !canonical_path.starts_with(root) {
                    return Err(AbstractionError::AccessDenied {
                        message: format!(
                            "TERMINAL_CWD_OUTSIDE_WORKSPACE: cwd '{}' is outside workspace root '{}'",
                            canonical_path.display(),
                            root.display()
                        ),
                    });
                }

                if !self
                    .policy_evaluator
                    .can_access_path(&request.workspace_id, &canonical_path)
                {
                    return Err(AbstractionError::AccessDenied {
                        message: format!(
                            "SECURITY_PATH_DENIED: policy denied terminal cwd '{}'",
                            canonical_path.display()
                        ),
                    });
                }

                Ok(canonical_path)
            }
        }
    }
}

impl<W, P> TerminalProvider for InMemoryTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    fn create_session(&self, request: TerminalCreateRequest) -> AbstractionResult<TerminalSession> {
        let context = self.workspace_service.get_context(&request.workspace_id)?;
        let workspace_root = canonicalize_existing_directory(Path::new(&context.root))?;
        let resolved_cwd = self.resolve_cwd(&workspace_root, &request)?;

        if !self
            .policy_evaluator
            .can_access_path(&request.workspace_id, &resolved_cwd)
        {
            return Err(AbstractionError::AccessDenied {
                message: format!(
                    "SECURITY_PATH_DENIED: policy denied terminal cwd '{}'",
                    resolved_cwd.display()
                ),
            });
        }

        let sequence = self.session_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let session = TerminalSession {
            session_id: format!("term:{}:{sequence}", request.workspace_id),
            workspace_id: request.workspace_id.clone(),
            resolved_cwd: resolved_cwd.to_string_lossy().to_string(),
        };

        let mut sessions = self
            .sessions
            .write()
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
            })?;
        sessions.insert(session.session_id.clone(), session.clone());
        Ok(session)
    }
}

fn canonicalize_existing_directory(path: &Path) -> AbstractionResult<PathBuf> {
    let metadata = path
        .metadata()
        .map_err(|err| AbstractionError::InvalidArgument {
            message: format!("FS_PATH_INVALID: path is not accessible: {err}"),
        })?;
    if !metadata.is_dir() {
        return Err(AbstractionError::InvalidArgument {
            message: "FS_PATH_INVALID: path must be a directory".to_string(),
        });
    }

    let canonical = path
        .canonicalize()
        .map_err(|err| AbstractionError::Internal {
            message: format!("TERMINAL_INTERNAL: failed to canonicalize path: {err}"),
        })?;
    Ok(normalize_shell_compatible_path(&canonical))
}

#[cfg(target_os = "windows")]
fn normalize_shell_compatible_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped.to_string());
    }
    if let Some(stripped) = raw.strip_prefix(r"\??\") {
        return PathBuf::from(stripped.to_string());
    }
    path.to_path_buf()
}

#[cfg(not(target_os = "windows"))]
fn normalize_shell_compatible_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[derive(Default)]
struct ByteRingBuffer {
    chunks: VecDeque<Vec<u8>>,
    size_bytes: usize,
}

impl ByteRingBuffer {
    fn push_chunk(&mut self, chunk: &[u8], cap_bytes: usize) {
        if chunk.is_empty() || cap_bytes == 0 {
            return;
        }
        if chunk.len() >= cap_bytes {
            self.chunks.clear();
            self.size_bytes = 0;
            self.chunks
                .push_back(chunk[chunk.len() - cap_bytes..].to_vec());
            self.size_bytes = cap_bytes;
            return;
        }
        self.chunks.push_back(chunk.to_vec());
        self.size_bytes += chunk.len();
        while self.size_bytes > cap_bytes {
            let overflow = self.size_bytes - cap_bytes;
            let should_pop = self
                .chunks
                .front()
                .map(|front| front.len() <= overflow)
                .unwrap_or(false);
            if should_pop {
                if let Some(front) = self.chunks.pop_front() {
                    self.size_bytes = self.size_bytes.saturating_sub(front.len());
                }
                continue;
            }
            if let Some(front) = self.chunks.front_mut() {
                front.drain(..overflow);
                self.size_bytes = self.size_bytes.saturating_sub(overflow);
            }
        }
    }

    fn snapshot(&self, max_bytes: usize) -> Vec<u8> {
        if max_bytes == 0 || self.size_bytes == 0 {
            return Vec::new();
        }
        if max_bytes >= self.size_bytes {
            let mut all = Vec::with_capacity(self.size_bytes);
            for chunk in &self.chunks {
                all.extend_from_slice(chunk);
            }
            return all;
        }

        let mut cursor = self.size_bytes;
        let mut selected: Vec<&[u8]> = Vec::new();
        for chunk in self.chunks.iter().rev() {
            if cursor <= max_bytes {
                break;
            }
            cursor = cursor.saturating_sub(chunk.len());
            selected.push(chunk.as_slice());
        }
        selected.reverse();
        let mut merged = Vec::with_capacity(max_bytes);
        for piece in selected {
            merged.extend_from_slice(piece);
        }
        if merged.len() > max_bytes {
            merged[merged.len() - max_bytes..].to_vec()
        } else {
            merged
        }
    }
}

#[derive(Default)]
struct SessionFlowState {
    ring: ByteRingBuffer,
    frames: VecDeque<OutputFrame>,
    frames_bytes: usize,
    pending_visible: Vec<u8>,
    dropped_visible_bytes: u64,
    hidden_unread_bytes: u64,
    hidden_unread_chunks: u64,
    hidden_tail: Vec<u8>,
    seq: u64,
    subscribers: u32,
}

impl SessionFlowState {
    fn set_visible(&mut self, visible: bool) {
        self.subscribers = if visible { 1 } else { 0 };
        if visible {
            self.hidden_unread_bytes = 0;
            self.hidden_unread_chunks = 0;
            self.hidden_tail.clear();
        }
    }

    fn absorb_output(&mut self, chunk: &[u8]) {
        self.ring.push_chunk(chunk, OUTPUT_RING_CAPACITY_BYTES);
        if self.subscribers > 0 {
            self.push_visible(chunk);
        } else {
            self.hidden_unread_bytes = self.hidden_unread_bytes.saturating_add(chunk.len() as u64);
            self.hidden_unread_chunks = self.hidden_unread_chunks.saturating_add(1);
            append_tail(&mut self.hidden_tail, chunk, HIDDEN_TAIL_PREVIEW_BYTES);
        }
    }

    fn push_visible(&mut self, chunk: &[u8]) {
        if chunk.is_empty() {
            return;
        }
        if chunk.len() >= VISIBLE_PENDING_CAP_BYTES {
            let dropped_existing = self.pending_visible.len() as u64;
            let dropped_incoming = chunk.len().saturating_sub(VISIBLE_PENDING_CAP_BYTES) as u64;
            self.dropped_visible_bytes = self
                .dropped_visible_bytes
                .saturating_add(dropped_existing.saturating_add(dropped_incoming));
            self.pending_visible.clear();
            self.pending_visible
                .extend_from_slice(&chunk[chunk.len() - VISIBLE_PENDING_CAP_BYTES..]);
            return;
        }
        let required = self.pending_visible.len().saturating_add(chunk.len());
        if required > VISIBLE_PENDING_CAP_BYTES {
            let overflow = required - VISIBLE_PENDING_CAP_BYTES;
            self.pending_visible.drain(..overflow);
            self.dropped_visible_bytes = self.dropped_visible_bytes.saturating_add(overflow as u64);
        }
        self.pending_visible.extend_from_slice(chunk);
    }

    fn push_frame(&mut self, seq: u64, chunk: Vec<u8>) {
        self.frames_bytes = self.frames_bytes.saturating_add(chunk.len());
        self.frames.push_back(OutputFrame { seq, chunk });
        while self.frames_bytes > OUTPUT_RING_CAPACITY_BYTES {
            let Some(front) = self.frames.pop_front() else {
                self.frames_bytes = 0;
                break;
            };
            self.frames_bytes = self.frames_bytes.saturating_sub(front.chunk.len());
        }
    }

    fn snapshot(&self, max_bytes: usize) -> TerminalSnapshotChunk {
        TerminalSnapshotChunk {
            chunk: self.ring.snapshot(max_bytes),
            current_seq: self.seq,
        }
    }

    fn read_delta(&self, after_seq: u64, max_bytes: usize) -> DeltaReadResult {
        let current_seq = self.seq;
        if max_bytes == 0 {
            return DeltaReadResult {
                chunk: Vec::new(),
                from_seq: None,
                to_seq: current_seq,
                current_seq,
                gap: false,
                truncated: false,
            };
        }
        let Some(first) = self.frames.front() else {
            return DeltaReadResult {
                chunk: Vec::new(),
                from_seq: None,
                to_seq: current_seq,
                current_seq,
                gap: false,
                truncated: false,
            };
        };

        let gap = if current_seq > after_seq {
            after_seq.saturating_add(1) < first.seq
        } else {
            false
        };

        let mut chunk = Vec::new();
        let mut from_seq = None;
        let mut to_seq = current_seq;
        for frame in &self.frames {
            if frame.seq <= after_seq {
                continue;
            }
            if from_seq.is_none() {
                from_seq = Some(frame.seq);
            }
            to_seq = frame.seq;
            chunk.extend_from_slice(&frame.chunk);
        }

        let truncated = chunk.len() > max_bytes;
        if truncated {
            chunk = chunk[chunk.len() - max_bytes..].to_vec();
        }

        DeltaReadResult {
            chunk,
            from_seq,
            to_seq,
            current_seq,
            gap,
            truncated,
        }
    }
}

fn append_tail(target: &mut Vec<u8>, chunk: &[u8], cap_bytes: usize) {
    if cap_bytes == 0 || chunk.is_empty() {
        return;
    }
    if chunk.len() >= cap_bytes {
        target.clear();
        target.extend_from_slice(&chunk[chunk.len() - cap_bytes..]);
        return;
    }
    target.extend_from_slice(chunk);
    if target.len() > cap_bytes {
        let overflow = target.len() - cap_bytes;
        target.drain(..overflow);
    }
}

enum MuxCommand {
    RegisterSession {
        session_id: String,
    },
    UnregisterSession {
        session_id: String,
    },
    OutputChunk {
        session_id: String,
        chunk: Vec<u8>,
    },
    SetVisibility {
        session_id: String,
        visible: bool,
        response: Sender<bool>,
    },
    ReadSnapshot {
        session_id: String,
        max_bytes: usize,
        response: Sender<Option<TerminalSnapshotChunk>>,
    },
    ReadDelta {
        session_id: String,
        after_seq: u64,
        max_bytes: usize,
        response: Sender<Option<DeltaReadResult>>,
    },
}

async fn run_mux_loop(
    mut command_receiver: tokio_mpsc::Receiver<MuxCommand>,
    event_sender: Sender<TerminalRuntimeEvent>,
) {
    let mut sessions: HashMap<String, SessionFlowState> = HashMap::new();
    let mut output_tick = interval(Duration::from_millis(OUTPUT_AGGREGATION_WINDOW_MS));
    output_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut hidden_meta_tick = interval(Duration::from_millis(HIDDEN_META_EMIT_WINDOW_MS));
    hidden_meta_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            maybe_command = command_receiver.recv() => {
                let Some(command) = maybe_command else {
                    break;
                };
                match command {
                    MuxCommand::RegisterSession { session_id } => {
                        sessions.entry(session_id).or_default();
                    }
                    MuxCommand::UnregisterSession { session_id } => {
                        sessions.remove(&session_id);
                    }
                    MuxCommand::OutputChunk { session_id, chunk } => {
                        sessions
                            .entry(session_id)
                            .or_default()
                            .absorb_output(&chunk);
                    }
                    MuxCommand::SetVisibility {
                        session_id,
                        visible,
                        response,
                    } => {
                        let updated = sessions
                            .get_mut(&session_id)
                            .map(|state| {
                                state.set_visible(visible);
                                true
                            })
                            .unwrap_or(false);
                        let _ = response.send(updated);
                    }
                    MuxCommand::ReadSnapshot {
                        session_id,
                        max_bytes,
                        response,
                    } => {
                        let snapshot = sessions
                            .get(&session_id)
                            .map(|state| state.snapshot(max_bytes));
                        let _ = response.send(snapshot);
                    }
                    MuxCommand::ReadDelta {
                        session_id,
                        after_seq,
                        max_bytes,
                        response,
                    } => {
                        let delta = sessions
                            .get(&session_id)
                            .map(|state| state.read_delta(after_seq, max_bytes));
                        let _ = response.send(delta);
                    }
                }
            }
            _ = output_tick.tick() => {
                for (session_id, state) in sessions.iter_mut() {
                    if state.subscribers == 0
                        || (state.pending_visible.is_empty() && state.dropped_visible_bytes == 0)
                    {
                        continue;
                    }

                    let mut payload = Vec::new();
                    if state.dropped_visible_bytes > 0 {
                        payload.extend_from_slice(
                            format!(
                                "\r\n[terminal:output-coalesced dropped={} bytes]\r\n",
                                state.dropped_visible_bytes
                            )
                            .as_bytes(),
                        );
                        state.dropped_visible_bytes = 0;
                    }
                    payload.extend_from_slice(&state.pending_visible);
                    state.pending_visible.clear();

                    if payload.is_empty() {
                        continue;
                    }

                    state.seq = state.seq.saturating_add(1);
                    state.push_frame(state.seq, payload.clone());
                    let _ = event_sender.send(TerminalRuntimeEvent::Output(TerminalOutputEvent {
                        session_id: session_id.clone(),
                        chunk: payload,
                        seq: state.seq,
                        ts_ms: now_ts_ms(),
                    }));
                }
            }
            _ = hidden_meta_tick.tick() => {
                for (session_id, state) in sessions.iter_mut() {
                    if state.subscribers > 0 || state.hidden_unread_bytes == 0 {
                        continue;
                    }
                    let _ = event_sender.send(TerminalRuntimeEvent::Meta(TerminalMetaEvent {
                        session_id: session_id.clone(),
                        unread_bytes: state.hidden_unread_bytes,
                        unread_chunks: state.hidden_unread_chunks,
                        tail_chunk: state.hidden_tail.clone(),
                        ts_ms: now_ts_ms(),
                    }));
                    state.hidden_unread_bytes = 0;
                    state.hidden_unread_chunks = 0;
                    state.hidden_tail.clear();
                }
            }
        }
    }
}

struct PtySessionRuntime {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Clone)]
pub struct PtyTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    workspace_service: W,
    policy_evaluator: P,
    session_sequence: Arc<AtomicU64>,
    sessions: Arc<Mutex<HashMap<String, PtySessionRuntime>>>,
    event_sender: Sender<TerminalRuntimeEvent>,
    event_receiver: Arc<Mutex<Option<Receiver<TerminalRuntimeEvent>>>>,
    _mux_runtime: Arc<Runtime>,
    mux_sender: TokioSender<MuxCommand>,
}

impl<W, P> PtyTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    fn emit_state(&self, session_id: &str, from: &str, to: &str) {
        let _ = self.event_sender.send(TerminalRuntimeEvent::StateChanged(
            TerminalStateChangedEvent {
                session_id: session_id.to_string(),
                from: from.to_string(),
                to: to.to_string(),
                ts_ms: now_ts_ms(),
            },
        ));
    }

    fn send_mux_command(&self, command: MuxCommand) -> AbstractionResult<()> {
        self.mux_sender
            .try_send(command)
            .map_err(|error| AbstractionError::Internal {
                message: format!("TERMINAL_INTERNAL: terminal mux loop is unavailable: {error}"),
            })
    }

    pub fn new(workspace_service: W, policy_evaluator: P) -> Self {
        let (event_sender, event_receiver) = mpsc::channel();
        let (mux_sender, mux_receiver) = tokio_mpsc::channel(1024);
        let mux_runtime = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_time()
            .build()
        {
            Ok(runtime) => Arc::new(runtime),
            Err(error) => {
                panic!("TERMINAL_INTERNAL: failed to create terminal mux runtime: {error}")
            }
        };
        let mux_runtime_loop = mux_runtime.clone();
        let mux_event_sender = event_sender.clone();
        thread::spawn(move || {
            mux_runtime_loop.block_on(run_mux_loop(mux_receiver, mux_event_sender));
        });

        Self {
            workspace_service,
            policy_evaluator,
            session_sequence: Arc::new(AtomicU64::new(0)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_sender,
            event_receiver: Arc::new(Mutex::new(Some(event_receiver))),
            _mux_runtime: mux_runtime,
            mux_sender,
        }
    }

    pub fn take_event_receiver(&self) -> AbstractionResult<Receiver<TerminalRuntimeEvent>> {
        let mut receiver = self
            .event_receiver
            .lock()
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal event lock poisoned".to_string(),
            })?;
        receiver.take().ok_or_else(|| AbstractionError::Conflict {
            message: "TERMINAL_EVENT_RECEIVER_TAKEN: receiver already consumed".to_string(),
        })
    }

    pub fn has_session(&self, session_id: &str) -> bool {
        match self.sessions.lock() {
            Ok(sessions) => sessions.contains_key(session_id),
            Err(_) => false,
        }
    }

    pub fn describe_session_processes(
        &self,
        session_id: &str,
    ) -> AbstractionResult<TerminalSessionProcessSnapshot> {
        let root_pid = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| AbstractionError::Internal {
                    message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
                })?;
            let session =
                sessions
                    .get(session_id)
                    .ok_or_else(|| AbstractionError::InvalidArgument {
                        message: format!(
                            "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                        ),
                    })?;
            session.child.process_id()
        };

        let processes = if let Some(root_pid) = root_pid {
            let table =
                load_process_table().map_err(|message| AbstractionError::Internal { message })?;
            build_process_tree(root_pid, &table)
        } else {
            Vec::new()
        };
        let current_process = select_current_process(&processes);

        Ok(TerminalSessionProcessSnapshot {
            session_id: session_id.to_string(),
            root_pid,
            current_process,
            processes,
        })
    }

    pub fn set_session_visibility(
        &self,
        session_id: &str,
        visible: bool,
    ) -> AbstractionResult<bool> {
        if !self.has_session(session_id) {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                ),
            });
        }
        let (response_sender, response_receiver) = mpsc::channel();
        self.send_mux_command(MuxCommand::SetVisibility {
            session_id: session_id.to_string(),
            visible,
            response: response_sender,
        })?;
        response_receiver
            .recv_timeout(Duration::from_millis(500))
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal mux visibility ack timed out".to_string(),
            })
    }

    pub fn read_session_snapshot(
        &self,
        session_id: &str,
        max_bytes: usize,
    ) -> AbstractionResult<TerminalSnapshotChunk> {
        if !self.has_session(session_id) {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                ),
            });
        }
        let max_bytes = max_bytes.max(1);
        let (response_sender, response_receiver) = mpsc::channel();
        self.send_mux_command(MuxCommand::ReadSnapshot {
            session_id: session_id.to_string(),
            max_bytes,
            response: response_sender,
        })?;
        response_receiver
            .recv_timeout(Duration::from_millis(500))
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal snapshot request timed out".to_string(),
            })?
            .ok_or_else(|| AbstractionError::InvalidArgument {
                message: format!(
                    "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                ),
            })
    }

    pub fn read_session_delta(
        &self,
        session_id: &str,
        after_seq: u64,
        max_bytes: usize,
    ) -> AbstractionResult<TerminalDeltaChunk> {
        if !self.has_session(session_id) {
            return Err(AbstractionError::InvalidArgument {
                message: format!(
                    "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                ),
            });
        }
        let max_bytes = max_bytes.max(1);
        let (response_sender, response_receiver) = mpsc::channel();
        self.send_mux_command(MuxCommand::ReadDelta {
            session_id: session_id.to_string(),
            after_seq,
            max_bytes,
            response: response_sender,
        })?;
        let result = response_receiver
            .recv_timeout(Duration::from_millis(500))
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal delta request timed out".to_string(),
            })?
            .ok_or_else(|| AbstractionError::InvalidArgument {
                message: format!(
                    "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                ),
            })?;

        Ok(TerminalDeltaChunk {
            chunk: result.chunk,
            from_seq: result.from_seq,
            to_seq: result.to_seq,
            current_seq: result.current_seq,
            gap: result.gap,
            truncated: result.truncated,
        })
    }

    pub fn write_session(&self, session_id: &str, input: &str) -> AbstractionResult<bool> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
            })?;
        let session =
            sessions
                .get_mut(session_id)
                .ok_or_else(|| AbstractionError::InvalidArgument {
                    message: format!(
                        "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                    ),
                })?;
        session
            .writer
            .write_all(input.as_bytes())
            .map_err(|err| AbstractionError::Internal {
                message: format!("TERMINAL_WRITE_FAILED: {err}"),
            })?;
        session
            .writer
            .flush()
            .map_err(|err| AbstractionError::Internal {
                message: format!("TERMINAL_WRITE_FAILED: {err}"),
            })?;
        Ok(!input.is_empty())
    }

    pub fn resize_session(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> AbstractionResult<bool> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
            })?;
        let session =
            sessions
                .get_mut(session_id)
                .ok_or_else(|| AbstractionError::InvalidArgument {
                    message: format!(
                        "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                    ),
                })?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| AbstractionError::Internal {
                message: format!("TERMINAL_RESIZE_FAILED: {err}"),
            })?;
        Ok(true)
    }

    pub fn kill_session(&self, session_id: &str) -> AbstractionResult<bool> {
        let runtime = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AbstractionError::Internal {
                    message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
                })?;
            sessions
                .remove(session_id)
                .ok_or_else(|| AbstractionError::InvalidArgument {
                    message: format!(
                        "TERMINAL_SESSION_NOT_FOUND: session '{session_id}' does not exist"
                    ),
                })?
        };
        let _ = self.send_mux_command(MuxCommand::UnregisterSession {
            session_id: session_id.to_string(),
        });

        let mut child = runtime.child;
        child.kill().map_err(|err| AbstractionError::Internal {
            message: format!("TERMINAL_KILL_FAILED: {err}"),
        })?;
        self.emit_state(session_id, "running", "killed");
        Ok(true)
    }

    fn resolve_cwd(
        &self,
        root: &Path,
        request: &TerminalCreateRequest,
    ) -> AbstractionResult<PathBuf> {
        match request.cwd_mode {
            TerminalCwdMode::WorkspaceRoot => Ok(root.to_path_buf()),
            TerminalCwdMode::Custom => {
                let requested =
                    request
                        .cwd
                        .as_deref()
                        .ok_or_else(|| AbstractionError::InvalidArgument {
                            message: "FS_PATH_INVALID: custom cwd is required".to_string(),
                        })?;
                let requested = requested.trim();
                if requested.is_empty() {
                    return Err(AbstractionError::InvalidArgument {
                        message: "FS_PATH_INVALID: custom cwd cannot be empty".to_string(),
                    });
                }

                let requested_path = PathBuf::from(requested);
                let absolute_path = if requested_path.is_absolute() {
                    requested_path
                } else {
                    root.join(requested_path)
                };
                let canonical_path = canonicalize_existing_directory(&absolute_path)?;

                if !canonical_path.starts_with(root) {
                    return Err(AbstractionError::AccessDenied {
                        message: format!(
                            "TERMINAL_CWD_OUTSIDE_WORKSPACE: cwd '{}' is outside workspace root '{}'",
                            canonical_path.display(),
                            root.display()
                        ),
                    });
                }

                if !self
                    .policy_evaluator
                    .can_access_path(&request.workspace_id, &canonical_path)
                {
                    return Err(AbstractionError::AccessDenied {
                        message: format!(
                            "SECURITY_PATH_DENIED: policy denied terminal cwd '{}'",
                            canonical_path.display()
                        ),
                    });
                }

                Ok(canonical_path)
            }
        }
    }
}

impl<W, P> TerminalProvider for PtyTerminalProvider<W, P>
where
    W: WorkspaceService + Clone,
    P: CommandPolicyEvaluator + Clone,
{
    fn create_session(&self, request: TerminalCreateRequest) -> AbstractionResult<TerminalSession> {
        let context = self.workspace_service.get_context(&request.workspace_id)?;
        let workspace_root = canonicalize_existing_directory(Path::new(&context.root))?;
        let resolved_cwd = self.resolve_cwd(&workspace_root, &request)?;
        let shell_name = resolve_shell_name(request.shell.as_deref());

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 36,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| AbstractionError::Internal {
                message: format!("TERMINAL_SPAWN_FAILED: failed to open pty: {err}"),
            })?;

        let mut command = CommandBuilder::new(&shell_name);

        let shell_lower = shell_name.to_lowercase();
        if shell_lower.contains("pwsh") || shell_lower.contains("powershell") {
            command.arg("-NoLogo");
        }

        command.cwd(&resolved_cwd);
        for (key, value) in &request.env {
            command.env(key, value);
        }

        let mut child =
            pair.slave
                .spawn_command(command)
                .map_err(|err| AbstractionError::Internal {
                    message: format!("TERMINAL_SPAWN_FAILED: failed to spawn shell: {err}"),
                })?;
        drop(pair.slave);

        let mut reader =
            pair.master
                .try_clone_reader()
                .map_err(|err| AbstractionError::Internal {
                    message: format!("TERMINAL_SPAWN_FAILED: failed to open pty reader: {err}"),
                })?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|err| AbstractionError::Internal {
                message: format!("TERMINAL_SPAWN_FAILED: failed to open pty writer: {err}"),
            })?;

        let sequence = self.session_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let session = TerminalSession {
            session_id: format!("term:{}:{sequence}", request.workspace_id),
            workspace_id: request.workspace_id.clone(),
            resolved_cwd: resolved_cwd.to_string_lossy().to_string(),
        };
        if let Err(error) = self.send_mux_command(MuxCommand::RegisterSession {
            session_id: session.session_id.clone(),
        }) {
            let _ = child.kill();
            return Err(error);
        }
        self.emit_state(&session.session_id, "starting", "running");

        let event_sender = self.event_sender.clone();
        let mux_sender = self.mux_sender.clone();
        let sessions_state = self.sessions.clone();
        let session_id = session.session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if mux_sender
                            .blocking_send(MuxCommand::OutputChunk {
                                session_id: session_id.clone(),
                                chunk: buffer[..read].to_vec(),
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = mux_sender.blocking_send(MuxCommand::UnregisterSession {
                session_id: session_id.clone(),
            });
            if let Ok(mut sessions) = sessions_state.lock() {
                sessions.remove(&session_id);
            }
            let _ = event_sender.send(TerminalRuntimeEvent::StateChanged(
                TerminalStateChangedEvent {
                    session_id,
                    from: "running".to_string(),
                    to: "exited".to_string(),
                    ts_ms: now_ts_ms(),
                },
            ));
        });

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AbstractionError::Internal {
                message: "TERMINAL_INTERNAL: terminal session lock poisoned".to_string(),
            })?;
        sessions.insert(
            session.session_id.clone(),
            PtySessionRuntime {
                writer,
                master: pair.master,
                child,
            },
        );
        Ok(session)
    }
}

fn resolve_shell_name(shell: Option<&str>) -> String {
    if let Some(shell) = shell {
        let shell = shell.trim();
        if !shell.is_empty() && shell != "auto" {
            return shell.to_string();
        }
    }

    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/bash".to_string())
    }
}
