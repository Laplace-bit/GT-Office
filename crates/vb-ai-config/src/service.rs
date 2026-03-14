use std::{collections::BTreeMap, path::Path, time::SystemTime};

use serde_json::{json, Value};
use thiserror::Error;
use uuid::Uuid;
use vb_abstractions::SettingsScope;
use vb_security::SecretStore;
use vb_settings::{JsonSettingsService, SettingsPaths};
use vb_storage::{AiConfigAuditLogInput, SqliteAiConfigRepository};

use crate::{
    catalog::{claude_provider_presets, codex_light_guide, gemini_light_guide},
    models::{
        AiConfigAgent, AiConfigApplyResponse, AiConfigMaskedChange, AiConfigNormalizedDraft,
        AiConfigPreviewResponse, AiConfigSnapshot, ClaudeConfigSnapshot, ClaudeDraftInput,
        ClaudeNormalizedDraft, ClaudeProviderMode, ClaudeSnapshot, LightAgentConfigSnapshot,
        LightAgentDraftInput, LightAgentNormalizedDraft, StoredAiConfigPreview,
        StoredClaudePreview, StoredLightAgentPreview,
    },
};

const AI_SECRET_SERVICE: &str = "gtoffice.ai-config";
const AI_SECRET_NAMESPACE: &str = "AI_CONFIG_SECRET";

#[derive(Debug, Error)]
pub enum AiConfigError {
    #[error("AI_CONFIG_INVALID: {0}")]
    Invalid(String),
    #[error("AI_CONFIG_SCOPE_INVALID: {0}")]
    UnsupportedScope(String),
    #[error("AI_CONFIG_SETTINGS_FAILED: {0}")]
    Settings(String),
    #[error("AI_CONFIG_STORAGE_FAILED: {0}")]
    Storage(String),
    #[error("AI_CONFIG_SECRET_FAILED: {0}")]
    Secret(String),
}

pub type AiConfigResult<T> = Result<T, AiConfigError>;

#[derive(Clone)]
pub struct AiConfigService {
    settings: JsonSettingsService,
    secret_store: SecretStore,
    audit_repository: SqliteAiConfigRepository,
}

impl AiConfigService {
    pub fn new(settings: JsonSettingsService, audit_repository: SqliteAiConfigRepository) -> Self {
        Self {
            settings,
            secret_store: SecretStore::new(AI_SECRET_SERVICE, AI_SECRET_NAMESPACE),
            audit_repository,
        }
    }

    pub fn workspace_settings_path(&self, workspace_root: &Path) -> String {
        self.settings
            .paths()
            .workspace_file(workspace_root)
            .to_string_lossy()
            .to_string()
    }

    pub fn list_audit_logs(
        &self,
        workspace_id: &str,
        agent: &str,
        limit: usize,
    ) -> AiConfigResult<Vec<AiConfigAuditLogInput>> {
        self.audit_repository
            .query_audit_logs(workspace_id, agent, limit)
            .map_err(|error| AiConfigError::Storage(error.to_string()))
    }

    pub fn read_claude_config(&self, workspace_root: &Path) -> AiConfigResult<ClaudeConfigSnapshot> {
        let effective = self
            .settings
            .load_effective(Some(workspace_root))
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;
        read_claude_config_from_value(&effective.values)
    }

    pub fn read_light_agent_config(
        &self,
        agent: AiConfigAgent,
        workspace_root: &Path,
    ) -> AiConfigResult<LightAgentConfigSnapshot> {
        let effective = self
            .settings
            .load_effective(Some(workspace_root))
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;
        let path = format!("/ai/providers/{}", agent.as_str());
        let config_value = effective
            .values
            .pointer(&path)
            .cloned()
            .unwrap_or_else(|| json!({}));

        let secret_ref = config_value
            .get("secretRef")
            .and_then(Value::as_str)
            .map(|v| v.to_string());
        let has_secret = config_value
            .get("hasSecret")
            .and_then(Value::as_bool)
            .unwrap_or_else(|| secret_ref.is_some());
        let updated_at_ms = config_value.get("updatedAtMs").and_then(Value::as_u64);

        Ok(LightAgentConfigSnapshot {
            has_secret,
            secret_ref,
            updated_at_ms,
        })
    }

