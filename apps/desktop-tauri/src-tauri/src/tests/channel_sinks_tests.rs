use super::{
    build_telegram_interaction_keyboard, deliver_interaction_prompt, delivered_continuation_chunks,
    format_interaction_prompt_text, interaction_callback_data, interaction_delivery_preflight,
    preview_unsupported_error, reply_delivery_preflight, terminal_key_id, ChannelSinkKind,
};
use crate::app_state::{
    ExternalInteractionAction, ExternalInteractionControl, ExternalInteractionControlMode,
    ExternalInteractionDispatchCandidate, ExternalInteractionDispatchPhase,
    ExternalInteractionOption, ExternalInteractionPrompt, ExternalInteractionPromptKind,
    ExternalReplyDispatchPhase, ExternalReplyRelayTarget, ExternalTerminalKey,
};

fn menu_prompt(
    control_mode: ExternalInteractionControlMode,
    selected_index: Option<usize>,
) -> ExternalInteractionPrompt {
    ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Menu,
        title: "Choose action".to_string(),
        options: vec![
            ExternalInteractionOption {
                label: "Approve".to_string(),
                submit_text: Some("1".to_string()),
            },
            ExternalInteractionOption {
                label: "Deny".to_string(),
                submit_text: Some("2".to_string()),
            },
        ],
        controls: vec![
            ExternalInteractionControl {
                label: "Approve".to_string(),
                action: ExternalInteractionAction::SubmitText(" 1 ".to_string()),
            },
            ExternalInteractionControl {
                label: "Down".to_string(),
                action: ExternalInteractionAction::TerminalKey(ExternalTerminalKey::Down),
            },
            ExternalInteractionControl {
                label: "Enter".to_string(),
                action: ExternalInteractionAction::TerminalKey(ExternalTerminalKey::Enter),
            },
            ExternalInteractionControl {
                label: "Pick second".to_string(),
                action: ExternalInteractionAction::SelectOption(1),
            },
        ],
        control_mode,
        selected_index,
        hint: Some("Use the buttons".to_string()),
        start_row: 0,
        end_row: 0,
    }
}

fn reply_target(channel: &str) -> ExternalReplyRelayTarget {
    ExternalReplyRelayTarget {
        trace_id: "trace-1".to_string(),
        channel: channel.to_string(),
        account_id: "default".to_string(),
        peer_id: "peer-1".to_string(),
        inbound_message_id: "message-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        target_agent_id: "agent-1".to_string(),
        injected_input: None,
        task_id: None,
        reply_to_agent_id: None,
    }
}

fn reply_target_with_peer(channel: &str, peer_id: &str) -> ExternalReplyRelayTarget {
    ExternalReplyRelayTarget {
        peer_id: peer_id.to_string(),
        ..reply_target(channel)
    }
}

fn interaction_candidate(channel: &str) -> ExternalInteractionDispatchCandidate {
    ExternalInteractionDispatchCandidate {
        session_id: "session-1".to_string(),
        target: reply_target(channel),
        prompt: Some(menu_prompt(
            ExternalInteractionControlMode::SemanticButtons,
            None,
        )),
        message_id: None,
        phase: ExternalInteractionDispatchPhase::Show,
    }
}

