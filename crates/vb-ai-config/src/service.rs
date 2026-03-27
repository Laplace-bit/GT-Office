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
    AiConfigAuditLogInput, SavedAiProviderInput, SavedAiProviderRecord, SavedClaudeProviderInput,
    SavedClaudeProviderRecord, SqliteAiConfigRepository,
};

use crate::{
    catalog::{
        claude_official_provider_preset, claude_provider_presets, codex_provider_presets,
        codex_snapshot_template, gemini_provider_presets, gemini_snapshot_template,
        CLAUDE_OFFICIAL_PROVIDER_ID,
    },
    models::{
        AiConfigAgent, AiConfigApplyResponse, AiConfigMaskedChange, AiConfigNormalizedDraft,
        AiConfigPreviewResponse, AiConfigSnapshot, ClaudeAuthScheme, ClaudeConfigSnapshot,
        ClaudeDraftInput, ClaudeNormalizedDraft, ClaudeProviderMode, ClaudeSavedProviderSnapshot,
        ClaudeSnapshot, CodexConfigSnapshot, CodexDraftInput, CodexNormalizedDraft,
        CodexProviderMode, CodexSavedProviderSnapshot, GeminiAuthMode, GeminiConfigSnapshot,
        GeminiDraftInput, GeminiNormalizedDraft, GeminiProviderMode, GeminiSavedProviderSnapshot,
        StoredAiConfigPreview, StoredClaudePreview, StoredCodexPreview, StoredGeminiPreview,
    },
};