    pub fn preview_claude_patch(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        scope: &str,
        draft: ClaudeDraftInput,
    ) -> AiConfigResult<(AiConfigPreviewResponse, StoredAiConfigPreview)> {
        if !scope.trim().eq_ignore_ascii_case("workspace") {
            return Err(AiConfigError::UnsupportedScope(
                "only workspace scope is supported".to_string(),
            ));
        }

        let current = self.read_claude_config(workspace_root)?;
        let (normalized, api_key_secret) = normalize_claude_draft(workspace_id, &current, draft)?;
        let changes = diff_claude_config(&current, &normalized);
        if changes.is_empty() {
            return Err(AiConfigError::Invalid(
                "no effective changes to apply".to_string(),
            ));
        }

        let preview_id = format!("preview:{}", Uuid::new_v4());
        let warnings = build_warnings(&normalized);
        let secret_refs = normalized
            .secret_ref
            .clone()
            .into_iter()
            .collect::<Vec<_>>();
        let response = AiConfigPreviewResponse {
            workspace_id: workspace_id.to_string(),
            scope: "workspace".to_string(),
            agent: AiConfigAgent::Claude,
            preview_id: preview_id.clone(),
            allowed: true,
            normalized_draft: AiConfigNormalizedDraft::Claude(normalized.clone()),
            masked_diff: changes.clone(),
            changed_keys: changes.iter().map(|entry| entry.key.clone()).collect(),
            secret_refs: secret_refs.clone(),
            warnings: warnings.clone(),
        };

        Ok((
            response,
            StoredAiConfigPreview::Claude(StoredClaudePreview {
                preview_id,
                normalized_draft: normalized,
                changed_keys: changes.into_iter().map(|entry| entry.key).collect(),
                secret_refs,
                warnings,
                api_key_secret,
            }),
        ))
    }

    pub fn preview_light_agent_patch(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        agent: AiConfigAgent,
        draft: LightAgentDraftInput,
    ) -> AiConfigResult<(AiConfigPreviewResponse, StoredAiConfigPreview)> {
        let current = self.read_light_agent_config(agent.clone(), workspace_root)?;
        let secret_input = normalize_non_empty(draft.api_key);
        let can_reuse_secret = current.has_secret && current.secret_ref.is_some();

        let secret_ref = if secret_input.is_some() {
            Some(format!(
                "ai-config/{}/{}/api_key",
                sanitize_secret_segment(workspace_id),
                agent.as_str()
            ))
        } else if can_reuse_secret {
            current.secret_ref.clone()
        } else {
            None
        };

        if secret_ref.is_none() {
            return Err(AiConfigError::Invalid(format!(
                "API key is required for {}",
                agent.as_str()
            )));
        }

        let normalized = LightAgentNormalizedDraft {
            has_secret: true,
            secret_ref: secret_ref.clone(),
        };

        let mut changes = Vec::new();
        let before_secret = if current.has_secret {
            Some("Saved".to_string())
        } else {
            Some("Missing".to_string())
        };
        push_change_owned(
            &mut changes,
            &format!("ai.providers.{}.apiKey", agent.as_str()),
            "API Key",
            before_secret,
            Some("Ready".to_string()),
            true,
        );

        if changes.is_empty() {
            return Err(AiConfigError::Invalid(
                "no effective changes to apply".to_string(),
            ));
        }

        let preview_id = format!("preview:{}", Uuid::new_v4());
        let warnings = vec!["Changes apply to new sessions after restart.".to_string()];
        let secret_refs: Vec<String> = secret_ref.clone().into_iter().collect();

        let response = AiConfigPreviewResponse {
            workspace_id: workspace_id.to_string(),
            scope: "workspace".to_string(),
            agent: agent.clone(),
            preview_id: preview_id.clone(),
            allowed: true,
            normalized_draft: match agent {
                AiConfigAgent::Codex => AiConfigNormalizedDraft::Codex(normalized.clone()),
                AiConfigAgent::Gemini => AiConfigNormalizedDraft::Gemini(normalized.clone()),
                _ => unreachable!(),
            },
            masked_diff: changes.clone(),
            changed_keys: changes.iter().map(|entry| entry.key.clone()).collect(),
            secret_refs: secret_refs.clone(),
            warnings: warnings.clone(),
        };

        let stored = StoredLightAgentPreview {
            preview_id,
            agent: agent.clone(),
            normalized_draft: normalized,
            changed_keys: changes.into_iter().map(|entry| entry.key).collect(),
            secret_refs,
            warnings,
            api_key_secret: secret_input,
        };

        Ok((
            response,
            match agent {
                AiConfigAgent::Codex => StoredAiConfigPreview::Codex(stored),
                AiConfigAgent::Gemini => StoredAiConfigPreview::Gemini(stored),
                _ => unreachable!(),
            },
        ))
    }

