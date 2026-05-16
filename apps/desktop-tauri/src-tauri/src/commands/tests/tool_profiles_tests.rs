use super::*;
use serde_json::json;

#[test]
fn canonical_profile_tool_kind_supports_cli_aliases() {
    assert_eq!(
        canonical_profile_tool_kind("claude"),
        Some(AgentToolKind::Claude)
    );
    assert_eq!(
        canonical_profile_tool_kind("claude-code"),
        Some(AgentToolKind::Claude)
    );
    assert_eq!(
        canonical_profile_tool_kind("codex-cli"),
        Some(AgentToolKind::Codex)
    );
    assert_eq!(
        canonical_profile_tool_kind("gemini"),
        Some(AgentToolKind::Gemini)
    );
    assert_eq!(canonical_profile_tool_kind("shell"), None);
}

#[test]
fn resolve_launch_cwd_joins_relative_station_paths_to_workspace_root() {
    let workspace_root = PathBuf::from("/tmp/gto-workspace");
    let context = json!({
        "agentWorkdirRel": ".gtoffice/org/build/agent-01"
    });

    let resolved = resolve_launch_cwd(Some(&context), &workspace_root).expect("resolved cwd");
    assert_eq!(
        PathBuf::from(resolved),
        workspace_root.join(".gtoffice/org/build/agent-01")
    );
}

#[test]
fn build_initial_prompt_includes_primary_text_files_and_selection() {
    let context = json!({
        "prompt": "Review the latest changes.",
        "files": ["src/main.rs", "Cargo.toml"],
        "selection": "Focus on the launch flow.",
        "notes": "Keep the diff small.",
    });

    let prompt = build_initial_prompt(Some(&context)).expect("prompt");
    assert!(prompt.contains("Review the latest changes."));
    assert!(prompt.contains("Relevant files:\n- src/main.rs\n- Cargo.toml"));
    assert!(prompt.contains("Selection:\nFocus on the launch flow."));
    assert!(prompt.contains("Notes:\nKeep the diff small."));
}
