//! WeChat QR-login scaffolding (Phase 3 · T3.3).
//!
//! WeChat credentials can't be typed into a text box — they arrive
//! via a QR scan against Tencent's iLink service. T3.3 ships the
//! state-machine skeleton the UI depends on (start / poll / cancel),
//! behind a `QrProvider` trait so the real iLink HTTP client can
//! drop in later without touching the frontend or IPC layer.
//!
//! This file ships TWO things:
//!
//!   1. `QrProvider` trait — the minimal async surface every future
//!      implementation must satisfy. A thin trait (not a 20-method
//!      behemoth) keeps the contract obvious and testable.
//!   2. `StubQrProvider` — a deterministic mock that auto-advances
//!      through `Pending → Scanning → Scanned` based on poll count.
//!      It's what the dev build and CI tests use today; production
//!      will flip over to `ILinkQrProvider` once we have live iLink
//!      credentials to test against.
//!
//! Why not hit Tencent directly today? Two reasons:
//!
//!   - iLink's API surface is undocumented and fragile. Landing a
//!     stub now means we can iterate on UX, i18n, error paths, and
//!     state-machine semantics without hammering a third-party
//!     endpoint we'd rather call sparingly during development.
//!   - The real iLink flow needs cookies + captcha + device
//!     fingerprints. That work is a self-contained ticket best
//!     isolated from the UI plumbing so we can throw it away if
//!     upstream changes shape again.
//!
//! The registry below keeps sessions in-memory only — QR codes are
//! short-lived (5 min max) and losing them on restart is fine: the
//! user just clicks "Start" again. No disk state to corrupt.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::hermes_config;

/// Per-session QR state, surfaced to the frontend on each poll.
///
/// The frontend renders a spinner on `Pending`, a "scanned — confirm
/// on your phone" hint on `Scanning`, and flips the channel card to
/// Configured on `Scanned`. `Expired` / `Cancelled` / `Failed` are
/// all terminal; the UI offers a "Start over" button.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QrStatus {
    /// Waiting for the user to point their phone camera at the QR.
    Pending,
    /// Phone detected the QR and is asking the user to confirm the
    /// login on the device. Not terminal — still polling.
    Scanning,
    /// User confirmed. Credentials were written to `.env` by the
    /// backend (the UI doesn't receive the session token — presence
    /// is enough to flip the card to Configured).
    Scanned,
    /// 5-minute hard timeout expired. Caller must restart.
    Expired,
    /// User hit "Cancel" in the UI.
    Cancelled,
    /// Upstream (iLink / stub) reported an error. `detail` is
    /// opaque but human-readable.
    Failed { detail: String },
}

impl QrStatus {
    /// Terminal states no longer need polling — the UI switches to
    /// the appropriate follow-up view without re-arming its timer.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            QrStatus::Scanned | QrStatus::Expired | QrStatus::Cancelled | QrStatus::Failed { .. }
        )
    }
}

/// The opaque payload returned from `wechat_qr_start`. Contains the
/// session id the UI must thread through subsequent poll / cancel
/// calls, and an SVG string that renders the QR code inline — no
/// extra network fetch, no dependency on a runtime QR crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStartResponse {
    pub qr_id: String,
    /// SVG markup. Embedded inline in the DOM; the UI never fetches
    /// it over the wire so there's no attack surface here.
    pub svg: String,
    /// Seconds until expiry. The UI shows a countdown.
    pub expires_in_s: u32,
}

/// What a poll returns. `elapsed_s` lets the UI show a progress
/// indicator without maintaining its own wall clock.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPollResponse {
    pub qr_id: String,
    pub status: QrStatus,
    pub elapsed_s: u32,
}

