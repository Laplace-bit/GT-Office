use std::collections::BTreeMap;

use crate::models::{
    ClaudeAuthScheme, ClaudeProviderPreset, CodexSnapshot, CodexProviderPreset,
    GeminiAuthMode, GeminiProviderPreset, GeminiSnapshot,
};

pub const CLAUDE_OFFICIAL_PROVIDER_ID: &str = "anthropic-official";
pub const CLAUDE_OFFICIAL_BASE_URL: &str = "https://api.anthropic.com";
pub const CLAUDE_OFFICIAL_MODEL: &str = "claude-sonnet-4-20250514";

fn preset_key(prefix: &str, suffix: &str) -> String {
    format!("aiConfig.preset.{prefix}.{suffix}")
}

fn build_preset(
    key_prefix: &str,
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
        name: preset_key(key_prefix, "name"),
        category: category.to_string(),
        description: preset_key(key_prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.to_string(),
        auth_scheme,
        why_choose: preset_key(key_prefix, "why"),
        best_for: preset_key(key_prefix, "bestFor"),
        requires_billing,
        setup_steps: vec![
            preset_key(key_prefix, "step1"),
            preset_key(key_prefix, "step2"),
            preset_key(key_prefix, "step3"),
        ],
        extra_env,
    }
}

fn build_codex_preset(
    key_prefix: &str,
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
        name: preset_key(key_prefix, "name"),
        category: category.to_string(),
        description: preset_key(key_prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.map(|value| value.to_string()),
        config_template: config_template.to_string(),
        requires_api_key,
        setup_steps: vec![
            preset_key(key_prefix, "step1"),
            preset_key(key_prefix, "step2"),
            preset_key(key_prefix, "step3"),
        ],
    }
}

