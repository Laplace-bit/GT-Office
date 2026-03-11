use super::{
    extract_rendered_interaction_prompt, extract_rendered_reply_text, normalize_carriage_returns,
    normalize_reply_text, normalize_terminal_text, sanitize_terminal_chunk,
    should_skip_cli_prompt_line, should_skip_external_reply_line, should_skip_log_prefix_line,
    should_skip_runtime_noise_line, should_skip_startup_banner_line, snapshot_has_ready_prompt,
    AppState, ExternalReplyDispatchPhase, ExternalReplyRelayTarget, RenderedScreenSnapshot,
    RenderedScreenSnapshotRow,
};
use vb_task::AgentToolKind;

fn now_ms_for_test(value: u64) -> u64 {
    value
}

#[test]
fn sanitize_terminal_chunk_strips_ansi() {
    let text = sanitize_terminal_chunk(b"\x1b[31mhello\x1b[0m\r\nworld");
    assert_eq!(text, "hello\nworld");
}

#[test]
fn normalize_terminal_text_handles_cr_correctly() {
    // CR handling is now done in normalize_carriage_returns
    // normalize_terminal_text only handles backspace and control chars
    let text = normalize_terminal_text("line1\nline2\nline3");
    assert_eq!(text, "line1\nline2\nline3");

    // Test backspace handling
    let text2 = normalize_terminal_text("hello\u{8}\u{8}p");
    assert_eq!(text2, "help");
}

#[test]
fn normalize_carriage_returns_handles_cr_correctly() {
    // \r\n should be treated as standard line ending (just \n)
    let text = normalize_carriage_returns("line1\r\nline2\r\nline3");
    assert_eq!(text, "line1\nline2\nline3");

    // Lone \r clears the current line
    let text2 = normalize_carriage_returns("overwrite\rreplace");
    assert_eq!(text2, "replace");

    // Multiple overwrites: only the last one survives
    let text3 = normalize_carriage_returns("first\rsecond\rthird");
    assert_eq!(text3, "third");

    // \r after newline clears only the current line
    let text4 = normalize_carriage_returns("line1\noverwrite\rreplace");
    assert_eq!(text4, "line1\nreplace");
}

#[test]
fn sanitize_terminal_chunk_handles_crlf_correctly() {
    // \r\n should produce a single \n, not \n\n
    let text = sanitize_terminal_chunk(b"line1\r\nline2\r\nline3");
    assert_eq!(text, "line1\nline2\nline3");
    // Lone \r clears the current line (terminal overwrite behavior)
    // Note: strip_ansi_escapes may preserve \r, so we rely on normalize_terminal_text
    let text2 = sanitize_terminal_chunk(b"overwrite\rreplace");
    assert_eq!(text2, "replace");
    // Multiple overwrites: only the last one survives
    let text3 = sanitize_terminal_chunk(b"first\rsecond\rthird");
    assert_eq!(text3, "third");
    // \r after newline clears only the current line
    let text4 = sanitize_terminal_chunk(b"line1\noverwrite\rreplace");
    assert_eq!(text4, "line1\nreplace");
}

#[test]
fn sanitize_terminal_chunk_handles_progress_spinner_overwrites() {
    // Simulate CLI tool progress spinner that uses \r to overwrite
    // This is what causes the fragmented output like "or", "rk", "ki", "in", "ng"
    let input = b"Working\rWorking.\rWorking..\rWorking...\rDone!";
    let text = sanitize_terminal_chunk(input);
    assert_eq!(text, "Done!");

    // Real-world scenario: spinner followed by newline and content
    // Loading -> Loading. -> Loading.. -> \r\n (standard line ending, keeps Loading..)
    let input2 = b"Loading\rLoading.\rLoading..\r\nActual content here";
    let text2 = sanitize_terminal_chunk(input2);
    // \r\n is treated as standard line ending, so "Loading.." is preserved
    assert_eq!(text2, "Loading..\nActual content here");

    // If we want to clear before newline, need an extra \r
    let input3 = b"Loading\rLoading.\rLoading..\r\rActual content here";
    let text3 = sanitize_terminal_chunk(input3);
    assert_eq!(text3, "Actual content here");
}

#[test]
fn sanitize_terminal_chunk_strips_dcs_and_osc() {
    // OSC sequence: \x1b]0;title\x07
    let text = sanitize_terminal_chunk(b"\x1b]0;window title\x07hello");
    assert_eq!(text, "hello");
    // Other escape sequences should be stripped by the crate
    let text2 = sanitize_terminal_chunk(b"\x1b[?25lhidden\x1b[?25h");
    assert_eq!(text2, "hidden");
}

#[test]
fn normalize_reply_text_collapses_blank_lines() {
    let normalized = normalize_reply_text("\n\nhello\n\n\nworld\n\n", None);
    assert_eq!(normalized, "hello\n\nworld");
}

#[test]
fn normalize_reply_text_skips_vb_task_assignment_lines() {
    let normalized = normalize_reply_text(
        "echo '[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md'\n\
[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md\n\
agent output line",
        None,
    );
    assert_eq!(normalized, "agent output line");
}

#[test]
fn should_skip_external_reply_line_only_for_vb_task_markers() {
    assert!(should_skip_external_reply_line(
        "echo '[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md'"
    ));
    assert!(should_skip_external_reply_line(
        "[vb-task] assigned task_abc from .gtoffice/tasks/task_abc/task.md"
    ));
    assert!(!should_skip_external_reply_line("plain agent response"));
}

#[test]
fn normalize_reply_text_suppresses_injected_input_echo() {
    let only_echo = normalize_reply_text("hello world", Some("hello world"));
    assert_eq!(only_echo, "");

    let with_tail = normalize_reply_text("hello world\nresult line", Some("hello world"));
    assert_eq!(with_tail, "result line");

    let with_prompt_prefix =
        normalize_reply_text("> hello world\nagent response", Some("hello world"));
    assert_eq!(with_prompt_prefix, "agent response");
}

#[test]
fn normalize_reply_text_skips_runtime_noise_lines() {
    let normalized = normalize_reply_text(
        "› hi\n\
• Working (0s • esc to interrupt)\n\
› Implement {feature}\n\
gpt-5.3-codex · gpt-5.3-codex medium · /mnt/c/personal/vbCode · main · 100% left\n\
◦\n\
Wo\n\
• 哈哈哈 😄\n\
  在的，你想先从哪个任务开始？",
        Some("hi"),
    );
    assert_eq!(normalized, "• 哈哈哈 😄\n在的，你想先从哪个任务开始？");
}

#[test]
fn should_skip_runtime_noise_line_filters_status_and_spinner() {
    assert!(should_skip_runtime_noise_line(
        "• Working (0s • esc to interrupt)"
    ));
    assert!(should_skip_runtime_noise_line(
        "gpt-5.3-codex · gpt-5.3-codex medium · /tmp · 100% left"
    ));
    assert!(should_skip_runtime_noise_line("› Implement {feature}"));
    assert!(should_skip_runtime_noise_line("Wo"));
    assert!(should_skip_runtime_noise_line("100%"));
    assert!(should_skip_runtime_noise_line("Wng"));
    assert!(should_skip_runtime_noise_line("Wog"));
    assert!(!should_skip_runtime_noise_line("• 哈哈哈 😄"));
    // Short legitimate content should NOT be filtered (without punctuation)
    assert!(!should_skip_runtime_noise_line("OK"));
    assert!(!should_skip_runtime_noise_line("Done"));
    assert!(!should_skip_runtime_noise_line("Yes"));
    assert!(!should_skip_runtime_noise_line("是"));
    // But status indicators with punctuation should be filtered
    assert!(should_skip_runtime_noise_line("Ready."));
    assert!(should_skip_runtime_noise_line("Done."));
    assert!(should_skip_runtime_noise_line("OK."));
}

#[test]
fn tui_status_bar_detection_is_tool_agnostic() {
    use super::{is_tui_padded_fragment, is_tui_status_bar_line};

    // Codex CLI status bar
    assert!(is_tui_status_bar_line(
        "gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses · 100%…"
    ));
    // Codex CLI with percentage and longer path
    assert!(is_tui_status_bar_line(
            "gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100%…"
        ));
    // Claude Code style (hypothetical)
    assert!(is_tui_status_bar_line(
        "claude-sonnet-4 · high · /home/user/project · 95% left"
    ));
    // Gemini CLI style (hypothetical)
    assert!(is_tui_status_bar_line(
        "gemini-2.5-pro · medium · ~/workspace · 42% left"
    ));
    // Windows path
    assert!(is_tui_status_bar_line(
        "model-name · profile · C:\\Users\\dev\\project · 80%"
    ));
    // Legitimate content with middle-dots should NOT be filtered
    assert!(!is_tui_status_bar_line("这是一个 · 正常的 · 句子"));
    assert!(!is_tui_status_bar_line("item1 · item2"));

    // TUI-padded fragment detection
    assert!(is_tui_padded_fragment(
        "                                                                风吹过旧街角"
    ));
    assert!(is_tui_padded_fragment(
        "                              你把沉默轻轻放好"
    ));
    // Normal indented content should NOT be filtered (< 20 spaces)
    assert!(!is_tui_padded_fragment("    normal indent"));
    assert!(!is_tui_padded_fragment("        code block"));
}

