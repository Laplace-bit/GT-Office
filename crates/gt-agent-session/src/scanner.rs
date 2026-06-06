use std::path::{Path, PathBuf};

use crate::error::{SessionError, SessionResult};
use crate::types::{Provider, ProviderSessionCandidate};

pub struct ProviderScanner {
    home_dir: PathBuf,
}

impl ProviderScanner {
    pub fn new(home_dir: PathBuf) -> Self {
        Self { home_dir }
    }

    pub fn scan(&self, cwd: &Path) -> Vec<ProviderSessionCandidate> {
        let mut results = Vec::new();
        results.extend(self.scan_claude(cwd));
        results.extend(self.scan_codex(cwd));
        results
    }

    pub fn scan_claude(&self, cwd: &Path) -> Vec<ProviderSessionCandidate> {
        let project_key = claude_project_key_for_path(cwd);
        let project_dir = self.home_dir.join(".claude/projects").join(&project_key);
        if !project_dir.exists() {
            return vec![];
        }
        if let Ok(entries) = read_sessions_index(&project_dir) {
            return entries
                .into_iter()
                .filter(|e| !e.is_sidechain && paths_match(&e.project_path, cwd))
                .filter(|e| Path::new(&e.full_path).exists())
                .map(|e| ProviderSessionCandidate {
                    provider: Provider::Claude,
                    provider_session_id: claude_session_id_from_path(Path::new(&e.full_path)),
                    log_path: PathBuf::from(&e.full_path),
                    cwd: cwd.to_path_buf(),
                    modified_at_ms: e.file_mtime * 1000,
                    first_user_message: None,
                })
                .collect();
        }
        scan_jsonl_files(&project_dir)
            .into_iter()
            .filter_map(|p| {
                file_mtime_ms_opt(&p).map(|ms| ProviderSessionCandidate {
                    provider: Provider::Claude,
                    provider_session_id: claude_session_id_from_path(&p),
                    log_path: p,
                    cwd: cwd.to_path_buf(),
                    modified_at_ms: ms,
                    first_user_message: None,
                })
            })
            .collect()
    }

    pub fn scan_codex(&self, cwd: &Path) -> Vec<ProviderSessionCandidate> {
        let sessions_root = self.home_dir.join(".codex/sessions");
        if !sessions_root.exists() {
            return vec![];
        }
        let normalized_cwd = normalize_path(cwd);
        walk_jsonl_files(&sessions_root)
            .into_iter()
            .filter_map(|path| {
                let meta = extract_codex_session_meta(&path)?;
                let meta_cwd = normalize_path_str(&meta.cwd);
                if !paths_match_normalized(&meta_cwd, &normalized_cwd) {
                    return None;
                }
                let ms = file_mtime_ms_opt(&path)?;
                Some(ProviderSessionCandidate {
                    provider: Provider::Codex,
                    provider_session_id: Some(meta.id),
                    log_path: path,
                    cwd: cwd.to_path_buf(),
                    modified_at_ms: ms,
                    first_user_message: None,
                })
            })
            .collect()
    }
}

#[derive(Debug)]
struct SessionsIndexEntry {
    project_path: String,
    full_path: String,
    file_mtime: u64,
    is_sidechain: bool,
}

fn read_sessions_index(project_dir: &Path) -> SessionResult<Vec<SessionsIndexEntry>> {
    let index_path = project_dir.join("sessions-index.json");
    let content = std::fs::read_to_string(&index_path)?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| SessionError::Scan(e.to_string()))?;
    let entries_val = value.get("entries").and_then(|v| v.as_array());
    let Some(entries_val) = entries_val else {
        return Err(SessionError::Scan("no entries array".into()));
    };
    Ok(entries_val
        .iter()
        .filter_map(|e| {
            Some(SessionsIndexEntry {
                project_path: e.get("projectPath")?.as_str()?.to_string(),
                full_path: e.get("fullPath")?.as_str()?.to_string(),
                file_mtime: e.get("fileMtime")?.as_u64()?,
                is_sidechain: e
                    .get("isSidechain")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            })
        })
        .collect())
}

fn claude_project_key_for_path(path: &Path) -> String {
    let abs = if path.is_absolute() {
        path.to_string_lossy().to_string()
    } else {
        std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    abs.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn normalize_path(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('\\', "/");
    while s.ends_with('/') {
        s.pop();
    }
    s
}

fn normalize_path_str(s: &str) -> String {
    let mut r = s.replace('\\', "/");
    while r.ends_with('/') {
        r.pop();
    }
    r
}

fn paths_match(project_path: &str, cwd: &Path) -> bool {
    let a = normalize_path_str(project_path);
    let b = normalize_path(cwd);
    #[cfg(windows)]
    {
        a.to_lowercase() == b.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn paths_match_normalized(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.to_lowercase() == b.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn scan_jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .collect()
}

fn walk_jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                result.extend(walk_jsonl_files(&path));
            } else if path.extension().is_some_and(|ext| ext == "jsonl") {
                result.push(path);
            }
        }
    }
    result
}

