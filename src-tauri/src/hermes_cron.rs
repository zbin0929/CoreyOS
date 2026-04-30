//! Thin wrapper around Hermes's native cron surface (T6.8).
//!
//! Hermes Agent natively owns cron scheduling — see upstream docs at
//! <https://hermes-agent.nousresearch.com/docs/user-guide/features/cron>.
//! Jobs are stored in `~/.hermes/cron/jobs.json`; run outputs under
//! `~/.hermes/cron/output/{job_id}/{timestamp}.md`. The Hermes gateway
//! process (or CLI) is responsible for executing them.
//!
//! Corey's Scheduler page used to carry its own Rust worker + SQLite
//! table — pure duplication flagged by `docs/10-product-audit-2026-04-23.md`.
//! T6.8 deletes that stack and replaces it with this thin accessor:
//!
//!   - `load_jobs()` / `save_jobs()` — round-trip the JSON file. Unknown
//!     fields set by Hermes are preserved via a `flatten` catch-all so we
//!     don't lose data Hermes might add between versions.
//!   - `upsert_job()` / `delete_job()` — atomic writes on top of the
//!     above.
//!   - `list_runs()` — scan `output/{job_id}/*.md` for the Runs drawer.
//!
//! We do NOT run jobs ourselves. The only observable effect of Corey on
//! cron scheduling is writing the JSON file — Hermes' gateway picks it up.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::fs_atomic;
use crate::hermes_config::hermes_dir;

const CRON_SUBDIR: &str = "cron";
const JOBS_FILE: &str = "jobs.json";
const OUTPUT_SUBDIR: &str = "output";

/// Maximum number of run files surfaced per job. The drawer only needs
/// the most-recent handful; older runs stay on disk but we don't list
/// them all (a daily job across a year would otherwise balloon the
/// IPC response).
const MAX_RUNS_PER_JOB: usize = 20;

pub fn cron_dir() -> io::Result<PathBuf> {
    Ok(hermes_dir()?.join(CRON_SUBDIR))
}

pub fn jobs_path() -> io::Result<PathBuf> {
    Ok(cron_dir()?.join(JOBS_FILE))
}

pub fn output_dir(job_id: &str) -> io::Result<PathBuf> {
    // Keep the layout mirror-identical to Hermes's: `output/{job_id}/`.
    // No sanitisation here — `job_id` is always a UUID we minted or a
    // Hermes-supplied id (also a UUID). The caller (ipc layer) still
    // filters for `.md` extensions to avoid accidental directory escapes.
    Ok(cron_dir()?.join(OUTPUT_SUBDIR).join(job_id))
}

