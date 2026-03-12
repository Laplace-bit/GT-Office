use tauri::AppHandle;

use crate::{
    app_state::{
        ExternalInteractionDispatchCandidate, ExternalInteractionDispatchPhase,
        ExternalReplyDispatchPhase, ExternalReplyRelayTarget,
    },
    connectors::telegram,
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
    Unsupported,
}

impl ChannelSinkKind {
    pub fn from_channel(channel: &str) -> Self {
        if channel.trim().eq_ignore_ascii_case("telegram") {
            Self::Telegram
        } else {
            Self::Unsupported
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
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
            let keyboard = prompt
                .options
                .iter()
                .filter_map(|option| {
                    let payload = format!("gto:{}", option.submit_text.trim());
                    if payload.is_empty() || payload.len() > 64 {
                        return None;
                    }
                    Some(vec![telegram::TelegramInlineKeyboardButton {
                        text: option.label.clone(),
                        callback_data: payload,
                    }])
                })
                .collect::<telegram::TelegramInlineKeyboard>();
            if keyboard.is_empty() {
                return Ok(None);
            }
            let mut lines = vec![prompt.title.trim().to_string()];
            if let Some(hint) = prompt
                .hint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(hint.to_string());
            }
            let text = lines.join("\n\n");
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
