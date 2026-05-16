use super::{daemon_addr, daemon_event_payload};
use gt_daemon::protocol::{
    Event, SearchBackpressureEvent, SearchCancelledEvent, SearchChunkEvent, SearchDoneEvent,
    SearchMatchItem,
};

#[test]
fn daemon_addr_defaults_to_localhost_and_rejects_invalid_env() {
    std::env::remove_var("VB_DAEMON_ADDR");
    assert_eq!(
        daemon_addr().expect("default addr").to_string(),
        "127.0.0.1:7878"
    );

    std::env::set_var("VB_DAEMON_ADDR", "127.0.0.1:9999");
    assert_eq!(
        daemon_addr().expect("configured addr").to_string(),
        "127.0.0.1:9999"
    );

    std::env::set_var("VB_DAEMON_ADDR", "not a socket");
    let error = daemon_addr().expect_err("invalid addr");
    assert!(error.starts_with("DAEMON_CONFIG_INVALID: invalid daemon address:"));

    std::env::remove_var("VB_DAEMON_ADDR");
}

#[test]
fn daemon_event_payload_maps_search_chunk_items() {
    let (event_name, payload) = daemon_event_payload(Event::SearchChunk(SearchChunkEvent {
        search_id: "search-1".to_string(),
        items: vec![SearchMatchItem {
            rel_path: "src/lib.rs".to_string(),
            line: 12,
            column: 4,
            text: "match text".to_string(),
        }],
    }))
    .expect("search chunk payload");

    assert_eq!(event_name, "daemon/search_chunk");
    assert_eq!(payload["searchId"], "search-1");
    assert_eq!(payload["items"][0]["path"], "src/lib.rs");
    assert_eq!(payload["items"][0]["line"], 12);
    assert_eq!(payload["items"][0]["column"], 4);
    assert_eq!(payload["items"][0]["preview"], "match text");
}

#[test]
fn daemon_event_payload_maps_search_lifecycle_events() {
    let (event_name, payload) =
        daemon_event_payload(Event::SearchBackpressure(SearchBackpressureEvent {
            search_id: "search-2".to_string(),
            dropped_chunks: 5,
        }))
        .expect("backpressure payload");
    assert_eq!(event_name, "daemon/search_backpressure");
    assert_eq!(payload["searchId"], "search-2");
    assert_eq!(payload["droppedChunks"], 5);

    let (event_name, payload) = daemon_event_payload(Event::SearchDone(SearchDoneEvent {
        search_id: "search-3".to_string(),
        scanned_files: 30,
        emitted_matches: 8,
        cancelled: false,
    }))
    .expect("done payload");
    assert_eq!(event_name, "daemon/search_done");
    assert_eq!(payload["searchId"], "search-3");
    assert_eq!(payload["scannedFiles"], 30);
    assert_eq!(payload["emittedMatches"], 8);
    assert_eq!(payload["cancelled"], false);

    let (event_name, payload) =
        daemon_event_payload(Event::SearchCancelled(SearchCancelledEvent {
            search_id: "search-4".to_string(),
        }))
        .expect("cancelled payload");
    assert_eq!(event_name, "daemon/search_cancelled");
    assert_eq!(payload["searchId"], "search-4");
}