/// Mirror of one entry in `~/.hermes/cron/jobs.json`.
///
/// Uses `#[serde(default)]` liberally so a partial Hermes record (e.g.
/// one that omits `skills`) still round-trips without panicking. The
/// `extra` flatten catches any upstream-added fields we don't model so
/// a `load → save` cycle preserves them.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HermesJob {
    pub id: String,
    /// User-facing label. Optional in Hermes's schema; we synthesize
    /// from the prompt's first 60 chars if absent.
    #[serde(default)]
    pub name: Option<String>,
    /// Schedule. Accepts BOTH legacy (cron string like `"0 8 * * *"`,
    /// `"30m"`, ISO timestamp) AND the structured form Hermes >= 0.10
    /// emits: `{"kind": "cron", "expr": "0 8 * * *", "display": "0 8 * * *"}`.
    /// Stored as raw `Value` so a `load → save` cycle preserves whichever
    /// shape Hermes wrote — touching it would risk corrupting jobs the
    /// user didn't even open. Use `schedule_display()` for the
    /// human-readable string.
    #[serde(default)]
    pub schedule: serde_json::Value,
    pub prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    /// Optional per-job provider override. `None` means "use global".
    #[serde(default)]
    pub provider: Option<String>,
    /// Optional per-job model override.
    #[serde(default)]
    pub model: Option<String>,
    /// `true` means the job is paused. Hermes's default is `false`.
    #[serde(default)]
    pub paused: bool,
    /// Repeat policy. Legacy form: a bare `u32` cap. Hermes >= 0.10 emits
    /// `{"times": null|u32, "completed": u32}`. We don't currently model
    /// either side; the field is preserved as-is for round-trip safety
    /// and accessor methods can be added when the UI starts surfacing
    /// run counts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<serde_json::Value>,

    // ── Corey-side convenience fields (preserved in jobs.json) ───────
    /// Seconds since epoch when Corey created the record. Hermes ignores
    /// this; we use it for "Created … ago" display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corey_created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corey_updated_at: Option<i64>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_inputs: Option<serde_json::Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_from: Option<String>,

    /// Catch-all for any fields Hermes adds that we don't model yet.
    /// Kept as raw JSON so `load_jobs → save_jobs` is lossless. Serde's
    /// `flatten` on a `Value::Object` is the standard pattern.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl HermesJob {
    pub fn display_name(&self) -> &str {
        self.name.as_deref().unwrap_or_else(|| {
            self.prompt
                .split_whitespace()
                .take(6)
                .fold((0usize, ""), |(len, _), w| (len + w.len(), w))
                .1
        })
    }

    /// Best-effort string for the schedule, regardless of which shape
    /// Hermes wrote.
    ///
    ///   - String form: returned verbatim (`"0 8 * * *"`, `"30m"`).
    ///   - Object form: prefer the `display` field (Hermes's intended
    ///     human label), then `expr`. Falls back to `""` if neither is
    ///     present (which would be a malformed record — log only, no
    ///     panic, so the rest of the job list still renders).
    pub fn schedule_display(&self) -> String {
        match &self.schedule {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Object(map) => map
                .get("display")
                .or_else(|| map.get("expr"))
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_default(),
            // `Null` is the serde-default for a missing field; treat
            // as "no schedule" rather than crashing.
            serde_json::Value::Null => String::new(),
            other => other.to_string(),
        }
    }

    /// Replace the schedule with a fresh string from the UI. Stores
    /// as a `Value::String` — Hermes parses the string form on its
    /// next read regardless of what shape it last wrote (verified
    /// against the upstream `hermes cron edit` CLI behaviour).
    pub fn set_schedule_str(&mut self, expr: impl Into<String>) {
        self.schedule = serde_json::Value::String(expr.into());
    }
}

/// One run output surfaced in the Runs drawer.
#[derive(Debug, Clone, Serialize)]
pub struct RunInfo {
    pub job_id: String,
    /// Filename stem (usually an ISO timestamp). The full path isn't
    /// exposed to the frontend.
    pub name: String,
    /// Seconds since epoch derived from the file's mtime. The filename
    /// itself is often the source of truth but parsing it reliably
    /// requires knowing Hermes's exact format; mtime is always correct.
    pub modified_at: i64,
    /// File size in bytes — lets the UI render a size hint without
    /// reading the body.
    pub size_bytes: u64,
    /// First ~400 chars of the markdown body for an inline preview. The
    /// full content stays on disk; tests that need it can read the
    /// file directly.
    pub preview: String,
}

// ───────────────────────── Public API ─────────────────────────

/// Load all jobs from `~/.hermes/cron/jobs.json`. Returns an empty vec
/// if the file doesn't exist yet (Hermes creates it lazily on first
/// write). IO errors on a file that DOES exist propagate.
pub fn load_jobs() -> io::Result<Vec<HermesJob>> {
    let path = jobs_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) if raw.trim().is_empty() => Ok(Vec::new()),
        Ok(raw) => parse_jobs(&raw).map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidData, format!("jobs.json parse: {e}"))
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Atomic overwrite of the whole `jobs.json`. We always serialize the
/// full list — partial updates would race Hermes (which also reads /
/// writes this file). The write goes through `fs_atomic::atomic_write`
/// so a crash mid-write leaves the previous file intact.
pub fn save_jobs(jobs: &[HermesJob]) -> io::Result<()> {
    let dir = cron_dir()?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(JOBS_FILE);
    let body = serialize_jobs(jobs)?;
    fs_atomic::atomic_write(&path, body.as_bytes(), Some(0o644))
}

/// Remove a job by id. No-op if not found (idempotent for UI double-clicks).
pub fn delete_job(id: &str) -> io::Result<()> {
    let mut jobs = load_jobs()?;
    let before = jobs.len();
    jobs.retain(|j| j.id != id);
    if jobs.len() == before {
        return Ok(());
    }
    save_jobs(&jobs)
}

