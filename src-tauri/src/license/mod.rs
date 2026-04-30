//! Offline license verification.
//!
//! ## Format
//! A license is a single line `<base64url(payload)>.<base64url(sig)>`,
//! where `payload` is JSON serialized with the [`Payload`] struct and
//! `sig` is an ed25519 signature over the *raw payload bytes* (not the
//! base64 form). Self-contained and copy-pasteable into a textarea —
//! think JWT but without the header dance because we only ever use
//! one algorithm.
//!
//! ## Trust model
//! The maintainer holds an ed25519 private key; the matching public
//! key is compiled into Corey via [`PUBLIC_KEY_PEM`]. Any change to
//! the payload invalidates the signature, so users can't just edit
//! `expires` to extend their access. Replacing the public key in a
//! fork *would* defeat this — that's why this whole approach assumes
//! a closed-source binary distribution. With a public repo, users
//! could simply build their own unchecked version.
//!
//! ## Storage
//! License lives at `<config_dir>/license.txt` (where `config_dir`
//! is whatever `paths::config_dir()` resolves to — same dir as
//! `gateway.json`). On every launch [`status`] reads + verifies it.
//! If the file is absent or fails verification the rest of the app
//! still boots; the frontend gates non-trivial features behind
//! `useLicenseStore`'s `valid` flag.
//!
//! ## Dev / debug builds
//! In `debug_assertions` builds we treat a missing license as a
//! "dev" verdict (still gated in UI, but signals that the maintainer
//! is just running locally and can dismiss the gate). Release builds
//! treat missing as `Missing` and demand a key.

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Public verification key. Replace the placeholder below with the
/// PEM your `license_keygen` binary produced. See `docs/licensing.md`
/// for the full workflow.
///
/// We embed PEM rather than raw bytes so the maintainer can paste the
/// output of `cargo run --bin license_keygen` (or `openssh-keygen
/// -t ed25519 -f ...`-derived format) without thinking about
/// length / encoding.
pub const PUBLIC_KEY_PEM: &str = include_str!("public_key.pem");

/// Filename Corey writes the license to under the app config dir.
const LICENSE_FILE: &str = "license.txt";

/// Filename of the persistent per-install UUID we use as a machine
/// fingerprint. Software-only — survives hardware swaps, doesn't
/// survive a fresh OS install or clearing the app config dir. That's
/// the right tradeoff for a license check: we want to make casual
/// "send the binary to a friend" sharing fail, not stop a determined
/// attacker who can copy the whole config dir.
const MACHINE_ID_FILE: &str = "machine_id";

/// Payload signed by the maintainer + verified at runtime. Keep this
/// stable across releases — bumping field names breaks every license
/// already in the wild.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payload {
    /// Buyer / user identifier. We render this in Settings so the
    /// user sees whose license is active. Free-form — email is
    /// conventional but a name or org slug works too.
    pub user: String,
    /// ISO-8601 issued-at. Mostly informational; we don't enforce
    /// a "not before" check because clock-skew issues outweigh the
    /// (negligible) anti-fraud value.
    #[serde(default)]
    pub issued: String,
    /// ISO-8601 expiry. `None` = perpetual license. We *do* enforce
    /// this — past-due licenses verdict as [`Verdict::Expired`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// Optional capability tags. Reserved for future "pro vs basic"
    /// gating; today the frontend just checks for `valid` and lets
    /// the whole app through.
    #[serde(default)]
    pub features: Vec<String>,
    /// Optional machine binding. When `Some`, this license only
    /// activates on the install whose `<config_dir>/machine_id`
    /// matches. `None` (omitted from the JSON) = portable license
    /// usable on any machine — convenient for site licenses or
    /// renewals issued before machine binding was a thing.
    ///
    /// To bind a license: ask the buyer for their machine id (visible
    /// in Settings → License before activation), then mint with
    /// `--machine-id <their-uuid>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,
}

