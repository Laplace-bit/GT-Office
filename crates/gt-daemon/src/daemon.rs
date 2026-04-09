use std::{net::SocketAddr, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use tokio::{
    net::TcpStream,
    sync::mpsc::{self, Sender},
};
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    error::DaemonResult,
    fileio::FileService,
    protocol::{
        codec::{decode_client_frame, encode_server_frame},
        ClientFrame, Request, Response, ResponseEnvelope, SearchCancelledResponse,
        SearchStartedResponse, ServerFrame, ServerPayload,
    },
    search::SearchService,
    terminal::TerminalService,
    transport,
};

const OUTBOUND_QUEUE_CAPACITY: usize = 512;

#[derive(Default, Clone)]
pub struct Daemon {
    file_service: FileService,
    search_service: SearchService,
    terminal_service: TerminalService,
}

impl Daemon {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn serve(self, addr: SocketAddr) -> anyhow::Result<()> {
        let listener = transport::tcp::bind(addr).await?;
        info!(%addr, "gt-daemon listening");

        let daemon = Arc::new(self);
        loop {
            let (stream, remote) = listener.accept().await?;
            let daemon = daemon.clone();
            tokio::spawn(async move {
                let client_id = Uuid::new_v4().to_string();
                info!(%client_id, %remote, "client connected");
                if let Err(err) = daemon.handle_client(client_id.clone(), stream).await {
                    warn!(%client_id, error = %err, "client loop ended with error");
                }
            });
        }
    }

    async fn handle_client(&self, client_id: String, stream: TcpStream) -> DaemonResult<()> {
        let codec = LengthDelimitedCodec::builder()
            .max_frame_length(8 * 1024 * 1024)
            .new_codec();
        let framed = Framed::new(stream, codec);
        let (mut sink, mut source) = framed.split();

        let (outbound_tx, mut outbound_rx) = mpsc::channel::<ServerFrame>(OUTBOUND_QUEUE_CAPACITY);

        let writer = tokio::spawn(async move {
            while let Some(frame) = outbound_rx.recv().await {
                let payload = match encode_server_frame(&frame) {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        error!(error = %err, "encode server frame failed");
                        continue;
                    }
                };
                if let Err(err) = sink.send(payload).await {
                    warn!(error = %err, "socket write failed");
                    break;
                }
            }
        });

        while let Some(frame_bytes) = source.next().await {
            let frame_bytes = frame_bytes?;
            let decoded = decode_client_frame(frame_bytes.as_ref());
            let frame = match decoded {
                Ok(frame) => frame,
                Err(err) => {
                    warn!(%client_id, error = %err, "decode client frame failed");
                    continue;
                }
            };

            self.handle_request(&client_id, frame, &outbound_tx).await;
        }

        self.search_service.cancel_for_client(&client_id).await;
        self.terminal_service
            .kill_client_sessions(&client_id, &outbound_tx)
            .await;

        drop(outbound_tx);
        writer.abort();
        info!(%client_id, "client disconnected");
        Ok(())
    }

    async fn handle_request(
        &self,
        client_id: &str,
        frame: ClientFrame,
        outbound: &Sender<ServerFrame>,
    ) {
        let request_id = frame.id;
        let result = self
            .dispatch_request(client_id, frame.request, outbound)
            .await;

        let envelope = match result {
            Ok(response) => ResponseEnvelope::ok(response),
            Err(err) => ResponseEnvelope::err(err.code(), err.to_string()),
        };

        let response_frame = ServerFrame {
            request_id: Some(request_id),
            payload: ServerPayload::Response(envelope),
        };

        if let Err(err) = outbound.send(response_frame).await {
            warn!(error = %err, "failed to push response frame");
        }
    }

    async fn dispatch_request(
        &self,
        client_id: &str,
        request: Request,
        outbound: &Sender<ServerFrame>,
    ) -> DaemonResult<Response> {
        match request {
            Request::Ping => Ok(Response::Pong),
            Request::ListDir(req) => {
                let data = self.file_service.list_dir(&req)?;
                Ok(Response::ListDir(data))
            }
            Request::SearchStart(req) => {
                let search_id = self
                    .search_service
                    .start_search(client_id.to_string(), req, outbound.clone())
                    .await?;
                Ok(Response::SearchStarted(SearchStartedResponse { search_id }))
            }
            Request::SearchCancel(req) => {
                let cancelled = self.search_service.cancel_search(&req.search_id).await;
                Ok(Response::SearchCancelled(SearchCancelledResponse {
                    search_id: req.search_id,
                    cancelled,
                }))
            }
            Request::TerminalCreate(req) => {
                let data = self
                    .terminal_service
                    .create_session(client_id, req, outbound.clone())
                    .await?;
                Ok(Response::TerminalCreated(data))
            }
            Request::TerminalWrite(req) => {
                let data = self.terminal_service.write_input(req).await?;
                Ok(Response::TerminalWritten(data))
            }
            Request::TerminalResize(req) => {
                let data = self
                    .terminal_service
                    .resize(&req.session_id, req.cols, req.rows)
                    .await?;
                Ok(Response::TerminalResized(data))
            }
            Request::TerminalKill(req) => {
                let data = self
                    .terminal_service
                    .kill_session(&req.session_id, Some(outbound))
                    .await?;
                Ok(Response::TerminalKilled(data))
            }
        }
    }
}
