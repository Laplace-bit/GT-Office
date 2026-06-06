use super::{
    normalize_endpoint, parse_simple_env_file, read_live_claude_draft, read_live_codex_draft,
};
use gt_ai_config::{ClaudeAuthScheme, ClaudeProviderMode, CodexProviderMode};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_home(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("gto-ai-config-import-{name}-{suffix}"));
    fs::create_dir_all(&path).expect("create temp home");
    path
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(path, content).expect("write file");
}

#[test]
fn normalize_endpoint_trims_spaces_and_trailing_slashes() {
    assert_eq!(
        normalize_endpoint(" https://example.com/// "),
        "https://example.com"
    );
}

#[test]
fn parse_simple_env_file_skips_comments_and_unquotes_values() {
    let home = temp_home("env");
    let env_path = home.join(".fixture").join(".env");
    write_file(
        &env_path,
        r#"
            # ignored
            TEST_API_KEY = " key-1 "
            TEST_BASE_URL=' https://gateway.example.com/ '
            INVALID
            =missing-key
            "#,
    );

    let env = parse_simple_env_file(&env_path);

    assert_eq!(env.get("TEST_API_KEY").map(String::as_str), Some(" key-1 "));
    assert_eq!(
        env.get("TEST_BASE_URL").map(String::as_str),
        Some(" https://gateway.example.com/ ")
    );
    assert!(!env.contains_key("INVALID"));
}

#[test]
fn read_live_claude_draft_imports_custom_gateway() {
    let home = temp_home("claude");
    write_file(
        &home.join(".claude").join("settings.json"),
        r#"{
              "env": {
                "ANTHROPIC_AUTH_TOKEN": " token-1 ",
                "ANTHROPIC_BASE_URL": " https://gateway.example.com/// ",
                "ANTHROPIC_MODEL": " claude-opus "
              }
            }"#,
    );

    let draft = read_live_claude_draft(&home).expect("claude draft");

    assert_eq!(draft.mode, ClaudeProviderMode::Custom);
    assert_eq!(draft.provider_name.as_deref(), Some("Custom Gateway"));
    assert_eq!(
        draft.base_url.as_deref(),
        Some("https://gateway.example.com")
    );
    assert_eq!(draft.model.as_deref(), Some("claude-opus"));
    assert_eq!(
        draft.auth_scheme,
        Some(ClaudeAuthScheme::AnthropicAuthToken)
    );
    assert_eq!(draft.api_key.as_deref(), Some("token-1"));
}

#[test]
fn read_live_claude_draft_requires_env_or_secret() {
    let home = temp_home("claude-missing");
    write_file(
        &home.join(".claude").join("settings.json"),
        r#"{"env": {}}"#,
    );

    let error = read_live_claude_draft(&home).expect_err("missing claude config");

    assert_eq!(
        error,
        "AI_CONFIG_IMPORT_FAILED: no Claude provider configuration found in ~/.claude/settings.json"
    );
}

#[test]
fn read_live_claude_draft_imports_official_api_key_when_no_base_url() {
    let home = temp_home("claude-official");
    write_file(
        &home.join(".claude").join("settings.json"),
        r#"{"env": {"ANTHROPIC_API_KEY": " api-key-1 "}}"#,
    );

    let draft = read_live_claude_draft(&home).expect("claude official draft");

    assert_eq!(draft.mode, ClaudeProviderMode::Official);
    assert_eq!(draft.base_url, None);
    assert_eq!(draft.model, None);
    assert_eq!(draft.auth_scheme, None);
    assert_eq!(draft.api_key.as_deref(), Some("api-key-1"));
}

#[test]
fn read_live_codex_draft_imports_custom_provider_from_config_and_auth() {
    let home = temp_home("codex");
    write_file(
        &home.join(".codex").join("config.toml"),
        r#"
            model_provider = "my_gateway"
            model = "gpt-custom"

            [model_providers.my_gateway]
            base_url = " https://gateway.example.com/v1/// "
            "#,
    );
    write_file(
        &home.join(".codex").join("auth.json"),
        r#"{"OPENAI_API_KEY": " sk-test "}"#,
    );

    let draft = read_live_codex_draft(&home).expect("codex draft");

    assert_eq!(draft.mode, CodexProviderMode::Custom);
    assert_eq!(draft.provider_name.as_deref(), Some("my gateway"));
    assert_eq!(
        draft.base_url.as_deref(),
        Some("https://gateway.example.com/v1")
    );
    assert_eq!(draft.model.as_deref(), Some("gpt-custom"));
    assert_eq!(draft.api_key.as_deref(), Some("sk-test"));
    assert!(draft
        .config_toml
        .as_deref()
        .unwrap_or("")
        .contains("model_provider"));
}

#[test]
fn read_live_codex_draft_reports_invalid_toml_and_missing_config() {
    let invalid_home = temp_home("codex-invalid");
    write_file(
        &invalid_home.join(".codex").join("config.toml"),
        "not = [toml",
    );
    let invalid = read_live_codex_draft(&invalid_home).expect_err("invalid toml");
    assert!(invalid.starts_with("AI_CONFIG_IMPORT_FAILED: invalid Codex config.toml:"));

    let empty_home = temp_home("codex-empty");
    let missing = read_live_codex_draft(&empty_home).expect_err("missing codex config");
    assert_eq!(
        missing,
        "AI_CONFIG_IMPORT_FAILED: no Codex provider configuration found in ~/.codex"
    );
}

#[test]
fn read_live_codex_draft_imports_official_when_only_auth_exists() {
    let home = temp_home("codex-official");
    write_file(
        &home.join(".codex").join("auth.json"),
        r#"{"OPENAI_API_KEY": " sk-official "}"#,
    );

    let draft = read_live_codex_draft(&home).expect("codex official draft");

    assert_eq!(draft.mode, CodexProviderMode::Official);
    assert_eq!(draft.base_url, None);
    assert_eq!(draft.model, None);
    assert_eq!(draft.api_key.as_deref(), Some("sk-official"));
    assert_eq!(draft.config_toml, None);
}
