use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};

use std::collections::HashMap;

use parking_lot::Mutex;

use crate::adapters::AdapterRegistry;
use crate::channel_status::ChannelStatusCache;
use crate::config::GatewayConfig;
use crate::db::Db;
use crate::ipc::download::DownloadManager;
#[cfg(feature = "rag")]
use crate::ipc::embedding::BgeM3Embedder;
use crate::pty::Pty;
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
    /// Phase 3 · T3.4: cached per-channel liveness, derived from
    /// `~/.hermes/logs/*.log`. 30s TTL; the Channels page surfaces
    /// it as an extra pill. Arc so spawn_blocking can take a clone
    /// without holding a `State<'_>` reference across the await.
    pub channel_status: Arc<ChannelStatusCache>,
    /// Phase 4 · T4.5 — PTY registry keyed by caller-supplied id.
    /// Each open terminal tab corresponds to one entry; kill/close
    /// drops it from the map so the OS resources free immediately.
    pub ptys: Arc<Mutex<HashMap<String, Arc<Pty>>>>,
    pub workflow_runs: Arc<Mutex<HashMap<String, crate::workflow::engine::WorkflowRun>>>,
    /// Per-run cancellation flags. The executor's `should_cancel`
    /// hook reads from here on every step boundary; flipping the
    /// `AtomicBool` makes the engine exit at the next step. The
    /// flag is allocated by `spawn_run_executor` when the run
    /// starts and cleaned up when the run reaches a terminal state
    /// — but we don't bother garbage-collecting flags for
    /// long-completed runs since they're a few bytes each and the
    /// HashMap's lifetime is bounded by the app session anyway.
    pub workflow_cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub download_manager: Arc<DownloadManager>,
    #[cfg(feature = "rag")]
    pub embedder: Arc<Mutex<Option<BgeM3Embedder>>>,
    // 2026-04-23 pm (T6.8): removed the `scheduler: Option<Arc<Scheduler>>`
    // field. Hermes' gateway owns cron scheduling now; Corey only
    // reads/writes `~/.hermes/cron/jobs.json`. See `hermes_cron.rs`.
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
        channel_status: Arc<ChannelStatusCache>,
    ) -> Self {
        let adapters = Arc::new(registry);
        Self {
            adapters,
            authority: Arc::new(PathAuthority::new()),
            config: Arc::new(RwLock::new(config)),
            config_dir,
            db,
            changelog_path,
            data_dir,
            db_path,
            channel_status,
            ptys: Arc::new(Mutex::new(HashMap::new())),
            workflow_runs: Arc::new(Mutex::new(HashMap::new())),
            workflow_cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(DownloadManager::new()),
            #[cfg(feature = "rag")]
            embedder: Arc::new(Mutex::new(None)),
        }
    }
}
