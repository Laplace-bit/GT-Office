use crate::models::{ClaudeAuthScheme, ClaudeProviderPreset, LightAgentGuide};

pub fn claude_provider_presets() -> Vec<ClaudeProviderPreset> {
    vec![
        ClaudeProviderPreset {
            provider_id: "anthropic-official".to_string(),
            name: "Anthropic Official".to_string(),
            category: "official".to_string(),
            description: "Use Anthropic's official Claude API endpoint.".to_string(),
            website_url: "https://www.anthropic.com/".to_string(),
            api_key_url: "https://console.anthropic.com/settings/keys".to_string(),
            billing_url: "https://console.anthropic.com/settings/plans".to_string(),
            recommended_model: "claude-sonnet-4-5".to_string(),
            endpoint: "https://api.anthropic.com".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Best compatibility when you want the default Claude API behavior."
                .to_string(),
            best_for: "Teams that want the official Anthropic billing and support path."
                .to_string(),
            requires_billing: true,
            setup_steps: vec![
                "Open Anthropic Console.".to_string(),
                "Add billing if your account is new.".to_string(),
                "Create an API key and paste it below.".to_string(),
            ],
        },
        ClaudeProviderPreset {
            provider_id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            category: "gateway".to_string(),
            description: "Anthropic-compatible gateway for lower-cost coding usage.".to_string(),
            website_url: "https://platform.deepseek.com/".to_string(),
            api_key_url: "https://platform.deepseek.com/api_keys".to_string(),
            billing_url: "https://platform.deepseek.com/top_up".to_string(),
            recommended_model: "deepseek-chat".to_string(),
            endpoint: "https://api.deepseek.com/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Strong price/performance when you want a Claude-compatible endpoint."
                .to_string(),
            best_for: "Users optimizing token cost and comfortable with a gateway provider."
                .to_string(),
            requires_billing: true,
            setup_steps: vec![
                "Register a DeepSeek platform account.".to_string(),
                "Recharge your balance if the account is empty.".to_string(),
                "Create an API key for the Anthropic-compatible endpoint.".to_string(),
            ],
        },
        ClaudeProviderPreset {
            provider_id: "kimi".to_string(),
            name: "Kimi For Coding".to_string(),
            category: "gateway".to_string(),
            description: "Moonshot Kimi gateway with Claude-style routing for coding workflows."
                .to_string(),
            website_url: "https://platform.moonshot.cn/".to_string(),
            api_key_url: "https://platform.moonshot.cn/console/api-keys".to_string(),
            billing_url: "https://platform.moonshot.cn/console/billing".to_string(),
            recommended_model: "kimi-k2-0711-preview".to_string(),
            endpoint: "https://api.moonshot.cn/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Good for users already using Kimi and wanting a single vendor stack."
                .to_string(),
            best_for: "China-based teams that want local billing and a familiar platform."
                .to_string(),
            requires_billing: true,
            setup_steps: vec![
                "Create a Moonshot platform account.".to_string(),
                "Complete recharge or quota purchase.".to_string(),
                "Create an API key for the coding endpoint.".to_string(),
            ],
        },
        ClaudeProviderPreset {
            provider_id: "bailian".to_string(),
            name: "Bailian For Coding".to_string(),
            category: "gateway".to_string(),
            description: "Alibaba Cloud Bailian gateway for enterprise procurement scenarios."
                .to_string(),
            website_url: "https://bailian.console.aliyun.com/".to_string(),
            api_key_url: "https://ram.console.aliyun.com/manage/ak".to_string(),
            billing_url: "https://expense.console.aliyun.com/".to_string(),
            recommended_model: "qwen-plus-latest".to_string(),
            endpoint: "https://dashscope.aliyuncs.com/compatible-mode/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Useful when procurement, invoicing, and org controls are on Alibaba Cloud."
                .to_string(),
            best_for: "Enterprise buyers that need company billing and permissions controls."
                .to_string(),
            requires_billing: true,
            setup_steps: vec![
                "Enable DashScope or Bailian for the Alibaba Cloud account.".to_string(),
                "Make sure the account has billing enabled.".to_string(),
                "Create an AccessKey or API key with the required permissions.".to_string(),
            ],
        },
        ClaudeProviderPreset {
            provider_id: "stepfun".to_string(),
            name: "StepFun".to_string(),
            category: "gateway".to_string(),
            description: "StepFun gateway for users who prefer a domestic provider panel."
                .to_string(),
            website_url: "https://platform.stepfun.com/".to_string(),
            api_key_url: "https://platform.stepfun.com/console/api-keys".to_string(),
            billing_url: "https://platform.stepfun.com/console/billing".to_string(),
            recommended_model: "step-2-mini".to_string(),
            endpoint: "https://api.stepfun.com/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Single-panel experience with a lightweight onboarding path.".to_string(),
            best_for: "Users who want fast setup and a domestic payment workflow.".to_string(),
            requires_billing: true,
            setup_steps: vec![
                "Register a StepFun platform account.".to_string(),
                "Recharge or activate billing quota.".to_string(),
                "Create an API key and copy it into GT Office.".to_string(),
            ],
        },
        ClaudeProviderPreset {
            provider_id: "custom-gateway".to_string(),
            name: "Custom Gateway".to_string(),
            category: "custom".to_string(),
            description: "Bring your own Anthropic-compatible endpoint, model, and API key."
                .to_string(),
            website_url: "https://docs.anthropic.com/".to_string(),
            api_key_url: "https://docs.anthropic.com/".to_string(),
            billing_url: "https://docs.anthropic.com/".to_string(),
            recommended_model: "claude-sonnet-4-5".to_string(),
            endpoint: "https://api.example.com/anthropic".to_string(),
            auth_scheme: ClaudeAuthScheme::AnthropicApiKey,
            why_choose: "Full control when you already have a proxy, relay, or enterprise gateway."
                .to_string(),
            best_for: "Advanced users or internal platforms managing their own endpoint."
                .to_string(),
            requires_billing: false,
            setup_steps: vec![
                "Prepare a compatible endpoint URL.".to_string(),
                "Confirm the gateway expects `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`."
                    .to_string(),
                "Paste endpoint, model, and API key in the custom form.".to_string(),
            ],
        },
    ]
}

pub fn codex_light_guide() -> LightAgentGuide {
    LightAgentGuide {
        title: "Codex CLI".to_string(),
        summary: "In v1 GT Office only checks install status for Codex. Most users can keep the default CLI auth flow and do not need a provider form here.".to_string(),
        config_path: Some("~/.codex/config.toml".to_string()),
        docs_url: "https://platform.openai.com/docs/codex/cli".to_string(),
        tips: vec![
            "Install the CLI first, then sign in or configure it with the official Codex flow."
                .to_string(),
            "If your team uses a company gateway, keep that change inside Codex's own config file."
                .to_string(),
            "GT Office will continue to detect whether Codex is installed and ready to launch."
                .to_string(),
        ],
    }
}

pub fn gemini_light_guide() -> LightAgentGuide {
    LightAgentGuide {
        title: "Gemini CLI".to_string(),
        summary: "In v1 GT Office keeps Gemini simple: install detection, official docs, and local config path guidance.".to_string(),
        config_path: Some("~/.gemini/settings.json".to_string()),
        docs_url: "https://github.com/google-gemini/gemini-cli".to_string(),
        tips: vec![
            "Gemini is usually configured with the official CLI flow after installation."
                .to_string(),
            "If you already use an API key or workspace config, keep it inside Gemini's own config file."
                .to_string(),
            "Use this page as a launch readiness check, not as a secondary configuration panel."
                .to_string(),
        ],
    }
}
