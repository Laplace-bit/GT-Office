use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiConfigAgent {
    Claude,
    Codex,
    Gemini,
}

impl AiConfigAgent {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeProviderMode {
    Official,
    Preset,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexProviderMode {
    Official,
    Preset,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeminiProviderMode {
    Official,
    Preset,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeAuthScheme {
    AnthropicApiKey,
    AnthropicAuthToken,
}

impl ClaudeAuthScheme {
    pub fn env_var_name(&self) -> &'static str {
        match self {
            Self::AnthropicApiKey => "ANTHROPIC_API_KEY",
            Self::AnthropicAuthToken => "ANTHROPIC_AUTH_TOKEN",
        }
    }
}

/// API format for Claude provider — determines how requests are sent.
/// `Anthropic` uses the native Anthropic Messages API (default).
/// `OpenAiChat` / `OpenAiResponses` use OpenAI-compatible endpoints and require a proxy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeApiFormat {
    #[default]
    Anthropic,
    OpenAiChat,
    OpenAiResponses,
}

impl ClaudeApiFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAiChat => "openai_chat",
            Self::OpenAiResponses => "openai_responses",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "anthropic" => Some(Self::Anthropic),
            "openai_chat" => Some(Self::OpenAiChat),
            "openai_responses" => Some(Self::OpenAiResponses),
            _ => None,
        }
    }

    /// Returns true if this API format requires a proxy/middleware to function.
    pub fn requires_proxy(&self) -> bool {
        matches!(self, Self::OpenAiChat | Self::OpenAiResponses)
    }
}

/// Per-model overrides for Claude — allows setting different models for haiku/sonnet/opus roles.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelOverrides {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub haiku_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sonnet_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opus_model: Option<String>,
}

