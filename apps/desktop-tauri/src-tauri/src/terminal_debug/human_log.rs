use serde::Serialize;

const TERMINAL_DEBUG_HUMAN_LOG_LIMIT: usize = 160;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDebugHumanEntry {
    pub at_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDebugHumanLogSnapshot {
    pub entries: Vec<TerminalDebugHumanEntry>,
    pub event_count: usize,
}

#[derive(Debug, Clone, Default)]
pub struct TerminalDebugHumanLogState {
    entries: Vec<TerminalDebugHumanEntry>,
}

impl TerminalDebugHumanLogState {
    pub fn snapshot(&self) -> TerminalDebugHumanLogSnapshot {
        TerminalDebugHumanLogSnapshot {
            entries: self.entries.clone(),
            event_count: self.entries.len(),
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn push_reply(&mut self, at_ms: u64, text: &str) -> bool {
        let next_text = text.trim();
        if next_text.is_empty() {
            return false;
        }

        let Some(previous) = self.entries.last_mut() else {
            self.entries.push(TerminalDebugHumanEntry {
                at_ms,
                text: next_text.to_string(),
            });
            return true;
        };

        if previous.text == next_text {
            return false;
        }

        if let Some(merged) = merge_human_reply_text(&previous.text, next_text) {
            if merged == previous.text {
                return false;
            }
            previous.at_ms = at_ms;
            previous.text = merged;
            return true;
        }

        self.entries.push(TerminalDebugHumanEntry {
            at_ms,
            text: next_text.to_string(),
        });
        if self.entries.len() > TERMINAL_DEBUG_HUMAN_LOG_LIMIT {
            let overflow = self.entries.len() - TERMINAL_DEBUG_HUMAN_LOG_LIMIT;
            self.entries.drain(0..overflow);
        }
        true
    }
}

fn looks_incomplete(text: &str) -> bool {
    !text
        .trim_end()
        .ends_with(['.', '!', '?', '。', '！', '？', ')'])
}

fn merge_human_reply_text(previous: &str, next: &str) -> Option<String> {
    if previous == next {
        return Some(previous.to_string());
    }
    if next.starts_with(previous) && next.len() > previous.len() {
        return Some(next.to_string());
    }
    if previous.starts_with(next) && previous.len() > next.len() {
        return Some(previous.to_string());
    }
    if looks_incomplete(previous) && next.len() > previous.len() {
        return Some(next.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{TerminalDebugHumanEntry, TerminalDebugHumanLogState};

    #[test]
    fn human_log_merges_incremental_reply_growth() {
        let mut state = TerminalDebugHumanLogState::default();
        assert!(state.push_reply(1, "你好"));
        assert!(state.push_reply(2, "你好，世界"));

        assert_eq!(
            state.snapshot().entries,
            vec![TerminalDebugHumanEntry {
                at_ms: 2,
                text: "你好，世界".to_string(),
            }]
        );
    }

    #[test]
    fn human_log_ignores_exact_duplicate_reply() {
        let mut state = TerminalDebugHumanLogState::default();
        assert!(state.push_reply(1, "稳定正文"));
        assert!(!state.push_reply(2, "稳定正文"));
        assert_eq!(state.snapshot().event_count, 1);
    }
}
