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

use std::collections::HashMap;
use std::io;
use std::path::Path;

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

/// Read `pack-data/<id>/config/fuel-rate-config.yaml` and return a
/// map of `update_schedule` (e.g. "weekly", "monthly") → cron string,
/// taken from the first enabled carrier in each group. Empty map if
/// the file does not exist or carries no cron field.
///
/// This lets the Pack UI (CarrierConfigEditor) edit schedule timing
/// in plain Chinese without touching the read-only manifest. The
/// returned map is consumed by `apply_cron_overrides`.
pub fn cron_overrides_from_fuel_rate_config(pack_data_dir: &Path) -> HashMap<String, String> {
    let path = pack_data_dir.join("config").join("fuel-rate-config.yaml");
    let mut overrides: HashMap<String, String> = HashMap::new();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return overrides;
    };
    let Ok(value): Result<serde_yaml::Value, _> = serde_yaml::from_str(&raw) else {
        return overrides;
    };
    let Some(carriers) = value.get("carriers").and_then(|v| v.as_mapping()) else {
        return overrides;
    };
    for (_, carrier) in carriers {
        let Some(map) = carrier.as_mapping() else {
            continue;
        };
        let cron = map
            .get(serde_yaml::Value::String("cron".into()))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let schedule = map
            .get(serde_yaml::Value::String("update_schedule".into()))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if cron.is_empty() || schedule.is_empty() {
            continue;
        }
        overrides.entry(schedule).or_insert(cron);
    }
    overrides
}

/// Read `pack-data/<id>/config/exchange-rate-config.yaml` and return
/// a map of manifest schedule id substring → cron string. The
/// exchange-rate config stores schedules as an array of `{name, cron}`
/// and we match by the schedule's `name` containing a keyword that
/// appears in the manifest schedule id (e.g. name "早盘抓取" →
/// match id containing "930", name "兜底抓取" → match id containing
/// "1030"). Empty map if the file does not exist.
pub fn cron_overrides_from_exchange_rate_config(pack_data_dir: &Path) -> HashMap<String, String> {
    let path = pack_data_dir
        .join("config")
        .join("exchange-rate-config.yaml");
    let mut overrides: HashMap<String, String> = HashMap::new();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return overrides;
    };
    let Ok(value): Result<serde_yaml::Value, _> = serde_yaml::from_str(&raw) else {
        return overrides;
    };
    let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) else {
        return overrides;
    };
    if !enabled {
        return overrides;
    }
    let Some(schedules) = value.get("schedules").and_then(|v| v.as_sequence()) else {
        return overrides;
    };
    for schedule in schedules {
        let Some(map) = schedule.as_mapping() else {
            continue;
        };
        let Some(name) = map
            .get(serde_yaml::Value::String("name".into()))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let Some(cron) = map
            .get(serde_yaml::Value::String("cron".into()))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let keyword = if name.contains("早") || name.contains("9:30") || name.contains("09:30") {
            "930"
        } else if name.contains("兜底") || name.contains("10:30") {
            "1030"
        } else {
            continue;
        };
        overrides.insert(keyword.to_string(), cron.trim().to_string());
    }
    overrides
}