#[test]
fn normalize_reply_text_strips_codex_cli_streaming_noise() {
    // Real-world scenario: Codex CLI TUI redraws status bar between content chunks
    let raw_output = "\
• 《把夜晚点亮》\n\
\n\
  主歌1\n\
\n\
  gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100%…\n\
\n\
                                                                风吹过旧街角\n\
\n\
  gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100%…\n\
\n\
                                                                你把沉默轻轻放好\n\
\n\
  gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100%…\n\
\n\
                                                                我在灯下等一秒\n\
\n\
  gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100%…\n\
\n\
                                                                等一句\"别走太早\"";
    let normalized = normalize_reply_text(raw_output, None);
    // Should contain the poem content without status bar lines
    assert!(normalized.contains("《把夜晚点亮》"));
    assert!(normalized.contains("主歌1"));
    assert!(!normalized.contains("gpt-5.3-codex"));
    assert!(!normalized.contains("100%…"));
    // The TUI-padded content lines should be PRESERVED (real poem content)
    assert!(normalized.contains("风吹过旧街角"));
    assert!(normalized.contains("你把沉默轻轻放好"));
    assert!(normalized.contains("我在灯下等一秒"));
    assert!(normalized.contains("等一句\"别走太早\""));
}

#[test]
fn should_skip_cli_prompt_lines() {
    assert!(should_skip_cli_prompt_line(
        "› Find and fix a bug in @filename"
    ));
    assert!(should_skip_cli_prompt_line("❯ hi"));
    assert!(should_skip_cli_prompt_line("$ ls"));
    assert!(!should_skip_cli_prompt_line("• 我在，直接说你想做的事。"));
}

#[test]
fn normalize_reply_text_extracts_last_assistant_block() {
    let normalized = normalize_reply_text(
        "› Write tests for @filename\n\
› 👻\n\
› Write tests for @filename\n\
Wog\n\
• 我在，直接说你想做的事。\n\
› Write tests for @filename\n\
wlen\n\
› Write tests for @filename",
        Some("Write tests for @filename"),
    );
    // wlen inside the assistant block is a known spinner token → skipped by line-level filter
    // Interleaved prompts (› ...) with ASCII content are skipped
    assert_eq!(normalized, "• 我在，直接说你想做的事。");
}

#[test]
fn normalize_reply_text_keeps_multiline_block_with_interleaved_prompts() {
    let normalized = normalize_reply_text(
        "• 在快与慢之间，找回生活的节奏\n\
\n\
› hi\n\
  城市里的每一天都很快。\n\
  但真正重要的东西，往往生长得很慢。\n\
› Write tests for @filename\n\
  人生不是短跑，而是一场漫长而值得认真走完的旅程。",
        Some("hi"),
    );
    assert_eq!(
            normalized,
            "• 在快与慢之间，找回生活的节奏\n\n城市里的每一天都很快。\n但真正重要的东西，往往生长得很慢。\n人生不是短跑，而是一场漫长而值得认真走完的旅程。"
        );
}

#[test]
fn normalize_reply_text_preserves_short_content_lines() {
    // Short legitimate content should never be swallowed
    let normalized = normalize_reply_text("OK\nDone\nYes", None);
    assert_eq!(normalized, "OK\nDone\nYes");
}

#[test]
fn normalize_reply_text_does_not_eat_dollar_prefixed_content() {
    // Lines that start with $ but contain non-ASCII or meaningful content
    let normalized = normalize_reply_text("$ 这是一条重要信息\nanother line", None);
    assert_eq!(normalized, "$ 这是一条重要信息\nanother line");
}

#[test]
fn external_reply_flush_is_single_shot_after_idle() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_1".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m1".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-1".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s1", target, now_ms_for_test(1_000))
        .expect("bind session");
    state
        .append_external_reply_chunk("s1", b"hello", now_ms_for_test(1_100))
        .expect("append chunk");

    let none_ready = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(2_000),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");
    assert!(none_ready.is_empty());

    let ready = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(2_200),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].phase, ExternalReplyDispatchPhase::Finalize);
    assert_eq!(ready[0].text, "hello");
    state
        .mark_external_reply_finalize_delivered("s1")
        .expect("mark finalize delivered");

    let already_taken = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(3_500),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");
    assert!(already_taken.is_empty());
}

#[test]
fn external_reply_binding_kept_when_no_output_yet() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_2".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m2".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-2".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s2", target, now_ms_for_test(1_000))
        .expect("bind session");

    let none_ready = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(4_000),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");
    assert!(none_ready.is_empty());

    state
        .append_external_reply_chunk("s2", b"later reply", now_ms_for_test(4_100))
        .expect("append chunk");
    let ready = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(5_200),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].phase, ExternalReplyDispatchPhase::Finalize);
    assert_eq!(ready[0].text, "later reply");
}

#[test]
fn external_reply_finalize_candidate_retries_until_marked_delivered() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_finalize_retry".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_finalize_retry".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-finalize-retry".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_finalize_retry", target, now_ms_for_test(1_000))
        .expect("bind session");
    state
        .append_external_reply_chunk(
            "s_finalize_retry",
            b"retryable final reply",
            now_ms_for_test(1_100),
        )
        .expect("append chunk");
    state
        .mark_external_reply_session_ended("s_finalize_retry", now_ms_for_test(1_200))
        .expect("mark ended");

    let first_finalize = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_200), 500, 10_000, 200, 10)
        .expect("take first finalize");
    assert_eq!(first_finalize.len(), 1);
    assert_eq!(first_finalize[0].phase, ExternalReplyDispatchPhase::Finalize);

    let retried_finalize = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_500), 500, 10_000, 200, 10)
        .expect("take retried finalize");
    assert_eq!(retried_finalize.len(), 1);
    assert_eq!(retried_finalize[0].phase, ExternalReplyDispatchPhase::Finalize);
    assert_eq!(retried_finalize[0].text, "retryable final reply");

    state
        .mark_external_reply_finalize_delivered("s_finalize_retry")
        .expect("mark delivered");
    let drained = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_800), 500, 10_000, 200, 10)
        .expect("take after delivered");
    assert!(drained.is_empty());
}

#[test]
fn external_reply_preview_failure_resets_throttle_for_retry() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_preview_retry".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_preview_retry".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-preview-retry".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_preview_retry", target, now_ms_for_test(1_000))
        .expect("bind session");
    state
        .append_external_reply_chunk(
            "s_preview_retry",
            b"preview retry text long enough",
            now_ms_for_test(1_100),
        )
        .expect("append chunk");

    let first_preview = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_200), 5_000, 20_000, 200, 10)
        .expect("take first preview");
    assert_eq!(first_preview.len(), 1);
    assert_eq!(first_preview[0].phase, ExternalReplyDispatchPhase::Preview);

    state
        .mark_external_reply_preview_delivery_failed("s_preview_retry", &first_preview[0].text)
        .expect("mark preview failed");

    let retried_preview = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_500), 5_000, 20_000, 200, 10)
        .expect("take retried preview");
    assert_eq!(retried_preview.len(), 1);
    assert_eq!(retried_preview[0].phase, ExternalReplyDispatchPhase::Preview);
    assert_eq!(retried_preview[0].text, first_preview[0].text);
}

#[test]
fn external_reply_dispatch_emits_preview_then_finalize() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_3".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m3".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-3".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s3", target, now_ms_for_test(1_000))
        .expect("bind session");
    state
        .append_external_reply_chunk(
            "s3",
            b"this is a long enough preview text",
            now_ms_for_test(1_100),
        )
        .expect("append chunk");

    let preview = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_200), 5_000, 20_000, 200, 10)
        .expect("take preview candidates");
    assert_eq!(preview.len(), 1);
    assert_eq!(preview[0].phase, ExternalReplyDispatchPhase::Preview);
    assert!(preview[0].preview_message_id.is_none());

    state
        .set_external_reply_preview_message_id("s3", "msg_telegram_preview")
        .expect("set preview message");
    state
        .mark_external_reply_session_ended("s3", now_ms_for_test(2_500))
        .expect("mark ended");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_700), 5_000, 20_000, 200, 10)
        .expect("take final candidates");
    assert_eq!(final_candidates.len(), 1);
    assert_eq!(
        final_candidates[0].phase,
        ExternalReplyDispatchPhase::Finalize
    );
    assert_eq!(
        final_candidates[0].preview_message_id.as_deref(),
        Some("msg_telegram_preview")
    );
}

#[test]
fn should_skip_startup_banner_line_detects_version_info() {
    assert!(should_skip_startup_banner_line("v1.0.0"));
    assert!(should_skip_startup_banner_line("v2.3.4-beta"));
    assert!(should_skip_startup_banner_line("version 1.2.3"));
    assert!(should_skip_startup_banner_line("ver 3.0"));
    assert!(!should_skip_startup_banner_line("value is important"));
}

