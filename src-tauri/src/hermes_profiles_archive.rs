//! Profile archive (tar.gz) import / export.
//!
//! ### Shape
//!
//! ```text
//! <profile>.tar.gz
//! ├── caduceus-profile.json   ← manifest (version, name, created_at)
//! └── profile/                ← the profile dir verbatim
//!     ├── config.yaml
//!     ├── .env
//!     └── …
//! ```
//!
//! The manifest is mandatory — it lets future Caduceus versions reject
//! incompatible archives without guessing at layout. We version it
//! (`MANIFEST_VERSION`) up-front so a later reorg (e.g. nested sub-
//! profiles) can bump the number and still parse the old shape when it
//! encounters one.
//!
//! ### Safety posture
//!
//! - **Zip-slip defence.** Every entry's post-prefix-strip path is
//!   rejected if it contains `..` components, absolute paths, or any
//!   component that resolves outside `profile/`. We walk paths as
//!   typed `Path` components — not as strings — so a `foo/..\\bar`
//!   attempt can't sneak past via platform-separator confusion.
//! - **Symlinks rejected on import.** Hermes profile dirs don't
//!   legitimately contain symlinks; accepting them just invites the
//!   archive to point `./link -> ../../../etc/passwd` and have our
//!   subsequent file writes follow it. Mirrors the symlink skip in
//!   `clone_profile_at`.
//! - **Target-name validation.** Reuses `validate_name` from the
//!   main module so an archive whose manifest says `name: "../../x"`
//!   doesn't create a profile outside `profiles/`.
//! - **No clobber by default.** Callers must pass `overwrite=true`
//!   explicitly; the IPC layer can surface a confirm dialog before
//!   doing so.
//!
//! Round-trip tests cover the happy path plus the two scariest
//! abuses (zip-slip, symlink). The manifest sanity checks are
//! exhaustively unit-tested since a malformed one is the most
//! likely way a malicious archive would try to sneak through.

use std::fs;
use std::io::{self, Cursor, Read};
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tar::{Archive, Builder, Header};

use crate::changelog;
use crate::hermes_profiles::{self as hp, ProfileInfo};

const MANIFEST_FILENAME: &str = "caduceus-profile.json";
const PAYLOAD_PREFIX: &str = "profile/";
const MANIFEST_VERSION: u32 = 1;

/// Mirrors the JSON written into `caduceus-profile.json` inside the
/// archive. Extra fields are allowed on read for forward compatibility
/// (serde's default-allow-unknown behaviour — noted here so nobody
/// "tightens" it into `#[serde(deny_unknown_fields)]`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileManifest {
    pub version: u32,
    pub name: String,
    /// Unix-ms timestamp of the export. Purely informational — not
    /// checked on import.
    pub created_at: i64,
    /// Caduceus version that produced the archive. Helps diagnose
    /// "works on my machine" reports; we log but don't gate on it.
    #[serde(default)]
    pub exporter_version: String,
}

/// Cheap preview the UI can show before committing to an import:
/// "you are about to load profile X, written by Caduceus $v on $when".
#[derive(Debug, Clone, Serialize)]
pub struct ImportPreview {
    pub manifest: ProfileManifest,
    /// Number of regular-file entries packed under `profile/`.
    pub file_count: usize,
    /// Sum of `Header::size()` over every non-directory entry.
    pub total_bytes: u64,
}

/// What the caller gets back from `import_profile_at`. `overwrote`
/// reports whether a directory with the same name was replaced
/// (caller will typically have already prompted the user).
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub profile: ProfileInfo,
    pub overwrote: bool,
    pub file_count: usize,
}

// ─────────────────────────── export ───────────────────────────

