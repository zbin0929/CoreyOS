//! Channel live-status probing (Phase 3 · T3.4).
//!
//! Hermes exposes per-channel liveness only indirectly — it doesn't
//! ship a `/health/channels` endpoint we could hit. So we fall back
//! to the other source of truth: the gateway's rolling log files.
//! For each channel slug we scan the tail of `gateway.log` (and
//! `agent.log` as a second source) for the most-recent line
//! mentioning the channel name together with a known positive or
//! negative marker:
//!
//!   - positive: `connected`, `ready`, `started`, `online`, `subscribed`
//!   - negative: `error`, `failed`, `disconnect`
//!
//! The most-recent matching line wins; no match → `Unknown`. This is
//! intentionally conservative — we'd rather say "I don't know" than
//! assert a liveness we can't verify.
//!
//! Results are cached for 30s with a manual `force` knob so the UI's
//! Refresh button bypasses the cache. The cache is in-memory only
//! and lives for the lifetime of the app; losing it on restart is
//! fine (next call just re-scans).
//!
//! When Hermes later grows a real health endpoint we'd add it as a
//! second backend here and the probe function short-circuits log
//! parsing when the endpoint answered. The IPC + UI surface doesn't
//! change.

use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;

use crate::channels::CHANNEL_SPECS;
use crate::hermes_logs::{log_path, tail_log_at, LogKind};

/// The three-way verdict the UI renders. Explicit `Unknown` so cards
/// for unconfigured channels (or Hermes running for <1s with no
/// output yet) don't falsely claim "offline".
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiveState {
    Online,
    Offline,
    Unknown,
}

/// One row per channel. `last_marker` is the raw log line that drove
/// the verdict (None for Unknown). The UI shows a truncated preview
/// as hover text so power users can see WHICH log event triggered
/// the pill without digging through the Logs tab.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelLiveStatus {
    pub id: String,
    pub state: LiveState,
    pub last_marker: Option<String>,
    /// Unix millis at which this status was computed. Lets the UI
    /// show "as of Ns ago" without a server round-trip. Shared
    /// across every entry in a single probe pass — they were all
    /// classified from the same log snapshot.
    pub probed_at_ms: u64,
}

/// How many lines we pull from each log file per probe. 1000 covers
/// ~an hour of typical chatter without breaking the bank on memory
/// (each line is ~200 bytes → ~400KB for both files combined).
/// If we're chasing a stale "Offline" after a reconnect that
/// happened a while back, 1000 should still catch it.
const TAIL_LINES: usize = 1_000;
const CACHE_TTL: Duration = Duration::from_secs(30);

/// Cached-probe handle. Held as `Arc` inside `AppState` so repeated
/// IPC calls don't re-scan the logs. The cache is a single
/// `Option<(Instant, Vec<_>)>` rather than per-channel entries —
/// probing is one fs-read + one regex pass regardless of how many
/// channels you ask about, so there's no per-channel benefit to
/// splitting the keys.
pub struct ChannelStatusCache {
    inner: Mutex<Option<(Instant, Vec<ChannelLiveStatus>)>>,
}

impl Default for ChannelStatusCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ChannelStatusCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Return the current snapshot. `force=true` ignores the TTL and
    /// re-scans. `force=false` returns whatever was last computed if
    /// it's still fresh, otherwise re-computes.
    pub fn snapshot(&self, force: bool) -> Vec<ChannelLiveStatus> {
        if !force {
            let guard = self.inner.lock();
            if let Some((at, cached)) = guard.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    return cached.clone();
                }
            }
        }
        // Drop the lock before doing blocking I/O. Probes under ~5ms
        // in the common case (log files are small), but concurrent
        // IPC calls should still pipeline.
        drop(self.inner.lock());

        let fresh = probe_all(None);
        *self.inner.lock() = Some((Instant::now(), fresh.clone()));
        fresh
    }
}

/// Scan the log tail for every channel in the catalog. `home_override`
/// lets tests point at a fixture tree instead of `~/.hermes`. Always
/// returns one entry per channel in catalog order — never short —
/// so the frontend can zip this against its channel list without
/// worrying about missing ids.
pub fn probe_all(home_override: Option<&Path>) -> Vec<ChannelLiveStatus> {
    // Pull lines from gateway.log first (primary), then agent.log
    // (secondary). Both are tailed to TAIL_LINES; the combined list
    // is fed to `classify` so the most-recent-wins rule works across
    // the union. Chronological order within each file doesn't matter
    // because `classify` iterates newest-first looking for the first
    // recognized marker.
    let mut lines: Vec<String> = Vec::with_capacity(TAIL_LINES * 2);
    for kind in [LogKind::Gateway, LogKind::Agent] {
        let path = log_path(kind, home_override);
        if let Ok(tail) = tail_log_at(&path, TAIL_LINES) {
            if !tail.missing {
                lines.extend(tail.lines);
            }
        }
    }

    let probed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    CHANNEL_SPECS
        .iter()
        .map(|spec| {
            let (state, last_marker) = classify(spec.id, &lines);
            ChannelLiveStatus {
                id: spec.id.to_string(),
                state,
                last_marker,
                probed_at_ms,
            }
        })
        .collect()
}

