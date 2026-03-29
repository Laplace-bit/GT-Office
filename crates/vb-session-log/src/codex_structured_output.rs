use serde_json::Value;

use super::{diff_tail, merge_reply_text, trimmed_option};

#[derive(Debug, Clone, Default)]
pub(crate) struct CodexStructuredOutputState {
    latest_text: String,
}

impl CodexStructuredOutputState {
    pub(crate) fn ingest(&mut self, entry: &Value) -> bool {
        let Some(text) = extract_codex_structured_reply_text(entry) else {
            return false;
        };
        let merged = merge_reply_text(&self.latest_text, &text);
        if merged == self.latest_text {
            return false;
        }
        self.latest_text = merged;
        true
    }

    pub(crate) fn snapshot(&self) -> String {
        self.latest_text.clone()
    }

    pub(crate) fn text(&self) -> Option<String> {
        trimmed_option(&self.latest_text)
    }

    pub(crate) fn delta_from(&self, previous: &str) -> Option<String> {
        diff_tail(previous, &self.latest_text)
    }

    pub(crate) fn has_text(&self) -> bool {
        !self.latest_text.trim().is_empty()
    }

    pub(crate) fn clear(&mut self) {
        self.latest_text.clear();
    }
}

pub(crate) fn extract_codex_user_text(entry: &Value) -> Option<String> {
    let payload = entry.get("payload");
    match entry.get("type").and_then(Value::as_str) {
        Some("event_msg") => {
            let payload = payload?;
            if payload.get("type")?.as_str()? != "user_message" {
                return None;
            }
            payload.get("message")?.as_str().and_then(trimmed_option)
        }
        Some("response_item") => {
            let payload = payload?;
            if payload.get("type")?.as_str()? != "message"
                || payload.get("role")?.as_str()? != "user"
            {
                return None;
            }
            let content = payload.get("content")?.as_array()?;
            let mut texts = Vec::new();
            for item in content {
                if item.get("type").and_then(Value::as_str) != Some("input_text") {
                    continue;
                }
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        texts.push(text.trim().to_string());
                    }
                }
            }
            trimmed_option(&texts.join("\n"))
        }
        _ => None,
    }
}

fn extract_codex_structured_reply_text(entry: &Value) -> Option<String> {
    let payload = entry.get("payload")?;
    if entry.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    if payload.get("type")?.as_str()? != "message" || payload.get("role")?.as_str()? != "assistant"
    {
        return None;
    }
    if !should_accept_codex_assistant_phase(payload.get("phase").and_then(Value::as_str)) {
        return None;
    }

    if let Some(content) = payload.get("content").and_then(Value::as_array) {
        let mut texts = Vec::new();
        for item in content {
            let item_type = item.get("type").and_then(Value::as_str);
            if !matches!(item_type, Some("output_text" | "text")) {
                continue;
            }
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    texts.push(text.trim().to_string());
                }
            }
        }
        if !texts.is_empty() {
            return Some(texts.join("\n"));
        }
    }

    payload
        .get("message")
        .and_then(Value::as_str)
        .and_then(trimmed_option)
}

fn should_accept_codex_assistant_phase(phase: Option<&str>) -> bool {
    match phase.map(str::trim).filter(|value| !value.is_empty()) {
        None => true,
        Some("final_answer") => true,
        Some("commentary") => false,
        Some(_) => false,
    }
}
