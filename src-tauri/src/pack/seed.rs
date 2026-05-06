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

/// Copy every bundled Pack into `<hermes_dir>/skill-packs/<id>/` if
/// the target doesn't already exist. Returns the list of pack ids
/// that were freshly seeded (empty on subsequent launches).
///
/// Best-effort: failures on individual packs are logged and skipped
/// rather than aborting startup. A missing source dir (dev build
/// without bundled assets) is also a quiet no-op.
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

    seed_dir(&src_root, &dst_root)
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

fn seed_dir(src_root: &Path, dst_root: &Path) -> Vec<String> {
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
            continue;
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

        let seeded = seed_dir(&src, &dst);
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
        let seeded = seed_dir(&root.join("nope"), &dst);
        assert!(seeded.is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
