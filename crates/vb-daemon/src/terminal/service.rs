use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::mpsc::Sender;
use tracing::debug;
use uuid::Uuid;

use crate::{
    error::{DaemonError, DaemonResult},
    protocol::{
        Event, ServerFrame, ServerPayload, TerminalCreateRequest, TerminalCreatedResponse,
        TerminalKilledResponse, TerminalOutputEvent, TerminalResizedResponse, TerminalStateEvent,
        TerminalWriteRequest, TerminalWrittenResponse,
    },
    util::ring_buffer::RingBuffer,
};

const OUTPUT_RING_CAPACITY: usize = 64;
const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 36;

struct TerminalControl {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

struct SessionHandle {
    owner_client_id: String,
    control: Arc<Mutex<TerminalControl>>,
}

#[derive(Default, Clone)]
pub struct TerminalService {
    sessions: Arc<tokio::sync::Mutex<HashMap<String, SessionHandle>>>,
}

impl TerminalService {
    pub async fn create_session(
        &self,
        client_id: &str,
        req: TerminalCreateRequest,
        outbound: Sender<ServerFrame>,
    ) -> DaemonResult<TerminalCreatedResponse> {
        let workspace_root = canonicalize_dir(Path::new(&req.workspace_root))?;
        let resolved_cwd = resolve_cwd(&workspace_root, req.cwd.as_deref())?;

        let cols = req.cols.unwrap_or(DEFAULT_COLS);
        let rows = req.rows.unwrap_or(DEFAULT_ROWS);
        let shell = req.shell.unwrap_or_else(default_shell);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| DaemonError::Terminal(format!("open pty failed: {e}")))?;

        let mut command = CommandBuilder::new(shell);
        command.cwd(resolved_cwd.clone());
        for (key, value) in req.env.unwrap_or_default() {
            command.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| DaemonError::Terminal(format!("spawn command failed: {e}")))?;

        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| DaemonError::Terminal(format!("clone reader failed: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| DaemonError::Terminal(format!("take writer failed: {e}")))?;

        let session_id = format!("term:{}", Uuid::new_v4());
        let seq = Arc::new(AtomicU64::new(0));
        let control = Arc::new(Mutex::new(TerminalControl {
            writer,
            master: pair.master,
            child,
        }));

        self.sessions.lock().await.insert(
            session_id.clone(),
            SessionHandle {
                owner_client_id: client_id.to_string(),
                control: control.clone(),
            },
        );

        emit_event(
            &outbound,
            Event::TerminalState(TerminalStateEvent {
                session_id: session_id.clone(),
                state: "running".to_string(),
                reason: None,
            }),
        );

        let outbound_for_thread = outbound.clone();
        let session_for_thread = session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut ring: RingBuffer<Vec<u8>> = RingBuffer::new(OUTPUT_RING_CAPACITY);

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        flush_ring(&outbound_for_thread, &session_for_thread, &seq, &mut ring);
                        emit_event(
                            &outbound_for_thread,
                            Event::TerminalState(TerminalStateEvent {
                                session_id: session_for_thread.clone(),
                                state: "exited".to_string(),
                                reason: None,
                            }),
                        );
                        break;
                    }
                    Ok(size) => {
                        let chunk = buffer[..size].to_vec();
                        push_output(
                            &outbound_for_thread,
                            &session_for_thread,
                            &seq,
                            &mut ring,
                            chunk,
                        );
                    }
                    Err(err) => {
                        emit_event(
                            &outbound_for_thread,
                            Event::TerminalState(TerminalStateEvent {
                                session_id: session_for_thread.clone(),
                                state: "failed".to_string(),
                                reason: Some(err.to_string()),
                            }),
                        );
                        break;
                    }
                }
            }
        });

        Ok(TerminalCreatedResponse {
            session_id,
            resolved_cwd: resolved_cwd.to_string_lossy().to_string(),
        })
    }

    pub async fn write_input(
        &self,
        req: TerminalWriteRequest,
    ) -> DaemonResult<TerminalWrittenResponse> {
        let control = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(&req.session_id).ok_or_else(|| {
                DaemonError::Terminal(format!("session not found: {}", req.session_id))
            })?;
            session.control.clone()
        };

        let input = req.input;
        let accepted_bytes = input.len();
        let write_res = tokio::task::spawn_blocking(move || {
            let mut lock = control
                .lock()
                .map_err(|_| DaemonError::Terminal("terminal control lock poisoned".to_string()))?;
            lock.writer
                .write_all(&input)
                .map_err(|e| DaemonError::Terminal(format!("write failed: {e}")))?;
            Ok::<(), DaemonError>(())
        })
        .await
        .map_err(|e| DaemonError::Terminal(format!("write task join failed: {e}")))?;

        write_res?;

        Ok(TerminalWrittenResponse {
            session_id: req.session_id,
            accepted_bytes,
        })
    }

    pub async fn resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> DaemonResult<TerminalResizedResponse> {
        let control = {
            let sessions = self.sessions.lock().await;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| DaemonError::Terminal(format!("session not found: {session_id}")))?;
            session.control.clone()
        };

        tokio::task::spawn_blocking(move || {
            let lock = control
                .lock()
                .map_err(|_| DaemonError::Terminal("terminal control lock poisoned".to_string()))?;
            lock.master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| DaemonError::Terminal(format!("resize failed: {e}")))
        })
        .await
        .map_err(|e| DaemonError::Terminal(format!("resize task join failed: {e}")))??;

        Ok(TerminalResizedResponse {
            session_id: session_id.to_string(),
            resized: true,
        })
    }

    pub async fn kill_session(
        &self,
        session_id: &str,
        outbound: Option<&Sender<ServerFrame>>,
    ) -> DaemonResult<TerminalKilledResponse> {
        let handle = self
            .sessions
            .lock()
            .await
            .remove(session_id)
            .ok_or_else(|| DaemonError::Terminal(format!("session not found: {session_id}")))?;

        tokio::task::spawn_blocking(move || {
            let mut lock = handle
                .control
                .lock()
                .map_err(|_| DaemonError::Terminal("terminal control lock poisoned".to_string()))?;
            lock.child
                .kill()
                .map_err(|e| DaemonError::Terminal(format!("kill failed: {e}")))?;
            Ok::<(), DaemonError>(())
        })
        .await
        .map_err(|e| DaemonError::Terminal(format!("kill task join failed: {e}")))??;

        if let Some(sender) = outbound {
            emit_event(
                sender,
                Event::TerminalState(TerminalStateEvent {
                    session_id: session_id.to_string(),
                    state: "killed".to_string(),
                    reason: None,
                }),
            );
        }

        Ok(TerminalKilledResponse {
            session_id: session_id.to_string(),
            killed: true,
        })
    }

    pub async fn kill_client_sessions(&self, client_id: &str, outbound: &Sender<ServerFrame>) {
        let session_ids: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter_map(|(id, session)| {
                    (session.owner_client_id == client_id).then_some(id.clone())
                })
                .collect()
        };

        for session_id in session_ids {
            if let Err(err) = self.kill_session(&session_id, Some(outbound)).await {
                debug!(session_id = %session_id, error = %err, "failed to kill session on client disconnect");
            }
        }
    }
}