#[test]
fn channel_sink_kind_normalizes_channel_names_and_capabilities() {
    assert_eq!(
        ChannelSinkKind::from_channel(" Telegram "),
        ChannelSinkKind::Telegram
    );
    assert_eq!(
        ChannelSinkKind::from_channel("FEISHU"),
        ChannelSinkKind::Feishu
    );
    assert_eq!(
        ChannelSinkKind::from_channel("wechat"),
        ChannelSinkKind::Wechat
    );
    assert_eq!(
        ChannelSinkKind::from_channel("sms"),
        ChannelSinkKind::Unsupported
    );

    assert_eq!(ChannelSinkKind::Telegram.id(), "telegram");
    assert_eq!(ChannelSinkKind::Feishu.id(), "feishu");
    assert_eq!(ChannelSinkKind::Wechat.id(), "wechat");
    assert_eq!(ChannelSinkKind::Unsupported.id(), "unsupported");

    let telegram = ChannelSinkKind::Telegram.capabilities();
    assert!(telegram.supports_preview_edit);
    assert!(telegram.supports_interaction_prompt);
    assert_eq!(telegram.max_text_chars, 3_800);

    let feishu = ChannelSinkKind::Feishu.capabilities();
    assert!(!feishu.supports_preview_edit);
    assert!(feishu.supports_interaction_prompt);

    let wechat = ChannelSinkKind::Wechat.capabilities();
    assert!(!wechat.supports_preview_edit);
    assert!(wechat.supports_interaction_prompt);

    let unsupported = ChannelSinkKind::Unsupported.capabilities();
    assert!(!unsupported.supports_preview_edit);
    assert!(!unsupported.supports_interaction_prompt);
    assert_eq!(unsupported.max_text_chars, 0);
}

#[test]
fn interaction_delivery_preflight_rejects_unsupported_channel_before_provider_send() {
    let candidate = interaction_candidate("sms");

    let error = interaction_delivery_preflight(&candidate)
        .expect_err("unsupported interaction channel should fail locally");

    assert_eq!(
        error,
        "CHANNEL_REPLY_INTERACTION_UNSUPPORTED: channel sms does not support interactive prompts"
    );

    assert_eq!(
        interaction_delivery_preflight(&interaction_candidate("telegram")).expect("telegram"),
        ChannelSinkKind::Telegram
    );
}

#[tokio::test]
async fn interaction_prompt_delivery_returns_locally_for_empty_prompt_or_clear_without_message() {
    let app = tauri::test::mock_app();

    let mut no_prompt = interaction_candidate("telegram");
    no_prompt.prompt = None;
    assert_eq!(
        deliver_interaction_prompt(app.handle(), &no_prompt)
            .await
            .expect("telegram show without prompt returns locally"),
        None
    );

    let mut empty_keyboard = interaction_candidate("telegram");
    empty_keyboard.prompt = Some(ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Permission,
        title: "Permission".to_string(),
        options: Vec::new(),
        controls: Vec::new(),
        control_mode: ExternalInteractionControlMode::SemanticButtons,
        selected_index: None,
        hint: None,
        start_row: 0,
        end_row: 0,
    });
    assert_eq!(
        deliver_interaction_prompt(app.handle(), &empty_keyboard)
            .await
            .expect("telegram show with no buttons returns locally"),
        None
    );

    for channel in ["telegram", "feishu", "wechat"] {
        let mut clear = interaction_candidate(channel);
        clear.phase = ExternalInteractionDispatchPhase::Clear;
        clear.message_id = None;
        assert_eq!(
            deliver_interaction_prompt(app.handle(), &clear)
                .await
                .expect("clear without provider delete"),
            None
        );
    }
}

#[test]
fn preview_unsupported_channels_reject_before_provider_send() {
    assert_eq!(
        preview_unsupported_error(ChannelSinkKind::Feishu, ExternalReplyDispatchPhase::Preview)
            .as_deref(),
        Some("CHANNEL_REPLY_PREVIEW_UNSUPPORTED: feishu preview updates are disabled")
    );
    assert_eq!(
        preview_unsupported_error(ChannelSinkKind::Wechat, ExternalReplyDispatchPhase::Preview)
            .as_deref(),
        Some("CHANNEL_REPLY_PREVIEW_UNSUPPORTED: wechat preview updates are disabled")
    );
    assert!(preview_unsupported_error(
        ChannelSinkKind::Telegram,
        ExternalReplyDispatchPhase::Preview
    )
    .is_none());
    assert!(preview_unsupported_error(
        ChannelSinkKind::Wechat,
        ExternalReplyDispatchPhase::Finalize
    )
    .is_none());
    assert!(preview_unsupported_error(
        ChannelSinkKind::Unsupported,
        ExternalReplyDispatchPhase::Preview
    )
    .is_none());
}

