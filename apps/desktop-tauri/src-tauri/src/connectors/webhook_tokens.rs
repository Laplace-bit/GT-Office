use serde::{Deserialize, Serialize};
use uuid::Uuid;

const TOKENS_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTokens {
    version: String,
    pub feishu_token: String,
    pub telegram_token: String,
}

impl WebhookTokens {
    pub fn new() -> Self {
        Self {
            version: TOKENS_VERSION.to_string(),
            feishu_token: Uuid::new_v4().to_string(),
            telegram_token: Uuid::new_v4().to_string(),
        }
    }

    pub fn load_from_path(path: &std::path::Path) -> Result<Self, String> {
        if !path.exists() {
            let tokens = Self::new();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("failed to create tokens dir: {e}"))?;
            }
            tokens.save_to_path(path)?;
            return Ok(tokens);
        }
        let payload = std::fs::read(path)
            .map_err(|e| format!("failed to read tokens file: {e}"))?;
        let tokens: Self = serde_json::from_slice(&payload).unwrap_or_else(|_| Self::new());
        if tokens.feishu_token.is_empty() || tokens.telegram_token.is_empty() {
            return Ok(Self::new());
        }
        Ok(tokens)
    }

    pub fn save_to_path(&self, path: &std::path::Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create tokens dir: {e}"))?;
        }
        let payload = serde_json::to_vec_pretty(self)
            .map_err(|e| format!("failed to encode tokens: {e}"))?;
        std::fs::write(path, payload)
            .map_err(|e| format!("failed to write tokens file: {e}"))
    }

    pub fn rotate(&self) -> Self {
        Self::new()
    }
}

impl Default for WebhookTokens {
    fn default() -> Self {
        Self::new()
    }
}

pub fn tokens_file_path() -> std::path::PathBuf {
    let home = dirs_home();
    home.join(".gtoffice/channel/runtime-tokens.json")
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
}

#[cfg(test)]
#[path = "webhook_tokens_tests.rs"]
mod tests;