/// Provider contract. Real iLink integration will be a second
/// implementation sitting next to `StubQrProvider`.
#[async_trait]
pub trait QrProvider: Send + Sync {
    /// Produce a fresh QR session. Implementations own their own
    /// storage — the registry just hands back whatever id they mint.
    async fn start(&self) -> Result<QrStartResponse, QrError>;
    /// Look up the current state of `qr_id`. Implementations may
    /// advance internal state on each call (e.g. stub auto-advances
    /// after N polls). MUST return `NotFound` for unknown ids, not
    /// silently re-create — forces the UI to call `start` again
    /// after a backend restart.
    async fn poll(&self, qr_id: &str) -> Result<QrPollResponse, QrError>;
    /// Mark the session cancelled. Idempotent — calling twice is
    /// fine and returns the second cancellation as success.
    async fn cancel(&self, qr_id: &str) -> Result<(), QrError>;
}

/// Errors the provider can surface to the IPC layer. Kept small so
/// the UI's error-path branching stays shallow.
#[derive(Debug, thiserror::Error)]
pub enum QrError {
    #[error("qr session not found: {qr_id}")]
    NotFound { qr_id: String },
    #[error("backend error: {0}")]
    Backend(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

// ───────────────────────── Stub provider ─────────────────────────

/// In-memory state for a single stub session.
///
/// `created_at` drives both the 5-min expiry and the UI's elapsed
/// counter. `poll_count` is the ONLY thing the stub uses to advance
/// its state — which means tests can assert against a deterministic
/// "poll N times, expect Scanned" progression without sleeping.
struct StubSession {
    created_at: Instant,
    poll_count: u32,
    status: QrStatus,
}

pub struct StubQrProvider {
    sessions: Mutex<HashMap<String, StubSession>>,
    /// How many polls the stub stays in `Pending` before flipping to
    /// `Scanning`. Kept low (2) so the e2e test finishes quickly.
    polls_until_scanning: u32,
    /// Additional polls in `Scanning` before `Scanned`. Small for
    /// the same reason.
    polls_until_scanned: u32,
    /// The `.env` file we'll upsert `WECHAT_SESSION` into on scan.
    /// `None` disables the write (useful in unit tests that don't
    /// want HOME-dependent I/O).
    journal_path: Option<PathBuf>,
}

impl StubQrProvider {
    pub fn new(journal_path: Option<PathBuf>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            polls_until_scanning: 2,
            polls_until_scanned: 1,
            journal_path,
        }
    }
}

#[async_trait]
impl QrProvider for StubQrProvider {
    async fn start(&self) -> Result<QrStartResponse, QrError> {
        let qr_id = format!("stub-{}", uuid::Uuid::new_v4());
        let svg = synth_qr_svg(&qr_id);
        self.sessions.lock().insert(
            qr_id.clone(),
            StubSession {
                created_at: Instant::now(),
                poll_count: 0,
                status: QrStatus::Pending,
            },
        );
        Ok(QrStartResponse {
            qr_id,
            svg,
            expires_in_s: 300,
        })
    }

    async fn poll(&self, qr_id: &str) -> Result<QrPollResponse, QrError> {
        // We compute next state + writes under a short lock scope,
        // then drop the lock BEFORE touching disk so the `.env`
        // atomic write doesn't stall concurrent polls.
        let (status, elapsed_s, should_write) = {
            let mut guard = self.sessions.lock();
            let session = guard.get_mut(qr_id).ok_or_else(|| QrError::NotFound {
                qr_id: qr_id.to_string(),
            })?;

            // Terminal states short-circuit — no further mutation.
            if session.status.is_terminal() {
                let e = session.created_at.elapsed().as_secs() as u32;
                return Ok(QrPollResponse {
                    qr_id: qr_id.to_string(),
                    status: session.status.clone(),
                    elapsed_s: e,
                });
            }

            // 5-min expiry check before advancing.
            let elapsed = session.created_at.elapsed();
            if elapsed > Duration::from_secs(300) {
                session.status = QrStatus::Expired;
            } else {
                session.poll_count += 1;
                session.status = if session.poll_count <= self.polls_until_scanning {
                    QrStatus::Pending
                } else if session.poll_count <= self.polls_until_scanning + self.polls_until_scanned
                {
                    QrStatus::Scanning
                } else {
                    QrStatus::Scanned
                };
            }

            let status = session.status.clone();
            let elapsed_s = elapsed.as_secs() as u32;
            let should_write = matches!(status, QrStatus::Scanned);
            (status, elapsed_s, should_write)
        };

        // On Scanned: upsert WECHAT_SESSION in `.env`. We do this
        // even in the stub so the rest of the app (card state,
        // changelog) behaves end-to-end. The value is obviously not
        // a real token — the future iLink provider will overwrite
        // it with the real one on its first successful scan.
        if should_write {
            // Deterministic token per qr_id so tests can assert.
            let token = format!("stub-session-{qr_id}");
            hermes_config::write_env_key(
                "WECHAT_SESSION",
                Some(&token),
                self.journal_path.as_deref(),
            )?;
        }

        Ok(QrPollResponse {
            qr_id: qr_id.to_string(),
            status,
            elapsed_s,
        })
    }