/// List the most recent run outputs for a job. Returns empty if the
/// directory doesn't exist (Hermes creates it on first fire).
pub fn list_runs(job_id: &str) -> io::Result<Vec<RunInfo>> {
    let dir = output_dir(job_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let preview = read_preview(&path).unwrap_or_default();
        out.push(RunInfo {
            job_id: job_id.to_string(),
            name,
            modified_at,
            size_bytes: meta.len(),
            preview,
        });
    }
    // Newest first; cap.
    out.sort_by_key(|r| std::cmp::Reverse(r.modified_at));
    out.truncate(MAX_RUNS_PER_JOB);
    Ok(out)
}

/// Validate a schedule string. Hermes accepts many forms; we do a
/// best-effort cron parse and, on failure, classify the string as
/// "not cron but maybe Hermes will accept it". Returning
/// `Ok((None))` means "we can't preview next fire, but don't reject".
/// An explicit `Err` means the string is clearly unusable (empty).
///
/// Returns `(looks_like_cron, next_fire)`.
pub fn inspect_schedule(
    expr: &str,
    now: DateTime<Utc>,
) -> Result<(bool, Option<DateTime<Utc>>), String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err("schedule must not be empty".into());
    }
    match Schedule::from_str(trimmed) {
        Ok(sched) => Ok((true, sched.after(&now).next())),
        Err(_) => Ok((false, None)),
    }
}

pub fn new_job_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_unix() -> i64 {
    Utc::now().timestamp()
}

// ───────────────────────── Internals ─────────────────────────

fn parse_jobs(raw: &str) -> Result<Vec<HermesJob>, serde_json::Error> {
    // Hermes has historically stored the list either as a top-level
    // array OR as `{ "jobs": [...] }`. Accept both, preferring the
    // object form because that leaves room for file-level metadata
    // (cursor position, version tag) that Hermes may add later.
    let v: serde_json::Value = serde_json::from_str(raw)?;
    match v {
        serde_json::Value::Array(arr) => {
            let mut out = Vec::with_capacity(arr.len());
            for entry in arr {
                out.push(serde_json::from_value(entry)?);
            }
            Ok(out)
        }
        serde_json::Value::Object(mut map) => {
            if let Some(jobs) = map.remove("jobs") {
                serde_json::from_value(jobs)
            } else {
                // Not an object with a `jobs` key — pass through an
                // empty list rather than erroring. Lets a broken file
                // be overwritten by the next upsert without the UI
                // getting stuck on a parse error.
                Ok(Vec::new())
            }
        }
        _ => Ok(Vec::new()),
    }
}

fn serialize_jobs(jobs: &[HermesJob]) -> io::Result<String> {
    // Match Hermes's on-disk format: a top-level array. We write
    // pretty-printed so the file is diffable when the user edits by
    // hand. `atomic_write` serialises to bytes so the choice of
    // indent only costs a few extra bytes.
    serde_json::to_string_pretty(jobs)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("serialize jobs: {e}")))
}

fn read_preview(path: &Path) -> io::Result<String> {
    let raw = fs::read_to_string(path)?;
    Ok(truncate_preview(&raw, 400))
}