struct CodexSessionMeta {
    id: String,
    cwd: String,
}

fn extract_codex_session_meta(path: &Path) -> Option<CodexSessionMeta> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    let value: serde_json::Value = serde_json::from_str(&first_line).ok()?;
    let payload = value.get("payload")?;
    Some(CodexSessionMeta {
        id: payload.get("id")?.as_str()?.to_string(),
        cwd: payload.get("cwd")?.as_str()?.to_string(),
    })
}

fn claude_session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    if stem.is_empty() || !stem.contains('-') {
        return None;
    }
    Some(stem.to_string())
}

fn file_mtime_ms_opt(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as u64)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_claude_dir(home: &Path, cwd: &Path) {
        let project_key = claude_project_key_for_path(cwd);
        let project_dir = home.join(".claude/projects").join(&project_key);
        fs::create_dir_all(&project_dir).unwrap();
        let session_file = project_dir.join("abc123.jsonl");
        fs::write(
            &session_file,
            r#"{"type":"user","message":{"role":"user","content":"hello"}}"#,
        )
        .unwrap();
        let index = serde_json::json!({
            "entries": [{
                "projectPath": cwd.to_string_lossy().to_string(),
                "fullPath": session_file.to_string_lossy().to_string(),
                "fileMtime": 1714276800,
                "isSidechain": false
            }]
        });
        fs::write(
            project_dir.join("sessions-index.json"),
            serde_json::to_string(&index).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn test_claude_scan_with_index() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        setup_claude_dir(home.path(), cwd.path());
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_claude(cwd.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider, Provider::Claude);
    }

    #[test]
    fn test_claude_scan_fallback_no_index() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let project_key = claude_project_key_for_path(cwd.path());
        let project_dir = home.path().join(".claude/projects").join(&project_key);
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(project_dir.join("session1.jsonl"), "line1\n").unwrap();
        fs::write(project_dir.join("session2.jsonl"), "line2\n").unwrap();
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_claude(cwd.path());
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_claude_scan_no_dir() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_claude(cwd.path());
        assert!(results.is_empty());
    }

    #[test]
    fn test_codex_scan_with_meta() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let session_dir = home.path().join(".codex/sessions/2026/05/24");
        fs::create_dir_all(&session_dir).unwrap();
        let meta_line = serde_json::json!({
            "type": "session_meta",
            "payload": {
                "id": "test-session-id",
                "cwd": cwd.path().to_string_lossy().to_string()
            }
        });
        let session_file = session_dir.join("rollout-test.jsonl");
        fs::write(
            &session_file,
            format!(
                "{}\nmore lines\n",
                serde_json::to_string(&meta_line).unwrap()
            ),
        )
        .unwrap();
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_codex(cwd.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider, Provider::Codex);
        assert_eq!(
            results[0].provider_session_id.as_deref(),
            Some("test-session-id")
        );
    }

    #[test]
    fn test_codex_scan_cwd_filter() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let other_cwd = tempfile::tempdir().unwrap();
        let session_dir = home.path().join(".codex/sessions/2026/05/24");
        fs::create_dir_all(&session_dir).unwrap();
        let meta_line = serde_json::json!({
            "type": "session_meta",
            "payload": {
                "id": "test-session-id",
                "cwd": other_cwd.path().to_string_lossy().to_string()
            }
        });
        let session_file = session_dir.join("rollout-other.jsonl");
        fs::write(
            &session_file,
            format!("{}\nmore\n", serde_json::to_string(&meta_line).unwrap()),
        )
        .unwrap();
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_codex(cwd.path());
        assert!(results.is_empty());
    }

    #[test]
    fn test_codex_scan_no_dir() {
        let home = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let scanner = ProviderScanner::new(home.path().to_path_buf());
        let results = scanner.scan_codex(cwd.path());
        assert!(results.is_empty());
    }

    #[test]
    fn test_project_key_encoding() {
        let key = claude_project_key_for_path(Path::new("/Users/test/my-project"));
        assert_eq!(key, "-Users-test-my-project");
    }

    #[test]
    fn test_paths_match_same() {
        assert!(paths_match("/tmp/test", Path::new("/tmp/test")));
    }

    #[test]
    fn test_paths_match_different() {
        assert!(!paths_match("/tmp/a", Path::new("/tmp/b")));
    }

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path(Path::new("/tmp/test/")), "/tmp/test");
        assert_eq!(normalize_path(Path::new("/tmp/test")), "/tmp/test");
    }
}
