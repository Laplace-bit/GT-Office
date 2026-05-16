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