fn build_codex_china_preset(
    key_prefix: &str,
    provider_id: &str,
    provider_name: &str,
    website_url: &str,
    api_key_url: &str,
    recommended_model: &str,
    endpoint: &str,
) -> CodexProviderPreset {
    CodexProviderPreset {
        provider_id: provider_id.to_string(),
        name: preset_key(key_prefix, "name"),
        category: "aiConfig.category.china".to_string(),
        description: preset_key(key_prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: website_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: Some(endpoint.to_string()),
        config_template: generate_codex_config_template(provider_name, endpoint, recommended_model),
        requires_api_key: true,
        setup_steps: vec![
            preset_key(key_prefix, "step1"),
            preset_key(key_prefix, "step2"),
            preset_key(key_prefix, "step3"),
        ],
    }
}

fn build_gemini_preset(
    key_prefix: &str,
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
        name: preset_key(key_prefix, "name"),
        category: category.to_string(),
        description: preset_key(key_prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: billing_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: endpoint.map(|value| value.to_string()),
        auth_mode,
        selected_type: selected_type.to_string(),
        requires_api_key,
        setup_steps: vec![
            preset_key(key_prefix, "step1"),
            preset_key(key_prefix, "step2"),
            preset_key(key_prefix, "step3"),
        ],
        extra_env,
    }
}

fn build_gemini_china_preset(
    key_prefix: &str,
    provider_id: &str,
    website_url: &str,
    api_key_url: &str,
    recommended_model: &str,
    endpoint: &str,
) -> GeminiProviderPreset {
    GeminiProviderPreset {
        provider_id: provider_id.to_string(),
        name: preset_key(key_prefix, "name"),
        category: "aiConfig.category.china".to_string(),
        description: preset_key(key_prefix, "desc"),
        website_url: website_url.to_string(),
        api_key_url: api_key_url.to_string(),
        billing_url: website_url.to_string(),
        recommended_model: recommended_model.to_string(),
        endpoint: Some(endpoint.to_string()),
        auth_mode: GeminiAuthMode::ApiKey,
        selected_type: GeminiAuthMode::ApiKey.selected_type().to_string(),
        requires_api_key: true,
        setup_steps: vec![
            preset_key(key_prefix, "step1"),
            preset_key(key_prefix, "step2"),
            preset_key(key_prefix, "step3"),
        ],
        extra_env: BTreeMap::new(),
    }
}

fn env_map(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

fn generate_codex_config_template(provider_name: &str, base_url: &str, model: &str) -> String {
    let clean_provider_name = provider_name
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let provider_key = if clean_provider_name.is_empty() {
        "custom".to_string()
    } else {
        clean_provider_name
    };
    format!(
        "model_provider = \"{provider_key}\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{provider_key}]\nname = \"{provider_name}\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
    )
}

pub fn claude_official_provider_preset() -> ClaudeProviderPreset {
    build_preset(
        "anthropic",
        CLAUDE_OFFICIAL_PROVIDER_ID,
        "aiConfig.category.global",
        "https://console.anthropic.com/",
        "https://console.anthropic.com/settings/keys",
        "https://console.anthropic.com/",
        CLAUDE_OFFICIAL_MODEL,
        CLAUDE_OFFICIAL_BASE_URL,
        ClaudeAuthScheme::AnthropicAuthToken,
        true,
        BTreeMap::new(),
    )
}

pub fn claude_provider_presets() -> Vec<ClaudeProviderPreset> {
    vec![
        claude_official_provider_preset(),
        build_preset(
            "deepseek",
            "deepseek",
            "aiConfig.category.china",
            "https://platform.deepseek.com/",
            "https://platform.deepseek.com/api_keys",
            "https://platform.deepseek.com/top_up",
            "DeepSeek-V3.2",
            "https://api.deepseek.com/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "zhipuGlm",
            "zhipu-glm",
            "aiConfig.category.china",
            "https://open.bigmodel.cn/",
            "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
            "https://open.bigmodel.cn/",
            "glm-5",
            "https://open.bigmodel.cn/api/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "zhipuGlmEn",
            "zhipu-glm-en",
            "aiConfig.category.global",
            "https://z.ai/",
            "https://z.ai/subscribe?ic=8JVLJQFSKB",
            "https://z.ai/",
            "glm-5",
            "https://api.z.ai/api/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "qwenCoder",
            "qwen-coder",
            "aiConfig.category.china",
            "https://bailian.console.aliyun.com/",
            "https://bailian.console.aliyun.com/#/api-key",
            "https://expense.console.aliyun.com/",
            "qwen3.5-plus",
            "https://coding.dashscope.aliyuncs.com/apps/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "kimiK2",
            "kimi-k2",
            "aiConfig.category.china",
            "https://platform.moonshot.cn/console",
            "https://platform.moonshot.cn/console/api-keys",
            "https://platform.moonshot.cn/console",
            "kimi-k2.5",
            "https://api.moonshot.cn/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "kimiForCoding",
            "kimi-for-coding",
            "aiConfig.category.china",
            "https://www.kimi.com/coding/docs/",
            "https://platform.moonshot.cn/console/api-keys",
            "https://platform.moonshot.cn/console",
            "kimi-for-coding",
            "https://api.kimi.com/coding/",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "minimax",
            "minimax",
            "aiConfig.category.china",
            "https://platform.minimaxi.com/",
            "https://platform.minimaxi.com/subscribe/coding-plan",
            "https://platform.minimaxi.com/",
            "MiniMax-M2.5",
            "https://api.minimaxi.com/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            env_map(&[
                ("API_TIMEOUT_MS", "3000000"),
                ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
            ]),
        ),
        build_preset(
            "minimaxEn",
            "minimax-en",
            "aiConfig.category.global",
            "https://platform.minimax.io/",
            "https://platform.minimax.io/subscribe/coding-plan",
            "https://platform.minimax.io/",
            "MiniMax-M2.5",
            "https://api.minimax.io/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            env_map(&[
                ("API_TIMEOUT_MS", "3000000"),
                ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
            ]),
        ),
        build_preset(
            "doubaoSeed",
            "doubaoseed",
            "aiConfig.category.china",
            "https://www.volcengine.com/product/doubao",
            "https://www.volcengine.com/product/doubao",
            "https://www.volcengine.com/product/doubao",
            "doubao-seed-2-0-code-preview-latest",
            "https://ark.cn-beijing.volces.com/api/coding",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            env_map(&[("API_TIMEOUT_MS", "3000000")]),
        ),
        build_preset(
            "xiaomiMimo",
            "xiaomi-mimo",
            "aiConfig.category.china",
            "https://platform.xiaomimimo.com/",
            "https://platform.xiaomimimo.com/#/console/api-keys",
            "https://platform.xiaomimimo.com/",
            "mimo-v2-flash",
            "https://api.xiaomimimo.com/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "modelScope",
            "modelscope",
            "aiConfig.category.china",
            "https://modelscope.cn/",
            "https://modelscope.cn/my/myaccesstoken",
            "https://modelscope.cn/",
            "ZhipuAI/GLM-5",
            "https://api-inference.modelscope.cn",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "openRouter",
            "openrouter",
            "aiConfig.category.global",
            "https://openrouter.ai/",
            "https://openrouter.ai/keys",
            "https://openrouter.ai/",
            "anthropic/claude-sonnet-4.6",
            "https://openrouter.ai/api",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "nvidia",
            "nvidia",
            "aiConfig.category.global",
            "https://build.nvidia.com/",
            "https://build.nvidia.com/settings/api-keys",
            "https://build.nvidia.com/",
            "moonshotai/kimi-k2.5",
            "https://integrate.api.nvidia.com",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "katCoder",
            "kat-coder",
            "aiConfig.category.china",
            "https://console.streamlake.ai/",
            "https://console.streamlake.ai/console/api-key",
            "https://console.streamlake.ai/",
            "KAT-Coder-Pro V1",
            "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/YOUR_ENDPOINT_ID/claude-code-proxy",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        build_preset(
            "longcat",
            "longcat",
            "aiConfig.category.china",
            "https://longcat.chat/platform",
            "https://longcat.chat/platform/api_keys",
            "https://longcat.chat/platform",
            "LongCat-Flash-Chat",
            "https://api.longcat.chat/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            env_map(&[
                ("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "6000"),
                ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
            ]),
        ),
        build_preset(
            "baiLing",
            "bailing",
            "aiConfig.category.china",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "Ling-2.5-1T",
            "https://api.tbox.cn/api/anthropic",
            ClaudeAuthScheme::AnthropicAuthToken,
            true,
            BTreeMap::new(),
        ),
        ClaudeProviderPreset {
            provider_id: "custom-gateway".to_string(),
            name: "aiConfig.preset.custom.name".to_string(),
            category: "aiConfig.mode.custom".to_string(),
            description: "aiConfig.preset.custom.desc".to_string(),
            website_url: "https://docs.anthropic.com/".to_string(),
            api_key_url: "https://docs.anthropic.com/".to_string(),
            billing_url: "https://docs.anthropic.com/".to_string(),
            recommended_model: "claude-3-5-sonnet-latest".to_string(),
            endpoint: "https://api.example.com/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "aiConfig.preset.custom.why".to_string(),
            best_for: "aiConfig.preset.custom.bestFor".to_string(),
            requires_billing: false,
            setup_steps: vec![
                "aiConfig.preset.custom.step1".to_string(),
                "aiConfig.preset.custom.step2".to_string(),
                "aiConfig.preset.custom.step3".to_string(),
            ],
            extra_env: BTreeMap::new(),
        },
    ]
}

