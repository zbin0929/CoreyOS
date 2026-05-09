//! Bundled-Pack seeding.
//!
//! At first launch (and on every launch as a no-op idempotent check),
//! copy any Pack folder from the app bundle's
//! `assets/skill-packs/<id>/` into `~/.hermes/skill-packs/<id>/`.
//!
//! Iron rules respected:
//! - **Read-only at runtime**: we only seed when the target directory
//!   is missing. Existing user copies are NEVER touched (so a Pack
//!   the user disabled / hand-edited stays exactly as they left it).
//! - **`pack-data/<id>/` is sacred**: we never write inside pack-data
//!   from here. Only the read-only `skill-packs/<id>/` payload.
//! - **No surprise enables**: seeding only puts files on disk. The
//!   Pack still defaults to disabled — `customer.yaml`'s
//!   `packs.preinstall` is the way to auto-enable.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::pack::SKILL_PACKS_DIRNAME;

/// Subfolder under the resource dir where bundled Packs live. Must
/// match the `bundle.resources` entry in `tauri.conf.json`.
const BUNDLED_SKILL_PACKS_SUBDIR: &str = "assets/skill-packs";

/// Dev convenience: when this env var is set to `1` / `true`, every
/// bundled pack directory under `<hermes>/skill-packs/<id>/` is
/// **wiped and replaced** by the freshly bundled copy on startup.
///
/// Only meant for developers iterating on Pack manifests/assets;
/// **never set this in a packaged release** — it will discard any
/// user-edited Pack content on every launch.
const FORCE_RESEED_ENV: &str = "COREY_FORCE_RESEED";

fn force_reseed_enabled() -> bool {
    matches!(
        std::env::var(FORCE_RESEED_ENV).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

/// Copy every bundled Pack into `<hermes_dir>/skill-packs/<id>/` if
/// the target doesn't already exist. Returns the list of pack ids
/// that were freshly seeded (empty on subsequent launches).
///
/// Best-effort: failures on individual packs are logged and skipped
/// rather than aborting startup. A missing source dir (dev build
/// without bundled assets) is also a quiet no-op.
///
/// When the `COREY_FORCE_RESEED=1` env var is set, existing target
/// directories are deleted and re-copied from the bundle. Useful for
/// iterating on Pack manifests during development — see
/// `FORCE_RESEED_ENV`.
pub fn ensure_bundled_packs(app: &AppHandle, hermes_dir: &Path) -> Vec<String> {
    let src_root = match resource_skill_packs_dir(app) {
        Some(p) if p.exists() => p,
        _ => return Vec::new(),
    };
    let dst_root = hermes_dir.join(SKILL_PACKS_DIRNAME);
    if let Err(e) = fs::create_dir_all(&dst_root) {
        tracing::warn!(error = %e, dir = %dst_root.display(), "skill-packs mkdir failed");
        return Vec::new();
    }

    let force = force_reseed_enabled();
    if force {
        tracing::warn!(
            env = FORCE_RESEED_ENV,
            "force-reseed enabled — existing bundled packs will be overwritten"
        );
    }
    seed_dir(&src_root, &dst_root, force)
}

fn resource_skill_packs_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = match app.path().resource_dir() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "resource_dir lookup failed; skipping pack seed");
            return None;
        }
    };
    Some(base.join(BUNDLED_SKILL_PACKS_SUBDIR))
}