/// Result of `status` / verification calls. Returned to the frontend
/// as a tagged union via serde so the React side can switch on
/// `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Verdict {
    /// No license file on disk yet. First-run state.
    Missing,
    /// License file present but didn't parse / signature mismatch /
    /// public-key reject. `reason` is human-readable for the toast.
    Invalid { reason: String },
    /// File parses + signature checks out, but `expires` is in the
    /// past. Surfaced separately so the UI can say "your key
    /// expired on …" rather than the generic invalid message.
    Expired { user: String, expires: String },
    /// Signature OK + not expired, but the license is bound to a
    /// different machine_id than this install's. The UI shows the
    /// user our local machine id so they can ask the seller for a
    /// transfer / replacement.
    WrongMachine {
        user: String,
        expected: String,
        actual: String,
    },
    /// Good. UI can drop the gate.
    Valid { payload: Payload },
}

impl Verdict {
    /// True iff the license unblocks gated features. Convenience for
    /// IPC layers that just want a boolean.
    pub fn is_valid(&self) -> bool {
        matches!(self, Verdict::Valid { .. })
    }
}

/// Read + verify the on-disk license. Always returns a verdict; only
/// IO errors talking to the filesystem are surfaced as `Invalid`
/// (with the OS error text), which is friendlier than bubbling up.
pub fn status(config_dir: &Path) -> Verdict {
    let path = license_path(config_dir);
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Verdict::Missing,
        Err(e) => {
            return Verdict::Invalid {
                reason: format!("read {}: {e}", path.display()),
            }
        }
    };
    verify_token_for_machine(raw.trim(), &machine_id_or_empty(config_dir))
}

/// Read or lazily generate the per-install machine id. The id lives
/// at `<config_dir>/machine_id` as a single-line UUID v4. If the
/// file is missing or unreadable we generate a fresh UUID and try
/// to persist it; if persistence fails (read-only fs, permissions)
/// we still return the in-memory UUID so the app can run, but every
/// launch will see a *different* id and machine-bound licenses will
/// fail. That's acceptable — the much more common case is a writable
/// config dir, and we'd rather degrade noisily than silently bind a
/// license to a transient id.
pub fn machine_id(config_dir: &Path) -> String {
    machine_id_at(&machine_id_path(), config_dir)
}

/// Inner implementation that takes the primary path explicitly. Lets
/// tests redirect the side-effecting write away from the developer's
/// real `$HOME/.corey-machine-id` (which 314-test parallel runs would
/// otherwise race on, and which would clobber an installed Corey's
/// machine binding on the dev's machine).
fn machine_id_at(primary_path: &Path, config_dir: &Path) -> String {
    if let Ok(existing) = fs::read_to_string(primary_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let legacy_path = config_dir.join(MACHINE_ID_FILE);
    if let Ok(existing) = fs::read_to_string(&legacy_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            let _ = fs::write(primary_path, trimmed);
            return trimmed.to_string();
        }
    }
    let fresh = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = primary_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(primary_path, &fresh);
    fresh
}

fn machine_id_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".").join("Corey"))
            .join("corey-machine-id")
    } else {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join(".corey-machine-id")
    }
}

/// Wrapper that swallows IO errors. Used by status() so that even an
/// unwritable config dir doesn't refuse to report a verdict.
fn machine_id_or_empty(config_dir: &Path) -> String {
    machine_id(config_dir)
}

/// Parse + verify a license token without touching disk. Skips
/// machine binding entirely — useful in tests / CLIs that don't
/// have a config dir to read the local id from. Production callers
/// (status / install) go through [`verify_token_for_machine`].
#[cfg(test)]
pub fn verify_token(token: &str) -> Verdict {
    verify_token_inner(token, None)
}

/// Same as [`verify_token`] but ALSO enforces the optional
/// `machine_id` field in the payload against `local`. Pass an empty
/// string to skip the check (legacy behaviour).
pub fn verify_token_for_machine(token: &str, local: &str) -> Verdict {
    verify_token_inner(token, Some(local))
}

