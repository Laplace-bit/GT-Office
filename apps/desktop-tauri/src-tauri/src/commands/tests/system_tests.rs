use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "gto-system-test-{name}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn install_gto_wrapper_replaces_existing_symlink_with_managed_wrapper() {
    let dir = temp_dir("replace-symlink");
    let command_path = dir.join("gto");
    let target = dir.join("gto.mjs");
    fs::write(&target, "console.log('ok')\n").expect("write target");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &command_path).expect("create symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&target, &command_path).expect("create symlink");

    install_gto_wrapper(&command_path, &target).expect("install wrapper");

    let body = fs::read_to_string(&command_path).expect("read wrapper");
    assert!(body.contains(GTO_WRAPPER_MARKER));
    assert!(body.contains(target.to_string_lossy().as_ref()));
}

#[test]
fn wrapper_is_managed_detects_installed_wrapper() {
    let dir = temp_dir("managed-wrapper");
    let command_path = dir.join("gto");
    fs::write(&command_path, format!("#!/bin/sh\n{GTO_WRAPPER_MARKER}\n")).expect("write wrapper");
    assert!(wrapper_is_managed(&command_path));
}

#[test]
fn copy_dir_all_copies_skill_tree() {
    let dir = temp_dir("copy-skill");
    let src = dir.join("src");
    let dst = dir.join("dst");
    fs::create_dir_all(src.join("agents")).expect("create source");
    fs::write(src.join("SKILL.md"), "---\nname: x\ndescription: y\n---\n").expect("write skill");
    fs::write(src.join("agents").join("openai.yaml"), "interface:\n").expect("write yaml");

    copy_dir_all(&src, &dst).expect("copy skill");

    assert!(dst.join("SKILL.md").is_file());
    assert!(dst.join("agents").join("openai.yaml").is_file());
}

#[test]
fn gto_skill_target_dir_uses_agent_specific_directories() {
    let home = PathBuf::from("/tmp/gto-home");
    assert_eq!(
        gto_skill_target_dir_from_home(&home, "claude").unwrap(),
        home.join(".claude").join("skills").join(GTO_SKILL_DIR_NAME)
    );
    assert_eq!(
        gto_skill_target_dir_from_home(&home, "codex").unwrap(),
        home.join(".codex").join("skills").join(GTO_SKILL_DIR_NAME)
    );
    assert_eq!(
        gto_skill_target_dir_from_home(&home, "gemini").unwrap(),
        home.join(".gemini").join("skills").join(GTO_SKILL_DIR_NAME)
    );
}

#[test]
fn install_gto_skill_tree_marks_directory_as_managed() {
    let dir = temp_dir("install-managed-skill");
    let src = dir.join("src");
    let dst = dir.join("dst");
    fs::create_dir_all(&src).expect("create src");
    fs::write(src.join("SKILL.md"), "# skill\n").expect("write skill");

    install_gto_skill_tree(&src, &dst).expect("install skill");

    assert!(dst.join("SKILL.md").is_file());
    assert!(skill_is_managed(&dst));
    assert!(gto_skill_marker_path(&dst).is_file());
}

#[test]
fn install_gto_skill_tree_replaces_external_skill_directory() {
    let dir = temp_dir("replace-external-skill");
    let src = dir.join("src");
    let dst = dir.join("dst");
    fs::create_dir_all(&src).expect("create src");
    fs::write(src.join("SKILL.md"), "# skill\n").expect("write skill");
    fs::create_dir_all(&dst).expect("create dst");
    fs::write(dst.join("SKILL.md"), "# external\n").expect("write external skill");

    install_gto_skill_tree(&src, &dst).expect("replace external skill");
    let body = fs::read_to_string(dst.join("SKILL.md")).expect("read installed skill");
    assert_eq!(body, "# skill\n");
    assert!(skill_is_managed(&dst));
}
