use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::types::Provider;

const MAX_SCAN_LINES: usize = 100;

/// Best-effort session title from provider log (first user prompt, custom title, etc.).
pub fn extract_session_title(log_path: &Path, provider: Provider) -> Option<String> {
    let file = std::fs::File::open(log_path).ok()?;
    let reader = BufReader::new(file);
    match provider {
        Provider::Claude => extract_claude_session_title(reader),
        Provider::Codex => extract_codex_session_title(reader),
    }
}

/// Alias kept for callers that name the field `first_user_message`.
pub fn extract_first_user_message(log_path: &Path, provider: Provider) -> Option<String> {
    extract_session_title(log_path, provider)
}

fn extract_claude_session_title(reader: BufReader<std::fs::File>) -> Option<String> {
    let mut first_last_prompt: Option<String> = None;

    for line in reader.lines().take(MAX_SCAN_LINES) {
        let line = line.ok()?;
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let entry_type = value.get("type").and_then(|v| v.as_str())?;

        if entry_type == "custom-title" {
            if let Some(title) = value
                .get("customTitle")
                .or_else(|| value.get("custom_title"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
            {
                return Some(truncate_title(title, 80));
            }
        }

        if entry_type == "last-prompt" {
            if let Some(prompt) = value.get("lastPrompt").and_then(|v| v.as_str()) {
                if !is_noise_claude_user_text(prompt) && first_last_prompt.is_none() {
                    first_last_prompt = Some(prompt.to_string());
                }
            }
            continue;
        }

        if entry_type != "user" {
            continue;
        }

        if let Some(text) = extract_claude_user_text(&value) {
            if !is_noise_claude_user_text(&text) {
                return Some(truncate_title(&text, 80));
            }
        }
    }

    first_last_prompt.map(|text| truncate_title(&text, 80))
}

fn extract_codex_session_title(reader: BufReader<std::fs::File>) -> Option<String> {
    for line in reader.lines().take(MAX_SCAN_LINES) {
        let line = line.ok()?;
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(text) = extract_codex_user_text(&value) {
            if !text.trim().is_empty() {
                return Some(truncate_title(&text, 80));
            }
        }
    }
    None
}

fn is_noise_claude_user_text(text: &str) -> bool {
    let t = text.trim();
    if t.chars().count() < 4 {
        return true;
    }
    if t.starts_with("<local-command-caveat>") {
        return true;
    }
    if t.starts_with("<command-name>") || t.starts_with("<command-message>") {
        return true;
    }
    if t.contains("DO NOT respond to these messages") {
        return true;
    }
    false
}

fn extract_claude_user_text(value: &serde_json::Value) -> Option<String> {
    let msg_type = value.get("type").and_then(|v| v.as_str())?;
    if msg_type != "user" {
        return None;
    }
    let message = value.get("message")?;
    let role = message.get("role").and_then(|v| v.as_str())?;
    if role != "user" {
        return None;
    }
    extract_text_from_content(message)
}

fn extract_codex_user_text(value: &serde_json::Value) -> Option<String> {
    let event_type = value.get("type").and_then(|v| v.as_str())?;
    match event_type {
        "event_msg" => {
            let payload = value.get("payload")?;
            let payload_type = payload.get("type").and_then(|v| v.as_str())?;
            if payload_type == "user_message" {
                return payload
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
        "response_item" => {
            let payload = value.get("payload")?;
            let payload_type = payload.get("type").and_then(|v| v.as_str())?;
            if payload_type != "message" {
                return None;
            }
            let role = payload.get("role").and_then(|v| v.as_str())?;
            if role != "user" {
                return None;
            }
            return extract_text_from_content(payload);
        }
        _ => {}
    }
    None
}

fn extract_text_from_content(message: &serde_json::Value) -> Option<String> {
    let content = message.get("content")?;
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut text = String::new();
        for item in arr {
            let item_type = item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if matches!(
                item_type,
                "thinking" | "thinking_delta" | "tool_use" | "tool_result"
            ) {
                continue;
            }
            if item_type == "text" || item_type.is_empty() {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(t);
                }
            }
        }
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

pub fn truncate_title(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_len {
        trimmed.to_string()
    } else {
        let trunc_len = max_len.saturating_sub(1);
        let end = trimmed
            .char_indices()
            .nth(trunc_len)
            .map(|(i, _)| i)
            .unwrap_or(trimmed.len());
        format!("{}…", &trimmed[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_jsonl(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn test_claude_extract_user_message() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"attachment","sessionId":"s1"}
{"type":"user","message":{"role":"user","content":"Fix the login bug"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll fix it"}]}}
"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert_eq!(result.as_deref(), Some("Fix the login bug"));
    }

    #[test]
    fn test_claude_custom_title() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"custom-title","customTitle":"Login bug fix"}
{"type":"user","message":{"role":"user","content":"ignored after custom title"}}
"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert_eq!(result.as_deref(), Some("Login bug fix"));
    }

    #[test]
    fn test_claude_skip_noise_then_last_prompt() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"user","message":{"role":"user","content":"<local-command-caveat>Caveat</local-command-caveat>"}}
{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}
{"type":"last-prompt","lastPrompt":"Design a new theme palette"}
"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert_eq!(result.as_deref(), Some("Design a new theme palette"));
    }

    #[test]
    fn test_claude_extract_array_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello world"}]}}"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert_eq!(result.as_deref(), Some("Hello world"));
    }

    #[test]
    fn test_codex_extract_user_message() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rollout.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"session_meta","payload":{"id":"s1","cwd":"/tmp"}}
{"type":"event_msg","payload":{"type":"user_message","message":"Build the feature"}}
"#,
        );
        let result = extract_session_title(&file, Provider::Codex);
        assert_eq!(result.as_deref(), Some("Build the feature"));
    }

    #[test]
    fn test_extract_no_user_message() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"assistant","message":{"role":"assistant","content":"reply"}}"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_missing_file() {
        let result = extract_session_title(Path::new("/nonexistent/file.jsonl"), Provider::Claude);
        assert!(result.is_none());
    }

    #[test]
    fn test_truncate_short() {
        assert_eq!(truncate_title("hello", 80), "hello");
    }

    #[test]
    fn test_truncate_long() {
        let long = "a".repeat(100);
        let result = truncate_title(&long, 80);
        assert!(result.len() <= 82);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn test_truncate_exact() {
        let text = "a".repeat(80);
        let result = truncate_title(&text, 80);
        assert_eq!(result.len(), 80);
        assert!(!result.ends_with('…'));
    }

    #[test]
    fn test_claude_skip_thinking() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.jsonl");
        write_jsonl(
            &file,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"thinking","text":"internal"},{"type":"text","text":"actual message"}]}}"#,
        );
        let result = extract_session_title(&file, Provider::Claude);
        assert_eq!(result.as_deref(), Some("actual message"));
    }
}