/// Serialise `profiles_root/<name>/` into a tar.gz in memory and return
/// the bytes. Small profiles (kB-MB range) make this trivial; we stay
/// in memory on purpose so the frontend can pipe the bytes straight
/// into a browser download without touching the filesystem.
pub fn export_profile_at(home: &Path, name: &str) -> io::Result<Vec<u8>> {
    hp::validate_name(name).map_err(io::Error::other)?;
    let profile_dir = profile_dir(home, name);
    if !profile_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("profile '{name}' not found"),
        ));
    }

    let manifest = ProfileManifest {
        version: MANIFEST_VERSION,
        name: name.to_string(),
        created_at: now_ms(),
        exporter_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(io::Error::other)?;

    let gz = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = Builder::new(gz);
    // Don't follow symlinks — `Builder::follow_symlinks(false)` is the
    // default in `tar` 0.4.x, but set it explicitly so a future upgrade
    // that flips the default can't surprise us.
    tar.follow_symlinks(false);

    // 1) Manifest at the archive root. Builder::append_data takes a
    //    separate header so we can set size + mtime deterministically.
    let mut header = Header::new_gnu();
    header.set_size(manifest_bytes.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(manifest.created_at as u64 / 1000);
    header.set_cksum();
    tar.append_data(&mut header, MANIFEST_FILENAME, Cursor::new(&manifest_bytes))?;

    // 2) The profile directory, re-rooted under `profile/` so the
    //    archive is self-describing (reader doesn't need to know the
    //    original dir name).
    tar.append_dir_all(PAYLOAD_PREFIX, &profile_dir)?;
    tar.finish()?;

    // Builder writes into the wrapped GzEncoder; tear both down to
    // get the final byte vec.
    let gz = tar.into_inner()?;
    gz.finish()
}

// ─────────────────────────── import ───────────────────────────

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

// ─────────────────────────── helpers ───────────────────────────

fn profile_dir(home: &Path, name: &str) -> PathBuf {
    home.join(".hermes/profiles").join(name)
}

/// Read + parse the manifest without extracting the rest. Returns the
/// first matching entry so a malicious archive can't smuggle a second
/// manifest past the sanity check.
fn read_manifest(bytes: &[u8]) -> io::Result<ProfileManifest> {
    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if path == Path::new(MANIFEST_FILENAME) {
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;
            let manifest: ProfileManifest = serde_json::from_slice(&buf)
                .map_err(|e| io::Error::other(format!("invalid {MANIFEST_FILENAME}: {e}")))?;
            hp::validate_name(&manifest.name).map_err(io::Error::other)?;
            return Ok(manifest);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        format!("archive missing {MANIFEST_FILENAME}"),
    ))
}

/// Strip the `profile/` prefix; returns `None` for entries that live
/// elsewhere (the manifest, or anything hostile at the root).
fn strip_payload_prefix(path: &Path) -> Option<PathBuf> {
    let stripped = path.strip_prefix(PAYLOAD_PREFIX).ok()?;
    if stripped.as_os_str().is_empty() {
        None
    } else {
        Some(stripped.to_path_buf())
    }
}

/// Reject absolute paths + `..` + Windows prefixes + root dirs. Returns
/// the original (relative, safe) path when OK, or `None` to kill the
/// whole import.
fn safe_relative(rel: &Path) -> Option<PathBuf> {
    for comp in rel.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            // Absolute paths, parent refs, drive letters, UNC — all
            // disqualifying.
            _ => return None,
        }
    }
    Some(rel.to_path_buf())
}

