#[cfg(not(target_os = "windows"))]
use std::{
    collections::HashMap,
    sync::{OnceLock, RwLock},
};

#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::{ffi::c_void, ptr, slice};
#[cfg(target_os = "macos")]
use std::{
    path::{Path, PathBuf},
    process::Command,
};

use thiserror::Error;

pub fn module_name() -> &'static str {
    "vb-security"
}

#[derive(Debug, Error, Clone)]
pub enum SecurityError {
    #[error("{code}: {message}")]
    InvalidInput { code: String, message: String },
    #[error("{code}: {message}")]
    StoreFailed { code: String, message: String },
    #[error("{code}: {message}")]
    LoadFailed { code: String, message: String },
    #[error("{code}: {message}")]
    NotFound { code: String, message: String },
}

pub type SecurityResult<T> = Result<T, SecurityError>;

#[derive(Debug, Clone)]
pub struct SecretStore {
    service_name: String,
    error_namespace: String,
}

impl SecretStore {
    pub fn new(service_name: impl Into<String>, error_namespace: impl Into<String>) -> Self {
        Self {
            service_name: service_name.into(),
            error_namespace: error_namespace.into(),
        }
    }

    pub fn store(&self, reference: &str, value: &str) -> SecurityResult<()> {
        let reference = reference.trim();
        if reference.is_empty() {
            return Err(SecurityError::InvalidInput {
                code: format!("{}_INVALID_REF", self.error_namespace),
                message: "secret reference is required".to_string(),
            });
        }
        if value.trim().is_empty() {
            return Err(SecurityError::InvalidInput {
                code: format!("{}_EMPTY", self.error_namespace),
                message: "secret value is required".to_string(),
            });
        }

        #[cfg(target_os = "windows")]
        {
            os_store_secret(&self.service_name, &self.error_namespace, reference, value)
        }

        #[cfg(not(target_os = "windows"))]
        {
            match os_store_secret(&self.service_name, &self.error_namespace, reference, value) {
                Ok(()) => Ok(()),
                Err(_) => {
                    memory_store_secret(&self.service_name, reference, value).map_err(|message| {
                        SecurityError::StoreFailed {
                            code: format!("{}_MEMORY_STORE_FAILED", self.error_namespace),
                            message,
                        }
                    })
                }
            }
        }
    }

