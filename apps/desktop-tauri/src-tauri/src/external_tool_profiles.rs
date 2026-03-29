use vb_task::AgentToolKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolScreenProfile {
    Codex,
    Claude,
    Gemini,
    Generic,
}

impl ToolScreenProfile {
    pub fn from_tool_kind(tool_kind: AgentToolKind) -> Self {
        match tool_kind {
            AgentToolKind::Codex => Self::Codex,
            AgentToolKind::Claude => Self::Claude,
            AgentToolKind::Gemini => Self::Gemini,
            AgentToolKind::Shell | AgentToolKind::Unknown => Self::Generic,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Generic => "generic",
        }
    }

    pub fn assistant_markers(self) -> &'static [&'static str] {
        match self {
            Self::Gemini => &["✦ "],
            Self::Codex | Self::Claude | Self::Generic => &["• ", "● ", "⏺ "],
        }
    }

    pub fn prompt_prefixes(self) -> &'static [&'static str] {
        match self {
            Self::Codex | Self::Claude | Self::Generic => &["› ", "❯ ", "$ ", "> "],
            Self::Gemini => &["> "],
        }
    }
}