#[test]
fn should_skip_startup_banner_line_detects_initialization() {
    assert!(should_skip_startup_banner_line("Initializing..."));
    assert!(should_skip_startup_banner_line("Loading model..."));
    assert!(should_skip_startup_banner_line("Starting up"));
    assert!(!should_skip_startup_banner_line("Starting task execution"));
}

#[test]
fn should_skip_startup_banner_line_detects_connection_status() {
    assert!(should_skip_startup_banner_line("Connected to API"));
    assert!(should_skip_startup_banner_line("Authenticating..."));
    assert!(should_skip_startup_banner_line("Connecting to server"));
    assert!(should_skip_startup_banner_line(
        "Authenticated successfully"
    ));
}

#[test]
fn should_skip_startup_banner_line_detects_config_messages() {
    assert!(should_skip_startup_banner_line("Configuration loaded"));
    assert!(should_skip_startup_banner_line("Settings applied"));
    assert!(!should_skip_startup_banner_line(
        "Configuration error: invalid value"
    ));
}

#[test]
fn should_skip_startup_banner_line_detects_welcome_messages() {
    assert!(should_skip_startup_banner_line("Welcome to Claude Code"));
    assert!(should_skip_startup_banner_line("Welcome!"));
    assert!(should_skip_startup_banner_line("Ready."));
    assert!(should_skip_startup_banner_line("Initialized."));
}

#[test]
fn should_skip_log_prefix_line_detects_log_levels() {
    assert!(should_skip_log_prefix_line("[INFO] Starting process"));
    assert!(should_skip_log_prefix_line("[DEBUG] Variable value: 42"));
    assert!(should_skip_log_prefix_line("[WARN] Deprecated API used"));
    assert!(should_skip_log_prefix_line("[ERROR] Connection failed"));
    assert!(should_skip_log_prefix_line("[STATUS] Processing..."));
    assert!(!should_skip_log_prefix_line("This is [INFO] in the middle"));
}

#[test]
fn should_skip_log_prefix_line_detects_timestamps() {
    assert!(should_skip_log_prefix_line("[2024-03-04 10:30:45] Message"));
    assert!(should_skip_log_prefix_line("[10:30:45] Event occurred"));
    assert!(should_skip_log_prefix_line("[2024-03-04] Daily log"));
    assert!(!should_skip_log_prefix_line(
        "[IMPORTANT] This is not a timestamp"
    ));
}

#[test]
fn should_skip_runtime_noise_line_detects_status_words() {
    assert!(should_skip_runtime_noise_line("ready."));
    assert!(should_skip_runtime_noise_line("Done."));
    assert!(should_skip_runtime_noise_line("Complete."));
    assert!(should_skip_runtime_noise_line("OK."));
    assert!(!should_skip_runtime_noise_line(
        "Ready to process your request"
    ));
    assert!(!should_skip_runtime_noise_line("OK"));
    assert!(!should_skip_runtime_noise_line("Done"));
}

#[test]
fn should_skip_runtime_noise_line_detects_help_hints() {
    assert!(should_skip_runtime_noise_line(
        "Type 'help' for more information"
    ));
    assert!(should_skip_runtime_noise_line("Press Enter to continue"));
    assert!(should_skip_runtime_noise_line("Press Ctrl+C to exit"));
    assert!(!should_skip_runtime_noise_line("Type your message here"));
}

#[test]
fn normalize_reply_text_filters_startup_messages() {
    let input = "v1.0.0\n\
                     Initializing...\n\
                     Loading model...\n\
                     Connected to API\n\
                     Ready.\n\
                     This is the actual response";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "This is the actual response");
}

#[test]
fn normalize_reply_text_filters_log_prefixes() {
    let input = "[INFO] Starting process\n\
                     [DEBUG] Loading configuration\n\
                     [2024-03-04 10:30:45] Event occurred\n\
                     Actual response content\n\
                     [STATUS] Processing complete";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "Actual response content");
}

#[test]
fn normalize_reply_text_filters_mixed_noise() {
    let input = "v2.0.0\n\
                     [INFO] Initializing\n\
                     Loading...\n\
                     Ready.\n\
                     • Here is my response\n\
                     [DEBUG] Internal state\n\
                     This is the content\n\
                     Done.";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "• Here is my response\nThis is the content");
}

#[test]
fn normalize_reply_text_preserves_legitimate_content() {
    // Ensure we don't over-filter legitimate content
    let input = "The version is important\n\
                     Ready to help you\n\
                     Configuration details: value=42";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(
        normalized,
        "The version is important\nReady to help you\nConfiguration details: value=42"
    );
}

#[test]
fn normalize_reply_text_filters_menu_items_and_status_bars() {
    let input = "• 嗨，在呢。要我帮你处理什么？

                                              › Summarize recent commits                                                                    gpt-5.3-codex · gpt-5.3-codex xhigh · /mnt/…

                                                gpt-5.3-codex · gpt-5.3-codex xhigh · /mnt/…";

    let result = normalize_reply_text(input, None);

    // Should only keep the actual message, filtering out menu items and status bars
    assert_eq!(result, "• 嗨，在呢。要我帮你处理什么？");
}

// Phase 1: VT100 Parser Tests

#[test]
fn vt100_parser_handles_cross_chunk_cr_overwrite() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_vt100_1".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_vt100_1".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-vt100".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_vt100_1", target, now_ms_for_test(1_000))
        .expect("bind session");

    // Feed "Working..." in first chunk
    state
        .append_external_reply_chunk("s_vt100_1", b"Working...", now_ms_for_test(1_100))
        .expect("append chunk 1");

    // Feed "\r\x1b[KDone!" in second chunk - CR + clear line + new text
    // This is what real TUI frameworks do
    state
        .append_external_reply_chunk("s_vt100_1", b"\r\x1b[KDone!", now_ms_for_test(1_200))
        .expect("append chunk 2");

    state
        .mark_external_reply_session_ended("s_vt100_1", now_ms_for_test(1_300))
        .expect("mark ended");

    let candidates = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(1_400),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].text, "Done!");
}

#[test]
fn vt100_parser_handles_tui_status_bar_redraw() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_vt100_2".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_vt100_2".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-vt100".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_vt100_2", target, now_ms_for_test(1_000))
        .expect("bind session");

    // Simulate cursor-positioned status bar overwrites
    // First write content
    state
        .append_external_reply_chunk(
            "s_vt100_2",
            "• Response line 1\n".as_bytes(),
            now_ms_for_test(1_100),
        )
        .expect("append chunk 1");

    // Status bar with cursor positioning (move to line 1, col 1)
    state
        .append_external_reply_chunk(
            "s_vt100_2",
            "\x1b[1;1Hgpt-5 · /path · 100%".as_bytes(),
            now_ms_for_test(1_200),
        )
        .expect("append chunk 2");

    // More content
    state
        .append_external_reply_chunk("s_vt100_2", b"\nResponse line 2", now_ms_for_test(1_300))
        .expect("append chunk 3");

    state
        .mark_external_reply_session_ended("s_vt100_2", now_ms_for_test(1_400))
        .expect("mark ended");

    let candidates = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(1_500),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    // The status bar line should be filtered by line-level filters
    assert!(candidates[0].text.contains("Response line 2"));
}

#[test]
fn vt100_parser_handles_progress_spinner_across_chunks() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_vt100_3".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_vt100_3".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-vt100".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_vt100_3", target, now_ms_for_test(1_000))
        .expect("bind session");

    // Simulate spinner fragments across multiple chunks with proper line clearing
    let spinner_chunks = [
        b"Working" as &[u8],
        b"\r\x1b[KWorking.",
        b"\r\x1b[KWorking..",
        b"\r\x1b[KWorking...",
        b"\r\x1b[K",
        b"Done!",
    ];

    for (i, chunk) in spinner_chunks.iter().enumerate() {
        state
            .append_external_reply_chunk(
                "s_vt100_3",
                chunk,
                now_ms_for_test(1_100 + (i as u64 * 50)),
            )
            .expect("append chunk");
    }

    state
        .mark_external_reply_session_ended("s_vt100_3", now_ms_for_test(1_500))
        .expect("mark ended");

    let candidates = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(1_600),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].text, "Done!");
}

#[test]
fn vt100_parser_preserves_scrollback_content() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_vt100_4".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_vt100_4".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-vt100".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_vt100_4", target, now_ms_for_test(1_000))
        .expect("bind session");

    // Write many lines to trigger scrollback
    for i in 1..=40 {
        let line = format!("Line {}\n", i);
        state
            .append_external_reply_chunk(
                "s_vt100_4",
                line.as_bytes(),
                now_ms_for_test(1_000 + (i as u64 * 10)),
            )
            .expect("append chunk");
    }

    state
        .mark_external_reply_session_ended("s_vt100_4", now_ms_for_test(2_000))
        .expect("mark ended");

    let candidates = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(2_100),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    // Should contain content from scrollback
    assert!(candidates[0].text.contains("Line 1"));
    assert!(candidates[0].text.contains("Line 40"));
}

