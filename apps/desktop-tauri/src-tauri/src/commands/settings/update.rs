use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use tracing::{info, warn};

const DEFAULT_UPDATE_REPOSITORY: &str = "Laplace-bit/GT-Office";
const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://github.com/Laplace-bit/GT-Office/releases/latest/download/latest.json";
const DEFAULT_UPDATE_RELEASES_URL: &str = "https://github.com/Laplace-bit/GT-Office/releases";
const UPDATE_CHANNEL: &str = "stable";
const UPDATE_PROGRESS_EVENT: &str = "settings/update_progress";

#[derive(Debug, Clone)]
struct AppUpdateConfig {
    repository: String,
    manifest_url: String,
    releases_url: String,
    pubkey: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatusResponse {
    pub enabled: bool,
    pub current_version: String,
    pub channel: String,
    pub repository: String,
    pub manifest_url: String,
    pub releases_url: String,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResponse {
    pub enabled: bool,
    pub update_available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub target: Option<String>,
    pub repository: String,
    pub manifest_url: String,
    pub release_page_url: String,
    pub unavailable_reason: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResponse {
    pub enabled: bool,
    pub update_available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub repository: String,
    pub manifest_url: String,
    pub release_page_url: String,
    pub unavailable_reason: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub started: bool,
}

#[tauri::command]
pub fn settings_update_status(app: AppHandle) -> Result<AppUpdateStatusResponse, String> {
    let package = app.package_info();
    let config = resolve_update_config(&app);

    Ok(match config {
        Ok(config) => AppUpdateStatusResponse {
            enabled: true,
            current_version: package.version.to_string(),
            channel: UPDATE_CHANNEL.to_string(),
            repository: config.repository,
            manifest_url: config.manifest_url,
            releases_url: config.releases_url,
            unavailable_reason: None,
        },
        Err(reason) => AppUpdateStatusResponse {
            enabled: false,
            current_version: package.version.to_string(),
            channel: UPDATE_CHANNEL.to_string(),
            repository: DEFAULT_UPDATE_REPOSITORY.to_string(),
            manifest_url: DEFAULT_UPDATE_MANIFEST_URL.to_string(),
            releases_url: DEFAULT_UPDATE_RELEASES_URL.to_string(),
            unavailable_reason: Some(reason),
        },
    })
}

#[tauri::command]
pub async fn settings_update_check(app: AppHandle) -> Result<AppUpdateCheckResponse, String> {
    let package = app.package_info();
    let current_version = package.version.to_string();
    let config = match resolve_update_config(&app) {
        Ok(config) => config,
        Err(reason) => {
            return Ok(AppUpdateCheckResponse {
                enabled: false,
                update_available: false,
                current_version,
                version: None,
                notes: None,
                published_at: None,
                target: None,
                repository: DEFAULT_UPDATE_REPOSITORY.to_string(),
                manifest_url: DEFAULT_UPDATE_MANIFEST_URL.to_string(),
                release_page_url: DEFAULT_UPDATE_RELEASES_URL.to_string(),
                unavailable_reason: Some(reason),
                error_code: None,
                error_detail: None,
            })
        }
    };

    let updater = build_updater(&app, &config).map_err(|error| {
        warn!(error = %error, "failed to build updater");
        error
    })?;
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            Ok(AppUpdateCheckResponse {
                enabled: true,
                update_available: true,
                current_version,
                version: Some(version.clone()),
                notes: update.body.clone(),
                published_at: update.date.map(|date| date.to_string()),
                target: Some(update.target.clone()),
                repository: config.repository.clone(),
                manifest_url: config.manifest_url.clone(),
                release_page_url: build_release_page_url(&config, Some(version.as_str())),
                unavailable_reason: None,
                error_code: None,
                error_detail: None,
            })
        }
        Ok(None) => Ok(AppUpdateCheckResponse {
            enabled: true,
            update_available: false,
            current_version,
            version: None,
            notes: None,
            published_at: None,
            target: None,
            repository: config.repository.clone(),
            manifest_url: config.manifest_url.clone(),
            release_page_url: config.releases_url.clone(),
            unavailable_reason: None,
            error_code: None,
            error_detail: None,
        }),
        Err(error) => {
            let error_code = update_error_code(&error);
            warn!(error = %error, error_code, "update check failed");
            Ok(AppUpdateCheckResponse {
                enabled: true,
                update_available: false,
                current_version,
                version: None,
                notes: None,
                published_at: None,
                target: None,
                repository: config.repository.clone(),
                manifest_url: config.manifest_url.clone(),
                release_page_url: config.releases_url.clone(),
                unavailable_reason: None,
                error_code: Some(error_code.to_string()),
                error_detail: Some(error.to_string()),
            })
        }
    }
}

#[tauri::command]
pub async fn settings_update_download_and_install(
    app: AppHandle,
) -> Result<AppUpdateInstallResponse, String> {
    let package = app.package_info();
    let current_version = package.version.to_string();
    let config = match resolve_update_config(&app) {
        Ok(config) => config,
        Err(reason) => {
            return Ok(AppUpdateInstallResponse {
                enabled: false,
                update_available: false,
                current_version,
                version: None,
                repository: DEFAULT_UPDATE_REPOSITORY.to_string(),
                manifest_url: DEFAULT_UPDATE_MANIFEST_URL.to_string(),
                release_page_url: DEFAULT_UPDATE_RELEASES_URL.to_string(),
                unavailable_reason: Some(reason),
                error_code: None,
                error_detail: None,
                started: false,
            })
        }
    };

    let updater = build_updater(&app, &config).map_err(|error| {
        warn!(error = %error, "failed to build updater");
        error
    })?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(AppUpdateInstallResponse {
            enabled: true,
            update_available: false,
            current_version,
            version: None,
            repository: config.repository.clone(),
            manifest_url: config.manifest_url.clone(),
            release_page_url: config.releases_url.clone(),
            unavailable_reason: None,
            error_code: None,
            error_detail: None,
            started: false,
        });
    };