fn seed_dir(src_root: &Path, dst_root: &Path, force: bool) -> Vec<String> {
    let mut seeded = Vec::new();
    let entries = match fs::read_dir(src_root) {
        Ok(it) => it,
        Err(e) => {
            tracing::warn!(error = %e, dir = %src_root.display(), "bundled skill-packs read_dir failed");
            return seeded;
        }
    };
    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_dir() {
            continue;
        }
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let dst = dst_root.join(&name);
        if dst.exists() {
            if !force {
                continue;
            }
            if let Err(e) = fs::remove_dir_all(&dst) {
                tracing::warn!(pack = %name, error = %e, "force-reseed: remove_dir_all failed; skipping");
                continue;
            }
            tracing::warn!(pack = %name, "force-reseed: wiped existing pack dir");
        }
        match copy_tree(&src, &dst) {
            Ok(()) => {
                tracing::info!(pack = %name, "seeded bundled pack");
                seeded.push(name);
            }
            Err(e) => {
                tracing::warn!(pack = %name, error = %e, "bundled pack seed failed");
                let _ = fs::remove_dir_all(&dst);
            }
        }
    }
    seeded
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("corey-pack-seed-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create test root");
        d
    }

    #[test]
    fn seed_copies_only_missing_packs() {
        let root = temp_root("missing-only");
        let src = root.join("src");
        let dst = root.join("dst");
        fs::create_dir_all(src.join("alpha/workflows")).expect("mk alpha");
        fs::write(src.join("alpha/manifest.yaml"), "id: alpha\n").expect("alpha manifest");
        fs::write(src.join("alpha/workflows/x.yaml"), "id: x\n").expect("alpha wf");
        fs::create_dir_all(src.join("beta")).expect("mk beta");
        fs::write(src.join("beta/manifest.yaml"), "id: beta\n").expect("beta manifest");

        fs::create_dir_all(dst.join("alpha")).expect("user already has alpha");
        fs::write(dst.join("alpha/marker.txt"), "user data").expect("user marker");

        let seeded = seed_dir(&src, &dst, false);
        assert_eq!(seeded, vec!["beta"]);
        assert!(dst.join("beta/manifest.yaml").exists());
        let user_marker = fs::read_to_string(dst.join("alpha/marker.txt")).expect("read marker");
        assert_eq!(user_marker, "user data");
        assert!(!dst.join("alpha/workflows/x.yaml").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn seed_handles_missing_source_quietly() {
        let root = temp_root("missing-src");
        let dst = root.join("dst");
        let seeded = seed_dir(&root.join("nope"), &dst, false);
        assert!(seeded.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    /// Force-reseed wipes the existing pack dir (including any local
    /// user edits) and re-copies the bundled version. This simulates
    /// the `COREY_FORCE_RESEED=1` dev toggle — used to get Pack
    /// manifest changes visible without manual `rm -rf`.
    #[test]
    fn seed_force_reseed_overwrites_existing_pack() {
        let root = temp_root("force-reseed");
        let src = root.join("src");
        let dst = root.join("dst");
        fs::create_dir_all(src.join("alpha")).expect("mk alpha src");
        fs::write(src.join("alpha/manifest.yaml"), "id: alpha\nversion: 0.2.0\n")
            .expect("new manifest");

        fs::create_dir_all(dst.join("alpha")).expect("mk alpha dst (stale)");
        fs::write(dst.join("alpha/manifest.yaml"), "id: alpha\nversion: 0.1.0\n")
            .expect("stale manifest");
        fs::write(dst.join("alpha/user-hack.txt"), "will be wiped").expect("user hack");

        let seeded = seed_dir(&src, &dst, true);
        assert_eq!(seeded, vec!["alpha"]);
        let manifest = fs::read_to_string(dst.join("alpha/manifest.yaml")).expect("read manifest");
        assert!(
            manifest.contains("0.2.0"),
            "force-reseed should replace stale manifest; got:\n{manifest}"
        );
        assert!(
            !dst.join("alpha/user-hack.txt").exists(),
            "force-reseed should wipe user-added files (this is the whole point)"
        );

        let _ = fs::remove_dir_all(&root);
    }

    /// Guard test: every Pack shipped under `assets/skill-packs/` must
    /// parse as a valid manifest and — if it declares `soul_inject` —
    /// the referenced files must exist and be non-empty.
    ///
    /// Triggers CI red if someone accidentally deletes `soul.md` or
    /// corrupts `manifest.yaml` for a bundled Pack.
    #[test]
    fn bundled_skill_packs_are_wellformed() {
        use crate::pack::manifest::{load_from_dir, ManifestLoadOutcome};

        let assets_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("assets")
            .join("skill-packs");
        assert!(
            assets_root.is_dir(),
            "bundled skill-packs dir missing: {}",
            assets_root.display()
        );

        let mut checked = 0usize;
        for entry in fs::read_dir(&assets_root).expect("read bundled packs") {
            let entry = entry.expect("entry");
            let pack_dir = entry.path();
            if !pack_dir.is_dir() {
                continue;
            }

            let pack_id = pack_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("<?>")
                .to_string();

            let manifest = match load_from_dir(&pack_dir) {
                ManifestLoadOutcome::Loaded(m) => m,
                ManifestLoadOutcome::Invalid(msg) => {
                    panic!("bundled pack '{pack_id}' manifest invalid: {msg}")
                }
            };

            for rel in &manifest.soul_inject {
                let soul_path = pack_dir.join(rel);
                assert!(
                    soul_path.exists(),
                    "bundled pack '{pack_id}' soul_inject file missing: {}",
                    soul_path.display()
                );
                let content = fs::read_to_string(&soul_path).unwrap_or_default();
                assert!(
                    content.trim().len() >= 30,
                    "bundled pack '{pack_id}' soul '{}' is too short ({} bytes) — provide real persona content",
                    rel,
                    content.trim().len()
                );
            }

            for rel in &manifest.skills {
                let skill_path = pack_dir.join(rel);
                assert!(
                    skill_path.exists(),
                    "bundled pack '{pack_id}' skill file missing: {}",
                    skill_path.display()
                );
            }

            for rel in &manifest.workflows {
                let wf_path = pack_dir.join(rel);
                assert!(
                    wf_path.exists(),
                    "bundled pack '{pack_id}' workflow file missing: {}",
                    wf_path.display()
                );
            }

            checked += 1;
        }

        assert!(checked > 0, "no bundled packs found under {}", assets_root.display());
    }
}
