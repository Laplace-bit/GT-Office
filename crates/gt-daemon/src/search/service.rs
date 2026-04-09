use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder};
use ignore::{overrides::OverrideBuilder, WalkBuilder};
use tokio::{
    sync::{
        mpsc::{error::TrySendError, Sender},
        Mutex,
    },
    task::JoinHandle,
};
use tracing::{debug, warn};

use crate::{
    error::{DaemonError, DaemonResult},
    protocol::{
        Event, SearchBackpressureEvent, SearchCancelledEvent, SearchDoneEvent, SearchMatchItem,
        SearchStartRequest, ServerFrame, ServerPayload,
    },
};

const DEFAULT_CHUNK_SIZE: usize = 64;
const DEFAULT_MAX_RESULTS: usize = 10_000;
const INITIAL_CHUNK_SIZE: usize = 1;

#[derive(Debug)]
struct SearchTaskHandle {
    cancel: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

#[derive(Debug, Default, Clone)]
pub struct SearchService {
    tasks: Arc<Mutex<HashMap<String, SearchTaskHandle>>>,
    active_by_client: Arc<Mutex<HashMap<String, String>>>,
}

impl SearchService {
    pub async fn start_search(
        &self,
        client_id: String,
        req: SearchStartRequest,
        outbound: Sender<ServerFrame>,
    ) -> DaemonResult<String> {
        let search_id = req.search_id.trim().to_string();
        if search_id.is_empty() {
            return Err(DaemonError::Protocol(
                "search_id cannot be empty".to_string(),
            ));
        }
        if req.query.trim().is_empty() {
            return Err(DaemonError::Protocol("query cannot be empty".to_string()));
        }

        self.prune_finished().await;

        if let Some(previous) = self
            .active_by_client
            .lock()
            .await
            .insert(client_id, search_id.clone())
        {
            let _ = self.cancel_search(&previous).await;
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_for_task = cancel.clone();
        let outbound_for_task = outbound.clone();
        let search_id_for_task = search_id.clone();

        let task = tokio::task::spawn_blocking(move || {
            if let Err(err) = run_search(req, cancel_for_task, outbound_for_task) {
                warn!(search_id = %search_id_for_task, error = %err, "search task failed");
            }
        });

        self.tasks
            .lock()
            .await
            .insert(search_id.clone(), SearchTaskHandle { cancel, task });

        Ok(search_id)
    }

    pub async fn cancel_search(&self, search_id: &str) -> bool {
        self.prune_finished().await;
        if let Some(handle) = self.tasks.lock().await.remove(search_id) {
            handle.cancel.store(true, Ordering::Relaxed);
            handle.task.abort();
            true
        } else {
            false
        }
    }

    pub async fn cancel_for_client(&self, client_id: &str) {
        if let Some(search_id) = self.active_by_client.lock().await.remove(client_id) {
            let _ = self.cancel_search(&search_id).await;
        }
    }

    async fn prune_finished(&self) {
        let mut tasks = self.tasks.lock().await;
        tasks.retain(|_, handle| !handle.task.is_finished());
    }
}

pub fn run_search(
    req: SearchStartRequest,
    cancel: Arc<AtomicBool>,
    outbound: Sender<ServerFrame>,
) -> DaemonResult<()> {
    let workspace_root = canonicalize_dir(Path::new(&req.workspace_root))?;
    let chunk_size = req.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE).max(1);
    let max_results = req.max_results.unwrap_or(DEFAULT_MAX_RESULTS).max(1);
    let case_sensitive = req.case_sensitive.unwrap_or(false);
    let search_id = req.search_id;
    let query = req.query;

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .fixed_strings(true)
        .line_terminator(Some(b'\n'))
        .build(&query)
        .map_err(|e| DaemonError::Search(format!("invalid query '{}': {e}", query)))?;

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .build();

    let mut walk_builder = WalkBuilder::new(&workspace_root);
    walk_builder
        .standard_filters(true)
        .hidden(true)
        .git_ignore(true);

