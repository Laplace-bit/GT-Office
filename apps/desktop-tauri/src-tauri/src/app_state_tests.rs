use super::{
    extract_last_assistant_block, normalize_carriage_returns, normalize_reply_text,
    normalize_terminal_text, sanitize_terminal_chunk, should_skip_cli_prompt_line,
    should_skip_external_reply_line, should_skip_log_prefix_line,
    should_skip_runtime_noise_line, should_skip_startup_banner_line, should_skip_thinking_line,
    should_skip_tool_execution_line, AppState, ExternalReplyDispatchPhase,
    ExternalReplyRelayTarget,
};

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
        .append_external_reply_chunk("s_vt100_2", "• Response line 1\n".as_bytes(), now_ms_for_test(1_100))
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
    assert!(should_skip_tool_execution_line("WebFetch(https://example.com)"));
    assert!(should_skip_tool_execution_line("Running: cargo test"));
    assert!(should_skip_tool_execution_line("Executing: npm install"));
    assert!(should_skip_tool_execution_line("Tool result: success"));
}

#[test]
fn should_skip_tool_execution_line_preserves_content() {
    use super::should_skip_tool_execution_line;

    assert!(!should_skip_tool_execution_line("Read the documentation"));
    assert!(!should_skip_tool_execution_line("Edit your code carefully"));
    assert!(!should_skip_tool_execution_line("I will write (and test) the code"));
    assert!(!should_skip_tool_execution_line("Running tests is important"));
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
    assert!(!should_skip_thinking_line("I'm thinking we should refactor"));
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
    assert_eq!(normalized, "• Here is my response\nThis is the actual content");
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
    assert!(should_skip_startup_banner_line("╭─────────────────────────────────────────────╮"));
    assert!(should_skip_startup_banner_line("│ >_ OpenAI Codex (v0.110.0)"));
    assert!(should_skip_startup_banner_line("╰─────────────────────────────────────────────╯"));
    assert!(should_skip_startup_banner_line("┌─────────────────┐"));
    assert!(should_skip_startup_banner_line("│ model: gpt-5.4 xhigh │"));
}

#[test]
fn should_skip_startup_banner_line_filters_tips_and_pairing() {
    assert!(should_skip_startup_banner_line("Tip: New 2x rate limits until April 2nd."));
    assert!(should_skip_startup_banner_line("Hint: Use /help for more info"));
    assert!(should_skip_startup_banner_line("Pairing code: KMZYMEZZ"));
    assert!(should_skip_startup_banner_line("OpenClaw: access not configured."));
    assert!(should_skip_startup_banner_line("Your Telegram user id: 5799948766"));
    assert!(should_skip_startup_banner_line("Ask the bot owner to approve with:"));
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
    assert_eq!(text, "Here is my response\nWith multiple lines\nAnd some content");
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
