use std::{
    env,
    path::{Path, PathBuf},
};

use gt_ai_config::{
    claude_provider_presets, codex_provider_presets, gemini_provider_presets, AiConfigAgent,
    AiConfigApplyResponse, AiConfigDraftInput, AiConfigService, ClaudeAuthScheme, ClaudeDraftInput,
    ClaudeProviderMode, CodexDraftInput, CodexProviderMode, GeminiAuthMode, GeminiDraftInput,
    GeminiProviderMode,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::{
    app_state::AppState,
    commands::settings::ai_config::{
        resolve_ai_config_service, resolve_ai_workspace_root, GLOBAL_AI_CONFIG_CONTEXT,
    },
};

#[tauri::command]
pub fn ai_config_import_current(
    workspace_id: Option<String>,
    agent: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AiConfigApplyResponse, String> {
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let root_ref = workspace_root.as_deref().unwrap_or_else(|| Path::new(""));
    let service = resolve_ai_config_service(&app, &state)?;
    let agent = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;
    let draft = import_current_draft(agent, &service)?;

    let _ = state.invalidate_all_ai_config_snapshot_cache();

    let response = match draft {
        AiConfigDraftInput::Claude(draft) => {
            let (_, stored) = service
                .preview_claude_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, "global", draft)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?;
            let gt_ai_config::StoredAiConfigPreview::Claude(stored) = stored else {
                return Err(
                    "AI_CONFIG_IMPORT_FAILED: unexpected Claude preview payload".to_string()
                );
            };
            service
                .apply_claude_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, &stored)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?
        }
        AiConfigDraftInput::Codex(draft) => {
            let (_, stored) = service
                .preview_codex_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, draft)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?;
            let gt_ai_config::StoredAiConfigPreview::Codex(stored) = stored else {
                return Err("AI_CONFIG_IMPORT_FAILED: unexpected Codex preview payload".to_string());
            };
            service
                .apply_codex_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, &stored)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?
        }
        AiConfigDraftInput::Gemini(draft) => {
            let (_, stored) = service
                .preview_gemini_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, draft)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?;
            let gt_ai_config::StoredAiConfigPreview::Gemini(stored) = stored else {
                return Err(
                    "AI_CONFIG_IMPORT_FAILED: unexpected Gemini preview payload".to_string()
                );
            };
            service
                .apply_gemini_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, &stored)
                .map_err(|error: gt_ai_config::AiConfigError| error.to_string())?
        }
    };

    let _ = app.emit(
        "ai_config/changed",
        serde_json::json!({
            "auditId": response.audit_id,
            "scope": GLOBAL_AI_CONFIG_CONTEXT,
            "changedKeys": [],
        }),
    );

    Ok(response)
}

fn import_current_draft(
    agent: AiConfigAgent,
    _service: &AiConfigService,
) -> Result<AiConfigDraftInput, String> {
    let home = user_home_dir().ok_or_else(|| {
        "AI_CONFIG_IMPORT_FAILED: unable to resolve user home directory".to_string()
    })?;
    match agent {
        AiConfigAgent::Claude => read_live_claude_draft(&home).map(AiConfigDraftInput::Claude),
        AiConfigAgent::Codex => read_live_codex_draft(&home).map(AiConfigDraftInput::Codex),
        AiConfigAgent::Gemini => read_live_gemini_draft(&home).map(AiConfigDraftInput::Gemini),
    }
}

fn read_live_claude_draft(home: &Path) -> Result<ClaudeDraftInput, String> {
    let settings_path = home.join(".claude").join("settings.json");
    let raw = std::fs::read_to_string(&settings_path).map_err(|error| {
        format!(
            "AI_CONFIG_IMPORT_FAILED: failed to read {}: {error}",
            settings_path.display()
        )
    })?;
    let root: Value = serde_json::from_str(&raw).map_err(|error| {
        format!("AI_CONFIG_IMPORT_FAILED: invalid Claude settings.json: {error}")
    })?;
    let env = root.get("env").and_then(Value::as_object).ok_or_else(|| {
        "AI_CONFIG_IMPORT_FAILED: Claude settings.json is missing env".to_string()
    })?;

    let auth_token = read_env_string(env, "ANTHROPIC_AUTH_TOKEN");
    let api_key = read_env_string(env, "ANTHROPIC_API_KEY");
    let auth_scheme = if auth_token.is_some() {
        Some(ClaudeAuthScheme::AnthropicAuthToken)
    } else if api_key.is_some() {
        Some(ClaudeAuthScheme::AnthropicApiKey)
    } else {
        None
    };
    let secret = auth_token.or(api_key);
    let base_url = read_env_string(env, "ANTHROPIC_BASE_URL")
        .as_deref()
        .map(normalize_endpoint);
    let model = read_env_string(env, "ANTHROPIC_MODEL");

    if let Some(base_url) = base_url {
        if let Some(preset) = claude_provider_presets()
            .into_iter()
            .find(|preset| normalize_endpoint(&preset.endpoint) == base_url)
        {
            return Ok(ClaudeDraftInput {
                mode: ClaudeProviderMode::Preset,
                saved_provider_id: None,
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                auth_scheme: auth_scheme.or(Some(preset.auth_scheme)),
                api_key: secret,
                api_format: None,
                model_overrides: None,
            });
        }

        return Ok(ClaudeDraftInput {
            mode: ClaudeProviderMode::Custom,
            saved_provider_id: None,
            provider_id: None,
            provider_name: Some("Custom Gateway".to_string()),
            base_url: Some(base_url),
            model,
            auth_scheme,
            api_key: secret,
            api_format: None,
            model_overrides: None,
        });
    }

    let Some(secret) = secret else {
        return Err("AI_CONFIG_IMPORT_FAILED: no Claude provider configuration found in ~/.claude/settings.json".to_string());
    };

    Ok(ClaudeDraftInput {
        mode: ClaudeProviderMode::Official,
        saved_provider_id: None,
        provider_id: None,
        provider_name: None,
        base_url: None,
        model: None,
        auth_scheme: None,
        api_key: Some(secret),
        api_format: None,
        model_overrides: None,
    })
}

