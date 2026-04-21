use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::adapters::AdapterRegistry;
use crate::config::GatewayConfig;
use crate::db::Db;
use crate::sandbox::PathAuthority;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub adapters: Arc<AdapterRegistry>,
    pub authority: Arc<PathAuthority>,
    /// Current gateway config (in-memory snapshot of the on-disk JSON).
    /// Writes go through `ipc::config::config_set` which persists + hot-swaps
    /// the adapter. Not behind a `Mutex`-async because updates are rare and
    /// lock hold time is <1ms.
    pub config: Arc<RwLock<GatewayConfig>>,
    /// Directory where `gateway.json` lives. Resolved once at startup from
    /// Tauri's `app.path().app_config_dir()`.
    pub config_dir: PathBuf,
    /// SQLite handle for session/message persistence. `None` if initialization
    /// failed at startup (logged once; the UI still works, just doesn't
    /// persist). `Option` rather than aborting lets the app launch even on a
    /// read-only home dir.
    pub db: Option<Arc<Db>>,
}

impl AppState {
    pub fn new(
        registry: AdapterRegistry,
        config: GatewayConfig,
        config_dir: PathBuf,
        db: Option<Arc<Db>>,
    ) -> Self {
        Self {
            adapters: Arc::new(registry),
            authority: Arc::new(PathAuthority::new()),
            config: Arc::new(RwLock::new(config)),
            config_dir,
            db,
        }
    }
}