const AI_SECRET_SERVICE: &str = "gtoffice.ai-config";
const AI_SECRET_NAMESPACE: &str = "AI_CONFIG_SECRET";
const GTO_AGENT_BRIDGE_SERVER_ID: &str = "gto-agent-bridge";
const GLOBAL_AI_CONFIG_CONTEXT: &str = "global";

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
        _workspace_id: &str,
    ) -> AiConfigResult<Vec<ClaudeSavedProviderSnapshot>> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        self.audit_repository
            .list_saved_claude_providers(GLOBAL_AI_CONFIG_CONTEXT)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .into_iter()
            .map(saved_claude_provider_snapshot_from_record)
            .collect()
    }

    pub fn switch_saved_claude_provider(
        &self,
        _workspace_id: &str,
        workspace_root: &Path,
        saved_provider_id: &str,
        confirmed_by: &str,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        let live_settings_path = self.claude_live_settings_path()?;
        self.switch_saved_claude_provider_with_live_settings_path(
            GLOBAL_AI_CONFIG_CONTEXT,
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
            .get_saved_claude_provider(GLOBAL_AI_CONFIG_CONTEXT, saved_provider_id)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .ok_or_else(|| AiConfigError::SavedProviderNotFound(saved_provider_id.to_string()))?;
        let normalized = normalized_from_saved_claude_provider(&saved_provider)?;
        let current = self.read_claude_config(workspace_root)?;
        let live_settings_backup = self.snapshot_file_state(&live_settings_path)?;

        self.sync_claude_live_settings_at_path(live_settings_path, &normalized)?;

        let patch = build_workspace_patch(&normalized, Some(saved_provider_id));
        if let Err(error) = self.settings.update(SettingsScope::User, None, &patch) {
            self.restore_file_state(live_settings_path, live_settings_backup.as_deref())?;
            return Err(AiConfigError::Settings(error.to_string()));
        }

        let applied_at_ms = now_ms();
        self.audit_repository
            .set_active_saved_claude_provider(
                GLOBAL_AI_CONFIG_CONTEXT,
                saved_provider_id,
                applied_at_ms as i64,
            )
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
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                agent: "claude".to_string(),
                mode: mode_to_string(&normalized.mode).to_string(),
                provider_id: normalized.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms: applied_at_ms as i64,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let effective = self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
        Ok(AiConfigApplyResponse {
            workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            preview_id: format!("saved-provider:{saved_provider_id}"),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "user_settings".to_string(),
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
            .list_saved_claude_providers(GLOBAL_AI_CONFIG_CONTEXT)
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
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
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

    fn list_saved_codex_providers(&self) -> AiConfigResult<Vec<CodexSavedProviderSnapshot>> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        self.audit_repository
            .list_saved_providers("codex")
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .into_iter()
            .map(saved_codex_provider_snapshot_from_record)
            .collect()
    }

    fn list_saved_gemini_providers(&self) -> AiConfigResult<Vec<GeminiSavedProviderSnapshot>> {
        self.audit_repository
            .ensure_schema()
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        self.audit_repository
            .list_saved_providers("gemini")
            .map_err(|error| AiConfigError::Storage(error.to_string()))?
            .into_iter()
            .map(saved_gemini_provider_snapshot_from_record)
            .collect()
    }

    fn resolve_saved_provider_id(
        &self,
        agent: &str,
        fingerprint: String,
        preferred_saved_provider_id: Option<&str>,
    ) -> AiConfigResult<String> {
        let existing_records = self
            .audit_repository
            .list_saved_providers(agent)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
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
        Ok(format!("provider:{agent}:{}", Uuid::new_v4()))
    }

    fn upsert_saved_codex_provider_record(
        &self,
        saved_provider_id: &str,
        normalized: &CodexNormalizedDraft,
        applied_at_ms: u64,
    ) -> AiConfigResult<CodexSavedProviderSnapshot> {
        let extra_json = json!({
            "configToml": normalized.config_toml,
        })
        .to_string();
        let record = self
            .audit_repository
            .upsert_saved_provider(&SavedAiProviderInput {
                agent: "codex".to_string(),
                saved_provider_id: Some(saved_provider_id.to_string()),
                fingerprint: fingerprint_codex_config(normalized),
                mode: Self::codex_mode_to_string(&normalized.mode).to_string(),
                provider_id: normalized.provider_id.clone(),
                provider_name: normalized
                    .provider_name
                    .clone()
                    .unwrap_or_else(|| "Codex".to_string()),
                base_url: normalized.base_url.clone(),
                model: normalized.model.clone(),
                secret_ref: normalized.secret_ref.clone(),
                has_secret: normalized.has_secret,
                extra_json,
                created_at_ms: applied_at_ms as i64,
                updated_at_ms: applied_at_ms as i64,
                last_applied_at_ms: applied_at_ms as i64,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        saved_codex_provider_snapshot_from_record(record)
    }

    fn upsert_saved_gemini_provider_record(
        &self,
        saved_provider_id: &str,
        normalized: &GeminiNormalizedDraft,
        applied_at_ms: u64,
    ) -> AiConfigResult<GeminiSavedProviderSnapshot> {
        let extra_json = json!({
            "authMode": Self::gemini_auth_mode_to_string(&normalized.auth_mode),
            "selectedType": normalized.selected_type,
        })
        .to_string();
        let record = self
            .audit_repository
            .upsert_saved_provider(&SavedAiProviderInput {
                agent: "gemini".to_string(),
                saved_provider_id: Some(saved_provider_id.to_string()),
                fingerprint: fingerprint_gemini_config(normalized),
                mode: Self::gemini_mode_to_string(&normalized.mode).to_string(),
                provider_id: normalized.provider_id.clone(),
                provider_name: normalized
                    .provider_name
                    .clone()
                    .unwrap_or_else(|| "Gemini".to_string()),
                base_url: normalized.base_url.clone(),
                model: normalized.model.clone(),
                secret_ref: normalized.secret_ref.clone(),
                has_secret: normalized.has_secret,
                extra_json,
                created_at_ms: applied_at_ms as i64,
                updated_at_ms: applied_at_ms as i64,
                last_applied_at_ms: applied_at_ms as i64,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        saved_gemini_provider_snapshot_from_record(record)
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

    pub fn switch_saved_provider(
        &self,
        agent: AiConfigAgent,
        workspace_root: Option<&Path>,
        saved_provider_id: &str,
        confirmed_by: &str,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        let workspace_root = workspace_root.unwrap_or_else(|| Path::new(""));
        match agent {
            AiConfigAgent::Claude => self.switch_saved_claude_provider(
                GLOBAL_AI_CONFIG_CONTEXT,
                workspace_root,
                saved_provider_id,
                confirmed_by,
            ),
            AiConfigAgent::Codex => {
                self.audit_repository
                    .ensure_schema()
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let saved_provider = self
                    .audit_repository
                    .get_saved_provider("codex", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?;
                let normalized = normalized_from_saved_codex_provider(&saved_provider)?;
                let auth_backup = self.snapshot_file_state(&Self::codex_auth_path()?)?;
                let config_backup = self.snapshot_file_state(&Self::codex_config_path()?)?;
                if let Err(error) = self.sync_codex_live_settings(&normalized) {
                    let _ =
                        self.restore_file_state(&Self::codex_auth_path()?, auth_backup.as_deref());
                    let _ = self
                        .restore_file_state(&Self::codex_config_path()?, config_backup.as_deref());
                    return Err(error);
                }
                self.settings
                    .update(
                        SettingsScope::User,
                        None,
                        &Self::build_codex_workspace_patch(&normalized, Some(saved_provider_id)),
                    )
                    .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                self.audit_repository
                    .set_active_saved_provider("codex", saved_provider_id, now_ms() as i64)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let effective =
                    self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
                Ok(AiConfigApplyResponse {
                    workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                    preview_id: format!("saved-provider:{saved_provider_id}"),
                    confirmed_by: confirmed_by.to_string(),
                    applied: true,
                    audit_id: format!("audit:{}", Uuid::new_v4()),
                    effective,
                    changed_targets: vec![
                        "user_settings".to_string(),
                        "codex_auth_json".to_string(),
                        "codex_config_toml".to_string(),
                        "saved_provider_db".to_string(),
                    ],
                })
            }
            AiConfigAgent::Gemini => {
                self.audit_repository
                    .ensure_schema()
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let saved_provider = self
                    .audit_repository
                    .get_saved_provider("gemini", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?;
                let normalized = normalized_from_saved_gemini_provider(&saved_provider)?;
                let env_backup = self.snapshot_file_state(&Self::gemini_env_path()?)?;
                let settings_backup = self.snapshot_file_state(&Self::gemini_settings_path()?)?;
                if let Err(error) = self.sync_gemini_live_settings(&normalized) {
                    let _ =
                        self.restore_file_state(&Self::gemini_env_path()?, env_backup.as_deref());
                    let _ = self.restore_file_state(
                        &Self::gemini_settings_path()?,
                        settings_backup.as_deref(),
                    );
                    return Err(error);
                }
                self.settings
                    .update(
                        SettingsScope::User,
                        None,
                        &Self::build_gemini_workspace_patch(&normalized, Some(saved_provider_id)),
                    )
                    .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                self.audit_repository
                    .set_active_saved_provider("gemini", saved_provider_id, now_ms() as i64)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let effective =
                    self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
                Ok(AiConfigApplyResponse {
                    workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                    preview_id: format!("saved-provider:{saved_provider_id}"),
                    confirmed_by: confirmed_by.to_string(),
                    applied: true,
                    audit_id: format!("audit:{}", Uuid::new_v4()),
                    effective,
                    changed_targets: vec![
                        "user_settings".to_string(),
                        "gemini_env_file".to_string(),
                        "gemini_settings_json".to_string(),
                        "saved_provider_db".to_string(),
                    ],
                })
            }
        }
    }

    pub fn delete_saved_provider(
        &self,
        agent: AiConfigAgent,
        workspace_root: Option<&Path>,
        saved_provider_id: &str,
        confirmed_by: &str,
    ) -> AiConfigResult<AiConfigApplyResponse> {
        let workspace_root = workspace_root.unwrap_or_else(|| Path::new(""));
        match agent {
            AiConfigAgent::Claude => {
                let deleted = self
                    .audit_repository
                    .delete_saved_claude_provider(GLOBAL_AI_CONFIG_CONTEXT, saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                if !deleted {
                    return Err(AiConfigError::SavedProviderNotFound(
                        saved_provider_id.to_string(),
                    ));
                }
                let remaining = self.list_saved_claude_providers(GLOBAL_AI_CONFIG_CONTEXT)?;
                if let Some(next) = remaining.first() {
                    let normalized = normalized_from_saved_claude_provider(
                        &self
                            .audit_repository
                            .get_saved_claude_provider(
                                GLOBAL_AI_CONFIG_CONTEXT,
                                &next.saved_provider_id,
                            )
                            .map_err(|error| AiConfigError::Storage(error.to_string()))?
                            .ok_or_else(|| {
                                AiConfigError::SavedProviderNotFound(next.saved_provider_id.clone())
                            })?,
                    )?;
                    self.sync_claude_live_settings_at_path(
                        &self.claude_live_settings_path()?,
                        &normalized,
                    )?;
                    self.settings
                        .update(
                            SettingsScope::User,
                            None,
                            &build_workspace_patch(
                                &normalized,
                                Some(next.saved_provider_id.as_str()),
                            ),
                        )
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                    self.audit_repository
                        .set_active_saved_claude_provider(
                            GLOBAL_AI_CONFIG_CONTEXT,
                            &next.saved_provider_id,
                            now_ms() as i64,
                        )
                        .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                } else {
                    self.settings
                        .update(SettingsScope::User, None, &build_empty_claude_patch())
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                }
                let effective =
                    self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
                Ok(AiConfigApplyResponse {
                    workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                    preview_id: format!("delete-provider:{saved_provider_id}"),
                    confirmed_by: confirmed_by.to_string(),
                    applied: true,
                    audit_id: format!("audit:{}", Uuid::new_v4()),
                    effective,
                    changed_targets: vec![
                        "user_settings".to_string(),
                        "saved_provider_db".to_string(),
                    ],
                })
            }
            AiConfigAgent::Codex => {
                self.audit_repository
                    .delete_saved_provider("codex", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let remaining = self
                    .audit_repository
                    .list_saved_providers("codex")
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                if let Some(next) = remaining.first() {
                    let normalized = normalized_from_saved_codex_provider(next)?;
                    self.sync_codex_live_settings(&normalized)?;
                    self.settings
                        .update(
                            SettingsScope::User,
                            None,
                            &Self::build_codex_workspace_patch(
                                &normalized,
                                Some(next.saved_provider_id.as_str()),
                            ),
                        )
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                    self.audit_repository
                        .set_active_saved_provider(
                            "codex",
                            &next.saved_provider_id,
                            now_ms() as i64,
                        )
                        .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                } else {
                    self.sync_codex_live_settings(&official_codex_normalized_draft())?;
                    self.settings
                        .update(SettingsScope::User, None, &Self::build_empty_codex_patch())
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                }
                let effective =
                    self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
                Ok(AiConfigApplyResponse {
                    workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                    preview_id: format!("delete-provider:{saved_provider_id}"),
                    confirmed_by: confirmed_by.to_string(),
                    applied: true,
                    audit_id: format!("audit:{}", Uuid::new_v4()),
                    effective,
                    changed_targets: vec![
                        "user_settings".to_string(),
                        "codex_auth_json".to_string(),
                        "codex_config_toml".to_string(),
                        "saved_provider_db".to_string(),
                    ],
                })
            }
            AiConfigAgent::Gemini => {
                self.audit_repository
                    .delete_saved_provider("gemini", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                let remaining = self
                    .audit_repository
                    .list_saved_providers("gemini")
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                if let Some(next) = remaining.first() {
                    let normalized = normalized_from_saved_gemini_provider(next)?;
                    self.sync_gemini_live_settings(&normalized)?;
                    self.settings
                        .update(
                            SettingsScope::User,
                            None,
                            &Self::build_gemini_workspace_patch(
                                &normalized,
                                Some(next.saved_provider_id.as_str()),
                            ),
                        )
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                    self.audit_repository
                        .set_active_saved_provider(
                            "gemini",
                            &next.saved_provider_id,
                            now_ms() as i64,
                        )
                        .map_err(|error| AiConfigError::Storage(error.to_string()))?;
                } else {
                    self.sync_gemini_live_settings(&official_gemini_normalized_draft())?;
                    self.settings
                        .update(SettingsScope::User, None, &Self::build_empty_gemini_patch())
                        .map_err(|error| AiConfigError::Settings(error.to_string()))?;
                }
                let effective =
                    self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;
                Ok(AiConfigApplyResponse {
                    workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                    preview_id: format!("delete-provider:{saved_provider_id}"),
                    confirmed_by: confirmed_by.to_string(),
                    applied: true,
                    audit_id: format!("audit:{}", Uuid::new_v4()),
                    effective,
                    changed_targets: vec![
                        "user_settings".to_string(),
                        "gemini_env_file".to_string(),
                        "gemini_settings_json".to_string(),
                        "saved_provider_db".to_string(),
                    ],
                })
            }
        }
    }

    pub fn read_claude_config(
        &self,
        _workspace_root: &Path,
    ) -> AiConfigResult<ClaudeConfigSnapshot> {
        let effective = self
            .settings
            .load_effective(None)
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;
        read_claude_config_from_value(&effective.values)
    }

    pub fn read_codex_config(&self, _workspace_root: &Path) -> AiConfigResult<CodexConfigSnapshot> {
        let effective = self
            .settings
            .load_effective(None)
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;
        Self::read_codex_config_from_value(&effective.values)
    }

    pub fn read_gemini_config(
        &self,
        _workspace_root: &Path,
    ) -> AiConfigResult<GeminiConfigSnapshot> {
        let effective = self
            .settings
            .load_effective(None)
            .map_err(|error| AiConfigError::Settings(error.to_string()))?;
        Self::read_gemini_config_from_value(&effective.values)
    }

    pub fn preview_codex_patch(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        draft: CodexDraftInput,
    ) -> AiConfigResult<(AiConfigPreviewResponse, StoredAiConfigPreview)> {
        let current = self.read_codex_config(workspace_root)?;
        let saved_provider_id = draft.saved_provider_id.clone();
        let saved_provider = if let Some(saved_provider_id) = saved_provider_id.as_deref() {
            Some(
                self.audit_repository
                    .get_saved_provider("codex", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?,
            )
        } else {
            None
        };
        let (normalized, api_key_secret) =
            Self::normalize_codex_draft(workspace_id, &current, saved_provider.as_ref(), draft)?;
        let changes = Self::diff_codex_config(&current, &normalized);
        if changes.is_empty() {
            return Err(AiConfigError::Invalid(
                "no effective changes to apply".to_string(),
            ));
        }

        let preview_id = format!("preview:{}", Uuid::new_v4());
        let warnings = Self::build_codex_warnings(&normalized);
        let secret_refs = normalized
            .secret_ref
            .clone()
            .into_iter()
            .collect::<Vec<_>>();
        let response = AiConfigPreviewResponse {
            workspace_id: workspace_id.to_string(),
            scope: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            agent: AiConfigAgent::Codex,
            preview_id: preview_id.clone(),
            allowed: true,
            normalized_draft: AiConfigNormalizedDraft::Codex(normalized.clone()),
            masked_diff: changes.clone(),
            changed_keys: changes.iter().map(|entry| entry.key.clone()).collect(),
            secret_refs: secret_refs.clone(),
            warnings: warnings.clone(),
        };

        Ok((
            response,
            StoredAiConfigPreview::Codex(StoredCodexPreview {
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

    pub fn preview_gemini_patch(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        draft: GeminiDraftInput,
    ) -> AiConfigResult<(AiConfigPreviewResponse, StoredAiConfigPreview)> {
        let current = self.read_gemini_config(workspace_root)?;
        let saved_provider_id = draft.saved_provider_id.clone();
        let saved_provider = if let Some(saved_provider_id) = saved_provider_id.as_deref() {
            Some(
                self.audit_repository
                    .get_saved_provider("gemini", saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?,
            )
        } else {
            None
        };
        let (normalized, api_key_secret) =
            Self::normalize_gemini_draft(workspace_id, &current, saved_provider.as_ref(), draft)?;
        let changes = Self::diff_gemini_config(&current, &normalized);
        if changes.is_empty() {
            return Err(AiConfigError::Invalid(
                "no effective changes to apply".to_string(),
            ));
        }

        let preview_id = format!("preview:{}", Uuid::new_v4());
        let warnings = Self::build_gemini_warnings(&normalized);
        let secret_refs = normalized
            .secret_ref
            .clone()
            .into_iter()
            .collect::<Vec<_>>();
        let response = AiConfigPreviewResponse {
            workspace_id: workspace_id.to_string(),
            scope: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            agent: AiConfigAgent::Gemini,
            preview_id: preview_id.clone(),
            allowed: true,
            normalized_draft: AiConfigNormalizedDraft::Gemini(normalized.clone()),
            masked_diff: changes.clone(),
            changed_keys: changes.iter().map(|entry| entry.key.clone()).collect(),
            secret_refs: secret_refs.clone(),
            warnings: warnings.clone(),
        };

        Ok((
            response,
            StoredAiConfigPreview::Gemini(StoredGeminiPreview {
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

    pub fn apply_codex_preview(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        confirmed_by: &str,
        preview: &StoredCodexPreview,
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

        let auth_path = Self::codex_auth_path()?;
        let config_path = Self::codex_config_path()?;
        let auth_backup = self.snapshot_file_state(&auth_path)?;
        let config_backup = self.snapshot_file_state(&config_path)?;
        if let Err(error) = self.sync_codex_live_settings(&preview.normalized_draft) {
            let _ = self.restore_file_state(&auth_path, auth_backup.as_deref());
            let _ = self.restore_file_state(&config_path, config_backup.as_deref());
            return Err(error);
        }

        let saved_provider_id = self.resolve_saved_provider_id(
            "codex",
            fingerprint_codex_config(&preview.normalized_draft),
            preview.saved_provider_id.as_deref(),
        )?;
        let patch = Self::build_codex_workspace_patch(
            &preview.normalized_draft,
            Some(saved_provider_id.as_str()),
        );
        if let Err(error) = self.settings.update(SettingsScope::User, None, &patch) {
            let _ = self.restore_file_state(&auth_path, auth_backup.as_deref());
            let _ = self.restore_file_state(&config_path, config_backup.as_deref());
            return Err(AiConfigError::Settings(error.to_string()));
        }

        let audit_id = format!("audit:{}", Uuid::new_v4());
        let created_at_ms = now_ms() as i64;
        let changed_keys_json = serde_json::to_string(&preview.changed_keys)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(&preview.secret_refs)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                agent: "codex".to_string(),
                mode: Self::codex_mode_to_string(&preview.normalized_draft.mode).to_string(),
                provider_id: preview.normalized_draft.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.upsert_saved_codex_provider_record(
            &saved_provider_id,
            &preview.normalized_draft,
            created_at_ms as u64,
        )?;

        let effective = self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;

        Ok(AiConfigApplyResponse {
            workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            preview_id: preview.preview_id.clone(),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "user_settings".to_string(),
                "codex_auth_json".to_string(),
                "codex_config_toml".to_string(),
                "saved_provider_db".to_string(),
                "secret_store".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    pub fn apply_gemini_preview(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        confirmed_by: &str,
        preview: &StoredGeminiPreview,
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

        let env_path = Self::gemini_env_path()?;
        let settings_path = Self::gemini_settings_path()?;
        let env_backup = self.snapshot_file_state(&env_path)?;
        let settings_backup = self.snapshot_file_state(&settings_path)?;
        if let Err(error) = self.sync_gemini_live_settings(&preview.normalized_draft) {
            let _ = self.restore_file_state(&env_path, env_backup.as_deref());
            let _ = self.restore_file_state(&settings_path, settings_backup.as_deref());
            return Err(error);
        }

        let saved_provider_id = self.resolve_saved_provider_id(
            "gemini",
            fingerprint_gemini_config(&preview.normalized_draft),
            preview.saved_provider_id.as_deref(),
        )?;
        let patch = Self::build_gemini_workspace_patch(
            &preview.normalized_draft,
            Some(saved_provider_id.as_str()),
        );
        if let Err(error) = self.settings.update(SettingsScope::User, None, &patch) {
            let _ = self.restore_file_state(&env_path, env_backup.as_deref());
            let _ = self.restore_file_state(&settings_path, settings_backup.as_deref());
            return Err(AiConfigError::Settings(error.to_string()));
        }

        let audit_id = format!("audit:{}", Uuid::new_v4());
        let created_at_ms = now_ms() as i64;
        let changed_keys_json = serde_json::to_string(&preview.changed_keys)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;
        let secret_refs_json = serde_json::to_string(&preview.secret_refs)
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                agent: "gemini".to_string(),
                mode: Self::gemini_mode_to_string(&preview.normalized_draft.mode).to_string(),
                provider_id: preview.normalized_draft.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        self.upsert_saved_gemini_provider_record(
            &saved_provider_id,
            &preview.normalized_draft,
            created_at_ms as u64,
        )?;

        let effective = self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;

        Ok(AiConfigApplyResponse {
            workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            preview_id: preview.preview_id.clone(),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "user_settings".to_string(),
                "gemini_env_file".to_string(),
                "gemini_settings_json".to_string(),
                "saved_provider_db".to_string(),
                "secret_store".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    fn sync_codex_live_settings(&self, normalized: &CodexNormalizedDraft) -> AiConfigResult<()> {
        let auth_path = Self::codex_auth_path()?;
        let config_path = Self::codex_config_path()?;
        self.sync_codex_auth_file(&auth_path, normalized)?;
        self.sync_codex_config_file(&config_path, normalized)
    }

    fn sync_gemini_live_settings(&self, normalized: &GeminiNormalizedDraft) -> AiConfigResult<()> {
        let env_path = Self::gemini_env_path()?;
        let settings_path = Self::gemini_settings_path()?;
        self.sync_gemini_env_file(&env_path, normalized)?;

        let mut root = read_json_object_file(&settings_path)?;
        let root_object = root.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Gemini settings root must be an object at {}",
                settings_path.display()
            ))
        })?;
        let security = root_object
            .entry("security".to_string())
            .or_insert_with(|| json!({}));
        let security_object = security.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Gemini settings security must be an object at {}",
                settings_path.display()
            ))
        })?;
        let auth = security_object
            .entry("auth".to_string())
            .or_insert_with(|| json!({}));
        let auth_object = auth.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Gemini settings auth must be an object at {}",
                settings_path.display()
            ))
        })?;
        auth_object.insert(
            "selectedType".to_string(),
            Value::String(normalized.selected_type.clone()),
        );
        write_json_atomic(&settings_path, &root)
    }

    fn sync_codex_auth_file(
        &self,
        path: &Path,
        normalized: &CodexNormalizedDraft,
    ) -> AiConfigResult<()> {
        let mut auth = read_json_object_file(path)?;
        let auth_object = auth.as_object_mut().ok_or_else(|| {
            AiConfigError::LiveSync(format!(
                "Codex auth root must be an object at {}",
                path.display()
            ))
        })?;

        if normalized.has_secret {
            let secret_ref = normalized.secret_ref.as_deref().ok_or_else(|| {
                AiConfigError::Invalid("configured Codex secret reference is missing".to_string())
            })?;
            let secret = self
                .secret_store
                .load(secret_ref)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
            auth_object.insert("OPENAI_API_KEY".to_string(), Value::String(secret));
        } else {
            auth_object.remove("OPENAI_API_KEY");
        }

        if auth_object.is_empty() {
            return remove_file_if_exists(path);
        }

        write_json_atomic(path, &auth)
    }

    fn sync_codex_config_file(
        &self,
        path: &Path,
        normalized: &CodexNormalizedDraft,
    ) -> AiConfigResult<()> {
        if normalized.mode == CodexProviderMode::Official {
            let existing_text = std::fs::read_to_string(path).unwrap_or_default();
            let next_text = Self::strip_codex_managed_provider_fields(&existing_text)?;
            if next_text.trim().is_empty() {
                return remove_file_if_exists(path);
            }
            return write_bytes_atomic(path, next_text.as_bytes());
        }

        let config_text = normalized.config_toml.clone().unwrap_or_default();
        if config_text.trim().is_empty() {
            return remove_file_if_exists(path);
        }
        write_bytes_atomic(path, config_text.as_bytes())
    }

    fn strip_codex_managed_provider_fields(text: &str) -> AiConfigResult<String> {
        if text.trim().is_empty() {
            return Ok(String::new());
        }

        let mut table = toml::from_str::<toml::Table>(text).map_err(|error| {
            AiConfigError::Invalid(format!("invalid Codex config TOML: {error}"))
        })?;
        let provider_key = table
            .get("model_provider")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        table.remove("model_provider");
        table.remove("base_url");

        if let Some(provider_key) = provider_key {
            let remove_model_providers = if let Some(model_providers) = table
                .get_mut("model_providers")
                .and_then(|value| value.as_table_mut())
            {
                model_providers.remove(&provider_key);
                model_providers.is_empty()
            } else {
                false
            };
            if remove_model_providers {
                table.remove("model_providers");
            }
        }

        if table.is_empty() {
            return Ok(String::new());
        }

        toml::to_string_pretty(&table).map_err(|error| {
            AiConfigError::Invalid(format!("failed to serialize Codex TOML: {error}"))
        })
    }

    fn sync_gemini_env_file(
        &self,
        path: &Path,
        normalized: &GeminiNormalizedDraft,
    ) -> AiConfigResult<()> {
        let mut env = parse_simple_env_file(path);

        if let Some(base_url) = normalized
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            env.insert("GOOGLE_GEMINI_BASE_URL".to_string(), base_url.to_string());
        } else {
            env.remove("GOOGLE_GEMINI_BASE_URL");
        }

        if let Some(model) = normalized
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            env.insert("GEMINI_MODEL".to_string(), model.to_string());
        } else {
            env.remove("GEMINI_MODEL");
        }

        if normalized.auth_mode == GeminiAuthMode::ApiKey {
            let secret_ref = normalized.secret_ref.as_deref().ok_or_else(|| {
                AiConfigError::Invalid("configured Gemini secret reference is missing".to_string())
            })?;
            let secret = self
                .secret_store
                .load(secret_ref)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
            env.insert("GEMINI_API_KEY".to_string(), secret);
        } else {
            env.remove("GEMINI_API_KEY");
        }

        if env.is_empty() {
            return remove_file_if_exists(path);
        }

        let env_text = serialize_simple_env_file(&env);
        write_bytes_atomic(path, env_text.as_bytes())
    }

    fn codex_runtime_env(&self, workspace_root: &Path) -> AiConfigResult<BTreeMap<String, String>> {
        let config = self.read_codex_config(workspace_root)?;
        let mode = match config.active_mode {
            Some(mode) => mode,
            None => return Ok(BTreeMap::new()),
        };
        if mode == CodexProviderMode::Official {
            return Ok(BTreeMap::new());
        }
        let mut env = BTreeMap::new();
        if let Some(secret_ref) = config.secret_ref.filter(|value| !value.trim().is_empty()) {
            let secret = self
                .secret_store
                .load(&secret_ref)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
            env.insert("OPENAI_API_KEY".to_string(), secret);
        }
        Ok(env)
    }

    fn gemini_runtime_env(
        &self,
        workspace_root: &Path,
    ) -> AiConfigResult<BTreeMap<String, String>> {
        let config = self.read_gemini_config(workspace_root)?;
        let mode = match config.active_mode {
            Some(mode) => mode,
            None => return Ok(BTreeMap::new()),
        };
        let auth_mode = config.auth_mode.unwrap_or(GeminiAuthMode::OAuth);
        let mut env = BTreeMap::new();
        if mode != GeminiProviderMode::Official {
            if let Some(base_url) = config.base_url.filter(|value| !value.trim().is_empty()) {
                env.insert("GOOGLE_GEMINI_BASE_URL".to_string(), base_url);
            }
        }
        if let Some(model) = config.model.filter(|value| !value.trim().is_empty()) {
            env.insert("GEMINI_MODEL".to_string(), model);
        }
        if auth_mode == GeminiAuthMode::ApiKey {
            if let Some(secret_ref) = config.secret_ref.filter(|value| !value.trim().is_empty()) {
                let secret = self
                    .secret_store
                    .load(&secret_ref)
                    .map_err(|error| AiConfigError::Secret(error.to_string()))?;
                env.insert("GEMINI_API_KEY".to_string(), secret);
            }
        }
        Ok(env)
    }

    fn codex_summary(config: &CodexConfigSnapshot) -> Option<String> {
        let provider = config.provider_name.as_deref().unwrap_or("Codex");
        let model = config.model.as_deref().unwrap_or("default");
        config
            .active_mode
            .as_ref()
            .map(|mode| format!("{mode:?}: {provider} / {model}"))
    }

    fn gemini_summary(config: &GeminiConfigSnapshot) -> Option<String> {
        let provider = config.provider_name.as_deref().unwrap_or("Gemini");
        let model = config.model.as_deref().unwrap_or("default");
        config
            .active_mode
            .as_ref()
            .map(|mode| format!("{mode:?}: {provider} / {model}"))
    }

    fn provider_secret_ref(_workspace_id: &str, agent: &str, provider_id: &str) -> String {
        format!(
            "ai-config/{}/{}/{}/api_key",
            sanitize_secret_segment(agent),
            sanitize_secret_segment(provider_id),
            Uuid::new_v4()
        )
    }

    fn codex_auth_path() -> AiConfigResult<PathBuf> {
        let home = user_home_dir().ok_or_else(|| {
            AiConfigError::LiveSync("unable to resolve user home directory".to_string())
        })?;
        Ok(home.join(".codex").join("auth.json"))
    }

    fn codex_config_path() -> AiConfigResult<PathBuf> {
        let home = user_home_dir().ok_or_else(|| {
            AiConfigError::LiveSync("unable to resolve user home directory".to_string())
        })?;
        Ok(home.join(".codex").join("config.toml"))
    }

    fn gemini_env_path() -> AiConfigResult<PathBuf> {
        let home = user_home_dir().ok_or_else(|| {
            AiConfigError::LiveSync("unable to resolve user home directory".to_string())
        })?;
        Ok(home.join(".gemini").join(".env"))
    }

    fn gemini_settings_path() -> AiConfigResult<PathBuf> {
        let home = user_home_dir().ok_or_else(|| {
            AiConfigError::LiveSync("unable to resolve user home directory".to_string())
        })?;
        Ok(home.join(".gemini").join("settings.json"))
    }

    fn build_gemini_env_text(
        secret_store: &SecretStore,
        normalized: &GeminiNormalizedDraft,
    ) -> AiConfigResult<String> {
        let mut env = BTreeMap::new();
        if let Some(base_url) = normalized
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            env.insert("GOOGLE_GEMINI_BASE_URL".to_string(), base_url.to_string());
        }
        if let Some(model) = normalized
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            env.insert("GEMINI_MODEL".to_string(), model.to_string());
        }
        if normalized.auth_mode == GeminiAuthMode::ApiKey {
            let secret_ref = normalized.secret_ref.as_deref().ok_or_else(|| {
                AiConfigError::Invalid("configured Gemini secret reference is missing".to_string())
            })?;
            let secret = secret_store
                .load(secret_ref)
                .map_err(|error| AiConfigError::Secret(error.to_string()))?;
            env.insert("GEMINI_API_KEY".to_string(), secret);
        }
        Ok(env
            .into_iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("\n"))
    }

    fn validate_codex_config_toml(text: &str) -> AiConfigResult<()> {
        if text.trim().is_empty() {
            return Ok(());
        }
        toml::from_str::<toml::Table>(text)
            .map(|_| ())
            .map_err(|error| AiConfigError::Invalid(format!("invalid Codex config TOML: {error}")))
    }

    fn prepare_codex_config_toml(
        provider_name: &str,
        base_url: Option<&str>,
        model: Option<&str>,
        config_toml: Option<String>,
    ) -> AiConfigResult<Option<String>> {
        let Some(base_url) = base_url else {
            return Ok(config_toml.and_then(none_if_empty));
        };
        let model = model.unwrap_or("gpt-5.4");
        let template = config_toml
            .and_then(none_if_empty)
            .unwrap_or_else(|| Self::default_codex_config_toml(provider_name, base_url, model));
        let prepared = Self::sync_codex_toml_fields(&template, base_url, model)?;
        Self::validate_codex_config_toml(&prepared)?;
        Ok(Some(prepared))
    }

    fn default_codex_config_toml(provider_name: &str, base_url: &str, model: &str) -> String {
        let provider_key = sanitize_secret_segment(provider_name)
            .trim_matches('_')
            .to_ascii_lowercase();
        let provider_key = if provider_key.is_empty() {
            "custom"
        } else {
            provider_key.as_str()
        };
        format!(
            "model_provider = \"{provider_key}\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{provider_key}]\nname = \"{provider_name}\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
        )
    }

    fn sync_codex_toml_fields(
        template: &str,
        base_url: &str,
        model: &str,
    ) -> AiConfigResult<String> {
        let mut table = if template.trim().is_empty() {
            toml::Table::new()
        } else {
            toml::from_str::<toml::Table>(template).map_err(|error| {
                AiConfigError::Invalid(format!("invalid Codex config TOML: {error}"))
            })?
        };
        table.insert("model".to_string(), toml::Value::String(model.to_string()));
        let provider_key = table
            .get("model_provider")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        if let Some(provider_key) = provider_key {
            let model_providers = table
                .entry("model_providers")
                .or_insert_with(|| toml::Value::Table(toml::Table::new()));
            let model_providers = model_providers.as_table_mut().ok_or_else(|| {
                AiConfigError::Invalid("Codex model_providers must be a table".to_string())
            })?;
            let provider_table = model_providers
                .entry(provider_key)
                .or_insert_with(|| toml::Value::Table(toml::Table::new()));
            let provider_table = provider_table.as_table_mut().ok_or_else(|| {
                AiConfigError::Invalid("Codex provider entry must be a table".to_string())
            })?;
            provider_table.insert(
                "base_url".to_string(),
                toml::Value::String(base_url.to_string()),
            );
        } else {
            table.insert(
                "base_url".to_string(),
                toml::Value::String(base_url.to_string()),
            );
        }
        toml::to_string_pretty(&table).map_err(|error| {
            AiConfigError::Invalid(format!("failed to serialize Codex TOML: {error}"))
        })
    }

    fn normalize_optional_endpoint(value: Option<String>) -> AiConfigResult<Option<String>> {
        match value.and_then(none_if_empty) {
            Some(value) => Ok(Some(normalize_endpoint(value)?)),
            None => Ok(None),
        }
    }

    fn normalize_codex_draft(
        workspace_id: &str,
        current: &CodexConfigSnapshot,
        saved_provider: Option<&SavedAiProviderRecord>,
        draft: CodexDraftInput,
    ) -> AiConfigResult<(CodexNormalizedDraft, Option<String>)> {
        match draft.mode {
            CodexProviderMode::Official => {
                let preset = codex_provider_presets()
                    .into_iter()
                    .find(|item| item.provider_id == "codex-official")
                    .ok_or_else(|| {
                        AiConfigError::Invalid("missing Codex official preset".to_string())
                    })?;
                Ok((
                    CodexNormalizedDraft {
                        mode: CodexProviderMode::Official,
                        provider_id: Some(preset.provider_id),
                        provider_name: Some(preset.name),
                        base_url: None,
                        model: Some(preset.recommended_model),
                        config_toml: None,
                        secret_ref: None,
                        has_secret: false,
                    },
                    None,
                ))
            }
            CodexProviderMode::Preset => {
                let provider_id = required_field(draft.provider_id, "providerId")?;
                let preset = codex_provider_presets()
                    .into_iter()
                    .find(|item| item.provider_id == provider_id)
                    .ok_or_else(|| AiConfigError::Invalid("unknown Codex preset".to_string()))?;
                let provider_name =
                    normalize_non_empty(draft.provider_name).unwrap_or_else(|| preset.name.clone());
                let base_url = Self::normalize_optional_endpoint(
                    draft.base_url.or_else(|| preset.endpoint.clone()),
                )?;
                let model = normalize_non_empty(draft.model)
                    .or_else(|| Some(preset.recommended_model.clone()));
                let config_toml = Self::prepare_codex_config_toml(
                    &provider_name,
                    base_url.as_deref(),
                    model.as_deref(),
                    draft
                        .config_toml
                        .or_else(|| Some(preset.config_template.clone())),
                )?;
                let secret_input = normalize_non_empty(draft.api_key);
                let can_reuse_secret = current.provider_id.as_deref()
                    == Some(preset.provider_id.as_str())
                    && current.has_secret
                    && current.secret_ref.is_some();
                let saved_provider_secret_ref = saved_provider.and_then(|item| {
                    if item.has_secret {
                        item.secret_ref.clone()
                    } else {
                        None
                    }
                });
                let secret_ref = if preset.requires_api_key {
                    if secret_input.is_some() {
                        Some(Self::provider_secret_ref(
                            workspace_id,
                            "codex",
                            &preset.provider_id,
                        ))
                    } else if can_reuse_secret {
                        current.secret_ref.clone()
                    } else if saved_provider_secret_ref.is_some() {
                        saved_provider_secret_ref
                    } else {
                        None
                    }
                } else {
                    None
                };
                if preset.requires_api_key && secret_ref.is_none() {
                    return Err(AiConfigError::Invalid(
                        "API key is required for the selected Codex provider".to_string(),
                    ));
                }
                Ok((
                    CodexNormalizedDraft {
                        mode: CodexProviderMode::Preset,
                        provider_id: Some(preset.provider_id),
                        provider_name: Some(provider_name),
                        base_url,
                        model,
                        config_toml,
                        secret_ref,
                        has_secret: preset.requires_api_key,
                    },
                    secret_input,
                ))
            }
            CodexProviderMode::Custom => {
                let provider_name = required_field(draft.provider_name, "providerName")?;
                let base_url = Some(normalize_endpoint(required_field(
                    draft.base_url,
                    "baseUrl",
                )?)?);
                let model = Some(required_field(draft.model, "model")?);
                let config_toml = Self::prepare_codex_config_toml(
                    &provider_name,
                    base_url.as_deref(),
                    model.as_deref(),
                    draft.config_toml,
                )?;
                let secret_input = normalize_non_empty(draft.api_key);
                let can_reuse_secret = current.provider_id.as_deref() == Some("custom-gateway")
                    && current.has_secret
                    && current.secret_ref.is_some();
                let saved_provider_secret_ref = saved_provider.and_then(|item| {
                    if item.has_secret {
                        item.secret_ref.clone()
                    } else {
                        None
                    }
                });
                let secret_ref = if secret_input.is_some() {
                    Some(Self::provider_secret_ref(
                        workspace_id,
                        "codex",
                        "custom-gateway",
                    ))
                } else if can_reuse_secret {
                    current.secret_ref.clone()
                } else if saved_provider_secret_ref.is_some() {
                    saved_provider_secret_ref
                } else {
                    None
                };
                if secret_ref.is_none() {
                    return Err(AiConfigError::Invalid(
                        "API key is required for the custom Codex provider".to_string(),
                    ));
                }
                Ok((
                    CodexNormalizedDraft {
                        mode: CodexProviderMode::Custom,
                        provider_id: Some("custom-gateway".to_string()),
                        provider_name: Some(provider_name),
                        base_url,
                        model,
                        config_toml,
                        secret_ref,
                        has_secret: true,
                    },
                    secret_input,
                ))
            }
        }
    }

    fn normalize_gemini_draft(
        workspace_id: &str,
        current: &GeminiConfigSnapshot,
        saved_provider: Option<&SavedAiProviderRecord>,
        draft: GeminiDraftInput,
    ) -> AiConfigResult<(GeminiNormalizedDraft, Option<String>)> {
        match draft.mode {
            GeminiProviderMode::Official => {
                let preset = gemini_provider_presets()
                    .into_iter()
                    .find(|item| item.provider_id == "google-official")
                    .ok_or_else(|| {
                        AiConfigError::Invalid("missing Gemini official preset".to_string())
                    })?;
                Ok((
                    GeminiNormalizedDraft {
                        mode: GeminiProviderMode::Official,
                        auth_mode: GeminiAuthMode::OAuth,
                        provider_id: Some(preset.provider_id),
                        provider_name: Some(preset.name),
                        base_url: None,
                        model: Some(preset.recommended_model),
                        selected_type: GeminiAuthMode::OAuth.selected_type().to_string(),
                        secret_ref: None,
                        has_secret: false,
                    },
                    None,
                ))
            }
            GeminiProviderMode::Preset => {
                let provider_id = required_field(draft.provider_id, "providerId")?;
                let preset = gemini_provider_presets()
                    .into_iter()
                    .find(|item| item.provider_id == provider_id)
                    .ok_or_else(|| AiConfigError::Invalid("unknown Gemini preset".to_string()))?;
                let auth_mode = draft.auth_mode.unwrap_or(preset.auth_mode.clone());
                let provider_name =
                    normalize_non_empty(draft.provider_name).unwrap_or_else(|| preset.name.clone());
                let base_url = Self::normalize_optional_endpoint(
                    draft.base_url.or_else(|| preset.endpoint.clone()),
                )?;
                let model = normalize_non_empty(draft.model)
                    .or_else(|| Some(preset.recommended_model.clone()));
                let selected_type = normalize_non_empty(draft.selected_type)
                    .unwrap_or_else(|| auth_mode.selected_type().to_string());
                let secret_input = normalize_non_empty(draft.api_key);
                let requires_secret =
                    auth_mode == GeminiAuthMode::ApiKey || preset.requires_api_key;
                let can_reuse_secret = current.provider_id.as_deref()
                    == Some(preset.provider_id.as_str())
                    && current.has_secret
                    && current.secret_ref.is_some();
                let saved_provider_secret_ref = saved_provider.and_then(|item| {
                    if item.has_secret {
                        item.secret_ref.clone()
                    } else {
                        None
                    }
                });
                let secret_ref = if requires_secret {
                    if secret_input.is_some() {
                        Some(Self::provider_secret_ref(
                            workspace_id,
                            "gemini",
                            &preset.provider_id,
                        ))
                    } else if can_reuse_secret {
                        current.secret_ref.clone()
                    } else if saved_provider_secret_ref.is_some() {
                        saved_provider_secret_ref
                    } else {
                        None
                    }
                } else {
                    None
                };
                if requires_secret && secret_ref.is_none() {
                    return Err(AiConfigError::Invalid(
                        "API key is required for the selected Gemini provider".to_string(),
                    ));
                }
                Ok((
                    GeminiNormalizedDraft {
                        mode: GeminiProviderMode::Preset,
                        auth_mode,
                        provider_id: Some(preset.provider_id),
                        provider_name: Some(provider_name),
                        base_url,
                        model,
                        selected_type,
                        secret_ref,
                        has_secret: requires_secret,
                    },
                    secret_input,
                ))
            }
            GeminiProviderMode::Custom => {
                let auth_mode = draft.auth_mode.unwrap_or(GeminiAuthMode::ApiKey);
                let provider_name = required_field(draft.provider_name, "providerName")?;
                let base_url = Some(normalize_endpoint(required_field(
                    draft.base_url,
                    "baseUrl",
                )?)?);
                let model = Some(required_field(draft.model, "model")?);
                let selected_type = normalize_non_empty(draft.selected_type)
                    .unwrap_or_else(|| auth_mode.selected_type().to_string());
                let secret_input = normalize_non_empty(draft.api_key);
                let requires_secret = auth_mode == GeminiAuthMode::ApiKey;
                let can_reuse_secret = current.provider_id.as_deref() == Some("custom-gateway")
                    && current.has_secret
                    && current.secret_ref.is_some();
                let saved_provider_secret_ref = saved_provider.and_then(|item| {
                    if item.has_secret {
                        item.secret_ref.clone()
                    } else {
                        None
                    }
                });
                let secret_ref = if requires_secret {
                    if secret_input.is_some() {
                        Some(Self::provider_secret_ref(
                            workspace_id,
                            "gemini",
                            "custom-gateway",
                        ))
                    } else if can_reuse_secret {
                        current.secret_ref.clone()
                    } else if saved_provider_secret_ref.is_some() {
                        saved_provider_secret_ref
                    } else {
                        None
                    }
                } else {
                    None
                };
                if requires_secret && secret_ref.is_none() {
                    return Err(AiConfigError::Invalid(
                        "API key is required for the custom Gemini provider".to_string(),
                    ));
                }
                Ok((
                    GeminiNormalizedDraft {
                        mode: GeminiProviderMode::Custom,
                        auth_mode,
                        provider_id: Some("custom-gateway".to_string()),
                        provider_name: Some(provider_name),
                        base_url,
                        model,
                        selected_type,
                        secret_ref,
                        has_secret: requires_secret,
                    },
                    secret_input,
                ))
            }
        }
    }

    fn diff_codex_config(
        current: &CodexConfigSnapshot,
        next: &CodexNormalizedDraft,
    ) -> Vec<AiConfigMaskedChange> {
        let mut changes = Vec::new();
        push_change(
            &mut changes,
            "ai.providers.codex.activeMode",
            "Mode",
            current.active_mode.as_ref().map(Self::codex_mode_to_string),
            Some(Self::codex_mode_to_string(&next.mode)),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.codex.providerName",
            "Provider",
            current.provider_name.as_deref(),
            next.provider_name.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.codex.baseUrl",
            "Endpoint",
            current.base_url.as_deref(),
            next.base_url.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.codex.model",
            "Model",
            current.model.as_deref(),
            next.model.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.codex.configToml",
            "Config TOML",
            current.config_toml.as_deref().map(|_| "Configured"),
            next.config_toml.as_deref().map(|_| "Configured"),
            false,
        );
        push_change_owned(
            &mut changes,
            "ai.providers.codex.apiKey",
            "API Key",
            Some(
                if current.has_secret {
                    "Saved"
                } else {
                    "Missing"
                }
                .to_string(),
            ),
            Some(if next.has_secret { "Ready" } else { "Not set" }.to_string()),
            true,
        );
        changes
    }

    fn diff_gemini_config(
        current: &GeminiConfigSnapshot,
        next: &GeminiNormalizedDraft,
    ) -> Vec<AiConfigMaskedChange> {
        let mut changes = Vec::new();
        push_change(
            &mut changes,
            "ai.providers.gemini.activeMode",
            "Mode",
            current
                .active_mode
                .as_ref()
                .map(Self::gemini_mode_to_string),
            Some(Self::gemini_mode_to_string(&next.mode)),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.gemini.authMode",
            "Auth",
            current
                .auth_mode
                .as_ref()
                .map(Self::gemini_auth_mode_to_string),
            Some(Self::gemini_auth_mode_to_string(&next.auth_mode)),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.gemini.providerName",
            "Provider",
            current.provider_name.as_deref(),
            next.provider_name.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.gemini.baseUrl",
            "Endpoint",
            current.base_url.as_deref(),
            next.base_url.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.gemini.model",
            "Model",
            current.model.as_deref(),
            next.model.as_deref(),
            false,
        );
        push_change(
            &mut changes,
            "ai.providers.gemini.selectedType",
            "Selected Type",
            current.selected_type.as_deref(),
            Some(next.selected_type.as_str()),
            false,
        );
        push_change_owned(
            &mut changes,
            "ai.providers.gemini.apiKey",
            "API Key",
            Some(
                if current.has_secret {
                    "Saved"
                } else {
                    "Missing"
                }
                .to_string(),
            ),
            Some(if next.has_secret { "Ready" } else { "Not set" }.to_string()),
            true,
        );
        changes
    }

    fn build_codex_warnings(normalized: &CodexNormalizedDraft) -> Vec<String> {
        let mut warnings = vec!["aiConfig.warning.systemCodexSync".to_string()];
        if normalized.mode == CodexProviderMode::Custom {
            warnings.push("aiConfig.warning.customGateway".to_string());
        }
        warnings
    }

    fn build_gemini_warnings(normalized: &GeminiNormalizedDraft) -> Vec<String> {
        let mut warnings = vec!["aiConfig.warning.systemGeminiSync".to_string()];
        if normalized.mode == GeminiProviderMode::Custom {
            warnings.push("aiConfig.warning.customGateway".to_string());
        }
        warnings
    }

    fn build_codex_workspace_patch(
        normalized: &CodexNormalizedDraft,
        saved_provider_id: Option<&str>,
    ) -> Value {
        json!({
            "ai": {
                "providers": {
                    "codex": {
                        "savedProviderId": saved_provider_id,
                        "activeMode": Self::codex_mode_to_string(&normalized.mode),
                        "providerId": normalized.provider_id,
                        "providerName": normalized.provider_name,
                        "baseUrl": normalized.base_url,
                        "model": normalized.model,
                        "configToml": normalized.config_toml,
                        "secretRef": normalized.secret_ref,
                        "hasSecret": normalized.has_secret,
                        "updatedAtMs": now_ms(),
                    }
                }
            }
        })
    }

    fn build_gemini_workspace_patch(
        normalized: &GeminiNormalizedDraft,
        saved_provider_id: Option<&str>,
    ) -> Value {
        json!({
            "ai": {
                "providers": {
                    "gemini": {
                        "savedProviderId": saved_provider_id,
                        "activeMode": Self::gemini_mode_to_string(&normalized.mode),
                        "authMode": Self::gemini_auth_mode_to_string(&normalized.auth_mode),
                        "providerId": normalized.provider_id,
                        "providerName": normalized.provider_name,
                        "baseUrl": normalized.base_url,
                        "model": normalized.model,
                        "selectedType": normalized.selected_type,
                        "secretRef": normalized.secret_ref,
                        "hasSecret": normalized.has_secret,
                        "updatedAtMs": now_ms(),
                    }
                }
            }
        })
    }

    fn build_empty_codex_patch() -> Value {
        json!({
            "ai": {
                "providers": {
                    "codex": {
                        "savedProviderId": Value::Null,
                        "activeMode": Value::Null,
                        "providerId": Value::Null,
                        "providerName": Value::Null,
                        "baseUrl": Value::Null,
                        "model": Value::Null,
                        "configToml": Value::Null,
                        "secretRef": Value::Null,
                        "hasSecret": false,
                        "updatedAtMs": now_ms(),
                    }
                }
            }
        })
    }

    fn build_empty_gemini_patch() -> Value {
        json!({
            "ai": {
                "providers": {
                    "gemini": {
                        "savedProviderId": Value::Null,
                        "activeMode": Value::Null,
                        "authMode": Value::Null,
                        "providerId": Value::Null,
                        "providerName": Value::Null,
                        "baseUrl": Value::Null,
                        "model": Value::Null,
                        "selectedType": Value::Null,
                        "secretRef": Value::Null,
                        "hasSecret": false,
                        "updatedAtMs": now_ms(),
                    }
                }
            }
        })
    }

    fn read_codex_config_from_value(value: &Value) -> AiConfigResult<CodexConfigSnapshot> {
        let config_value = value
            .pointer("/ai/providers/codex")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let object = config_value.as_object().cloned().unwrap_or_default();
        let saved_provider_id = object
            .get("savedProviderId")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        let secret_ref = object
            .get("secretRef")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        Ok(with_official_codex_config_defaults(CodexConfigSnapshot {
            saved_provider_id,
            active_mode: object
                .get("activeMode")
                .and_then(Value::as_str)
                .and_then(Self::parse_codex_mode),
            provider_id: object
                .get("providerId")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            provider_name: object
                .get("providerName")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            base_url: object
                .get("baseUrl")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            model: object
                .get("model")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            config_toml: object
                .get("configToml")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            secret_ref: secret_ref.clone(),
            has_secret: object
                .get("hasSecret")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| secret_ref.is_some()),
            updated_at_ms: object.get("updatedAtMs").and_then(Value::as_u64),
        }))
    }

    fn read_gemini_config_from_value(value: &Value) -> AiConfigResult<GeminiConfigSnapshot> {
        let config_value = value
            .pointer("/ai/providers/gemini")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let object = config_value.as_object().cloned().unwrap_or_default();
        let saved_provider_id = object
            .get("savedProviderId")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        let secret_ref = object
            .get("secretRef")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        Ok(with_official_gemini_config_defaults(GeminiConfigSnapshot {
            saved_provider_id,
            active_mode: object
                .get("activeMode")
                .and_then(Value::as_str)
                .and_then(Self::parse_gemini_mode),
            auth_mode: object
                .get("authMode")
                .and_then(Value::as_str)
                .and_then(Self::parse_gemini_auth_mode),
            provider_id: object
                .get("providerId")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            provider_name: object
                .get("providerName")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            base_url: object
                .get("baseUrl")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            model: object
                .get("model")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            selected_type: object
                .get("selectedType")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            secret_ref: secret_ref.clone(),
            has_secret: object
                .get("hasSecret")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| secret_ref.is_some()),
            updated_at_ms: object.get("updatedAtMs").and_then(Value::as_u64),
        }))
    }

    fn parse_codex_mode(value: &str) -> Option<CodexProviderMode> {
        match value.trim().to_ascii_lowercase().as_str() {
            "official" => Some(CodexProviderMode::Official),
            "preset" => Some(CodexProviderMode::Preset),
            "custom" => Some(CodexProviderMode::Custom),
            _ => None,
        }
    }

    fn codex_mode_to_string(mode: &CodexProviderMode) -> &'static str {
        match mode {
            CodexProviderMode::Official => "official",
            CodexProviderMode::Preset => "preset",
            CodexProviderMode::Custom => "custom",
        }
    }

    fn parse_gemini_mode(value: &str) -> Option<GeminiProviderMode> {
        match value.trim().to_ascii_lowercase().as_str() {
            "official" => Some(GeminiProviderMode::Official),
            "preset" => Some(GeminiProviderMode::Preset),
            "custom" => Some(GeminiProviderMode::Custom),
            _ => None,
        }
    }

    fn gemini_mode_to_string(mode: &GeminiProviderMode) -> &'static str {
        match mode {
            GeminiProviderMode::Official => "official",
            GeminiProviderMode::Preset => "preset",
            GeminiProviderMode::Custom => "custom",
        }
    }

    fn parse_gemini_auth_mode(value: &str) -> Option<GeminiAuthMode> {
        match value.trim().to_ascii_lowercase().as_str() {
            "oauth" => Some(GeminiAuthMode::OAuth),
            "api_key" => Some(GeminiAuthMode::ApiKey),
            _ => None,
        }
    }

    fn gemini_auth_mode_to_string(mode: &GeminiAuthMode) -> &'static str {
        match mode {
            GeminiAuthMode::OAuth => "oauth",
            GeminiAuthMode::ApiKey => "api_key",
        }
    }

    fn claude_auth_scheme_to_string(auth: &ClaudeAuthScheme) -> &'static str {
        match auth {
            ClaudeAuthScheme::AnthropicApiKey => "anthropic_api_key",
            ClaudeAuthScheme::AnthropicAuthToken => "anthropic_auth_token",
        }
    }

    fn parse_claude_auth_scheme_value(value: &str) -> Option<ClaudeAuthScheme> {
        match value.trim().to_ascii_lowercase().as_str() {
            "anthropic_api_key" => Some(ClaudeAuthScheme::AnthropicApiKey),
            "anthropic_auth_token" => Some(ClaudeAuthScheme::AnthropicAuthToken),
            _ => None,
        }
    }

    fn auth_to_string(auth: &crate::models::ClaudeAuthScheme) -> &'static str {
        Self::claude_auth_scheme_to_string(auth)
    }

    fn parse_auth_scheme(value: &str) -> Option<crate::models::ClaudeAuthScheme> {
        Self::parse_claude_auth_scheme_value(value)
    }

    fn mode_to_string(mode: &ClaudeProviderMode) -> &'static str {
        match mode {
            ClaudeProviderMode::Official => "official",
            ClaudeProviderMode::Preset => "preset",
            ClaudeProviderMode::Custom => "custom",
        }
    }

    fn parse_mode(value: &str) -> Option<ClaudeProviderMode> {
        match value.trim().to_ascii_lowercase().as_str() {
            "official" => Some(ClaudeProviderMode::Official),
            "preset" => Some(ClaudeProviderMode::Preset),
            "custom" => Some(ClaudeProviderMode::Custom),
            _ => None,
        }
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
            .ok_or_else(|| {
                AiConfigError::Invalid("configured Claude model is missing".to_string())
            })?;
        let auth_scheme = auth_scheme.ok_or_else(|| {
            AiConfigError::Invalid("configured Claude auth scheme is missing".to_string())
        })?;
        let secret = secret
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AiConfigError::Invalid("configured Claude secret is missing".to_string())
            })?;

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

    fn with_official_claude_config_defaults(
        mut config: ClaudeConfigSnapshot,
    ) -> ClaudeConfigSnapshot {
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

    fn build_claude_managed_env_keys() {}

    pub fn preview_claude_patch(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        scope: &str,
        draft: ClaudeDraftInput,
    ) -> AiConfigResult<(AiConfigPreviewResponse, StoredAiConfigPreview)> {
        if !scope.trim().eq_ignore_ascii_case("workspace")
            && !scope.trim().eq_ignore_ascii_case(GLOBAL_AI_CONFIG_CONTEXT)
        {
            return Err(AiConfigError::UnsupportedScope(
                "only global scope is supported".to_string(),
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
                    .get_saved_claude_provider(GLOBAL_AI_CONFIG_CONTEXT, saved_provider_id)
                    .map_err(|error| AiConfigError::Storage(error.to_string()))?
                    .ok_or_else(|| {
                        AiConfigError::SavedProviderNotFound(saved_provider_id.to_string())
                    })?,
            )
        } else {
            None
        };
        let (normalized, api_key_secret) = normalize_claude_draft(
            GLOBAL_AI_CONFIG_CONTEXT,
            &current,
            saved_provider.as_ref(),
            draft,
        )?;
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
            workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            scope: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
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
            GLOBAL_AI_CONFIG_CONTEXT,
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
        if let Err(error) = self.settings.update(SettingsScope::User, None, &patch) {
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
            GLOBAL_AI_CONFIG_CONTEXT,
            &saved_provider_id,
            &preview.normalized_draft,
            applied_at_ms,
        )?;

        self.audit_repository
            .insert_audit_log(&AiConfigAuditLogInput {
                audit_id: audit_id.clone(),
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                agent: "claude".to_string(),
                mode: mode_to_string(&preview.normalized_draft.mode).to_string(),
                provider_id: preview.normalized_draft.provider_id.clone(),
                changed_keys_json,
                secret_refs_json,
                confirmed_by: confirmed_by.to_string(),
                created_at_ms,
            })
            .map_err(|error| AiConfigError::Storage(error.to_string()))?;

        let effective = self.read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(workspace_root))?;

        Ok(AiConfigApplyResponse {
            workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
            preview_id: preview.preview_id.clone(),
            confirmed_by: confirmed_by.to_string(),
            applied: true,
            audit_id,
            effective,
            changed_targets: vec![
                "user_settings".to_string(),
                "claude_live_settings".to_string(),
                "saved_provider_db".to_string(),
                "secret_store".to_string(),
                "audit_log".to_string(),
            ],
        })
    }

    pub fn read_snapshot(
        &self,
        _workspace_id: &str,
        workspace_root: Option<&Path>,
    ) -> AiConfigResult<AiConfigSnapshot> {
        let workspace_root = workspace_root.unwrap_or_else(|| Path::new(""));
        let mut claude_config = self.read_claude_config(workspace_root)?;
        let user_home = user_home_dir();
        let saved_claude_providers = self.list_saved_claude_providers(GLOBAL_AI_CONFIG_CONTEXT)?;
        if claude_config.active_mode.is_none() {
            if let Some(home) = user_home.as_deref() {
                if let Some(live_config) = discover_live_claude_config_from_home(home) {
                    claude_config = live_config;
                }
            }
        }
        if claude_config.saved_provider_id.is_none() {
            claude_config.saved_provider_id = saved_claude_providers
                .iter()
                .find(|item| item.is_active)
                .map(|item| item.saved_provider_id.clone());
        }
        let mut codex_config = self.read_codex_config(workspace_root)?;
        let saved_codex_providers = self.list_saved_codex_providers()?;
        if codex_config.active_mode.is_none() {
            if let Some(home) = user_home.as_deref() {
                if let Some(live_config) = discover_live_codex_config_from_home(home) {
                    codex_config = live_config;
                }
            }
        }
        if codex_config.saved_provider_id.is_none() {
            codex_config.saved_provider_id = saved_codex_providers
                .iter()
                .find(|item| item.is_active)
                .map(|item| item.saved_provider_id.clone());
        }
        let mut gemini_config = self.read_gemini_config(workspace_root)?;
        let saved_gemini_providers = self.list_saved_gemini_providers()?;
        if gemini_config.active_mode.is_none() {
            if let Some(home) = user_home.as_deref() {
                if let Some(live_config) = discover_live_gemini_config_from_home(home) {
                    gemini_config = live_config;
                }
            }
        }
        if gemini_config.saved_provider_id.is_none() {
            gemini_config.saved_provider_id = saved_gemini_providers
                .iter()
                .find(|item| item.is_active)
                .map(|item| item.saved_provider_id.clone());
        }

        let mut codex_snapshot = codex_snapshot_template();
        codex_snapshot.config = codex_config.clone();
        codex_snapshot.saved_providers = saved_codex_providers;

        let mut gemini_snapshot = gemini_snapshot_template();
        gemini_snapshot.config = gemini_config.clone();
        gemini_snapshot.saved_providers = saved_gemini_providers;
        let workspace_root_for_mcp = workspace_root.to_path_buf();
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
            let claude_mcp =
                scope.spawn(|| claude_mcp_installed_for_workspace(&workspace_root_for_mcp));
            let codex_mcp = scope.spawn(|| check_mcp_installed(AiConfigAgent::Codex));
            let gemini_mcp = scope.spawn(|| check_mcp_installed(AiConfigAgent::Gemini));

            (
                claude_install
                    .join()
                    .unwrap_or_else(|_| map_install_status(AiConfigAgent::Claude)),
                codex_install
                    .join()
                    .unwrap_or_else(|_| map_install_status(AiConfigAgent::Codex)),
                gemini_install
                    .join()
                    .unwrap_or_else(|_| map_install_status(AiConfigAgent::Gemini)),
                claude_mcp
                    .join()
                    .unwrap_or_else(|_| claude_mcp_installed_for_workspace(workspace_root)),
                codex_mcp
                    .join()
                    .unwrap_or_else(|_| check_mcp_installed(AiConfigAgent::Codex)),
                gemini_mcp
                    .join()
                    .unwrap_or_else(|_| check_mcp_installed(AiConfigAgent::Gemini)),
            )
        });

        codex_snapshot.mcp_installed = codex_mcp_installed;
        gemini_snapshot.mcp_installed = gemini_mcp_installed;

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
                    mcp_installed: codex_snapshot.mcp_installed,
                    config_status: if codex_snapshot.config.active_mode.is_some() {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: AiConfigService::codex_summary(&codex_snapshot.config),
                },
                crate::models::AiAgentSnapshotCard {
                    agent: AiConfigAgent::Gemini,
                    title: "aiConfig.agent.gemini.title".to_string(),
                    subtitle: "aiConfig.agent.gemini.subtitle".to_string(),
                    install_status: gemini_install_status,
                    mcp_installed: gemini_snapshot.mcp_installed,
                    config_status: if gemini_snapshot.config.active_mode.is_some() {
                        crate::models::AiAgentConfigStatus::Configured
                    } else {
                        crate::models::AiAgentConfigStatus::Unconfigured
                    },
                    active_summary: AiConfigService::gemini_summary(&gemini_snapshot.config),
                },
            ],
            claude: ClaudeSnapshot {
                presets: claude_provider_presets(),
                config: claude_config,
                saved_providers: saved_claude_providers,
                can_apply_official_mode: true,
            },
            codex: codex_snapshot,
            gemini: gemini_snapshot,
        })
    }

    pub fn build_agent_runtime_env(
        &self,
        agent: AiConfigAgent,
        workspace_root: &Path,
    ) -> AiConfigResult<BTreeMap<String, String>> {
        match agent {
            AiConfigAgent::Claude => self.build_claude_runtime_env(workspace_root),
            AiConfigAgent::Codex => self.codex_runtime_env(workspace_root),
            AiConfigAgent::Gemini => self.gemini_runtime_env(workspace_root),
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

fn build_empty_claude_patch() -> Value {
    json!({
        "ai": {
            "providers": {
                "claude": {
                    "savedProviderId": Value::Null,
                    "activeMode": Value::Null,
                    "providerId": Value::Null,
                    "providerName": Value::Null,
                    "baseUrl": Value::Null,
                    "model": Value::Null,
                    "authScheme": Value::Null,
                    "secretRef": Value::Null,
                    "hasSecret": false,
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

fn fingerprint_codex_config(normalized: &CodexNormalizedDraft) -> String {
    json!({
        "mode": AiConfigService::codex_mode_to_string(&normalized.mode),
        "providerId": normalized.provider_id,
        "providerName": normalized.provider_name,
        "baseUrl": normalized.base_url,
        "model": normalized.model,
        "configToml": normalized.config_toml,
        "hasSecret": normalized.has_secret,
    })
    .to_string()
}

fn official_codex_normalized_draft() -> CodexNormalizedDraft {
    let preset = codex_provider_presets()
        .into_iter()
        .find(|item| item.provider_id == "codex-official")
        .unwrap_or_else(|| {
            panic!("missing Codex official preset");
        });
    CodexNormalizedDraft {
        mode: CodexProviderMode::Official,
        provider_id: Some(preset.provider_id),
        provider_name: Some(preset.name),
        base_url: None,
        model: Some(preset.recommended_model),
        config_toml: None,
        secret_ref: None,
        has_secret: false,
    }
}

fn with_official_codex_config_defaults(mut config: CodexConfigSnapshot) -> CodexConfigSnapshot {
    let is_official = config.active_mode == Some(CodexProviderMode::Official)
        || config.provider_id.as_deref() == Some("codex-official");
    if !is_official {
        return config;
    }

    let defaults = official_codex_normalized_draft();
    config.provider_id = config.provider_id.or(defaults.provider_id);
    config.provider_name = config.provider_name.or(defaults.provider_name);
    config.base_url = None;
    config.model = config.model.or(defaults.model);
    config.config_toml = None;
    config.secret_ref = None;
    config.has_secret = false;
    config
}

fn saved_codex_provider_snapshot_from_record(
    record: SavedAiProviderRecord,
) -> AiConfigResult<CodexSavedProviderSnapshot> {
    let mode = AiConfigService::parse_codex_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Codex provider has invalid mode: {}",
            record.mode
        ))
    })?;
    let extra = serde_json::from_str::<Value>(&record.extra_json).unwrap_or_else(|_| json!({}));
    let is_official = mode == CodexProviderMode::Official;
    let defaults = if is_official {
        Some(official_codex_normalized_draft())
    } else {
        None
    };

    Ok(CodexSavedProviderSnapshot {
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
                .unwrap_or_else(|| "aiConfig.agent.codex.title".to_string())
        } else {
            record.provider_name
        },
        base_url: if is_official { None } else { record.base_url },
        model: if is_official {
            record
                .model
                .or_else(|| defaults.as_ref().and_then(|value| value.model.clone()))
        } else {
            record.model
        },
        config_toml: if is_official {
            None
        } else {
            extra
                .get("configToml")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        },
        has_secret: if is_official {
            false
        } else {
            record.has_secret
        },
        is_active: record.is_active,
        created_at_ms: record.created_at_ms.max(0) as u64,
        updated_at_ms: record.updated_at_ms.max(0) as u64,
        last_applied_at_ms: record.last_applied_at_ms.max(0) as u64,
    })
}

fn normalized_from_saved_codex_provider(
    record: &SavedAiProviderRecord,
) -> AiConfigResult<CodexNormalizedDraft> {
    let mode = AiConfigService::parse_codex_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Codex provider has invalid mode: {}",
            record.mode
        ))
    })?;
    if mode == CodexProviderMode::Official {
        return Ok(official_codex_normalized_draft());
    }
    if mode != CodexProviderMode::Official
        && record.has_secret
        && record
            .secret_ref
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
    {
        return Err(AiConfigError::Storage(format!(
            "saved Codex provider {} is missing secret reference",
            record.saved_provider_id
        )));
    }
    let extra = serde_json::from_str::<Value>(&record.extra_json).unwrap_or_else(|_| json!({}));

    Ok(CodexNormalizedDraft {
        mode,
        provider_id: record.provider_id.clone(),
        provider_name: Some(record.provider_name.clone()),
        base_url: record.base_url.clone(),
        model: record.model.clone(),
        config_toml: extra
            .get("configToml")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        secret_ref: record.secret_ref.clone(),
        has_secret: record.has_secret,
    })
}

fn fingerprint_gemini_config(normalized: &GeminiNormalizedDraft) -> String {
    json!({
        "mode": AiConfigService::gemini_mode_to_string(&normalized.mode),
        "authMode": AiConfigService::gemini_auth_mode_to_string(&normalized.auth_mode),
        "providerId": normalized.provider_id,
        "providerName": normalized.provider_name,
        "baseUrl": normalized.base_url,
        "model": normalized.model,
        "selectedType": normalized.selected_type,
        "hasSecret": normalized.has_secret,
    })
    .to_string()
}

fn official_gemini_normalized_draft() -> GeminiNormalizedDraft {
    let preset = gemini_provider_presets()
        .into_iter()
        .find(|item| item.provider_id == "google-official")
        .unwrap_or_else(|| {
            panic!("missing Gemini official preset");
        });
    GeminiNormalizedDraft {
        mode: GeminiProviderMode::Official,
        auth_mode: GeminiAuthMode::OAuth,
        provider_id: Some(preset.provider_id),
        provider_name: Some(preset.name),
        base_url: None,
        model: Some(preset.recommended_model),
        selected_type: GeminiAuthMode::OAuth.selected_type().to_string(),
        secret_ref: None,
        has_secret: false,
    }
}

fn with_official_gemini_config_defaults(mut config: GeminiConfigSnapshot) -> GeminiConfigSnapshot {
    let is_official = config.active_mode == Some(GeminiProviderMode::Official)
        || config.provider_id.as_deref() == Some("google-official");
    if !is_official {
        return config;
    }

    let defaults = official_gemini_normalized_draft();
    config.auth_mode = Some(GeminiAuthMode::OAuth);
    config.provider_id = config.provider_id.or(defaults.provider_id);
    config.provider_name = config.provider_name.or(defaults.provider_name);
    config.base_url = None;
    config.model = config.model.or(defaults.model);
    config.selected_type = Some(defaults.selected_type);
    config.secret_ref = None;
    config.has_secret = false;
    config
}

fn saved_gemini_provider_snapshot_from_record(
    record: SavedAiProviderRecord,
) -> AiConfigResult<GeminiSavedProviderSnapshot> {
    let mode = AiConfigService::parse_gemini_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Gemini provider has invalid mode: {}",
            record.mode
        ))
    })?;
    let extra = serde_json::from_str::<Value>(&record.extra_json).unwrap_or_else(|_| json!({}));
    let is_official = mode == GeminiProviderMode::Official;
    let defaults = if is_official {
        Some(official_gemini_normalized_draft())
    } else {
        None
    };
    let auth_mode = extra
        .get("authMode")
        .and_then(Value::as_str)
        .and_then(AiConfigService::parse_gemini_auth_mode)
        .unwrap_or_else(|| {
            defaults
                .as_ref()
                .map(|value| value.auth_mode.clone())
                .unwrap_or(GeminiAuthMode::OAuth)
        });
    let selected_type = if is_official {
        defaults
            .as_ref()
            .map(|value| value.selected_type.clone())
            .unwrap_or_else(|| GeminiAuthMode::OAuth.selected_type().to_string())
    } else {
        extra
            .get("selectedType")
            .and_then(Value::as_str)
            .map(|value| value.to_string())
            .unwrap_or_else(|| auth_mode.selected_type().to_string())
    };

    Ok(GeminiSavedProviderSnapshot {
        saved_provider_id: record.saved_provider_id,
        mode,
        auth_mode,
        provider_id: record.provider_id.or_else(|| {
            defaults
                .as_ref()
                .and_then(|value| value.provider_id.clone())
        }),
        provider_name: if record.provider_name.trim().is_empty() {
            defaults
                .as_ref()
                .and_then(|value| value.provider_name.clone())
                .unwrap_or_else(|| "aiConfig.agent.gemini.title".to_string())
        } else {
            record.provider_name
        },
        base_url: if is_official { None } else { record.base_url },
        model: if is_official {
            record
                .model
                .or_else(|| defaults.as_ref().and_then(|value| value.model.clone()))
        } else {
            record.model
        },
        selected_type,
        has_secret: if is_official {
            false
        } else {
            record.has_secret
        },
        is_active: record.is_active,
        created_at_ms: record.created_at_ms.max(0) as u64,
        updated_at_ms: record.updated_at_ms.max(0) as u64,
        last_applied_at_ms: record.last_applied_at_ms.max(0) as u64,
    })
}

