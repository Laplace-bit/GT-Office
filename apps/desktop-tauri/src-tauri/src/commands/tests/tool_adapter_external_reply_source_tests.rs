use super::*;

#[test]
fn append_external_reply_debug_source_keeps_original_text() {
    let original = "真实回复正文";
    let rendered = append_external_reply_debug_source(
        original,
        ExternalReplyDispatchPhase::Finalize,
        "session-log-structured",
        "high",
    );

    assert_eq!(rendered, original);
    assert!(!rendered.contains("[source="));
    assert!(!rendered.contains("confidence="));
    assert!(!rendered.contains("phase="));
}