#[test]
fn reply_delivery_preflight_rejects_empty_unsupported_and_preview_only_channels() {
    let empty = reply_delivery_preflight(
        &reply_target("telegram"),
        ExternalReplyDispatchPhase::Finalize,
        &[],
    )
    .expect_err("empty chunks rejected");
    assert_eq!(empty, "CHANNEL_REPLY_EMPTY: no text chunks available");

    let blank = reply_delivery_preflight(
        &reply_target("telegram"),
        ExternalReplyDispatchPhase::Finalize,
        &["   ".to_string()],
    )
    .expect_err("blank primary text rejected");
    assert_eq!(blank, "CHANNEL_REPLY_EMPTY: primary text chunk is blank");

    let unsupported = reply_delivery_preflight(
        &reply_target("sms"),
        ExternalReplyDispatchPhase::Finalize,
        &["hello".to_string()],
    )
    .expect_err("unsupported channel rejected");
    assert_eq!(
        unsupported,
        "CHANNEL_REPLY_SEND_UNSUPPORTED: channel sms outbound is unsupported"
    );

    let feishu_preview = reply_delivery_preflight(
        &reply_target("feishu"),
        ExternalReplyDispatchPhase::Preview,
        &["hello".to_string()],
    )
    .expect_err("feishu preview rejected");
    assert_eq!(
        feishu_preview,
        "CHANNEL_REPLY_PREVIEW_UNSUPPORTED: feishu preview updates are disabled"
    );

    let wechat_preview = reply_delivery_preflight(
        &reply_target("wechat"),
        ExternalReplyDispatchPhase::Preview,
        &["hello".to_string()],
    )
    .expect_err("wechat preview rejected");
    assert_eq!(
        wechat_preview,
        "CHANNEL_REPLY_PREVIEW_UNSUPPORTED: wechat preview updates are disabled"
    );

    let blank_peer = reply_delivery_preflight(
        &reply_target_with_peer("telegram", "   "),
        ExternalReplyDispatchPhase::Finalize,
        &["hello".to_string()],
    )
    .expect_err("blank peer rejected");
    assert_eq!(
        blank_peer,
        "CHANNEL_REPLY_SEND_INVALID: peer id is required"
    );

    let chunks = vec![" hello ".to_string()];
    let (primary, sink) = reply_delivery_preflight(
        &reply_target("telegram"),
        ExternalReplyDispatchPhase::Preview,
        &chunks,
    )
    .expect("telegram preview accepted");
    assert_eq!(primary, "hello");
    assert_eq!(sink, ChannelSinkKind::Telegram);
}

#[test]
fn reply_delivery_preflight_accepts_finalize_for_supported_non_preview_channels() {
    for channel in ["feishu", "wechat"] {
        let chunks = vec![" hello ".to_string(), "next".to_string()];
        let (primary, sink) = reply_delivery_preflight(
            &reply_target(channel),
            ExternalReplyDispatchPhase::Finalize,
            &chunks,
        )
        .expect("finalize accepted");

        assert_eq!(primary, "hello");
        assert_eq!(sink, ChannelSinkKind::from_channel(channel));
    }
}

#[test]
fn delivered_continuation_chunks_counts_only_finalize_sends() {
    let chunks = vec![
        "primary".to_string(),
        "continuation-1".to_string(),
        "continuation-2".to_string(),
    ];
    assert_eq!(
        delivered_continuation_chunks(ExternalReplyDispatchPhase::Preview, &chunks),
        0
    );
    assert_eq!(
        delivered_continuation_chunks(ExternalReplyDispatchPhase::Finalize, &chunks),
        2
    );
    assert_eq!(
        delivered_continuation_chunks(ExternalReplyDispatchPhase::Finalize, &[]),
        0
    );
}