fn normalized_from_saved_gemini_provider(
    record: &SavedAiProviderRecord,
) -> AiConfigResult<GeminiNormalizedDraft> {
    let mode = AiConfigService::parse_gemini_mode(&record.mode).ok_or_else(|| {
        AiConfigError::Storage(format!(
            "saved Gemini provider has invalid mode: {}",
            record.mode
        ))
    })?;
    if mode == GeminiProviderMode::Official {
        return Ok(official_gemini_normalized_draft());
    }
    let extra = serde_json::from_str::<Value>(&record.extra_json).unwrap_or_else(|_| json!({}));
    let auth_mode = extra
        .get("authMode")
        .and_then(Value::as_str)
        .and_then(AiConfigService::parse_gemini_auth_mode)
        .unwrap_or(GeminiAuthMode::OAuth);
    let selected_type = extra
        .get("selectedType")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .unwrap_or_else(|| auth_mode.selected_type().to_string());

    if mode != GeminiProviderMode::Official
        && record.has_secret
        && record
            .secret_ref
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
    {
        return Err(AiConfigError::Storage(format!(
            "saved Gemini provider {} is missing secret reference",
            record.saved_provider_id
        )));
    }

    Ok(GeminiNormalizedDraft {
        mode,
        auth_mode,
        provider_id: record.provider_id.clone(),
        provider_name: Some(record.provider_name.clone()),
        base_url: record.base_url.clone(),
        model: record.model.clone(),
        selected_type,
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

fn codex_config_path_from_home(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

fn codex_auth_path_from_home(home: &Path) -> PathBuf {
    home.join(".codex").join("auth.json")
}

fn gemini_env_path_from_home(home: &Path) -> PathBuf {
    home.join(".gemini").join(".env")
}

fn gemini_settings_path_from_home(home: &Path) -> PathBuf {
    home.join(".gemini").join("settings.json")
}

fn normalize_live_endpoint_value(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn latest_file_updated_at_ms(paths: &[&Path]) -> Option<u64> {
    paths
        .iter()
        .filter_map(|path| {
            std::fs::metadata(path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64)
        })
        .max()
}

fn parse_simple_env_file(path: &Path) -> BTreeMap<String, String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };

    raw.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            let key = key.trim();
            if key.is_empty() {
                return None;
            }
            let value = value.trim().trim_matches('"').trim_matches('\'');
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn serialize_simple_env_file(env: &BTreeMap<String, String>) -> String {
    env.iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn discover_live_codex_config_from_home(home: &Path) -> Option<CodexConfigSnapshot> {
    let config_path = codex_config_path_from_home(home);
    let auth_path = codex_auth_path_from_home(home);
    if !config_path.exists() && !auth_path.exists() {
        return None;
    }

    let config_text = std::fs::read_to_string(&config_path)
        .ok()
        .unwrap_or_default();
    let config_table = if config_text.trim().is_empty() {
        None
    } else {
        toml::from_str::<toml::Table>(&config_text).ok()
    };

    let provider_key = config_table
        .as_ref()
        .and_then(|table| table.get("model_provider"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let base_url = config_table.as_ref().and_then(|table| {
        provider_key
            .as_deref()
            .and_then(|_| table.get("model_providers"))
            .and_then(|value| value.as_table())
            .and_then(|providers| provider_key.as_deref().and_then(|key| providers.get(key)))
            .and_then(|value| value.as_table())
            .and_then(|provider| provider.get("base_url"))
            .and_then(|value| value.as_str())
            .and_then(normalize_live_endpoint_value)
            .or_else(|| {
                table
                    .get("base_url")
                    .and_then(|value| value.as_str())
                    .and_then(normalize_live_endpoint_value)
            })
    });
    let model = config_table
        .as_ref()
        .and_then(|table| table.get("model"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let api_key = std::fs::read_to_string(&auth_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("OPENAI_API_KEY")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty());
    let has_secret = api_key.is_some();
    let updated_at_ms = latest_file_updated_at_ms(&[&config_path, &auth_path]);

    if let Some(base_url) = base_url {
        if let Some(preset) = codex_provider_presets().into_iter().find(|preset| {
            preset
                .endpoint
                .as_deref()
                .and_then(normalize_live_endpoint_value)
                .as_deref()
                == Some(base_url.as_str())
        }) {
            return Some(CodexConfigSnapshot {
                saved_provider_id: None,
                active_mode: Some(CodexProviderMode::Preset),
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                config_toml: (!config_text.trim().is_empty()).then_some(config_text),
                secret_ref: None,
                has_secret,
                updated_at_ms,
            });
        }

        return Some(CodexConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(CodexProviderMode::Custom),
            provider_id: Some("custom-gateway".to_string()),
            provider_name: Some(
                provider_key
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| value.replace('_', " "))
                    .unwrap_or_else(|| "Custom Gateway".to_string()),
            ),
            base_url: Some(base_url),
            model,
            config_toml: (!config_text.trim().is_empty()).then_some(config_text),
            secret_ref: None,
            has_secret,
            updated_at_ms,
        });
    }

    if has_secret || model.is_some() {
        let defaults = official_codex_normalized_draft();
        return Some(CodexConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(CodexProviderMode::Official),
            provider_id: defaults.provider_id,
            provider_name: defaults.provider_name,
            base_url: defaults.base_url,
            model: model.or(defaults.model),
            config_toml: (!config_text.trim().is_empty()).then_some(config_text),
            secret_ref: None,
            has_secret,
            updated_at_ms,
        });
    }

    None
}

fn discover_live_gemini_config_from_home(home: &Path) -> Option<GeminiConfigSnapshot> {
    let env_path = gemini_env_path_from_home(home);
    let settings_path = gemini_settings_path_from_home(home);
    if !env_path.exists() && !settings_path.exists() {
        return None;
    }

    let env = parse_simple_env_file(&env_path);
    let settings = read_json_object_file(&settings_path)
        .ok()
        .unwrap_or_else(|| json!({}));
    let selected_type = settings
        .get("security")
        .and_then(Value::as_object)
        .and_then(|security| security.get("auth"))
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("selectedType"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            env.get("GEMINI_API_KEY").and_then(|value| {
                if value.trim().is_empty() {
                    None
                } else {
                    Some(GeminiAuthMode::ApiKey.selected_type().to_string())
                }
            })
        });
    let auth_mode = match selected_type.as_deref() {
        Some("gemini-api-key") => GeminiAuthMode::ApiKey,
        _ => GeminiAuthMode::OAuth,
    };
    let base_url = env
        .get("GOOGLE_GEMINI_BASE_URL")
        .and_then(|value| normalize_live_endpoint_value(value));
    let model = env
        .get("GEMINI_MODEL")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let api_key = env
        .get("GEMINI_API_KEY")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let has_secret = api_key.is_some();
    let updated_at_ms = latest_file_updated_at_ms(&[&env_path, &settings_path]);

    if let Some(base_url) = base_url {
        let matched_preset = gemini_provider_presets()
            .into_iter()
            .filter(|preset| {
                preset
                    .endpoint
                    .as_deref()
                    .and_then(normalize_live_endpoint_value)
                    .as_deref()
                    == Some(base_url.as_str())
            })
            .find(|preset| {
                selected_type.as_deref() == Some(preset.selected_type.as_str())
                    || auth_mode == preset.auth_mode
            });

        if let Some(preset) = matched_preset {
            let requires_secret =
                preset.auth_mode == GeminiAuthMode::ApiKey || preset.requires_api_key;
            if requires_secret && !has_secret {
                return None;
            }
            if preset.provider_id == "google-official" && !has_secret {
                return None;
            }

            let preset_auth_mode = selected_type
                .as_deref()
                .map(|_| auth_mode.clone())
                .unwrap_or_else(|| preset.auth_mode.clone());
            let preset_selected_type = selected_type
                .clone()
                .unwrap_or_else(|| preset_auth_mode.selected_type().to_string());
            return Some(GeminiConfigSnapshot {
                saved_provider_id: None,
                active_mode: Some(GeminiProviderMode::Preset),
                auth_mode: Some(preset_auth_mode),
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                selected_type: Some(preset_selected_type),
                secret_ref: None,
                has_secret,
                updated_at_ms,
            });
        }

        return Some(GeminiConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(GeminiProviderMode::Custom),
            auth_mode: Some(auth_mode.clone()),
            provider_id: Some("custom-gateway".to_string()),
            provider_name: Some("Custom Gateway".to_string()),
            base_url: Some(base_url),
            model,
            selected_type: Some(
                selected_type.unwrap_or_else(|| auth_mode.selected_type().to_string()),
            ),
            secret_ref: None,
            has_secret,
            updated_at_ms,
        });
    }

    if has_secret {
        let defaults = official_gemini_normalized_draft();
        return Some(GeminiConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(GeminiProviderMode::Official),
            auth_mode: Some(auth_mode),
            provider_id: defaults.provider_id,
            provider_name: defaults.provider_name,
            base_url: defaults.base_url,
            model: model.or(defaults.model),
            selected_type: Some(
                selected_type.unwrap_or_else(|| GeminiAuthMode::OAuth.selected_type().to_string()),
            ),
            secret_ref: None,
            has_secret,
            updated_at_ms,
        });
    }

    None
}

fn discover_live_claude_config_from_home(home: &Path) -> Option<ClaudeConfigSnapshot> {
    let settings_path = claude_settings_path_from_home(home);
    if !settings_path.exists() {
        return None;
    }

    let settings = read_json_object_file(&settings_path).ok()?;
    let env = settings.get("env").and_then(Value::as_object)?;
    let auth_token = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty());
    let api_key = env
        .get("ANTHROPIC_API_KEY")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty());
    let auth_scheme = if auth_token.is_some() {
        Some(ClaudeAuthScheme::AnthropicAuthToken)
    } else if api_key.is_some() {
        Some(ClaudeAuthScheme::AnthropicApiKey)
    } else {
        None
    };
    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .and_then(normalize_live_endpoint_value);
    let model = env
        .get("ANTHROPIC_MODEL")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty());
    let has_secret = auth_scheme.is_some();
    let updated_at_ms = latest_file_updated_at_ms(&[&settings_path]);

    if let Some(base_url) = base_url {
        if let Some(preset) = claude_provider_presets().into_iter().find(|preset| {
            normalize_live_endpoint_value(&preset.endpoint).as_deref() == Some(base_url.as_str())
        }) {
            return Some(with_official_claude_config_defaults(ClaudeConfigSnapshot {
                saved_provider_id: None,
                active_mode: Some(ClaudeProviderMode::Preset),
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                auth_scheme: auth_scheme.or(Some(preset.auth_scheme)),
                secret_ref: None,
                has_secret,
                updated_at_ms,
            }));
        }

        return Some(ClaudeConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(ClaudeProviderMode::Custom),
            provider_id: Some("custom-gateway".to_string()),
            provider_name: Some("Custom Gateway".to_string()),
            base_url: Some(base_url),
            model,
            auth_scheme,
            secret_ref: None,
            has_secret,
            updated_at_ms,
        });
    }

    if has_secret {
        let defaults = official_claude_normalized_draft();
        return Some(with_official_claude_config_defaults(ClaudeConfigSnapshot {
            saved_provider_id: None,
            active_mode: Some(ClaudeProviderMode::Official),
            provider_id: defaults.provider_id,
            provider_name: defaults.provider_name,
            base_url: defaults.base_url,
            model: model.or(defaults.model),
            auth_scheme: auth_scheme.or(defaults.auth_scheme),
            secret_ref: None,
            has_secret,
            updated_at_ms,
        }));
    }

    None
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