    async fn cancel(&self, qr_id: &str) -> Result<(), QrError> {
        let mut guard = self.sessions.lock();
        let session = guard.get_mut(qr_id).ok_or_else(|| QrError::NotFound {
            qr_id: qr_id.to_string(),
        })?;
        if !session.status.is_terminal() {
            session.status = QrStatus::Cancelled;
        }
        Ok(())
    }
}

// ───────────────────────── Registry ─────────────────────────

/// The AppState-held handle. Just wraps an Arc<dyn QrProvider> so the
/// rest of the app doesn't have to know whether it's the stub or the
/// real iLink client.
pub struct WechatRegistry {
    provider: Arc<dyn QrProvider>,
}

impl WechatRegistry {
    pub fn new(provider: Arc<dyn QrProvider>) -> Self {
        Self { provider }
    }
    pub fn provider(&self) -> Arc<dyn QrProvider> {
        self.provider.clone()
    }
}

// ───────────────────────── QR SVG synth ─────────────────────────

/// Generate a QR-looking SVG deterministic from `seed`. This is NOT
/// a real QR code — it's a visual placeholder that looks like one so
/// screenshots and dev-mode demos read right. The real iLink flow
/// returns a proper scannable PNG that this fn is replaced by.
///
/// Why bother making a placeholder instead of a hardcoded image?
///   - Different `qr_id` values render as distinct patterns, which
///     makes "restart the flow" visually obvious.
///   - No binary assets checked in.
///   - Zero runtime dependencies — ~50 LoC string synthesis.
#[allow(clippy::needless_range_loop)]
fn synth_qr_svg(seed: &str) -> String {
    const N: usize = 21; // 21x21 is the smallest real QR size; visually right.
    const CELL: usize = 10;
    const SIZE: usize = N * CELL;

    // FNV-like seeded hash for deterministic pattern.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in seed.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }

    let mut cells = [[false; N]; N];
    for y in 0..N {
        for x in 0..N {
            // Rotate the hash per-cell with a cheap PRNG step.
            h = h
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            cells[y][x] = (h >> 33) & 1 == 1;
        }
    }

    // Paint the three finder patterns (top-left, top-right, bottom-
    // left) in the conventional QR style so the placeholder reads
    // unambiguously as "a QR". These are fixed bits of every real
    // QR; copying them costs us nothing.
    for &(ox, oy) in &[(0, 0), (N - 7, 0), (0, N - 7)] {
        for dy in 0..7 {
            for dx in 0..7 {
                let border = dx == 0 || dx == 6 || dy == 0 || dy == 6;
                let inner = (2..=4).contains(&dx) && (2..=4).contains(&dy);
                cells[oy + dy][ox + dx] = border || inner;
            }
        }
    }

    let mut svg = String::with_capacity(SIZE * SIZE); // loose upper bound
    use std::fmt::Write as _;
    write!(
        svg,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {SIZE} {SIZE}\" shape-rendering=\"crispEdges\"><rect width=\"{SIZE}\" height=\"{SIZE}\" fill=\"#fff\"/>"
    )
    .unwrap();
    for y in 0..N {
        for x in 0..N {
            if cells[y][x] {
                let px = x * CELL;
                let py = y * CELL;
                write!(
                    svg,
                    "<rect x=\"{px}\" y=\"{py}\" width=\"{CELL}\" height=\"{CELL}\" fill=\"#000\"/>"
                )
                .unwrap();
            }
        }
    }
    svg.push_str("</svg>");
    svg
}

#[cfg(test)]
mod tests {
    use super::*;