    let version = update.version.clone();
    let release_page_url = build_release_page_url(&config, Some(version.as_str()));
    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        json!({
            "stage": "started",
            "version": version,
            "downloadedBytes": 0_u64,
            "contentLength": null,
            "detail": null,
        }),
    );
    let version_for_progress = update.version.clone();
    let app_for_progress = app.clone();
    let install_result = update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_for_progress.emit(
                    UPDATE_PROGRESS_EVENT,
                    json!({
                        "stage": "progress",
                        "version": version_for_progress,
                        "downloadedBytes": chunk_length as u64,
                        "contentLength": content_length,
                        "detail": null,
                    }),
                );
            },
            {
                let app_for_finish = app.clone();
                let version_for_finish = update.version.clone();
                move || {
                    let _ = app_for_finish.emit(
                        UPDATE_PROGRESS_EVENT,
                        json!({
                            "stage": "verifying",
                            "version": version_for_finish,
                            "downloadedBytes": 0_u64,
                            "contentLength": null,
                            "detail": null,
                        }),
                    );
                }
            },
        )
        .await;

    match install_result {
        Ok(()) => {
            info!(version = %update.version, "update download and install completed");
            let _ = app.emit(
                UPDATE_PROGRESS_EVENT,
                json!({
                    "stage": "finished",
                    "version": update.version,
                    "downloadedBytes": 0_u64,
                    "contentLength": null,
                    "detail": null,
                }),
            );
            Ok(AppUpdateInstallResponse {
                enabled: true,
                update_available: true,
                current_version,
                version: Some(version),
                repository: config.repository,
                manifest_url: config.manifest_url,
                release_page_url,
                unavailable_reason: None,
                error_code: None,
                error_detail: None,
                started: true,
            })
        }
        Err(error) => {
            let error_code = update_error_code(&error).to_string();
            warn!(error = %error, error_code, "update install failed");
            let _ = app.emit(
                UPDATE_PROGRESS_EVENT,
                json!({
                    "stage": "error",
                    "version": version,
                    "downloadedBytes": 0_u64,
                    "contentLength": null,
                    "detail": error.to_string(),
                }),
            );
            Ok(AppUpdateInstallResponse {
                enabled: true,
                update_available: true,
                current_version,
                version: Some(version),
                repository: config.repository,
                manifest_url: config.manifest_url,
                release_page_url,
                unavailable_reason: None,
                error_code: Some(error_code),
                error_detail: Some(error.to_string()),
                started: false,
            })
        }
    }
}

fn build_updater(
    app: &AppHandle,
    config: &AppUpdateConfig,
) -> Result<tauri_plugin_updater::Updater, String> {
    let updater_builder = app
        .updater_builder()
        .pubkey(config.pubkey.clone())
        .endpoints(vec![config.manifest_url.parse().map_err(|error| {
            format!("invalid updater manifest url: {error}")
        })?])
        .map_err(|error| format!("invalid updater endpoints: {error}"))?;
    updater_builder
        .build()
        .map_err(|error| format!("failed to initialize updater: {error}"))
}