fn remove_file_if_exists(path: &Path) -> AiConfigResult<()> {
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| {
            AiConfigError::LiveSync(format!(
                "failed to remove settings file {}: {error}",
                path.display()
            ))
        })?;
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

fn build_secret_ref(_workspace_id: &str, provider_id: &str) -> String {
    format!(
        "ai-config/claude/{}/{}/api_key",
        sanitize_secret_segment(provider_id),
        Uuid::new_v4()
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

fn path_from_known_home(value: Option<&Path>) -> Option<PathBuf> {
    let value = value?;
    if value.as_os_str().is_empty() {
        return None;
    }
    Some(value.to_path_buf())
}

#[cfg(windows)]
fn windows_profile_home_dir() -> Option<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, ptr, slice};

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHGetKnownFolderPath(
            rfid: *const Guid,
            dwFlags: u32,
            hToken: isize,
            ppszPath: *mut *mut u16,
        ) -> i32;
    }

    #[link(name = "ole32")]
    extern "system" {
        fn CoTaskMemFree(pv: *mut std::ffi::c_void);
    }

    const FOLDERID_PROFILE: Guid = Guid {
        data1: 0x5E6C858F,
        data2: 0x0E22,
        data3: 0x4760,
        data4: [0x9A, 0xFE, 0xEA, 0x33, 0x17, 0xB6, 0x71, 0x73],
    };

    let mut raw_path: *mut u16 = ptr::null_mut();
    let result = unsafe { SHGetKnownFolderPath(&FOLDERID_PROFILE, 0, 0, &mut raw_path) };
    if result < 0 || raw_path.is_null() {
        return None;
    }

    let mut len = 0usize;
    while unsafe { *raw_path.add(len) } != 0 {
        len += 1;
    }
    let path = PathBuf::from(OsString::from_wide(unsafe {
        slice::from_raw_parts(raw_path, len)
    }));
    unsafe { CoTaskMemFree(raw_path.cast()) };

    if path.as_os_str().is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(not(windows))]