/// Read `pack-data/<id>/config/zone-config.yaml` and return a map of
/// manifest schedule id substring → cron string. Supports multi-carrier
/// format (`carriers.ups`, `carriers.usps`) and legacy single-carrier
/// format (`enabled` + `schedules` at top level). Empty map if the file
/// does not exist or is disabled.
pub fn cron_overrides_from_zone_config(pack_data_dir: &Path) -> HashMap<String, String> {
    let path = pack_data_dir.join("config").join("zone-config.yaml");
    let mut overrides: HashMap<String, String> = HashMap::new();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return overrides;
    };
    let Ok(value): Result<serde_yaml::Value, _> = serde_yaml::from_str(&raw) else {
        return overrides;
    };

    if let Some(carriers) = value.get("carriers").and_then(|v| v.as_mapping()) {
        for (carrier_key, carrier_val) in carriers {
            let Some(carrier_map) = carrier_val.as_mapping() else {
                continue;
            };
            let enabled = carrier_map
                .get(serde_yaml::Value::String("enabled".into()))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if !enabled {
                continue;
            }
            let key_str = carrier_key.as_str().unwrap_or("");
            let schedule_key = match key_str {
                "ups" => "ups-zones",
                "usps" => "usps-zones",
                "fedex" => "fedex-zones",
                other => other,
            };
            let Some(schedules) = carrier_map
                .get(serde_yaml::Value::String("schedules".into()))
                .and_then(|v| v.as_sequence())
            else {
                continue;
            };
            for schedule in schedules {
                let Some(map) = schedule.as_mapping() else {
                    continue;
                };
                let cron = map
                    .get(serde_yaml::Value::String("cron".into()))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !cron.is_empty() {
                    overrides.insert(schedule_key.to_string(), cron);
                    break;
                }
            }
        }
        return overrides;
    }

    let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) else {
        return overrides;
    };
    if !enabled {
        return overrides;
    }
    let Some(schedules) = value.get("schedules").and_then(|v| v.as_sequence()) else {
        return overrides;
    };
    for schedule in schedules {
        let Some(map) = schedule.as_mapping() else {
            continue;
        };
        let Some(name) = map
            .get(serde_yaml::Value::String("name".into()))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let Some(cron) = map
            .get(serde_yaml::Value::String("cron".into()))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if name.contains("月度") || name.contains("分区") || name.contains("zone") {
            overrides.insert("ups-zones".to_string(), cron.trim().to_string());
        }
    }
    overrides
}

/// Apply cron overrides to a job list in-place. A manifest schedule
/// id ending in `-weekly` / `-monthly` (or containing the keyword)
/// gets its cron replaced if the overrides map has the matching key.
/// Pure helper so unit tests can exercise the matching logic.
pub fn apply_cron_overrides(jobs: &mut [HermesJob], overrides: &HashMap<String, String>) {
    if overrides.is_empty() {
        return;
    }
    for job in jobs.iter_mut() {
        for (schedule_kind, cron) in overrides.iter() {
            if job.id.contains(schedule_kind.as_str()) {
                job.set_schedule_str(cron.clone());
                break;
            }
        }
    }
}

/// Replace every Pack-owned job in `~/.hermes/cron/jobs.json` with
/// the new set computed from the manifest. Returns `(installed,
/// replaced_or_removed)` for logging; call from `pack_set_enabled`
/// on the enable path.
///
/// Idempotent: re-running with the same manifest leaves jobs.json
/// in the same state.
///
/// If `pack_data_dir` is `Some`, cron overrides from
/// `<pack_data_dir>/config/fuel-rate-config.yaml` are merged in,
/// letting the Pack UI control schedule timing without touching the
/// read-only manifest. Pass `None` for behaviour identical to the
/// pre-override version.
pub fn install_schedules_with_overrides(
    manifest: &PackManifest,
    pack_data_dir: Option<&Path>,
) -> io::Result<(usize, usize)> {
    let mut new_jobs = compute_jobs(manifest);
    if new_jobs.is_empty() {
        return uninstall_schedules(&manifest.id).map(|removed| (0, removed));
    }
    if let Some(dir) = pack_data_dir {
        let overrides = cron_overrides_from_fuel_rate_config(dir);
        apply_cron_overrides(&mut new_jobs, &overrides);
        let exchange_overrides = cron_overrides_from_exchange_rate_config(dir);
        apply_cron_overrides(&mut new_jobs, &exchange_overrides);
        let zone_overrides = cron_overrides_from_zone_config(dir);
        apply_cron_overrides(&mut new_jobs, &zone_overrides);
    }
    let existing = hermes_cron::load_jobs()?;
    let (mut kept, removed) = filter_pack(existing, &manifest.id);
    let installed = new_jobs.len();
    kept.extend(new_jobs);
    hermes_cron::save_jobs(&kept)?;
    Ok((installed, removed))
}

