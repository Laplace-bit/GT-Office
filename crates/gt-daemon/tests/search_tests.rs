use std::sync::{atomic::AtomicBool, Arc};
use tokio::sync::mpsc;
use gt_daemon::protocol::{Event, SearchStartRequest, ServerFrame, ServerPayload};
use gt_daemon::search::run_search;

fn collect_events(root: &std::path::Path, query: &str) -> Vec<Event> {
    let (tx, mut rx) = mpsc::channel::<ServerFrame>(128);
    let request = SearchStartRequest {
        search_id: "search_test".to_string(),
        workspace_root: root.to_string_lossy().to_string(),
        query: query.to_string(),
        glob: None,
        case_sensitive: Some(false),
        chunk_size: Some(64),
        max_results: Some(128),
    };

    run_search(request, Arc::new(AtomicBool::new(false)), tx).expect("search should succeed");

    let mut events = Vec::new();
    while let Some(frame) = rx.blocking_recv() {
        if let ServerPayload::Event(event) = frame.payload {
            events.push(event);
        }
    }
    events
}

#[test]
fn search_treats_special_chars_as_fixed_string() {
    let temp = tempfile::tempdir().expect("tempdir");
    std::fs::write(temp.path().join("sample.txt"), "hello (abc) world").expect("write");

    let events = collect_events(temp.path(), "(abc)");
    let matched = events.into_iter().any(|event| match event {
        Event::SearchChunk(chunk) => chunk
            .items
            .iter()
            .any(|item| item.rel_path == "sample.txt" && item.text.contains("(abc)")),
        _ => false,
    });
    assert!(
        matched,
        "fixed-string query should match literal special chars"
    );
}

#[test]
fn search_ignores_hidden_files_by_default() {
    let temp = tempfile::tempdir().expect("tempdir");
    std::fs::write(temp.path().join("visible.txt"), "token").expect("write visible");
    std::fs::write(temp.path().join(".hidden.txt"), "token").expect("write hidden");

    let events = collect_events(temp.path(), "token");
    let mut paths = Vec::new();
    for event in events {
        if let Event::SearchChunk(chunk) = event {
            for item in chunk.items {
                paths.push(item.rel_path);
            }
        }
    }

    assert!(paths.iter().any(|path| path == "visible.txt"));
    assert!(
        paths.iter().all(|path| !path.starts_with('.')),
        "hidden files should be filtered out"
    );
}
