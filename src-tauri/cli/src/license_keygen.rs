//! One-shot ed25519 keypair generator for Corey's license system.
//!
//! Run once when you first set up licensing — keep the output **off
//! the public internet** and **out of the git repo**. The private
//! half lives on your machine + a backup; the public half goes into
//! `src-tauri/src/license/public_key.pem` so the app can verify
//! signed tokens.
//!
//! ```bash
//! cargo run --bin license_keygen -- ~/.corey-license
//! # writes ~/.corey-license/{private.pem,public.pem}
//! # then copy the public.pem into src-tauri/src/license/public_key.pem
//! # and rebuild Corey.
//! ```
//!
//! The directory is created if missing. Existing files are NOT
//! overwritten — the binary aborts so you can't accidentally clobber
//! your only copy of the private key.

use std::fs;
use std::path::PathBuf;

use ed25519_dalek::pkcs8::EncodePrivateKey;
use ed25519_dalek::pkcs8::EncodePublicKey;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .ok_or("usage: license_keygen <output-dir>")
        .map(PathBuf::from)?;
    fs::create_dir_all(&dir)?;
    let priv_path = dir.join("private.pem");
    let pub_path = dir.join("public.pem");
    if priv_path.exists() || pub_path.exists() {
        return Err(format!(
            "refusing to overwrite existing keypair at {}; delete the files manually if you really want to regenerate (this invalidates every license you've issued)",
            dir.display(),
        )
        .into());
    }

    let mut rng = OsRng;
    let signing = SigningKey::generate(&mut rng);
    let verifying = signing.verifying_key();

    let priv_pem = signing.to_pkcs8_pem(ed25519_dalek::pkcs8::spki::der::pem::LineEnding::LF)?;
    let pub_pem =
        verifying.to_public_key_pem(ed25519_dalek::pkcs8::spki::der::pem::LineEnding::LF)?;

    fs::write(&priv_path, priv_pem.as_bytes())?;
    fs::write(&pub_path, pub_pem.as_bytes())?;

    // Lock down private key perms on POSIX. Windows users get the
    // ACL inherited from the directory; if that's the user's home
    // it's already private.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&priv_path, fs::Permissions::from_mode(0o600))?;
    }

    println!("✓ keypair generated:");
    println!("  private: {} (KEEP SECRET)", priv_path.display());
    println!("  public:  {}", pub_path.display());
    println!();
    println!("Next: copy the public key into the source tree —");
    println!(
        "  cp {} src-tauri/src/license/public_key.pem",
        pub_path.display()
    );
    println!("…then rebuild Corey. The new pub key replaces the placeholder.");
    Ok(())
}
