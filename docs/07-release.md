# 07 · Release & Distribution

## Strategy: unsigned + GitHub Release (zero cost)

**Default stance**: distribute as open-source via GitHub Releases, **without paid code-signing certificates**. This is the locked decision for M1–M4. Paid signing can be layered on later without refactoring the release pipeline (see the "Future: paid signing" section at the bottom).

Consequences users need to know (documented clearly on the download page):

- **macOS**: the `.dmg` opens but Gatekeeper will refuse to run the app on first launch ("cannot be opened because Apple cannot check it for malicious software"). Users right-click → Open, or run `xattr -dr com.apple.quarantine /Applications/Caduceus.app` once. We provide a one-line copyable command and a short screencast on the download page.
- **Windows**: SmartScreen will show "Windows protected your PC"; users click "More info" → "Run anyway". We provide screenshots.
- **Linux**: no warnings; `chmod +x *.AppImage` and run. `.deb` / `.rpm` install normally with `sudo apt install ./file.deb` / `sudo rpm -i file.rpm`.

Artifact integrity is provided via **minisign signatures** (free, self-managed key). Users can verify; most won't, and that's fine.

## Release channels

| Channel   | Audience         | Cadence                | Trigger                         |
|-----------|------------------|------------------------|---------------------------------|
| `nightly` | Dev / dogfooding | Every merge to `main`  | GitHub Action on push           |
| `beta`    | Public opt-in    | Weekly                 | Tag `v*.*.*-beta.N`             |
| `stable`  | Default          | Every 2–4 weeks        | Tag `v*.*.*`                    |

Channel mapped into the Tauri updater via a manifest URL per channel.

## Versioning

- **SemVer**. Breaking changes to the adapter trait are tracked in `CHANGELOG.md` but do not yet bump major (no external consumers until Phase 5 closes).
- Version is a single source of truth in `src-tauri/tauri.conf.json`; a pre-commit hook syncs `package.json`.

## Artifacts per release

| OS            | Artifact                       | Integrity                 |
|---------------|--------------------------------|---------------------------|
| macOS (arm64) | `.dmg`, `.app.tar.gz`          | minisign `.sig` + SHA256  |
| macOS (x64)   | `.dmg`, `.app.tar.gz`          | minisign `.sig` + SHA256  |
| Windows x64   | `.msi`, `.exe` (NSIS portable) | minisign `.sig` + SHA256  |
| Linux x64     | `.AppImage`, `.deb`, `.rpm`    | minisign `.sig` + SHA256  |
| Linux arm64   | `.AppImage`, `.deb`            | minisign `.sig` + SHA256  |

No paid OS-level code signing. **minisign** is used both for Tauri updater verification and for user-facing integrity. Public key lives in the README and is baked into the build; secret key is held in GitHub Actions secrets.

## Auto-update

- Tauri updater configured in `tauri.conf.json` with a per-channel manifest URL, **served directly from the GitHub Release**:
  - `https://github.com/<org>/caduceus/releases/download/<tag>/latest-<channel>.json`
  - This avoids any need for self-hosted infra or a domain.
- Manifest fields: `version`, `notes`, `pub_date`, `platforms.*.signature` (minisign), `platforms.*.url` (GitHub Release asset URL).
- Users can opt out of auto-update in Settings; opt-out still notifies when a newer version is available.
- **Important caveat without OS signing**: auto-update works, but on macOS the updated binary re-triggers Gatekeeper's quarantine attribute for downloads. Mitigation: the installer script strips quarantine on first-run confirmation (documented in the FAQ). On Windows, the MSI updater path avoids SmartScreen on update if the original install was user-accepted; first install still shows the warning.

## Download page (GitHub Releases prose)

Each release's description must include:

1. The four OS download links with size + SHA256.
2. macOS Gatekeeper workaround (right-click → Open, or `xattr` one-liner).
3. Windows SmartScreen workaround (More info → Run anyway screenshot).
4. minisign public key + verification command example.
5. Link to the user-facing changelog.

A small static `docs/download.md` in the repo mirrors this content and is the target of the "Download" button on the (future) landing page.

## CI/CD