fn push_output(
    outbound: &Sender<ServerFrame>,
    session_id: &str,
    seq: &AtomicU64,
    ring: &mut RingBuffer<Vec<u8>>,
    chunk: Vec<u8>,
) {
    if !ring.is_empty() {
        ring.push(chunk);
        flush_ring(outbound, session_id, seq, ring);
        return;
    }

    let frame = output_frame(
        session_id,
        seq.fetch_add(1, Ordering::Relaxed) + 1,
        chunk.clone(),
    );
    if outbound.try_send(frame).is_err() {
        ring.push(chunk);
    }
}

fn flush_ring(
    outbound: &Sender<ServerFrame>,
    session_id: &str,
    seq: &AtomicU64,
    ring: &mut RingBuffer<Vec<u8>>,
) {
    for chunk in ring.drain_all() {
        let frame = output_frame(session_id, seq.fetch_add(1, Ordering::Relaxed) + 1, chunk);
        if let Err(err) = outbound.blocking_send(frame) {
            debug!(error = %err, "terminal output channel closed while flushing ring");
            break;
        }
    }
}

fn output_frame(session_id: &str, seq: u64, chunk: Vec<u8>) -> ServerFrame {
    ServerFrame {
        request_id: None,
        payload: ServerPayload::Event(Event::TerminalOutput(TerminalOutputEvent {
            session_id: session_id.to_string(),
            seq,
            chunk,
        })),
    }
}

fn emit_event(outbound: &Sender<ServerFrame>, event: Event) {
    let frame = ServerFrame {
        request_id: None,
        payload: ServerPayload::Event(event),
    };
    if let Err(err) = outbound.blocking_send(frame) {
        debug!(error = %err, "event channel closed");
    }
}

fn canonicalize_dir(path: &Path) -> DaemonResult<PathBuf> {
    let canonical = path.canonicalize().map_err(|e| {
        DaemonError::PathDenied(format!("invalid workspace root '{}': {e}", path.display()))
    })?;
    let meta = canonical.metadata()?;
    if !meta.is_dir() {
        return Err(DaemonError::PathDenied(format!(
            "workspace root is not directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn resolve_cwd(workspace_root: &Path, cwd: Option<&str>) -> DaemonResult<PathBuf> {
    let candidate = match cwd.map(str::trim) {
        None | Some("") => workspace_root.to_path_buf(),
        Some(value) => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                workspace_root.join(path)
            }
        }
    };

    let canonical = candidate.canonicalize().map_err(|e| {
        DaemonError::PathDenied(format!("invalid cwd '{}': {e}", candidate.display()))
    })?;

    if !canonical.starts_with(workspace_root) {
        return Err(DaemonError::PathDenied(format!(
            "cwd outside workspace: {}",
            canonical.display()
        )));
    }

    Ok(canonical)
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}