fn resolve_update_config(app: &AppHandle) -> Result<AppUpdateConfig, String> {
    let repository = std::env::var("GTO_UPDATE_REPOSITORY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_REPOSITORY.to_string());
    let manifest_url = std::env::var("GTO_UPDATE_MANIFEST_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_MANIFEST_URL.to_string());
    let releases_url = std::env::var("GTO_UPDATE_RELEASES_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_RELEASES_URL.to_string());
    let pubkey = std::env::var("GTO_UPDATER_PUBKEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            option_env!("GTO_UPDATER_PUBKEY")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| resolve_pubkey_from_config(app))
        .ok_or_else(|| "UPDATER_PUBKEY_MISSING".to_string())?;

    Ok(AppUpdateConfig {
        repository,
        manifest_url,
        releases_url,
        pubkey,
    })
}

fn resolve_pubkey_from_config(app: &AppHandle) -> Option<String> {
    let config = app.config();
    let updater_config = config.plugins.0.get("updater")?;
    let pubkey = updater_config.get("pubkey")?;
    pubkey.as_str().map(str::trim).filter(|v| !v.is_empty()).map(ToOwned::to_owned)
}

fn build_release_page_url(config: &AppUpdateConfig, version: Option<&str>) -> String {
    version
        .filter(|value| !value.is_empty())
        .map(|value| format!("{}/tag/v{}", config.releases_url, value))
        .unwrap_or_else(|| config.releases_url.clone())
}

fn update_error_code(error: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;

    match error {
        Error::EmptyEndpoints => "UPDATE_ENDPOINTS_EMPTY",
        Error::ReleaseNotFound => "UPDATE_RELEASE_NOT_FOUND",
        Error::UnsupportedArch => "UPDATE_UNSUPPORTED_ARCH",
        Error::UnsupportedOs => "UPDATE_UNSUPPORTED_OS",
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "UPDATE_TARGET_NOT_FOUND",
        Error::Network(_) | Error::Reqwest(_) => "UPDATE_NETWORK_FAILED",
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "UPDATE_SIGNATURE_INVALID"
        }
        Error::AuthenticationFailed => "UPDATE_AUTH_FAILED",
        Error::DebInstallFailed | Error::PackageInstallFailed => "UPDATE_INSTALL_FAILED",
        Error::InvalidUpdaterFormat | Error::BinaryNotFoundInArchive => "UPDATE_PACKAGE_INVALID",
        Error::InsecureTransportProtocol => "UPDATE_INSECURE_TRANSPORT",
        _ => "UPDATE_UNKNOWN_ERROR",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_updater::Error;

    fn sample_config() -> AppUpdateConfig {
        AppUpdateConfig {
            repository: "Laplace-bit/GT-Office".to_string(),
            manifest_url: "https://example.com/latest.json".to_string(),
            releases_url: "https://github.com/Laplace-bit/GT-Office/releases".to_string(),
            pubkey: "test-pubkey".to_string(),
        }
    }

    #[test]
    fn build_release_page_url_prefers_tag_url_when_version_exists() {
        let config = sample_config();
        assert_eq!(
            build_release_page_url(&config, Some("0.1.6")),
            "https://github.com/Laplace-bit/GT-Office/releases/tag/v0.1.6"
        );
    }

    #[test]
    fn build_release_page_url_falls_back_to_release_index() {
        let config = sample_config();
        assert_eq!(
            build_release_page_url(&config, None),
            "https://github.com/Laplace-bit/GT-Office/releases"
        );
        assert_eq!(
            build_release_page_url(&config, Some("")),
            "https://github.com/Laplace-bit/GT-Office/releases"
        );
    }

    #[test]
    fn update_error_code_maps_common_updater_failures() {
        assert_eq!(
            update_error_code(&Error::EmptyEndpoints),
            "UPDATE_ENDPOINTS_EMPTY"
        );
        assert_eq!(
            update_error_code(&Error::UnsupportedArch),
            "UPDATE_UNSUPPORTED_ARCH"
        );
        assert_eq!(
            update_error_code(&Error::TargetNotFound("darwin-aarch64".to_string())),
            "UPDATE_TARGET_NOT_FOUND"
        );
        assert_eq!(
            update_error_code(&Error::Network("network failed".to_string())),
            "UPDATE_NETWORK_FAILED"
        );
    }
}
