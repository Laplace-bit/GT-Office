//! Native window chrome enhancements.
//!
//! On macOS the shell applies an `NSVisualEffectView` (Vibrancy) behind the
//! webview so the app gets authentic system frosted glass instead of a CSS
//! `backdrop-filter` simulation. The opaque app base becomes transparent (see
//! the frontend `data-vb-native-vibrancy` flag) so the native material shows
//! through the semi-transparent surfaces of the file, git and terminal panes.
//!
//! Everything here is a no-op on non-macOS platforms: Windows and Linux keep
//! the existing CSS-glass rendering untouched.

use std::sync::atomic::{AtomicBool, Ordering};

static NATIVE_VIBRANCY_APPLIED: AtomicBool = AtomicBool::new(false);

/// Apply native macOS window vibrancy to `window`.
///
/// Returns `true` when the material was applied successfully. The result is
/// cached so the frontend can query [`is_native_vibrancy_active`] without
/// re-applying. On non-macOS targets this is always a no-op returning `false`.
pub fn apply_native_vibrancy(window: &tauri::WebviewWindow) -> bool {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        // `UnderWindowBackground` is the neutral, appearance-adaptive material
        // used for window content; it blends with light/dark mode automatically.
        match apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        ) {
            Ok(()) => {
                NATIVE_VIBRANCY_APPLIED.store(true, Ordering::Relaxed);
                tracing::info!("native macOS window vibrancy applied");
                true
            }
            Err(error) => {
                tracing::warn!(%error, "failed to apply native window vibrancy");
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        false
    }
}

/// Whether native window vibrancy was applied during setup.
pub fn is_native_vibrancy_active() -> bool {
    NATIVE_VIBRANCY_APPLIED.load(Ordering::Relaxed)
}