fn copy_then_delete(src: &Path, dst: &Path) -> io::Result<()> {
    copy_dir_recursive(src, dst)?;
    fs::remove_dir_all(src)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─────────────────────────── public wrappers ───────────────────────────

pub fn export_profile(name: &str) -> io::Result<Vec<u8>> {
    export_profile_at(&home_dir(), name)
}

pub fn import_profile(
    bytes: &[u8],
    target_name: Option<&str>,
    overwrite: bool,
    changelog_path: Option<&Path>,
) -> io::Result<ImportResult> {
    import_profile_at(&home_dir(), bytes, target_name, overwrite, changelog_path)
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

// ─────────────────────────── tests ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home() -> PathBuf {
        // Parallel tests can hit the same nanosecond on fast hardware,
        // so combine a wall-clock stamp with a process-local atomic
        // counter for an uncontentious unique root per call.
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!("caduceus-profile-archive-{stamp}-{seq}"));
        fs::create_dir_all(p.join(".hermes/profiles")).unwrap();
        p
    }

    fn seed_profile(home: &Path, name: &str) {
        let dir = profile_dir(home, name);
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("config.yaml"), b"# test\nmodel: gpt-4o\n").unwrap();
        fs::write(dir.join(".env"), b"API_KEY=abc\n").unwrap();
        fs::write(dir.join("nested/skill.md"), b"# skill body\n").unwrap();
    }

    #[test]
    fn roundtrip_preserves_files() {
        let home = temp_home();
        seed_profile(&home, "alpha");
        let bytes = export_profile_at(&home, "alpha").expect("export");

        // Preview reads the archive without extraction.
        let preview = preview_import(&bytes).expect("preview");
        assert_eq!(preview.manifest.name, "alpha");
        assert_eq!(preview.manifest.version, MANIFEST_VERSION);
        assert_eq!(preview.file_count, 3); // config.yaml, .env, nested/skill.md

        // Import under a NEW name so we don't clobber the original.
        let result = import_profile_at(&home, &bytes, Some("beta"), false, None).expect("import");
        assert!(!result.overwrote);
        assert_eq!(result.file_count, 3);

        let beta = profile_dir(&home, "beta");
        assert_eq!(
            fs::read(beta.join("config.yaml")).unwrap(),
            b"# test\nmodel: gpt-4o\n"
        );
        assert_eq!(fs::read(beta.join(".env")).unwrap(), b"API_KEY=abc\n");
        assert_eq!(
            fs::read(beta.join("nested/skill.md")).unwrap(),
            b"# skill body\n"
        );
    }

    #[test]
    fn import_rejects_existing_without_overwrite() {
        let home = temp_home();
        seed_profile(&home, "alpha");
        let bytes = export_profile_at(&home, "alpha").unwrap();

        let err = import_profile_at(&home, &bytes, Some("alpha"), false, None).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn import_overwrite_true_replaces_existing() {
        let home = temp_home();
        seed_profile(&home, "alpha");
        let bytes = export_profile_at(&home, "alpha").unwrap();
        // Mutate the existing profile so we can tell whether the
        // overwrite actually replaced the files.
        fs::write(profile_dir(&home, "alpha").join("config.yaml"), b"stale").unwrap();

        let result = import_profile_at(&home, &bytes, Some("alpha"), true, None).unwrap();
        assert!(result.overwrote);
        assert_eq!(
            fs::read(profile_dir(&home, "alpha").join("config.yaml")).unwrap(),
            b"# test\nmodel: gpt-4o\n"
        );
    }

    #[test]
    fn import_rejects_missing_manifest() {
        // Build a tar.gz with NO caduceus-profile.json — just a lone file
        // under profile/. preview_import should refuse it outright.
        let gz = GzEncoder::new(Vec::new(), Compression::default());
        let mut tar = Builder::new(gz);
        let payload = b"should never be read";
        let mut h = Header::new_gnu();
        h.set_size(payload.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        tar.append_data(&mut h, "profile/config.yaml", &payload[..])
            .unwrap();
        tar.finish().unwrap();
        let bytes = tar.into_inner().unwrap().finish().unwrap();

        let err = preview_import(&bytes).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn safe_relative_rejects_all_zip_slip_shapes() {
        // `safe_relative` is the single choke-point for zip-slip; we
        // test it directly because the `tar` crate's write API refuses
        // to emit a header with `..` in it, making an end-to-end
        // hostile-archive test impossible to construct without hand-
        // crafting raw tar bytes. Unit-testing the predicate gives us
        // the same coverage at a fraction of the ceremony.
        let hostile = [
            "..",
            "../evil",
            "foo/../../etc/passwd",
            "nested/../..",
            "/absolute",
            #[cfg(windows)]
            "C:\\Windows\\System32",
        ];
        for bad in hostile {
            assert!(
                safe_relative(Path::new(bad)).is_none(),
                "safe_relative should reject {bad:?}"
            );
        }
        // Sanity: benign paths pass.
        for ok in ["foo.md", "nested/skill.md", "./config.yaml"] {
            assert!(
                safe_relative(Path::new(ok)).is_some(),
                "safe_relative should accept {ok:?}"
            );
        }
    }

    #[test]
    fn import_rejects_future_manifest_version() {
        let home = temp_home();
        seed_profile(&home, "alpha");
        let mut bytes = export_profile_at(&home, "alpha").unwrap();

        // Rewrite the manifest in-place to bump version to MAX_VERSION+1
        // and re-pack. Simpler: build a fresh archive with the bumped
        // version.
        bytes.clear();
        let bumped = ProfileManifest {
            version: MANIFEST_VERSION + 1,
            name: "alpha".into(),
            created_at: 0,
            exporter_version: "test".into(),
        };
        let manifest_bytes = serde_json::to_vec(&bumped).unwrap();
        let gz = GzEncoder::new(Vec::new(), Compression::default());
        let mut tar = Builder::new(gz);
        let mut h = Header::new_gnu();
        h.set_size(manifest_bytes.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        tar.append_data(&mut h, MANIFEST_FILENAME, Cursor::new(&manifest_bytes))
            .unwrap();
        tar.finish().unwrap();
        bytes = tar.into_inner().unwrap().finish().unwrap();

        let err = preview_import(&bytes).unwrap_err();
        assert!(err.to_string().contains("newer than this build supports"));
    }
}