#[test]
fn vt100_parser_handles_cjk_content() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_vt100_5".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "12345".to_string(),
        inbound_message_id: "m_vt100_5".to_string(),
        workspace_id: "ws".to_string(),
        target_agent_id: "agent-vt100".to_string(),
        injected_input: None,
    };
    state
        .bind_external_reply_session("s_vt100_5", target, now_ms_for_test(1_000))
        .expect("bind session");

    // CJK characters with double-width handling
    state
        .append_external_reply_chunk(
            "s_vt100_5",
            "你好世界\n这是测试\n日本語テスト\n한글 테스트".as_bytes(),
            now_ms_for_test(1_100),
        )
        .expect("append chunk");

    state
        .mark_external_reply_session_ended("s_vt100_5", now_ms_for_test(1_200))
        .expect("mark ended");

    let candidates = state
        .take_external_reply_dispatch_candidates(
            now_ms_for_test(1_300),
            1_000,
            10_000,
            200,
            usize::MAX,
        )
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    assert!(candidates[0].text.contains("你好世界"));
    assert!(candidates[0].text.contains("这是测试"));
    assert!(candidates[0].text.contains("日本語テスト"));
    assert!(candidates[0].text.contains("한글 테스트"));
}

// Phase 2: Enhanced Line-Level Filter Tests

#[test]
fn should_skip_tool_execution_line_filters_known_tools() {
    use super::should_skip_tool_execution_line;

    assert!(should_skip_tool_execution_line("Read(file.txt)"));
    assert!(should_skip_tool_execution_line("Edit(src/main.rs)"));
    assert!(should_skip_tool_execution_line("Bash(ls -la)"));
    assert!(should_skip_tool_execution_line("Write(output.txt)"));
    assert!(should_skip_tool_execution_line("Grep(pattern)"));
    assert!(should_skip_tool_execution_line(
        "WebFetch(https://example.com)"
    ));
    assert!(should_skip_tool_execution_line("Running: cargo test"));
    assert!(should_skip_tool_execution_line("Executing: npm install"));
    assert!(should_skip_tool_execution_line("Tool result: success"));
}

#[test]
fn should_skip_tool_execution_line_preserves_content() {
    use super::should_skip_tool_execution_line;

    assert!(!should_skip_tool_execution_line("Read the documentation"));
    assert!(!should_skip_tool_execution_line("Edit your code carefully"));
    assert!(!should_skip_tool_execution_line(
        "I will write (and test) the code"
    ));
    assert!(!should_skip_tool_execution_line(
        "Running tests is important"
    ));
}

#[test]
fn should_skip_thinking_line_filters_indicators() {
    use super::should_skip_thinking_line;

    assert!(should_skip_thinking_line("Thinking..."));
    assert!(should_skip_thinking_line("Thinking…"));
    assert!(should_skip_thinking_line("Reasoning..."));
    assert!(should_skip_thinking_line("Planning..."));
    assert!(should_skip_thinking_line("Thinking (3s)"));
    assert!(should_skip_thinking_line("Reasoning (12s)"));
}

#[test]
fn should_skip_thinking_line_preserves_content() {
    use super::should_skip_thinking_line;

    assert!(!should_skip_thinking_line("Thinking about this problem"));
    assert!(!should_skip_thinking_line(
        "I'm thinking we should refactor"
    ));
    assert!(!should_skip_thinking_line("Reasoning: the code is correct"));
}

#[test]
fn normalize_reply_text_filters_tool_execution_blocks() {
    let input = "Read(file.txt)\n\
                 File contents loaded\n\
                 Edit(file.txt)\n\
                 Thinking...\n\
                 • Here is my response\n\
                 Bash(ls)\n\
                 This is the actual content";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(
        normalized,
        "• Here is my response\nThis is the actual content"
    );
}

#[test]
fn normalize_reply_text_filters_cost_and_token_displays() {
    let input = "$0.05\n\
                 1500 tokens\n\
                 • Actual response here\n\
                 Cost: $0.10\n\
                 More content";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "• Actual response here\nMore content");
}

#[test]
fn normalize_reply_text_filters_progress_bars() {
    let input = "█████████░░░░░░░░░░ 45%\n\
                 ━━━━━━━━━━╸         \n\
                 • Response content\n\
                 ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░\n\
                 Final text";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "• Response content\nFinal text");
}

#[test]
fn normalize_reply_text_filters_compact_status_patterns() {
    let input = "[1/5]\n\
                 Step 2 of 4\n\
                 • Content here\n\
                 (3/10)\n\
                 More content";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "• Content here\nMore content");
}

#[test]
fn should_skip_startup_banner_line_filters_box_drawing() {
    assert!(should_skip_startup_banner_line(
        "╭─────────────────────────────────────────────╮"
    ));
    assert!(should_skip_startup_banner_line(
        "│ >_ OpenAI Codex (v0.110.0)"
    ));
    assert!(should_skip_startup_banner_line(
        "╰─────────────────────────────────────────────╯"
    ));
    assert!(should_skip_startup_banner_line("┌─────────────────┐"));
    assert!(should_skip_startup_banner_line("│ model: gpt-5.4 xhigh │"));
}

#[test]
fn should_skip_startup_banner_line_filters_tips_and_pairing() {
    assert!(should_skip_startup_banner_line(
        "Tip: New 2x rate limits until April 2nd."
    ));
    assert!(should_skip_startup_banner_line(
        "Hint: Use /help for more info"
    ));
    assert!(should_skip_startup_banner_line("Pairing code: KMZYMEZZ"));
    assert!(should_skip_startup_banner_line(
        "OpenClaw: access not configured."
    ));
    assert!(should_skip_startup_banner_line(
        "Your Telegram user id: 5799948766"
    ));
    assert!(should_skip_startup_banner_line(
        "Ask the bot owner to approve with:"
    ));
}

#[test]
fn normalize_reply_text_filters_codex_banner_and_tips() {
    let input = "╭─────────────────────────────────────────────╮\n\
                 │ >_ OpenAI Codex (v0.110.0)\n\
                 │\n\
                 │\n\
                 │ model:     gpt-5.4 xhigh   /model to change │\n\
                 ╰─────────────────────────────────────────────╯\n\
                 \n\
                 Tip: New 2x rate limits until April 2nd.\n\
                 \n\
                 • 在。说任务。";
    let normalized = normalize_reply_text(input, None);
    assert_eq!(normalized, "• 在。说任务。");
}

#[test]
fn extract_last_assistant_block_handles_multiline_song() {
    use super::extract_last_assistant_block;

    let input = "• 《夜里有光》\n\
                 \n\
                 主歌一\n\
                 天色慢慢落下来\n\
                 街灯一盏一盏开\n\
                 \n\
                 副歌\n\
                 如果夜太长\n\
                 我就为你唱\n\
                 \n\
                 如果你要，我也可以继续把这首歌改成 民谣版、流行版 或 说唱版。";

    let result = extract_last_assistant_block(input);
    assert!(result.is_some());
    let text = result.unwrap();
    assert!(text.contains("《夜里有光》"));
    assert!(text.contains("天色慢慢落下来"));
    assert!(text.contains("如果夜太长"));
    assert!(text.contains("如果你要"));
}

#[test]
fn extract_last_assistant_block_stops_at_user_prompt() {
    use super::extract_last_assistant_block;

    let input = "• First response\n\
                 Some content\n\
                 \n\
                 › next command\n\
                 \n\
                 • Second response\n\
                 More content";

    let result = extract_last_assistant_block(input);
    assert!(result.is_some());
    let text = result.unwrap();
    // Should extract the LAST assistant block (Second response)
    assert!(text.contains("Second response"));
    assert!(text.contains("More content"));
    assert!(!text.contains("First response"));
}

#[test]
fn extract_last_assistant_block_works_without_bullet_marker() {
    use super::extract_last_assistant_block;

    // Agent without • marker (e.g., Gemini CLI, other agents)
    let input = "Here is my response\n\
                 With multiple lines\n\
                 And some content";

    let result = extract_last_assistant_block(input);
    assert!(result.is_some());
    let text = result.unwrap();
    assert_eq!(
        text,
        "Here is my response\nWith multiple lines\nAnd some content"
    );
}

#[test]
fn normalize_reply_text_handles_codex_cli_output() {
    // Real Codex CLI output without • markers
    let input = "Running: date '+%Y-%m-%d %H:%M:%S'\n\
                 2026-03-06 09:39:20\n\
                 \n\
                 The current time is 2026-03-06 09:39:20.";

    let normalized = normalize_reply_text(input, None);
    // Tool execution line should be filtered
    assert!(!normalized.contains("Running:"));
    assert!(normalized.contains("The current time is"));
}

#[test]
fn normalize_reply_text_handles_gemini_cli_output() {
    // Hypothetical Gemini CLI output
    let input = "Thinking (2s)\n\
                 \n\
                 Based on your request, here's the solution:\n\
                 \n\
                 Step 1: Analysis\n\
                 Step 2: Implementation";

    let normalized = normalize_reply_text(input, None);
    assert!(!normalized.contains("Thinking"));
    assert!(normalized.contains("Based on your request"));
    assert!(normalized.contains("Step 1"));
}