#[test]
fn interaction_callback_data_encodes_supported_actions() {
    assert_eq!(
        interaction_callback_data(&ExternalInteractionAction::SubmitText(" /yes ".to_string())),
        Some("gto:/yes".to_string())
    );
    assert_eq!(
        interaction_callback_data(&ExternalInteractionAction::SubmitText("   ".to_string())),
        None
    );
    assert_eq!(
        interaction_callback_data(&ExternalInteractionAction::TerminalKey(
            ExternalTerminalKey::Up
        )),
        Some("gto-key:up".to_string())
    );
    assert_eq!(
        interaction_callback_data(&ExternalInteractionAction::SelectOption(3)),
        Some("gto-select:4".to_string())
    );
}

#[test]
fn terminal_key_ids_cover_navigation_controls() {
    assert_eq!(terminal_key_id(ExternalTerminalKey::Up), "up");
    assert_eq!(terminal_key_id(ExternalTerminalKey::Down), "down");
    assert_eq!(terminal_key_id(ExternalTerminalKey::Enter), "enter");
    assert_eq!(terminal_key_id(ExternalTerminalKey::Esc), "esc");
    assert_eq!(terminal_key_id(ExternalTerminalKey::Tab), "tab");
}

#[test]
fn format_interaction_prompt_text_renders_noninteractive_numbered_choices() {
    let prompt = menu_prompt(ExternalInteractionControlMode::SemanticButtons, Some(1));
    let text = format_interaction_prompt_text(&prompt, false);

    assert!(text.contains("Choose action"));
    assert!(text.contains("  1. Approve"));
    assert!(text.contains("› 2. Deny"));
    assert!(text.contains("Use the buttons"));
    assert!(text.contains("回复对应编号或选项文本完成选择。"));
}

#[test]
fn format_interaction_prompt_text_renders_terminal_navigation_hint() {
    let prompt = menu_prompt(ExternalInteractionControlMode::TerminalNavigation, Some(0));
    let text = format_interaction_prompt_text(&prompt, true);

    assert!(text.contains("› 1. Approve"));
    assert!(text.contains("  2. Deny"));
    assert!(text.contains("可点击编号直接选择，也可发送 up/down/enter/esc 控制终端。"));
}

#[test]
fn format_interaction_prompt_text_omits_non_numeric_submit_text_in_plain_channels() {
    let mut prompt = menu_prompt(ExternalInteractionControlMode::SemanticButtons, None);
    prompt.options[0].submit_text = Some("/approve".to_string());

    let text = format_interaction_prompt_text(&prompt, false);

    assert!(text.contains("  Approve"));
    assert!(!text.contains("/approve. Approve"));
}

#[test]
fn format_interaction_prompt_text_handles_empty_options_and_blank_hint() {
    let prompt = ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Permission,
        title: "  Continue?  ".to_string(),
        options: Vec::new(),
        controls: Vec::new(),
        control_mode: ExternalInteractionControlMode::SemanticButtons,
        selected_index: None,
        hint: Some("   ".to_string()),
        start_row: 0,
        end_row: 0,
    };

    let text = format_interaction_prompt_text(&prompt, false);

    assert_eq!(text, "Continue?\n\n回复对应编号或选项文本完成选择。");
}

#[test]
fn format_interaction_prompt_text_plain_terminal_navigation_uses_numbered_hint() {
    let prompt = menu_prompt(ExternalInteractionControlMode::TerminalNavigation, None);
    let text = format_interaction_prompt_text(&prompt, false);

    assert!(text.contains("  1. Approve"));
    assert!(text.contains("  2. Deny"));
    assert!(text.contains("回复编号直接选择，或发送 up/down/enter/esc 控制终端。"));
    assert!(!text.contains("回复对应编号或选项文本完成选择。"));
}

#[test]
fn telegram_keyboard_renders_semantic_buttons_as_single_button_rows() {
    let prompt = menu_prompt(ExternalInteractionControlMode::SemanticButtons, None);

    let keyboard = build_telegram_interaction_keyboard(&prompt);

    assert_eq!(keyboard.len(), 4);
    assert!(keyboard.iter().all(|row| row.len() == 1));
    assert_eq!(keyboard[0][0].text, "Approve");
    assert_eq!(keyboard[0][0].callback_data, "gto:1");
    assert_eq!(keyboard[3][0].callback_data, "gto-select:2");
}

