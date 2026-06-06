pub mod catalog;
pub mod models;
pub mod service;

pub use catalog::{claude_provider_presets, codex_provider_presets, codex_snapshot_template};
pub use models::{
    AiAgentConfigStatus, AiAgentInstallStatus, AiAgentSnapshotCard, AiConfigAgent,
    AiConfigApplyResponse, AiConfigDraftInput, AiConfigMaskedChange, AiConfigNormalizedDraft,
    AiConfigPreviewResponse, AiConfigReadSnapshotResponse, AiConfigSnapshot, ClaudeAuthScheme,
    ClaudeConfigSnapshot, ClaudeDraftInput, ClaudeNormalizedDraft, ClaudeProviderMode,
    ClaudeProviderPreset, ClaudeSavedProviderSnapshot, ClaudeSnapshot, CodexConfigSnapshot,
    CodexDraftInput, CodexNormalizedDraft, CodexProviderMode, CodexProviderPreset,
    CodexSavedProviderSnapshot, CodexSnapshot, StoredAiConfigPreview, StoredClaudePreview,
    StoredCodexPreview,
};
pub use service::{AiConfigError, AiConfigResult, AiConfigService};

pub fn module_name() -> &'static str {
    "gt-ai-config"
}
