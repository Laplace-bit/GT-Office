use std::{
    collections::BTreeMap,
    ffi::OsStr,
    path::{Path, PathBuf},
    thread,
    time::SystemTime,
};

use serde_json::{json, Value};
use thiserror::Error;
use uuid::Uuid;
use vb_abstractions::SettingsScope;
use vb_security::SecretStore;
use vb_settings::{JsonSettingsService, SettingsPaths};
use vb_storage::{
    AiConfigAuditLogInput, SavedClaudeProviderInput, SavedClaudeProviderRecord,
    SqliteAiConfigRepository,
};

use crate::{
    catalog::{
        claude_official_provider_preset, claude_provider_presets, codex_light_guide,
        gemini_light_guide, CLAUDE_OFFICIAL_PROVIDER_ID,
    },
    models::{
        AiConfigAgent, AiConfigApplyResponse, AiConfigMaskedChange, AiConfigNormalizedDraft,
        AiConfigPreviewResponse, AiConfigSnapshot, ClaudeConfigSnapshot, ClaudeDraftInput,
        ClaudeNormalizedDraft, ClaudeProviderMode, ClaudeSavedProviderSnapshot, ClaudeSnapshot,
        LightAgentConfigSnapshot, LightAgentDraftInput, LightAgentNormalizedDraft,
        StoredAiConfigPreview, StoredClaudePreview, StoredLightAgentPreview,
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
    #[error("AI_CONFIG_SAVED_PROVIDER_NOT_FOUND: {0}")]
    SavedProviderNotFound(String),
    #[error("AI_CONFIG_LIVE_SYNC_FAILED: {0}")]
    LiveSync(String),
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

    fn claude_live_settings_path(&self) -> AiConfigResult<PathBuf> {
        let home = user_home_dir().ok_or_else(|| {
            AiConfigError::LiveSync("unable to resolve user home directory".to_string())
        })?;
        Ok(claude_settings_path_from_home(&home))
    }

    fn snapshot_file_state(&self, path: &Path) -> AiConfigResult<Option<Vec<u8>>> {
        if !path.exists() {
            return Ok(None);
        }
        std::fs::read(path).map(Some).map_err(|error| {
            AiConfigError::LiveSync(format!(
                "failed to read existing Claude settings file {}: {error}",
                path.display()
            ))
        })
    }

    fn restore_file_state(&self, path: &Path, previous: Option<&[u8]>) -> AiConfigResult<()> {
        match previous {
            Some(bytes) => write_bytes_atomic(path, bytes),
            None => {
                if path.exists() {
                    std::fs::remove_file(path).map_err(|error| {
                        AiConfigError::LiveSync(format!(
                            "failed to rollback Claude settings file {}: {error}",
                            path.display()
                        ))
                    })?;
                }
                Ok(())
            }
        }
    }

    fn sync_claude_live_settings_at_path(
        &self,
        path: &Path,
        normalized: &ClaudeNormalizedDraft,
    ) -> AiConfigResult<()> {
        let mut root = read_json_object_file(path)?;
        let managed_env = if normalized.mode == ClaudeProviderMode::Official {
            BTreeMap::new()
        } else {
            let secret_ref = normalized
                .secret_ref
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AiConfigError::LiveSync(
                        "configured Claude secret reference is missing for live sync".to_string(),
                    )
                })?;
            let secret = self
                .secret_store
                .load(secret_ref)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
            build_claude_managed_env(
                normalized.mode.clone(),
                normalized.provider_id.as_deref(),
                normalized.base_url.as_deref(),
                normalized.model.as_deref(),
                normalized.auth_scheme.as_ref(),
                Some(secret.as_str()),
            )?
        };

        let root_object = root.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Claude settings root must be an object at {}",
                path.display()
            ))
        })?;

        if !root_object.contains_key("env") && managed_env.is_empty() {
            return Ok(());
        }

        let env_value = root_object
            .entry("env".to_string())
            .or_insert_with(|| json!({}));
        let env_object = env_value.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Claude settings env must be an object at {}",
                path.display()
            ))
        })?;

        for key in managed_claude_env_keys() {
            env_object.remove(key.as_str());
        }
        for (key, value) in managed_env {
            env_object.insert(key, Value::String(value));
        }
        if env_object.is_empty() {
            root_object.remove("env");
        }

        write_json_atomic(path, &root)
    }

    pub fn list_saved_claude_providers(
        &self,
        workspace_id: &str,
    ) -> AiConfigResult<Vec<ClaudeSavedProviderSnapshot>> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        self.audit_repository
            .list_saved_claude_providers(workspace_id)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .into_iter()
            .map(saved_claude_provider_snapshot_from_record)
            .collect()
    }

    pub fn switch_saved_claude_provider(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        saved_provider_id: &str,
        confirmed_by: &str,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        let live_settings_path = self.claude_live_settings_path()?;
        self.switch_saved_claude_provider_with_live_settings_path(
            workspace_id,
            workspace_root,
            saved_provider_id,
            confirmed_by,
            &live_settings_path,
        )
    }

    fn switch_saved_claude_provider_with_live_settings_path(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        saved_provider_id: &str,
        confirmed_by: &str,
        live_settings_path: &Path,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let saved_provider = self
            .audit_repository
            .get_saved_claude_provider(workspace_id, saved_provider_id)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .ok_or_else(|| AiConfigError::SavedProviderNotFound(saved_provider_id.to_string()))?;
        let normalized = normalized_from_saved_claude_provider(&saved_provider)?;
        let current = self.read_claude_config(workspace_root)?;
        let live_settings_backup = self.snapshot_file_state(&live_settings_path)?;

        self.sync_claude_live_settings_at_path(live_settings_path, &normalized)?;

        let patch = build_workspace_patch(&normalized, Some(saved_provider_id));
        if let Err(error) =
            self.settings
                .update(SettingsScope::Workspace, Some(workspace_root), &patch)
        {
            self.restore_file_state(live_settings_path, live_settings_backup.as_deref())?;
            return Err(AiConfigError::Settings(error.to_string()));
        }

        let applied_at_ms = now_ms();
        self.audit_repository
            .set_active_saved_claude_provider(workspace_id, saved_provider_id, applied_at_ms as i64)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let changes = diff_claude_config(&current, &normalized);
        let audit_id = format!("audit:{}", Uuid::new_v4());
        let changed_keys_json = serde_json::to_string(
            &changes
                .iter()
                .map(|entry| entry.key.clone())
                .collect::<Vec<_>>(),
        )
        .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(
            &normalized
                .secret_ref
                .clone()
                .into_iter()
                .collect::<Vec<_>>(),
        )
        .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: workspace_id.to_string(),
                agent: "claude".to_string(),
                mode: mode_to_string(&normalized.mode).to_string(),
                provider_id: normalized.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms: applied_at_ms as i64,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let effective = self.read_snapshot(workspace_id, workspace_root)?;
        Ok(AiConfigApplyResponse {
            workspace_id: workspace_id.to_string(),
            preview_id: format!("saved-provider:{saved_provider_id}"),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "workspace_settings".to_string(),
                "claude_live_settings".to_string(),
                "saved_provider_db".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    fn resolve_saved_claude_provider_id(
        &self,
        workspace_id: &str,
        normalized: &ClaudeNormalizedDraft,
        preferred_saved_provider_id: Option<&str>,
    ) -> AiConfigResult<String> {
        let fingerprint = fingerprint_claude_config(normalized);
        let existing_records = self
            .audit_repository
            .list_saved_claude_providers(workspace_id)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .into_iter()
            .collect::<Vec<_>>();
        if let Some(existing) = existing_records
            .iter()
            .find(|item| item.fingerprint == fingerprint)
        {
            return Ok(existing.saved_provider_id.clone());
        }
        if let Some(preferred_saved_provider_id) = preferred_saved_provider_id {
            if existing_records
                .iter()
                .any(|item| item.saved_provider_id == preferred_saved_provider_id)
            {
                return Ok(preferred_saved_provider_id.to_string());
            }
            return Err(AiConfigError::SavedProviderNotFound(
                preferred_saved_provider_id.to_string(),
            ));
        }
        Ok(format!("claude-provider:{}", Uuid::new_v4()))
    }

    fn upsert_saved_claude_provider_record(
        &self,
        workspace_id: &str,
        saved_provider_id: &str,
        normalized: &ClaudeNormalizedDraft,
        applied_at_ms: u64,
    ) -> AiConfigResult<ClaudeSavedProviderSnapshot> {
        let record = self
            .audit_repository
            .upsert_saved_claude_provider(&SavedClaudeProviderInput {
                workspace_id: workspace_id.to_string(),
                saved_provider_id: Some(saved_provider_id.to_string()),
                fingerprint: fingerprint_claude_config(normalized),
                mode: mode_to_string(&normalized.mode).to_string(),
                provider_id: normalized.provider_id.clone(),
                provider_name: display_name_for_claude_provider(normalized),
                base_url: normalized.base_url.clone(),
                model: normalized.model.clone(),
                auth_scheme: normalized
                    .auth_scheme
                    .as_ref()
                    .map(|auth| auth_to_string(auth).to_string()),
                secret_ref: normalized.secret_ref.clone(),
                has_secret: normalized.has_secret,
                created_at_ms: applied_at_ms as i64,
                updated_at_ms: applied_at_ms as i64,
                last_applied_at_ms: applied_at_ms as i64,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        saved_claude_provider_snapshot_from_record(record)
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

    pub fn read_claude_config(
        &self,
        workspace_root: &Path,
    ) -> AiConfigResult<ClaudeConfigSnapshot> {
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

        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let current = self.read_claude_config(workspace_root)?;
        let saved_provider_id = draft.saved_provider_id.clone();
        let saved_provider = if let Some(saved_provider_id) = saved_provider_id.as_deref() {
            Some(
                self.audit_repository
                    .get_saved_claude_provider(workspace_id, saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?,
            )
        } else {
            None
        };
        let (normalized, api_key_secret) =
            normalize_claude_draft(workspace_id, &current, saved_provider.as_ref(), draft)?;
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
                saved_provider_id,
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
        let live_settings_path = self.claude_live_settings_path()?;
        self.apply_claude_preview_with_live_settings_path(
            workspace_id,
            workspace_root,
            confirmed_by,
            preview,
            &live_settings_path,
        )
    }

    fn apply_claude_preview_with_live_settings_path(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        confirmed_by: &str,
        preview: &StoredClaudePreview,
        live_settings_path: &Path,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let applied_at_ms = now_ms();
        let saved_provider_id = self.resolve_saved_claude_provider_id(
            workspace_id,
            &preview.normalized_draft,
            preview.saved_provider_id.as_deref(),
        )?;
        let live_settings_backup = self.snapshot_file_state(live_settings_path)?;

        if let (Some(secret_ref), Some(secret_value)) = (
            preview.normalized_draft.secret_ref.as_deref(),
            preview.api_key_secret.as_deref(),
        ) {
            self.secret_store
                .store(secret_ref, secret_value)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
        }

        self.sync_claude_live_settings_at_path(live_settings_path, &preview.normalized_draft)?;

        let patch =
            build_workspace_patch(&preview.normalized_draft, Some(saved_provider_id.as_str()));
        if let Err(error) =
            self.settings
                .update(SettingsScope::Workspace, Some(workspace_root), &patch)
        {
            self.restore_file_state(live_settings_path, live_settings_backup.as_deref())?;
            return Err(AiConfigError::Settings(error.to_string()));
        }

        let audit_id = format!("audit:{}", Uuid::new_v4());
        let created_at_ms = applied_at_ms as i64;
        let changed_keys_json = serde_json::to_string(&preview.changed_keys)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(&preview.secret_refs)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.upsert_saved_claude_provider_record(
            workspace_id,
            &saved_provider_id,
            &preview.normalized_draft,
            applied_at_ms,
        )?;

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
                "claude_live_settings".to_string(),
                "saved_provider_db".to_string(),
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
        let mut claude_config = self.read_claude_config(workspace_root)?;
        let saved_claude_providers = self.list_saved_claude_providers(workspace_id)?;
        if claude_config.saved_provider_id.is_none() {
            claude_config.saved_provider_id = saved_claude_providers
                .iter()
                .find(|item| item.is_active)
                .map(|item| item.saved_provider_id.clone());
        }
        let codex_config = self.read_light_agent_config(AiConfigAgent::Codex, workspace_root)?;
        let gemini_config = self.read_light_agent_config(AiConfigAgent::Gemini, workspace_root)?;

        let mut codex_guide = codex_light_guide();
        codex_guide.config = codex_config;

        let mut gemini_guide = gemini_light_guide();
        gemini_guide.config = gemini_config;
        let (
            claude_install_status,
            codex_install_status,
            gemini_install_status,
            claude_mcp_installed,
            codex_mcp_installed,
            gemini_mcp_installed,
        ) = thread::scope(|scope| {
            let claude_install = scope.spawn(|| map_install_status(AiConfigAgent::Claude));
            let codex_install = scope.spawn(|| map_install_status(AiConfigAgent::Codex));
            let gemini_install = scope.spawn(|| map_install_status(AiConfigAgent::Gemini));
            let claude_mcp = scope.spawn(|| check_mcp_installed(AiConfigAgent::Claude));
            let codex_mcp = scope.spawn(|| check_mcp_installed(AiConfigAgent::Codex));
            let gemini_mcp = scope.spawn(|| check_mcp_installed(AiConfigAgent::Gemini));

            (
                claude_install.join().unwrap_or_else(|_| map_install_status(AiConfigAgent::Claude)),
                codex_install.join().unwrap_or_else(|_| map_install_status(AiConfigAgent::Codex)),
                gemini_install.join().unwrap_or_else(|_| map_install_status(AiConfigAgent::Gemini)),
                claude_mcp
                    .join()
                    .unwrap_or_else(|_| check_mcp_installed(AiConfigAgent::Claude)),
                codex_mcp
                    .join()
                    .unwrap_or_else(|_| check_mcp_installed(AiConfigAgent::Codex)),
                gemini_mcp
                    .join()
                    .unwrap_or_else(|_| check_mcp_installed(AiConfigAgent::Gemini)),
            )
        });

        codex_guide.mcp_installed = codex_mcp_installed;
        gemini_guide.mcp_installed = gemini_mcp_installed;

        Ok(AiConfigSnapshot {
            agents: vec![
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Claude,
                    title: "aiConfig.agent.claude.title".to_string(),
                    subtitle: "aiConfig.agent.claude.subtitle".to_string(),
                    install_status: claude_install_status,
                    mcp_installed: claude_mcp_installed,
                    config_status: if claude_config.active_mode.is_some() {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: claude_summary(&claude_config),
                },
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Codex,
                    title: "aiConfig.agent.codex.title".to_string(),
                    subtitle: "aiConfig.agent.codex.subtitle".to_string(),
                    install_status: codex_install_status,
                    mcp_installed: codex_guide.mcp_installed,
                    config_status: if codex_guide.config.has_secret {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: Some("aiConfig.agent.codex.summary".to_string()),
                },
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Gemini,
                    title: "aiConfig.agent.gemini.title".to_string(),
                    subtitle: "aiConfig.agent.gemini.subtitle".to_string(),
                    install_status: gemini_install_status,
                    mcp_installed: gemini_guide.mcp_installed,
                    config_status: if gemini_guide.config.has_secret {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: Some("aiConfig.agent.gemini.summary".to_string()),
                },
            ],
            claude: ClaudeSnapshot {
                presets: claude_provider_presets(),
                config: claude_config,
                saved_providers: saved_claude_providers,
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
            .ok_or_else(|| {
                AiConfigError::Invalid("configured Claude endpoint is missing".to_string())
            })?;
        let model = config
            .model
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AiConfigError::Invalid("configured Claude model is missing".to_string())
            })?;
        let auth_scheme = config.auth_scheme.ok_or_else(|| {
            AiConfigError::Invalid("configured Claude auth scheme is missing".to_string())
        })?;
        let secret_ref = config
            .secret_ref
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AiConfigError::Invalid("configured Claude secret reference is missing".to_string())
            })?;
        let secret = self
            .secret_store
            .load(&secret_ref)
            .map_err(|error| AiConfigError::Secret(error.to_string()))?;

        build_claude_managed_env(
            mode,
            config.provider_id.as_deref(),
            Some(base_url.as_str()),
            Some(model.as_str()),
            Some(&auth_scheme),
            Some(secret.as_str()),
        )
    }
}

fn normalize_claude_draft(
    workspace_id: &str,
    current: &ClaudeConfigSnapshot,
    saved_provider: Option<&SavedClaudeProviderRecord>,
    draft: ClaudeDraftInput,
) -> AiConfigResult<(ClaudeNormalizedDraft, Option<String>)> {
    match draft.mode {
        ClaudeProviderMode::Official => Ok((official_claude_normalized_draft(), None)),
        ClaudeProviderMode::Preset => {
            let provider_id = required_field(draft.provider_id, "providerId")?;
            let preset = claude_provider_presets()
                .into_iter()
                .find(|item| item.provider_id == provider_id)
                .ok_or_else(|| AiConfigError::Invalid("unknown Claude preset".to_string()))?;
            let provider_name =
                normalize_non_empty(draft.provider_name).unwrap_or_else(|| preset.name.clone());
            let model = Some(
                normalize_non_empty(draft.model)
                    .unwrap_or_else(|| preset.recommended_model.clone()),
            );
            let base_url = Some(normalize_endpoint(
                draft.base_url.unwrap_or_else(|| preset.endpoint.clone()),
            )?);
            let auth_scheme = Some(draft.auth_scheme.unwrap_or(preset.auth_scheme.clone()));
            let secret_input = normalize_non_empty(draft.api_key);
            let can_reuse_secret = current.provider_id.as_deref()
                == Some(preset.provider_id.as_str())
                && current.has_secret
                && current.secret_ref.is_some();
            let saved_provider_secret_ref = saved_provider.and_then(|item| {
                if item.provider_id.as_deref() == Some(preset.provider_id.as_str())
                    && item.has_secret
                {
                    item.secret_ref
                        .as_ref()
                        .and_then(|value| none_if_empty(value.clone()))
                } else {
                    None
                }
            });
            let secret_ref = if secret_input.is_some() {
                Some(build_secret_ref(workspace_id, &preset.provider_id))
            } else if saved_provider_secret_ref.is_some() {
                saved_provider_secret_ref
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
        ClaudeProviderMode::Custom => {
            let provider_name = required_field(draft.provider_name, "providerName")?;
            let base_url = Some(normalize_endpoint(required_field(
                draft.base_url,
                "baseUrl",
            )?)?);
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
            let saved_provider_secret_ref = saved_provider.and_then(|item| {
                if item.provider_id.as_deref() == Some("custom-gateway") && item.has_secret {
                    item.secret_ref
                        .as_ref()
                        .and_then(|value| none_if_empty(value.clone()))
                } else {
                    None
                }
            });
            let secret_ref = if secret_input.is_some() {
                Some(build_secret_ref(workspace_id, "custom-gateway"))
            } else if saved_provider_secret_ref.is_some() {
                saved_provider_secret_ref
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

fn build_workspace_patch(
    normalized: &ClaudeNormalizedDraft,
    saved_provider_id: Option<&str>,
) -> Value {
    json!({
        "ai": {
            "providers": {
                "claude": {
                    "savedProviderId": saved_provider_id,
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
    let object = config_value.as_object().cloned().unwrap_or_default();

    let saved_provider_id = object
        .get("savedProviderId")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
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

    Ok(with_official_claude_config_defaults(ClaudeConfigSnapshot {
        saved_provider_id,
        active_mode,
        provider_id,
        provider_name,
        base_url,
        model,
        auth_scheme,
        secret_ref,
        has_secret,
        updated_at_ms,
    }))
}

fn build_warnings(normalized: &ClaudeNormalizedDraft) -> Vec<String> {
    let mut warnings = Vec::new();
    warnings.push("aiConfig.warning.systemClaudeSync".to_string());
    if normalized.mode == ClaudeProviderMode::Custom {
        warnings.push("aiConfig.warning.customGateway".to_string());
    }
    warnings
}

fn display_name_for_claude_provider(normalized: &ClaudeNormalizedDraft) -> String {
    normalized
        .provider_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| match normalized.mode {
            ClaudeProviderMode::Official => "aiConfig.preset.anthropic.name".to_string(),
            ClaudeProviderMode::Preset => normalized
                .provider_id
                .clone()
                .unwrap_or_else(|| "claude-provider".to_string()),
            ClaudeProviderMode::Custom => "aiConfig.mode.custom".to_string(),
        })
}

fn official_claude_normalized_draft() -> ClaudeNormalizedDraft {
    let preset = claude_official_provider_preset();
    ClaudeNormalizedDraft {
        mode: ClaudeProviderMode::Official,
        provider_id: Some(preset.provider_id),
        provider_name: Some(preset.name),
        base_url: Some(preset.endpoint),
        model: Some(preset.recommended_model),
        auth_scheme: Some(preset.auth_scheme),
        secret_ref: None,
        has_secret: false,
    }
}

fn with_official_claude_config_defaults(mut config: ClaudeConfigSnapshot) -> ClaudeConfigSnapshot {
    let is_official = config.active_mode == Some(ClaudeProviderMode::Official)
        || config.provider_id.as_deref() == Some(CLAUDE_OFFICIAL_PROVIDER_ID);
    if !is_official {
        return config;
    }
    let defaults = official_claude_normalized_draft();
    config.provider_id = config.provider_id.or(defaults.provider_id);
    config.provider_name = config.provider_name.or(defaults.provider_name);
    config.base_url = config.base_url.or(defaults.base_url);
    config.model = config.model.or(defaults.model);
    config.auth_scheme = config.auth_scheme.or(defaults.auth_scheme);
    config
}

fn fingerprint_claude_config(normalized: &ClaudeNormalizedDraft) -> String {
    let payload = json!({
        "mode": mode_to_string(&normalized.mode),
        "providerId": normalized.provider_id,
        "providerName": display_name_for_claude_provider(normalized),
        "baseUrl": normalized.base_url,
        "model": normalized.model,
        "authScheme": normalized.auth_scheme.as_ref().map(auth_to_string),
        "hasSecret": normalized.has_secret,
    });
    payload.to_string()
}

fn saved_claude_provider_snapshot_from_record(
    record: SavedClaudeProviderRecord,
) -> AiConfigResult<ClaudeSavedProviderSnapshot> {
    let mode = parse_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Claude provider has invalid mode: {}",
            record.mode
        ))
    })?;
    let defaults = if mode == ClaudeProviderMode::Official {
        Some(official_claude_normalized_draft())
    } else {
        None
    };
    Ok(ClaudeSavedProviderSnapshot {
        saved_provider_id: record.saved_provider_id,
        mode,
        provider_id: record.provider_id.or_else(|| {
            defaults
                .as_ref()
                .and_then(|value| value.provider_id.clone())
        }),
        provider_name: if record.provider_name.trim().is_empty() {
            defaults
                .as_ref()
                .and_then(|value| value.provider_name.clone())
                .unwrap_or_else(|| "aiConfig.preset.anthropic.name".to_string())
        } else {
            record.provider_name
        },
        base_url: record
            .base_url
            .or_else(|| defaults.as_ref().and_then(|value| value.base_url.clone())),
        model: record
            .model
            .or_else(|| defaults.as_ref().and_then(|value| value.model.clone())),
        auth_scheme: record
            .auth_scheme
            .as_deref()
            .and_then(parse_auth_scheme)
            .or_else(|| {
                defaults
                    .as_ref()
                    .and_then(|value| value.auth_scheme.clone())
            }),
        has_secret: record.has_secret,
        is_active: record.is_active,
        created_at_ms: record.created_at_ms.max(0) as u64,
        updated_at_ms: record.updated_at_ms.max(0) as u64,
        last_applied_at_ms: record.last_applied_at_ms.max(0) as u64,
    })
}

fn normalized_from_saved_claude_provider(
    record: &SavedClaudeProviderRecord,
) -> AiConfigResult<ClaudeNormalizedDraft> {
    let mode = parse_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Claude provider has invalid mode: {}",
            record.mode
        ))
    })?;
    if mode == ClaudeProviderMode::Official {
        return Ok(official_claude_normalized_draft());
    }
    let auth_scheme = record.auth_scheme.as_deref().and_then(parse_auth_scheme);
    let missing_secret_ref = record
        .secret_ref
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if mode != ClaudeProviderMode::Official && (!record.has_secret || missing_secret_ref) {
        return Err(AiConfigError::Storage(format!(
            "saved Claude provider {} is missing secret reference",
            record.saved_provider_id
        )));
    }

    Ok(ClaudeNormalizedDraft {
        mode,
        provider_id: record.provider_id.clone(),
        provider_name: Some(record.provider_name.clone()),
        base_url: record.base_url.clone(),
        model: record.model.clone(),
        auth_scheme,
        secret_ref: record.secret_ref.clone(),
        has_secret: record.has_secret,
    })
}

fn build_claude_managed_env(
    mode: ClaudeProviderMode,
    provider_id: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
    auth_scheme: Option<&crate::models::ClaudeAuthScheme>,
    secret: Option<&str>,
) -> AiConfigResult<BTreeMap<String, String>> {
    if mode == ClaudeProviderMode::Official {
        return Ok(BTreeMap::new());
    }

    let base_url = base_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AiConfigError::Invalid("configured Claude endpoint is missing".to_string())
        })?;
    let model = model
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AiConfigError::Invalid("configured Claude model is missing".to_string()))?;
    let auth_scheme = auth_scheme.ok_or_else(|| {
        AiConfigError::Invalid("configured Claude auth scheme is missing".to_string())
    })?;
    let secret = secret
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AiConfigError::Invalid("configured Claude secret is missing".to_string()))?;

    let mut env = provider_id
        .and_then(|value| {
            claude_provider_presets()
                .into_iter()
                .find(|preset| preset.provider_id == value)
                .map(|preset| preset.extra_env)
        })
        .unwrap_or_default();
    env.insert("ANTHROPIC_BASE_URL".to_string(), base_url.to_string());
    env.insert("ANTHROPIC_MODEL".to_string(), model.to_string());
    env.insert(
        "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
        model.to_string(),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
        model.to_string(),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
        model.to_string(),
    );
    env.insert(auth_scheme.env_var_name().to_string(), secret.to_string());
    Ok(env)
}

fn managed_claude_env_keys() -> Vec<String> {
    let mut keys = vec![
        "ANTHROPIC_API_KEY".to_string(),
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        "ANTHROPIC_BASE_URL".to_string(),
        "ANTHROPIC_MODEL".to_string(),
        "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
        "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
        "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
    ];
    for preset in claude_provider_presets() {
        for key in preset.extra_env.keys() {
            if !keys.iter().any(|existing| existing == key) {
                keys.push(key.clone());
            }
        }
    }
    keys
}

fn claude_settings_path_from_home(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

fn read_json_object_file(path: &Path) -> AiConfigResult<Value> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let raw = std::fs::read_to_string(path).map_err(|error| {
        AiConfigError::LiveSync(format!(
            "failed to read Claude settings file {}: {error}",
            path.display()
        ))
    })?;
    let value = serde_json::from_str::<Value>(&raw).map_err(|error| {
        AiConfigError::LiveSync(format!(
            "failed to parse Claude settings file {}: {error}",
            path.display()
        ))
    })?;
    if !value.is_object() {
        return Err(AiConfigError::LiveSync(format!(
            "Claude settings root must be an object at {}",
            path.display()
        )));
    }
    Ok(value)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> AiConfigResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AiConfigError::LiveSync(format!(
                "failed to create Claude settings directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "invalid Claude settings file name for {}",
                path.display()
            ))
        })?;
    let temp_name = format!("{file_name}.tmp.{}", now_ms());
    let temp_path = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(temp_name);

    std::fs::write(&temp_path, bytes).map_err(|error| {
        AiConfigError::LiveSync(format!(
            "failed to write temporary Claude settings file {}: {error}",
            temp_path.display()
        ))
    })?;
    if let Err(first_error) = std::fs::rename(&temp_path, path) {
        if cfg!(windows) && path.exists() {
            std::fs::remove_file(path).map_err(|error| {
                let _ = std::fs::remove_file(&temp_path);
                AiConfigError::LiveSync(format!(
                    "failed to replace Claude settings file {} after rename error ({first_error}): {error}",
                    path.display()
                ))
            })?;
            std::fs::rename(&temp_path, path).map_err(|error| {
                let _ = std::fs::remove_file(&temp_path);
                AiConfigError::LiveSync(format!(
                    "failed to finalize Claude settings replacement {} after rename error ({first_error}): {error}",
                    path.display()
                ))
            })?;
        } else {
            let _ = std::fs::remove_file(&temp_path);
            return Err(AiConfigError::LiveSync(format!(
                "failed to replace Claude settings file {}: {first_error}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn write_json_atomic(path: &Path, value: &Value) -> AiConfigResult<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        AiConfigError::LiveSync(format!("failed to serialize Claude settings JSON: {error}"))
    })?;
    write_bytes_atomic(path, &bytes)
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
    normalize_non_empty(value).ok_or_else(|| AiConfigError::Invalid(format!("{field} is required")))
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
        npm_ready: status.npm_ready,
        install_available: status.install_available,
        uninstall_available: status.uninstall_available,
        detected_by: status.detected_by,
        issues: status.issues,
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

fn path_from_env(value: Option<&OsStr>) -> Option<PathBuf> {
    let value = value?;
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn resolve_user_home_dir_from_values(
    home: Option<&OsStr>,
    userprofile: Option<&OsStr>,
    homedrive: Option<&OsStr>,
    homepath: Option<&OsStr>,
    prefer_windows_order: bool,
) -> Option<PathBuf> {
    let home_path = path_from_env(home);
    let userprofile_path = path_from_env(userprofile);
    let homedrive_path = path_from_env(homedrive);
    let homepath_path = path_from_env(homepath);
    let joined_windows_home = match (homedrive_path.as_ref(), homepath_path.as_ref()) {
        (Some(drive), Some(path)) if !path.is_absolute() => {
            let path_str = path.as_os_str().to_string_lossy();
            let trimmed = path_str.trim_start_matches(['\\', '/']);
            Some(drive.join(trimmed))
        }
        (Some(drive), Some(path)) => Some(drive.join(path)),
        _ => None,
    };

    if prefer_windows_order {
        userprofile_path.or(joined_windows_home).or(home_path)
    } else {
        home_path.or(userprofile_path).or(joined_windows_home)
    }
}

fn user_home_dir() -> Option<PathBuf> {
    resolve_user_home_dir_from_values(
        std::env::var_os("HOME").as_deref(),
        std::env::var_os("USERPROFILE").as_deref(),
        std::env::var_os("HOMEDRIVE").as_deref(),
        std::env::var_os("HOMEPATH").as_deref(),
        cfg!(windows),
    )
}

fn check_mcp_installed(agent: AiConfigAgent) -> bool {
    let home = match user_home_dir() {
        Some(path) => path,
        None => return false,
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
        let dir =
            std::env::temp_dir().join(format!("gtoffice-ai-config-{name}-{}", Uuid::new_v4()));
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

    fn workspace_id(name: &str) -> String {
        format!("ws:{name}:{}", Uuid::new_v4())
    }

    fn live_settings_path_for(dir: &Path) -> PathBuf {
        dir.join("mock-home").join(".claude").join("settings.json")
    }

    #[test]
    fn preview_rejects_missing_api_key_for_new_preset() {
        let dir = temp_dir("missing-key");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("missing-key");
        let error = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
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
    fn preview_preset_mode_preserves_custom_provider_name() {
        let dir = temp_dir("preset-provider-name");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("preset-provider-name");

        let (preview, _) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("deepseek".to_string()),
                    provider_name: Some("DeepSeek Team Gateway".to_string()),
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("deepseek-secret".to_string()),
                },
            )
            .unwrap();

        let normalized = match preview.normalized_draft {
            AiConfigNormalizedDraft::Claude(value) => value,
            _ => panic!("Expected Claude normalized draft"),
        };
        assert_eq!(
            normalized.provider_name.as_deref(),
            Some("DeepSeek Team Gateway")
        );
    }

    #[test]
    fn preview_official_mode_uses_official_defaults() {
        let dir = temp_dir("official-preview");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("official-preview");

        let (preview, _) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Official,
                    saved_provider_id: None,
                    provider_id: None,
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: None,
                },
            )
            .unwrap();

        let normalized = match preview.normalized_draft {
            AiConfigNormalizedDraft::Claude(value) => value,
            _ => panic!("Expected Claude normalized draft"),
        };
        assert_eq!(
            normalized.provider_id.as_deref(),
            Some("anthropic-official")
        );
        assert_eq!(
            normalized.provider_name.as_deref(),
            Some("aiConfig.preset.anthropic.name")
        );
        assert_eq!(
            normalized.base_url.as_deref(),
            Some("https://api.anthropic.com")
        );
        assert_eq!(
            normalized.model.as_deref(),
            Some("claude-sonnet-4-20250514")
        );
        assert_eq!(
            normalized.auth_scheme,
            Some(crate::models::ClaudeAuthScheme::AnthropicAuthToken)
        );
        assert!(preview.masked_diff.iter().any(|entry| {
            entry.key == "ai.providers.claude.baseUrl"
                && entry.after.as_deref() == Some("https://api.anthropic.com")
        }));
        assert!(preview.masked_diff.iter().any(|entry| {
            entry.key == "ai.providers.claude.model"
                && entry.after.as_deref() == Some("claude-sonnet-4-20250514")
        }));
    }

    #[test]
    fn apply_persists_secret_ref_without_plaintext_in_workspace_file() {
        let dir = temp_dir("apply");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("apply");
        let live_settings_path = live_settings_path_for(&dir);
        let (preview, stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
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
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &stored_claude,
                &live_settings_path,
            )
            .unwrap();
        let config_raw = fs::read_to_string(workspace_root.join(".gtoffice/config.json")).unwrap();
        assert!(!config_raw.contains("secret-token"));
        assert!(config_raw.contains("secretRef"));
        assert!(preview.secret_refs.len() == 1);
        assert_eq!(
            applied.effective.claude.config.provider_id.as_deref(),
            Some("deepseek")
        );
        assert!(applied.effective.claude.config.saved_provider_id.is_some());
        assert_eq!(applied.effective.claude.saved_providers.len(), 1);
        assert_eq!(
            applied.effective.claude.saved_providers[0]
                .provider_id
                .as_deref(),
            Some("deepseek")
        );
    }

    #[test]
    fn runtime_env_uses_stored_secret_reference() {
        let dir = temp_dir("runtime");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("runtime");
        let live_settings_path = live_settings_path_for(&dir);
        let (_, stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Custom,
                    saved_provider_id: None,
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
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &stored_claude,
                &live_settings_path,
            )
            .unwrap();
        let env = service
            .build_agent_runtime_env(AiConfigAgent::Claude, &workspace_root)
            .unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.example.com/anthropic")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("custom-secret")
        );
        assert_eq!(
            env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .map(String::as_str),
            Some("claude-sonnet-4-5")
        );
    }

    #[test]
    fn switching_saved_claude_provider_updates_workspace_and_live_settings() {
        let dir = temp_dir("saved-switch");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("saved-switch");
        let live_settings_path = live_settings_path_for(&dir);

        let (_, deepseek_stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("deepseek".to_string()),
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("deepseek-secret".to_string()),
                },
            )
            .unwrap();
        let deepseek_stored = match deepseek_stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        let first = service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &deepseek_stored,
                &live_settings_path,
            )
            .unwrap();
        let deepseek_saved_id = first
            .effective
            .claude
            .saved_providers
            .iter()
            .find(|item| item.provider_id.as_deref() == Some("deepseek"))
            .map(|item| item.saved_provider_id.clone())
            .expect("deepseek saved provider");

        let (_, minimax_stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("minimax".to_string()),
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("minimax-secret".to_string()),
                },
            )
            .unwrap();
        let minimax_stored = match minimax_stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &minimax_stored,
                &live_settings_path,
            )
            .unwrap();
        let before_switch_order = service
            .list_saved_claude_providers(&workspace_id)
            .unwrap()
            .into_iter()
            .map(|item| item.saved_provider_id)
            .collect::<Vec<_>>();

        let switched = service
            .switch_saved_claude_provider_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                &deepseek_saved_id,
                "tester",
                &live_settings_path,
            )
            .unwrap();

        assert_eq!(
            switched
                .effective
                .claude
                .config
                .saved_provider_id
                .as_deref(),
            Some(deepseek_saved_id.as_str())
        );
        assert_eq!(
            switched.effective.claude.config.provider_id.as_deref(),
            Some("deepseek")
        );
        assert_eq!(switched.effective.claude.saved_providers.len(), 2);
        let after_switch_order = switched
            .effective
            .claude
            .saved_providers
            .iter()
            .map(|item| item.saved_provider_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(after_switch_order, before_switch_order);
        let active = switched
            .effective
            .claude
            .saved_providers
            .iter()
            .find(|item| item.is_active)
            .expect("active saved provider");
        assert_eq!(active.saved_provider_id, deepseek_saved_id);

        let workspace_json = read_claude_config_from_value(
            &read_json_object_file(&workspace_root.join(".gtoffice/config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(workspace_json.provider_id.as_deref(), Some("deepseek"));
        assert_eq!(
            workspace_json.saved_provider_id.as_deref(),
            Some(deepseek_saved_id.as_str())
        );

        let live_settings = read_json_object_file(&live_settings_path).unwrap();
        assert_eq!(
            live_settings["env"]["ANTHROPIC_BASE_URL"],
            json!("https://api.deepseek.com/anthropic")
        );
        assert_eq!(
            live_settings["env"]["ANTHROPIC_AUTH_TOKEN"],
            json!("deepseek-secret")
        );
    }

    #[test]
    fn editing_saved_claude_provider_reuses_saved_provider_id_and_secret() {
        let dir = temp_dir("saved-edit");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("saved-edit");
        let live_settings_path = live_settings_path_for(&dir);

        let (_, deepseek_stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("deepseek".to_string()),
                    provider_name: Some("DeepSeek Primary".to_string()),
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("deepseek-secret".to_string()),
                },
            )
            .unwrap();
        let deepseek_stored = match deepseek_stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        let first = service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &deepseek_stored,
                &live_settings_path,
            )
            .unwrap();
        let deepseek_saved_id = first
            .effective
            .claude
            .saved_providers
            .iter()
            .find(|item| item.provider_id.as_deref() == Some("deepseek"))
            .map(|item| item.saved_provider_id.clone())
            .expect("deepseek saved provider");

        let (_, minimax_stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("minimax".to_string()),
                    provider_name: Some("MiniMax Primary".to_string()),
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("minimax-secret".to_string()),
                },
            )
            .unwrap();
        let minimax_stored = match minimax_stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &minimax_stored,
                &live_settings_path,
            )
            .unwrap();

        let (_, edited_preview) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: Some(deepseek_saved_id.clone()),
                    provider_id: Some("deepseek".to_string()),
                    provider_name: Some("DeepSeek Team Gateway".to_string()),
                    base_url: Some("https://api.deepseek.com/anthropic".to_string()),
                    model: Some("DeepSeek-V3.2".to_string()),
                    auth_scheme: Some(crate::models::ClaudeAuthScheme::AnthropicAuthToken),
                    api_key: None,
                },
            )
            .unwrap();
        let edited_preview = match edited_preview {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };
        let applied = service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &edited_preview,
                &live_settings_path,
            )
            .unwrap();

        assert_eq!(applied.effective.claude.saved_providers.len(), 2);
        let edited = applied
            .effective
            .claude
            .saved_providers
            .iter()
            .find(|item| item.saved_provider_id == deepseek_saved_id)
            .expect("edited deepseek provider");
        assert_eq!(edited.provider_name, "DeepSeek Team Gateway");
        assert!(edited.is_active);
        assert_eq!(
            applied.effective.claude.config.saved_provider_id.as_deref(),
            Some(deepseek_saved_id.as_str())
        );

        let live_settings = read_json_object_file(&live_settings_path).unwrap();
        assert_eq!(
            live_settings["env"]["ANTHROPIC_AUTH_TOKEN"],
            json!("deepseek-secret")
        );
    }

    #[test]
    fn warning_strings_are_translation_keys() {
        let warnings = build_warnings(&ClaudeNormalizedDraft {
            mode: ClaudeProviderMode::Preset,
            provider_id: Some("deepseek".to_string()),
            provider_name: Some("DeepSeek".to_string()),
            base_url: Some("https://api.deepseek.com/anthropic".to_string()),
            model: Some("DeepSeek-V3.2".to_string()),
            auth_scheme: Some(crate::models::ClaudeAuthScheme::AnthropicAuthToken),
            secret_ref: Some("secret-ref".to_string()),
            has_secret: true,
        });
        assert_eq!(
            warnings,
            vec!["aiConfig.warning.systemClaudeSync".to_string()]
        );
    }

    #[test]
    fn live_settings_sync_preserves_existing_fields_and_updates_managed_env() {
        let dir = temp_dir("live-sync");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("live-sync");
        let live_settings_path = live_settings_path_for(&dir);
        fs::create_dir_all(live_settings_path.parent().unwrap()).unwrap();
        fs::write(
            &live_settings_path,
            serde_json::to_vec_pretty(&json!({
                "env": {
                    "UNRELATED_FLAG": "keep-me",
                    "ANTHROPIC_BASE_URL": "https://old.example.com",
                    "ANTHROPIC_API_KEY": "old-key"
                },
                "mcpServers": {
                    "gto-agent-bridge": {
                        "command": "npx"
                    }
                },
                "permissions": {
                    "allow_file_access": true
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let (_, stored) = service
            .preview_claude_patch(
                &workspace_id,
                &workspace_root,
                "workspace",
                ClaudeDraftInput {
                    mode: ClaudeProviderMode::Preset,
                    saved_provider_id: None,
                    provider_id: Some("minimax".to_string()),
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    api_key: Some("minimax-secret".to_string()),
                },
            )
            .unwrap();
        let stored_claude = match stored {
            StoredAiConfigPreview::Claude(p) => p,
            _ => panic!("Expected Claude preview"),
        };

        service
            .apply_claude_preview_with_live_settings_path(
                &workspace_id,
                &workspace_root,
                "tester",
                &stored_claude,
                &live_settings_path,
            )
            .unwrap();

        let live_settings = read_json_object_file(&live_settings_path).unwrap();
        assert_eq!(
            live_settings["permissions"]["allow_file_access"],
            json!(true)
        );
        assert_eq!(
            live_settings["mcpServers"]["gto-agent-bridge"]["command"],
            json!("npx")
        );
        assert_eq!(live_settings["env"]["UNRELATED_FLAG"], json!("keep-me"));
        assert_eq!(
            live_settings["env"]["ANTHROPIC_BASE_URL"],
            json!("https://api.minimaxi.com/anthropic")
        );
        assert_eq!(
            live_settings["env"]["ANTHROPIC_MODEL"],
            json!("MiniMax-M2.5")
        );
        assert_eq!(
            live_settings["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"],
            json!("MiniMax-M2.5")
        );
        assert_eq!(
            live_settings["env"]["ANTHROPIC_AUTH_TOKEN"],
            json!("minimax-secret")
        );
        assert_eq!(live_settings["env"]["API_TIMEOUT_MS"], json!("3000000"));
        assert_eq!(
            live_settings["env"]["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
            json!("1")
        );
        assert!(live_settings["env"].get("ANTHROPIC_API_KEY").is_none());
    }

    #[test]
    fn official_mode_clears_managed_env_but_preserves_unrelated_env() {
        let dir = temp_dir("official-sync");
        let live_settings_path = live_settings_path_for(&dir);
        fs::create_dir_all(live_settings_path.parent().unwrap()).unwrap();
        fs::write(
            &live_settings_path,
            serde_json::to_vec_pretty(&json!({
                "env": {
                    "UNRELATED_FLAG": "keep-me",
                    "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
                    "ANTHROPIC_MODEL": "MiniMax-M2.5",
                    "ANTHROPIC_AUTH_TOKEN": "secret",
                    "API_TIMEOUT_MS": "3000000"
                },
                "mcpServers": {
                    "gto-agent-bridge": {
                        "command": "npx"
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let service = service_for(&dir);

        service
            .sync_claude_live_settings_at_path(
                &live_settings_path,
                &ClaudeNormalizedDraft {
                    mode: ClaudeProviderMode::Official,
                    provider_id: None,
                    provider_name: None,
                    base_url: None,
                    model: None,
                    auth_scheme: None,
                    secret_ref: None,
                    has_secret: false,
                },
            )
            .unwrap();

        let live_settings = read_json_object_file(&live_settings_path).unwrap();
        assert_eq!(live_settings["env"]["UNRELATED_FLAG"], json!("keep-me"));
        assert!(live_settings["env"].get("ANTHROPIC_BASE_URL").is_none());
        assert!(live_settings["env"].get("ANTHROPIC_MODEL").is_none());
        assert!(live_settings["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert!(live_settings["env"].get("API_TIMEOUT_MS").is_none());
        assert_eq!(
            live_settings["mcpServers"]["gto-agent-bridge"]["command"],
            json!("npx")
        );
    }

    #[test]
    fn managed_env_includes_default_model_aliases_and_preset_extra_env() {
        let env = build_claude_managed_env(
            ClaudeProviderMode::Preset,
            Some("minimax"),
            Some("https://api.minimaxi.com/anthropic"),
            Some("MiniMax-M2.5"),
            Some(&crate::models::ClaudeAuthScheme::AnthropicAuthToken),
            Some("secret"),
        )
        .unwrap();

        assert_eq!(
            env.get("API_TIMEOUT_MS").map(String::as_str),
            Some("3000000")
        );
        assert_eq!(
            env.get("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").map(String::as_str),
            Some("MiniMax-M2.5")
        );
        assert_eq!(
            env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .map(String::as_str),
            Some("MiniMax-M2.5")
        );
        assert_eq!(
            env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").map(String::as_str),
            Some("MiniMax-M2.5")
        );
    }

    #[test]
    fn windows_home_resolution_prefers_userprofile() {
        let resolved = resolve_user_home_dir_from_values(
            Some(OsStr::new("/msys64/home/dev")),
            Some(OsStr::new("C:\\Users\\dev")),
            Some(OsStr::new("C:")),
            Some(OsStr::new("\\Users\\fallback")),
            true,
        )
        .unwrap();
        assert_eq!(resolved, PathBuf::from("C:\\Users\\dev"));
    }

    #[test]
    fn windows_home_resolution_falls_back_to_home_drive_pair() {
        let resolved = resolve_user_home_dir_from_values(
            None,
            None,
            Some(OsStr::new("D:")),
            Some(OsStr::new("\\Users\\dev")),
            true,
        )
        .unwrap();
        assert_eq!(resolved, PathBuf::from("D:").join("Users\\dev"));
    }

    #[test]
    fn non_windows_home_resolution_prefers_home() {
        let resolved = resolve_user_home_dir_from_values(
            Some(OsStr::new("/home/dev")),
            Some(OsStr::new("/Users/fallback")),
            None,
            None,
            false,
        )
        .unwrap();
        assert_eq!(resolved, PathBuf::from("/home/dev"));
    }
}
