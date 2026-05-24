use gt_task::AgentToolKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolScreenProfile {
    Codex,
    Claude,
    Generic,
}

impl ToolScreenProfile {
    pub fn from_tool_kind(tool_kind: AgentToolKind) -> Self {
        match tool_kind {
            AgentToolKind::Codex => Self::Codex,
            AgentToolKind::Claude => Self::Claude,
            AgentToolKind::Shell | AgentToolKind::Unknown => Self::Generic,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Generic => "generic",
        }
    }

    pub fn assistant_markers(self) -> &'static [&'static str] {
        &["• ", "● ", "⏺ ", "✦ "]
    }

    pub fn prompt_prefixes(self) -> &'static [&'static str] {
        &["› ", "❯ ", "$ ", "> "]
    }
}

#[cfg(test)]
#[path = "external_tool_profiles_tests.rs"]
mod tests;