    pub fn apply_claude_preview(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        confirmed_by: &str,
        preview: &StoredClaudePreview,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        if let (Some(secret_ref), Some(secret_value)) = (
            preview.normalized_draft.secret_ref.as_deref(),
            preview.api_key_secret.as_deref(),
        ) {
            self.secret_store
                .store(secret_ref, secret_value)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
        }

        let patch = build_workspace_patch(&preview.normalized_draft);
        self.settings
            .update(SettingsScope::Workspace, Some(workspace_root), &patch)
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;

        let audit_id = format!("audit:{}", Uuid::new_v4());
        let created_at_ms = now_ms() as i64;
        let changed_keys_json = serde_json::to_string(&preview.changed_keys)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(&preview.secret_refs)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: workspace_id.to_string(),
                agent: "claude".to_string(),
                mode: mode_to_string(&preview.normalized_draft.mode).to_string(),
                provider_id: preview.normalized_draft.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let effective = self.read_snapshot(workspace_id, workspace_root)?;

        Ok(AiConfigApplyResponse {
            workspace_id: workspace_id.to_string(),
            preview_id: preview.preview_id.clone(),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "workspace_settings".to_string(),
                "secret_store".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    pub fn apply_light_agent_preview(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        confirmed_by: &str,
        preview: &StoredLightAgentPreview,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        if let (Some(secret_ref), Some(secret_value)) = (
            preview.normalized_draft.secret_ref.as_deref(),
            preview.api_key_secret.as_deref(),
        ) {
            self.secret_store
                .store(secret_ref, secret_value)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
        }

        let patch = json!({
            "ai": {
                "providers": {
                    preview.agent.as_str(): {
                        "secretRef": preview.normalized_draft.secret_ref,
                        "hasSecret": preview.normalized_draft.has_secret,
                        "updatedAtMs": now_ms(),
                    }
                }
            }
        });

        self.settings
            .update(SettingsScope::Workspace, Some(workspace_root), &patch)
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;

        let audit_id = format!("audit:{}", Uuid::new_v4());
        let created_at_ms = now_ms() as i64;
        let changed_keys_json = serde_json::to_string(&preview.changed_keys)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(&preview.secret_refs)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: workspace_id.to_string(),
                agent: preview.agent.as_str().to_string(),
                mode: "light".to_string(),
                provider_id: None,
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let effective = self.read_snapshot(workspace_id, workspace_root)?;

        Ok(AiConfigApplyResponse {
            workspace_id: workspace_id.to_string(),
            preview_id: preview.preview_id.clone(),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "workspace_settings".to_string(),
                "secret_store".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    pub fn read_snapshot(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> AiConfigResult<AiConfigSnapshot> {
        let claude_config = self.read_claude_config(workspace_root)?;
        let codex_config = self.read_light_agent_config(AiConfigAgent::Codex, workspace_root)?;
        let gemini_config = self.read_light_agent_config(AiConfigAgent::Gemini, workspace_root)?;

        let mut codex_guide = codex_light_guide();
        codex_guide.config = codex_config;
        codex_guide.mcp_installed = check_mcp_installed(AiConfigAgent::Codex);

        let mut gemini_guide = gemini_light_guide();
        gemini_guide.config = gemini_config;
        gemini_guide.mcp_installed = check_mcp_installed(AiConfigAgent::Gemini);

        Ok(AiConfigSnapshot {
            agents: vec![
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Claude,
                    title: "Claude Code".to_string(),
                    subtitle: "Full provider configuration, model override, and runtime injection."
                        .to_string(),
                    install_status: map_install_status(AiConfigAgent::Claude),
                    config_status: if claude_config.active_mode.is_some() {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: claude_summary(&claude_config),
                },
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Codex,
                    title: "Codex CLI".to_string(),
                    subtitle: "Lightweight API Key configuration and terminal injection."
                        .to_string(),
                    install_status: map_install_status(AiConfigAgent::Codex),
                    config_status: if codex_guide.config.has_secret {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: Some("Injected OPENAI_API_KEY when starting.".to_string()),
                },
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Gemini,
                    title: "Gemini CLI".to_string(),
                    subtitle: "Lightweight API Key configuration and terminal injection."
                        .to_string(),
                    install_status: map_install_status(AiConfigAgent::Gemini),
                    config_status: if gemini_guide.config.has_secret {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: Some("Injected GOOGLE_API_KEY when starting.".to_string()),
                },
            ],
            claude: ClaudeSnapshot {
                presets: claude_provider_presets(),
                config: claude_config,
                can_apply_official_mode: true,
            },
            codex: codex_guide,
            gemini: gemini_guide,
        })
    }

    pub fn build_agent_runtime_env(
        &self,
        agent: AiConfigAgent,
        workspace_root: &Path,
    ) -> AiConfigResult<BTreeMap<String, String>> {
        match agent {
            AiConfigAgent::Claude => self.build_claude_runtime_env(workspace_root),
            AiConfigAgent::Codex => {
                let config = self.read_light_agent_config(AiConfigAgent::Codex, workspace_root)?;
                let mut env = BTreeMap::new();
                if let Some(secret_ref) = config.secret_ref {
                    if let Ok(secret) = self.secret_store.load(&secret_ref) {
                        env.insert("OPENAI_API_KEY".to_string(), secret);
                    }
                }
                Ok(env)
            }
            AiConfigAgent::Gemini => {
                let config = self.read_light_agent_config(AiConfigAgent::Gemini, workspace_root)?;
                let mut env = BTreeMap::new();
                if let Some(secret_ref) = config.secret_ref {
                    if let Ok(secret) = self.secret_store.load(&secret_ref) {
                        env.insert("GOOGLE_API_KEY".to_string(), secret);
                    }
                }
                Ok(env)
            }
        }
    }

    fn build_claude_runtime_env(
        &self,
        workspace_root: &Path,
    ) -> AiConfigResult<BTreeMap<String, String>> {
        let config = self.read_claude_config(workspace_root)?;
        let mode = match config.active_mode {
            Some(mode) => mode,
            None => return Ok(BTreeMap::new()),
        };
        if mode == ClaudeProviderMode::Official {
            return Ok(BTreeMap::new());
        }

        let base_url = config
            .base_url
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AiConfigError::Invalid("configured Claude endpoint is missing".to_string()))?;
        let model = config
            .model
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AiConfigError::Invalid("configured Claude model is missing".to_string()))?;
        let auth_scheme = config
            .auth_scheme
            .ok_or_else(|| AiConfigError::Invalid("configured Claude auth scheme is missing".to_string()))?;
        let secret_ref = config
            .secret_ref
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AiConfigError::Invalid("configured Claude secret reference is missing".to_string()))?;
        let secret = self
            .secret_store
            .load(&secret_ref)
            .map_err(|error| AiConfigError::Secret(error.to_string()))?;

        let mut env = BTreeMap::new();
        env.insert("ANTHROPIC_BASE_URL".to_string(), base_url);
        env.insert("ANTHROPIC_MODEL".to_string(), model);
        env.insert(auth_scheme.env_var_name().to_string(), secret);
        Ok(env)
    }
}

fn normalize_claude_draft(
    workspace_id: &str,
    current: &ClaudeConfigSnapshot,
    draft: ClaudeDraftInput,
) -> AiConfigResult<(ClaudeNormalizedDraft, Option<String>)> {
    match draft.mode {
        ClaudeProviderMode::Official => Ok((
            ClaudeNormalizedDraft {
                mode: ClaudeProviderMode::Official,
                provider_id: None,
                provider_name: None,
                base_url: None,
                model: None,
                auth_scheme: None,
                secret_ref: None,
                has_secret: false,
            },
            None,
        )),
        ClaudeProviderMode::Preset => {
            let provider_id = required_field(draft.provider_id, "providerId")?;
            let preset = claude_provider_presets()
                .into_iter()
                .find(|item| item.provider_id == provider_id)
                .ok_or_else(|| AiConfigError::Invalid("unknown Claude preset".to_string()))?;
            let model = Some(
                normalize_non_empty(draft.model)
                    .unwrap_or_else(|| preset.recommended_model.clone()),
            );
            let base_url = Some(
                normalize_endpoint(draft.base_url.unwrap_or_else(|| preset.endpoint.clone()))?,
            );
            let auth_scheme = Some(draft.auth_scheme.unwrap_or(preset.auth_scheme.clone()));
            let secret_input = normalize_non_empty(draft.api_key);
            let can_reuse_secret = current.provider_id.as_deref() == Some(preset.provider_id.as_str())
                && current.has_secret
                && current.secret_ref.is_some();
            let secret_ref = if secret_input.is_some() {
                Some(build_secret_ref(workspace_id, &preset.provider_id))
            } else if can_reuse_secret {
                current.secret_ref.clone()
            } else {
                None
            };
            if secret_ref.is_none() {
                return Err(AiConfigError::Invalid(
                    "API key is required for the selected Claude provider".to_string(),
                ));
            }
            Ok((
                ClaudeNormalizedDraft {
                    mode: ClaudeProviderMode::Preset,
                    provider_id: Some(preset.provider_id),
                    provider_name: Some(preset.name),
                    base_url,
                    model,
                    auth_scheme,
                    has_secret: true,
                    secret_ref,
                },
                secret_input,
            ))
        }
        ClaudeProviderMode::Custom => {
            let provider_name = required_field(draft.provider_name, "providerName")?;
            let base_url =
                Some(normalize_endpoint(required_field(draft.base_url, "baseUrl")?)?);
            let model = Some(required_field(draft.model, "model")?);
            let auth_scheme = Some(
                draft
                    .auth_scheme
                    .ok_or_else(|| AiConfigError::Invalid("authScheme is required".to_string()))?,
            );
            let provider_id = Some("custom-gateway".to_string());
            let secret_input = normalize_non_empty(draft.api_key);
            let can_reuse_secret = current.provider_id.as_deref() == Some("custom-gateway")
                && current.has_secret
                && current.secret_ref.is_some();
            let secret_ref = if secret_input.is_some() {
                Some(build_secret_ref(workspace_id, "custom-gateway"))
            } else if can_reuse_secret {
                current.secret_ref.clone()
            } else {
                None
            };
            if secret_ref.is_none() {
                return Err(AiConfigError::Invalid(
                    "API key is required for the custom Claude gateway".to_string(),
                ));
            }
            Ok((
                ClaudeNormalizedDraft {
                    mode: ClaudeProviderMode::Custom,
                    provider_id,
                    provider_name: Some(provider_name),
                    base_url,
                    model,
                    auth_scheme,
                    has_secret: true,
                    secret_ref,
                },
                secret_input,
            ))
        }
    }
}

fn diff_claude_config(
    current: &ClaudeConfigSnapshot,
    next: &ClaudeNormalizedDraft,
) -> Vec<AiConfigMaskedChange> {
    let mut changes = Vec::new();
    push_change(
        &mut changes,
        "ai.providers.claude.activeMode",
        "Mode",
        current.active_mode.as_ref().map(mode_to_string),
        Some(mode_to_string(&next.mode)),
        false,
    );
    push_change(
        &mut changes,
        "ai.providers.claude.providerName",
        "Provider",
        current.provider_name.as_deref(),
        next.provider_name.as_deref(),
        false,
    );
    push_change(
        &mut changes,
        "ai.providers.claude.baseUrl",
        "Endpoint",
        current.base_url.as_deref(),
        next.base_url.as_deref(),
        false,
    );
    push_change(
        &mut changes,
        "ai.providers.claude.model",
        "Model",
        current.model.as_deref(),
        next.model.as_deref(),
        false,
    );
    push_change(
        &mut changes,
        "ai.providers.claude.authScheme",
        "Auth",
        current.auth_scheme.as_ref().map(auth_to_string),
        next.auth_scheme.as_ref().map(auth_to_string),
        false,
    );
    let before_secret = if current.has_secret {
        Some("Saved".to_string())
    } else {
        Some("Missing".to_string())
    };
    let after_secret = if next.has_secret {
        Some("Ready".to_string())
    } else {
        Some("Not set".to_string())
    };
    push_change_owned(
        &mut changes,
        "ai.providers.claude.apiKey",
        "API Key",
        before_secret,
        after_secret,
        true,
    );
    changes
}

fn build_workspace_patch(normalized: &ClaudeNormalizedDraft) -> Value {
    json!({
        "ai": {
            "providers": {
                "claude": {
                    "activeMode": mode_to_string(&normalized.mode),
                    "providerId": normalized.provider_id,
                    "providerName": normalized.provider_name,
                    "baseUrl": normalized.base_url,
                    "model": normalized.model,
                    "authScheme": normalized.auth_scheme.as_ref().map(auth_to_string),
                    "secretRef": normalized.secret_ref,
                    "hasSecret": normalized.has_secret,
                    "updatedAtMs": now_ms(),
                }
            }
        }
    })
}

fn read_claude_config_from_value(value: &Value) -> AiConfigResult<ClaudeConfigSnapshot> {
    let config_value = value
        .pointer("/ai/providers/claude")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let object = config_value
        .as_object()
        .cloned()
        .unwrap_or_default();

    let active_mode = object
        .get("activeMode")
        .and_then(Value::as_str)
        .and_then(parse_mode);
    let auth_scheme = object
        .get("authScheme")
        .and_then(Value::as_str)
        .and_then(parse_auth_scheme);
    let provider_id = object
        .get("providerId")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let provider_name = object
        .get("providerName")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let base_url = object
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let secret_ref = object
        .get("secretRef")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let has_secret = object
        .get("hasSecret")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| secret_ref.is_some());
    let updated_at_ms = object.get("updatedAtMs").and_then(Value::as_u64);

    Ok(ClaudeConfigSnapshot {
        active_mode,
        provider_id,
        provider_name,
        base_url,
        model,
        auth_scheme,
        secret_ref,
        has_secret,
        updated_at_ms,
    })
}

fn build_warnings(normalized: &ClaudeNormalizedDraft) -> Vec<String> {
    let mut warnings = Vec::new();
    if normalized.mode != ClaudeProviderMode::Official {
        warnings.push("Changes apply to new Claude sessions after restart.".to_string());
    }
    if normalized.mode == ClaudeProviderMode::Custom {
        warnings.push("Custom gateways are not validated beyond required fields.".to_string());
    }
    warnings
}

fn push_change(
    changes: &mut Vec<AiConfigMaskedChange>,
    key: &str,
    label: &str,
    before: Option<&str>,
    after: Option<&str>,
    secret: bool,
) {
    let before_owned = before.map(|value| value.to_string());
    let after_owned = after.map(|value| value.to_string());
    push_change_owned(changes, key, label, before_owned, after_owned, secret);
}

fn push_change_owned(
    changes: &mut Vec<AiConfigMaskedChange>,
    key: &str,
    label: &str,
    before: Option<String>,
    after: Option<String>,
    secret: bool,
) {
    if before == after {
        return;
    }
    changes.push(AiConfigMaskedChange {
        key: key.to_string(),
        label: label.to_string(),
        before,
        after,
        secret,
    });
}

fn required_field(value: Option<String>, field: &str) -> AiConfigResult<String> {
    normalize_non_empty(value).ok_or_else(|| {
        AiConfigError::Invalid(format!("{field} is required"))
    })
}

fn normalize_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(none_if_empty)
}

fn none_if_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_endpoint(value: String) -> AiConfigResult<String> {
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err(AiConfigError::Invalid("baseUrl is required".to_string()));
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(AiConfigError::Invalid(
            "baseUrl must start with http:// or https://".to_string(),
        ));
    }
    Ok(trimmed)
}

fn build_secret_ref(workspace_id: &str, provider_id: &str) -> String {
    format!(
        "ai-config/{}/claude/{}/api_key",
        sanitize_secret_segment(workspace_id),
        sanitize_secret_segment(provider_id)
    )
}

fn sanitize_secret_segment(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
        } else {
            result.push('_');
        }
    }
    result
}