fn windows_profile_home_dir() -> Option<PathBuf> {
    None
}

fn resolve_user_home_dir_from_values(
    known_home: Option<&Path>,
    home: Option<&OsStr>,
    userprofile: Option<&OsStr>,
    homedrive: Option<&OsStr>,
    homepath: Option<&OsStr>,
    prefer_windows_order: bool,
) -> Option<PathBuf> {
    let known_home_path = path_from_known_home(known_home);
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
        known_home_path
            .or(userprofile_path)
            .or(joined_windows_home)
            .or(home_path)
    } else {
        known_home_path
            .or(home_path)
            .or(userprofile_path)
            .or(joined_windows_home)
    }
}

fn user_home_dir() -> Option<PathBuf> {
    let known_home = windows_profile_home_dir();
    resolve_user_home_dir_from_values(
        known_home.as_deref(),
        std::env::var_os("HOME").as_deref(),
        std::env::var_os("USERPROFILE").as_deref(),
        std::env::var_os("HOMEDRIVE").as_deref(),
        std::env::var_os("HOMEPATH").as_deref(),
        cfg!(windows),
    )
}

pub fn claude_mcp_installed_for_workspace(workspace_root: &Path) -> bool {
    let home = match user_home_dir() {
        Some(path) => path,
        None => return false,
    };
    claude_mcp_installed_for_workspace_at_home(&home, workspace_root)
}

