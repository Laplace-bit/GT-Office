use std::path::Path;
use std::process::Command;

use crate::error::SessionResult;
use crate::types::SessionStats;

pub struct GitSessionDiff;

impl GitSessionDiff {
    pub fn capture_commit(cwd: &Path) -> Option<String> {
        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(cwd)
            .output()
            .ok()?;
        if !output.status.success() { return None; }
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn compute_stats(cwd: &Path, start_commit: &str, end_commit: &str) -> SessionResult<Option<SessionStats>> {
        if start_commit == end_commit {
            return Ok(None);
        }
        let diff_output = Command::new("git")
            .args(["diff", "--stat", &format!("{}..{}", start_commit, end_commit)])
            .current_dir(cwd)
            .output()
            .map_err(|e| crate::error::SessionError::Git(e.to_string()))?;
        let (files_changed, insertions, deletions) = parse_diff_stat(
            &String::from_utf8_lossy(&diff_output.stdout),
        );
        let log_output = Command::new("git")
            .args(["log", "--oneline", &format!("{}..{}", start_commit, end_commit)])
            .current_dir(cwd)
            .output()
            .map_err(|e| crate::error::SessionError::Git(e.to_string()))?;
        let commits_ahead = count_lines(&String::from_utf8_lossy(&log_output.stdout));
        let now = now_ms();
        Ok(Some(SessionStats {
            gto_session_id: String::new(),
            git_start_commit: Some(start_commit.to_string()),
            git_end_commit: Some(end_commit.to_string()),
            files_changed,
            insertions,
            deletions,
            commits_ahead,
            updated_at_ms: now,
        }))
    }

    pub fn last_commit_summary(cwd: &Path) -> Option<String> {
        let output = Command::new("git")
            .args(["log", "-1", "--oneline"])
            .current_dir(cwd)
            .output()
            .ok()?;
        if !output.status.success() { return None; }
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

fn parse_diff_stat(output: &str) -> (u32, u32, u32) {
    let mut files: u32 = 0;
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if line.contains("files changed") || line.contains("file changed") {
            for part in line.split(',') {
                let part = part.trim();
                if part.contains("insertion") {
                    if let Some(n) = part.split_whitespace().next() {
                        insertions = n.parse().unwrap_or(0);
                    }
                } else if part.contains("deletion") {
                    if let Some(n) = part.split_whitespace().next() {
                        deletions = n.parse().unwrap_or(0);
                    }
                }
            }
        } else if line.contains('|') && !line.starts_with('|') {
            files += 1;
        }
    }
    (files, insertions, deletions)
}

fn count_lines(s: &str) -> u32 {
    s.lines().filter(|l| !l.trim().is_empty()).count() as u32
}

pub fn build_handover_text(title: &str, stats: &SessionStats, last_commit: Option<&str>) -> String {
    let mut text = format!("[GT Office] Last session: {}\n", title);
    text.push_str(&format!(
        "Changes: {} files | +{} -{} | {} commits\n",
        stats.files_changed, stats.insertions, stats.deletions, stats.commits_ahead,
    ));
    if let Some(commit) = last_commit {
        text.push_str(&format!("Last commit: {}\n", commit));
    }
    text.push_str("──────────\n");
    text
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    #[test]
    fn test_parse_diff_stat_basic() {
        let output = "src/main.rs | 5 ++++--\nsrc/lib.rs  | 3 ++-\n2 files changed, 5 insertions(+), 3 deletions(-)";
        let (files, ins, del) = parse_diff_stat(output);
        assert_eq!(files, 2);
        assert_eq!(ins, 5);
        assert_eq!(del, 3);
    }

    #[test]
    fn test_parse_diff_stat_empty() {
        let (files, ins, del) = parse_diff_stat("");
        assert_eq!(files, 0);
        assert_eq!(ins, 0);
        assert_eq!(del, 0);
    }

    #[test]
    fn test_parse_diff_stat_summary_line_only() {
        let output = "2 files changed, 10 insertions(+), 5 deletions(-)";
        let (files, ins, del) = parse_diff_stat(output);
        assert_eq!(files, 0);
        assert_eq!(ins, 10);
        assert_eq!(del, 5);
    }

    #[test]
    fn test_count_lines() {
        assert_eq!(count_lines("line1\nline2\nline3\n"), 3);
        assert_eq!(count_lines(""), 0);
        assert_eq!(count_lines("  \n  \n"), 0);
    }

    #[test]
    fn test_build_handover_text() {
        let stats = SessionStats {
            gto_session_id: "s1".to_string(),
            git_start_commit: Some("abc".to_string()),
            git_end_commit: Some("def".to_string()),
            files_changed: 3,
            insertions: 42,
            deletions: 8,
            commits_ahead: 2,
            updated_at_ms: 0,
        };
        let text = build_handover_text("Fix login", &stats, Some("def Fix login bug"));
        assert!(text.contains("Fix login"));
        assert!(text.contains("3 files"));
        assert!(text.contains("+42"));
        assert!(text.contains("-8"));
        assert!(text.contains("2 commits"));
    }

    #[test]
    fn test_capture_commit_in_real_repo() {
        let dir = tempfile::tempdir().unwrap();
        let output = Command::new("git")
            .args(["init"])
            .current_dir(dir.path())
            .output();
        if output.is_err() || !output.unwrap().status.success() {
            eprintln!("Skipping: git not available");
            return;
        }
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(dir.path())
            .output().unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir.path())
            .output().unwrap();
        fs::write(dir.path().join("file.txt"), "hello").unwrap();
        Command::new("git").args(["add", "."]).current_dir(dir.path()).output().unwrap();
        Command::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();
        let commit = GitSessionDiff::capture_commit(dir.path());
        assert!(commit.is_some());
        assert!(!commit.unwrap().is_empty());
    }

    #[test]
    fn test_capture_commit_not_repo() {
        let dir = tempfile::tempdir().unwrap();
        let commit = GitSessionDiff::capture_commit(dir.path());
        assert!(commit.is_none());
    }

    #[test]
    fn test_same_commit_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let output = Command::new("git").args(["init"]).current_dir(dir.path()).output();
        if output.is_err() || !output.unwrap().status.success() {
            eprintln!("Skipping: git not available");
            return;
        }
        Command::new("git").args(["config", "user.email", "t@t.com"]).current_dir(dir.path()).output().unwrap();
        Command::new("git").args(["config", "user.name", "T"]).current_dir(dir.path()).output().unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        Command::new("git").args(["add", "."]).current_dir(dir.path()).output().unwrap();
        Command::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();
        let commit = GitSessionDiff::capture_commit(dir.path()).unwrap();
        let result = GitSessionDiff::compute_stats(dir.path(), &commit, &commit).unwrap();
        assert!(result.is_none());
    }
}