fn parse_mode(value: &str) -> Option<ClaudeProviderMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "official" => Some(ClaudeProviderMode::Official),
        "preset" => Some(ClaudeProviderMode::Preset),
        "custom" => Some(ClaudeProviderMode::Custom),
        _ => None,
    }
}

fn parse_auth_scheme(value: &str) -> Option<crate::models::ClaudeAuthScheme> {
    match value.trim().to_ascii_lowercase().as_str() {
        "anthropic_api_key" => Some(crate::models::ClaudeAuthScheme::AnthropicApiKey),
        "anthropic_auth_token" => Some(crate::models::ClaudeAuthScheme::AnthropicAuthToken),
        _ => None,
    }
}

fn mode_to_string(mode: &ClaudeProviderMode) -> &'static str {
    match mode {
        ClaudeProviderMode::Official => "official",
        ClaudeProviderMode::Preset => "preset",
        ClaudeProviderMode::Custom => "custom",
    }
}

fn auth_to_string(auth: &crate::models::ClaudeAuthScheme) -> &'static str {
    match auth {
        crate::models::ClaudeAuthScheme::AnthropicApiKey => "anthropic_api_key",
        crate::models::ClaudeAuthScheme::AnthropicAuthToken => "anthropic_auth_token",
    }
}

fn map_install_status(agent: AiConfigAgent) -> crate::models::AiAgentInstallStatus {
    use vb_tools::agent_installer::{AgentInstaller, AgentType};
    let agent_type = match agent {
        AiConfigAgent::Claude => AgentType::ClaudeCode,
        AiConfigAgent::Codex => AgentType::Codex,
        AiConfigAgent::Gemini => AgentType::Gemini,
    };
    let status = AgentInstaller::install_status(agent_type);
    crate::models::AiAgentInstallStatus {
        installed: status.installed,
        executable: status.executable,
        requires_node: status.requires_node,
        node_ready: status.node_ready,
    }
}

