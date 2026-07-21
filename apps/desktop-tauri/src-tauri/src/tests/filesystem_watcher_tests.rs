use super::{
    flush_pending_watch_events, is_git_metadata_path_of_interest, map_event_kind,
    normalize_event_paths, should_ignore_relative_path, should_invalidate_repository_cache,
    should_schedule_git_refresh, PendingWatchEvents, WorkspaceWatcherRegistryState,
};
use gt_settings::FilesystemWatcherSettings;
use notify::{event::ModifyKind, Event, EventKind};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{test::mock_app, Listener};
use tokio_util::sync::CancellationToken;

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
fn git_metadata_interest_detects_submodule_gitdir_changes() {
    assert!(is_git_metadata_path_of_interest(
        ".git/modules/packages/alpha/HEAD"
    ));
    assert!(is_git_metadata_path_of_interest(
        ".git/modules/packages/alpha/index"
    ));
    assert!(is_git_metadata_path_of_interest(
        ".git/modules/packages/alpha/refs/heads/main"
    ));
    assert!(is_git_metadata_path_of_interest(
        ".git/modules/packages/alpha/refs/tags/v1"
    ));
    assert!(!is_git_metadata_path_of_interest(
        ".git/modules/packages/alpha/config"
    ));
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
    assert!(!should_schedule_git_refresh(
        root,
        &[root.join("node_modules/pkg/.git/HEAD")],
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
    let settings = FilesystemWatcherSettings::default();

    let regular_file_change = Event {
        kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        paths: vec![root.join("src/main.rs")],
        attrs: Default::default(),
    };
    assert!(!should_invalidate_repository_cache(
        root,
        &regular_file_change,
        &settings,
    ));

    let git_metadata_change = Event {
        kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        paths: vec![root.join("packages/alpha/.git/HEAD")],
        attrs: Default::default(),
    };
    assert!(!should_invalidate_repository_cache(
        root,
        &git_metadata_change,
        &settings,
    ));

    let nested_repo_created = Event {
        kind: EventKind::Create(notify::event::CreateKind::Folder),
        paths: vec![root.join("packages/alpha/.git")],
        attrs: Default::default(),
    };
    assert!(should_invalidate_repository_cache(
        root,
        &nested_repo_created,
        &settings,
    ));

    let git_pointer_modified = Event {
        kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        paths: vec![root.join("packages/alpha/.git")],
        attrs: Default::default(),
    };
    assert!(should_invalidate_repository_cache(
        root,
        &git_pointer_modified,
        &settings,
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
        &nested_repo_renamed,
        &settings,
    ));

    let removed_nested_repo = root.join("packages/gamma");
    let nested_repo_removed = Event {
        kind: EventKind::Remove(notify::event::RemoveKind::Folder),
        paths: vec![removed_nested_repo],
        attrs: Default::default(),
    };
    assert!(should_invalidate_repository_cache(
        root,
        &nested_repo_removed,
        &settings,
    ));

    for ignored_dir in ["node_modules", "target"] {
        let ignored_folder_removed = Event {
            kind: EventKind::Remove(notify::event::RemoveKind::Folder),
            paths: vec![root.join(ignored_dir)],
            attrs: Default::default(),
        };
        assert!(!should_invalidate_repository_cache(
            root,
            &ignored_folder_removed,
            &settings,
        ));
    }

    let _ = fs::remove_dir_all(root);
}

#[test]
fn gitmodules_changes_invalidate_repository_discovery_cache() {
    let root = Path::new("/tmp/workspace");
    let settings = FilesystemWatcherSettings::default();
    for kind in [
        EventKind::Create(notify::event::CreateKind::File),
        EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
        EventKind::Remove(notify::event::RemoveKind::File),
    ] {
        let event = Event {
            kind,
            paths: vec![root.join(".gitmodules")],
            attrs: Default::default(),
        };
        assert!(should_invalidate_repository_cache(root, &event, &settings));
    }
}

#[test]
fn cancelled_watcher_discards_pending_events_without_scheduling_git_refresh() {
    let app = mock_app();
    let changed_events = Arc::new(AtomicUsize::new(0));
    let changed_events_ref = changed_events.clone();
    app.listen("filesystem/changed", move |_| {
        changed_events_ref.fetch_add(1, Ordering::Relaxed);
    });

    let mut pending = PendingWatchEvents::default();
    pending
        .paths_by_kind
        .entry("modified")
        .or_default()
        .insert("src/main.rs".to_string());
    pending.git_refresh_required = true;
    let cancel = CancellationToken::new();
    cancel.cancel();

    flush_pending_watch_events(app.handle(), "ws-closed", &mut pending, &cancel);

    assert_eq!(changed_events.load(Ordering::Relaxed), 0);
    assert!(pending.paths_by_kind.is_empty());
    assert!(!pending.git_refresh_required);
}

#[test]
fn stale_watcher_initialization_cannot_remove_reopened_reservation() {
    let mut registry = WorkspaceWatcherRegistryState::default();
    let old_cancel = CancellationToken::new();
    let old_generation = registry
        .reserve_pending("ws-1", old_cancel.clone())
        .expect("first initialization should reserve");

    registry.cancel_pending("ws-1");
    assert!(old_cancel.is_cancelled());

    let new_cancel = CancellationToken::new();
    let new_generation = registry
        .reserve_pending("ws-1", new_cancel.clone())
        .expect("reopened workspace should reserve");
    assert_ne!(old_generation, new_generation);

    registry.cancel_pending_if_current("ws-1", old_generation);
    assert!(registry.pending_is_current("ws-1", new_generation));
    assert!(!new_cancel.is_cancelled());
}
