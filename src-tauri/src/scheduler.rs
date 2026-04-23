//! Scheduler — cron-driven prompt runs.
//!
//! Users define one or more `SchedulerJob`s. Each job has a name, a cron
//! expression (6-field form `sec min hour dom month dow`), and a prompt
//! that will be sent to the adapter when the schedule fires.
//!
//! # Runtime model
//!
//! A single background task owns the authoritative view of "next fire
//! time per job" and sleeps until the nearest. When it wakes, it:
//!   1. pops every job whose next-fire is in the past,
//!   2. executes each in parallel via `adapter.chat_once`,
//!   3. updates `last_run_*` fields in SQLite,
//!   4. recomputes the sleep target.
//!
//! The worker reacts to three signals:
//!   - a fresh CRUD write (`reload` mpsc channel)
//!   - the fire-time deadline
//!   - shutdown (drop of the `Scheduler` handle)
//!
//! This approach avoids the complexity of `tokio-cron-scheduler` (which
//! bundles its own persistence, reload, and shutdown machinery that
//! duplicates what SQLite + tokio already give us).

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Utc};
use cron::Schedule;
use tauri::async_runtime::{spawn as tauri_spawn, JoinHandle};
use tokio::sync::{mpsc, Notify};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::adapters::{AdapterRegistry, ChatMessageDto, ChatTurn};
use crate::db::{Db, SchedulerJobRow};

/// Maximum number of concurrent fires the worker will spawn per tick.
/// Guards against a misconfigured job + long-sleeping app producing a
/// thundering herd of concurrent chat_once calls on wake-up.
const MAX_CONCURRENT_FIRES: usize = 4;

/// Validate a cron expression against the 6-field form expected by the
/// `cron` crate. Returns a human-readable error message on failure.
pub fn validate_cron(expr: &str) -> Result<(), String> {
    Schedule::from_str(expr).map(|_| ()).map_err(|e| e.to_string())
}

/// Given a cron expression and a reference time, return the next fire
/// time after `from` (or `None` if the schedule produces no future
/// times — eg. an explicit past-only expression).
pub fn next_fire_after(expr: &str, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    Schedule::from_str(expr).ok()?.after(&from).next()
}

/// Public handle surfaced on `AppState`. IPC commands call `reload()`
/// after any CRUD write so the worker re-reads jobs and adjusts its
/// sleep target.
pub struct Scheduler {
    reload_tx: mpsc::Sender<()>,
    /// Held so the background task is dropped (and cancelled) when the
    /// `Scheduler` itself is dropped. We never poll the handle directly —
    /// the worker owns its own exit logic via the reload channel close.
    _join: JoinHandle<()>,
}

impl Scheduler {
    /// Spawn the background worker. Must be called from a context where
    /// Tauri's async runtime is available (eg. the `setup` hook or any
    /// IPC command). Using `tauri::async_runtime::spawn` instead of
    /// `tokio::spawn` lets this work during setup — `tokio::spawn`
    /// requires an active reactor on the current thread, which Tauri 2
    /// hasn't attached yet at setup time.
    pub fn spawn(db: Arc<Db>, adapters: Arc<AdapterRegistry>) -> Self {
        let (reload_tx, reload_rx) = mpsc::channel(8);
        let notify = Arc::new(Notify::new());
        let join = tauri_spawn(run_loop(db, adapters, reload_rx, notify));
        Self {
            reload_tx,
            _join: join,
        }
    }

    /// Ask the worker to re-read jobs from SQLite and recompute sleep.
    /// Non-blocking; a send failure (receiver closed) is logged but
    /// otherwise tolerated.
    pub fn reload(&self) {
        if let Err(e) = self.reload_tx.try_send(()) {
            warn!(error = %e, "scheduler reload signal dropped");
        }
    }
}

/// In-memory view of a scheduled job plus its next fire time. Keeping
/// the parsed `Schedule` lets us recompute next-fires without re-parsing
/// the cron string on every tick.
struct LiveJob {
    row: SchedulerJobRow,
    schedule: Schedule,
    next_fire: DateTime<Utc>,
}

