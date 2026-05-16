use super::session_log_finalize_delta;

#[test]
fn session_log_finalize_delta_returns_only_unseen_tail() {
    let final_text = "第一段说明\n第二段说明\n最终结论";
    let preview_text = "第一段说明\n第二段说明";
    assert_eq!(
        session_log_finalize_delta(final_text, preview_text).as_deref(),
        Some("最终结论")
    );
}

#[test]
fn session_log_finalize_delta_suppresses_duplicate_finalize() {
    let final_text = "已经发送过的完整正文";
    let preview_text = "已经发送过的完整正文";
    assert_eq!(session_log_finalize_delta(final_text, preview_text), None);
}
