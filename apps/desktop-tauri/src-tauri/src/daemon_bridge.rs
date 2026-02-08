use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpStream,
    sync::{mpsc, oneshot, Mutex},
};
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tracing::{debug, warn};
use vb_daemon::protocol::{
    ClientFrame, Event, Request, Response, ResponseEnvelope, SearchCancelRequest,
    SearchStartRequest, ServerFrame, ServerPayload,
};

const FRAME_MAX_BYTES: usize = 8 * 1024 * 1024;
const OUTBOUND_QUEUE_CAPACITY: usize = 512;
const REQUEST_TIMEOUT_MS: u64 = 20_000;

#[derive(Clone)]
struct DaemonConnection {
    outbound: mpsc::Sender<ClientFrame>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<ResponseEnvelope>>>>,
}

#[derive(Default, Clone)]
pub struct DaemonBridge {
    inner: Arc<Mutex<Option<DaemonConnection>>>,
    next_request_id: Arc<AtomicU64>,
    embedded_booted: Arc<AtomicBool>,
}

impl DaemonBridge {
    pub async fn search_start(
        &self,
        app: &AppHandle,
        request: SearchStartRequest,
    ) -> Result<String, String> {
        let response = self.request(app, Request::SearchStart(request)).await?;
        match response {
            Response::SearchStarted(data) => Ok(data.search_id),
            _ => Err("DAEMON_PROTOCOL_ERROR: unexpected search start response".to_string()),
        }
    }

    pub async fn search_cancel(&self, app: &AppHandle, search_id: String) -> Result<bool, String> {
        let response = self
            .request(
                app,
                Request::SearchCancel(SearchCancelRequest { search_id }),
            )
            .await?;
        match response {
            Response::SearchCancelled(data) => Ok(data.cancelled),
            _ => Err("DAEMON_PROTOCOL_ERROR: unexpected search cancel response".to_string()),
        }
    }

    async fn request(&self, app: &AppHandle, request: Request) -> Result<Response, String> {
        let conn = self.ensure_connected(app).await?;
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel::<ResponseEnvelope>();
        conn.pending.lock().await.insert(request_id, tx);

        if conn
            .outbound
            .send(ClientFrame {
                id: request_id,
                request,
            })
            .await
            .is_err()
        {
            conn.pending.lock().await.remove(&request_id);
            self.reset_connection().await;
            return Err("DAEMON_CONNECTION_CLOSED: unable to send request frame".to_string());
        }

        let envelope = tokio::time::timeout(Duration::from_millis(REQUEST_TIMEOUT_MS), rx)
            .await
            .map_err(|_| "DAEMON_TIMEOUT: request timed out".to_string())?
            .map_err(|_| "DAEMON_CONNECTION_CLOSED: response channel closed".to_string())?;

        if !envelope.ok {
            let error = envelope
                .error
                .map(|err| format!("{}: {}", err.code, err.message))
                .unwrap_or_else(|| "UNKNOWN_ERROR: daemon request failed".to_string());
            return Err(error);
        }

        envelope
            .data
            .ok_or_else(|| "DAEMON_PROTOCOL_ERROR: response missing data".to_string())
    }

    async fn ensure_connected(&self, app: &AppHandle) -> Result<DaemonConnection, String> {
        if let Some(existing) = self.inner.lock().await.clone() {
            return Ok(existing);
        }

        let mut last_error = String::new();
        for attempt in 0..2 {
            if attempt == 1 {
                self.try_boot_embedded_daemon().await;
                tokio::time::sleep(Duration::from_millis(180)).await;
            }
            match self.connect(app).await {
                Ok(conn) => {
                    *self.inner.lock().await = Some(conn.clone());
                    return Ok(conn);
                }
                Err(err) => {
                    last_error = err;
                }
            }
        }

        Err(if last_error.is_empty() {
            "DAEMON_CONNECT_FAILED: unable to connect daemon".to_string()
        } else {
            last_error
        })
    }

