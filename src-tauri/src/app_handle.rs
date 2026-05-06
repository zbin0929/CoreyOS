//! Process-global Tauri `AppHandle` accessor.
//!
//! Several long-lived background tasks (workflow executor, scheduler
//! tick, gateway watchdog) need to emit events back to the frontend
//! but live too far down the call stack to receive an `AppHandle` via
//! parameter without threading it through 4-5 layers. This module
//! gives them a single read-only escape hatch:
//!
//! ```ignore
//! if let Some(app) = crate::app_handle::get() {
//!     let _ = app.emit("workflow:run-finished", payload);
//! }
//! ```
//!
//! ## Design choices
//!
//! - `OnceLock` (not `Mutex<Option<…>>`): set exactly once during
//!   `tauri::Builder::setup()`, immutable thereafter. Any second
//!   `set` call is a programming error and silently ignored.
//! - `get()` returns `Option<AppHandle>`: callers MUST handle the
//!   `None` case. This happens in unit tests (no Tauri runtime) and
//!   during the brief window between process start and `setup()`
//!   firing. Treating these as a no-op (not a panic) keeps tests
//!   trivial.
//! - **NOT a replacement for `State<AppState>`**: command handlers
//!   already have access via the function signature; use that.
//!   `app_handle::get()` is for code paths that can't.

use std::sync::OnceLock;
use tauri::AppHandle;

static HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Install the global handle. Called exactly once, from
/// `tauri::Builder::setup()`. Subsequent calls are no-ops.
pub fn set(handle: AppHandle) {
    if HANDLE.set(handle).is_err() {
        tracing::debug!("app_handle::set called more than once; ignoring");
    }
}

/// Read the global handle. Returns `None` outside a running Tauri
/// app (tests, early-startup code paths).
pub fn get() -> Option<AppHandle> {
    HANDLE.get().cloned()
}