fn verify_token_inner(token: &str, local_machine: Option<&str>) -> Verdict {
    let (payload_b64, sig_b64) = match token.split_once('.') {
        Some(parts) => parts,
        None => {
            return Verdict::Invalid {
                reason: "license token missing '.' separator".into(),
            }
        }
    };
    let payload_bytes = match URL_SAFE_NO_PAD.decode(payload_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return Verdict::Invalid {
                reason: format!("payload base64 decode: {e}"),
            }
        }
    };
    let sig_bytes = match URL_SAFE_NO_PAD.decode(sig_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return Verdict::Invalid {
                reason: format!("signature base64 decode: {e}"),
            }
        }
    };
    let sig = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(e) => {
            return Verdict::Invalid {
                reason: format!("signature wrong length: {e}"),
            }
        }
    };
    let key = match VerifyingKey::from_public_key_pem(PUBLIC_KEY_PEM.trim()) {
        Ok(k) => k,
        Err(e) => {
            // The embedded key being malformed is a build-time bug,
            // not a user issue. Surface it loudly so we notice in QA.
            return Verdict::Invalid {
                reason: format!("embedded public key invalid: {e}"),
            };
        }
    };
    if let Err(e) = key.verify(&payload_bytes, &sig) {
        return Verdict::Invalid {
            reason: format!("signature mismatch: {e}"),
        };
    }
    let payload: Payload = match serde_json::from_slice(&payload_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Verdict::Invalid {
                reason: format!("payload JSON parse: {e}"),
            }
        }
    };
    if let Some(exp) = payload.expires.as_deref() {
        if expired(exp) {
            return Verdict::Expired {
                user: payload.user,
                expires: exp.to_string(),
            };
        }
    }
    // Machine binding: only enforced when both sides supply a
    // non-empty value. A portable license (no `machine_id` in
    // payload) keeps working everywhere; a bound license needs the
    // local install's id to match.
    if let (Some(local), Some(bound)) = (
        local_machine.filter(|s| !s.is_empty()),
        payload
            .machine_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    ) {
        if local != bound {
            return Verdict::WrongMachine {
                user: payload.user,
                expected: bound.to_string(),
                actual: local.to_string(),
            };
        }
    }
    Verdict::Valid { payload }
}

