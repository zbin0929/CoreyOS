# 07 · Release & Distribution

> **Strategy 2026-04-24**: repo stays private, releases are built locally
> on the maintainer's Mac and handed to users out-of-band (direct link,
> chat, USB, whatever). No CI release pipeline — the earlier GitHub
> Actions workflow was deleted because macOS runners on a private repo
> cost real money and the audience doesn't warrant it yet.

## TL;DR — cut a build

First time only:

```sh
bash scripts/release-setup.sh --no-pass
```

Every release:

```sh
bash scripts/release-local.sh              # host arch (~3 min, arm64 only on M-series)
bash scripts/release-local.sh --universal  # fat binary covering Intel + Apple Silicon (~6 min)
```

Artifacts land in `src-tauri/target/release/bundle/`:

| Path                                      | What it is                          |
|-------------------------------------------|-------------------------------------|
| `dmg/Corey_0.1.0_*.dmg`                   | **Ship this** — user-facing installer |
| `macos/Corey.app.tar.gz`                  | Updater-consumable archive          |
| `macos/Corey.app.tar.gz.sig`              | Signature, verified by the updater  |

Hand the `.dmg` to the user. Keep the `.sig` + `.tar.gz` pair around if
you ever flip on in-app auto-update (needs the pair hosted somewhere
stable; GitHub Release asset URL still works when you flip the repo
public later).

## User install notes

The `.dmg` is **unsigned by Apple** (no paid Developer ID). On first
open, Gatekeeper will complain:

> "Corey.app" cannot be opened because Apple cannot check it for
> malicious software.

Two fixes, tell the user whichever is easier:

- **Right-click** the app in Applications → **Open** → **Open anyway**.
  One click, survives future launches.
- **Command line**:
  ```sh
  xattr -dr com.apple.quarantine /Applications/Corey.app
  ```

## Versioning

Three files, synced manually:

- `src-tauri/Cargo.toml`     → `package.version`
- `src-tauri/tauri.conf.json` → `version`
- `package.json`             → `version`

Use SemVer. Pre-1.0, breaking changes just land in `CHANGELOG.md`
without bumping major — no external consumers of the adapter trait yet.

## Signing keys

`scripts/release-setup.sh` handles the one-time keypair generation and
writes both halves to `~/.tauri/`:

- `~/.tauri/corey.key`     — PRIVATE. Keep on disk only. Back it up
  (1Password, iCloud Drive, wherever your other secrets live).
- `~/.tauri/corey.key.pub` — PUBLIC. Already embedded in
  `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

If you lose the private key: rerun `release-setup.sh --force`. Anyone
running an old build of Corey will stop auto-updating silently —
they'll need a fresh `.dmg`. Budget accordingly once you have users.

## Windows / Linux builds

Skipped for v0.1.x. Options when needed:

1. **Flip repo public** → re-enable the old GitHub Actions workflow
   (still in git history at `.github/workflows/release.yml` commit
   `8e4dbdb`). Public repos get unlimited minutes on all runners.
2. **Pay for private-repo CI minutes** — GitHub Billing → spending
   limit. macOS is ~$0.08/min, Windows ~$0.016/min, Linux free below
   2000 min/mo.
3. **Build on a Windows / Linux box you already own** — same
   `scripts/release-local.sh` script works cross-platform; just
   `pnpm tauri build` produces the native bundle for whatever OS runs it.

Ship macOS-only for the first few users; expand when the feedback
loop is stable.

## Future: paid Apple notarization

~$99/yr (Apple Developer Program). Eliminates the Gatekeeper dance above.

Setup: enroll, download a Developer ID Application cert into Keychain,
export as `.p12`, then set:

```sh
export APPLE_CERTIFICATE="$(base64 < corey-signing.p12)"
export APPLE_CERTIFICATE_PASSWORD="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

`pnpm tauri build` reads these automatically and notarizes. Trigger:
install abandonment becomes measurable. Until then, the right-click
workaround is fine.
