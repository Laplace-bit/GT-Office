use gt_task::AgentToolKind;

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

#[cfg(test)]
mod tests {
    use super::ToolScreenProfile;
    use gt_task::AgentToolKind;

    #[test]
    fn tool_screen_profile_maps_agent_tool_kinds() {
        assert_eq!(
            ToolScreenProfile::from_tool_kind(AgentToolKind::Codex),
            ToolScreenProfile::Codex
        );
        assert_eq!(
            ToolScreenProfile::from_tool_kind(AgentToolKind::Claude),
            ToolScreenProfile::Claude
        );
        assert_eq!(
            ToolScreenProfile::from_tool_kind(AgentToolKind::Gemini),
            ToolScreenProfile::Gemini
        );
        assert_eq!(
            ToolScreenProfile::from_tool_kind(AgentToolKind::Shell),
            ToolScreenProfile::Generic
        );
        assert_eq!(
            ToolScreenProfile::from_tool_kind(AgentToolKind::Unknown),
            ToolScreenProfile::Generic
        );
    }

    #[test]
    fn tool_screen_profile_ids_and_markers_match_contract() {
        assert_eq!(ToolScreenProfile::Codex.id(), "codex");
        assert_eq!(ToolScreenProfile::Claude.id(), "claude");
        assert_eq!(ToolScreenProfile::Gemini.id(), "gemini");
        assert_eq!(ToolScreenProfile::Generic.id(), "generic");

        assert_eq!(ToolScreenProfile::Gemini.assistant_markers(), &["✦ "]);
        assert_eq!(
            ToolScreenProfile::Codex.assistant_markers(),
            &["• ", "● ", "⏺ "]
        );
        assert_eq!(ToolScreenProfile::Gemini.prompt_prefixes(), &["> "]);
        assert_eq!(
            ToolScreenProfile::Generic.prompt_prefixes(),
            &["› ", "❯ ", "$ ", "> "]
        );
    }
}
