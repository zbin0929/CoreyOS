//! Pack workflow install / uninstall.
//!
//! Stage 4b of the Pack subsystem rollout. Pack manifests list
//! workflow YAMLs under `workflows: [workflows/foo.yaml]`; the
//! Pack folder is read-only, so we copy each one into the Hermes
//! workflow store (`~/.hermes/workflows/`) with the source id
//! rewritten to a Pack-prefixed form.
//!
//! Why rewrite the id?
//!
//! Two Packs may both ship a `weekly_report` workflow. Without a
//! Pack-scoped namespace, the second one to install would silently
//! overwrite the first. The prefix `pack__<pack_id>__` makes
//! collisions impossible and lets us delete exactly the entries we
//! own at uninstall time (any file in `workflows/` matching
//! `pack__<id>__*.yaml`).
//!
//! Schedule cross-references (a manifest schedule's `workflow:`
//! field) must use the prefixed id; `prefix_workflow_id` is the
//! single source of truth for that transformation, exported so
//! `pack::schedules` can apply the same rule.

use std::fs;
use std::io;
use std::path::Path;

use crate::pack::manifest::PackManifest;
use crate::workflow::model::WorkflowDef;
use crate::workflow::store as wstore;

/// Apply the canonical Pack-namespaced prefix to a workflow id.
pub fn prefix_workflow_id(pack_id: &str, raw_id: &str) -> String {
    format!("pack__{pack_id}__{raw_id}")
}

/// True when `workflow_id` is a Pack-owned id minted by
/// [`prefix_workflow_id`] for the given pack.
#[allow(dead_code)] // wired in stage 5+ (UI grouping)
pub fn id_belongs_to_pack(workflow_id: &str, pack_id: &str) -> bool {
    let prefix = format!("pack__{pack_id}__");
    workflow_id.starts_with(&prefix)
}

/// True when a workflow id (any) carries the generic Pack prefix.
/// Used by uninstall sweeps that don't know the pack id.
#[allow(dead_code)] // wired in stage 5+ (UI grouping)
pub fn id_is_any_pack(workflow_id: &str) -> bool {
    workflow_id.starts_with("pack__")
}

/// Read each Pack workflow YAML, rewrite its id to the prefixed
/// form, and save it via the Hermes workflow store. Missing /
/// malformed source files are logged at warn and skipped — same
/// best-effort policy as `pack::skills::install_skills`.
///
/// Returns the number of workflows successfully installed.
///
/// Note: `wstore::save` writes to a path keyed off `def.id`, so
/// the prefix in the id is what determines the on-disk filename
/// (`pack__<pack_id>__<raw>.yaml`).
pub fn install_workflows(manifest: &PackManifest, pack_dir: &Path) -> io::Result<usize> {
    if manifest.workflows.is_empty() {
        return Ok(0);
    }
    let mut installed = 0usize;
    for rel in &manifest.workflows {
        let src = pack_dir.join(rel);
        if !src.exists() {
            tracing::warn!(
                pack = %manifest.id,
                workflow = %rel,
                "workflow source file missing; skipping"
            );
            continue;
        }
        let raw = match fs::read_to_string(&src) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    pack = %manifest.id,
                    workflow = %rel,
                    error = %e,
                    "workflow read failed; skipping"
                );
                continue;
            }
        };
        let mut def: WorkflowDef = match serde_yaml::from_str(&raw) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(
                    pack = %manifest.id,
                    workflow = %rel,
                    error = %e,
                    "workflow yaml parse failed; skipping"
                );
                continue;
            }
        };
        let prefixed = prefix_workflow_id(&manifest.id, &def.id);
        def.id = prefixed;
        if let Err(e) = wstore::save(&def) {
            tracing::warn!(
                pack = %manifest.id,
                workflow = %rel,
                error = %e,
                "workflow save failed"
            );
            continue;
        }
        installed += 1;
    }
    Ok(installed)
}

/// Remove every workflow whose id starts with `pack__<pack_id>__`.
/// Idempotent: a workflows dir that doesn't exist or contains
/// nothing for this Pack is a successful no-op.
pub fn uninstall_workflows(pack_id: &str) -> io::Result<usize> {
    let dir = wstore::workflows_dir()?;
    if !dir.exists() {
        return Ok(0);
    }
    let prefix = format!("pack__{pack_id}__");
    let mut removed = 0usize;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        let ext = path.extension().and_then(|s| s.to_str());
        if !matches!(ext, Some("yaml") | Some("yml")) {
            continue;
        }
        if stem.starts_with(&prefix) {
            if let Err(e) = fs::remove_file(&path) {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "workflow remove failed"
                );
                continue;
            }
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_round_trip() {
        let id = prefix_workflow_id("foo", "weekly");
        assert_eq!(id, "pack__foo__weekly");
        assert!(id_belongs_to_pack(&id, "foo"));
        assert!(!id_belongs_to_pack(&id, "bar"));
        assert!(id_is_any_pack(&id));
        assert!(!id_is_any_pack("user_curated"));
    }
}
