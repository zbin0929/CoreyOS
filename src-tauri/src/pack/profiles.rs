//! Pack Profile lifecycle management.
//!
//! When a Pack with `profiles:` is enabled, we create the corresponding
//! Hermes profiles. When disabled, we delete them.
//!
//! This enables multi-agent collaboration via Hermes Kanban — each
//! profile is an isolated agent with its own SOUL, skills, and memory.

use std::fs;
use std::path::Path;

use tracing::{info, warn};

use super::manifest::ProfileSpec;
use crate::hermes_profiles;

/// Create Hermes profiles declared in a Pack manifest.
///
/// For each profile:
/// 1. Create profile via hermes_profiles module
/// 2. Copy the SOUL.md from Pack to profile dir
///
/// Returns the number of profiles successfully created.
pub fn install_profiles(
    profiles: &[ProfileSpec],
    pack_dir: &Path,
    hermes_dir: &Path,
) -> Result<usize, String> {
    let mut created = 0;

    for profile in profiles {
        if profile.id.is_empty() {
            warn!("skipping profile with empty id");
            continue;
        }

        // 1. Create profile (idempotent)
        match hermes_profiles::create_profile(&profile.id, None) {
            Ok(_) => {
                info!(profile_id = %profile.id, "profile created");
            }
            Err(e) => {
                let err_str = e.to_string();
                // "already exists" is not an error
                if !err_str.contains("already exists") && !err_str.contains("AlreadyExists") {
                    warn!(
                        profile_id = %profile.id,
                        error = %e,
                        "hermes profile create failed"
                    );
                    continue;
                }
            }
        }

        // 2. Copy SOUL.md if specified
        if !profile.soul.is_empty() {
            let soul_src = pack_dir.join(&profile.soul);
            if soul_src.exists() {
                // Profile dir is ~/.hermes/profiles/<id>/
                let profile_dir = hermes_dir.join("profiles").join(&profile.id);

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
    }

    Ok(created)
}

/// Delete Hermes profiles that were created by a Pack.
///
/// Called when a Pack is disabled or uninstalled.
///
/// Returns the number of profiles successfully deleted.
#[allow(dead_code)]
pub fn uninstall_profiles(profiles: &[ProfileSpec]) -> Result<usize, String> {
    let mut deleted = 0;

    for profile in profiles {
        if profile.id.is_empty() {
            continue;
        }

        match hermes_profiles::delete_profile(&profile.id, None) {
            Ok(_) => {
                deleted += 1;
                info!(profile_id = %profile.id, "profile deleted");
            }
            Err(e) => {
                let err_str = e.to_string();
                // "not found" is not an error
                if !err_str.contains("not found") && !err_str.contains("NotFound") {
                    warn!(
                        profile_id = %profile.id,
                        error = %e,
                        "hermes profile delete failed"
                    );
                }
            }
        }
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