fn claude_mcp_installed_for_workspace_at_home(home: &Path, workspace_root: &Path) -> bool {
    let claude_json_path = home.join(".claude.json");
    let Ok(root) = read_json_object_file(&claude_json_path) else {
        return false;
    };
    let workspace_key = workspace_root.to_string_lossy();
    root.get("projects")
        .and_then(Value::as_object)
        .and_then(|projects| projects.get(workspace_key.as_ref()))
        .and_then(Value::as_object)
        .and_then(|project| project.get("mcpServers"))
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.contains_key(GTO_AGENT_BRIDGE_SERVER_ID))
}

fn check_mcp_installed(agent: AiConfigAgent) -> bool {
    let home = match user_home_dir() {
        Some(path) => path,
        None => return false,
    };

    let paths = match agent {
        AiConfigAgent::Claude => vec![
            home.join(".claude.json"),
            home.join(".claude").join("settings.json"),
        ],
        AiConfigAgent::Codex => vec![home.join(".codex").join("config.toml")],
        AiConfigAgent::Gemini => vec![home.join(".gemini").join("settings.json")],
    };

    paths.iter().any(|path| file_contains_bridge_marker(path))
}

fn file_contains_bridge_marker(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    std::fs::read_to_string(path)
        .map(|content| content.contains(GTO_AGENT_BRIDGE_SERVER_ID))
        .unwrap_or(false)
}

