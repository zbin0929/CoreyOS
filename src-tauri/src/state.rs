use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use std::collections::HashMap;

use parking_lot::Mutex;

use crate::adapters::AdapterRegistry;
use crate::channel_status::ChannelStatusCache;
use crate::config::GatewayConfig;
use crate::db::Db;
use crate::pty::Pty;
use crate::sandbox::PathAuthority;
use crate::scheduler::Scheduler;
use crate::wechat::WechatRegistry;

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
    /// Append-only mutation journal (`<app_data_dir>/changelog.jsonl`). Every
    /// config-writing IPC appends one entry; Phase 2.8 adds a UI to list and
    /// revert. Held as a `PathBuf` so each IPC can open/close on demand —
    /// writes are rare and small.
    pub changelog_path: PathBuf,
    /// Platform-native data directory (holds `caduceus.db` +
    /// `changelog.jsonl`). Surfaced to the UI via `app_paths` so users can
    /// locate their data on disk for backup or deletion.
    pub data_dir: PathBuf,
    /// Resolved path to the SQLite DB (`<data_dir>/caduceus.db`). Stored so
    /// the `app_paths` IPC doesn't have to re-derive it.
    pub db_path: PathBuf,
    /// WeChat QR-login provider registry (Phase 3 · T3.3). Wraps an
    /// `Arc<dyn QrProvider>`, so swapping from the stub to the real
    /// iLink client is a one-line change at startup with zero UI
    /// impact. Sessions live in the provider (not here) — this
    /// struct is effectively a lazy accessor.
    pub wechat: Arc<WechatRegistry>,
    /// Phase 3 · T3.4: cached per-channel liveness, derived from
    /// `~/.hermes/logs/*.log`. 30s TTL; the Channels page surfaces
    /// it as an extra pill. Arc so spawn_blocking can take a clone
    /// without holding a `State<'_>` reference across the await.
    pub channel_status: Arc<ChannelStatusCache>,
    /// Phase 4 · T4.5 — PTY registry keyed by caller-supplied id.
    /// Each open terminal tab corresponds to one entry; kill/close
    /// drops it from the map so the OS resources free immediately.
    pub ptys: Arc<Mutex<HashMap<String, Arc<Pty>>>>,
    /// Scheduler (2026-04-23) — cron-driven prompt runs. Spawned at
    /// startup iff the DB is available (no DB → no persistence → no
    /// scheduler). IPC commands call `scheduler.reload()` after any
    /// CRUD to make the worker re-read jobs.
    pub scheduler: Option<Arc<Scheduler>>,
}

impl AppState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        registry: AdapterRegistry,
        config: GatewayConfig,
        config_dir: PathBuf,
        db: Option<Arc<Db>>,
        changelog_path: PathBuf,
        data_dir: PathBuf,
        db_path: PathBuf,
        wechat: Arc<WechatRegistry>,
        channel_status: Arc<ChannelStatusCache>,
    ) -> Self {
        let adapters = Arc::new(registry);
        let scheduler = db
            .clone()
            .map(|db| Arc::new(Scheduler::spawn(db, adapters.clone())));
        Self {
            adapters,
            authority: Arc::new(PathAuthority::new()),
            config: Arc::new(RwLock::new(config)),
            config_dir,
            db,
            changelog_path,
            data_dir,
            db_path,
            wechat,
            channel_status,
            ptys: Arc::new(Mutex::new(HashMap::new())),
            scheduler,
        }
    }
}
