use gt_abstractions::SettingsScope;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use thiserror::Error;

pub fn module_name() -> &'static str {
    "gt-settings"
}

pub const DEFAULT_FS_WATCH_POLL_INTERVAL_MS: u64 = 250;
pub const DEFAULT_FS_PREVIEW_MAX_BYTES: usize = 256 * 1024;
pub const DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const DEFAULT_FS_FULL_READ_HARD_MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("SETTINGS_IO_FAILED: {0}")]
    Io(String),
    #[error("SETTINGS_SERIALIZE_FAILED: {0}")]
    Serialize(String),
    #[error("SETTINGS_INVALID_PATCH: patch must be a JSON object")]
    InvalidPatch,
    #[error("SETTINGS_INVALID_SCOPE: unsupported scope '{0}'")]
    InvalidScope(String),
    #[error("SETTINGS_WORKSPACE_REQUIRED: workspace scope requires workspace root")]
    WorkspaceRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveSettings {
    pub values: Value,
    pub sources: Value,
}

#[derive(Debug, Clone)]
pub struct SettingsPaths {
    pub user_file: PathBuf,
    pub workspace_relative_file: PathBuf,
}

impl SettingsPaths {
    pub fn new(user_file: PathBuf, workspace_relative_file: PathBuf) -> Self {
        Self {
            user_file,
            workspace_relative_file,
        }
    }

    pub fn workspace_file(&self, workspace_root: &Path) -> PathBuf {
        workspace_root.join(&self.workspace_relative_file)
    }
}