fn workspace_scoped_mcp_installed(agent: AiConfigAgent, workspace_root: Option<&Path>) -> bool {
    match agent {
        AiConfigAgent::Claude => workspace_root.is_some_and(claude_mcp_installed_for_workspace),
        AiConfigAgent::Codex | AiConfigAgent::Gemini => check_mcp_installed(agent),
    }
}

fn agent_type_to_config_agent(agent: vb_tools::agent_installer::AgentType) -> AiConfigAgent {
    match agent {
        vb_tools::agent_installer::AgentType::ClaudeCode => AiConfigAgent::Claude,
        vb_tools::agent_installer::AgentType::Codex => AiConfigAgent::Codex,
        vb_tools::agent_installer::AgentType::Gemini => AiConfigAgent::Gemini,
    }
}

pub fn agent_mcp_installed_for_workspace(
    agent: vb_tools::agent_installer::AgentType,
    workspace_root: Option<&Path>,
) -> bool {
    workspace_scoped_mcp_installed(agent_type_to_config_agent(agent), workspace_root)
}

#[cfg(test)]
fn write_json_file(path: &Path, value: &Value) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

#[cfg(test)]
fn write_text_file(path: &Path, value: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, value).unwrap();
}

#[cfg(test)]
fn create_test_home(dir: &Path) -> PathBuf {
    let home = dir.join("mock-home");
    std::fs::create_dir_all(&home).unwrap();
    home
}

#[cfg(test)]
fn create_workspace(dir: &Path, name: &str) -> PathBuf {
    let workspace = dir.join(name);
    std::fs::create_dir_all(&workspace).unwrap();
    workspace
}

#[cfg(test)]
fn write_codex_marker(home: &Path) {
    write_text_file(
        &home.join(".codex").join("config.toml"),
        GTO_AGENT_BRIDGE_SERVER_ID,
    );
}

#[cfg(test)]
fn write_codex_live_config(
    home: &Path,
    provider_name: &str,
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
) {
    let provider_key = sanitize_secret_segment(provider_name)
        .trim_matches('_')
        .to_ascii_lowercase();
    let config = format!(
        "model = \"{model}\"\nmodel_provider = \"{provider_key}\"\n\n[model_providers.{provider_key}]\nname = \"{provider_name}\"\nbase_url = \"{base_url}\"\n"
    );
    write_text_file(&home.join(".codex").join("config.toml"), &config);
    if let Some(api_key) = api_key {
        write_json_file(
            &home.join(".codex").join("auth.json"),
            &json!({
                "OPENAI_API_KEY": api_key,
            }),
        );
    }
}

#[cfg(test)]
fn write_gemini_marker(home: &Path) {
    write_text_file(
        &home.join(".gemini").join("settings.json"),
        GTO_AGENT_BRIDGE_SERVER_ID,
    );
}

#[cfg(test)]
fn write_gemini_live_config(
    home: &Path,
    selected_type: &str,
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
) {
    let mut env_lines = vec![
        format!("GOOGLE_GEMINI_BASE_URL={base_url}"),
        format!("GEMINI_MODEL={model}"),
    ];
    if let Some(api_key) = api_key {
        env_lines.push(format!("GEMINI_API_KEY={api_key}"));
    }
    write_text_file(&home.join(".gemini").join(".env"), &env_lines.join("\n"));
    write_json_file(
        &home.join(".gemini").join("settings.json"),
        &json!({
            "security": {
                "auth": {
                    "selectedType": selected_type,
                }
            }
        }),
    );
}

#[cfg(test)]
fn write_claude_live_config(
    home: &Path,
    auth_key: &str,
    secret: &str,
    base_url: &str,
    model: &str,
    extra_env: &BTreeMap<String, String>,
) {
    let mut env = serde_json::Map::from_iter([
        (auth_key.to_string(), Value::String(secret.to_string())),
        (
            "ANTHROPIC_BASE_URL".to_string(),
            Value::String(base_url.to_string()),
        ),
        (
            "ANTHROPIC_MODEL".to_string(),
            Value::String(model.to_string()),
        ),
    ]);
    for (key, value) in extra_env {
        env.insert(key.clone(), Value::String(value.clone()));
    }
    write_json_file(
        &home.join(".claude").join("settings.json"),
        &Value::Object(serde_json::Map::from_iter([(
            "env".to_string(),
            Value::Object(env),
        )])),
    );
}

#[cfg(test)]
fn write_claude_workspace_config(home: &Path, workspace_root: &Path) {
    write_json_file(
        &home.join(".claude.json"),
        &json!({
            "projects": {
                workspace_root.to_string_lossy().to_string(): {
                    "mcpServers": {
                        GTO_AGENT_BRIDGE_SERVER_ID: {
                            "type": "stdio",
                            "command": "npx"
                        }
                    }
                }
            },
            "mcpServers": {
                GTO_AGENT_BRIDGE_SERVER_ID: {
                    "type": "stdio",
                    "command": "npx"
                }
            }
        }),
    );
}

