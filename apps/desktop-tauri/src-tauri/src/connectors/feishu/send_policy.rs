use crate::connectors::channel_error::ChannelError;

const WITHDRAWN_OR_MISSING_REPLY_CODES: &[&str] = &["230011", "231003"];
const BOT_NOT_IN_CHAT_OR_DENIED_CODES: &[&str] = &["230002"];

pub(super) fn should_fallback_to_direct_send(reply_error: &str) -> bool {
    let normalized = reply_error.trim().to_ascii_lowercase();
    if WITHDRAWN_OR_MISSING_REPLY_CODES
        .iter()
        .any(|code| contains_provider_code(&normalized, code))
    {
        return true;
    }
    normalized.contains("withdrawn") || normalized.contains("not found")
}

pub(super) fn provider_error_prefix(error: &str) -> &'static str {
    let normalized = error.trim().to_ascii_lowercase();
    if BOT_NOT_IN_CHAT_OR_DENIED_CODES
        .iter()
        .any(|code| contains_provider_code(&normalized, code))
        || normalized.contains("bot/user can not be out of the chat")
    {
        return "CHANNEL_CONNECTOR_PERMISSION_DENIED";
    }
    "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"
}

pub(super) fn normalize_provider_error(error: impl std::fmt::Display) -> ChannelError {
    let detail = error.to_string();
    let prefix = provider_error_prefix(&detail);
    if prefix == "CHANNEL_CONNECTOR_PERMISSION_DENIED" {
        ChannelError::provider_denied(
            format!("feishu bot is not in the chat or lacks send permission; {detail}"),
            None,
        )
    } else {
        ChannelError::provider_unavailable(detail)
    }
}

fn contains_provider_code(normalized_error: &str, code: &str) -> bool {
    let compact = normalized_error
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect::<String>();
    [
        &format!("code={code}"),
        &format!("code:{code}"),
        &format!("\"code\":{code}"),
        &format!("'code':{code}"),
    ]
    .iter()
    .any(|needle| {
        compact.match_indices(*needle).any(|(index, _)| {
            index == 0
                || compact[..index]
                    .chars()
                    .last()
                    .map(|ch| !ch.is_ascii_alphanumeric() && ch != '_')
                    .unwrap_or(true)
        })
    })
}

#[cfg(test)]
#[path = "tests/send_policy_tests.rs"]
mod tests;
