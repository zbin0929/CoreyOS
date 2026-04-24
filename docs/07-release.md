# 07 · Release & Distribution

> **Status 2026-04-24**: `.github/workflows/release.yml` is live. Cutting
> a release is one `git tag && git push --tags` away once the one-time
> signing keys are in GitHub Secrets. No paid code-signing certs yet;
> Gatekeeper / SmartScreen warnings are documented on each GitHub
> Release page.

## TL;DR — cut a release

```sh
# Bump versions (single source of truth in Cargo.toml + package.json +
# tauri.conf.json — keep all three in sync manually; we'll script this
# later if it becomes painful).
vim src-tauri/Cargo.toml             # package.version
vim src-tauri/tauri.conf.json        # version
vim package.json                     # version
# Write the release note in CHANGELOG.md first.
git commit -am "release: v0.1.1"
git tag v0.1.1
git push origin main --tags
```

GitHub Actions (`.github/workflows/release.yml`) then:

1. Builds the Tauri bundle on macOS (arm + x64), Windows, and Linux in
   parallel.
2. Signs the updater artifacts with the minisign-format key stored in
   GH Secrets.
3. Creates a **draft** GitHub Release named `Corey v0.1.1` with every
   platform artifact + a `latest.json` manifest attached.
4. Stops there — manually review the notes, then hit **Publish release**
   to go live. The Tauri updater picks up the new version through
   `https://github.com/zbin0929/CoreyOS/releases/latest/download/latest.json`
   (see `plugins.updater.endpoints` in `tauri.conf.json`).

## One-time setup: signing keys

The Tauri updater refuses to install a bundle whose signature doesn't
verify against the `plugins.updater.pubkey` baked into the running app.
So before the first release, run:

```sh
bash scripts/release-setup.sh
```

It prompts twice for a passphrase, then:

1. Generates `~/.tauri/corey.key` (+ `.pub`) via `tauri signer generate`.
2. Uploads the private key + passphrase as `TAURI_SIGNING_PRIVATE_KEY`
   and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` via `gh secret set`.
3. Patches `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
   with the generated public key and commits that patch (push is manual
   so you can eyeball the diff first).

Flags:

- `--no-pass`   skip the passphrase (dev-grade; fine for a solo repo).
- `--force`     rotate an existing key. Invalidates auto-update for
                anyone on the old pubkey — they'll need to download
                the next build manually. Budget accordingly.

Prereqs: `gh auth login` must be done; `pnpm` + `python3` on PATH.

## Strategy: unsigned + GitHub Release (zero cost)

**Default stance**: distribute as open-source via GitHub Releases,
**without paid OS code-signing certificates**. Locked decision for M1–M4.
Paid signing (Apple Developer ID / Authenticode) can be layered on later
without reworking this pipeline — they plug in as env vars on the same
`tauri-action` step.

User-visible consequences (documented on the download page):

- **macOS**: the `.dmg` opens but Gatekeeper refuses to run the app on
  first launch ("cannot be opened because Apple cannot check it for
  malicious software"). Users right-click → Open, or run
  `xattr -dr com.apple.quarantine /Applications/Corey.app` once.
- **Windows**: SmartScreen shows "Windows protected your PC"; users
  click "More info" → "Run anyway".
- **Linux**: no warnings; `chmod +x *.AppImage` and run. `.deb` / `.rpm`
  install normally with `sudo apt install ./file.deb` /
  `sudo rpm -i file.rpm`.

Updater integrity is provided via Tauri's built-in minisign-format
signer — each artifact has a matching `.sig` file verified by the client
before install. No separate minisign workflow needed (the original
Phase-0 plan had one; collapsed now that Tauri ships the same primitive
in-band).

## Release channels

Started with a single channel (`stable`) to cut scope. Multi-channel
(nightly / beta) lands when we actually have enough users to justify
the cadence split.

| Channel   | Audience         | Cadence                | Trigger                         |
|-----------|------------------|------------------------|---------------------------------|
| `stable`  | Default          | Every 2–4 weeks        | Tag `v*.*.*`                    |

## Versioning

- **SemVer**. Pre-1.0 breaking changes track in `CHANGELOG.md` but do
  not bump major — no external adapter consumers yet.
- Three-files-manual-sync for now: `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`, `package.json`. A pre-commit hook
  sync'ing them is a backlog item.

## Artifacts per release

| OS            | Artifact                            | Signed updater? |
|---------------|-------------------------------------|-----------------|
| macOS (arm64) | `.dmg`, `.app.tar.gz`               | ✅              |
| macOS (x64)   | `.dmg`, `.app.tar.gz`               | ✅              |
| Windows x64   | `.msi`, `.exe` (NSIS)               | ✅              |
| Linux x64     | `.AppImage`, `.deb`, `.rpm`         | ✅ (AppImage)   |

Every platform ships a `.sig` sibling file. The `latest.json` manifest
(auto-generated by `tauri-action`) maps platform → `url` + `signature`
for the updater to read. `.deb` / `.rpm` don't participate in the
updater; users on those re-download the package for upgrades.

## Auto-update

- Configured in `tauri.conf.json` →
  `plugins.updater.endpoints`.
- Manifest lives at a GitHub Release asset URL
  (`releases/latest/download/latest.json`) — no self-hosted infra, no
  domain.
- Fields: `version`, `notes`, `pub_date`, `platforms.*.signature`,
  `platforms.*.url`.
- **macOS caveat without OS signing**: auto-update works, but an updated
  binary re-triggers Gatekeeper's quarantine attribute for downloads.
  Mitigation: the in-app "Update installed" dialog should include the
  one-liner `xattr` fix (follow-up UI task, not blocking v0.1.0).
- **Windows**: the MSI updater path avoids SmartScreen on update if the
  original install was user-accepted. First install still shows the
  warning.

## Download-page copy (GitHub Release description)

`tauri-action` pre-fills the release body with install notes (see
`.github/workflows/release.yml` → `releaseBody`). The maintainer should
edit the body before publishing to add:

1. User-facing changelog summary (1–3 bullets).
2. Breaking changes, if any.
3. Link to `docs/user/` (post-Polish pass) for deeper docs.

## Future: paid OS signing

Both certs are < $400/yr combined; adding them is a pure env-var change
in `release.yml`:

- **macOS (Apple Developer ID + notarization)**: set
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. `tauri-action` reads them
  and notarizes automatically.
- **Windows (Authenticode)**: set `WINDOWS_CERTIFICATE`,
  `WINDOWS_CERTIFICATE_PASSWORD` (PFX + passphrase).

Trigger: user pain from Gatekeeper/SmartScreen warnings reaches the
point where install abandonment is measurable. Until then: clear
install docs > spending money.