async fn run_loop(
    db: Arc<Db>,
    adapters: Arc<AdapterRegistry>,
    mut reload_rx: mpsc::Receiver<()>,
    _notify: Arc<Notify>,
) {
    info!("scheduler loop started");
    let mut live = load_live_jobs(&db);

    loop {
        let now = Utc::now();
        // Determine sleep target: the nearest future next_fire across
        // enabled jobs. If no jobs are scheduled, sleep for an hour and
        // poll again (cheap — the worker is idle).
        let next = live.iter().map(|j| j.next_fire).min();
        let sleep_for = match next {
            Some(t) if t > now => (t - now)
                .to_std()
                .unwrap_or(StdDuration::from_secs(3600))
                .min(StdDuration::from_secs(3600)),
            Some(_) => StdDuration::from_millis(0),
            None => StdDuration::from_secs(3600),
        };

        tokio::select! {
            _ = tokio::time::sleep(sleep_for) => {}
            signal = reload_rx.recv() => {
                if signal.is_none() {
                    info!("scheduler reload channel closed, exiting");
                    return;
                }
                live = load_live_jobs(&db);
                continue;
            }
        }

        // Fire everything that's due now (<= now).
        let now = Utc::now();
        let mut fires: Vec<LiveJob> = Vec::new();
        live.retain(|j| {
            if j.next_fire <= now {
                fires.push(LiveJob {
                    row: j.row.clone(),
                    schedule: j.schedule.clone(),
                    next_fire: j.next_fire,
                });
                false
            } else {
                true
            }
        });

        // Cap concurrent fires so a cron-every-second misconfiguration
        // doesn't flood the adapter.
        for chunk in fires.chunks(MAX_CONCURRENT_FIRES) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|j| {
                    let db = db.clone();
                    let adapters = adapters.clone();
                    let row = j.row.clone();
                    tokio::spawn(async move { execute_one(db, adapters, row).await })
                })
                .collect();
            for h in handles {
                let _ = h.await;
            }
        }

        // Re-insert with fresh next_fire computed from the advanced
        // clock. Edge case: if the machine slept through many
        // intervals, `after(now)` jumps to the NEXT upcoming fire,
        // not every missed one. Missed fires are dropped by design —
        // this is a cron scheduler, not a job queue.
        for mut j in fires {
            if let Some(next) = j.schedule.after(&now).next() {
                j.next_fire = next;
                live.push(j);
            }
        }
    }
}

fn load_live_jobs(db: &Db) -> Vec<LiveJob> {
    let rows = match db.list_scheduler_jobs() {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "scheduler: failed to load jobs");
            return Vec::new();
        }
    };
    let now = Utc::now();
    let mut out = Vec::new();
    for row in rows {
        if !row.enabled {
            continue;
        }
        let schedule = match Schedule::from_str(&row.cron_expression) {
            Ok(s) => s,
            Err(e) => {
                warn!(job = %row.id, error = %e, "scheduler: invalid cron expression, skipping");
                continue;
            }
        };
        let Some(next_fire) = schedule.after(&now).next() else {
            continue;
        };
        out.push(LiveJob {
            row,
            schedule,
            next_fire,
        });
    }
    out
}

async fn execute_one(db: Arc<Db>, adapters: Arc<AdapterRegistry>, job: SchedulerJobRow) {
    let started_at = Utc::now();
    debug!(job = %job.id, name = %job.name, "scheduler: firing job");

    let adapter = match adapters.get(&job.adapter_id) {
        Some(a) => a,
        None => {
            let msg = format!("adapter '{}' not registered", job.adapter_id);
            let _ = db.update_scheduler_job_last_run(
                &job.id,
                started_at.timestamp(),
                false,
                Some(&msg),
            );
            warn!(job = %job.id, error = %msg, "scheduler: adapter missing");
            return;
        }
    };

    let turn = ChatTurn {
        messages: vec![ChatMessageDto {
            role: "user".into(),
            content: job.prompt.clone(),
            attachments: Vec::new(),
        }],
        model: None,
        cwd: None,
    };

    let outcome = adapter.chat_once(turn).await;
    let ts = Utc::now().timestamp();
    match outcome {
        Ok(reply) => {
            debug!(
                job = %job.id,
                bytes = reply.len(),
                "scheduler: job completed ok"
            );
            let _ = db.update_scheduler_job_last_run(&job.id, ts, true, None);
        }
        Err(e) => {
            let msg = e.to_string();
            warn!(job = %job.id, error = %msg, "scheduler: job failed");
            let _ = db.update_scheduler_job_last_run(&job.id, ts, false, Some(&msg));
        }
    }
}

/// Helpers used by the IPC layer to build fresh rows.

pub fn new_job_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_unix() -> i64 {
    Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_cron_accepts_six_field_form() {
        assert!(validate_cron("0 0 9 * * *").is_ok());
        assert!(validate_cron("0 */5 * * * *").is_ok());
    }

    #[test]
    fn validate_cron_rejects_garbage() {
        assert!(validate_cron("not a cron").is_err());
        assert!(validate_cron("").is_err());
    }

    #[test]
    fn next_fire_moves_forward() {
        // Every day at 09:00 — next fire should be strictly after `from`.
        let from = DateTime::parse_from_rfc3339("2026-04-23T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let next = next_fire_after("0 0 9 * * *", from).unwrap();
        assert!(next > from);
    }
}
