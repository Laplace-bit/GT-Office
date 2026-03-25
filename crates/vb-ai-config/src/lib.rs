pub mod catalog;
pub mod models;
pub mod service;

pub use catalog::{
    claude_provider_presets, codex_provider_presets, codex_snapshot_template,
    gemini_provider_presets, gemini_snapshot_template,
};
pub use models::{
    AiAgentConfigStatus, AiAgentInstallStatus, AiAgentSnapshotCard, AiConfigAgent,
    AiConfigApplyResponse, AiConfigDraftInput, AiConfigMaskedChange, AiConfigNormalizedDraft,
    AiConfigPreviewResponse, AiConfigReadSnapshotResponse, AiConfigSnapshot, ClaudeAuthScheme,
    ClaudeConfigSnapshot, ClaudeDraftInput, ClaudeNormalizedDraft, ClaudeProviderMode,
    ClaudeProviderPreset, ClaudeSavedProviderSnapshot, ClaudeSnapshot, CodexConfigSnapshot,
    CodexDraftInput, CodexNormalizedDraft, CodexProviderMode, CodexProviderPreset,
    CodexSavedProviderSnapshot, CodexSnapshot, GeminiAuthMode, GeminiConfigSnapshot,
    GeminiDraftInput, GeminiNormalizedDraft, GeminiProviderMode, GeminiProviderPreset,
    GeminiSavedProviderSnapshot, GeminiSnapshot, StoredAiConfigPreview, StoredClaudePreview,
    StoredCodexPreview, StoredGeminiPreview,
};
pub use service::{
    agent_mcp_installed_for_workspace, claude_mcp_installed_for_workspace, AiConfigError,
    AiConfigResult, AiConfigService,
};

pub fn module_name() -> &'static str {
    "vb-ai-config"
}
