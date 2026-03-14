#[cfg(not(target_os = "windows"))]
use std::{
    collections::HashMap,
    sync::{OnceLock, RwLock},
};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::{ffi::c_void, ptr, slice};

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
                Err(_) => memory_store_secret(&self.service_name, reference, value)
                    .map_err(|message| SecurityError::StoreFailed {
                        code: format!("{}_MEMORY_STORE_FAILED", self.error_namespace),
                        message,
                    }),
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
    guard.insert(
        fallback_key(service_name, reference),
        value.to_string(),
    );
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
fn os_store_secret(
    service_name: &str,
    error_namespace: &str,
    reference: &str,
    value: &str,
) -> SecurityResult<()> {
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
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            reference,
            "-s",
            service_name,
            "-w",
        ])
        .output()
        .map_err(|error| SecurityError::LoadFailed {
            code: format!("{}_LOAD_FAILED", error_namespace),
            message: error.to_string(),
        })?;
    if output.status.success() {
        let secret = String::from_utf8(output.stdout).map_err(|error| SecurityError::LoadFailed {
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
        let secret = String::from_utf8(output.stdout).map_err(|error| SecurityError::LoadFailed {
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

    #[test]
    fn rejects_empty_reference() {
        let store = SecretStore::new("gtoffice.test", "TEST_SECRET");
        let error = store.store("  ", "value").unwrap_err().to_string();
        assert!(error.contains("TEST_SECRET_INVALID_REF"));
    }
}