    if let Some(glob) = req.glob.as_deref() {
        let mut overrides = OverrideBuilder::new(&workspace_root);
        overrides
            .add(glob)
            .map_err(|e| DaemonError::Search(format!("invalid glob '{}': {e}", glob)))?;
        let overrides = overrides
            .build()
            .map_err(|e| DaemonError::Search(format!("invalid glob override: {e}")))?;
        walk_builder.overrides(overrides);
    }

    let mut scanned_files: u64 = 0;
    let mut emitted_matches: u64 = 0;
    let mut dropped_chunks: u64 = 0;
    let mut chunk: Vec<SearchMatchItem> = Vec::with_capacity(chunk_size);
    let mut first_chunk_flushed = false;

    for dent in walk_builder.build() {
        if cancel.load(Ordering::Relaxed) {
            emit_event(
                &outbound,
                Event::SearchCancelled(SearchCancelledEvent {
                    search_id: search_id.clone(),
                }),
            );
            emit_event(
                &outbound,
                Event::SearchDone(SearchDoneEvent {
                    search_id,
                    scanned_files,
                    emitted_matches,
                    cancelled: true,
                }),
            );
            return Ok(());
        }

        let dent = match dent {
            Ok(dent) => dent,
            Err(err) => {
                debug!(error = %err, "skip walk entry error");
                continue;
            }
        };

        let is_file = dent.file_type().map(|ft| ft.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }

        let path = dent.path().to_path_buf();
        scanned_files += 1;
        let rel_path = to_rel_path(&workspace_root, &path);

        let mut hit_limit = false;
        let mut sink = UTF8(|line_no: u64, line: &str| {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            if emitted_matches >= max_results as u64 {
                hit_limit = true;
                return Ok(false);
            }

            let column = if case_sensitive {
                line.find(&query).unwrap_or(0) as u64
            } else {
                0
            };

            emitted_matches += 1;
            chunk.push(SearchMatchItem {
                rel_path: rel_path.clone(),
                line: line_no,
                column,
                text: line.trim_end().to_string(),
            });

            let flush_threshold = if first_chunk_flushed {
                chunk_size
            } else {
                INITIAL_CHUNK_SIZE.min(chunk_size).max(1)
            };
            if chunk.len() >= flush_threshold {
                dropped_chunks += try_emit_chunk(&outbound, &search_id, &mut chunk);
                first_chunk_flushed = true;
            }

            Ok(emitted_matches < max_results as u64)
        });

        if let Err(err) = searcher.search_path(&matcher, &path, &mut sink) {
            debug!(path = %path.display(), error = %err, "skip search error");
            continue;
        }

        if hit_limit {
            break;
        }
    }

    dropped_chunks += try_emit_chunk(&outbound, &search_id, &mut chunk);

    if dropped_chunks > 0 {
        emit_event(
            &outbound,
            Event::SearchBackpressure(SearchBackpressureEvent {
                search_id: search_id.clone(),
                dropped_chunks,
            }),
        );
    }

    emit_event(
        &outbound,
        Event::SearchDone(SearchDoneEvent {
            search_id,
            scanned_files,
            emitted_matches,
            cancelled: false,
        }),
    );

    Ok(())
}

fn try_emit_chunk(
    outbound: &Sender<ServerFrame>,
    search_id: &str,
    chunk: &mut Vec<SearchMatchItem>,
) -> u64 {
    if chunk.is_empty() {
        return 0;
    }

    let items = std::mem::take(chunk);
    let frame = ServerFrame {
        request_id: None,
        payload: ServerPayload::Event(Event::SearchChunk(crate::protocol::SearchChunkEvent {
            search_id: search_id.to_string(),
            items,
        })),
    };

    match outbound.try_send(frame) {
        Ok(_) => 0,
        Err(TrySendError::Full(_)) => 1,
        Err(TrySendError::Closed(_)) => 1,
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

fn to_rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