    pub fn load(&self, reference: &str) -> SecurityResult<String> {
        let reference = reference.trim();
        if reference.is_empty() {
            return Err(SecurityError::InvalidInput {
                code: format!("{}_INVALID_REF", self.error_namespace),
                message: "secret reference is required".to_string(),
            });
        }

        #[cfg(target_os = "windows")]
        {
            os_load_secret(&self.service_name, &self.error_namespace, reference)
        }

        #[cfg(not(target_os = "windows"))]
        {
            match os_load_secret(&self.service_name, &self.error_namespace, reference) {
                Ok(secret) if !secret.trim().is_empty() => Ok(secret),
                _ => memory_load_secret(&self.service_name, reference).map_err(|message| {
                    SecurityError::LoadFailed {
                        code: format!("{}_MEMORY_LOAD_FAILED", self.error_namespace),
                        message,
                    }
                }),
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
static MEMORY_FALLBACK: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();

#[cfg(not(target_os = "windows"))]
fn fallback_key(service_name: &str, reference: &str) -> String {
    format!("{service_name}:{reference}")
}

#[cfg(not(target_os = "windows"))]
fn memory_store_secret(service_name: &str, reference: &str, value: &str) -> Result<(), String> {
    let lock = MEMORY_FALLBACK.get_or_init(|| RwLock::new(HashMap::new()));
    let mut guard = lock
        .write()
        .map_err(|_| "secret memory store lock poisoned".to_string())?;
    guard.insert(fallback_key(service_name, reference), value.to_string());
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn memory_load_secret(service_name: &str, reference: &str) -> Result<String, String> {
    let lock = MEMORY_FALLBACK.get_or_init(|| RwLock::new(HashMap::new()));
    let guard = lock
        .read()
        .map_err(|_| "secret memory load lock poisoned".to_string())?;
    guard
        .get(&fallback_key(service_name, reference))
        .cloned()
        .ok_or_else(|| "secret not found".to_string())
}

#[cfg(target_os = "macos")]
fn macos_keychain_path() -> Option<PathBuf> {
    static MACOS_KEYCHAIN_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    MACOS_KEYCHAIN_PATH
        .get_or_init(detect_macos_keychain_path)
        .clone()
}

#[cfg(target_os = "macos")]
fn detect_macos_keychain_path() -> Option<PathBuf> {
    let home_dir = std::env::var_os("HOME").map(PathBuf::from)?;
    let security_preferences = load_macos_security_preferences(&home_dir);
    select_macos_keychain_path(&home_dir, security_preferences.as_ref())
}

#[cfg(target_os = "macos")]
fn load_macos_security_preferences(home_dir: &Path) -> Option<serde_json::Value> {
    let preferences_path = home_dir.join("Library/Preferences/com.apple.security.plist");
    if !preferences_path.is_file() {
        return None;
    }

    let output = Command::new("plutil")
        .args(["-convert", "json", "-o", "-"])
        .arg(&preferences_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    serde_json::from_slice(&output.stdout).ok()
}

#[cfg(target_os = "macos")]
fn select_macos_keychain_path(
    home_dir: &Path,
    security_preferences: Option<&serde_json::Value>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(security_preferences) = security_preferences {
        collect_macos_keychain_candidates(home_dir, security_preferences, &mut candidates);
    }
    candidates.extend(default_macos_keychain_candidates(home_dir));
    candidates.extend(discover_macos_keychain_candidates(home_dir));
    candidates
        .into_iter()
        .find(|candidate| is_usable_macos_keychain(candidate))
}

#[cfg(target_os = "macos")]
fn collect_macos_keychain_candidates(
    home_dir: &Path,
    value: &serde_json::Value,
    candidates: &mut Vec<PathBuf>,
) {
    match value {
        serde_json::Value::String(raw) => {
            if let Some(candidate) = normalize_macos_keychain_candidate(home_dir, raw) {
                candidates.push(candidate);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_macos_keychain_candidates(home_dir, item, candidates);
            }
        }
        serde_json::Value::Object(map) => {
            for value in map.values() {
                collect_macos_keychain_candidates(home_dir, value, candidates);
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn normalize_macos_keychain_candidate(home_dir: &Path, raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if !(raw.ends_with(".keychain") || raw.ends_with(".keychain-db")) {
        return None;
    }
    if let Some(path) = raw.strip_prefix("~/") {
        return Some(home_dir.join(path));
    }
    if let Some(path) = raw.strip_prefix("$HOME/") {
        return Some(home_dir.join(path));
    }
    if let Some(path) = raw.strip_prefix("file://") {
        return Some(PathBuf::from(path));
    }

    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Some(path);
    }

    Some(home_dir.join("Library/Keychains").join(path))
}

#[cfg(target_os = "macos")]
fn default_macos_keychain_candidates(home_dir: &Path) -> [PathBuf; 2] {
    [
        home_dir.join("Library/Keychains/login.keychain-db"),
        home_dir.join("Library/Keychains/login.keychain"),
    ]
}

#[cfg(target_os = "macos")]
fn discover_macos_keychain_candidates(home_dir: &Path) -> Vec<PathBuf> {
    let keychain_dir = home_dir.join("Library/Keychains");
    let Ok(entries) = std::fs::read_dir(keychain_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_usable_macos_keychain(path))
        .collect()
}

#[cfg(target_os = "macos")]
fn is_usable_macos_keychain(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    if file_name.starts_with('.') || file_name == "metadata.keychain-db" {
        return false;
    }

    file_name.ends_with(".keychain") || file_name.ends_with(".keychain-db")
}

#[cfg(target_os = "macos")]
fn os_store_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
    value: &str,
) -> SecurityResult<()> {
    let keychain_path = macos_keychain_path().ok_or_else(|| SecurityError::StoreFailed {
        code: format!("{}_STORE_FAILED", error_namespace),
        message: "no usable macOS keychain configured".to_string(),
    })?;

    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            reference,
            "-s",
            service_name,
            "-w",
            value,
            "-U",
        ])
        .arg(&keychain_path)
        .output()
        .map_err(|error| SecurityError::StoreFailed {
            code: format!("{}_STORE_FAILED", error_namespace),
            message: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(());
    }
    Err(SecurityError::StoreFailed {
        code: format!("{}_STORE_FAILED", error_namespace),
        message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

#[cfg(target_os = "macos")]
fn os_load_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
) -> SecurityResult<String> {
    let keychain_path = macos_keychain_path().ok_or_else(|| SecurityError::LoadFailed {
        code: format!("{}_LOAD_FAILED", error_namespace),
        message: "no usable macOS keychain configured".to_string(),
    })?;

    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            reference,
            "-s",
            service_name,
            "-w",
        ])
        .arg(&keychain_path)
        .output()
        .map_err(|error| SecurityError::LoadFailed {
            code: format!("{}_LOAD_FAILED", error_namespace),
            message: error.to_string(),
        })?;
    if output.status.success() {
        let secret =
            String::from_utf8(output.stdout).map_err(|error| SecurityError::LoadFailed {
                code: format!("{}_LOAD_FAILED", error_namespace),
                message: error.to_string(),
            })?;
        let secret = secret.trim().to_string();
        if secret.is_empty() {
            return Err(SecurityError::NotFound {
                code: format!("{}_NOT_FOUND", error_namespace),
                message: "secret not found".to_string(),
            });
        }
        return Ok(secret);
    }
    Err(SecurityError::LoadFailed {
        code: format!("{}_LOAD_FAILED", error_namespace),
        message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

#[cfg(target_os = "linux")]
fn os_store_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
    value: &str,
) -> SecurityResult<()> {
    let output = Command::new("secret-tool")
        .args([
            "store",
            "--label",
            "GT Office Secret",
            "service",
            service_name,
            "account",
            reference,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(stdin) = child.stdin.as_mut() {
                stdin.write_all(value.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|error| SecurityError::StoreFailed {
            code: format!("{}_STORE_FAILED", error_namespace),
            message: error.to_string(),
        })?;

    if output.status.success() {
        return Ok(());
    }

    Err(SecurityError::StoreFailed {
        code: format!("{}_STORE_FAILED", error_namespace),
        message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

#[cfg(target_os = "linux")]
fn os_load_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
) -> SecurityResult<String> {
    let output = Command::new("secret-tool")
        .args(["lookup", "service", service_name, "account", reference])
        .output()
        .map_err(|error| SecurityError::LoadFailed {
            code: format!("{}_LOAD_FAILED", error_namespace),
            message: error.to_string(),
        })?;
    if output.status.success() {
        let secret =
            String::from_utf8(output.stdout).map_err(|error| SecurityError::LoadFailed {
                code: format!("{}_LOAD_FAILED", error_namespace),
                message: error.to_string(),
            })?;
        let secret = secret.trim().to_string();
        if secret.is_empty() {
            return Err(SecurityError::NotFound {
                code: format!("{}_NOT_FOUND", error_namespace),
                message: "secret not found".to_string(),
            });
        }
        return Ok(secret);
    }
    Err(SecurityError::LoadFailed {
        code: format!("{}_LOAD_FAILED", error_namespace),
        message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Filetime {
    dw_low_date_time: u32,
    dw_high_date_time: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct CredentialAttributew {
    keyword: *mut u16,
    flags: u32,
    value_size: u32,
    value: *mut u8,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Credentialw {
    flags: u32,
    type_: u32,
    target_name: *mut u16,
    comment: *mut u16,
    last_written: Filetime,
    credential_blob_size: u32,
    credential_blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut CredentialAttributew,
    target_alias: *mut u16,
    user_name: *mut u16,
}

#[cfg(target_os = "windows")]
const CRED_TYPE_GENERIC: u32 = 1;
#[cfg(target_os = "windows")]
const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;

#[cfg(target_os = "windows")]
#[link(name = "Advapi32")]
extern "system" {
    fn CredWriteW(credential: *const Credentialw, flags: u32) -> i32;
    fn CredReadW(
        target_name: *const u16,
        type_: u32,
        flags: u32,
        credential: *mut *mut Credentialw,
    ) -> i32;
    fn CredFree(buffer: *mut c_void);
}

#[cfg(target_os = "windows")]
fn credential_target(service_name: &str, reference: &str) -> String {
    format!("{service_name}:{reference}")
}

#[cfg(target_os = "windows")]
fn to_utf16_null_terminated(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn os_store_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
    value: &str,
) -> SecurityResult<()> {
    let target = credential_target(service_name, reference);
    let mut target_w = to_utf16_null_terminated(&target);
    let mut user_w = to_utf16_null_terminated("gtoffice");
    let mut blob = value.as_bytes().to_vec();

    let credential_blob_size =
        u32::try_from(blob.len()).map_err(|_| SecurityError::StoreFailed {
            code: format!("{}_STORE_FAILED", error_namespace),
            message: "secret too large".to_string(),
        })?;

    let credential = Credentialw {
        flags: 0,
        type_: CRED_TYPE_GENERIC,
        target_name: target_w.as_mut_ptr(),
        comment: ptr::null_mut(),
        last_written: Filetime {
            dw_low_date_time: 0,
            dw_high_date_time: 0,
        },
        credential_blob_size,
        credential_blob: blob.as_mut_ptr(),
        persist: CRED_PERSIST_LOCAL_MACHINE,
        attribute_count: 0,
        attributes: ptr::null_mut(),
        target_alias: ptr::null_mut(),
        user_name: user_w.as_mut_ptr(),
    };

    let status = unsafe {
        // SAFETY: Pointers are valid for the duration of the FFI call.
        CredWriteW(&credential, 0)
    };
    if status != 0 {
        return Ok(());
    }

    Err(SecurityError::StoreFailed {
        code: format!("{}_STORE_FAILED", error_namespace),
        message: std::io::Error::last_os_error().to_string(),
    })
}

#[cfg(target_os = "windows")]
fn os_load_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
) -> SecurityResult<String> {
    let target = credential_target(service_name, reference);
    let target_w = to_utf16_null_terminated(&target);
    let mut credential_ptr: *mut Credentialw = ptr::null_mut();
    let status = unsafe {
        // SAFETY: target_w is null-terminated and lives for the duration of the call.
        CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr)
    };

    if status == 0 {
        return Err(SecurityError::LoadFailed {
            code: format!("{}_LOAD_FAILED", error_namespace),
            message: std::io::Error::last_os_error().to_string(),
        });
    }
    if credential_ptr.is_null() {
        return Err(SecurityError::NotFound {
            code: format!("{}_NOT_FOUND", error_namespace),
            message: "secret not found".to_string(),
        });
    }

    let secret = unsafe {
        // SAFETY: credential_ptr is returned by CredReadW and remains valid until CredFree.
        let credential = &*credential_ptr;
        if credential.credential_blob.is_null() || credential.credential_blob_size == 0 {
            CredFree(credential_ptr as *mut c_void);
            return Err(SecurityError::NotFound {
                code: format!("{}_NOT_FOUND", error_namespace),
                message: "secret not found".to_string(),
            });
        }
        let bytes = slice::from_raw_parts(
            credential.credential_blob as *const u8,
            credential.credential_blob_size as usize,
        )
        .to_vec();
        CredFree(credential_ptr as *mut c_void);
        String::from_utf8(bytes).map_err(|error| SecurityError::LoadFailed {
            code: format!("{}_LOAD_FAILED", error_namespace),
            message: error.to_string(),
        })
    }?;

    if secret.trim().is_empty() {
        return Err(SecurityError::NotFound {
            code: format!("{}_NOT_FOUND", error_namespace),
            message: "secret not found".to_string(),
        });
    }

    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::SecretStore;
    #[cfg(target_os = "macos")]
    use serde_json::json;
    #[cfg(target_os = "macos")]
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn rejects_empty_reference() {
        let store = SecretStore::new("gtoffice.test", "TEST_SECRET");
        let error = store.store("  ", "value").unwrap_err().to_string();
        assert!(error.contains("TEST_SECRET_INVALID_REF"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn prefers_existing_login_keychain_when_preferences_point_to_missing_file() {
        let home_dir = new_test_home("prefers-existing-login-keychain");
        let login_keychain = home_dir.join("Library/Keychains/login.keychain-db");
        fs::create_dir_all(login_keychain.parent().expect("login keychain parent"))
            .expect("create keychain directory");
        fs::write(&login_keychain, b"").expect("create login keychain");

        let selected = super::select_macos_keychain_path(
            &home_dir,
            Some(&json!({
                "DefaultKeychain": "/missing/broken.keychain-db"
            })),
        );

        assert_eq!(selected, Some(login_keychain));
        remove_test_home(&home_dir);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn returns_none_when_no_usable_keychain_exists() {
        let home_dir = new_test_home("returns-none-when-missing");

        let selected = super::select_macos_keychain_path(
            &home_dir,
            Some(&json!({
                "DefaultKeychain": "/missing/broken.keychain-db",
                "SearchList": ["/missing/another.keychain-db"]
            })),
        );

        assert_eq!(selected, None);
        remove_test_home(&home_dir);
    }

    #[cfg(target_os = "macos")]
    fn new_test_home(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("vb-security-{label}-{suffix}"));
        fs::create_dir_all(&path).expect("create test home");
        path
    }

    #[cfg(target_os = "macos")]
    fn remove_test_home(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }
}