fn read_live_codex_draft(home: &Path) -> Result<CodexDraftInput, String> {
    let config_path = home.join(".codex").join("config.toml");
    let auth_path = home.join(".codex").join("auth.json");
    let config_text = std::fs::read_to_string(&config_path).unwrap_or_default();
    let auth = std::fs::read_to_string(&auth_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let api_key = auth
        .as_ref()
        .and_then(|value| value.get("OPENAI_API_KEY"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let config_table = if config_text.trim().is_empty() {
        None
    } else {
        Some(
            toml::from_str::<toml::Table>(&config_text).map_err(|error| {
                format!("AI_CONFIG_IMPORT_FAILED: invalid Codex config.toml: {error}")
            })?,
        )
    };
    let provider_key = config_table
        .as_ref()
        .and_then(|table| table.get("model_provider"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let model = config_table
        .as_ref()
        .and_then(|table| table.get("model"))
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
            .map(normalize_endpoint)
            .or_else(|| {
                table
                    .get("base_url")
                    .and_then(|value| value.as_str())
                    .map(normalize_endpoint)
            })
    });

    if let Some(base_url) = base_url {
        if let Some(preset) = codex_provider_presets().into_iter().find(|preset| {
            preset
                .endpoint
                .as_deref()
                .map(normalize_endpoint)
                .as_deref()
                == Some(base_url.as_str())
        }) {
            return Ok(CodexDraftInput {
                mode: CodexProviderMode::Preset,
                saved_provider_id: None,
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                api_key,
                config_toml: (!config_text.trim().is_empty()).then_some(config_text),
            });
        }

        return Ok(CodexDraftInput {
            mode: CodexProviderMode::Custom,
            saved_provider_id: None,
            provider_id: None,
            provider_name: Some(
                provider_key
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| value.replace('_', " "))
                    .unwrap_or_else(|| "Custom Gateway".to_string()),
            ),
            base_url: Some(base_url),
            model,
            api_key,
            config_toml: (!config_text.trim().is_empty()).then_some(config_text),
        });
    }

    if api_key.is_none() && model.is_none() {
        return Err(
            "AI_CONFIG_IMPORT_FAILED: no Codex provider configuration found in ~/.codex"
                .to_string(),
        );
    }

    Ok(CodexDraftInput {
        mode: CodexProviderMode::Official,
        saved_provider_id: None,
        provider_id: None,
        provider_name: None,
        base_url: None,
        model: None,
        api_key,
        config_toml: (!config_text.trim().is_empty()).then_some(config_text),
    })
}

fn read_live_gemini_draft(home: &Path) -> Result<GeminiDraftInput, String> {
    let env_path = home.join(".gemini").join(".env");
    let settings_path = home.join(".gemini").join("settings.json");
    let env = parse_simple_env_file(&env_path);
    let settings = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
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
        .map(|value| normalize_endpoint(value));
    let model = env
        .get("GEMINI_MODEL")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let api_key = env
        .get("GEMINI_API_KEY")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(base_url) = base_url {
        if let Some(preset) = gemini_provider_presets().into_iter().find(|preset| {
            preset
                .endpoint
                .as_deref()
                .map(normalize_endpoint)
                .as_deref()
                == Some(base_url.as_str())
                && (selected_type.as_deref() == Some(preset.selected_type.as_str())
                    || auth_mode == preset.auth_mode)
        }) {
            return Ok(GeminiDraftInput {
                mode: GeminiProviderMode::Preset,
                saved_provider_id: None,
                auth_mode: Some(auth_mode.clone()),
                provider_id: Some(preset.provider_id),
                provider_name: Some(preset.name),
                base_url: Some(base_url),
                model: model.or(Some(preset.recommended_model)),
                api_key,
                selected_type: selected_type.or(Some(auth_mode.selected_type().to_string())),
            });
        }

        return Ok(GeminiDraftInput {
            mode: GeminiProviderMode::Custom,
            saved_provider_id: None,
            auth_mode: Some(auth_mode.clone()),
            provider_id: None,
            provider_name: Some("Custom Gateway".to_string()),
            base_url: Some(base_url),
            model,
            api_key,
            selected_type: selected_type.or(Some(auth_mode.selected_type().to_string())),
        });
    }

    if api_key.is_none() && model.is_none() {
        return Err(
            "AI_CONFIG_IMPORT_FAILED: no Gemini provider configuration found in ~/.gemini"
                .to_string(),
        );
    }

    Ok(GeminiDraftInput {
        mode: GeminiProviderMode::Official,
        saved_provider_id: None,
        auth_mode: None,
        provider_id: None,
        provider_name: None,
        base_url: None,
        model: None,
        api_key,
        selected_type: None,
    })
}

fn user_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
}

fn read_env_string(env: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    env.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_endpoint(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn parse_simple_env_file(path: &Path) -> std::collections::BTreeMap<String, String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return std::collections::BTreeMap::new();
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
