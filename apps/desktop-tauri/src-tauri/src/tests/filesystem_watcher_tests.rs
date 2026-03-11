use super::{map_event_kind, normalize_event_paths, should_ignore_relative_path};
use notify::EventKind;
use std::path::Path;
use vb_settings::FilesystemWatcherSettings;

#[test]
fn map_event_kind_maps_rename_to_renamed() {
    let kind = EventKind::Modify(notify::event::ModifyKind::Name(
        notify::event::RenameMode::Both,
    ));
    assert_eq!(map_event_kind(&kind), Some("renamed"));
}

#[test]
fn normalize_paths_keeps_only_workspace_relative_entries() {
    let root = Path::new("/tmp/workspace");
    let settings = FilesystemWatcherSettings::default();
    let paths = vec![
        root.join("src/main.rs"),
        root.join("src/main.rs"),
        root.join(".git/index.lock"),
        Path::new("/tmp/outside.txt").to_path_buf(),
    ];
    let normalized = normalize_event_paths(root, &paths, &settings);
    assert_eq!(normalized, vec!["src/main.rs".to_string()]);
}

#[test]
fn ignore_path_detects_noise_directories_and_temp_files() {
    let settings = FilesystemWatcherSettings::default();
    assert!(should_ignore_relative_path(
        "node_modules/react/index.js",
        &settings
    ));
    assert!(should_ignore_relative_path(".git/index.lock", &settings));
    assert!(should_ignore_relative_path("src/main.rs.swp", &settings));
    assert!(!should_ignore_relative_path("src/main.rs", &settings));
}
