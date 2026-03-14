pub mod catalog;
pub mod models;
pub mod service;

pub use catalog::{claude_provider_presets, codex_light_guide, gemini_light_guide};
pub use models::{
    AiAgentConfigStatus, AiAgentInstallStatus, AiAgentSnapshotCard, AiConfigAgent,
    AiConfigApplyResponse, AiConfigMaskedChange, AiConfigPreviewResponse,
    AiConfigReadSnapshotResponse, AiConfigSnapshot, ClaudeAuthScheme, ClaudeConfigSnapshot,
    ClaudeDraftInput, ClaudeNormalizedDraft, ClaudeProviderMode, ClaudeProviderPreset,
    ClaudeSnapshot, LightAgentGuide, StoredClaudePreview,
};
pub use service::{AiConfigError, AiConfigResult, AiConfigService};

pub fn module_name() -> &'static str {
    "vb-ai-config"
}