#[test]
fn rendered_screen_reply_snapshot_is_used_for_preview() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_1".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-1".to_string(),
        inbound_message_id: "msg-1".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-1".to_string(),
        injected_input: Some("please fix this".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_1", target, now_ms_for_test(1_000))
        .expect("bind");
    state
        .append_external_reply_chunk("s_rendered_1", b"Working...\r", now_ms_for_test(1_100))
        .expect("append");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_1",
            RenderedScreenSnapshot {
                session_id: "s_rendered_1".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_300),
                viewport_top: 0,
                viewport_height: 6,
                base_y: 0,
                cursor_row: Some(5),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "• Working (2s • esc to interrupt)".to_string(),
                        trimmed_text: "• Working (2s • esc to interrupt)".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "Here is the fix plan:".to_string(),
                        trimmed_text: "Here is the fix plan:".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "1. Update the parser gate.".to_string(),
                        trimmed_text: "1. Update the parser gate.".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "2. Ignore spinner redraws.".to_string(),
                        trimmed_text: "2. Ignore spinner redraws.".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "› ".to_string(),
                        trimmed_text: "›".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report rendered screen");

    let preview = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_200), 5_000, 20_000, 200, 10)
        .expect("take preview");
    assert_eq!(preview.len(), 1);
    assert_eq!(preview[0].phase, ExternalReplyDispatchPhase::Preview);
    assert_eq!(
        preview[0].text,
        "Here is the fix plan:\n1. Update the parser gate.\n2. Ignore spinner redraws."
    );
}

#[test]
fn rendered_screen_reply_snapshot_drops_spinner_and_progress_noise() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_2".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-2".to_string(),
        inbound_message_id: "msg-2".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-2".to_string(),
        injected_input: Some("status?".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_2", target, now_ms_for_test(1_000))
        .expect("bind");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_2",
            RenderedScreenSnapshot {
                session_id: "s_rendered_2".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_200),
                viewport_top: 0,
                viewport_height: 5,
                base_y: 0,
                cursor_row: Some(4),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "Working...".to_string(),
                        trimmed_text: "Working...".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "████████░░ 80%".to_string(),
                        trimmed_text: "████████░░ 80%".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "gpt-5.3-codex · high · /repo · 80% left".to_string(),
                        trimmed_text: "gpt-5.3-codex · high · /repo · 80% left".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "› status?".to_string(),
                        trimmed_text: "› status?".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "› ".to_string(),
                        trimmed_text: "›".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report rendered screen");
    state
        .mark_external_reply_session_ended("s_rendered_2", now_ms_for_test(1_500))
        .expect("ended");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_000), 500, 5_000, 200, 10)
        .expect("take final");
    assert!(final_candidates.is_empty());
}

#[test]
fn rendered_screen_reply_snapshot_prefers_reply_after_latest_prompt() {
    use super::extract_rendered_reply_text;

    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_3".to_string(),
        screen_revision: 4,
        captured_at_ms: now_ms_for_test(2_000),
        viewport_top: 0,
        viewport_height: 18,
        base_y: 0,
        cursor_row: Some(17),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "• 我没有手机，也不会换手机。你是想让我帮你挑新手机，还是想回别人一"
                    .to_string(),
                trimmed_text: "• 我没有手机，也不会换手机。你是想让我帮你挑新手机，还是想回别人一"
                    .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "  句“你换手机了？”".to_string(),
                trimmed_text: "句“你换手机了？”".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "› 发错了".to_string(),
                trimmed_text: "› 发错了".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "• 没事。继续发你真正想问的就行。".to_string(),
                trimmed_text: "• 没事。继续发你真正想问的就行。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "› 现在几点了".to_string(),
                trimmed_text: "› 现在几点了".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "• Ran date '+%Y-%m-%d %H:%M:%S %Z (%z)'".to_string(),
                trimmed_text: "• Ran date '+%Y-%m-%d %H:%M:%S %Z (%z)'".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text: "  └ 2026-03-06 15:08:18 CST (+0800)".to_string(),
                trimmed_text: "└ 2026-03-06 15:08:18 CST (+0800)".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: "• 现在是 2026-03-06 15:08:18 CST（UTC+08:00）。".to_string(),
                trimmed_text: "• 现在是 2026-03-06 15:08:18 CST（UTC+08:00）。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "› Implement {feature}".to_string(),
                trimmed_text: "› Implement {feature}".to_string(),
                is_blank: false,
            },
        ],
    };

    let text = extract_rendered_reply_text(&snapshot, Some("现在几点了"), None);
    assert_eq!(text, "• 现在是 2026-03-06 15:08:18 CST（UTC+08:00）。");
}

#[test]
fn rendered_screen_reply_snapshot_falls_back_when_injected_echo_is_wrapped() {
    use super::extract_rendered_reply_text;

    let injected = "请帮我总结这个问题的背景并给出三条建议，另外补充潜在风险点";
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_anchor_fallback_1".to_string(),
        screen_revision: 1,
        captured_at_ms: now_ms_for_test(2_100),
        viewport_top: 0,
        viewport_height: 10,
        base_y: 0,
        cursor_row: Some(8),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "› 请帮我总结这个问题的背景并给出三条建议，".to_string(),
                trimmed_text: "› 请帮我总结这个问题的背景并给出三条建议，".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "  另外补充潜在风险点".to_string(),
                trimmed_text: "另外补充潜在风险点".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "• 可以，下面先给你背景，再给建议和风险。".to_string(),
                trimmed_text: "• 可以，下面先给你背景，再给建议和风险。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "  背景：这个问题本质是资源与时效的权衡。".to_string(),
                trimmed_text: "背景：这个问题本质是资源与时效的权衡。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "› Use /skills to list available skills".to_string(),
                trimmed_text: "› Use /skills to list available skills".to_string(),
                is_blank: false,
            },
        ],
    };

    let text = extract_rendered_reply_text(&snapshot, Some(injected), None);
    assert_eq!(
        text,
        "• 可以，下面先给你背景，再给建议和风险。\n  背景：这个问题本质是资源与时效的权衡。"
    );
}

#[test]
fn rendered_screen_reply_snapshot_extracts_real_telegram_dom_sample() {
    use super::extract_rendered_reply_text;

    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_real_sample_1".to_string(),
        screen_revision: 42,
        captured_at_ms: now_ms_for_test(3_000),
        viewport_top: 0,
        viewport_height: 34,
        base_y: 0,
        cursor_row: Some(12),
        cursor_col: Some(2),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "• Hello.".to_string(),
                trimmed_text: "• Hello.".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "› where u".to_string(),
                trimmed_text: "› where u".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "• In your coding workspace at /mnt/c/".to_string(),
                trimmed_text: "• In your coding workspace at /mnt/c/".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 9,
                text: "  project/ARGlasses/.gtoffice/org/build/".to_string(),
                trimmed_text: "project/ARGlasses/.gtoffice/org/build/".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 12,
                text: "› Implement {feature}".to_string(),
                trimmed_text: "› Implement {feature}".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 14,
                text: "  gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 ·…"
                    .to_string(),
                trimmed_text:
                    "gpt-5.3-codex · gpt-5.3-codex high · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 ·…"
                        .to_string(),
                is_blank: false,
            },
        ],
    };

    let text = extract_rendered_reply_text(&snapshot, Some("where u"), None);
    assert_eq!(
        text,
        "• In your coding workspace at /mnt/c/\n  project/ARGlasses/.gtoffice/org/build/"
    );
}

#[test]
fn rendered_screen_reply_snapshot_keeps_multiline_reply_island_intact() {
    use super::extract_rendered_reply_text;

    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_4".to_string(),
        screen_revision: 5,
        captured_at_ms: now_ms_for_test(3_000),
        viewport_top: 0,
        viewport_height: 20,
        base_y: 0,
        cursor_row: Some(18),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "› Higress  是啥".to_string(),
                trimmed_text: "› Higress  是啥".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "• Higress 是一个开源 API 网关，由阿里云团队发起，基于 Istio/Envoy 生态做了增强，主打：".to_string(),
                trimmed_text: "• Higress 是一个开源 API 网关，由阿里云团队发起，基于 Istio/Envoy 生态做了增强，主打：".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "  - 云原生网关能力（路由、鉴权、限流、灰度等）".to_string(),
                trimmed_text: "- 云原生网关能力（路由、鉴权、限流、灰度等）".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "  - AI 网关能力（对接大模型 API、统一鉴权与流量治理）".to_string(),
                trimmed_text: "- AI 网关能力（对接大模型 API、统一鉴权与流量治理）".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text: "  - 插件扩展（WASM/Go 等）".to_string(),
                trimmed_text: "- 插件扩展（WASM/Go 等）".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: "  - 比较友好的配置与控制台体验".to_string(),
                trimmed_text: "- 比较友好的配置与控制台体验".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 9,
                text: "  你可以把它理解成：面向微服务和 AI 场景的“更现代化网关”。如果你愿意，我可以再给你一版“和".to_string(),
                trimmed_text: "你可以把它理解成：面向微服务和 AI 场景的“更现代化网关”。如果你愿意，我可以再给你一版“和".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 10,
                text: "  Nginx / Kong / APISIX 的区别”对比表。".to_string(),
                trimmed_text: "Nginx / Kong / APISIX 的区别”对比表。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 11,
                text: "› ".to_string(),
                trimmed_text: "›".to_string(),
                is_blank: false,
            },
        ],
    };

    let text = extract_rendered_reply_text(&snapshot, Some("Higress  是啥"), None);
    assert_eq!(
        text,
        "• Higress 是一个开源 API 网关，由阿里云团队发起，基于 Istio/Envoy 生态做了增强，主打：\n\n  - 云原生网关能力（路由、鉴权、限流、灰度等）\n  - AI 网关能力（对接大模型 API、统一鉴权与流量治理）\n  - 插件扩展（WASM/Go 等）\n  - 比较友好的配置与控制台体验\n\n  你可以把它理解成：面向微服务和 AI 场景的“更现代化网关”。如果你愿意，我可以再给你一版“和\n  Nginx / Kong / APISIX 的区别”对比表。"
    );
}

