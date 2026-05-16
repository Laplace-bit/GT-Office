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
        update_error_code(&Error::ReleaseNotFound),
        "UPDATE_RELEASE_NOT_FOUND"
    );
    assert_eq!(
        update_error_code(&Error::UnsupportedArch),
        "UPDATE_UNSUPPORTED_ARCH"
    );
    assert_eq!(
        update_error_code(&Error::UnsupportedOs),
        "UPDATE_UNSUPPORTED_OS"
    );
    assert_eq!(
        update_error_code(&Error::TargetNotFound("darwin-aarch64".to_string())),
        "UPDATE_TARGET_NOT_FOUND"
    );
    assert_eq!(
        update_error_code(&Error::TargetsNotFound(vec![
            "darwin-aarch64".to_string(),
            "darwin-x86_64".to_string(),
        ])),
        "UPDATE_TARGET_NOT_FOUND"
    );
    assert_eq!(
        update_error_code(&Error::Network("network failed".to_string())),
        "UPDATE_NETWORK_FAILED"
    );
    assert_eq!(
        update_error_code(&Error::SignatureUtf8("bad signature".to_string())),
        "UPDATE_SIGNATURE_INVALID"
    );
    assert_eq!(
        update_error_code(&Error::AuthenticationFailed),
        "UPDATE_AUTH_FAILED"
    );
    assert_eq!(
        update_error_code(&Error::DebInstallFailed),
        "UPDATE_INSTALL_FAILED"
    );
    assert_eq!(
        update_error_code(&Error::PackageInstallFailed),
        "UPDATE_INSTALL_FAILED"
    );
    assert_eq!(
        update_error_code(&Error::InvalidUpdaterFormat),
        "UPDATE_PACKAGE_INVALID"
    );
    assert_eq!(
        update_error_code(&Error::BinaryNotFoundInArchive),
        "UPDATE_PACKAGE_INVALID"
    );
    assert_eq!(
        update_error_code(&Error::InsecureTransportProtocol),
        "UPDATE_INSECURE_TRANSPORT"
    );
    assert_eq!(
        update_error_code(&Error::TempDirNotFound),
        "UPDATE_UNKNOWN_ERROR"
    );
}
