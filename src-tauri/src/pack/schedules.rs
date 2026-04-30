//! Pack schedule install / uninstall.
//!
//! Stage 4b of the Pack subsystem rollout. Pack manifests declare
//! cron schedules under `schedules: [{id, cron, workflow}]`. Each
//! one becomes a [`HermesJob`] in `~/.hermes/cron/jobs.json` so
//! the Hermes gateway picks it up.
//!
//! Both the schedule's own id AND its `workflow_id` reference are
//! Pack-prefixed: `pack__<pack_id>__<...>`. The id prefix lets us
//! find Pack-owned jobs at uninstall time; the workflow_id prefix
//! is what `pack::workflows::install_workflows` already used when
//! writing the .yaml files, so the two stay in sync.
//!
//! Pure transformation lives in `compute_jobs` and `filter_pack`
//! so unit tests don't need the global hermes_dir resolver. The
//! public `install_schedules` / `uninstall_schedules` functions
//! plug those into [`crate::hermes_cron`] for the live path.

use std::io;

use crate::hermes_cron::{self, HermesJob};
use crate::pack::manifest::PackManifest;
use crate::pack::workflows::prefix_workflow_id;

/// Build the Pack-prefixed schedule id used inside `jobs.json`.
pub fn prefix_schedule_id(pack_id: &str, raw_id: &str) -> String {
    format!("pack__{pack_id}__{raw_id}")
}

/// Translate a Pack manifest's `schedules:` section into a
/// `Vec<HermesJob>`. Pure function — no IO. Each result is ready
/// to feed into `hermes_cron::save_jobs` after merging with the
/// existing job list.
///
/// Hermes' `HermesJob.prompt` is required; when the manifest's
/// schedule has no explicit prompt we synthesize one referencing
/// the Pack workflow it triggers. This matches the upstream
/// expectation that a cron entry always describes WHAT to do, even
/// if the actual instructions live in the workflow.
pub fn compute_jobs(manifest: &PackManifest) -> Vec<HermesJob> {
    if manifest.schedules.is_empty() {
        return Vec::new();
    }
    let now = unix_now();
    manifest
        .schedules
        .iter()
        .map(|s| {
            let mut job = HermesJob {
                id: prefix_schedule_id(&manifest.id, &s.id),
                name: Some(if s.description.is_empty() {
                    format!("{} / {}", manifest.id, s.id)
                } else {
                    s.description.clone()
                }),
                prompt: format!(
                    "Run pack workflow {workflow}",
                    workflow = prefix_workflow_id(&manifest.id, &s.workflow)
                ),
                workflow_id: Some(prefix_workflow_id(&manifest.id, &s.workflow)),
                paused: false,
                corey_created_at: Some(now),
                corey_updated_at: Some(now),
                ..HermesJob::default()
            };
            job.set_schedule_str(s.cron.clone());
            job
        })
        .collect()
}

/// Partition `existing` jobs into (jobs to keep, ids that were
/// removed) by stripping every entry whose id starts with
/// `pack__<pack_id>__`. Pure helper for `uninstall_schedules` and
/// for tests that don't want to touch the global jobs.json.
pub fn filter_pack(existing: Vec<HermesJob>, pack_id: &str) -> (Vec<HermesJob>, usize) {
    let prefix = format!("pack__{pack_id}__");
    let total = existing.len();
    let kept: Vec<HermesJob> = existing
        .into_iter()
        .filter(|j| !j.id.starts_with(&prefix))
        .collect();
    let removed = total - kept.len();
    (kept, removed)
}

/// Replace every Pack-owned job in `~/.hermes/cron/jobs.json` with
/// the new set computed from the manifest. Returns `(installed,
/// replaced_or_removed)` for logging; call from `pack_set_enabled`
/// on the enable path.
///
/// Idempotent: re-running with the same manifest leaves jobs.json
/// in the same state.
pub fn install_schedules(manifest: &PackManifest) -> io::Result<(usize, usize)> {
    let new_jobs = compute_jobs(manifest);
    if new_jobs.is_empty() {
        // Nothing to install — but be sure to clear any stale
        // entries from a previous version of the manifest that
        // had schedules.
        return uninstall_schedules(&manifest.id).map(|removed| (0, removed));
    }
    let existing = hermes_cron::load_jobs()?;
    let (mut kept, removed) = filter_pack(existing, &manifest.id);
    let installed = new_jobs.len();
    kept.extend(new_jobs);
    hermes_cron::save_jobs(&kept)?;
    Ok((installed, removed))
}

/// Strip every Pack-owned job for `pack_id` from jobs.json.
/// Idempotent. Returns the number removed for logging.
pub fn uninstall_schedules(pack_id: &str) -> io::Result<usize> {
    let existing = hermes_cron::load_jobs()?;
    let (kept, removed) = filter_pack(existing, pack_id);
    if removed == 0 {
        return Ok(0);
    }
    hermes_cron::save_jobs(&kept)?;
    Ok(removed)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::manifest::{parse, ManifestLoadOutcome};

    fn parse_manifest(yaml: &str) -> PackManifest {
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => *m,
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn prefix_schedule_id_format() {
        assert_eq!(prefix_schedule_id("foo", "daily"), "pack__foo__daily");
    }

    #[test]
    fn compute_jobs_emits_one_per_manifest_schedule() {
        let m = parse_manifest(
            r#"
schema_version: 1
id: cross_border_ecom
version: "1.0.0"
schedules:
  - id: daily-ad-check
    cron: "0 9 * * *"
    workflow: ad_daily_check
    description: 每天 9 点跑广告守卫
  - id: weekly-report
    cron: "0 8 * * 1"
    workflow: weekly_report
"#,
        );
        let jobs = compute_jobs(&m);
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].id, "pack__cross_border_ecom__daily-ad-check");
        assert_eq!(jobs[0].schedule_display(), "0 9 * * *");
        assert_eq!(
            jobs[0].workflow_id.as_deref(),
            Some("pack__cross_border_ecom__ad_daily_check"),
            "workflow_id must use the same Pack prefix as the workflow store"
        );
        assert_eq!(
            jobs[0].name.as_deref(),
            Some("每天 9 点跑广告守卫"),
            "manifest description becomes the job name when present"
        );
        assert!(!jobs[0].paused, "Pack-installed schedules start active");
        // The fallback name kicks in when description is empty.
        assert_eq!(
            jobs[1].name.as_deref(),
            Some("cross_border_ecom / weekly-report")
        );
    }

    #[test]
    fn compute_jobs_is_empty_when_manifest_has_no_schedules() {
        let m = parse_manifest(
            r#"
schema_version: 1
id: tiny
version: "1.0.0"
"#,
        );
        assert!(compute_jobs(&m).is_empty());
    }

    fn job(id: &str) -> HermesJob {
        HermesJob {
            id: id.to_string(),
            ..HermesJob::default()
        }
    }

    #[test]
    fn filter_pack_strips_only_owned_ids() {
        let existing = vec![
            job("pack__foo__a"),
            job("pack__foo__b"),
            job("pack__bar__c"),
            job("user_curated"),
        ];
        let (kept, removed) = filter_pack(existing, "foo");
        assert_eq!(removed, 2);
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().any(|j| j.id == "pack__bar__c"));
        assert!(kept.iter().any(|j| j.id == "user_curated"));
    }

    #[test]
    fn filter_pack_zero_removed_on_clean_state() {
        let existing = vec![job("user_a"), job("pack__bar__b")];
        let (kept, removed) = filter_pack(existing, "foo");
        assert_eq!(removed, 0);
        assert_eq!(kept.len(), 2);
    }
}
