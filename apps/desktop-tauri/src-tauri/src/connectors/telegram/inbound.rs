use serde_json::Value;
use gt_task::{ExternalInboundMessage, ExternalPeerKind};

use super::api::json_to_string;

fn derive_telegram_sender_name(from: &Value) -> Option<String> {
    if let Some(username) = from.get("username").and_then(Value::as_str) {
        let trimmed = username.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let first = from
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let last = from
        .get("last_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let full = format!("{first} {last}").trim().to_string();
    if full.is_empty() {
        None
    } else {
        Some(full)
    }
}

pub(super) fn parse_telegram_update(
    update: &Value,
    account_id: &str,
) -> Result<(ExternalInboundMessage, i64), String> {
    let update_id = update
        .get("update_id")
        .and_then(Value::as_i64)
        .or_else(|| {
            update
                .get("update_id")
                .and_then(Value::as_u64)
                .map(|value| value as i64)
        })
        .ok_or_else(|| "missing update_id".to_string())?;
    if let Some(callback) = update.get("callback_query") {
        return parse_telegram_callback_query(update_id, callback, account_id, update);
    }
    let message = update
        .get("message")
        .or_else(|| update.get("edited_message"))
        .or_else(|| update.get("channel_post"))
        .ok_or_else(|| "missing message/edited_message/channel_post/callback_query".to_string())?;
    let chat = message
        .get("chat")
        .ok_or_else(|| "missing message.chat".to_string())?;
    let peer_id = json_to_string(chat.get("id")).ok_or_else(|| "missing chat.id".to_string())?;
    let chat_type = json_to_string(chat.get("type")).unwrap_or_else(|| "private".to_string());
    let peer_kind = if chat_type.eq_ignore_ascii_case("group")
        || chat_type.eq_ignore_ascii_case("supergroup")
        || chat_type.eq_ignore_ascii_case("channel")
    {
        ExternalPeerKind::Group
    } else {
        ExternalPeerKind::Direct
    };

    let sender = message.get("from");
    let sender_id = sender
        .and_then(|value| json_to_string(value.get("id")))
        .unwrap_or_else(|| peer_id.clone());
    let sender_name = sender.and_then(derive_telegram_sender_name);
    let message_id =
        json_to_string(message.get("message_id")).unwrap_or_else(|| format!("update-{update_id}"));
    let text = json_to_string(message.get("text"))
        .or_else(|| json_to_string(message.get("caption")))
        .unwrap_or_else(|| "[telegram non-text message]".to_string());

    Ok((
        ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: account_id.to_string(),
            peer_kind,
            peer_id,
            sender_id,
            sender_name,
            message_id,
            text,
            idempotency_key: None,
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: update.clone(),
        },
        update_id,
    ))
}

fn parse_telegram_callback_query(
    update_id: i64,
    callback: &Value,
    account_id: &str,
    update: &Value,
) -> Result<(ExternalInboundMessage, i64), String> {
    let message = callback
        .get("message")
        .ok_or_else(|| "missing callback_query.message".to_string())?;
    let chat = message
        .get("chat")
        .ok_or_else(|| "missing callback_query.message.chat".to_string())?;
    let peer_id = json_to_string(chat.get("id")).ok_or_else(|| "missing chat.id".to_string())?;
    let chat_type = json_to_string(chat.get("type")).unwrap_or_else(|| "private".to_string());
    let peer_kind = if chat_type.eq_ignore_ascii_case("group")
        || chat_type.eq_ignore_ascii_case("supergroup")
        || chat_type.eq_ignore_ascii_case("channel")
    {
        ExternalPeerKind::Group
    } else {
        ExternalPeerKind::Direct
    };

    let sender = callback
        .get("from")
        .ok_or_else(|| "missing callback_query.from".to_string())?;
    let sender_id = json_to_string(sender.get("id")).unwrap_or_else(|| peer_id.clone());
    let sender_name = derive_telegram_sender_name(sender);
    let callback_id = json_to_string(callback.get("id"))
        .unwrap_or_else(|| format!("callback-update-{update_id}"));
    let callback_data = json_to_string(callback.get("data"))
        .unwrap_or_else(|| "[telegram callback without data]".to_string());
    let text = decode_callback_data(&callback_data);

    Ok((
        ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: account_id.to_string(),
            peer_kind,
            peer_id,
            sender_id,
            sender_name,
            message_id: format!("callback-{callback_id}"),
            text,
            idempotency_key: Some(format!("telegram-callback-{callback_id}")),
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: update.clone(),
        },
        update_id,
    ))
}

fn decode_callback_data(data: &str) -> String {
    data.strip_prefix("gto:")
        .map(str::to_string)
        .unwrap_or_else(|| data.to_string())
}