#[test]
fn rendered_screen_reply_snapshot_skips_permission_prompt_and_tool_blocks() {
    use super::extract_rendered_reply_text;

    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_5".to_string(),
        screen_revision: 8,
        captured_at_ms: now_ms_for_test(4_000),
        viewport_top: 0,
        viewport_height: 24,
        base_y: 0,
        cursor_row: Some(22),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "❯ 这个项目干啥的".to_string(),
                trimmed_text: "❯ 这个项目干啥的".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "2. Yes, allow reading from build/ from this project".to_string(),
                trimmed_text: "2. Yes, allow reading from build/ from this project".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "3. No".to_string(),
                trimmed_text: "3. No".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "Esc to cancel · Tab to amend · ctrl+e to explain".to_string(),
                trimmed_text: "Esc to cancel · Tab to amend · ctrl+e to explain".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "● Bash(cd /repo && ls -la)".to_string(),
                trimmed_text: "● Bash(cd /repo && ls -la)".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text: "  ⎿  total 24".to_string(),
                trimmed_text: "⎿  total 24".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: "     … +17 lines (ctrl+o to expand)".to_string(),
                trimmed_text: "… +17 lines (ctrl+o to expand)".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "  ⎿  Shell cwd was reset to /repo/agent-03".to_string(),
                trimmed_text: "⎿  Shell cwd was reset to /repo/agent-03".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 9,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 10,
                text: "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。".to_string(),
                trimmed_text: "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 11,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 12,
                text: "  📱 项目架构".to_string(),
                trimmed_text: "📱 项目架构".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 13,
                text: "  1. 客户端（Flutter） - ar-agent-client/".to_string(),
                trimmed_text: "1. 客户端（Flutter） - ar-agent-client/".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 14,
                text: "  2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                trimmed_text: "2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 15,
                text: "✻ Worked for 2m 23s".to_string(),
                trimmed_text: "✻ Worked for 2m 23s".to_string(),
                is_blank: false,
            },
        ],
    };

    let text = extract_rendered_reply_text(&snapshot, Some("这个项目干啥的"), None);
    assert_eq!(
        text,
        "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。\n\n  📱 项目架构\n  1. 客户端（Flutter） - ar-agent-client/\n  2. 管理后台（Vue 3） - ar-agent-admin/"
    );
}

#[test]
fn rendered_screen_reply_session_merges_scrolled_reply_fragments() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_5".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-5".to_string(),
        inbound_message_id: "msg-5".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-5".to_string(),
        injected_input: Some("这个项目干啥的".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_6", target, now_ms_for_test(1_000))
        .expect("bind");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_6",
            RenderedScreenSnapshot {
                session_id: "s_rendered_6".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_200),
                viewport_top: 0,
                viewport_height: 8,
                base_y: 0,
                cursor_row: Some(7),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "❯ 这个项目干啥的".to_string(),
                        trimmed_text: "❯ 这个项目干啥的".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。".to_string(),
                        trimmed_text: "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。"
                            .to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "  📱 项目架构".to_string(),
                        trimmed_text: "📱 项目架构".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "  1. 客户端（Flutter） - ar-agent-client/".to_string(),
                        trimmed_text: "1. 客户端（Flutter） - ar-agent-client/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "  2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                        trimmed_text: "2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 6,
                        text: "  3. 服务端（Python） - ar-agent-server/".to_string(),
                        trimmed_text: "3. 服务端（Python） - ar-agent-server/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 7,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report snapshot 1");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_6",
            RenderedScreenSnapshot {
                session_id: "s_rendered_6".to_string(),
                screen_revision: 2,
                captured_at_ms: now_ms_for_test(1_500),
                viewport_top: 4,
                viewport_height: 8,
                base_y: 4,
                cursor_row: Some(11),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "  1. 客户端（Flutter） - ar-agent-client/".to_string(),
                        trimmed_text: "1. 客户端（Flutter） - ar-agent-client/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "  2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                        trimmed_text: "2. 管理后台（Vue 3） - ar-agent-admin/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 6,
                        text: "  3. 服务端（Python） - ar-agent-server/".to_string(),
                        trimmed_text: "3. 服务端（Python） - ar-agent-server/".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 7,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 8,
                        text: "  🔧 核心功能".to_string(),
                        trimmed_text: "🔧 核心功能".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 9,
                        text: "  - 语音命令系统".to_string(),
                        trimmed_text: "- 语音命令系统".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 10,
                        text: "  - 物理按键交互".to_string(),
                        trimmed_text: "- 物理按键交互".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 11,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report snapshot 2");
    state
        .mark_external_reply_session_ended("s_rendered_6", now_ms_for_test(1_900))
        .expect("ended");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_100), 200, 5_000, 200, 10)
        .expect("take final");
    assert_eq!(final_candidates.len(), 1);
    assert_eq!(
        final_candidates[0].text,
        "● 根据我查看的项目文件，这是一个 AR 眼镜开发项目。\n\n  📱 项目架构\n  1. 客户端（Flutter） - ar-agent-client/\n  2. 管理后台（Vue 3） - ar-agent-admin/\n  3. 服务端（Python） - ar-agent-server/\n\n  🔧 核心功能\n  - 语音命令系统\n  - 物理按键交互"
    );
}

#[test]
fn permission_response_input_does_not_replace_active_reply_session() {
    let state = AppState::default();
    let original_target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_6".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-6".to_string(),
        inbound_message_id: "msg-original".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-6".to_string(),
        injected_input: Some("这个项目干啥的".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_7", original_target, now_ms_for_test(1_000))
        .expect("bind original");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_7",
            RenderedScreenSnapshot {
                session_id: "s_rendered_7".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_100),
                viewport_top: 0,
                viewport_height: 4,
                base_y: 0,
                cursor_row: Some(3),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "2. Yes, allow reading from ARGlasses/ from this project".to_string(),
                        trimmed_text: "2. Yes, allow reading from ARGlasses/ from this project"
                            .to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "3. No".to_string(),
                        trimmed_text: "3. No".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "Esc to cancel · Tab to amend · ctrl+e to explain".to_string(),
                        trimmed_text: "Esc to cancel · Tab to amend · ctrl+e to explain"
                            .to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report permission prompt");

    let control_target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_6b".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-6".to_string(),
        inbound_message_id: "msg-control".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-6".to_string(),
        injected_input: Some("2".to_string()),
    };
    state
        .bind_external_reply_session("s_rendered_7", control_target, now_ms_for_test(1_200))
        .expect("bind control");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_7",
            RenderedScreenSnapshot {
                session_id: "s_rendered_7".to_string(),
                screen_revision: 2,
                captured_at_ms: now_ms_for_test(1_400),
                viewport_top: 0,
                viewport_height: 5,
                base_y: 0,
                cursor_row: Some(4),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "❯ 这个项目干啥的".to_string(),
                        trimmed_text: "❯ 这个项目干啥的".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "● 这是一个 AR 眼镜开发项目。".to_string(),
                        trimmed_text: "● 这是一个 AR 眼镜开发项目。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "  包含客户端、管理后台和服务端。".to_string(),
                        trimmed_text: "包含客户端、管理后台和服务端。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "✻ Worked for 2m 23s".to_string(),
                        trimmed_text: "✻ Worked for 2m 23s".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report answer");
    state
        .mark_external_reply_session_ended("s_rendered_7", now_ms_for_test(1_600))
        .expect("ended");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_000), 200, 5_000, 200, 10)
        .expect("take final");
    assert_eq!(final_candidates.len(), 1);
    assert_eq!(
        final_candidates[0].target.inbound_message_id,
        "msg-original"
    );
    assert_eq!(
        final_candidates[0].text,
        "● 这是一个 AR 眼镜开发项目。\n  包含客户端、管理后台和服务端。"
    );
}