impl Default for SettingsPaths {
    fn default() -> Self {
        Self {
            user_file: default_user_settings_path(),
            workspace_relative_file: PathBuf::from(".gtoffice/config.json"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeSettings {
    pub filesystem: FilesystemSettings,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            filesystem: FilesystemSettings::default(),
        }
    }
}

impl RuntimeSettings {
    pub fn normalize(&mut self) {
        self.filesystem.normalize();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FilesystemSettings {
    pub watcher: FilesystemWatcherSettings,
    pub preview: FilePreviewSettings,
}

impl Default for FilesystemSettings {
    fn default() -> Self {
        Self {
            watcher: FilesystemWatcherSettings::default(),
            preview: FilePreviewSettings::default(),
        }
    }
}

impl FilesystemSettings {
    fn normalize(&mut self) {
        self.watcher.normalize();
        self.preview.normalize();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FilesystemWatcherSettings {
    pub poll_interval_ms: u64,
    pub ignored_dirs: Vec<String>,
    pub ignored_exact_files: Vec<String>,
    pub ignored_suffixes: Vec<String>,
}

impl Default for FilesystemWatcherSettings {
    fn default() -> Self {
        Self {
            poll_interval_ms: DEFAULT_FS_WATCH_POLL_INTERVAL_MS,
            ignored_dirs: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                "target".to_string(),
                "dist".to_string(),
                ".next".to_string(),
                ".cache".to_string(),
            ],
            ignored_exact_files: vec![".DS_Store".to_string(), "Thumbs.db".to_string()],
            ignored_suffixes: vec![
                ".swp".to_string(),
                ".tmp".to_string(),
                ".temp".to_string(),
                "~".to_string(),
                ".crdownload".to_string(),
            ],
        }
    }
}

impl FilesystemWatcherSettings {
    fn normalize(&mut self) {
        if self.poll_interval_ms == 0 {
            self.poll_interval_ms = DEFAULT_FS_WATCH_POLL_INTERVAL_MS;
        }
        normalize_string_list(&mut self.ignored_dirs);
        normalize_string_list(&mut self.ignored_exact_files);
        normalize_string_list(&mut self.ignored_suffixes);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FilePreviewSettings {
    pub max_bytes: usize,
    pub full_read_default_max_bytes: usize,
    pub full_read_hard_max_bytes: usize,
}

impl Default for FilePreviewSettings {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_FS_PREVIEW_MAX_BYTES,
            full_read_default_max_bytes: DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES,
            full_read_hard_max_bytes: DEFAULT_FS_FULL_READ_HARD_MAX_BYTES,
        }
    }
}

impl FilePreviewSettings {
    fn normalize(&mut self) {
        if self.max_bytes == 0 {
            self.max_bytes = DEFAULT_FS_PREVIEW_MAX_BYTES;
        }
        if self.full_read_default_max_bytes == 0 {
            self.full_read_default_max_bytes = DEFAULT_FS_FULL_READ_DEFAULT_MAX_BYTES;
        }
        if self.full_read_hard_max_bytes == 0 {
            self.full_read_hard_max_bytes = DEFAULT_FS_FULL_READ_HARD_MAX_BYTES;
        }

        if self.full_read_default_max_bytes < self.max_bytes {
            self.full_read_default_max_bytes = self.max_bytes;
        }
        if self.full_read_hard_max_bytes < self.full_read_default_max_bytes {
            self.full_read_hard_max_bytes = self.full_read_default_max_bytes;
        }
    }
}

#[derive(Clone)]
pub struct JsonSettingsService {
    paths: SettingsPaths,
    session_values: Arc<RwLock<HashMap<String, Value>>>,
}

impl Default for JsonSettingsService {
    fn default() -> Self {
        Self {
            paths: SettingsPaths::default(),
            session_values: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl JsonSettingsService {
    pub fn new(paths: SettingsPaths) -> Self {
        Self {
            paths,
            session_values: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn paths(&self) -> &SettingsPaths {
        &self.paths
    }

    pub fn load_effective(
        &self,
        workspace_root: Option<&Path>,
    ) -> Result<EffectiveSettings, SettingsError> {
        let defaults = default_settings_value();
        let user_values = read_json_object(self.paths.user_file.as_path())?;
        let workspace_values = match workspace_root {
            Some(root) => read_json_object(self.paths.workspace_file(root).as_path())?,
            None => json!({}),
        };
        let session_values = self.session_values_for(workspace_root)?;

        let mut effective = defaults;
        merge_value(&mut effective, &user_values);
        merge_value(&mut effective, &workspace_values);
        merge_value(&mut effective, &session_values);

        Ok(EffectiveSettings {
            values: effective,
            sources: json!({
                "defaults": "built-in",
                "user": self.paths.user_file.to_string_lossy().to_string(),
                "workspace": workspace_root.map(|root| self.paths.workspace_file(root).to_string_lossy().to_string()),
                "session": if session_values.is_object() && !session_values.as_object().is_some_and(|map| map.is_empty()) {
                    Some("runtime-memory")
                } else {
                    None
                }
            }),
        })
    }

    pub fn load_runtime(
        &self,
        workspace_root: Option<&Path>,
    ) -> Result<RuntimeSettings, SettingsError> {
        let effective = self.load_effective(workspace_root)?;
        let mut runtime = serde_json::from_value::<RuntimeSettings>(effective.values)
            .unwrap_or_else(|_| RuntimeSettings::default());
        runtime.normalize();
        Ok(runtime)
    }

    pub fn update(
        &self,
        scope: SettingsScope,
        workspace_root: Option<&Path>,
        patch: &Value,
    ) -> Result<EffectiveSettings, SettingsError> {
        if !patch.is_object() {
            return Err(SettingsError::InvalidPatch);
        }

        match scope {
            SettingsScope::User => {
                let mut values = read_json_object(self.paths.user_file.as_path())?;
                merge_value(&mut values, patch);
                write_json_object(self.paths.user_file.as_path(), &values)?;
            }
            SettingsScope::Workspace => {
                let workspace_root = workspace_root.ok_or(SettingsError::WorkspaceRequired)?;
                let file = self.paths.workspace_file(workspace_root);
                let mut values = read_json_object(file.as_path())?;
                merge_value(&mut values, patch);
                write_json_object(file.as_path(), &values)?;
            }
            SettingsScope::Session => {
                let key = self.session_key(workspace_root);
                let mut store = self
                    .session_values
                    .write()
                    .map_err(|_| SettingsError::Io("session settings lock poisoned".to_string()))?;
                let entry = store.entry(key).or_insert_with(|| json!({}));
                merge_value(entry, patch);
            }
        }

        self.load_effective(workspace_root)
    }

    pub fn reset(
        &self,
        scope: SettingsScope,
        workspace_root: Option<&Path>,
        keys: &[String],
    ) -> Result<EffectiveSettings, SettingsError> {
        match scope {
            SettingsScope::User => {
                let mut values = read_json_object(self.paths.user_file.as_path())?;
                reset_value(&mut values, keys);
                write_json_object(self.paths.user_file.as_path(), &values)?;
            }
            SettingsScope::Workspace => {
                let workspace_root = workspace_root.ok_or(SettingsError::WorkspaceRequired)?;
                let file = self.paths.workspace_file(workspace_root);
                let mut values = read_json_object(file.as_path())?;
                reset_value(&mut values, keys);
                write_json_object(file.as_path(), &values)?;
            }
            SettingsScope::Session => {
                let key = self.session_key(workspace_root);
                let mut store = self
                    .session_values
                    .write()
                    .map_err(|_| SettingsError::Io("session settings lock poisoned".to_string()))?;
                let entry = store.entry(key).or_insert_with(|| json!({}));
                reset_value(entry, keys);
            }
        }

        self.load_effective(workspace_root)
    }

    pub fn parse_scope(scope: &str) -> Result<SettingsScope, SettingsError> {
        match scope.trim().to_ascii_lowercase().as_str() {
            "user" => Ok(SettingsScope::User),
            "workspace" => Ok(SettingsScope::Workspace),
            "session" => Ok(SettingsScope::Session),
            other => Err(SettingsError::InvalidScope(other.to_string())),
        }
    }

    fn session_values_for(&self, workspace_root: Option<&Path>) -> Result<Value, SettingsError> {
        let key = self.session_key(workspace_root);
        let store = self
            .session_values
            .read()
            .map_err(|_| SettingsError::Io("session settings lock poisoned".to_string()))?;
        Ok(store.get(&key).cloned().unwrap_or_else(|| json!({})))
    }

    fn session_key(&self, workspace_root: Option<&Path>) -> String {
        workspace_root
            .map(|root| format!("workspace:{}", root.to_string_lossy()))
            .unwrap_or_else(|| "global".to_string())
    }
}

fn default_settings_value() -> Value {
    let runtime = RuntimeSettings::default();
    serde_json::to_value(runtime).unwrap_or_else(|_| json!({}))
}

pub fn default_user_settings_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Ok(app_data) = env::var("APPDATA") {
            return PathBuf::from(app_data).join("GT Office/settings.json");
        }
    }

    if let Ok(xdg_config) = env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg_config).join("gtoffice/settings.json");
    }

    if let Ok(home) = env::var("HOME") {
        return PathBuf::from(home).join(".config/gtoffice/settings.json");
    }

    PathBuf::from(".gtoffice-user/settings.json")
}

fn normalize_string_list(values: &mut Vec<String>) {
    let mut dedup = BTreeSet::new();
    let mut normalized = Vec::new();
    for value in values.drain(..) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized_value = trimmed.replace('\\', "/");
        if dedup.insert(normalized_value.clone()) {
            normalized.push(normalized_value);
        }
    }
    *values = normalized;
}

fn merge_value(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target_map), Value::Object(patch_map)) => {
            for (key, patch_value) in patch_map {
                match target_map.get_mut(key) {
                    Some(target_value) => merge_value(target_value, patch_value),
                    None => {
                        target_map.insert(key.clone(), patch_value.clone());
                    }
                }
            }
        }
        (target_value, patch_value) => {
            *target_value = patch_value.clone();
        }
    }
}

fn read_json_object(path: &Path) -> Result<Value, SettingsError> {
    if !path.exists() {
        return Ok(json!({}));
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| SettingsError::Io(format!("read '{}' failed: {error}", path.display())))?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }

    let value: Value = serde_json::from_str(&raw).map_err(|error| {
        SettingsError::Serialize(format!("parse '{}' failed: {error}", path.display()))
    })?;
    if !value.is_object() {
        return Err(SettingsError::Serialize(format!(
            "'{}' must be a JSON object",
            path.display()
        )));
    }
    Ok(value)
}

fn write_json_object(path: &Path, value: &Value) -> Result<(), SettingsError> {
    if !value.is_object() {
        return Err(SettingsError::Serialize(
            "settings root must be a JSON object".to_string(),
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            SettingsError::Io(format!("create dir '{}' failed: {error}", parent.display()))
        })?;
    }

    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| SettingsError::Serialize(format!("encode settings failed: {error}")))?;
    let mut temp_path = path.to_path_buf();
    temp_path.set_extension("tmp");

