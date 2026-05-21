//! Pack Profile lifecycle management.
//!
//! When a Pack with `profiles:` is enabled, we create the corresponding
//! Hermes profiles. When disabled, we delete them.
//!
//! This enables multi-agent collaboration via Hermes Kanban — each
//! profile is an isolated agent with its own SOUL, skills, and memory.

use std::fs;
use std::path::Path;
use std::process::Command;

use tracing::{info, warn};

use super::manifest::ProfileSpec;

/// Create Hermes profiles declared in a Pack manifest.
///
/// For each profile:
/// 1. Run `hermes profile create <id>` (idempotent)
/// 2. Copy the SOUL.md from Pack to profile dir
///
/// Returns the number of profiles successfully created.
pub fn install_profiles(
    profiles: &[ProfileSpec],
    pack_dir: &Path,
    _hermes_dir: &Path,
) -> Result<usize, String> {
    let mut created = 0;

    for profile in profiles {
        if profile.id.is_empty() {
            warn!("skipping profile with empty id");
            continue;
        }

        // 1. Create profile (idempotent — Hermes handles existing)
        let output = Command::new("hermes")
            .args(["profile", "create", &profile.id])
            .output()
            .map_err(|e| format!("failed to run hermes profile create: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // "already exists" is not an error
            if !stderr.contains("already exists") {
                warn!(
                    profile_id = %profile.id,
                    stderr = %stderr,
                    "hermes profile create failed"
                );
                continue;
            }
        }

        // 2. Copy SOUL.md if specified
        if !profile.soul.is_empty() {
            let soul_src = pack_dir.join(&profile.soul);
            if soul_src.exists() {
                // Profile dir is ~/.hermes/profiles/<id>/
                let profile_dir = dirs::home_dir()
                    .ok_or("no home dir")?
                    .join(".hermes/profiles")
                    .join(&profile.id);

                let soul_dst = profile_dir.join("SOUL.md");

                if let Err(e) = fs::copy(&soul_src, &soul_dst) {
                    warn!(
                        profile_id = %profile.id,
                        src = %soul_src.display(),
                        dst = %soul_dst.display(),
                        error = %e,
                        "failed to copy SOUL.md"
                    );
                } else {
                    info!(
                        profile_id = %profile.id,
                        "SOUL.md installed"
                    );
                }
            } else {
                warn!(
                    profile_id = %profile.id,
                    path = %soul_src.display(),
                    "SOUL.md not found in pack"
                );
            }
        }

        created += 1;
        info!(profile_id = %profile.id, name = %profile.name, "profile created");
    }

    Ok(created)
}

/// Delete Hermes profiles that were created by a Pack.
///
/// Called when a Pack is disabled or uninstalled.
///
/// Returns the number of profiles successfully deleted.
pub fn uninstall_profiles(profiles: &[ProfileSpec]) -> Result<usize, String> {
    let mut deleted = 0;

    for profile in profiles {
        if profile.id.is_empty() {
            continue;
        }

        let output = Command::new("hermes")
            .args(["profile", "delete", &profile.id])
            .output()
            .map_err(|e| format!("failed to run hermes profile delete: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // "not found" is not an error
            if !stderr.contains("not found") && !stderr.contains("does not exist") {
                warn!(
                    profile_id = %profile.id,
                    stderr = %stderr,
                    "hermes profile delete failed"
                );
                continue;
            }
        }

        deleted += 1;
        info!(profile_id = %profile.id, "profile deleted");
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_profiles_is_noop() {
        let result = install_profiles(&[], Path::new("/tmp"), Path::new("/tmp"));
        assert!(result.is_ok());
        assert_eq!(result.expect("should succeed"), 0);
    }
}