`.github/workflows/release.yml` triggered on tag push:

1. **Prepare**: checkout, install Rust + Node + pnpm, cache.
2. **Lint + test**: the full CI suite from `06-testing.md`.
3. **Build matrix** (per OS): `pnpm tauri build`. No OS signing env vars required.
   - Runners: `macos-14` (arm64), `macos-13` (x64), `windows-2022`, `ubuntu-22.04` (+ `ubuntu-22.04-arm` when available).
4. **Compute hashes**: SHA256 each artifact.
5. **Sign with minisign**: one `.sig` per artifact + one signed `latest-<channel>.json` manifest. Secret: `MINISIGN_KEY` + `MINISIGN_KEY_PASSWORD`.
6. **Publish**: `softprops/action-gh-release` uploads artifacts, `.sig` files, SHA256 file, and the manifest to the GitHub Release. Release notes auto-generated from `CHANGELOG.md` delta.
7. **Distribution channels (optional, non-blocking)**: Homebrew tap, Scoop bucket, winget, AUR. Unsigned-friendly; scripts live in `scripts/dist/`.

## Manual pre-release checklist

Copy-paste into the Release PR:

- [ ] `CHANGELOG.md` updated; breaking notes called out.
- [ ] Bumped version in `tauri.conf.json`; `package.json` synced.
- [ ] All phase-level e2e for shipped phases pass locally.
- [ ] Visual baselines re-reviewed for intentional changes only.
- [ ] Screen reader smoke on the 5 primary screens.
- [ ] Cold start measured on reference hardware ≤ 1.0 s.
- [ ] Installer sizes within budgets (macOS arm64 ≤ 20 MB, Windows x64 ≤ 25 MB).
- [ ] Secrets scan green (no key-shaped strings in shipped bundle).
- [ ] Updater test: install previous `stable`, deploy current as `beta`, verify update prompt + application.
- [ ] Download page copy updated with current SHA256 + minisign signatures.
- [ ] Gatekeeper / SmartScreen workaround instructions verified to still work on current OS versions (spot-check once per minor release).

## Crash reports & diagnostics

- Opt-in only. Never on by default.
- "Export diagnostic bundle" in Settings gathers: last 48 h of Rust logs, redacted configs, versions, OS info → zips to user-chosen path for manual sharing.
- No hosted crash reporter initially; consider Sentry self-hosted later if volume warrants.

## Revocation / rollback

- If a release ships a broken updater: push a new manifest pointing to the last good version; auto-update will "update" users to the older good one. Document the trade-off in the release post-mortem.
- All previous artifacts remain attached to their GitHub Releases; never delete.

## Web-mode distribution (future)

- `caduceus-web` companion package: same frontend + a Node shim replacing the Rust IPC surface over HTTP.
- Distributed as an `npm` package and a single `docker` image.
- Out of scope for M3; plan in post-Phase-5 Phase 6.

## Future: paid signing (opt-in upgrade, not on the critical path)

If user feedback later shows Gatekeeper/SmartScreen friction is blocking adoption, layer these on. The release pipeline is designed so each is an additive step, not a rewrite.

### macOS (Apple Developer ID + notarization)

- **Cost**: USD 99/year.
- Issue a "Developer ID Application" certificate.
- Add CI secrets: `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Extend the macOS build step with `codesign`; add a notarize step (`xcrun notarytool submit --wait`) + `xcrun stapler staple`.
- Result: zero Gatekeeper warnings on download and launch.

### Windows (Authenticode)

- **Cost**: OV cert ~USD 100–200/year (needs reputation to bypass SmartScreen); EV cert ~USD 300–500/year (instant reputation, requires HSM).
- Sign `.msi` and `.exe` with `signtool`, timestamp via `http://timestamp.digicert.com`.
- EV strongly recommended if we upgrade at all; OV on its own is barely worth the money.
- Result: SmartScreen warning gone (EV) or gated by reputation (OV).

### Decision trigger

Revisit signing when **any** of these is true:

- > 1000 downloads/month and attrition measurable on the install step.
- Users request signed builds in issues at a rate ≥ 5/month.
- We take on a corporate contributor willing to sponsor certificates.