pub fn codex_provider_presets() -> Vec<CodexProviderPreset> {
    vec![
        build_codex_preset(
            "codexOfficial",
            "codex-official",
            "aiConfig.category.global",
            "https://chatgpt.com/codex",
            "https://chatgpt.com/",
            "https://platform.openai.com/",
            "gpt-5.4",
            None,
            "",
            false,
        ),
        build_codex_preset(
            "codexAzure",
            "azure-openai",
            "aiConfig.category.global",
            "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/codex",
            "https://portal.azure.com/",
            "https://portal.azure.com/",
            "gpt-5.4",
            Some("https://YOUR_RESOURCE_NAME.openai.azure.com/openai"),
            "model_provider = \"azure\"\nmodel = \"gpt-5.4\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.azure]\nname = \"Azure OpenAI\"\nbase_url = \"https://YOUR_RESOURCE_NAME.openai.azure.com/openai\"\nenv_key = \"OPENAI_API_KEY\"\nquery_params = { \"api-version\" = \"2025-04-01-preview\" }\nwire_api = \"responses\"\nrequires_openai_auth = true",
            true,
        ),
        build_codex_preset(
            "codexOpenRouter",
            "openrouter",
            "aiConfig.category.global",
            "https://openrouter.ai/",
            "https://openrouter.ai/keys",
            "https://openrouter.ai/",
            "openai/gpt-5",
            Some("https://openrouter.ai/api/v1"),
            &generate_codex_config_template(
                "openrouter",
                "https://openrouter.ai/api/v1",
                "openai/gpt-5",
            ),
            true,
        ),
        build_codex_china_preset(
            "codexDeepseek",
            "deepseek",
            "DeepSeek",
            "https://platform.deepseek.com/",
            "https://platform.deepseek.com/api_keys",
            "deepseek-chat",
            "https://api.deepseek.com/v1",
        ),
        build_codex_china_preset(
            "codexZhipuGlm",
            "zhipu-glm",
            "Zhipu GLM",
            "https://open.bigmodel.cn/",
            "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
            "glm-5",
            "https://open.bigmodel.cn/api/paas/v4",
        ),
        build_codex_china_preset(
            "codexQwenCoder",
            "qwen-coder",
            "Qwen Coder",
            "https://bailian.console.aliyun.com/",
            "https://bailian.console.aliyun.com/#/api-key",
            "qwen3.5-plus",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ),
        build_codex_china_preset(
            "codexKimiK2",
            "kimi-k2",
            "Kimi K2",
            "https://platform.moonshot.cn/console",
            "https://platform.moonshot.cn/console/api-keys",
            "kimi-k2.5",
            "https://api.moonshot.cn/v1",
        ),
        build_codex_china_preset(
            "codexKimiForCoding",
            "kimi-for-coding",
            "Kimi For Coding",
            "https://www.kimi.com/coding/docs/",
            "https://platform.moonshot.cn/console/api-keys",
            "kimi-for-coding",
            "https://api.kimi.com/v1",
        ),
        build_codex_china_preset(
            "codexMinimax",
            "minimax",
            "MiniMax",
            "https://platform.minimaxi.com/",
            "https://platform.minimaxi.com/subscribe/coding-plan",
            "MiniMax-M2.7",
            "https://api.minimaxi.com/v1",
        ),
        build_codex_china_preset(
            "codexDoubaoSeed",
            "doubaoseed",
            "DouBaoSeed",
            "https://www.volcengine.com/product/doubao",
            "https://www.volcengine.com/product/doubao",
            "doubao-seed-2-0-code-preview-latest",
            "https://ark.cn-beijing.volces.com/api/v3",
        ),
        build_codex_china_preset(
            "codexXiaomiMimo",
            "xiaomi-mimo",
            "Xiaomi MiMo",
            "https://platform.xiaomimimo.com/",
            "https://platform.xiaomimimo.com/#/console/api-keys",
            "mimo-v2-pro",
            "https://api.xiaomimimo.com/v1",
        ),
        build_codex_china_preset(
            "codexModelScope",
            "modelscope",
            "ModelScope",
            "https://modelscope.cn/",
            "https://modelscope.cn/my/myaccesstoken",
            "ZhipuAI/GLM-5",
            "https://api-inference.modelscope.cn/v1",
        ),
        build_codex_china_preset(
            "codexKatCoder",
            "kat-coder",
            "KAT-Coder",
            "https://console.streamlake.ai/",
            "https://console.streamlake.ai/console/api-key",
            "KAT-Coder-Pro",
            "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/YOUR_ENDPOINT_ID/openai",
        ),
        build_codex_china_preset(
            "codexLongcat",
            "longcat",
            "Longcat",
            "https://longcat.chat/platform",
            "https://longcat.chat/platform/api_keys",
            "LongCat-Flash-Chat",
            "https://api.longcat.chat/v1",
        ),
        build_codex_china_preset(
            "codexBaiLing",
            "bailing",
            "BaiLing",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "Ling-2.5-1T",
            "https://api.tbox.cn/v1",
        ),
        build_codex_preset(
            "codexCustom",
            "custom-gateway",
            "aiConfig.mode.custom",
            "https://platform.openai.com/docs/codex/cli",
            "https://platform.openai.com/api-keys",
            "https://platform.openai.com/",
            "gpt-5.4",
            Some("https://api.example.com/v1"),
            &generate_codex_config_template("custom", "https://api.example.com/v1", "gpt-5.4"),
            true,
        ),
    ]
}

