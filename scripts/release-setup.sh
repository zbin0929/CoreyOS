#!/usr/bin/env bash
# One-time release setup. Run once per repo; subsequent releases just
# need `git tag vX.Y.Z && git push --tags`.
#
#   bash scripts/release-setup.sh            # prompts for passphrase
#   bash scripts/release-setup.sh --no-pass  # no passphrase (dev-grade)
#
# What it does:
#   1. Generates a Tauri minisign-format signing keypair.
#   2. Uploads the PRIVATE key + passphrase to GitHub Actions secrets.
#   3. Patches tauri.conf.json with the PUBLIC key.
#   4. Commits the pubkey patch (but does NOT push — you review + push).
#
# Idempotent-ish: it refuses to overwrite an existing private key without
# --force, so a re-run after partial failure stops at the first destructive
# step. Delete ~/.tauri/corey.key manually if you really mean to rotate.

set -euo pipefail

KEY_DIR="${HOME}/.tauri"
KEY_PATH="${KEY_DIR}/corey.key"
PUB_PATH="${KEY_PATH}.pub"
CONF_PATH="src-tauri/tauri.conf.json"

NO_PASS=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --no-pass) NO_PASS=1 ;;
    --force)   FORCE=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown flag $arg (expected --no-pass / --force)" >&2
      exit 2
      ;;
  esac
done

# ───────────────────────── Preflight ─────────────────────────
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing '$1' on PATH" >&2
    exit 1
  }
}
need gh
need pnpm
need git

if ! gh auth status >/dev/null 2>&1; then
  echo "error: 'gh' not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

if [[ ! -f "$CONF_PATH" ]]; then
  echo "error: run this from the repo root (can't find $CONF_PATH)" >&2
  exit 1
fi

if [[ -f "$KEY_PATH" && $FORCE -ne 1 ]]; then
  echo "error: $KEY_PATH already exists. Pass --force to rotate."     >&2
  echo "       Rotating invalidates auto-update for users on the old" >&2
  echo "       pubkey — they'll need to download the next build."     >&2
  exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

# ───────────────────────── Passphrase ─────────────────────────
PASSPHRASE=""
if [[ $NO_PASS -eq 0 ]]; then
  # Double-entry with silent read.
  printf "Passphrase for the signing key (leave empty to abort): "
  read -r -s PASSPHRASE
  echo
  if [[ -z "$PASSPHRASE" ]]; then
    echo "error: empty passphrase. Pass --no-pass to generate without one." >&2
    exit 1
  fi
  printf "Repeat:                                                 "
  read -r -s CONFIRM
  echo
  if [[ "$PASSPHRASE" != "$CONFIRM" ]]; then
    echo "error: passphrases do not match." >&2
    exit 1
  fi
fi

# ───────────────────────── Keygen ─────────────────────────
echo "→ Generating keypair at $KEY_PATH"
# --ci skips interactive prompts; -p "" means "no passphrase".
# -p "$PASSPHRASE" lets us reuse the passphrase for the GH secret below.
pnpm tauri signer generate \
  --ci \
  --write-keys "$KEY_PATH" \
  --password "$PASSPHRASE" \
  --force >/dev/null

if [[ ! -f "$PUB_PATH" ]]; then
  echo "error: key generation succeeded but $PUB_PATH is missing." >&2
  exit 1
fi

# ───────────────────────── GH secrets ─────────────────────────
echo "→ Uploading TAURI_SIGNING_PRIVATE_KEY"
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$KEY_PATH"

echo "→ Uploading TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
printf '%s' "$PASSPHRASE" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# ───────────────────────── Patch config ─────────────────────────
PUBKEY_CONTENT="$(tr -d '\r\n' < "$PUB_PATH")"

echo "→ Patching $CONF_PATH → plugins.updater.pubkey"
# Use a temp file + python for a minimal-diff JSON edit. `jq -S` would
# reorder keys; we want to preserve the file's existing shape.
python3 - "$CONF_PATH" "$PUBKEY_CONTENT" <<'PY'
import json, sys, pathlib
path = pathlib.Path(sys.argv[1])
pubkey = sys.argv[2]
data = json.loads(path.read_text())
data.setdefault("plugins", {}).setdefault("updater", {})["pubkey"] = pubkey
path.write_text(json.dumps(data, indent=2) + "\n")
PY

# ───────────────────────── Commit ─────────────────────────
if git diff --quiet -- "$CONF_PATH"; then
  echo "→ No change to $CONF_PATH (pubkey already matched)."
else
  git add "$CONF_PATH"
  git commit -m "build: pin Tauri updater pubkey" -m "Generated via scripts/release-setup.sh. Matching private key + passphrase live in GitHub Actions secrets."
  echo "→ Committed pubkey patch. Review with 'git show HEAD' then 'git push'."
fi

cat <<'DONE'

✓ Setup complete.

Next:
  git tag v0.1.0
  git push origin main --tags

GitHub Actions will build + sign + draft a release. You publish it
manually from the Releases tab after editing the notes.

DONE