#[test]
fn telegram_keyboard_groups_terminal_controls_and_select_options() {
    let prompt = ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Menu,
        title: "Terminal".to_string(),
        options: Vec::new(),
        controls: vec![
            ExternalInteractionControl {
                label: "One".to_string(),
                action: ExternalInteractionAction::SelectOption(0),
            },
            ExternalInteractionControl {
                label: "Two".to_string(),
                action: ExternalInteractionAction::SelectOption(1),
            },
            ExternalInteractionControl {
                label: "Three".to_string(),
                action: ExternalInteractionAction::SelectOption(2),
            },
            ExternalInteractionControl {
                label: "Four".to_string(),
                action: ExternalInteractionAction::SelectOption(3),
            },
            ExternalInteractionControl {
                label: "Five".to_string(),
                action: ExternalInteractionAction::SelectOption(4),
            },
            ExternalInteractionControl {
                label: "Up".to_string(),
                action: ExternalInteractionAction::TerminalKey(ExternalTerminalKey::Up),
            },
            ExternalInteractionControl {
                label: "Esc".to_string(),
                action: ExternalInteractionAction::TerminalKey(ExternalTerminalKey::Esc),
            },
            ExternalInteractionControl {
                label: "Tab".to_string(),
                action: ExternalInteractionAction::TerminalKey(ExternalTerminalKey::Tab),
            },
        ],
        control_mode: ExternalInteractionControlMode::TerminalNavigation,
        selected_index: None,
        hint: None,
        start_row: 0,
        end_row: 0,
    };

    let keyboard = build_telegram_interaction_keyboard(&prompt);
    assert_eq!(keyboard[0].len(), 4);
    assert_eq!(keyboard[0][0].callback_data, "gto-select:1");
    assert_eq!(keyboard[1][0].callback_data, "gto-select:5");
    assert_eq!(keyboard[2][0].callback_data, "gto-key:up");
    assert_eq!(keyboard[3][0].callback_data, "gto-key:esc");
    assert_eq!(keyboard[4][0].callback_data, "gto-key:tab");
}

#[test]
fn telegram_keyboard_skips_empty_or_oversized_callbacks() {
    let prompt = ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Permission,
        title: "Permission".to_string(),
        options: Vec::new(),
        controls: vec![
            ExternalInteractionControl {
                label: "Empty".to_string(),
                action: ExternalInteractionAction::SubmitText(" ".to_string()),
            },
            ExternalInteractionControl {
                label: "Large".to_string(),
                action: ExternalInteractionAction::SubmitText("x".repeat(80)),
            },
            ExternalInteractionControl {
                label: "Ok".to_string(),
                action: ExternalInteractionAction::SubmitText("yes".to_string()),
            },
        ],
        control_mode: ExternalInteractionControlMode::SemanticButtons,
        selected_index: None,
        hint: None,
        start_row: 0,
        end_row: 0,
    };

    let keyboard = build_telegram_interaction_keyboard(&prompt);
    assert_eq!(keyboard.len(), 1);
    assert_eq!(keyboard[0][0].callback_data, "gto:yes");
}

#[test]
fn telegram_keyboard_returns_empty_when_all_controls_are_invalid() {
    let prompt = ExternalInteractionPrompt {
        kind: ExternalInteractionPromptKind::Permission,
        title: "Permission".to_string(),
        options: Vec::new(),
        controls: vec![
            ExternalInteractionControl {
                label: "Empty".to_string(),
                action: ExternalInteractionAction::SubmitText(" ".to_string()),
            },
            ExternalInteractionControl {
                label: "Large".to_string(),
                action: ExternalInteractionAction::SubmitText("x".repeat(80)),
            },
        ],
        control_mode: ExternalInteractionControlMode::SemanticButtons,
        selected_index: None,
        hint: None,
        start_row: 0,
        end_row: 0,
    };

    assert!(build_telegram_interaction_keyboard(&prompt).is_empty());
}
