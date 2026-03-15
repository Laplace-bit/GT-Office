use tauri::AppHandle;

use crate::{
    app_state::{
        ExternalInteractionAction, ExternalInteractionControlMode,
        ExternalInteractionDispatchCandidate, ExternalInteractionDispatchPhase,
        ExternalReplyDispatchPhase, ExternalReplyRelayTarget, ExternalTerminalKey,
    },
    connectors::{feishu, telegram},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelSinkCapabilities {
    pub supports_preview_edit: bool,
    pub supports_interaction_prompt: bool,
    pub max_text_chars: usize,
}

#[derive(Debug, Clone)]
pub struct ChannelReplyDeliveryResult {
    pub message_id: String,
    pub delivered_at_ms: u64,
    pub continuation_chunks: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelSinkKind {
    Telegram,
    Feishu,
    Unsupported,
}

impl ChannelSinkKind {
    pub fn from_channel(channel: &str) -> Self {
        if channel.trim().eq_ignore_ascii_case("telegram") {
            Self::Telegram
        } else if channel.trim().eq_ignore_ascii_case("feishu") {
            Self::Feishu
        } else {
            Self::Unsupported
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Feishu => "feishu",
            Self::Unsupported => "unsupported",
        }
    }

    pub fn capabilities(self) -> ChannelSinkCapabilities {
        match self {
            Self::Telegram => ChannelSinkCapabilities {
                supports_preview_edit: true,
                supports_interaction_prompt: true,
                max_text_chars: 3_800,
            },
            Self::Feishu => ChannelSinkCapabilities {
                supports_preview_edit: false,
                supports_interaction_prompt: false,
                max_text_chars: 3_800,
            },
            Self::Unsupported => ChannelSinkCapabilities {
                supports_preview_edit: false,
                supports_interaction_prompt: false,
                max_text_chars: 0,
            },
        }
    }
}

pub async fn deliver_interaction_prompt(
    app: &AppHandle,
    candidate: &ExternalInteractionDispatchCandidate,
) -> Result<Option<String>, String> {
    match ChannelSinkKind::from_channel(&candidate.target.channel) {
        ChannelSinkKind::Telegram => deliver_telegram_interaction_prompt(app, candidate).await,
        ChannelSinkKind::Feishu => deliver_feishu_interaction_prompt(app, candidate).await,
        ChannelSinkKind::Unsupported => Err(format!(
            "CHANNEL_REPLY_INTERACTION_UNSUPPORTED: channel {} does not support interactive prompts",
            candidate.target.channel
        )),
    }
}

pub async fn deliver_reply_text(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    phase: ExternalReplyDispatchPhase,
    text_chunks: &[String],
    preview_message_id: &mut Option<String>,
) -> Result<ChannelReplyDeliveryResult, String> {
    let Some(primary_text) = text_chunks.first() else {
        return Err("CHANNEL_REPLY_EMPTY: no text chunks available".to_string());
    };

    match ChannelSinkKind::from_channel(&target.channel) {
        ChannelSinkKind::Telegram => {
            deliver_telegram_reply_text(
                app,
                target,
                phase,
                primary_text,
                text_chunks,
                preview_message_id,
            )
            .await
        }
        ChannelSinkKind::Feishu => {
            deliver_feishu_reply_text(app, target, phase, primary_text, text_chunks).await
        }
        ChannelSinkKind::Unsupported => Err(format!(
            "CHANNEL_REPLY_SEND_UNSUPPORTED: channel {} outbound is unsupported",
            target.channel
        )),
    }
}

async fn deliver_telegram_interaction_prompt(
    app: &AppHandle,
    candidate: &ExternalInteractionDispatchCandidate,
) -> Result<Option<String>, String> {
    match candidate.phase {
        ExternalInteractionDispatchPhase::Show => {
            let Some(prompt) = candidate.prompt.as_ref() else {
                return Ok(None);
            };
            let keyboard = build_telegram_interaction_keyboard(prompt);
            if keyboard.is_empty() {
                return Ok(None);
            }
            let text = format_interaction_prompt_text(prompt, true);
            let snapshot = if let Some(message_id) = candidate.message_id.as_deref() {
                telegram::edit_text_reply_with_inline_keyboard(
                    app,
                    Some(&candidate.target.account_id),
                    &candidate.target.peer_id,
                    message_id,
                    &text,
                    Some(&keyboard),
                )
                .await?
            } else {
                telegram::send_text_reply_with_inline_keyboard(
                    app,
                    Some(&candidate.target.account_id),
                    &candidate.target.peer_id,
                    &text,
                    Some(&candidate.target.inbound_message_id),
                    Some(&keyboard),
                )
                .await?
            };
            Ok(Some(snapshot.message_id))
        }
        ExternalInteractionDispatchPhase::Clear => {
            if let Some(message_id) = candidate.message_id.as_deref() {
                telegram::delete_message(
                    app,
                    Some(&candidate.target.account_id),
                    &candidate.target.peer_id,
                    message_id,
                )
                .await?;
            }
            Ok(None)
        }
    }
}

async fn deliver_feishu_interaction_prompt(
    app: &AppHandle,
    candidate: &ExternalInteractionDispatchCandidate,
) -> Result<Option<String>, String> {
    match candidate.phase {
        ExternalInteractionDispatchPhase::Show => {
            let Some(prompt) = candidate.prompt.as_ref() else {
                return Ok(None);
            };
            let text = format_interaction_prompt_text(prompt, false);
            let snapshot = feishu::send_text_reply(
                app,
                Some(&candidate.target.account_id),
                &candidate.target.peer_id,
                &text,
                Some(&candidate.target.inbound_message_id),
            )
            .await?;
            Ok(Some(snapshot.message_id))
        }
        ExternalInteractionDispatchPhase::Clear => Ok(None),
    }
}

async fn deliver_telegram_reply_text(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    phase: ExternalReplyDispatchPhase,
    primary_text: &str,
    text_chunks: &[String],
    preview_message_id: &mut Option<String>,
) -> Result<ChannelReplyDeliveryResult, String> {
    let send_result = match phase {
        ExternalReplyDispatchPhase::Preview => {
            if let Some(message_id) = preview_message_id.as_deref() {
                telegram::edit_text_reply(
                    app,
                    Some(&target.account_id),
                    &target.peer_id,
                    message_id,
                    primary_text,
                )
                .await?
            } else {
                let _ =
                    telegram::send_typing_action(app, Some(&target.account_id), &target.peer_id)
                        .await;
                telegram::send_text_reply(
                    app,
                    Some(&target.account_id),
                    &target.peer_id,
                    primary_text,
                    Some(&target.inbound_message_id),
                )
                .await?
            }
        }
        ExternalReplyDispatchPhase::Finalize => {
            if let Some(message_id) = preview_message_id.as_deref() {
                match telegram::edit_text_reply(
                    app,
                    Some(&target.account_id),
                    &target.peer_id,
                    message_id,
                    primary_text,
                )
                .await
                {
                    Ok(snapshot) => snapshot,
                    Err(_) => {
                        telegram::send_text_reply(
                            app,
                            Some(&target.account_id),
                            &target.peer_id,
                            primary_text,
                            Some(&target.inbound_message_id),
                        )
                        .await?
                    }
                }
            } else {
                telegram::send_text_reply(
                    app,
                    Some(&target.account_id),
                    &target.peer_id,
                    primary_text,
                    Some(&target.inbound_message_id),
                )
                .await?
            }
        }
    };

    if phase == ExternalReplyDispatchPhase::Finalize {
        for extra_chunk in text_chunks.iter().skip(1) {
            telegram::send_text_reply(
                app,
                Some(&target.account_id),
                &target.peer_id,
                extra_chunk,
                Some(&target.inbound_message_id),
            )
            .await?;
        }
    }

    if phase == ExternalReplyDispatchPhase::Preview {
        *preview_message_id = Some(send_result.message_id.clone());
    }

    Ok(ChannelReplyDeliveryResult {
        message_id: send_result.message_id,
        delivered_at_ms: send_result.delivered_at_ms,
        continuation_chunks: text_chunks.len().saturating_sub(1),
    })
}

async fn deliver_feishu_reply_text(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    phase: ExternalReplyDispatchPhase,
    primary_text: &str,
    text_chunks: &[String],
) -> Result<ChannelReplyDeliveryResult, String> {
    if phase == ExternalReplyDispatchPhase::Preview {
        return Err(
            "CHANNEL_REPLY_PREVIEW_UNSUPPORTED: feishu preview updates are disabled".to_string(),
        );
    }

    let send_result = feishu::send_text_reply(
        app,
        Some(&target.account_id),
        &target.peer_id,
        primary_text,
        Some(&target.inbound_message_id),
    )
    .await?;

    for extra_chunk in text_chunks.iter().skip(1) {
        feishu::send_text_reply(
            app,
            Some(&target.account_id),
            &target.peer_id,
            extra_chunk,
            Some(&target.inbound_message_id),
        )
        .await?;
    }

    Ok(ChannelReplyDeliveryResult {
        message_id: send_result.message_id,
        delivered_at_ms: send_result.delivered_at_ms,
        continuation_chunks: text_chunks.len().saturating_sub(1),
    })
}

fn build_telegram_interaction_keyboard(
    prompt: &crate::app_state::ExternalInteractionPrompt,
) -> telegram::TelegramInlineKeyboard {
    let buttons = prompt
        .controls
        .iter()
        .filter_map(|control| {
            let callback_data = interaction_callback_data(&control.action)?;
            if callback_data.len() > 64 {
                return None;
            }
            Some(telegram::TelegramInlineKeyboardButton {
                text: control.label.clone(),
                callback_data,
            })
        })
        .collect::<Vec<_>>();
    if buttons.is_empty() {
        return Vec::new();
    }
    match prompt.control_mode {
        ExternalInteractionControlMode::SemanticButtons => {
            buttons.into_iter().map(|button| vec![button]).collect()
        }
        ExternalInteractionControlMode::TerminalNavigation => {
            let mut rows = Vec::new();
            let mut first_row = Vec::new();
            let mut second_row = Vec::new();
            let mut third_row = Vec::new();
            for button in buttons {
                match button.callback_data.as_str() {
                    "gto-key:up" | "gto-key:down" => first_row.push(button),
                    "gto-key:enter" | "gto-key:esc" => second_row.push(button),
                    _ => third_row.push(button),
                }
            }
            if !first_row.is_empty() {
                rows.push(first_row);
            }
            if !second_row.is_empty() {
                rows.push(second_row);
            }
            if !third_row.is_empty() {
                rows.push(third_row);
            }
            rows
        }
    }
}

fn interaction_callback_data(action: &ExternalInteractionAction) -> Option<String> {
    match action {
        ExternalInteractionAction::SubmitText(text) => {
            let payload = text.trim();
            if payload.is_empty() {
                None
            } else {
                Some(format!("gto:{payload}"))
            }
        }
        ExternalInteractionAction::TerminalKey(key) => {
            Some(format!("gto-key:{}", terminal_key_id(*key)))
        }
    }
}

fn terminal_key_id(key: ExternalTerminalKey) -> &'static str {
    match key {
        ExternalTerminalKey::Up => "up",
        ExternalTerminalKey::Down => "down",
        ExternalTerminalKey::Enter => "enter",
        ExternalTerminalKey::Esc => "esc",
        ExternalTerminalKey::Tab => "tab",
    }
}

fn format_interaction_prompt_text(
    prompt: &crate::app_state::ExternalInteractionPrompt,
    interactive: bool,
) -> String {
    let mut lines = vec![prompt.title.trim().to_string()];
    if !prompt.options.is_empty() {
        let rendered_options = prompt
            .options
            .iter()
            .enumerate()
            .map(|(index, option)| {
                let marker = if prompt.selected_index == Some(index) {
                    "›"
                } else {
                    " "
                };
                format!("{marker} {}", option.label.trim())
            })
            .collect::<Vec<_>>()
            .join("\n");
        lines.push(rendered_options);
    }
    if let Some(hint) = prompt
        .hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(hint.to_string());
    }
    if !interactive {
        lines.push("当前通道仅展示此交互提示，暂不支持远程选择。".to_string());
    }
    lines.join("\n\n")
}
