use vb_settings::{
    default_user_settings_path, JsonSettingsService, SettingsPaths,
    DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES, DEFAULT_FS_FULL_READ_HARD_MAX_BYTES,
    DEFAULT_FS_PREVIEW_MAX_BYTES,
};
use serde_json::json;
use std::{fs, path::PathBuf, time::SystemTime};
use vb_abstractions::SettingsScope;

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn create(prefix: &str) -> Self {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{}-{ts}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        Self { path: dir }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn default_user_settings_path_is_non_empty() {
    let path = default_user_settings_path();
    assert!(!path.as_os_str().is_empty());
}

#[test]
fn effective_settings_merge_default_user_workspace_and_session() {
    let temp = TempDir::create("vb-settings-merge");
    let workspace_root = temp.path.join("workspace");
    fs::create_dir_all(&workspace_root).expect("create workspace root");

    let user_file = temp.path.join("user/settings.json");
    let paths = SettingsPaths::new(user_file, PathBuf::from(".gtoffice/config.json"));
    let service = JsonSettingsService::new(paths);

    service
        .update(
            SettingsScope::User,
            None,
            &json!({
                "filesystem": {
                    "preview": {
                        "maxBytes": 131072
                    }
                }
            }),
        )
        .expect("update user settings");

    service
        .update(
            SettingsScope::Workspace,
            Some(workspace_root.as_path()),
            &json!({
                "filesystem": {
                    "preview": {
                        "fullReadDefaultMaxBytes": 1048576
                    }
                }
            }),
        )
        .expect("update workspace settings");

    service
        .update(
            SettingsScope::Session,
            Some(workspace_root.as_path()),
            &json!({
                "filesystem": {
                    "watcher": {
                        "pollIntervalMs": 500
                    }
                }
            }),
        )
        .expect("update session settings");

    let effective = service
        .load_effective(Some(workspace_root.as_path()))
        .expect("load effective settings");

    assert_eq!(
        effective.values["filesystem"]["preview"]["maxBytes"],
        json!(131072)
    );
    assert_eq!(
        effective.values["filesystem"]["preview"]["fullReadDefaultMaxBytes"],
        json!(1048576)
    );
    assert_eq!(
        effective.values["filesystem"]["watcher"]["pollIntervalMs"],
        json!(500)
    );
}

#[test]
fn reset_key_restores_default_effective_value() {
    let temp = TempDir::create("vb-settings-reset");
    let user_file = temp.path.join("user/settings.json");
    let paths = SettingsPaths::new(user_file.clone(), PathBuf::from(".gtoffice/config.json"));
    let service = JsonSettingsService::new(paths);

    service
        .update(
            SettingsScope::User,
            None,
            &json!({
                "filesystem": {
                    "preview": {
                        "maxBytes": 128000,
                        "fullReadDefaultMaxBytes": 129000,
                        "fullReadHardMaxBytes": 200000
                    }
                }
            }),
        )
        .expect("update user settings");

    let runtime_before = service.load_runtime(None).expect("runtime before reset");
    assert_eq!(runtime_before.filesystem.preview.max_bytes, 128000);

    service
        .reset(
            SettingsScope::User,
            None,
            &["filesystem.preview.maxBytes".to_string()],
        )
        .expect("reset max bytes key");

    let runtime_after = service.load_runtime(None).expect("runtime after reset");
    assert_eq!(
        runtime_after.filesystem.preview.max_bytes,
        DEFAULT_FS_PREVIEW_MAX_BYTES
    );
    assert_eq!(
        runtime_after.filesystem.preview.full_read_default_max_bytes,
        DEFAULT_FS_PREVIEW_MAX_BYTES
    );
    assert_eq!(
        runtime_after.filesystem.preview.full_read_hard_max_bytes,
        DEFAULT_FS_PREVIEW_MAX_BYTES
    );

    let raw = fs::read_to_string(user_file).expect("user settings exists");
    assert!(raw.contains("fullReadDefaultMaxBytes"));
    assert!(!raw.contains("\"maxBytes\": 128000"));
}

#[test]
fn runtime_settings_are_normalized() {
    let temp = TempDir::create("vb-settings-runtime");
    let user_file = temp.path.join("user/settings.json");
    let paths = SettingsPaths::new(user_file, PathBuf::from(".gtoffice/config.json"));
    let service = JsonSettingsService::new(paths);

    service
        .update(
            SettingsScope::User,
            None,
            &json!({
                "filesystem": {
                    "preview": {
                        "maxBytes": 500000,
                        "fullReadDefaultMaxBytes": 100,
                        "fullReadHardMaxBytes": 100
                    }
                }
            }),
        )
        .expect("update preview settings");

    let runtime = service.load_runtime(None).expect("load runtime");
    assert_eq!(runtime.filesystem.preview.max_bytes, 500000);
    assert_eq!(
        runtime.filesystem.preview.full_read_default_max_bytes,
        runtime.filesystem.preview.max_bytes
    );
    assert_eq!(
        runtime.filesystem.preview.full_read_hard_max_bytes,
        runtime.filesystem.preview.full_read_default_max_bytes
    );

    assert!(DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES > DEFAULT_FS_PREVIEW_MAX_BYTES);
    assert!(DEFAULT_FS_FULL_READ_HARD_MAX_BYTES >= DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES);
}