pub fn gemini_provider_presets() -> Vec<GeminiProviderPreset> {
    vec![
        build_gemini_preset(
            "geminiOfficial",
            "google-official",
            "aiConfig.category.global",
            "https://ai.google.dev/",
            "https://aistudio.google.com/app/apikey",
            "https://aistudio.google.com/",
            "gemini-2.5-pro",
            Some("https://generativelanguage.googleapis.com"),
            GeminiAuthMode::OAuth,
            GeminiAuthMode::OAuth.selected_type(),
            false,
            BTreeMap::new(),
        ),
        build_gemini_preset(
            "geminiApiKey",
            "google-api-key",
            "aiConfig.category.global",
            "https://ai.google.dev/",
            "https://aistudio.google.com/app/apikey",
            "https://aistudio.google.com/",
            "gemini-2.5-pro",
            Some("https://generativelanguage.googleapis.com"),
            GeminiAuthMode::ApiKey,
            GeminiAuthMode::ApiKey.selected_type(),
            true,
            BTreeMap::new(),
        ),
        build_gemini_preset(
            "geminiOpenRouter",
            "openrouter",
            "aiConfig.category.global",
            "https://openrouter.ai/",
            "https://openrouter.ai/keys",
            "https://openrouter.ai/",
            "google/gemini-2.5-pro",
            Some("https://openrouter.ai/api/v1"),
            GeminiAuthMode::ApiKey,
            GeminiAuthMode::ApiKey.selected_type(),
            true,
            env_map(&[("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")]),
        ),
        build_gemini_china_preset(
            "geminiDeepseek",
            "deepseek",
            "https://platform.deepseek.com/",
            "https://platform.deepseek.com/api_keys",
            "deepseek-chat",
            "https://api.deepseek.com/v1",
        ),
        build_gemini_china_preset(
            "geminiZhipuGlm",
            "zhipu-glm",
            "https://open.bigmodel.cn/",
            "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
            "glm-5",
            "https://open.bigmodel.cn/api/paas/v4",
        ),
        build_gemini_china_preset(
            "geminiQwenCoder",
            "qwen-coder",
            "https://bailian.console.aliyun.com/",
            "https://bailian.console.aliyun.com/#/api-key",
            "qwen3.5-plus",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ),
        build_gemini_china_preset(
            "geminiKimiK2",
            "kimi-k2",
            "https://platform.moonshot.cn/console",
            "https://platform.moonshot.cn/console/api-keys",
            "kimi-k2.5",
            "https://api.moonshot.cn/v1",
        ),
        build_gemini_china_preset(
            "geminiKimiForCoding",
            "kimi-for-coding",
            "https://www.kimi.com/coding/docs/",
            "https://platform.moonshot.cn/console/api-keys",
            "kimi-for-coding",
            "https://api.kimi.com/v1",
        ),
        build_gemini_china_preset(
            "geminiMinimax",
            "minimax",
            "https://platform.minimaxi.com/",
            "https://platform.minimaxi.com/subscribe/coding-plan",
            "MiniMax-M2.7",
            "https://api.minimaxi.com/v1",
        ),
        build_gemini_china_preset(
            "geminiDoubaoSeed",
            "doubaoseed",
            "https://www.volcengine.com/product/doubao",
            "https://www.volcengine.com/product/doubao",
            "doubao-seed-2-0-code-preview-latest",
            "https://ark.cn-beijing.volces.com/api/v3",
        ),
        build_gemini_china_preset(
            "geminiXiaomiMimo",
            "xiaomi-mimo",
            "https://platform.xiaomimimo.com/",
            "https://platform.xiaomimimo.com/#/console/api-keys",
            "mimo-v2-pro",
            "https://api.xiaomimimo.com/v1",
        ),
        build_gemini_china_preset(
            "geminiModelScope",
            "modelscope",
            "https://modelscope.cn/",
            "https://modelscope.cn/my/myaccesstoken",
            "ZhipuAI/GLM-5",
            "https://api-inference.modelscope.cn/v1",
        ),
        build_gemini_china_preset(
            "geminiKatCoder",
            "kat-coder",
            "https://console.streamlake.ai/",
            "https://console.streamlake.ai/console/api-key",
            "KAT-Coder-Pro",
            "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/YOUR_ENDPOINT_ID/openai",
        ),
        build_gemini_china_preset(
            "geminiLongcat",
            "longcat",
            "https://longcat.chat/platform",
            "https://longcat.chat/platform/api_keys",
            "LongCat-Flash-Chat",
            "https://api.longcat.chat/v1",
        ),
        build_gemini_china_preset(
            "geminiBaiLing",
            "bailing",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
            "Ling-2.5-1T",
            "https://api.tbox.cn/v1",
        ),
        build_gemini_preset(
            "geminiCustom",
            "custom-gateway",
            "aiConfig.mode.custom",
            "https://github.com/google-gemini/gemini-cli",
            "https://aistudio.google.com/app/apikey",
            "https://aistudio.google.com/",
            "gemini-2.5-pro",
            Some("https://api.example.com/gemini"),
            GeminiAuthMode::ApiKey,
            GeminiAuthMode::ApiKey.selected_type(),
            true,
            BTreeMap::new(),
        ),
    ]
}

