use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientFrame {
    pub id: u64,
    pub request: Request,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerFrame {
    pub request_id: Option<u64>,
    pub payload: ServerPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerPayload {
    Response(ResponseEnvelope),
    Event(Event),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseEnvelope {
    pub ok: bool,
    pub data: Option<Response>,
    pub error: Option<ErrorPayload>,
}

impl ResponseEnvelope {
    pub fn ok(data: Response) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(ErrorPayload {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Request {
    Ping,
    ListDir(ListDirRequest),
    SearchStart(SearchStartRequest),
    SearchCancel(SearchCancelRequest),
    TerminalCreate(TerminalCreateRequest),
    TerminalWrite(TerminalWriteRequest),
    TerminalResize(TerminalResizeRequest),
    TerminalKill(TerminalKillRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Response {
    Pong,
    ListDir(ListDirResponse),
    SearchStarted(SearchStartedResponse),
    SearchCancelled(SearchCancelledResponse),
    TerminalCreated(TerminalCreatedResponse),
    TerminalWritten(TerminalWrittenResponse),
    TerminalResized(TerminalResizedResponse),
    TerminalKilled(TerminalKilledResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Event {
    SearchChunk(SearchChunkEvent),
    SearchBackpressure(SearchBackpressureEvent),
    SearchDone(SearchDoneEvent),
    SearchCancelled(SearchCancelledEvent),
    TerminalOutput(TerminalOutputEvent),
    TerminalState(TerminalStateEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirRequest {
    pub workspace_root: String,
    pub rel_path: String,
    pub cursor: Option<usize>,
    pub limit: Option<usize>,
    pub include_hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntryItem {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirResponse {
    pub rel_path: String,
    pub entries: Vec<DirEntryItem>,
    pub next_cursor: Option<usize>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchStartRequest {
    pub search_id: String,
    pub workspace_root: String,
    pub query: String,
    pub glob: Option<String>,
    pub case_sensitive: Option<bool>,
    pub chunk_size: Option<usize>,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchCancelRequest {
    pub search_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchStartedResponse {
    pub search_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchCancelledResponse {
    pub search_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatchItem {
    pub rel_path: String,
    pub line: u64,
    pub column: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchChunkEvent {
    pub search_id: String,
    pub items: Vec<SearchMatchItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchBackpressureEvent {
    pub search_id: String,
    pub dropped_chunks: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDoneEvent {
    pub search_id: String,
    pub scanned_files: u64,
    pub emitted_matches: u64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchCancelledEvent {
    pub search_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalCreateRequest {
    pub workspace_root: String,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub env: Option<Vec<(String, String)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub input: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalKillRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalCreatedResponse {
    pub session_id: String,
    pub resolved_cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalWrittenResponse {
    pub session_id: String,
    pub accepted_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResizedResponse {
    pub session_id: String,
    pub resized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalKilledResponse {
    pub session_id: String,
    pub killed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub seq: u64,
    pub chunk: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalStateEvent {
    pub session_id: String,
    pub state: String,
    pub reason: Option<String>,
}