impl ClaudeModelOverrides {
    pub fn is_empty(&self) -> bool {
        self.haiku_model.is_none() && self.sonnet_model.is_none() && self.opus_model.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeminiAuthMode {
    OAuth,
    ApiKey,
}

impl GeminiAuthMode {
    pub fn selected_type(&self) -> &'static str {
        match self {
            Self::OAuth => "oauth-personal",
            Self::ApiKey => "gemini-api-key",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderPreset {
    pub provider_id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub website_url: String,
    pub api_key_url: String,
    pub billing_url: String,
    pub recommended_model: String,
    pub endpoint: String,
    pub auth_scheme: ClaudeAuthScheme,
    pub why_choose: String,
    pub best_for: String,
    pub requires_billing: bool,
    pub setup_steps: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderPreset {
    pub provider_id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub website_url: String,
    pub api_key_url: String,
    pub billing_url: String,
    pub recommended_model: String,
    pub endpoint: Option<String>,
    pub config_template: String,
    pub requires_api_key: bool,
    pub setup_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiProviderPreset {
    pub provider_id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub website_url: String,
    pub api_key_url: String,
    pub billing_url: String,
    pub recommended_model: String,
    pub endpoint: Option<String>,
    pub auth_mode: GeminiAuthMode,
    pub selected_type: String,
    pub requires_api_key: bool,
    pub setup_steps: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiAgentConfigStatus {
    Unconfigured,
    Configured,
    GuidanceOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentInstallStatus {
    pub installed: bool,
    pub executable: Option<String>,
    pub requires_node: bool,
    pub node_ready: bool,
    pub npm_ready: bool,
    #[serde(default)]
    pub brew_ready: bool,
    pub install_available: bool,
    pub uninstall_available: bool,
    pub detected_by: Vec<String>,
    pub issues: Vec<String>,
    pub auto_install_supported: bool,
    pub recommended_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentSnapshotCard {
    pub agent: AiConfigAgent,
    pub title: String,
    pub subtitle: String,
    pub install_status: AiAgentInstallStatus,
    pub config_status: AiAgentConfigStatus,
    pub active_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeConfigSnapshot {
    pub saved_provider_id: Option<String>,
    pub active_mode: Option<ClaudeProviderMode>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub auth_scheme: Option<ClaudeAuthScheme>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub updated_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_format: Option<ClaudeApiFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_overrides: Option<ClaudeModelOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigSnapshot {
    pub saved_provider_id: Option<String>,
    pub active_mode: Option<CodexProviderMode>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub config_toml: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeminiConfigSnapshot {
    pub saved_provider_id: Option<String>,
    pub active_mode: Option<GeminiProviderMode>,
    pub auth_mode: Option<GeminiAuthMode>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub selected_type: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSavedProviderSnapshot {
    pub saved_provider_id: String,
    pub mode: ClaudeProviderMode,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub auth_scheme: Option<ClaudeAuthScheme>,
    pub has_secret: bool,
    pub is_active: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub last_applied_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_format: Option<ClaudeApiFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_overrides: Option<ClaudeModelOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSavedProviderSnapshot {
    pub saved_provider_id: String,
    pub mode: CodexProviderMode,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub config_toml: Option<String>,
    pub has_secret: bool,
    pub is_active: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub last_applied_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSavedProviderSnapshot {
    pub saved_provider_id: String,
    pub mode: GeminiProviderMode,
    pub auth_mode: GeminiAuthMode,
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub selected_type: String,
    pub has_secret: bool,
    pub is_active: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub last_applied_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSnapshot {
    pub presets: Vec<ClaudeProviderPreset>,
    pub config: ClaudeConfigSnapshot,
    pub saved_providers: Vec<ClaudeSavedProviderSnapshot>,
    pub can_apply_official_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSnapshot {
    pub title: String,
    pub summary: String,
    pub config_path: Option<String>,
    pub docs_url: String,
    pub tips: Vec<String>,
    pub presets: Vec<CodexProviderPreset>,
    pub config: CodexConfigSnapshot,
    pub saved_providers: Vec<CodexSavedProviderSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSnapshot {
    pub title: String,
    pub summary: String,
    pub config_path: Option<String>,
    pub docs_url: String,
    pub tips: Vec<String>,
    pub presets: Vec<GeminiProviderPreset>,
    pub config: GeminiConfigSnapshot,
    pub saved_providers: Vec<GeminiSavedProviderSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigSnapshot {
    pub agents: Vec<AiAgentSnapshotCard>,
    pub claude: ClaudeSnapshot,
    pub codex: CodexSnapshot,
    pub gemini: GeminiSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigReadSnapshotResponse {
    pub workspace_id: String,
    pub allow: String,
    pub snapshot: AiConfigSnapshot,
    pub masking: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDraftInput {
    pub mode: ClaudeProviderMode,
    #[serde(default)]
    pub saved_provider_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_name: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub auth_scheme: Option<ClaudeAuthScheme>,
    #[serde(default)]
    pub api_key: Option<String>,
    /// API format — determines how requests are sent to this provider.
    #[serde(default)]
    pub api_format: Option<ClaudeApiFormat>,
    /// Per-role model overrides (haiku/sonnet/opus). When set, overrides the main model for each role.
    #[serde(default)]
    pub model_overrides: Option<ClaudeModelOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDraftInput {
    pub mode: CodexProviderMode,
    #[serde(default)]
    pub saved_provider_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_name: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub config_toml: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiDraftInput {
    pub mode: GeminiProviderMode,
    #[serde(default)]
    pub saved_provider_id: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<GeminiAuthMode>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_name: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub selected_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiConfigDraftInput {
    Claude(ClaudeDraftInput),
    Codex(CodexDraftInput),
    Gemini(GeminiDraftInput),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeNormalizedDraft {
    pub mode: ClaudeProviderMode,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub auth_scheme: Option<ClaudeAuthScheme>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
    #[serde(default)]
    pub api_format: Option<ClaudeApiFormat>,
    #[serde(default)]
    pub model_overrides: Option<ClaudeModelOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexNormalizedDraft {
    pub mode: CodexProviderMode,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub config_toml: Option<String>,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiNormalizedDraft {
    pub mode: GeminiProviderMode,
    pub auth_mode: GeminiAuthMode,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub selected_type: String,
    pub secret_ref: Option<String>,
    pub has_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiConfigNormalizedDraft {
    Claude(ClaudeNormalizedDraft),
    Codex(CodexNormalizedDraft),
    Gemini(GeminiNormalizedDraft),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigMaskedChange {
    pub key: String,
    pub label: String,
    pub before: Option<String>,
    pub after: Option<String>,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigPreviewResponse {
    pub workspace_id: String,
    pub scope: String,
    pub agent: AiConfigAgent,
    pub preview_id: String,
    pub allowed: bool,
    pub normalized_draft: AiConfigNormalizedDraft,
    pub masked_diff: Vec<AiConfigMaskedChange>,
    pub changed_keys: Vec<String>,
    pub secret_refs: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigApplyResponse {
    pub workspace_id: String,
    pub preview_id: String,
    pub confirmed_by: String,
    pub applied: bool,
    pub audit_id: String,
    pub effective: AiConfigSnapshot,
    pub changed_targets: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum StoredAiConfigPreview {
    Claude(StoredClaudePreview),
    Codex(StoredCodexPreview),
    Gemini(StoredGeminiPreview),
}

#[derive(Debug, Clone)]
pub struct StoredClaudePreview {
    pub preview_id: String,
    pub saved_provider_id: Option<String>,
    pub normalized_draft: ClaudeNormalizedDraft,
    pub changed_keys: Vec<String>,
    pub secret_refs: Vec<String>,
    pub warnings: Vec<String>,
    pub api_key_secret: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredCodexPreview {
    pub preview_id: String,
    pub saved_provider_id: Option<String>,
    pub normalized_draft: CodexNormalizedDraft,
    pub changed_keys: Vec<String>,
    pub secret_refs: Vec<String>,
    pub warnings: Vec<String>,
    pub api_key_secret: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredGeminiPreview {
    pub preview_id: String,
    pub saved_provider_id: Option<String>,
    pub normalized_draft: GeminiNormalizedDraft,
    pub changed_keys: Vec<String>,
    pub secret_refs: Vec<String>,
    pub warnings: Vec<String>,
    pub api_key_secret: Option<String>,
}
