//! Pack skills install / uninstall.
//!
//! Stage 4 of the Pack subsystem rollout: when a Pack is enabled,
//! copy each skill file declared in `manifest.skills` from the
//! read-only Pack folder (`<pack_dir>/skills/...`) into Hermes'
//! skills tree (`~/.hermes/skills/pack__<pack_id>/...`) so the
//! Hermes agent picks them up on its next gateway cycle.
//!
//! Why a copy and not a symlink?
//!
//! - **Cross-platform**: Windows symlinks need admin / developer
//!   mode. Copies just work.
//! - **Read-only invariant intact**: Pack folder stays untouched
//!   per architecture iron rule #2.
//! - **Cleanup is trivial**: deleting the prefixed subdirectory
//!   removes everything we wrote.
//!
//! Subdirectory layout under `~/.hermes/skills/`:
//!
//! ```text
//! skills/
//!   pack__cross_border_ecom/
//!     ad_check.md
//!     profit/
//!       calc.md
//!   pack__finance/
//!     invoice.md
//! ```
//!
//! The `pack__<id>__` prefix would have worked too, but a directory
//! cluster reads better in the existing Skills page tree view and
//! lets a `~/.hermes/skills/pack__<id>/` `rm -r` clean up
//! everything in one syscall.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::pack::manifest::PackManifest;

/// Subdirectory under `~/.hermes/skills/` reserved for Pack-owned
/// files. The prefix lets us distinguish them from user-curated
/// skills in the same tree.
pub const PACK_SKILLS_DIR_PREFIX: &str = "pack__";

/// Compute the destination directory for a Pack's installed
/// skills. The Pack id is appended verbatim (the manifest schema
/// guarantees it's filesystem-safe — see `manifest::is_safe_id`).
pub fn pack_skills_dir(hermes_dir: &Path, pack_id: &str) -> PathBuf {
    hermes_dir
        .join("skills")
        .join(format!("{PACK_SKILLS_DIR_PREFIX}{pack_id}"))
}

/// Copy every file listed in `manifest.skills` from the Pack
/// folder into the destination dir. Returns the number of files
/// installed. Files are overwritten if they already exist
/// (re-enable after a Pack upgrade picks up new contents).
///
/// Source paths in the manifest are relative to the Pack root.
/// Subdirectories are mirrored: a manifest entry of
/// `skills/profit/calc.md` produces `<dest>/profit/calc.md`,
/// where `<dest>` is `pack_skills_dir(hermes_dir, manifest.id)`.
///
/// Best-effort: a missing source file is logged at warn and
/// skipped rather than aborting the whole install. The intent
/// is that a typo in `manifest.skills` doesn't make a Pack
/// unenable-able — the user gets an obvious hint in the logs
/// + the file simply isn't available.
pub fn install_skills(
    manifest: &PackManifest,
    pack_dir: &Path,
    hermes_dir: &Path,
) -> io::Result<usize> {
    if manifest.skills.is_empty() {
        return Ok(0);
    }
    let dest_root = pack_skills_dir(hermes_dir, &manifest.id);
    fs::create_dir_all(&dest_root)?;

    let mut copied = 0usize;
    for rel in &manifest.skills {
        let src = pack_dir.join(rel);
        let target_rel = strip_skills_prefix(rel);
        let dest = dest_root.join(&target_rel);
        if !src.exists() {
            tracing::warn!(
                pack = %manifest.id,
                skill = %rel,
                "skill source file missing; skipping"
            );
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&src, &dest)?;
        copied += 1;
    }
    Ok(copied)
}

