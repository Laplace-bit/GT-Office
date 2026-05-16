use super::{
    looks_incomplete, merge_human_reply_text, TerminalDebugHumanEntry, TerminalDebugHumanLogState,
    TERMINAL_DEBUG_HUMAN_LOG_LIMIT,
};

#[test]
fn human_log_merges_incremental_reply_growth() {
    let mut state = TerminalDebugHumanLogState::default();
    assert!(state.push_reply(1, "你好"));
    assert!(state.push_reply(2, "你好，世界"));

    assert_eq!(
        state.snapshot().entries,
        vec![TerminalDebugHumanEntry {
            at_ms: 2,
            text: "你好，世界".to_string(),
        }]
    );
}

#[test]
fn human_log_ignores_exact_duplicate_reply() {
    let mut state = TerminalDebugHumanLogState::default();
    assert!(state.push_reply(1, "稳定正文"));
    assert!(!state.push_reply(2, "稳定正文"));
    assert_eq!(state.snapshot().event_count, 1);
}

#[test]
fn human_log_trims_empty_input_and_can_clear() {
    let mut state = TerminalDebugHumanLogState::default();
    assert!(!state.push_reply(1, "   "));
    assert!(state.push_reply(2, "  正文  "));
    assert_eq!(state.snapshot().entries[0].text, "正文");

    state.clear();

    let snapshot = state.snapshot();
    assert_eq!(snapshot.event_count, 0);
    assert!(snapshot.entries.is_empty());
}

#[test]
fn human_log_adds_new_entry_when_previous_reply_is_complete() {
    let mut state = TerminalDebugHumanLogState::default();
    assert!(state.push_reply(1, "第一句。"));
    assert!(state.push_reply(2, "第二句"));

    let snapshot = state.snapshot();
    assert_eq!(snapshot.event_count, 2);
    assert_eq!(snapshot.entries[0].text, "第一句。");
    assert_eq!(snapshot.entries[1].text, "第二句");
}

#[test]
fn human_log_retains_limit_by_dropping_oldest_entries() {
    let mut state = TerminalDebugHumanLogState::default();

    for index in 0..(TERMINAL_DEBUG_HUMAN_LOG_LIMIT + 2) {
        assert!(state.push_reply(index as u64, &format!("entry {index}.")));
    }

    let snapshot = state.snapshot();
    assert_eq!(snapshot.event_count, TERMINAL_DEBUG_HUMAN_LOG_LIMIT);
    assert_eq!(snapshot.entries.first().unwrap().text, "entry 2.");
    assert_eq!(
        snapshot.entries.last().unwrap().text,
        format!("entry {}.", TERMINAL_DEBUG_HUMAN_LOG_LIMIT + 1)
    );
}

#[test]
fn merge_human_reply_text_handles_prefix_and_incomplete_cases() {
    assert_eq!(
        merge_human_reply_text("abc", "abcdef").as_deref(),
        Some("abcdef")
    );
    assert_eq!(
        merge_human_reply_text("abcdef", "abc").as_deref(),
        Some("abcdef")
    );
    assert_eq!(
        merge_human_reply_text("incomplete", "replacement").as_deref(),
        Some("replacement")
    );
    assert_eq!(merge_human_reply_text("complete.", "replacement"), None);
}

#[test]
fn looks_incomplete_respects_terminal_punctuation() {
    for complete in ["ok.", "ok!", "ok?", "好。", "好！", "好？", "done)"] {
        assert!(!looks_incomplete(complete), "{complete}");
    }
    assert!(looks_incomplete("still streaming"));
}
