use super::*;

#[test]
fn claude_provider_env_injection_is_disabled_for_hot_switching() {
    assert!(!should_inject_provider_env(AgentToolKind::Claude, true));
}

#[test]
fn codex_provider_env_injection_remains_enabled() {
    assert!(should_inject_provider_env(AgentToolKind::Codex, true));
    assert!(!should_inject_provider_env(AgentToolKind::Codex, false));
}

#[test]
fn provider_env_injection_ignores_non_provider_tools() {
    assert!(!should_inject_provider_env(AgentToolKind::Shell, true));
    assert!(!should_inject_provider_env(AgentToolKind::Unknown, true));
}

#[test]
fn terminal_command_path_uses_a_compact_bootstrap_when_callers_do_not_supply_path() {
    let path = terminal_command_path_base(None);
    let expected = terminal_command_bootstrap_path()
        .split(terminal_command_path_separator())
        .map(str::to_string)
        .collect::<Vec<_>>();

    assert_eq!(path, expected);
    assert!(terminal_command_path_parts_len(&path) <= TERMINAL_COMMAND_PATH_MAX_BYTES);
}

#[test]
fn terminal_command_path_bounds_an_explicitly_bloated_path() {
    let oversized = (0..2048)
        .map(|index| format!("/very/long/custom/bin/{index:04}"))
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });

    let path = terminal_command_path_base(Some(&oversized));

    assert!(terminal_command_path_parts_len(&path) <= TERMINAL_COMMAND_PATH_MAX_BYTES);
    assert_eq!(
        path.first().map(String::as_str),
        Some("/very/long/custom/bin/0000")
    );
}

#[test]
fn agent_tool_kind_from_param_normalizes_known_values() {
    assert_eq!(
        agent_tool_kind_from_param(Some(" Claude ".to_string())),
        AgentToolKind::Claude
    );
    assert_eq!(
        agent_tool_kind_from_param(Some("CODEX".to_string())),
        AgentToolKind::Codex
    );
    assert_eq!(
        agent_tool_kind_from_param(Some("legacy-removed".to_string())),
        AgentToolKind::Unknown
    );
    assert_eq!(
        agent_tool_kind_from_param(Some("shell".to_string())),
        AgentToolKind::Shell
    );
    assert_eq!(agent_tool_kind_from_param(None), AgentToolKind::Unknown);
    assert_eq!(
        agent_tool_kind_from_param(Some("other".to_string())),
        AgentToolKind::Unknown
    );
}

#[test]
fn normalize_endpoint_url_trims_spaces_and_trailing_slashes() {
    assert_eq!(
        normalize_endpoint_url(" https://api.example.com/v1/// "),
        "https://api.example.com/v1"
    );
}

#[test]
fn strip_compat_suffix_removes_known_proxy_suffixes() {
    assert_eq!(
        strip_compat_suffix("https://proxy.example.com/api/anthropic"),
        Some("https://proxy.example.com")
    );
    assert_eq!(
        strip_compat_suffix("https://proxy.example.com/unknown"),
        None
    );
}

#[test]
fn build_models_url_candidates_honors_override_and_empty_base() {
    assert_eq!(
        build_models_url_candidates(
            " https://ignored.example.com ",
            false,
            Some(" https://models.example.com/list ")
        )
        .expect("override"),
        vec!["https://models.example.com/list".to_string()]
    );

    let error = build_models_url_candidates("   ", false, None).expect_err("empty base");
    assert_eq!(error, "AI_CONFIG_FETCH_MODELS_FAILED: base url is empty");
}

#[test]
fn build_models_url_candidates_handles_base_and_compat_suffixes() {
    assert_eq!(
        build_models_url_candidates("https://api.example.com/v1", false, None).expect("v1 base"),
        vec!["https://api.example.com/v1/models".to_string()]
    );

    assert_eq!(
        build_models_url_candidates("https://api.example.com", false, None).expect("root base"),
        vec!["https://api.example.com/v1/models".to_string()]
    );

    assert_eq!(
        build_models_url_candidates("https://proxy.example.com/api/anthropic", false, None)
            .expect("compat base"),
        vec![
            "https://proxy.example.com/api/anthropic/v1/models".to_string(),
            "https://proxy.example.com/v1/models".to_string(),
            "https://proxy.example.com/models".to_string(),
        ]
    );
}

#[test]
fn build_models_url_candidates_derives_from_full_url() {
    assert_eq!(
        build_models_url_candidates(
            "https://gateway.example.com/openai/v1/chat/completions",
            true,
            None,
        )
        .expect("full v1 url"),
        vec!["https://gateway.example.com/openai/v1/models".to_string()]
    );

    assert_eq!(
        build_models_url_candidates("https://gateway.example.com/openai/chat", true, None)
            .expect("full non-v1 url"),
        vec!["https://gateway.example.com/openai/v1/models".to_string()]
    );

    let error = build_models_url_candidates("no-slash", true, None).expect_err("bad full url");
    assert_eq!(
        error,
        "AI_CONFIG_FETCH_MODELS_FAILED: cannot derive models endpoint from full url"
    );
}

#[test]
fn truncate_error_body_limits_by_chars() {
    assert_eq!(truncate_error_body("short".to_string()), "short");

    let body = "界".repeat(AI_CONFIG_MAX_ERROR_BODY_CHARS + 2);
    let truncated = truncate_error_body(body);

    assert_eq!(
        truncated.chars().count(),
        AI_CONFIG_MAX_ERROR_BODY_CHARS + 1
    );
    assert!(truncated.ends_with('…'));
}

#[tokio::test]
async fn ai_config_test_endpoints_reports_empty_and_invalid_urls_without_network() {
    let results =
        ai_config_test_endpoints(vec!["   ".to_string(), "not a url".to_string()], Some(1))
            .await
            .expect("endpoint results");

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].error.as_deref(), Some("Empty URL"));
    assert!(results[1]
        .error
        .as_deref()
        .unwrap_or("")
        .starts_with("Invalid URL:"));
}
