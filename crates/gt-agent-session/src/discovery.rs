use std::path::Path;

use crate::registry::SessionRegistry;
use crate::scanner::ProviderScanner;
use crate::types::{Provider, SessionCard};

pub struct DiscoveryCache {
    last_scan_at_ms: u64,
    ttl_ms: u64,
}

impl DiscoveryCache {
    pub fn new(ttl_ms: u64) -> Self {
        Self { last_scan_at_ms: 0, ttl_ms }
    }

    pub fn invalidate(&mut self) {
        self.last_scan_at_ms = 0;
    }

    pub fn is_fresh(&self) -> bool {
        let now = now_ms();
        now.saturating_sub(self.last_scan_at_ms) < self.ttl_ms
    }

    pub fn mark_scanned(&mut self) {
        self.last_scan_at_ms = now_ms();
    }
}

pub struct DiscoveryResult {
    pub cards: Vec<SessionCard>,
    pub new_count: u32,
    pub updated_count: u32,
}

pub fn run_discovery(
    registry: &SessionRegistry,
    scanner: &ProviderScanner,
    cache: &mut DiscoveryCache,
    workspace_id: &str,
    cwd: &Path,
    provider: Option<Provider>,
    force: bool,
) -> crate::error::SessionResult<DiscoveryResult> {
    let scan_cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let cards = registry.list_cards_by_workspace(workspace_id, provider, 100, 0)?;
    let mut new_count: u32 = 0;
    let mut updated_count: u32 = 0;
    if force {
        cache.invalidate();
    }
    if !cache.is_fresh() {
        let candidates = match provider {
            Some(Provider::Claude) => scanner.scan_claude(&scan_cwd),
            Some(Provider::Codex) => scanner.scan_codex(&scan_cwd),
            None => scanner.scan(&scan_cwd),
        };
        if !candidates.is_empty() {
            let result = registry.merge_candidates(&candidates, workspace_id)?;
            new_count = result.new_count;
            updated_count = result.updated_count;
        }
        cache.mark_scanned();
    }
    let backfilled = registry.backfill_missing_titles(workspace_id, provider, 100)?;
    let cards = if new_count > 0 || updated_count > 0 || backfilled > 0 {
        registry.list_cards_by_workspace(workspace_id, provider, 100, 0)?
    } else {
        cards
    };
    Ok(DiscoveryResult { cards, new_count, updated_count })
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
    use crate::registry::SessionRegistry;
    use crate::scanner::ProviderScanner;
    use std::path::PathBuf;

    fn temp_registry() -> SessionRegistry {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("sessions.db");
        SessionRegistry::open(db_path).unwrap()
    }

    #[test]
    fn test_cache_fresh_after_scan() {
        let mut cache = DiscoveryCache::new(30_000);
        assert!(!cache.is_fresh());
        cache.mark_scanned();
        assert!(cache.is_fresh());
    }

    #[test]
    fn test_cache_stale_after_ttl() {
        let mut cache = DiscoveryCache::new(0);
        cache.mark_scanned();
        assert!(!cache.is_fresh());
    }

    #[test]
    fn test_run_discovery_fresh_cache() {
        let registry = temp_registry();
        let scanner = ProviderScanner::new(PathBuf::from("/nonexistent/home"));
        let mut cache = DiscoveryCache::new(30_000);
        cache.mark_scanned();
        let result = run_discovery(&registry, &scanner, &mut cache, "ws1", Path::new("/tmp"), None, false).unwrap();
        assert_eq!(result.new_count, 0);
        assert_eq!(result.updated_count, 0);
        assert!(result.cards.is_empty());
    }

    #[test]
    fn test_run_discovery_stale_cache_empty() {
        let registry = temp_registry();
        let scanner = ProviderScanner::new(PathBuf::from("/nonexistent/home"));
        let mut cache = DiscoveryCache::new(30_000);
        let result = run_discovery(&registry, &scanner, &mut cache, "ws1", Path::new("/tmp"), None, false).unwrap();
        assert_eq!(result.new_count, 0);
        assert!(cache.is_fresh());
    }
}