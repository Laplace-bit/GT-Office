use crate::models::CodexSnapshot;

use super::codex_provider_presets;

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
        saved_providers: Vec::new(),
    }
}
