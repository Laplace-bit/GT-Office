use super::*;

#[test]
fn from_tool_kind_maps_known_tools() {
    assert_eq!(
        ToolScreenProfile::from_tool_kind(AgentToolKind::Codex),
        ToolScreenProfile::Codex
    );
    assert_eq!(
        ToolScreenProfile::from_tool_kind(AgentToolKind::Claude),
        ToolScreenProfile::Claude
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
fn profile_metadata_matches_tool_conventions() {
    assert_eq!(ToolScreenProfile::Codex.id(), "codex");
    assert_eq!(ToolScreenProfile::Claude.id(), "claude");
    assert_eq!(ToolScreenProfile::Generic.id(), "generic");

    assert_eq!(
        ToolScreenProfile::Codex.assistant_markers(),
        &["• ", "● ", "⏺ ", "✦ "]
    );
    assert_eq!(
        ToolScreenProfile::Codex.prompt_prefixes(),
        &["› ", "❯ ", "$ ", "> "]
    );
}
