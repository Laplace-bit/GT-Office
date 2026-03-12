use serde_json::Value;
use vb_task::{ExternalInboundMessage, ExternalPeerKind};

#[derive(Debug, Clone)]
pub struct ParsedFeishuMessage {
    pub challenge: Option<String>,
    pub message: Option<ExternalInboundMessage>,
}

fn first_non_empty(values: [Option<&str>; 4]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_to_string(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(raw) = value.as_str() {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(raw) = value.as_i64() {
        return Some(raw.to_string());
    }
    if let Some(raw) = value.as_u64() {
        return Some(raw.to_string());
    }
    None
}

fn parse_text(content: Option<&Value>) -> Option<String> {
    let raw = content.and_then(Value::as_str)?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with('{') {
        if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
            if let Some(text) = parsed.get("text").and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    Some(raw.to_string())
}

fn resolve_account_id(payload: &Value, account_id_hint: Option<&str>) -> String {
    first_non_empty([
        account_id_hint,
        json_to_string(
            payload
                .get("header")
                .and_then(|header| header.get("app_id")),
        )
        .as_deref(),
        json_to_string(
            payload
                .get("header")
                .and_then(|header| header.get("tenant_key")),
        )
        .as_deref(),
        json_to_string(
            payload
                .get("event")
                .and_then(|event| event.get("sender"))
                .and_then(|sender| sender.get("tenant_key")),
        )
        .as_deref(),
    ])
    .unwrap_or_else(|| "default".to_string())
}

pub fn parse_payload(payload: &Value) -> Result<ParsedFeishuMessage, String> {
    parse_payload_for_account(payload, None)
}

pub fn parse_payload_for_account(
    payload: &Value,
    account_id_hint: Option<&str>,
) -> Result<ParsedFeishuMessage, String> {
    if payload
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "url_verification")
    {
        let challenge = payload
            .get("challenge")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        return Ok(ParsedFeishuMessage {
            challenge: Some(challenge),
            message: None,
        });
    }

    let event = payload
        .get("event")
        .ok_or_else(|| "missing event".to_string())?;
    let message = event
        .get("message")
        .ok_or_else(|| "missing event.message".to_string())?;
    let sender = event
        .get("sender")
        .ok_or_else(|| "missing event.sender".to_string())?;
    let sender_id_node = sender
        .get("sender_id")
        .ok_or_else(|| "missing event.sender.sender_id".to_string())?;

    let sender_id = first_non_empty([
        json_to_string(sender_id_node.get("open_id")).as_deref(),
        json_to_string(sender_id_node.get("user_id")).as_deref(),
        json_to_string(sender_id_node.get("union_id")).as_deref(),
        None,
    ])
    .ok_or_else(|| "missing sender open_id/user_id/union_id".to_string())?;

    let peer_id = json_to_string(message.get("chat_id")).unwrap_or_else(|| sender_id.clone());
    let chat_type = json_to_string(message.get("chat_type")).unwrap_or_else(|| "p2p".to_string());
    let peer_kind = if chat_type.eq_ignore_ascii_case("group") {
        ExternalPeerKind::Group
    } else {
        ExternalPeerKind::Direct
    };
    let message_id = json_to_string(message.get("message_id"))
        .ok_or_else(|| "missing event.message.message_id".to_string())?;
    let text = parse_text(message.get("content"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "[feishu non-text message]".to_string());

    let account_id = resolve_account_id(payload, account_id_hint);

    Ok(ParsedFeishuMessage {
        challenge: None,
        message: Some(ExternalInboundMessage {
            channel: "feishu".to_string(),
            account_id,
            peer_kind,
            peer_id,
            sender_id,
            sender_name: json_to_string(sender.get("name")),
            message_id,
            text,
            idempotency_key: None,
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: payload.clone(),
        }),
    })
}
