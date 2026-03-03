#[cfg(not(target_os = "windows"))]
use std::{
    collections::HashMap,
    sync::{OnceLock, RwLock},
};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;
#[cfg(target_os = "windows")]
use std::{ffi::c_void, ptr, slice};

const CREDENTIAL_SERVICE: &str = "gtoffice.channel";

#[cfg(not(target_os = "windows"))]
static MEMORY_FALLBACK: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();

#[cfg(not(target_os = "windows"))]
fn memory_store_secret(reference: &str, value: &str) -> Result<(), String> {
    let lock = MEMORY_FALLBACK.get_or_init(|| RwLock::new(HashMap::new()));
    let mut guard = lock
        .write()
        .map_err(|_| "CHANNEL_CREDENTIAL_MEMORY_STORE_FAILED".to_string())?;
    guard.insert(reference.to_string(), value.to_string());
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn memory_load_secret(reference: &str) -> Result<String, String> {
    let lock = MEMORY_FALLBACK.get_or_init(|| RwLock::new(HashMap::new()));
    let guard = lock
        .read()
        .map_err(|_| "CHANNEL_CREDENTIAL_MEMORY_LOAD_FAILED".to_string())?;
    guard
        .get(reference)
        .cloned()
        .ok_or_else(|| "CHANNEL_CREDENTIAL_NOT_FOUND".to_string())
}

#[cfg(target_os = "macos")]
fn os_store_secret(reference: &str, value: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            reference,
            "-s",
            CREDENTIAL_SERVICE,
            "-w",
            value,
            "-U",
        ])
        .output()
        .map_err(|error| format!("CHANNEL_CREDENTIAL_STORE_FAILED: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "CHANNEL_CREDENTIAL_STORE_FAILED: {}",
        String::from_utf8_lossy(&output.stderr)
    ))
}

#[cfg(target_os = "macos")]
fn os_load_secret(reference: &str) -> Result<String, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            reference,
            "-s",
            CREDENTIAL_SERVICE,
            "-w",
        ])
        .output()
        .map_err(|error| format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"))?;
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map(|value| value.trim().to_string())
            .map_err(|error| format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"));
    }
    Err(format!(
        "CHANNEL_CREDENTIAL_LOAD_FAILED: {}",
        String::from_utf8_lossy(&output.stderr)
    ))
}