    // Serialise with the HOME lock: this test reaches `Scanned`, which
    // triggers the stub's `.env` upsert. That upsert resolves the env
    // path through `hermes_dir()` (reads `$HOME` / `%USERPROFILE%`), so
    // it must not interleave with any other test that mutates HOME.
    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn stub_advances_through_pending_scanning_scanned() {
        let _home_guard = crate::skills::HOME_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Point HOME + USERPROFILE at an isolated tempdir so the `.env`
        // write doesn't pollute the dev/CI user's real profile.
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-wechat-advance-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir_all(tmp.join(".hermes")).unwrap();
        let original_home = std::env::var_os("HOME");
        let original_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", &tmp);
        std::env::set_var("USERPROFILE", &tmp);

        let p = StubQrProvider::new(None);
        let start = p.start().await.unwrap();
        // Poll 1 → Pending, 2 → Pending (polls_until_scanning=2),
        // 3 → Scanning (polls_until_scanned=1 starting from 3),
        // 4 → Scanned.
        let r1 = p.poll(&start.qr_id).await.unwrap();
        assert_eq!(r1.status, QrStatus::Pending);
        let r2 = p.poll(&start.qr_id).await.unwrap();
        assert_eq!(r2.status, QrStatus::Pending);
        let r3 = p.poll(&start.qr_id).await.unwrap();
        assert_eq!(r3.status, QrStatus::Scanning);
        let r4 = p.poll(&start.qr_id).await.unwrap();
        assert_eq!(r4.status, QrStatus::Scanned);
        // Terminal — subsequent polls stay on Scanned.
        let r5 = p.poll(&start.qr_id).await.unwrap();
        assert_eq!(r5.status, QrStatus::Scanned);

        match original_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match original_userprofile {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
    }

    #[tokio::test]
    async fn cancel_is_idempotent_and_wins_over_advancement() {
        let p = StubQrProvider::new(None);
        let s = p.start().await.unwrap();
        p.cancel(&s.qr_id).await.unwrap();
        p.cancel(&s.qr_id).await.unwrap(); // idempotent
        let r = p.poll(&s.qr_id).await.unwrap();
        assert_eq!(r.status, QrStatus::Cancelled);
    }

    #[tokio::test]
    async fn poll_unknown_id_reports_not_found() {
        let p = StubQrProvider::new(None);
        let err = p.poll("nope").await.unwrap_err();
        assert!(matches!(err, QrError::NotFound { .. }));
    }

    #[test]
    fn synth_qr_svg_is_deterministic_per_seed() {
        let a1 = synth_qr_svg("seed-a");
        let a2 = synth_qr_svg("seed-a");
        let b = synth_qr_svg("seed-b");
        assert_eq!(a1, a2);
        assert_ne!(a1, b);
        // Sanity: starts with the SVG header we advertise.
        assert!(a1.starts_with("<svg xmlns"));
    }

    // Whole test body runs under the HOME lock — we mutate `$HOME`
    // to isolate the `.env` write, so no other test in the crate may
    // touch HOME concurrently.
    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn scanned_write_uses_stub_token_matching_qr_id() {
        let _home_guard = crate::skills::HOME_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Point HOME (and USERPROFILE, for Windows CI where `$HOME`
        // isn't populated) at a fresh tempdir.
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-wechat-stub-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir_all(tmp.join(".hermes")).unwrap();
        let original_home = std::env::var_os("HOME");
        let original_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", &tmp);
        std::env::set_var("USERPROFILE", &tmp);

        let p = StubQrProvider::new(None);
        let s = p.start().await.unwrap();
        // 4 polls → Scanned.
        for _ in 0..4 {
            let _ = p.poll(&s.qr_id).await.unwrap();
        }
        let env_raw = std::fs::read_to_string(tmp.join(".hermes/.env")).unwrap();
        assert!(env_raw.contains("WECHAT_SESSION="));
        assert!(env_raw.contains(&s.qr_id));

        match original_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match original_userprofile {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}
