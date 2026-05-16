use super::*;

#[test]
fn catalog_without_provider_exposes_only_native_commands() {
    let commands = build_catalog_command_list(None, false, false);
    assert!(commands.iter().any(|item| item.id == "claude-clear"));
    assert!(commands.iter().any(|item| item.id == "codex-new"));
    assert!(commands.iter().any(|item| item.id == "gemini-help"));
    assert!(!commands.iter().any(|item| item.id == "launch-claude"));
    assert!(!commands.iter().any(|item| item.id == "open-providers"));
    assert!(!commands.iter().any(|item| item.id == "open-channels"));
}

#[test]
fn claude_catalog_includes_aliases_effort_variants_and_skills() {
    let commands = build_catalog_command_list(Some(AgentToolKind::Claude), true, false);

    let new_command = commands
        .iter()
        .find(|item| item.id == "claude-new")
        .expect("new");
    assert_eq!(new_command.slash_command.as_deref(), Some("/new"));

    let clear = commands
        .iter()
        .find(|item| item.id == "claude-clear")
        .expect("clear");
    assert_eq!(clear.slash_command.as_deref(), Some("/clear"));

    let effort = commands
        .iter()
        .find(|item| item.id == "claude-effort")
        .expect("effort");
    assert_eq!(effort.presentation, ToolCommandPresentation::Sheet);
    assert_eq!(effort.slash_command.as_deref(), Some("/effort"));
    assert_eq!(effort.arguments.len(), 1);
    assert_eq!(effort.arguments[0].options.len(), 5);

    let effort_max = commands
        .iter()
        .find(|item| item.id == "claude-effort-max")
        .expect("effort max");
    assert_eq!(effort_max.slash_command.as_deref(), Some("/effort max"));
    assert_eq!(effort_max.command_family, ToolCommandFamily::BuiltIn);

    let model = commands
        .iter()
        .find(|item| item.id == "claude-model")
        .expect("model");
    assert_eq!(model.presentation, ToolCommandPresentation::Direct);
    assert!(matches!(
        model.execution,
        ToolCommandExecution::InsertText { submit: true, .. }
    ));
    assert!(model.arguments.is_empty());

    let loop_command = commands
        .iter()
        .find(|item| item.id == "claude-loop")
        .expect("loop");
    assert_eq!(loop_command.danger_level, ToolCommandDangerLevel::Expensive);
    assert_eq!(loop_command.command_family, ToolCommandFamily::BundledSkill);

    assert!(commands.iter().any(|item| item.id == "claude-diff"));
    assert!(commands.iter().any(|item| item.id == "claude-context"));
    assert!(commands.iter().any(|item| item.id == "claude-plan"));
}

#[test]
fn codex_catalog_includes_official_native_commands() {
    let commands = build_catalog_command_list(Some(AgentToolKind::Codex), true, false);

    for id in [
        "codex-new",
        "codex-model",
        "codex-review",
        "codex-permissions",
        "codex-status",
        "codex-diff",
        "codex-fast-on",
        "codex-plan",
        "codex-agent",
        "codex-mention",
        "codex-mcp",
    ] {
        assert!(commands.iter().any(|item| item.id == id), "{id}");
    }

    let model = commands
        .iter()
        .find(|item| item.id == "codex-model")
        .expect("model");
    assert_eq!(model.presentation, ToolCommandPresentation::Direct);
    assert!(matches!(
        model.execution,
        ToolCommandExecution::InsertText { submit: true, .. }
    ));
    assert!(model.arguments.is_empty());
}

#[test]
fn gemini_catalog_includes_official_native_commands() {
    let commands = build_catalog_command_list(Some(AgentToolKind::Gemini), true, false);

    for id in [
        "gemini-help",
        "gemini-resume",
        "gemini-model",
        "gemini-mcp-list",
        "gemini-memory-show",
        "gemini-settings",
        "gemini-tools-desc",
        "gemini-vim",
    ] {
        assert!(commands.iter().any(|item| item.id == id), "{id}");
    }

    let model = commands
        .iter()
        .find(|item| item.id == "gemini-model")
        .expect("model");
    assert_eq!(model.presentation, ToolCommandPresentation::Direct);
    assert!(matches!(
        model.execution,
        ToolCommandExecution::InsertText { submit: true, .. }
    ));
    assert!(model.arguments.is_empty());
}

#[test]
fn detached_readonly_disables_provider_writes() {
    let claude_commands = build_catalog_command_list(Some(AgentToolKind::Claude), false, true);
    let help = claude_commands
        .iter()
        .find(|item| item.id == "claude-help")
        .expect("help");
    assert!(!help.enabled);
    assert_eq!(
        help.disabled_reason.as_deref(),
        Some("Detached windows are read only")
    );

    let codex_commands = build_catalog_command_list(Some(AgentToolKind::Codex), false, true);
    let review = codex_commands
        .iter()
        .find(|item| item.id == "codex-review")
        .expect("review");
    assert!(!review.enabled);
    assert_eq!(
        review.disabled_reason.as_deref(),
        Some("Detached windows are read only")
    );

    let gemini_commands = build_catalog_command_list(Some(AgentToolKind::Gemini), false, true);
    let help = gemini_commands
        .iter()
        .find(|item| item.id == "gemini-help")
        .expect("help");
    assert!(!help.enabled);
    assert_eq!(
        help.disabled_reason.as_deref(),
        Some("Detached windows are read only")
    );
}

#[test]
fn command_catalog_entries_remain_slash_command_terminal_actions() {
    let commands = build_catalog_command_list(None, true, false);

    for command in commands {
        assert_eq!(
            command.surface_target,
            ToolCommandSurfaceTarget::Terminal,
            "{} surface target",
            command.id
        );
        assert_eq!(
            command.scope_kind,
            ToolCommandScopeKind::Station,
            "{} scope kind",
            command.id
        );
        assert!(
            command
                .slash_command
                .as_deref()
                .is_some_and(|value| value.starts_with('/')),
            "{} slash command",
            command.id
        );
        assert!(matches!(
            command.execution,
            ToolCommandExecution::InsertText { .. } | ToolCommandExecution::OpenCommandSheet { .. }
        ));

        if command.presentation == ToolCommandPresentation::Sheet {
            for argument in &command.arguments {
                assert!(matches!(
                    argument.kind,
                    ToolCommandArgumentKind::Text
                        | ToolCommandArgumentKind::MultilineText
                        | ToolCommandArgumentKind::Enum
                        | ToolCommandArgumentKind::Duration
                        | ToolCommandArgumentKind::Path
                        | ToolCommandArgumentKind::Boolean
                ));
            }
        }
    }
}

#[test]
fn only_truly_parameterized_commands_use_custom_sheets() {
    let commands = build_catalog_command_list(None, true, false);
    let sheet_ids = commands
        .iter()
        .filter(|command| command.presentation == ToolCommandPresentation::Sheet)
        .map(|command| command.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        sheet_ids,
        vec![
            "claude-effort",
            "claude-add-dir",
            "claude-batch",
            "claude-loop",
            "gemini-chat-delete",
            "gemini-chat-resume",
            "gemini-chat-save",
            "gemini-directory-add",
            "gemini-memory-add",
        ]
    );
}