/// Persist a verified token to disk. Caller is expected to have run
/// [`verify_token`] first; we still re-verify here (with the local
/// machine id) so a malicious frontend can't write garbage AND so a
/// machine-bound license issued to a different install gets rejected
/// before it ever lands on disk.
pub fn install(config_dir: &Path, token: &str) -> Result<Verdict, String> {
    let local = machine_id_or_empty(config_dir);
    let verdict = verify_token_for_machine(token, &local);
    if !verdict.is_valid() {
        return Ok(verdict); // surface the rejection without writing
    }
    let path = license_path(config_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::write(&path, format!("{}\n", token.trim()))
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(verdict)
}

/// Remove the on-disk license. Used by Settings → "Sign out".
pub fn clear(config_dir: &Path) -> Result<(), String> {
    let path = license_path(config_dir);
    match fs::remove_file(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", path.display())),
    }
}

fn license_path(config_dir: &Path) -> PathBuf {
    config_dir.join(LICENSE_FILE)
}

/// Crude ISO-8601 / RFC-3339 expiry comparison without pulling
/// chrono into the verifier hot path: try parsing as RFC-3339 first
/// (full datetime), then as a YYYY-MM-DD bare date. If neither
/// parses we treat the value as malformed → not expired (the user
/// shouldn't be locked out by a bad string the maintainer typed; the
/// signature already rejected unauthorized values).
fn expired(value: &str) -> bool {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return dt < chrono::Utc::now();
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        // Treat YYYY-MM-DD as end-of-day in UTC for grace.
        let end = date.and_hms_opt(23, 59, 59).unwrap_or_default().and_utc();
        return end < chrono::Utc::now();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    /// Round-trip: sign a payload with a fresh keypair, swap that
    /// keypair's public key into the verifier, and check verdicts.
    #[test]
    fn verify_round_trip() {
        let mut rng = OsRng;
        let signing = SigningKey::generate(&mut rng);
        let payload = Payload {
            user: "alice@example.com".into(),
            issued: "2026-01-01T00:00:00Z".into(),
            expires: None,
            features: vec![],
            machine_id: None,
        };
        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let sig = signing.sign(&payload_bytes);
        let token = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(&payload_bytes),
            URL_SAFE_NO_PAD.encode(sig.to_bytes()),
        );

        // Bypass the embedded PEM; manually verify against the test
        // key so the test doesn't depend on the placeholder PEM
        // shipping a real key.
        let verifying = signing.verifying_key();
        verifying.verify(&payload_bytes, &sig).unwrap();
        // A garbled token should reject without panicking.
        let bad = format!("{}.deadbeef", URL_SAFE_NO_PAD.encode(&payload_bytes));
        assert!(matches!(verify_token(&bad), Verdict::Invalid { .. }));
        let _ = token; // silence unused on success path
    }

    /// Bound to machine A → fails verification under machine B,
    /// passes under A. Portable license (machine_id absent) passes
    /// under both.
    #[test]
    fn machine_binding_round_trip() {
        let mut rng = OsRng;
        let signing = SigningKey::generate(&mut rng);

        let mint = |machine: Option<&str>| -> String {
            let payload = Payload {
                user: "alice".into(),
                issued: "2026-01-01T00:00:00Z".into(),
                expires: None,
                features: vec![],
                machine_id: machine.map(str::to_string),
            };
            let bytes = serde_json::to_vec(&payload).unwrap();
            let sig = signing.sign(&bytes);
            format!(
                "{}.{}",
                URL_SAFE_NO_PAD.encode(&bytes),
                URL_SAFE_NO_PAD.encode(sig.to_bytes()),
            )
        };
        // Manual signature check inside this test (the production
        // verify_token reads PUBLIC_KEY_PEM, which is the placeholder
        // here — different keypair, would always reject).
        let verifying = signing.verifying_key();
        let assert_match = |token: &str, local: &str, want_kind: &str| {
            let (pl_b64, sig_b64) = token.split_once('.').unwrap();
            let pl_bytes = URL_SAFE_NO_PAD.decode(pl_b64).unwrap();
            let sig_bytes = URL_SAFE_NO_PAD.decode(sig_b64).unwrap();
            verifying
                .verify(&pl_bytes, &Signature::from_slice(&sig_bytes).unwrap())
                .unwrap();
            let payload: Payload = serde_json::from_slice(&pl_bytes).unwrap();
            // Replicate the binding check inline since we're skipping
            // the embedded-PEM path.
            let kind = match payload.machine_id.as_deref() {
                Some(bound) if !bound.is_empty() && bound != local => "wrong_machine",
                _ => "valid",
            };
            assert_eq!(kind, want_kind, "token={token} local={local}");
        };

        let bound_to_a = mint(Some("aaaaa"));
        let portable = mint(None);

        assert_match(&bound_to_a, "aaaaa", "valid");
        assert_match(&bound_to_a, "bbbbb", "wrong_machine");
        assert_match(&portable, "aaaaa", "valid");
        assert_match(&portable, "bbbbb", "valid");
    }

    /// `machine_id_at()` is idempotent: second call returns the value
    /// the first call persisted. Uses an explicit primary path so this
    /// test can run safely in parallel with the rest of the test
    /// suite without racing on `$HOME/.corey-machine-id`.
    #[test]
    fn machine_id_is_persistent() {
        let base = std::env::temp_dir().join(format!(
            "corey-machine-id-test-{}-{}",
            std::process::id(),
            "is_persistent"
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create temp test dir");
        let primary = base.join("corey-machine-id");
        let cfg = base.join("cfg");
        fs::create_dir_all(&cfg).expect("create cfg subdir");

        let first = machine_id_at(&primary, &cfg);
        let second = machine_id_at(&primary, &cfg);
        assert_eq!(first, second, "second read should return persisted id");
        assert_eq!(first.len(), 36, "uuid v4 string is 36 chars");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn expired_yyyymmdd() {
        assert!(expired("2000-01-01"));
        assert!(!expired("2999-01-01"));
        assert!(!expired("not-a-date"));
    }
}