/// Backward-compatible entry point — same as
/// [`install_schedules_with_overrides`] with `pack_data_dir=None`.
pub fn install_schedules(manifest: &PackManifest) -> io::Result<(usize, usize)> {
    install_schedules_with_overrides(manifest, None)
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

    #[test]
    fn apply_cron_overrides_replaces_matching_schedule() {
        let mut jobs = vec![
            HermesJob {
                id: "pack__test__weekly-fuel-rates".to_string(),
                ..HermesJob::default()
            },
            HermesJob {
                id: "pack__test__monthly-fuel-rates".to_string(),
                ..HermesJob::default()
            },
        ];
        jobs[0].set_schedule_str("0 30 23 * * 0".to_string());
        jobs[1].set_schedule_str("0 0 2 1 * *".to_string());
        let mut overrides = HashMap::new();
        overrides.insert("weekly".to_string(), "0 0 9 * * 1".to_string());
        apply_cron_overrides(&mut jobs, &overrides);
        assert_eq!(jobs[0].schedule_display(), "0 0 9 * * 1");
        assert_eq!(
            jobs[1].schedule_display(),
            "0 0 2 1 * *",
            "non-matching schedule must not change"
        );
    }

    #[test]
    fn apply_cron_overrides_empty_map_is_noop() {
        let mut jobs = vec![HermesJob {
            id: "pack__x__weekly".to_string(),
            ..HermesJob::default()
        }];
        jobs[0].set_schedule_str("0 0 0 * * *".to_string());
        let overrides = HashMap::new();
        apply_cron_overrides(&mut jobs, &overrides);
        assert_eq!(jobs[0].schedule_display(), "0 0 0 * * *");
    }

    #[test]
    fn cron_overrides_from_yaml_picks_first_per_group() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
carriers:
  ups:
    name: UPS
    update_schedule: weekly
    cron: "0 30 23 * * 0"
  fedex:
    name: FedEx
    update_schedule: weekly
    cron: "0 0 9 * * 1"
  dhl:
    name: DHL
    update_schedule: monthly
    cron: "0 0 2 1 * *"
"#;
        std::fs::write(cfg_dir.join("fuel-rate-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_fuel_rate_config(tmp.path());
        assert_eq!(
            overrides.get("weekly").map(String::as_str),
            Some("0 30 23 * * 0")
        );
        assert_eq!(
            overrides.get("monthly").map(String::as_str),
            Some("0 0 2 1 * *")
        );
    }

    #[test]
    fn cron_overrides_missing_file_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let overrides = cron_overrides_from_fuel_rate_config(tmp.path());
        assert!(overrides.is_empty());
    }

    #[test]
    fn exchange_rate_overrides_match_by_keyword() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
enabled: true
schedules:
  - name: 早盘抓取
    cron: "0 45 9 * * *"
  - name: 兜底抓取
    cron: "0 15 11 * * *"
"#;
        std::fs::write(cfg_dir.join("exchange-rate-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_exchange_rate_config(tmp.path());
        assert_eq!(
            overrides.get("930").map(String::as_str),
            Some("0 45 9 * * *")
        );
        assert_eq!(
            overrides.get("1030").map(String::as_str),
            Some("0 15 11 * * *")
        );
    }

    #[test]
    fn exchange_rate_overrides_disabled_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
enabled: false
schedules:
  - name: 早盘抓取
    cron: "0 45 9 * * *"
"#;
        std::fs::write(cfg_dir.join("exchange-rate-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_exchange_rate_config(tmp.path());
        assert!(overrides.is_empty());
    }

    #[test]
    fn exchange_rate_overrides_missing_file_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let overrides = cron_overrides_from_exchange_rate_config(tmp.path());
        assert!(overrides.is_empty());
    }

    #[test]
    fn exchange_rate_overrides_applied_to_jobs() {
        let mut jobs = vec![
            HermesJob {
                id: "pack__test__daily-usd-rate-930".to_string(),
                ..HermesJob::default()
            },
            HermesJob {
                id: "pack__test__daily-usd-rate-1030".to_string(),
                ..HermesJob::default()
            },
        ];
        jobs[0].set_schedule_str("0 30 9 * * *".to_string());
        jobs[1].set_schedule_str("0 30 10 * * *".to_string());
        let mut overrides = HashMap::new();
        overrides.insert("930".to_string(), "0 45 9 * * *".to_string());
        overrides.insert("1030".to_string(), "0 15 11 * * *".to_string());
        apply_cron_overrides(&mut jobs, &overrides);
        assert_eq!(jobs[0].schedule_display(), "0 45 9 * * *");
        assert_eq!(jobs[1].schedule_display(), "0 15 11 * * *");
    }

    #[test]
    fn zone_config_overrides_match_by_keyword() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
enabled: true
schedules:
  - name: 月度分区更新
    cron: "0 30 3 1 * *"
"#;
        std::fs::write(cfg_dir.join("zone-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_zone_config(tmp.path());
        assert_eq!(
            overrides.get("ups-zones").map(String::as_str),
            Some("0 30 3 1 * *")
        );
    }

    #[test]
    fn zone_config_overrides_disabled_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
enabled: false
schedules:
  - name: 月度分区更新
    cron: "0 30 3 1 * *"
"#;
        std::fs::write(cfg_dir.join("zone-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_zone_config(tmp.path());
        assert!(overrides.is_empty());
    }

    #[test]
    fn zone_config_overrides_applied_to_jobs() {
        let mut jobs = vec![HermesJob {
            id: "pack__test__monthly-ups-zones".to_string(),
            ..HermesJob::default()
        }];
        jobs[0].set_schedule_str("0 0 2 1 * *".to_string());
        let mut overrides = HashMap::new();
        overrides.insert("ups-zones".to_string(), "0 30 3 1 * *".to_string());
        apply_cron_overrides(&mut jobs, &overrides);
        assert_eq!(jobs[0].schedule_display(), "0 30 3 1 * *");
    }

    #[test]
    fn zone_config_multi_carrier_overrides() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
carriers:
  ups:
    enabled: true
    schedules:
      - name: 月度分区更新
        cron: "0 30 2 1 * *"
    source:
      carrier: UPS
      service: GROUND
      totalZip3: 902
    upload:
      maxRetries: 3
      retryDelay: 2
      requestInterval: 1
  usps:
    enabled: true
    schedules:
      - name: 月度分区更新
        cron: "0 30 3 1 * *"
    source:
      carrier: USPS
      service: GROUND
      totalZip3: 930
    upload:
      maxRetries: 3
      retryDelay: 2
      requestInterval: 0.3
"#;
        std::fs::write(cfg_dir.join("zone-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_zone_config(tmp.path());
        assert_eq!(
            overrides.get("ups-zones").map(String::as_str),
            Some("0 30 2 1 * *")
        );
        assert_eq!(
            overrides.get("usps-zones").map(String::as_str),
            Some("0 30 3 1 * *")
        );
    }

    #[test]
    fn zone_config_multi_carrier_disabled_skipped() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg_dir = tmp.path().join("config");
        std::fs::create_dir_all(&cfg_dir).expect("mkdir");
        let yaml = r#"
carriers:
  ups:
    enabled: true
    schedules:
      - name: 月度分区更新
        cron: "0 0 2 1 * *"
    source:
      carrier: UPS
      service: GROUND
      totalZip3: 902
    upload:
      maxRetries: 3
      retryDelay: 2
      requestInterval: 1
  usps:
    enabled: false
    schedules:
      - name: 月度分区更新
        cron: "0 0 3 1 * *"
    source:
      carrier: USPS
      service: GROUND
      totalZip3: 930
    upload:
      maxRetries: 3
      retryDelay: 2
      requestInterval: 0.3
"#;
        std::fs::write(cfg_dir.join("zone-config.yaml"), yaml).expect("write");
        let overrides = cron_overrides_from_zone_config(tmp.path());
        assert_eq!(
            overrides.get("ups-zones").map(String::as_str),
            Some("0 0 2 1 * *")
        );
        assert!(!overrides.contains_key("usps-zones"));
    }
}
