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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LightAgentConfigSnapshot {
    pub has_secret: bool,
    pub secret_ref: Option<String>,
    pub updated_at_ms: Option<u64>,
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
pub struct LightAgentGuide {
    pub title: String,
    pub summary: String,
    pub config_path: Option<String>,
    pub docs_url: String,
    pub tips: Vec<String>,
    pub config: LightAgentConfigSnapshot,
    pub mcp_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigSnapshot {
    pub agents: Vec<AiAgentSnapshotCard>,
    pub claude: ClaudeSnapshot,
    pub codex: LightAgentGuide,
    pub gemini: LightAgentGuide,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightAgentDraftInput {
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiConfigDraftInput {
    Claude(ClaudeDraftInput),
    Codex(LightAgentDraftInput),
    Gemini(LightAgentDraftInput),
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightAgentNormalizedDraft {
    pub has_secret: bool,
    pub secret_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiConfigNormalizedDraft {
    Claude(ClaudeNormalizedDraft),
    Codex(LightAgentNormalizedDraft),
    Gemini(LightAgentNormalizedDraft),
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
    Codex(StoredLightAgentPreview),
    Gemini(StoredLightAgentPreview),
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
pub struct StoredLightAgentPreview {
    pub preview_id: String,
    pub agent: AiConfigAgent,
    pub normalized_draft: LightAgentNormalizedDraft,
    pub changed_keys: Vec<String>,
    pub secret_refs: Vec<String>,
    pub warnings: Vec<String>,
    pub api_key_secret: Option<String>,
}
