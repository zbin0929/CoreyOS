//! Pack scanner — walks `~/.hermes/skill-packs/` and loads the
//! manifest of every immediate subdirectory.
//!
//! Stage 2 of the Pack subsystem rollout (see `mod.rs` header).
//! This stage discovers Packs and reads their declared shape; it
//! does NOT yet spawn MCP servers, mount routes, or honour the
//! enable flag. That happens in stages 3-5.
//!
//! Failure model: best-effort. A subdirectory without a
//! `manifest.yaml`, or with an unparseable one, is recorded as a
//! `DiscoveredPack` with `manifest = None` and an error string.
//! The caller (UI / IPC) shows it to the user instead of silently
//! pretending the Pack doesn't exist — silent skip would make Pack
//! authoring infuriating.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::pack::manifest::{self, ManifestLoadOutcome, PackManifest};

/// One subdirectory of `skill-packs/`. The scanner produces these
/// regardless of whether the manifest parsed; the registry layer
/// promotes them to `LoadedPack` only on success.
#[derive(Debug, Clone)]
pub struct DiscoveredPack {
    /// Directory name on disk (NOT necessarily the manifest's `id`
    /// — we surface mismatches as errors so a Pack zip extracted
    /// to the wrong folder name doesn't quietly load).
    pub dir_name: String,
    /// Absolute path to the Pack folder.
    pub dir_path: PathBuf,
    /// Parsed manifest, or `None` if loading failed.
    pub manifest: Option<Arc<PackManifest>>,
    /// Human-readable error message; `None` when load succeeded.
    pub error: Option<String>,
}

/// Walk `<root>/*/manifest.yaml` and return one entry per
/// immediate subdirectory of `root`. Hidden directories (leading
/// `.`) are skipped — that's where dotfiles like `.DS_Store` live
/// on macOS.
///
/// `root` does not need to exist; a missing dir yields an empty
/// `Vec` so a default-Corey install (no Packs ever installed) is
/// the same as "no Packs found".
pub fn scan_skill_packs_dir(root: &Path) -> Vec<DiscoveredPack> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return out,
        Err(e) => {
            tracing::warn!(
                error = %e,
                root = %root.display(),
                "scan_skill_packs_dir: read_dir failed"
            );
            return out;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let dir_name = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue, // non-UTF-8 dir name — ignore
        };
        if dir_name.starts_with('.') {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                out.push(DiscoveredPack {
                    dir_name: dir_name.clone(),
                    dir_path: path,
                    manifest: None,
                    error: Some(format!("metadata: {e}")),
                });
                continue;
            }
        };
        if !metadata.is_dir() {
            // Skip stray files at the top of skill-packs/ (README,
            // .DS_Store-style noise, half-extracted zips). Don't
            // surface as errors — they're not Packs.
            continue;
        }

        let outcome = manifest::load_from_dir(&path);
        let (manifest_opt, error_opt) = match outcome {
            ManifestLoadOutcome::Loaded(m) => (Some(Arc::new(*m)), None),
            ManifestLoadOutcome::Invalid(reason) => (None, Some(reason)),
        };

        // Spec sanity: manifest.id should match the directory name.
        // Mismatch isn't a hard fail — we surface it as a warning
        // alongside the manifest so the user can rename.
        let mut error = error_opt;
        if let Some(m) = &manifest_opt {
            if m.id != dir_name {
                let warn = format!(
                    "manifest.id {:?} does not match folder name {:?}; rename folder or fix manifest",
                    m.id, dir_name
                );
                error = Some(match error {
                    Some(e) => format!("{e}; {warn}"),
                    None => warn,
                });
            }
        }

        out.push(DiscoveredPack {
            dir_name,
            dir_path: path,
            manifest: manifest_opt,
            error,
        });
    }

    // Sort by dir_name so the IPC payload is stable across reads.
    out.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("corey-pack-scan-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scan test root");
        dir
    }

    fn write_manifest(pack_dir: &Path, body: &str) {
        fs::create_dir_all(pack_dir).expect("create pack dir");
        fs::write(pack_dir.join("manifest.yaml"), body).expect("write manifest");
    }

    #[test]
    fn missing_root_yields_empty() {
        let nope = std::env::temp_dir().join("corey-pack-scan-nonexistent");
        let _ = fs::remove_dir_all(&nope);
        assert!(scan_skill_packs_dir(&nope).is_empty());
    }

    #[test]
    fn empty_root_yields_empty() {
        let root = temp_root("empty");
        assert!(scan_skill_packs_dir(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn happy_path_two_packs_sorted() {
        let root = temp_root("two");
        write_manifest(
            &root.join("alpha"),
            "schema_version: 1\nid: alpha\nversion: \"1.0.0\"\n",
        );
        write_manifest(
            &root.join("beta"),
            "schema_version: 1\nid: beta\nversion: \"1.0.0\"\n",
        );
        let out = scan_skill_packs_dir(&root);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].dir_name, "alpha");
        assert_eq!(out[1].dir_name, "beta");
        assert!(out[0].manifest.is_some());
        assert!(out[0].error.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn malformed_manifest_surfaces_error_not_silent_skip() {
        let root = temp_root("malformed");
        // Empty manifest is rejected by parser.
        write_manifest(&root.join("broken"), "");
        let out = scan_skill_packs_dir(&root);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dir_name, "broken");
        assert!(out[0].manifest.is_none());
        assert!(out[0].error.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn id_dir_mismatch_warns_but_loads() {
        let root = temp_root("mismatch");
        // manifest.id is "actual", folder is "wrong_name".
        write_manifest(
            &root.join("wrong_name"),
            "schema_version: 1\nid: actual\nversion: \"1.0.0\"\n",
        );
        let out = scan_skill_packs_dir(&root);
        assert_eq!(out.len(), 1);
        assert!(out[0].manifest.is_some());
        assert!(out[0]
            .error
            .as_ref()
            .expect("warn populated")
            .contains("does not match folder name"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hidden_directories_are_skipped() {
        let root = temp_root("hidden");
        write_manifest(
            &root.join(".hidden"),
            "schema_version: 1\nid: hidden\nversion: \"1.0.0\"\n",
        );
        write_manifest(
            &root.join("visible"),
            "schema_version: 1\nid: visible\nversion: \"1.0.0\"\n",
        );
        let out = scan_skill_packs_dir(&root);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dir_name, "visible");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn stray_files_at_root_are_ignored() {
        let root = temp_root("stray");
        fs::write(root.join("README.md"), "noise").expect("write stray");
        fs::write(root.join(".DS_Store"), "macnoise").expect("write ds");
        write_manifest(
            &root.join("real_pack"),
            "schema_version: 1\nid: real_pack\nversion: \"1.0.0\"\n",
        );
        let out = scan_skill_packs_dir(&root);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dir_name, "real_pack");
        let _ = fs::remove_dir_all(&root);
    }
}
