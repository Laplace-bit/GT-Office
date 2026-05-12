use std::collections::BTreeMap;

use crate::models::{
    ClaudeAuthScheme, ClaudeProviderPreset, CodexProviderPreset, GeminiAuthMode,
    GeminiProviderPreset,
};

#[path = "catalog_claude_core.rs"]
mod catalog_claude_core;
#[path = "catalog_claude_partners.rs"]
mod catalog_claude_partners;
#[path = "catalog_codex.rs"]
mod catalog_codex;
#[path = "catalog_gemini.rs"]
mod catalog_gemini;
#[path = "catalog_snapshots.rs"]
mod catalog_snapshots;

pub use catalog_claude_core::{claude_official_provider_preset, claude_provider_presets};
pub use catalog_codex::codex_provider_presets;
pub use catalog_gemini::gemini_provider_presets;
pub use catalog_snapshots::{codex_snapshot_template, gemini_snapshot_template};

pub const CLAUDE_OFFICIAL_PROVIDER_ID: &str = "anthropic-official";
pub const CLAUDE_OFFICIAL_BASE_URL: &str = "https://api.anthropic.com";
pub const CLAUDE_OFFICIAL_MODEL: &str = "claude-sonnet-4-20250514";

fn preset_key(prefix: &str, suffix: &str) -> String {
    format!("aiConfig.preset.{prefix}.{suffix}")
}