fn truncate_preview(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_top_level_array() {
        let raw = r#"[{"id":"a","schedule":"0 0 9 * * *","prompt":"hi"}]"#;
        let jobs = parse_jobs(raw).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, "a");
        assert_eq!(jobs[0].schedule_display(), "0 0 9 * * *");
        assert_eq!(jobs[0].prompt, "hi");
        assert!(!jobs[0].paused);
    }

    #[test]
    fn parse_accepts_object_with_jobs_key() {
        let raw = r#"{"jobs":[{"id":"b","schedule":"every 2h","prompt":"yo"}]}"#;
        let jobs = parse_jobs(raw).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].schedule_display(), "every 2h");
    }

    /// Regression for the panic surfaced as
    /// `Internal error: load_jobs: jobs.json parse: invalid type: map,
    /// expected u32` when a user opened the Scheduler page after Hermes
    /// upgraded to >= 0.10. Hermes started writing both `schedule` and
    /// `repeat` as objects; the old struct expected `String` and
    /// `Option<u32>` and serde rightfully refused. This test pins the
    /// exact shape we saw on disk so a future "tidy the struct"
    /// refactor can't silently break opening the page again.
    #[test]
    fn parse_handles_hermes_0_10_object_schedule_and_repeat() {
        let raw = r#"{
            "jobs": [{
                "id": "17068813c0b0",
                "name": "daily-36kr-news",
                "prompt": "fetch news",
                "schedule": {
                    "kind": "cron",
                    "expr": "0 8 * * *",
                    "display": "0 8 * * *"
                },
                "schedule_display": "0 8 * * *",
                "repeat": {"times": null, "completed": 2},
                "enabled": true,
                "state": "scheduled",
                "deliver": "local"
            }]
        }"#;
        let jobs = parse_jobs(raw).expect("must parse without panic");
        assert_eq!(jobs.len(), 1);
        let j = &jobs[0];
        assert_eq!(j.id, "17068813c0b0");
        // `schedule_display()` extracts the human label out of the
        // structured form.
        assert_eq!(j.schedule_display(), "0 8 * * *");
        // `repeat` is preserved as raw Value; round-trip-safe.
        assert!(j.repeat.is_some());
    }

    /// Round-trip: load → save with the rich-schedule shape must
    /// preserve the inner `{kind, expr, display}` object verbatim.
    /// If we ever serialize back as a bare string we'd silently lose
    /// the `kind` discriminator and Hermes might re-classify the
    /// schedule on its next read.
    #[test]
    fn rich_schedule_round_trips_unchanged() {
        let raw = r#"[{
            "id": "x",
            "schedule": {"kind": "cron", "expr": "0 8 * * *", "display": "0 8 * * *"},
            "prompt": "p"
        }]"#;
        let jobs = parse_jobs(raw).unwrap();
        let out = serialize_jobs(&jobs).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let job0 = &v.as_array().unwrap()[0];
        let sched = job0.get("schedule").unwrap();
        assert!(
            sched.is_object(),
            "schedule must round-trip as object, got {sched}"
        );
        assert_eq!(sched.get("kind").and_then(|v| v.as_str()), Some("cron"));
        assert_eq!(
            sched.get("expr").and_then(|v| v.as_str()),
            Some("0 8 * * *")
        );
    }

    #[test]
    fn parse_empty_and_garbage_return_empty_list_not_error() {
        assert_eq!(parse_jobs("[]").unwrap().len(), 0);
        assert_eq!(parse_jobs(r#"{"version":1}"#).unwrap().len(), 0);
    }

    #[test]
    fn roundtrip_preserves_unknown_fields() {
        // If Hermes adds a new key we don't model (e.g. `retry_policy`),
        // parsing + re-serializing must keep it.
        let raw = r#"[{"id":"c","schedule":"30m","prompt":"p","retry_policy":{"max":3,"backoff":"exp"}}]"#;
        let jobs = parse_jobs(raw).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(
            jobs[0].extra.get("retry_policy"),
            Some(&serde_json::json!({"max": 3, "backoff": "exp"})),
        );
        let re = serialize_jobs(&jobs).unwrap();
        assert!(
            re.contains("retry_policy"),
            "retry_policy must survive a load→save cycle: {re}",
        );
    }

    #[test]
    fn inspect_schedule_classifies_cron_vs_other() {
        let now = DateTime::parse_from_rfc3339("2026-04-23T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let (is_cron, next) = inspect_schedule("0 0 9 * * *", now).unwrap();
        assert!(is_cron);
        assert!(next.is_some());
        assert!(next.unwrap() > now);

        let (is_cron, next) = inspect_schedule("every 2h", now).unwrap();
        assert!(!is_cron, "`every 2h` is Hermes's own syntax, not cron");
        assert!(next.is_none());

        assert!(inspect_schedule("", now).is_err());
    }

    #[test]
    fn truncate_preview_stops_at_char_boundary() {
        // Multi-byte char at the cap boundary must not panic.
        let s = "a".repeat(450);
        assert_eq!(truncate_preview(&s, 400).chars().count(), 401); // 400 + ellipsis
        let chinese = "的".repeat(500); // each char is 3 bytes
        let cut = truncate_preview(&chinese, 10);
        assert_eq!(cut.chars().count(), 11); // 10 + ellipsis
    }

    #[test]
    fn display_name_falls_back_to_prompt_head() {
        let mut job = HermesJob {
            id: "x".into(),
            schedule: serde_json::Value::String("30m".into()),
            prompt: "Summarise the latest AI news from HN and post to Telegram".into(),
            ..HermesJob::default()
        };
        assert!(!job.display_name().is_empty());
        job.name = Some("Morning digest".into());
        assert_eq!(job.display_name(), "Morning digest");
    }
}
