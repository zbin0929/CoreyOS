//! Import + preview entry points. Split out of `mod.rs` so the module
//! root stays focused on types, constants, public wrappers, helpers
//! and the (chunky) test suite. The two functions here share enough
//! state-machine glue (manifest version gate, zip-slip + symlink
//! checks, atomic rename via tmp dir) to live together.

use std::fs;
use std::io::{self};
use std::path::Path;

use flate2::read::GzDecoder;
use serde_json::json;
use tar::Archive;

use crate::changelog;
use crate::hermes_profiles::{self as hp, ProfileInfo};

use super::{
    copy_then_delete, now_ms, profile_dir, read_manifest, safe_relative,
    strip_payload_prefix, ImportPreview, ImportResult, MANIFEST_VERSION, PAYLOAD_PREFIX,
};

/// Parse just the manifest + tally file stats without extracting. Lets
/// the UI render a "are you sure? this archive is 12 MB with 143 files
/// under the name 'work'" confirm dialog before the actual import.
pub fn preview_import(bytes: &[u8]) -> io::Result<ImportPreview> {
    let manifest = read_manifest(bytes)?;
    if manifest.version > MANIFEST_VERSION {
        return Err(io::Error::other(format!(
            "manifest version {} is newer than this build supports (max {MANIFEST_VERSION})",
            manifest.version
        )));
    }

    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    for entry in archive.entries()? {
        let entry = entry?;
        let path = entry.path()?;
        if !path.starts_with(PAYLOAD_PREFIX) {
            continue;
        }
        let kind = entry.header().entry_type();
        if kind.is_file() {
            file_count += 1;
            total_bytes = total_bytes.saturating_add(entry.size());
        }
    }
    Ok(ImportPreview {
        manifest,
        file_count,
        total_bytes,
    })
}

/// Extract `bytes` into `profiles_root/<target_name>/`, replacing any
/// existing dir only if `overwrite` is true. `target_name` defaults to
/// the manifest's name when `None`; validation applies either way.
pub fn import_profile_at(
    home: &Path,
    bytes: &[u8],
    target_name: Option<&str>,
    overwrite: bool,
    changelog_path: Option<&Path>,
) -> io::Result<ImportResult> {
    let manifest = read_manifest(bytes)?;
    if manifest.version > MANIFEST_VERSION {
        return Err(io::Error::other(format!(
            "manifest version {} is newer than this build supports (max {MANIFEST_VERSION})",
            manifest.version
        )));
    }

    let name = target_name.unwrap_or(manifest.name.as_str());
    hp::validate_name(name).map_err(io::Error::other)?;

    let dst = profile_dir(home, name);
    let overwrote = dst.exists();
    if overwrote {
        if !overwrite {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("profile '{name}' already exists"),
            ));
        }
        fs::remove_dir_all(&dst)?;
    }

    // Extract into a sibling temp dir first, then rename — this keeps
    // the write atomic from the UI's point of view. If extraction
    // fails halfway we leave the original alone (well, gone, if we
    // already removed it above — noted as a limitation below).
    //
    // NOTE: in the overwrite case we've already removed the original,
    // so a mid-extract failure leaves the user with *no* profile of
    // that name. Acceptable for a v1 — the alternative is a double-
    // copy (extract to temp, move original to `.bak`, rename temp,
    // delete `.bak`) which is worth the bytes only once users actually
    // hit the failure mode.
    let tmp = dst.with_extension("importing");
    if tmp.exists() {
        fs::remove_dir_all(&tmp)?;
    }
    fs::create_dir_all(&tmp)?;

    let mut file_count = 0usize;
    {
        let gz = GzDecoder::new(bytes);
        let mut archive = Archive::new(gz);
        archive.set_preserve_permissions(false); // keep umask-ish defaults
        archive.set_preserve_mtime(true);

        for entry in archive.entries()? {
            let mut entry = entry?;
            let raw_path = entry.path()?.into_owned();
            let Some(rel) = strip_payload_prefix(&raw_path) else {
                continue; // manifest, or stray top-level entries — skip
            };
            let safe_rel = match safe_relative(&rel) {
                Some(p) => p,
                None => {
                    // Rollback partial extraction.
                    let _ = fs::remove_dir_all(&tmp);
                    return Err(io::Error::other(format!(
                        "archive contains unsafe path: {}",
                        rel.display()
                    )));
                }
            };
            let out_path = tmp.join(&safe_rel);
            let ftype = entry.header().entry_type();
            if ftype.is_symlink() || ftype.is_hard_link() {
                let _ = fs::remove_dir_all(&tmp);
                return Err(io::Error::other(format!(
                    "archive contains a link entry: {}",
                    safe_rel.display()
                )));
            }
            if ftype.is_dir() {
                fs::create_dir_all(&out_path)?;
                continue;
            }
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = fs::File::create(&out_path)?;
            io::copy(&mut entry, &mut out)?;
            file_count += 1;
        }
    }

    // Commit: rename tmp → dst. If the rename fails (cross-device,
    // weird mount) fall back to a recursive move-by-copy.
    fs::rename(&tmp, &dst).or_else(|_| copy_then_delete(&tmp, &dst))?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.import",
            if overwrote {
                Some(json!({ "name": name }))
            } else {
                None
            },
            Some(json!({
                "name": name,
                "file_count": file_count,
                "source_name": manifest.name,
                "manifest_version": manifest.version,
            })),
            if overwrote {
                format!("Imported profile '{name}' (overwrote existing)")
            } else {
                format!("Imported profile '{name}'")
            },
        );
    }

    let profile = ProfileInfo {
        name: name.to_string(),
        path: dst.display().to_string(),
        is_active: hp::read_active(home).as_deref() == Some(name),
        updated_at: now_ms(),
    };

    Ok(ImportResult {
        profile,
        overwrote,
        file_count,
    })
}
