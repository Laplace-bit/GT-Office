use super::WebhookTokens;

#[test]
fn webhook_tokens_new_generates_uuids() {
    let tokens = WebhookTokens::new();
    assert!(!tokens.feishu_token.is_empty());
    assert!(!tokens.telegram_token.is_empty());
    assert_ne!(tokens.feishu_token, tokens.telegram_token);
}

#[test]
fn webhook_tokens_persist_and_load() {
    let dir =
        std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let original = WebhookTokens::new();
    let path = dir.join("tokens.json");
    original.save_to_path(&path).unwrap();

    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert_eq!(original.feishu_token, loaded.feishu_token);
    assert_eq!(original.telegram_token, loaded.telegram_token);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn webhook_tokens_load_returns_new_if_file_missing() {
    let dir =
        std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let path = dir.join("nonexistent.json");
    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert!(!loaded.feishu_token.is_empty());
    assert!(!loaded.telegram_token.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn webhook_tokens_load_returns_new_if_file_invalid() {
    let dir =
        std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let path = dir.join("invalid.json");
    std::fs::write(&path, "not json").unwrap();
    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert!(!loaded.feishu_token.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}
