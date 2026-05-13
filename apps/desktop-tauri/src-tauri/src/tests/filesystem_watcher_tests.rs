use super::{
    is_git_metadata_path_of_interest, map_event_kind, normalize_event_paths,
    should_ignore_relative_path, should_invalidate_repository_cache, should_schedule_git_refresh,
};
use gt_settings::FilesystemWatcherSettings;
use notify::{event::ModifyKind, Event, EventKind};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

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

#[test]
fn git_metadata_interest_detects_head_and_refs() {
    assert!(is_git_metadata_path_of_interest(".git/HEAD"));
    assert!(is_git_metadata_path_of_interest("packages/alpha/.git/HEAD"));
    assert!(is_git_metadata_path_of_interest(".git/refs/heads/main"));
    assert!(is_git_metadata_path_of_interest(
        "packages/alpha/.git/refs/heads/main"
    ));
    assert!(!is_git_metadata_path_of_interest(".git/config"));
}

#[test]
fn schedule_git_refresh_on_worktree_and_git_head_changes() {
    let root = Path::new("/tmp/workspace");
    let settings = FilesystemWatcherSettings::default();
    assert!(should_schedule_git_refresh(
        root,
        &[root.join("src/main.rs")],
        &settings
    ));
    assert!(should_schedule_git_refresh(
        root,
        &[root.join(".git/HEAD")],
        &settings
    ));
    assert!(should_schedule_git_refresh(
        root,
        &[root.join("packages/alpha/.git/HEAD")],
        &settings
    ));
    assert!(!should_schedule_git_refresh(
        root,
        &[root.join("node_modules/react/index.js")],
        &settings
    ));
}

#[test]
fn repository_cache_invalidation_is_reserved_for_repo_topology_changes() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    let root_buf = std::env::temp_dir().join(format!("gto-fs-watcher-{unique}"));
    fs::create_dir_all(&root_buf).expect("temp root should be created");
    let root = root_buf.as_path();

    let regular_file_change = Event {
        kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        paths: vec![root.join("src/main.rs")],
        attrs: Default::default(),
    };
    assert!(!should_invalidate_repository_cache(
        root,
        &regular_file_change
    ));

    let git_metadata_change = Event {
        kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        paths: vec![root.join("packages/alpha/.git/HEAD")],
        attrs: Default::default(),
    };
    assert!(!should_invalidate_repository_cache(
        root,
        &git_metadata_change
    ));

    let nested_repo_created = Event {
        kind: EventKind::Create(notify::event::CreateKind::Folder),
        paths: vec![root.join("packages/alpha/.git")],
        attrs: Default::default(),
    };
    assert!(should_invalidate_repository_cache(
        root,
        &nested_repo_created
    ));

    fs::create_dir_all(root.join("packages/beta/.git"))
        .expect("nested repo rename target should exist");
    let nested_repo_renamed = Event {
        kind: EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::Both)),
        paths: vec![root.join("packages/alpha"), root.join("packages/beta")],
        attrs: Default::default(),
    };
    assert!(should_invalidate_repository_cache(
        root,
        &nested_repo_renamed
    ));

    let _ = fs::remove_dir_all(root);
}