    async fn connect(&self, app: &AppHandle) -> Result<DaemonConnection, String> {
        let addr = daemon_addr()?;
        let stream = TcpStream::connect(addr)
            .await
            .map_err(|error| format!("DAEMON_CONNECT_FAILED: {error}"))?;
        if let Err(error) = stream.set_nodelay(true) {
            debug!(error = %error, "failed to enable nodelay for daemon stream");
        }

        let codec = LengthDelimitedCodec::builder()
            .max_frame_length(FRAME_MAX_BYTES)
            .new_codec();
        let framed = Framed::new(stream, codec);
        let (mut sink, mut source) = framed.split();
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<ClientFrame>(OUTBOUND_QUEUE_CAPACITY);
        let pending = Arc::new(Mutex::new(
            HashMap::<u64, oneshot::Sender<ResponseEnvelope>>::new(),
        ));
        let pending_for_reader = pending.clone();
        let pending_for_writer = pending.clone();
        let app_handle = app.clone();
        let inner_ref = self.inner.clone();

        tokio::spawn(async move {
            while let Some(frame) = outbound_rx.recv().await {
                let encoded = match bincode::serialize(&frame) {
                    Ok(encoded) => encoded,
                    Err(error) => {
                        warn!(error = %error, "failed to encode daemon request frame");
                        continue;
                    }
                };
                if let Err(error) = sink.send(encoded.into()).await {
                    warn!(error = %error, "daemon socket write failed");
                    break;
                }
            }
            pending_for_writer.lock().await.clear();
            *inner_ref.lock().await = None;
        });

        let inner_ref = self.inner.clone();
        tokio::spawn(async move {
            while let Some(frame_result) = source.next().await {
                let bytes = match frame_result {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        warn!(error = %error, "daemon socket read failed");
                        break;
                    }
                };
                let frame = match bincode::deserialize::<ServerFrame>(&bytes) {
                    Ok(frame) => frame,
                    Err(error) => {
                        warn!(error = %error, "failed to decode daemon server frame");
                        continue;
                    }
                };
                match frame.payload {
                    ServerPayload::Response(envelope) => {
                        if let Some(request_id) = frame.request_id {
                            if let Some(sender) =
                                pending_for_reader.lock().await.remove(&request_id)
                            {
                                let _ = sender.send(envelope);
                            }
                        }
                    }
                    ServerPayload::Event(event) => emit_daemon_event(&app_handle, event),
                }
            }
            pending_for_reader.lock().await.clear();
            *inner_ref.lock().await = None;
        });

        Ok(DaemonConnection {
            outbound: outbound_tx,
            pending,
        })
    }

    async fn reset_connection(&self) {
        *self.inner.lock().await = None;
    }

    async fn try_boot_embedded_daemon(&self) {
        if self.embedded_booted.swap(true, Ordering::SeqCst) {
            return;
        }

        let addr = match daemon_addr() {
            Ok(addr) => addr,
            Err(error) => {
                warn!(error = %error, "skip embedded daemon boot because address is invalid");
                return;
            }
        };

        tokio::spawn(async move {
            let daemon = vb_daemon::daemon::Daemon::new();
            if let Err(error) = daemon.serve(addr).await {
                warn!(error = %error, "embedded daemon exited");
            }
        });
    }
}

fn daemon_addr() -> Result<SocketAddr, String> {
    std::env::var("VB_DAEMON_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:7878".to_string())
        .parse::<SocketAddr>()
        .map_err(|error| format!("DAEMON_CONFIG_INVALID: invalid daemon address: {error}"))
}

fn emit_daemon_event(app: &AppHandle, event: Event) {
    match event {
        Event::SearchChunk(chunk) => {
            let _ = app.emit(
                "daemon/search_chunk",
                json!({
                    "searchId": chunk.search_id,
                    "items": chunk
                        .items
                        .into_iter()
                        .map(|item| {
                            json!({
                                "path": item.rel_path,
                                "line": item.line,
                                "column": item.column,
                                "preview": item.text,
                            })
                        })
                        .collect::<Vec<_>>()
                }),
            );
        }
        Event::SearchBackpressure(backpressure) => {
            let _ = app.emit(
                "daemon/search_backpressure",
                json!({
                    "searchId": backpressure.search_id,
                    "droppedChunks": backpressure.dropped_chunks,
                }),
            );
        }
        Event::SearchDone(done) => {
            let _ = app.emit(
                "daemon/search_done",
                json!({
                    "searchId": done.search_id,
                    "scannedFiles": done.scanned_files,
                    "emittedMatches": done.emitted_matches,
                    "cancelled": done.cancelled,
                }),
            );
        }
        Event::SearchCancelled(cancelled) => {
            let _ = app.emit(
                "daemon/search_cancelled",
                json!({
                    "searchId": cancelled.search_id,
                }),
            );
        }
        Event::TerminalOutput(_) | Event::TerminalState(_) => {}
    }
}