fn build_preset(
    prefix: &str,
    provider_id: &str,
    category: &str,
    website_url: &str,
    api_key_url: &str,
    billing_url: &str,
    recommended_model: &str,
    endpoint: &str,
    auth_scheme: ClaudeAuthScheme,
    requires_billing: bool,
    extra_env: BTreeMap<String, String>,
) -> ClaudeProviderPreset {
    ClaudeProviderPreset {
        provider_id: provider_id.to_string(),
        name: preset_key(prefix, "name"),
        category: category.to_string(),
        description: preset_key(prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.to_string(),
        auth_scheme,
        why_choose: preset_key(prefix, "why"),
        best_for: preset_key(prefix, "bestFor"),
        requires_billing,
        setup_steps: vec![
            preset_key(prefix, "step1"),
            preset_key(prefix, "step2"),
            preset_key(prefix, "step3"),
        ],
        extra_env,
    }
}

fn build_literal_claude_preset(
    prefix: &str,
    display_name: &str,
    category: &str,
    website_url: &str,
    api_key_url: &str,
    billing_url: &str,
    recommended_model: &str,
    endpoint: &str,
    auth_scheme: ClaudeAuthScheme,
    requires_billing: bool,
    extra_env: BTreeMap<String, String>,
) -> ClaudeProviderPreset {
    let mut preset = build_preset(
        prefix,
        prefix,
        category,
        website_url,
        api_key_url,
        billing_url,
        recommended_model,
        endpoint,
        auth_scheme,
        requires_billing,
        extra_env,
    );
    preset.name = display_name.to_string();
    preset
}

fn build_codex_preset(
    prefix: &str,
    provider_id: &str,
    category: &str,
    website_url: &str,
    api_key_url: &str,
    billing_url: &str,
    recommended_model: &str,
    endpoint: Option<&str>,
    config_template: &str,
    requires_api_key: bool,
) -> CodexProviderPreset {
    CodexProviderPreset {
        provider_id: provider_id.to_string(),
        name: preset_key(prefix, "name"),
        category: category.to_string(),
        description: preset_key(prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.map(str::to_string),
        config_template: config_template.to_string(),
        requires_api_key,
        setup_steps: vec![
            preset_key(prefix, "step1"),
            preset_key(prefix, "step2"),
            preset_key(prefix, "step3"),
        ],
    }
}

fn build_literal_codex_preset(
    prefix: &str,
    display_name: &str,
    category: &str,
    website_url: &str,
    api_key_url: &str,
    billing_url: &str,
    recommended_model: &str,
    endpoint: &str,
) -> CodexProviderPreset {
    let mut preset = build_codex_preset(
        prefix,
        prefix,
        category,
        website_url,
        api_key_url,
        billing_url,
        recommended_model,
        Some(endpoint),
        &generate_codex_config_template(display_name, endpoint, recommended_model),
        true,
    );
    preset.name = display_name.to_string();
    preset
}

fn build_codex_china_preset(
    prefix: &str,
    provider_id: &str,
    display_name: &str,
    website_url: &str,
    api_key_url: &str,
    recommended_model: &str,
    endpoint: &str,
) -> CodexProviderPreset {
    build_codex_preset(
        prefix,
        provider_id,
        "aiConfig.category.china",
        website_url,
        api_key_url,
        website_url,
        recommended_model,
        Some(endpoint),
        &generate_codex_config_template(display_name, endpoint, recommended_model),
        true,
    )
}

fn build_gemini_preset(
    prefix: &str,
    provider_id: &str,
    category: &str,
    website_url: &str,
    api_key_url: &str,
    billing_url: &str,
    recommended_model: &str,
    endpoint: Option<&str>,
    auth_mode: GeminiAuthMode,
    selected_type: &str,
    requires_api_key: bool,
    extra_env: BTreeMap<String, String>,
) -> GeminiProviderPreset {
    GeminiProviderPreset {
        provider_id: provider_id.to_string(),
        name: preset_key(prefix, "name"),
        category: category.to_string(),
        description: preset_key(prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.map(str::to_string),
        auth_mode,
        selected_type: selected_type.to_string(),
        requires_api_key,
        setup_steps: vec![
            preset_key(prefix, "step1"),
            preset_key(prefix, "step2"),
            preset_key(prefix, "step3"),
        ],
        extra_env,
    }
}

fn build_gemini_china_preset(
    prefix: &str,
    provider_id: &str,
    website_url: &str,
    api_key_url: &str,
    recommended_model: &str,
    endpoint: &str,
) -> GeminiProviderPreset {
    build_gemini_preset(
        prefix,
        provider_id,
        "aiConfig.category.china",
        website_url,
        api_key_url,
        website_url,
        recommended_model,
        Some(endpoint),
        GeminiAuthMode::ApiKey,
        GeminiAuthMode::ApiKey.selected_type(),
        true,
        BTreeMap::new(),
    )
}

fn env_map(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

fn generate_codex_config_template(provider_name: &str, base_url: &str, model: &str) -> String {
    format!(
        "model_provider = \"{provider_name}\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{provider_name}]\nname = \"{provider_name}\"\nbase_url = \"{base_url}\"\nenv_key = \"OPENAI_API_KEY\"\nwire_api = \"responses\""
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_china_provider_ids() -> Vec<&'static str> {
        vec![
            "deepseek",
            "zhipu-glm",
            "qwen-coder",
            "kimi-k2",
            "kimi-for-coding",
            "minimax",
            "doubaoseed",
            "xiaomi-mimo",
            "modelscope",
            "kat-coder",
            "longcat",
            "bailing",
        ]
    }

    #[test]
    fn codex_and_gemini_china_suppliers_match_claude_direction() {
        let expected = expected_china_provider_ids();
        let claude = claude_provider_presets()
            .into_iter()
            .filter(|preset| preset.category == "aiConfig.category.china")
            .filter(|preset| preset.provider_id != "stepfun" && preset.provider_id != "siliconflow")
            .map(|preset| preset.provider_id)
            .collect::<Vec<_>>();
        let codex = codex_provider_presets()
            .into_iter()
            .filter(|preset| preset.category == "aiConfig.category.china")
            .map(|preset| preset.provider_id)
            .collect::<Vec<_>>();
        let gemini = gemini_provider_presets()
            .into_iter()
            .filter(|preset| preset.category == "aiConfig.category.china")
            .map(|preset| preset.provider_id)
            .collect::<Vec<_>>();

        assert_eq!(
            claude,
            expected
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            codex,
            expected
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            gemini,
            expected
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn codex_and_gemini_china_presets_keep_translation_keys() {
        for preset in codex_provider_presets()
            .into_iter()
            .filter(|preset| preset.category == "aiConfig.category.china")
        {
            assert!(preset.name.starts_with("aiConfig.preset."));
            assert!(preset.description.starts_with("aiConfig.preset."));
            assert_eq!(preset.setup_steps.len(), 3);
            assert!(preset
                .setup_steps
                .iter()
                .all(|step| step.starts_with("aiConfig.preset.")));
        }

        for preset in gemini_provider_presets()
            .into_iter()
            .filter(|preset| preset.category == "aiConfig.category.china")
        {
            assert!(preset.name.starts_with("aiConfig.preset."));
            assert!(preset.description.starts_with("aiConfig.preset."));
            assert_eq!(preset.setup_steps.len(), 3);
            assert!(preset
                .setup_steps
                .iter()
                .all(|step| step.starts_with("aiConfig.preset.")));
        }
    }
}