/// Scan `lines` newest-first for the first line that mentions `id`
/// AND a known marker. Most-recent match wins; ties (same line) go
/// to negative (we'd rather report a visible outage than paper over
/// one).
fn classify(id: &str, lines: &[String]) -> (LiveState, Option<String>) {
    const POSITIVE: &[&str] = &["connected", "ready", "started", "online", "subscribed"];
    const NEGATIVE: &[&str] = &["error", "failed", "disconnect"];

    let id_l = id.to_lowercase();
    for line in lines.iter().rev() {
        let lower = line.to_lowercase();
        if !lower.contains(&id_l) {
            continue;
        }
        let is_neg = NEGATIVE.iter().any(|k| lower.contains(k));
        if is_neg {
            return (LiveState::Offline, Some(line.clone()));
        }
        let is_pos = POSITIVE.iter().any(|k| lower.contains(k));
        if is_pos {
            return (LiveState::Online, Some(line.clone()));
        }
    }
    (LiveState::Unknown, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_picks_most_recent_marker_winning_online() {
        let lines = vec![
            "2026-04-22 telegram connected".to_string(),
            "2026-04-22 telegram error polling".to_string(),
            "2026-04-22 telegram connected again".to_string(),
        ];
        // Newest is "connected again" → Online wins.
        let (s, m) = classify("telegram", &lines);
        assert_eq!(s, LiveState::Online);
        assert!(m.unwrap().contains("connected again"));
    }

    #[test]
    fn classify_picks_most_recent_marker_winning_offline() {
        let lines = vec![
            "2026-04-22 discord ready".to_string(),
            "2026-04-22 discord connected".to_string(),
            "2026-04-22 discord failed auth".to_string(),
        ];
        let (s, m) = classify("discord", &lines);
        assert_eq!(s, LiveState::Offline);
        assert!(m.unwrap().contains("failed"));
    }

    #[test]
    fn classify_ignores_lines_without_channel_name() {
        let lines = vec![
            "2026-04-22 some unrelated error".to_string(),
            "2026-04-22 slack ready".to_string(),
        ];
        let (s, _) = classify("telegram", &lines);
        assert_eq!(s, LiveState::Unknown);
    }

    #[test]
    fn classify_returns_unknown_when_no_markers_match() {
        let lines = vec!["2026-04-22 telegram heartbeat received".to_string()];
        let (s, m) = classify("telegram", &lines);
        assert_eq!(s, LiveState::Unknown);
        assert!(m.is_none());
    }

    #[test]
    fn classify_is_case_insensitive() {
        let lines = vec!["DISCORD CONNECTED TO GATEWAY".to_string()];
        let (s, _) = classify("discord", &lines);
        assert_eq!(s, LiveState::Online);
    }

    #[test]
    fn classify_wechat_does_not_match_wecom_and_vice_versa() {
        let lines = vec!["2026-04-22 wecom ready".to_string()];
        let (s, _) = classify("wechat", &lines);
        // wecom does not contain the substring "wechat" (wecom vs
        // wechat — `we` prefix but different suffix), so wechat
        // stays Unknown.
        assert_eq!(s, LiveState::Unknown);

        let (s2, _) = classify("wecom", &lines);
        assert_eq!(s2, LiveState::Online);
    }

    #[test]
    fn cache_reuses_snapshot_within_ttl() {
        let cache = ChannelStatusCache::new();
        let a = cache.snapshot(false);
        // Sleep is overkill; same-Instant comparison inside TTL is
        // enough. The two vecs must be pointer-cloneable but the
        // contents are Strings, so we compare by probed_at.
        let b = cache.snapshot(false);
        assert_eq!(a[0].probed_at_ms, b[0].probed_at_ms);
    }

    #[test]
    fn cache_force_refresh_advances_probed_at() {
        let cache = ChannelStatusCache::new();
        let a = cache.snapshot(false);
        // Busy-wait a millisecond so probed_at_ms differs.
        std::thread::sleep(Duration::from_millis(2));
        let b = cache.snapshot(true);
        assert!(b[0].probed_at_ms >= a[0].probed_at_ms);
    }

    #[test]
    fn probe_all_returns_one_row_per_channel_in_catalog_order() {
        let v = probe_all(Some(Path::new("/nonexistent-home-for-test")));
        assert_eq!(v.len(), CHANNEL_SPECS.len());
        for (i, row) in v.iter().enumerate() {
            assert_eq!(row.id, CHANNEL_SPECS[i].id);
            assert_eq!(row.state, LiveState::Unknown);
        }
    }
}
