//! IPC bindings for the native menubar.
//!
//! Currently one command: `menu_set_locale`. The menu is built once at
//! app startup (English fallback) so there's always a usable bar
//! before JS loads; the frontend then calls into here with the i18n
//! resolved locale so the user sees labels in their chosen language
//! within a frame or two of boot.

use tauri::{AppHandle, Runtime};

use crate::error::{IpcError, IpcResult};
use crate::menu::{self, Locale};

#[tauri::command]
pub async fn menu_set_locale<R: Runtime>(app: AppHandle<R>, lang: String) -> IpcResult<()> {
    let locale = Locale::from_tag(&lang);
    menu::set_locale(&app, locale).map_err(|e| IpcError::Internal {
        message: format!("failed to swap menu locale: {e}"),
    })?;
    Ok(())
}