#[cfg(test)]
fn write_claude_workspace_configs(home: &Path, workspace_roots: &[&Path]) {
    let projects = workspace_roots
        .iter()
        .map(|workspace_root| {
            (
                workspace_root.to_string_lossy().to_string(),
                json!({
                    "mcpServers": {
                        GTO_AGENT_BRIDGE_SERVER_ID: {
                            "type": "stdio",
                            "command": "npx"
                        }
                    }
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();
    write_json_file(
        &home.join(".claude.json"),
        &Value::Object(serde_json::Map::from_iter([
            ("projects".to_string(), Value::Object(projects)),
            (
                "mcpServers".to_string(),
                json!({
                    GTO_AGENT_BRIDGE_SERVER_ID: {
                        "type": "stdio",
                        "command": "npx"
                    }
                }),
            ),
        ])),
    );
}

#[cfg(test)]
fn write_claude_top_level_marker_only(home: &Path) {
    write_json_file(
        &home.join(".claude.json"),
        &json!({
            "mcpServers": {
                GTO_AGENT_BRIDGE_SERVER_ID: {
                    "type": "stdio",
                    "command": "npx"
                }
            }
        }),
    );
}

#[cfg(test)]
fn write_invalid_claude_json(home: &Path) {
    write_text_file(&home.join(".claude.json"), "{invalid json");
}

#[cfg(test)]
fn claude_status_for_home(home: &Path, workspace_root: &Path) -> bool {
    claude_mcp_installed_for_workspace_at_home(home, workspace_root)
}

#[cfg(test)]
fn agent_status_result(agent: AiConfigAgent, home: &Path, workspace_root: Option<&Path>) -> bool {
    match agent {
        AiConfigAgent::Claude => {
            workspace_root.is_some_and(|root| claude_status_for_home(home, root))
        }
        AiConfigAgent::Codex => {
            file_contains_bridge_marker(&home.join(".codex").join("config.toml"))
        }
        AiConfigAgent::Gemini => {
            file_contains_bridge_marker(&home.join(".gemini").join("settings.json"))
        }
    }
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
    use std::{
        ffi::OsString,
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
    };

    use vb_storage::{SqliteAiConfigRepository, SqliteStorage};

    use super::*;

    static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

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

    fn with_test_home<T>(dir: &Path, f: impl FnOnce(&Path) -> T) -> T {
        let _guard = HOME_ENV_LOCK.lock().unwrap();
        let home = create_test_home(dir);
        let previous_home = std::env::var_os("HOME");
        let previous_userprofile = std::env::var_os("USERPROFILE");
        let previous_homedrive = std::env::var_os("HOMEDRIVE");
        let previous_homepath = std::env::var_os("HOMEPATH");

        std::env::set_var("HOME", &home);
        std::env::remove_var("USERPROFILE");
        std::env::remove_var("HOMEDRIVE");
        std::env::remove_var("HOMEPATH");

        let result = f(&home);

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        restore_env_var("USERPROFILE", previous_userprofile);
        restore_env_var("HOMEDRIVE", previous_homedrive);
        restore_env_var("HOMEPATH", previous_homepath);

        result
    }

    fn restore_env_var(key: &str, value: Option<OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
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
        assert!(!workspace_root.join(".gtoffice/config.json").exists());
        let config_raw = fs::read_to_string(dir.join("user-settings.json")).unwrap();
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

        let user_json = read_claude_config_from_value(
            &read_json_object_file(&dir.join("user-settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(user_json.provider_id.as_deref(), Some("deepseek"));
        assert_eq!(
            user_json.saved_provider_id.as_deref(),
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
    fn codex_official_mode_removes_managed_provider_fields_but_preserves_unrelated_config() {
        let dir = temp_dir("codex-official-sync");
        let service = service_for(&dir);

        with_test_home(&dir, |home| {
            write_text_file(
                &home.join(".codex").join("config.toml"),
                r#"approval_policy = "never"
model = "gpt-5.4"
model_provider = "openrouter"
disable_response_storage = true

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"

[mcp_servers."gto-agent-bridge"]
command = "npx"
"#,
            );
            write_json_file(
                &home.join(".codex").join("auth.json"),
                &json!({
                    "OPENAI_API_KEY": "openrouter-secret",
                    "sessionId": "keep-me",
                }),
            );

            service
                .sync_codex_live_settings(&official_codex_normalized_draft())
                .unwrap();

            let auth = read_json_object_file(&home.join(".codex").join("auth.json")).unwrap();
            assert!(auth.get("OPENAI_API_KEY").is_none());
            assert_eq!(auth.get("sessionId"), Some(&json!("keep-me")));

            let config_text = fs::read_to_string(home.join(".codex").join("config.toml")).unwrap();
            let config = toml::from_str::<toml::Table>(&config_text).unwrap();
            assert_eq!(
                config
                    .get("approval_policy")
                    .and_then(|value| value.as_str()),
                Some("never")
            );
            assert_eq!(
                config.get("model").and_then(|value| value.as_str()),
                Some("gpt-5.4")
            );
            assert!(config.get("model_provider").is_none());
            assert!(!config_text.contains("base_url = "));
            assert!(config_text.contains("gto-agent-bridge"));
            assert!(config
                .get("model_providers")
                .and_then(|value| value.as_table())
                .map(|table| !table.contains_key("openrouter"))
                .unwrap_or(true));
        });
    }

    #[test]
    fn gemini_official_mode_removes_managed_endpoint_and_api_key_but_preserves_other_settings() {
        let dir = temp_dir("gemini-official-sync");
        let service = service_for(&dir);

        with_test_home(&dir, |home| {
            write_text_file(
                &home.join(".gemini").join(".env"),
                "GOOGLE_GEMINI_BASE_URL=https://proxy.example.com/v1\nGEMINI_MODEL=gemini-2.5-pro\nGEMINI_API_KEY=secret-value\nUNRELATED_FLAG=keep-me\n",
            );
            write_json_file(
                &home.join(".gemini").join("settings.json"),
                &json!({
                    "security": {
                        "auth": {
                            "selectedType": "gemini-api-key"
                        }
                    },
                    "mcpServers": {
                        "gto-agent-bridge": {
                            "command": "npx"
                        }
                    }
                }),
            );

            service
                .sync_gemini_live_settings(&official_gemini_normalized_draft())
                .unwrap();

            let env = parse_simple_env_file(&home.join(".gemini").join(".env"));
            assert!(env.get("GOOGLE_GEMINI_BASE_URL").is_none());
            assert!(env.get("GEMINI_API_KEY").is_none());
            assert_eq!(
                env.get("UNRELATED_FLAG").map(String::as_str),
                Some("keep-me")
            );
            assert_eq!(
                env.get("GEMINI_MODEL").map(String::as_str),
                Some("gemini-2.5-pro")
            );

            let settings =
                read_json_object_file(&home.join(".gemini").join("settings.json")).unwrap();
            assert_eq!(
                settings
                    .pointer("/security/auth/selectedType")
                    .and_then(Value::as_str),
                Some("oauth-personal")
            );
            assert_eq!(
                settings
                    .pointer("/mcpServers/gto-agent-bridge/command")
                    .and_then(Value::as_str),
                Some("npx")
            );
        });
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
            None,
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
            None,
            Some(OsStr::new("/home/dev")),
            Some(OsStr::new("/Users/fallback")),
            None,
            None,
            false,
        )
        .unwrap();
        assert_eq!(resolved, PathBuf::from("/home/dev"));
    }

    #[test]
    fn windows_home_resolution_prefers_real_home_before_env_fallbacks() {
        let resolved = resolve_user_home_dir_from_values(
            Some(Path::new("C:\\Users\\real-user")),
            Some(OsStr::new("/msys64/home/dev")),
            Some(OsStr::new("C:\\Users\\wrong-userprofile")),
            Some(OsStr::new("D:")),
            Some(OsStr::new("\\Users\\wrong-homepath")),
            true,
        )
        .unwrap();
        assert_eq!(resolved, PathBuf::from("C:\\Users\\real-user"));
    }

    #[test]
    fn snapshot_falls_back_to_live_home_configs_when_user_settings_are_empty() {
        let dir = temp_dir("live-home-snapshot");
        let service = service_for(&dir);
        let workspace_root = create_workspace(&dir, "workspace-live");

        let codex_preset = codex_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != "codex-official" && preset.endpoint.is_some())
            .expect("expected codex preset with endpoint");
        let codex_endpoint = codex_preset.endpoint.clone().expect("codex endpoint");
        let codex_model = codex_preset.recommended_model.clone();

        let gemini_preset = gemini_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != "google-official" && preset.endpoint.is_some())
            .expect("expected gemini preset with endpoint");
        let gemini_endpoint = gemini_preset.endpoint.clone().expect("gemini endpoint");
        let gemini_model = gemini_preset.recommended_model.clone();
        let gemini_selected_type = gemini_preset.auth_mode.selected_type().to_string();
        let gemini_api_key = if gemini_preset.auth_mode == GeminiAuthMode::ApiKey
            || gemini_preset.requires_api_key
        {
            Some("gemini-test-key")
        } else {
            None
        };

        let claude_preset = claude_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != CLAUDE_OFFICIAL_PROVIDER_ID)
            .expect("expected claude preset");
        let claude_auth_key = claude_preset.auth_scheme.env_var_name().to_string();
        let claude_endpoint = claude_preset.endpoint.clone();
        let claude_model = claude_preset.recommended_model.clone();
        let claude_extra_env = claude_preset.extra_env.clone();

        let snapshot = with_test_home(&dir, |home| {
            write_codex_live_config(
                home,
                &codex_preset.name,
                &codex_endpoint,
                &codex_model,
                Some("codex-test-key"),
            );
            write_gemini_live_config(
                home,
                &gemini_selected_type,
                &gemini_endpoint,
                &gemini_model,
                gemini_api_key,
            );
            write_claude_live_config(
                home,
                &claude_auth_key,
                "claude-test-key",
                &claude_endpoint,
                &claude_model,
                &claude_extra_env,
            );

            service
                .read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(&workspace_root))
                .expect("snapshot should read live home config")
        });

        assert_eq!(
            snapshot.codex.config.active_mode,
            Some(CodexProviderMode::Preset)
        );
        assert_eq!(
            snapshot.codex.config.provider_id.as_deref(),
            Some(codex_preset.provider_id.as_str())
        );
        assert_eq!(
            snapshot.codex.config.base_url.as_deref(),
            Some(codex_endpoint.as_str())
        );
        assert!(snapshot.codex.config.has_secret);

        assert_eq!(
            snapshot.gemini.config.active_mode,
            Some(GeminiProviderMode::Preset)
        );
        assert_eq!(
            snapshot.gemini.config.provider_id.as_deref(),
            Some(gemini_preset.provider_id.as_str())
        );
        assert_eq!(
            snapshot.gemini.config.base_url.as_deref(),
            Some(gemini_endpoint.as_str())
        );
        assert_eq!(
            snapshot.gemini.config.selected_type.as_deref(),
            Some(gemini_selected_type.as_str())
        );

        assert_eq!(
            snapshot.claude.config.active_mode,
            Some(ClaudeProviderMode::Preset)
        );
        assert_eq!(
            snapshot.claude.config.provider_id.as_deref(),
            Some(claude_preset.provider_id.as_str())
        );
        assert_eq!(
            snapshot.claude.config.base_url.as_deref(),
            Some(claude_endpoint.as_str())
        );
        assert_eq!(
            snapshot.claude.config.model.as_deref(),
            Some(claude_model.as_str())
        );
        assert_eq!(
            snapshot.claude.config.auth_scheme,
            Some(claude_preset.auth_scheme)
        );
        assert!(snapshot.claude.config.has_secret);
    }

    #[test]
    fn snapshot_reads_live_home_configs_without_persisting_saved_provider_records_when_settings_are_empty(
    ) {
        let dir = temp_dir("live-home-import");
        let service = service_for(&dir);
        let workspace_root = create_workspace(&dir, "workspace-live-import");

        let codex_preset = codex_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != "codex-official" && preset.endpoint.is_some())
            .expect("expected codex preset with endpoint");
        let codex_endpoint = codex_preset.endpoint.clone().expect("codex endpoint");
        let codex_model = codex_preset.recommended_model.clone();

        let gemini_preset = gemini_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != "google-official" && preset.endpoint.is_some())
            .expect("expected gemini preset with endpoint");
        let gemini_endpoint = gemini_preset.endpoint.clone().expect("gemini endpoint");
        let gemini_model = gemini_preset.recommended_model.clone();
        let gemini_selected_type = gemini_preset.auth_mode.selected_type().to_string();
        let gemini_api_key = if gemini_preset.auth_mode == GeminiAuthMode::ApiKey
            || gemini_preset.requires_api_key
        {
            Some("gemini-import-key")
        } else {
            None
        };

        let claude_preset = claude_provider_presets()
            .into_iter()
            .find(|preset| preset.provider_id != CLAUDE_OFFICIAL_PROVIDER_ID)
            .expect("expected claude preset");
        let claude_auth_key = claude_preset.auth_scheme.env_var_name().to_string();
        let claude_endpoint = claude_preset.endpoint.clone();
        let claude_model = claude_preset.recommended_model.clone();
        let claude_extra_env = claude_preset.extra_env.clone();

        let snapshot = with_test_home(&dir, |home| {
            write_codex_live_config(
                home,
                &codex_preset.name,
                &codex_endpoint,
                &codex_model,
                Some("codex-import-key"),
            );
            write_gemini_live_config(
                home,
                &gemini_selected_type,
                &gemini_endpoint,
                &gemini_model,
                gemini_api_key,
            );
            write_claude_live_config(
                home,
                &claude_auth_key,
                "claude-import-key",
                &claude_endpoint,
                &claude_model,
                &claude_extra_env,
            );

            service
                .read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(&workspace_root))
                .expect("snapshot should read live home config without importing it")
        });

        assert!(snapshot.claude.saved_providers.is_empty());
        assert!(snapshot.codex.saved_providers.is_empty());
        assert!(snapshot.gemini.saved_providers.is_empty());
        assert!(snapshot.claude.config.saved_provider_id.is_none());
        assert!(snapshot.codex.config.saved_provider_id.is_none());
        assert!(snapshot.gemini.config.saved_provider_id.is_none());
        assert!(snapshot.claude.config.secret_ref.is_none());
        assert!(snapshot.codex.config.secret_ref.is_none());
        assert!(snapshot.gemini.config.secret_ref.is_none());

        let persisted_codex = service
            .read_codex_config(&workspace_root)
            .expect("codex settings should remain empty");
        assert!(persisted_codex.active_mode.is_none());
        assert!(persisted_codex.secret_ref.is_none());

        let persisted_gemini = service
            .read_gemini_config(&workspace_root)
            .expect("gemini settings should remain empty");
        assert!(persisted_gemini.active_mode.is_none());
        assert!(persisted_gemini.secret_ref.is_none());

        let persisted_claude = service
            .read_claude_config(&workspace_root)
            .expect("claude settings should remain empty");
        assert!(persisted_claude.active_mode.is_none());
        assert!(persisted_claude.secret_ref.is_none());

        assert!(service
            .list_saved_claude_providers(GLOBAL_AI_CONFIG_CONTEXT)
            .expect("claude saved providers should remain empty")
            .is_empty());
        assert!(service
            .list_saved_codex_providers()
            .expect("codex saved providers should remain empty")
            .is_empty());
        assert!(service
            .list_saved_gemini_providers()
            .expect("gemini saved providers should remain empty")
            .is_empty());
    }

    #[test]
    fn claude_workspace_mcp_status_is_true_for_current_workspace_entry() {
        let dir = temp_dir("claude-workspace-mcp");
        let home = create_test_home(&dir);
        let workspace_root = create_workspace(&dir, "workspace-a");

        write_claude_workspace_config(&home, &workspace_root);

        assert!(claude_status_for_home(&home, &workspace_root));
        assert!(agent_status_result(
            AiConfigAgent::Claude,
            &home,
            Some(&workspace_root)
        ));
    }

    #[test]
    fn claude_workspace_mcp_status_is_false_for_other_workspace_entry() {
        let dir = temp_dir("claude-other-workspace-mcp");
        let home = create_test_home(&dir);
        let workspace_a = create_workspace(&dir, "workspace-a");
        let workspace_b = create_workspace(&dir, "workspace-b");

        write_claude_workspace_configs(&home, &[&workspace_a]);

        assert!(claude_status_for_home(&home, &workspace_a));
        assert!(!claude_status_for_home(&home, &workspace_b));
        assert!(!agent_status_result(
            AiConfigAgent::Claude,
            &home,
            Some(&workspace_b)
        ));
    }

    #[test]
    fn claude_workspace_mcp_status_ignores_top_level_marker_only() {
        let dir = temp_dir("claude-top-level-only");
        let home = create_test_home(&dir);
        let workspace_root = create_workspace(&dir, "workspace-a");

        write_claude_top_level_marker_only(&home);

        assert!(!claude_status_for_home(&home, &workspace_root));
        assert!(!agent_status_result(
            AiConfigAgent::Claude,
            &home,
            Some(&workspace_root)
        ));
    }

    #[test]
    fn claude_workspace_mcp_status_is_false_for_invalid_json() {
        let dir = temp_dir("claude-invalid-json");
        let home = create_test_home(&dir);
        let workspace_root = create_workspace(&dir, "workspace-a");

        write_invalid_claude_json(&home);

        assert!(!claude_status_for_home(&home, &workspace_root));
        assert!(!agent_status_result(
            AiConfigAgent::Claude,
            &home,
            Some(&workspace_root)
        ));
    }

    #[test]
    fn codex_and_gemini_status_still_use_global_marker_files() {
        let dir = temp_dir("light-agents-global-marker");
        let home = create_test_home(&dir);

        write_codex_marker(&home);
        write_gemini_marker(&home);

        assert!(agent_status_result(AiConfigAgent::Codex, &home, None));
        assert!(agent_status_result(AiConfigAgent::Gemini, &home, None));
    }

    #[test]
    fn snapshot_does_not_treat_codex_marker_only_config_as_provider_setup() {
        let dir = temp_dir("codex-marker-only-snapshot");
        let service = service_for(&dir);
        let workspace_root = create_workspace(&dir, "workspace-marker-only");

        let snapshot = with_test_home(&dir, |home| {
            write_codex_marker(home);
            service
                .read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(&workspace_root))
                .unwrap()
        });

        assert!(snapshot.codex.config.active_mode.is_none());
        assert!(snapshot.codex.mcp_installed);
    }

    #[test]
    fn codex_apply_persists_global_settings_and_saved_provider_list() {
        let dir = temp_dir("codex-global-saved-provider");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("codex-global-saved-provider");

        with_test_home(&dir, |_home| {
            let (_, stored) = service
                .preview_codex_patch(
                    &workspace_id,
                    &workspace_root,
                    CodexDraftInput {
                        mode: CodexProviderMode::Official,
                        saved_provider_id: None,
                        provider_id: None,
                        provider_name: None,
                        base_url: None,
                        model: None,
                        api_key: None,
                        config_toml: None,
                    },
                )
                .unwrap();
            let stored = match stored {
                StoredAiConfigPreview::Codex(value) => value,
                _ => panic!("Expected Codex preview"),
            };

            let applied = service
                .apply_codex_preview(&workspace_id, &workspace_root, "tester", &stored)
                .unwrap();
            let effective_json = serde_json::to_value(&applied.effective).unwrap();
            let user_json = read_json_object_file(&dir.join("user-settings.json")).unwrap();

            assert_eq!(
                user_json
                    .pointer("/ai/providers/codex/providerId")
                    .and_then(Value::as_str),
                Some("codex-official")
            );
            assert!(
                !workspace_root.join(".gtoffice/config.json").exists(),
                "workspace config should stay untouched for global provider settings"
            );
            assert_eq!(
                effective_json
                    .pointer("/codex/savedProviders/0/providerId")
                    .and_then(Value::as_str),
                Some("codex-official")
            );
        });
    }

    #[test]
    fn gemini_apply_persists_global_settings_and_saved_provider_list() {
        let dir = temp_dir("gemini-global-saved-provider");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("gemini-global-saved-provider");

        with_test_home(&dir, |_home| {
            let (_, stored) = service
                .preview_gemini_patch(
                    &workspace_id,
                    &workspace_root,
                    GeminiDraftInput {
                        mode: GeminiProviderMode::Official,
                        saved_provider_id: None,
                        auth_mode: None,
                        provider_id: None,
                        provider_name: None,
                        base_url: None,
                        model: None,
                        api_key: None,
                        selected_type: None,
                    },
                )
                .unwrap();
            let stored = match stored {
                StoredAiConfigPreview::Gemini(value) => value,
                _ => panic!("Expected Gemini preview"),
            };

            let applied = service
                .apply_gemini_preview(&workspace_id, &workspace_root, "tester", &stored)
                .unwrap();
            let effective_json = serde_json::to_value(&applied.effective).unwrap();
            let user_json = read_json_object_file(&dir.join("user-settings.json")).unwrap();

            assert_eq!(
                user_json
                    .pointer("/ai/providers/gemini/providerId")
                    .and_then(Value::as_str),
                Some("google-official")
            );
            assert!(
                !workspace_root.join(".gtoffice/config.json").exists(),
                "workspace config should stay untouched for global provider settings"
            );
            assert_eq!(
                effective_json
                    .pointer("/gemini/savedProviders/0/providerId")
                    .and_then(Value::as_str),
                Some("google-official")
            );
        });
    }

    #[test]
    fn switching_saved_codex_provider_updates_global_active_config() {
        let dir = temp_dir("codex-switch-provider");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("codex-switch-provider");

        with_test_home(&dir, |_home| {
            for provider_id in ["codex-official", "openrouter"] {
                let (_, stored) = service
                    .preview_codex_patch(
                        &workspace_id,
                        &workspace_root,
                        CodexDraftInput {
                            mode: if provider_id == "codex-official" {
                                CodexProviderMode::Official
                            } else {
                                CodexProviderMode::Preset
                            },
                            saved_provider_id: None,
                            provider_id: if provider_id == "codex-official" {
                                None
                            } else {
                                Some(provider_id.to_string())
                            },
                            provider_name: None,
                            base_url: None,
                            model: None,
                            api_key: if provider_id == "codex-official" {
                                None
                            } else {
                                Some("openrouter-secret".to_string())
                            },
                            config_toml: None,
                        },
                    )
                    .unwrap();
                let stored = match stored {
                    StoredAiConfigPreview::Codex(value) => value,
                    _ => panic!("Expected Codex preview"),
                };
                service
                    .apply_codex_preview(&workspace_id, &workspace_root, "tester", &stored)
                    .unwrap();
            }

            let snapshot = service
                .read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, Some(&workspace_root))
                .unwrap();
            let saved_provider_id = snapshot
                .codex
                .saved_providers
                .iter()
                .find(|item| item.provider_id.as_deref() == Some("codex-official"))
                .map(|item| item.saved_provider_id.clone())
                .expect("codex official provider");

            let switched = service
                .switch_saved_provider(
                    AiConfigAgent::Codex,
                    Some(&workspace_root),
                    &saved_provider_id,
                    "tester",
                )
                .unwrap();
            assert_eq!(
                switched.effective.codex.config.saved_provider_id.as_deref(),
                Some(saved_provider_id.as_str())
            );
            assert_eq!(
                switched.effective.codex.config.provider_id.as_deref(),
                Some("codex-official")
            );
        });
    }

    #[test]
    fn deleting_last_gemini_provider_clears_global_active_config() {
        let dir = temp_dir("gemini-delete-provider");
        let workspace_root = dir.join("workspace");
        fs::create_dir_all(workspace_root.join(".gtoffice")).unwrap();
        let service = service_for(&dir);
        let workspace_id = workspace_id("gemini-delete-provider");

        with_test_home(&dir, |_home| {
            let (_, stored) = service
                .preview_gemini_patch(
                    &workspace_id,
                    &workspace_root,
                    GeminiDraftInput {
                        mode: GeminiProviderMode::Official,
                        saved_provider_id: None,
                        auth_mode: None,
                        provider_id: None,
                        provider_name: None,
                        base_url: None,
                        model: None,
                        api_key: None,
                        selected_type: None,
                    },
                )
                .unwrap();
            let stored = match stored {
                StoredAiConfigPreview::Gemini(value) => value,
                _ => panic!("Expected Gemini preview"),
            };
            let applied = service
                .apply_gemini_preview(&workspace_id, &workspace_root, "tester", &stored)
                .unwrap();
            let saved_provider_id = applied
                .effective
                .gemini
                .saved_providers
                .first()
                .map(|item| item.saved_provider_id.clone())
                .expect("saved gemini provider");

            let deleted = service
                .delete_saved_provider(
                    AiConfigAgent::Gemini,
                    Some(&workspace_root),
                    &saved_provider_id,
                    "tester",
                )
                .unwrap();

            assert!(deleted.applied);
            assert!(deleted.effective.gemini.saved_providers.is_empty());
            assert!(deleted.effective.gemini.config.saved_provider_id.is_none());
            assert!(deleted.effective.gemini.config.active_mode.is_none());
        });
    }
}
