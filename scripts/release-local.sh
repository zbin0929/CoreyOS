#!/usr/bin/env bash
# Build + sign Corey locally for distribution. No CI needed.
#
# Usage:
#   bash scripts/release-local.sh              # host arch only (fast)
#   bash scripts/release-local.sh --universal  # mac: arm64 + x86_64 fat binary
#
# Output lands in:
#   src-tauri/target/release/bundle/dmg/         *.dmg          ← ship this
#   src-tauri/target/release/bundle/macos/       *.app.tar.gz   ← updater artifact
#   src-tauri/target/release/bundle/macos/       *.app.tar.gz.sig
#
# The .sig file next to the tarball is what the auto-updater verifies
# against the pubkey baked into tauri.conf.json. Keep them together
# when distributing so future in-app updates work.

set -euo pipefail

KEY_PATH="${HOME}/.tauri/corey.key"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "error: $KEY_PATH missing. Run bash scripts/release-setup.sh first." >&2
  exit 1
fi

# Export the signing env vars for this process. `tauri build` picks them up
# and produces signed updater artifacts. If you set a passphrase during
# setup, re-enter it here; --no-pass setup leaves the password empty.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  # Only prompt if the caller didn't already export it (e.g. CI-style
  # repeated builds). Reading from /dev/tty so piping into the script
  # doesn't break the prompt.
  if [[ -t 0 ]]; then
    printf "Signing-key passphrase (empty if setup used --no-pass): "
    read -r -s TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    echo
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  else
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  fi
fi

MODE="host"
for arg in "$@"; do
  case "$arg" in
    --universal) MODE="universal" ;;
    -h|--help)   sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "error: unknown flag $arg" >&2; exit 2 ;;
  esac
done

echo "→ Building frontend"
pnpm build

case "$MODE" in
  universal)
    # Fat binary covers Intel + Apple Silicon Macs in one .dmg. ~2x build time.
    echo "→ Building Tauri bundle (universal-apple-darwin)"
    pnpm tauri build --target universal-apple-darwin
    ;;
  host)
    echo "→ Building Tauri bundle (host architecture)"
    pnpm tauri build
    ;;
esac

# Surface the final artifact paths so the caller can grab them without
# spelunking through target/.
echo
echo "✓ Build complete. Artifacts:"
find src-tauri/target -type f \
  \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.app.tar.gz.sig' \) \
  -newer "$KEY_PATH" 2>/dev/null | sort