    fs::write(&temp_path, content).map_err(|error| {
        SettingsError::Io(format!("write '{}' failed: {error}", temp_path.display()))
    })?;

    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&temp_path, path).map_err(|error| {
        SettingsError::Io(format!(
            "rename '{}' -> '{}' failed: {error}",
            temp_path.display(),
            path.display()
        ))
    })?;

    Ok(())
}

fn reset_value(target: &mut Value, keys: &[String]) {
    if keys.is_empty() {
        *target = json!({});
        return;
    }

    for key in keys {
        remove_dotted_key(target, key);
    }
}

fn remove_dotted_key(target: &mut Value, key: &str) {
    let mut segments = key.split('.').filter(|segment| !segment.trim().is_empty());
    let Some(first_segment) = segments.next() else {
        return;
    };

    let mut current = target;
    let mut remaining = vec![first_segment.to_string()];
    remaining.extend(segments.map(|segment| segment.to_string()));

    for segment in remaining.iter().take(remaining.len().saturating_sub(1)) {
        let Some(obj) = current.as_object_mut() else {
            return;
        };
        let Some(next) = obj.get_mut(segment) else {
            return;
        };
        current = next;
    }

    if let Some(obj) = current.as_object_mut() {
        if let Some(last) = remaining.last() {
            obj.remove(last);
        }
    }
}