#[cfg(target_os = "linux")]
fn os_store_secret(reference: &str, value: &str) -> Result<(), String> {
    let output = Command::new("secret-tool")
        .args([
            "store",
            "--label",
            "GT Office Channel Credential",
            "service",
            CREDENTIAL_SERVICE,
            "account",
            reference,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(stdin) = child.stdin.as_mut() {
                stdin.write_all(value.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|error| format!("CHANNEL_CREDENTIAL_STORE_FAILED: {error}"))?;

    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "CHANNEL_CREDENTIAL_STORE_FAILED: {}",
        String::from_utf8_lossy(&output.stderr)
    ))
}

#[cfg(target_os = "linux")]
fn os_load_secret(reference: &str) -> Result<String, String> {
    let output = Command::new("secret-tool")
        .args([
            "lookup",
            "service",
            CREDENTIAL_SERVICE,
            "account",
            reference,
        ])
        .output()
        .map_err(|error| format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"))?;
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map(|value| value.trim().to_string())
            .map_err(|error| format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"));
    }
    Err(format!(
        "CHANNEL_CREDENTIAL_LOAD_FAILED: {}",
        String::from_utf8_lossy(&output.stderr)
    ))
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct FILETIME {
    dw_low_date_time: u32,
    dw_high_date_time: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct CREDENTIAL_ATTRIBUTEW {
    keyword: *mut u16,
    flags: u32,
    value_size: u32,
    value: *mut u8,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct CREDENTIALW {
    flags: u32,
    type_: u32,
    target_name: *mut u16,
    comment: *mut u16,
    last_written: FILETIME,
    credential_blob_size: u32,
    credential_blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut CREDENTIAL_ATTRIBUTEW,
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
    fn CredWriteW(credential: *const CREDENTIALW, flags: u32) -> i32;
    fn CredReadW(
        target_name: *const u16,
        type_: u32,
        flags: u32,
        credential: *mut *mut CREDENTIALW,
    ) -> i32;
    fn CredFree(buffer: *mut c_void);
}

#[cfg(target_os = "windows")]
fn credential_target(reference: &str) -> String {
    format!("{CREDENTIAL_SERVICE}:{reference}")
}

#[cfg(target_os = "windows")]
fn to_utf16_null_terminated(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn os_store_secret(reference: &str, value: &str) -> Result<(), String> {
    let target = credential_target(reference);
    let mut target_w = to_utf16_null_terminated(&target);
    let mut user_w = to_utf16_null_terminated("gtoffice");
    let mut blob = value.as_bytes().to_vec();

    let credential_blob_size = u32::try_from(blob.len())
        .map_err(|_| "CHANNEL_CREDENTIAL_STORE_FAILED: secret too large".to_string())?;

    let credential = CREDENTIALW {
        flags: 0,
        type_: CRED_TYPE_GENERIC,
        target_name: target_w.as_mut_ptr(),
        comment: ptr::null_mut(),
        last_written: FILETIME {
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
        // SAFETY: Pointers are valid for the duration of the call and point to initialized memory.
        CredWriteW(&credential, 0)
    };
    if status != 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    Err(format!("CHANNEL_CREDENTIAL_STORE_FAILED: {error}"))
}

#[cfg(target_os = "windows")]
fn os_load_secret(reference: &str) -> Result<String, String> {
    let target = credential_target(reference);
    let target_w = to_utf16_null_terminated(&target);
    let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
    let status = unsafe {
        // SAFETY: target_w is null-terminated and lives for the duration of the call.
        CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr)
    };
    if status == 0 {
        let error = std::io::Error::last_os_error();
        return Err(format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"));
    }
    if credential_ptr.is_null() {
        return Err("CHANNEL_CREDENTIAL_LOAD_FAILED: empty credential pointer".to_string());
    }

    let secret = unsafe {
        // SAFETY: credential_ptr is returned by CredReadW and valid until CredFree is called.
        let credential = &*credential_ptr;
        if credential.credential_blob.is_null() || credential.credential_blob_size == 0 {
            CredFree(credential_ptr as *mut c_void);
            return Err("CHANNEL_CREDENTIAL_NOT_FOUND".to_string());
        }
        let bytes = slice::from_raw_parts(
            credential.credential_blob as *const u8,
            credential.credential_blob_size as usize,
        )
        .to_vec();
        CredFree(credential_ptr as *mut c_void);
        String::from_utf8(bytes).map_err(|error| format!("CHANNEL_CREDENTIAL_LOAD_FAILED: {error}"))
    }?;

    if secret.trim().is_empty() {
        return Err("CHANNEL_CREDENTIAL_NOT_FOUND".to_string());
    }
    Ok(secret)
}

pub fn store_secret(reference: &str, value: &str) -> Result<(), String> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err("CHANNEL_CREDENTIAL_INVALID_REF".to_string());
    }
    if value.trim().is_empty() {
        return Err("CHANNEL_CREDENTIAL_EMPTY".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        return os_store_secret(reference, value);
    }

    #[cfg(not(target_os = "windows"))]
    {
        match os_store_secret(reference, value) {
            Ok(()) => Ok(()),
            Err(_error) => memory_store_secret(reference, value),
        }
    }
}

pub fn load_secret(reference: &str) -> Result<String, String> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err("CHANNEL_CREDENTIAL_INVALID_REF".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        return os_load_secret(reference);
    }

    #[cfg(not(target_os = "windows"))]
    {
        match os_load_secret(reference) {
            Ok(secret) if !secret.trim().is_empty() => Ok(secret),
            _ => memory_load_secret(reference),
        }
    }
}