fn claude_summary(config: &ClaudeConfigSnapshot) -> Option<String> {
    let provider = config.provider_name.as_deref().unwrap_or("Native Claude");
    let model = config.model.as_deref().unwrap_or("default");
    config
        .active_mode
        .as_ref()
        .map(|mode| format!("{mode:?}: {provider} / {model}"))
}

fn check_mcp_installed(agent: AiConfigAgent) -> bool {
    let home = match std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        Ok(h) => std::path::PathBuf::from(h),
        Err(_) => return false,
    };

    let (path1, path2) = match agent {
        AiConfigAgent::Claude => (
            home.join(".claude.json"),
            home.join(".claude").join("settings.json"),
        ),
        AiConfigAgent::Codex => (
            home.join(".codex").join("config.toml"),
            home.join(".codex").join("config.toml"),
        ),
        AiConfigAgent::Gemini => (
            home.join(".gemini").join("settings.json"),
            home.join(".gemini").join("settings.json"),
        ),
    };

    let check = |p: &std::path::Path| {
        if !p.exists() {
            return false;
        }
        std::fs::read_to_string(p)
            .map(|c| c.contains("gto-agent-bridge"))
            .unwrap_or(false)
    };

    check(&path1) || check(&path2)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn test_settings_service(user_file: &Path) -> JsonSettingsService {
    JsonSettingsService::new(SettingsPaths::new(
        user_file.to_path_buf(),
        ".gtoffice/config.json".into(),
    ))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use vb_storage::{SqliteAiConfigRepository, SqliteStorage};

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gtoffice-ai-config-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn service_for(dir: &Path) -> AiConfigService {
        let user_file = dir.join("user-settings.json");
        let db_path = dir.join("gtoffice.db");
        AiConfigService::new(
            test_settings_service(&user_file),
            SqliteAiConfigRepository::new(SqliteStorage::new(db_path).unwrap()),
        )
    }

    #[test]
    fn preview_rejects_missing_api_key_for_new_preset() {
        let dir = temp_dir("missing-key");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let error = service
            .preview_claude_patch(
                "ws:test",
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    provider_id: Some("deepseek".to_string()),
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: None,
                },
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("API key is required"));
    }

    #[test]
    fn apply_persists_secret_ref_without_plaintext_in_workspace_file() {
        let dir = temp_dir("apply");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let (preview, stored) = service
            .preview_claude_patch(
                "ws:test",
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    provider_id: Some("deepseek".to_string()),
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("secret-token".to_string()),
                },
            )
            .unwrap();
        let stored_claude = match stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        let applied = service
            .apply_claude_preview("ws:test", &workspace_root, "tester", &stored_claude)
            .unwrap();
        let config_raw = fs::read_to_string(workspace_root.join(".gtoffice/config.json")).unwrap();
        assert!(!config_raw.contains("secret-token"));
        assert!(config_raw.contains("secretRef"));
        assert!(preview.secret_refs.len() == 1);
        assert_eq!(applied.effective.claude.config.provider_id.as_deref(), Some("deepseek"));
    }

    #[test]
    fn runtime_env_uses_stored_secret_reference() {
        let dir = temp_dir("runtime");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let (_, stored) = service
            .preview_claude_patch(
                "ws:test",
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Custom,
                    provider_id: None,
                    provider_name: Some("My Gateway".to_string()),
                    base_url: Some("https://api.example.com/anthropic".to_string()),
                    model: Some("claude-sonnet-4-5".to_string()),
                    auth_scheme: Some(crate::models::ClaudeAuthScheme::AnthropicAuthToken),
                    api_key: Some("custom-secret".to_string()),
                },
            )
            .unwrap();
        let stored_claude = match stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        service
            .apply_claude_preview("ws:test", &workspace_root, "tester", &stored_claude)
            .unwrap();
        let env = service.build_agent_runtime_env(AiConfigAgent::Claude, &workspace_root).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.example.com/anthropic")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("custom-secret")
        );
    }
}