#[test]
fn rendered_screen_menu_prompt_is_extracted_without_polluting_reply_text() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_menu_1".to_string(),
        screen_revision: 1,
        captured_at_ms: now_ms_for_test(1_100),
        viewport_top: 0,
        viewport_height: 12,
        base_y: 0,
        cursor_row: Some(11),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "› 查看系统时间".to_string(),
                trimmed_text: "› 查看系统时间".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "• 我先读取当前系统时间，给你精确结果。".to_string(),
                trimmed_text: "• 我先读取当前系统时间，给你精确结果。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "• 当前系统时间是 2026-03-06 20:46:35 CST +0800。".to_string(),
                trimmed_text: "• 当前系统时间是 2026-03-06 20:46:35 CST +0800。".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "• Model changed to gpt-5.4 low".to_string(),
                trimmed_text: "• Model changed to gpt-5.4 low".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "Select Reasoning Level for gpt-5.4".to_string(),
                trimmed_text: "Select Reasoning Level for gpt-5.4".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "› 1. Low (current)     Fast responses with lighter reasoning".to_string(),
                trimmed_text: "› 1. Low (current)     Fast responses with lighter reasoning"
                    .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text:
                    "  2. Medium (default)  Balances speed and reasoning depth for everyday tasks"
                        .to_string(),
                trimmed_text:
                    "2. Medium (default)  Balances speed and reasoning depth for everyday tasks"
                        .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: "  3. High              Greater reasoning depth for complex problems"
                    .to_string(),
                trimmed_text: "3. High              Greater reasoning depth for complex problems"
                    .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "  4. Extra high        Extra high reasoning depth for complex problems"
                    .to_string(),
                trimmed_text:
                    "4. Extra high        Extra high reasoning depth for complex problems"
                        .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 9,
                text: "❯ ".to_string(),
                trimmed_text: "❯".to_string(),
                is_blank: false,
            },
        ],
    };

    let prompt =
        extract_rendered_interaction_prompt(&snapshot, Some("查看系统时间")).expect("menu prompt");
    assert_eq!(prompt.title, "Select Reasoning Level for gpt-5.4");
    assert_eq!(prompt.options.len(), 4);
    assert_eq!(prompt.options[0].submit_text, "1");
    assert_eq!(prompt.options[1].submit_text, "2");

    let reply_text = extract_rendered_reply_text(&snapshot, Some("查看系统时间"), Some(&prompt));
    assert_eq!(
        reply_text,
        "• 我先读取当前系统时间，给你精确结果。\n• 当前系统时间是 2026-03-06 20:46:35 CST +0800。"
    );
}

#[test]
fn rendered_screen_gemini_reply_ignores_footer_and_placeholder() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_gemini_1".to_string(),
        screen_revision: 3,
        captured_at_ms: now_ms_for_test(1_200),
        viewport_top: 0,
        viewport_height: 14,
        base_y: 0,
        cursor_row: Some(13),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: " > what the matter".to_string(),
                trimmed_text: "> what the matter".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "✦ I'm not sure I follow—is there a specific problem you're encountering, or are you asking about the state of this workspace?".to_string(),
                trimmed_text: "✦ I'm not sure I follow—is there a specific problem you're encountering, or are you asking about the state of this workspace?".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "  I see only a few files here (desktop.png, .claude/settings.local.json). If you're looking to start a new project or if something is missing,".to_string(),
                trimmed_text: "I see only a few files here (desktop.png, .claude/settings.local.json). If you're looking to start a new project or if something is missing,".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "  please let me know. I can also help you analyze why a build might be failing or investigate any errors you're seeing if you provide".to_string(),
                trimmed_text: "please let me know. I can also help you analyze why a build might be failing or investigate any errors you're seeing if you provide".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "  more details.".to_string(),
                trimmed_text: "more details.".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text: " ? for shortcuts".to_string(),
                trimmed_text: "? for shortcuts".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: " shift+tab to accept edits                        2 GEMINI.md files | 9 MCP servers | 2 skills ".to_string(),
                trimmed_text: "shift+tab to accept edits                        2 GEMINI.md files | 9 MCP servers | 2 skills".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: " >   Type your message or @path/to/file".to_string(),
                trimmed_text: ">   Type your message or @path/to/file".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 9,
                text: " /mnt/.../build/agent-03                   no sandbox                   /model Auto (Gemini 3) ".to_string(),
                trimmed_text: "/mnt/.../build/agent-03                   no sandbox                   /model Auto (Gemini 3)".to_string(),
                is_blank: false,
            },
        ],
    };

    let reply_text = extract_rendered_reply_text(&snapshot, Some("what the matter"), None);
    assert_eq!(
        reply_text,
        "✦ I'm not sure I follow—is there a specific problem you're encountering, or are you asking about the state of this workspace?\n\n  I see only a few files here (desktop.png, .claude/settings.local.json). If you're looking to start a new project or if something is missing,\n  please let me know. I can also help you analyze why a build might be failing or investigate any errors you're seeing if you provide\n  more details."
    );
}

#[test]
fn rendered_screen_gemini_placeholder_prompt_counts_as_ready() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_gemini_ready_1".to_string(),
        screen_revision: 2,
        captured_at_ms: now_ms_for_test(1_400),
        viewport_top: 0,
        viewport_height: 10,
        base_y: 0,
        cursor_row: Some(8),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: " > hello".to_string(),
                trimmed_text: "> hello".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "✦ Hello! I'm Gemini CLI, your senior software engineering partner.".to_string(),
                trimmed_text:
                    "✦ Hello! I'm Gemini CLI, your senior software engineering partner."
                        .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "".to_string(),
                trimmed_text: "".to_string(),
                is_blank: true,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: " ? for shortcuts ".to_string(),
                trimmed_text: "? for shortcuts".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: " >   Type your message or @path/to/file".to_string(),
                trimmed_text: ">   Type your message or @path/to/file".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: " /mnt/.../build/agent-03                   no sandbox                   /model Auto (Gemini 3) ".to_string(),
                trimmed_text:
                    "/mnt/.../build/agent-03                   no sandbox                   /model Auto (Gemini 3)"
                        .to_string(),
                is_blank: false,
            },
        ],
    };

    assert!(snapshot_has_ready_prompt(&snapshot));
}

#[test]
fn rendered_screen_codex_reply_ignores_powershell_prompt_and_banner() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_codex_ps_1".to_string(),
        screen_revision: 5,
        captured_at_ms: now_ms_for_test(1_500),
        viewport_top: 0,
        viewport_height: 16,
        base_y: 0,
        cursor_row: Some(12),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "PS C:\\project\\ARGlasses\\.gtoffice\\org\\build\\agent-03>".to_string(),
                trimmed_text: "PS C:\\project\\ARGlasses\\.gtoffice\\org\\build\\agent-03>"
                    .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "│ >_ OpenAI Codex (v0.111.0)".to_string(),
                trimmed_text: "│ >_ OpenAI Codex (v0.111.0)".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "│ model:     gpt-5.4 low   /model to change".to_string(),
                trimmed_text: "│ model:     gpt-5.4 low   /model to change".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "│ directory: /mnt/c/.../agent-03".to_string(),
                trimmed_text: "│ directory: /mnt/c/.../agent-03".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 4,
                text: "Tip: New Use /fast to enable our fastest".to_string(),
                trimmed_text: "Tip: New Use /fast to enable our fastest".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 5,
                text: "inference at 2X plan usage.".to_string(),
                trimmed_text: "inference at 2X plan usage.".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 6,
                text: "› hello".to_string(),
                trimmed_text: "› hello".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 7,
                text: "• Hi. What do you need?".to_string(),
                trimmed_text: "• Hi. What do you need?".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 8,
                text: "❯ ".to_string(),
                trimmed_text: "❯".to_string(),
                is_blank: false,
            },
        ],
    };

    let reply_text = extract_rendered_reply_text(&snapshot, Some("hello"), None);
    assert_eq!(reply_text, "• Hi. What do you need?");
    assert!(snapshot_has_ready_prompt(&snapshot));
}

#[test]
fn rendered_screen_codex_banner_does_not_emit_before_prompt_echo() {
    let snapshot = RenderedScreenSnapshot {
        session_id: "s_rendered_codex_ps_2".to_string(),
        screen_revision: 1,
        captured_at_ms: now_ms_for_test(1_520),
        viewport_top: 0,
        viewport_height: 12,
        base_y: 0,
        cursor_row: Some(9),
        cursor_col: Some(0),
        rows: vec![
            RenderedScreenSnapshotRow {
                row_index: 0,
                text: "  Tip: New Use /fast to enable our fastest inference at 2X plan usage."
                    .to_string(),
                trimmed_text:
                    "Tip: New Use /fast to enable our fastest inference at 2X plan usage."
                        .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 1,
                text: "⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown."
                    .to_string(),
                trimmed_text:
                    "⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown."
                        .to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 2,
                text: "› Use /skills to list available skills".to_string(),
                trimmed_text: "› Use /skills to list available skills".to_string(),
                is_blank: false,
            },
            RenderedScreenSnapshotRow {
                row_index: 3,
                text: "  gpt-5.4 · gpt-5.4 low · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100% left · …"
                    .to_string(),
                trimmed_text:
                    "gpt-5.4 · gpt-5.4 low · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100% left · …"
                        .to_string(),
                is_blank: false,
            },
        ],
    };

    let reply_text = extract_rendered_reply_text(&snapshot, Some("你好"), None);
    assert_eq!(reply_text, "");
}