/// Remove the entire pack skills directory. Idempotent: a
/// missing dir is `Ok(())`. Used both during disable and as part
/// of uninstall flow.
pub fn uninstall_skills(pack_id: &str, hermes_dir: &Path) -> io::Result<()> {
    let dir = pack_skills_dir(hermes_dir, pack_id);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Drop a leading `skills/` segment from a manifest path so we
/// don't end up with `<dest>/skills/foo.md` (double-nested).
/// Manifest authors usually write `skills/profit_calc.md`; the
/// `skills/` is redundant once we're inside `pack_skills_dir`.
fn strip_skills_prefix(rel: &str) -> PathBuf {
    let p = Path::new(rel);
    let mut comps = p.components();
    if let Some(first) = comps.next() {
        if first.as_os_str() == "skills" {
            return comps.as_path().to_path_buf();
        }
    }
    p.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::parse;
    use crate::pack::ManifestLoadOutcome;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "corey-pack-skills-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("create test dir");
        d
    }

    fn parse_manifest(yaml: &str) -> PackManifest {
        match parse(yaml) {
            ManifestLoadOutcome::Loaded(m) => *m,
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[test]
    fn pack_skills_dir_uses_prefix() {
        let p = pack_skills_dir(Path::new("/h"), "foo");
        assert_eq!(p, PathBuf::from("/h/skills/pack__foo"));
    }

    #[test]
    fn strip_skills_prefix_drops_leading_skills_segment() {
        assert_eq!(
            strip_skills_prefix("skills/foo.md"),
            PathBuf::from("foo.md")
        );
        assert_eq!(
            strip_skills_prefix("skills/profit/calc.md"),
            PathBuf::from("profit/calc.md")
        );
        // Without the prefix segment, the path is preserved as-is.
        assert_eq!(strip_skills_prefix("foo.md"), PathBuf::from("foo.md"));
    }

    #[test]
    fn install_skips_missing_files_without_aborting() {
        let pack_dir = temp_dir("install-missing-skips");
        // Create skills/a.md but not skills/b.md.
        fs::create_dir_all(pack_dir.join("skills")).expect("test fixture");
        fs::write(pack_dir.join("skills/a.md"), "# A").expect("test fixture");

        let hermes = temp_dir("install-missing-hermes");
        let manifest = parse_manifest(
            r#"
schema_version: 1
id: foo
version: "1.0.0"
skills:
  - skills/a.md
  - skills/b.md
"#,
        );
        let n = install_skills(&manifest, &pack_dir, &hermes).expect("install");
        assert_eq!(n, 1, "only the present file is copied");
        let copied = hermes.join("skills/pack__foo/a.md");
        assert!(copied.exists());

        let _ = fs::remove_dir_all(&pack_dir);
        let _ = fs::remove_dir_all(&hermes);
    }

    #[test]
    fn install_mirrors_subdirectories() {
        let pack_dir = temp_dir("install-subdirs");
        fs::create_dir_all(pack_dir.join("skills/profit")).expect("test fixture");
        fs::write(pack_dir.join("skills/profit/calc.md"), "# Calc").expect("test fixture");
        fs::write(pack_dir.join("skills/top.md"), "# Top").expect("test fixture");

        let hermes = temp_dir("install-subdirs-hermes");
        let manifest = parse_manifest(
            r#"
schema_version: 1
id: bar
version: "1.0.0"
skills:
  - skills/top.md
  - skills/profit/calc.md
"#,
        );
        install_skills(&manifest, &pack_dir, &hermes).expect("install");
        assert!(hermes.join("skills/pack__bar/top.md").exists());
        assert!(hermes.join("skills/pack__bar/profit/calc.md").exists());

        let _ = fs::remove_dir_all(&pack_dir);
        let _ = fs::remove_dir_all(&hermes);
    }

    #[test]
    fn install_overwrites_existing_files() {
        let pack_dir = temp_dir("install-overwrite-pack");
        fs::create_dir_all(pack_dir.join("skills")).expect("test fixture");
        fs::write(pack_dir.join("skills/a.md"), "# new content").expect("test fixture");

        let hermes = temp_dir("install-overwrite-hermes");
        let dest_dir = pack_skills_dir(&hermes, "foo");
        fs::create_dir_all(&dest_dir).expect("test fixture");
        fs::write(dest_dir.join("a.md"), "# stale").expect("test fixture");

        let manifest = parse_manifest(
            r#"
schema_version: 1
id: foo
version: "1.0.0"
skills:
  - skills/a.md
"#,
        );
        install_skills(&manifest, &pack_dir, &hermes).expect("install");
        let copied = fs::read_to_string(dest_dir.join("a.md")).expect("test fixture");
        assert_eq!(copied, "# new content");

        let _ = fs::remove_dir_all(&pack_dir);
        let _ = fs::remove_dir_all(&hermes);
    }

    #[test]
    fn uninstall_removes_pack_dir() {
        let hermes = temp_dir("uninstall-removes");
        let dir = pack_skills_dir(&hermes, "foo");
        fs::create_dir_all(&dir).expect("test fixture");
        fs::write(dir.join("a.md"), "x").expect("test fixture");
        assert!(dir.exists());

        uninstall_skills("foo", &hermes).expect("uninstall");
        assert!(!dir.exists());

        let _ = fs::remove_dir_all(&hermes);
    }

    #[test]
    fn uninstall_is_idempotent_on_missing_dir() {
        let hermes = temp_dir("uninstall-idempotent");
        // Never installed; uninstall still succeeds.
        uninstall_skills("ghost", &hermes).expect("idempotent uninstall");
        let _ = fs::remove_dir_all(&hermes);
    }

    #[test]
    fn install_is_noop_on_empty_skills_list() {
        let pack_dir = temp_dir("install-noop-pack");
        let hermes = temp_dir("install-noop-hermes");
        let manifest = parse_manifest(
            r#"
schema_version: 1
id: tiny
version: "1.0.0"
"#,
        );
        let n = install_skills(&manifest, &pack_dir, &hermes).expect("install");
        assert_eq!(n, 0);
        // Destination dir is not even created.
        assert!(!pack_skills_dir(&hermes, "tiny").exists());

        let _ = fs::remove_dir_all(&pack_dir);
        let _ = fs::remove_dir_all(&hermes);
    }
}