pub fn codex_snapshot_template() -> CodexSnapshot {
    CodexSnapshot {
        title: "aiConfig.agent.codex.title".to_string(),
        summary: "aiConfig.guide.codex.summary".to_string(),
        config_path: Some("~/.codex/config.toml".to_string()),
        docs_url: "https://platform.openai.com/docs/codex/cli".to_string(),
        tips: vec![
            "aiConfig.guide.codex.tip1".to_string(),
            "aiConfig.guide.codex.tip2".to_string(),
            "aiConfig.guide.codex.tip3".to_string(),
        ],
        presets: codex_provider_presets(),
        config: Default::default(),
        mcp_installed: false,
    }
}

pub fn gemini_snapshot_template() -> GeminiSnapshot {
    GeminiSnapshot {
        title: "aiConfig.agent.gemini.title".to_string(),
        summary: "aiConfig.guide.gemini.summary".to_string(),
        config_path: Some("~/.gemini/settings.json".to_string()),
        docs_url: "https://github.com/google-gemini/gemini-cli".to_string(),
        tips: vec![
            "aiConfig.guide.gemini.tip1".to_string(),
            "aiConfig.guide.gemini.tip2".to_string(),
            "aiConfig.guide.gemini.tip3".to_string(),
        ],
        presets: gemini_provider_presets(),
        config: Default::default(),
        mcp_installed: false,
    }
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
            expected.iter().map(|value| value.to_string()).collect::<Vec<_>>()
        );
        assert_eq!(
            codex,
            expected.iter().map(|value| value.to_string()).collect::<Vec<_>>()
        );
        assert_eq!(
            gemini,
            expected.iter().map(|value| value.to_string()).collect::<Vec<_>>()
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