#[test]
fn menu_response_input_does_not_replace_active_reply_session() {
    let state = AppState::default();
    let original_target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_menu_1".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-menu-1".to_string(),
        inbound_message_id: "msg-menu-original".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-menu-1".to_string(),
        injected_input: Some("/skill".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_menu_2", original_target, now_ms_for_test(1_000))
        .expect("bind original");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_menu_2",
            RenderedScreenSnapshot {
                session_id: "s_rendered_menu_2".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_100),
                viewport_top: 0,
                viewport_height: 8,
                base_y: 0,
                cursor_row: Some(7),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "› /skill".to_string(),
                        trimmed_text: "› /skill".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "Select Reasoning Level for gpt-5.4".to_string(),
                        trimmed_text: "Select Reasoning Level for gpt-5.4".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "› 1. Low (current)".to_string(),
                        trimmed_text: "› 1. Low (current)".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "  2. Medium (default)".to_string(),
                        trimmed_text: "2. Medium (default)".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "  3. High".to_string(),
                        trimmed_text: "3. High".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "  4. Extra high".to_string(),
                        trimmed_text: "4. Extra high".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 6,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report menu");

    let control_target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_menu_1_control".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-menu-1".to_string(),
        inbound_message_id: "msg-menu-control".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-menu-1".to_string(),
        injected_input: Some("2".to_string()),
    };
    state
        .bind_external_reply_session("s_rendered_menu_2", control_target, now_ms_for_test(1_150))
        .expect("bind control");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_menu_2",
            RenderedScreenSnapshot {
                session_id: "s_rendered_menu_2".to_string(),
                screen_revision: 2,
                captured_at_ms: now_ms_for_test(1_400),
                viewport_top: 0,
                viewport_height: 6,
                base_y: 0,
                cursor_row: Some(5),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "› /skill".to_string(),
                        trimmed_text: "› /skill".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "• Reasoning level updated to Medium.".to_string(),
                        trimmed_text: "• Reasoning level updated to Medium.".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report answer");
    state
        .mark_external_reply_session_ended("s_rendered_menu_2", now_ms_for_test(1_600))
        .expect("ended");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_000), 200, 5_000, 200, 10)
        .expect("take final");
    assert_eq!(final_candidates.len(), 1);
    assert_eq!(
        final_candidates[0].target.inbound_message_id,
        "msg-menu-original"
    );
    assert_eq!(
        final_candidates[0].text,
        "• Reasoning level updated to Medium."
    );
}

#[test]
fn rendered_screen_reply_does_not_finalize_mid_response_without_ready_prompt() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_snapshot_8".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-8".to_string(),
        inbound_message_id: "msg-8".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-8".to_string(),
        injected_input: Some("写一段长文".to_string()),
    };

    state
        .bind_external_reply_session("s_rendered_8", target, now_ms_for_test(1_000))
        .expect("bind");
    state
        .report_external_reply_rendered_screen(
            "s_rendered_8",
            RenderedScreenSnapshot {
                session_id: "s_rendered_8".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_100),
                viewport_top: 0,
                viewport_height: 6,
                base_y: 0,
                cursor_row: Some(5),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "❯ 写一段长文".to_string(),
                        trimmed_text: "❯ 写一段长文".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "  这个时代似乎总在催促人向前。".to_string(),
                        trimmed_text: "这个时代似乎总在催促人向前。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "  消息要秒回，计划要立刻完成。".to_string(),
                        trimmed_text: "消息要秒回，计划要立刻完成。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "  慢，并不意味着懒散。".to_string(),
                        trimmed_text: "慢，并不意味着懒散。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "  一种清醒。".to_string(),
                        trimmed_text: "一种清醒。".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report partial snapshot");

    let premature = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(3_500), 2_000, 20_000, 200, 10)
        .expect("take candidates");
    assert_eq!(premature.len(), 1);
    assert_eq!(premature[0].phase, ExternalReplyDispatchPhase::Preview);
    assert_eq!(
        premature[0].text,
        "  这个时代似乎总在催促人向前。\n  消息要秒回，计划要立刻完成。\n\n  慢，并不意味着懒散。\n  一种清醒。"
    );

    state
        .report_external_reply_rendered_screen(
            "s_rendered_8",
            RenderedScreenSnapshot {
                session_id: "s_rendered_8".to_string(),
                screen_revision: 2,
                captured_at_ms: now_ms_for_test(4_200),
                viewport_top: 2,
                viewport_height: 8,
                base_y: 2,
                cursor_row: Some(9),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "  消息要秒回，计划要立刻完成。".to_string(),
                        trimmed_text: "消息要秒回，计划要立刻完成。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "  慢，并不意味着懒散。".to_string(),
                        trimmed_text: "慢，并不意味着懒散。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "  一种清醒。".to_string(),
                        trimmed_text: "一种清醒。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 6,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 7,
                        text: "  它让人有机会看清方向。".to_string(),
                        trimmed_text: "它让人有机会看清方向。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 8,
                        text: "  而不是在匆忙中盲目前进。".to_string(),
                        trimmed_text: "而不是在匆忙中盲目前进。".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 9,
                        text: "❯ ".to_string(),
                        trimmed_text: "❯".to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report completed snapshot");

    let final_candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(6_500), 2_000, 20_000, 200, 10)
        .expect("take final");
    assert_eq!(final_candidates.len(), 1);
    assert_eq!(
        final_candidates[0].phase,
        ExternalReplyDispatchPhase::Finalize
    );
    assert_eq!(
        final_candidates[0].text,
        "  这个时代似乎总在催促人向前。\n  消息要秒回，计划要立刻完成。\n\n  慢，并不意味着懒散。\n  一种清醒。\n\n  它让人有机会看清方向。\n  而不是在匆忙中盲目前进。"
    );
}

#[test]
fn codex_bound_reply_session_emits_candidate_after_rendered_snapshot() {
    let state = AppState::default();
    let target = ExternalReplyRelayTarget {
        trace_id: "trace_codex_bound_1".to_string(),
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-codex-1".to_string(),
        inbound_message_id: "msg-codex-1".to_string(),
        workspace_id: "ws-1".to_string(),
        target_agent_id: "agent-codex-1".to_string(),
        injected_input: Some("你好".to_string()),
    };

    state
        .bind_external_reply_session("s_codex_bound_1", target, now_ms_for_test(1_000))
        .expect("bind");
    state
        .set_external_reply_session_tool_kind("s_codex_bound_1", AgentToolKind::Codex)
        .expect("set tool kind");
    state
        .report_external_reply_rendered_screen(
            "s_codex_bound_1",
            RenderedScreenSnapshot {
                session_id: "s_codex_bound_1".to_string(),
                screen_revision: 1,
                captured_at_ms: now_ms_for_test(1_100),
                viewport_top: 0,
                viewport_height: 12,
                base_y: 0,
                cursor_row: Some(10),
                cursor_col: Some(0),
                rows: vec![
                    RenderedScreenSnapshotRow {
                        row_index: 0,
                        text: "  Tip: New Use /fast to enable our fastest inference at 2X plan usage."
                            .to_string(),
                        trimmed_text:
                            "Tip: New Use /fast to enable our fastest inference at 2X plan usage."
                                .to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 1,
                        text: "⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown."
                            .to_string(),
                        trimmed_text:
                            "⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown."
                                .to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 2,
                        text: "› 你好".to_string(),
                        trimmed_text: "› 你好".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 3,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 4,
                        text: "• 你好。有什么需要我处理的？".to_string(),
                        trimmed_text: "• 你好。有什么需要我处理的？".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 5,
                        text: "".to_string(),
                        trimmed_text: "".to_string(),
                        is_blank: true,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 6,
                        text: "› Use /skills to list available skills".to_string(),
                        trimmed_text: "› Use /skills to list available skills".to_string(),
                        is_blank: false,
                    },
                    RenderedScreenSnapshotRow {
                        row_index: 7,
                        text: "  gpt-5.4 · gpt-5.4 low · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100% left · …"
                            .to_string(),
                        trimmed_text:
                            "gpt-5.4 · gpt-5.4 low · /mnt/c/project/ARGlasses/.gtoffice/org/build/agent-03 · 100% left · …"
                                .to_string(),
                        is_blank: false,
                    },
                ],
            },
        )
        .expect("report");

    let candidates = state
        .take_external_reply_dispatch_candidates(now_ms_for_test(2_000), 500, 20_000, 200, 10)
        .expect("take candidates");

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].phase, ExternalReplyDispatchPhase::Preview);
    assert_eq!(candidates[0].text, "• 你好。有什么需要我处理的？");
}
