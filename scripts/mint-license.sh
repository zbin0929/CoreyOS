#!/usr/bin/env bash
# Friendly wrapper around the `mint_license` Rust binary.
#
# Usage:
#   bash scripts/mint-license.sh <user> [options]
#
# Examples:
#   # 1-year portable license for Alice
#   bash scripts/mint-license.sh alice@example.com --expires 1y
#
#   # 1-year machine-bound license for Bob
#   bash scripts/mint-license.sh bob@acme.com \
#       --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
#       --expires 1y
#
#   # Perpetual license, no expiry
#   bash scripts/mint-license.sh dad@gmail.com --perpetual
#
#   # 6-month trial bound to a machine
#   bash scripts/mint-license.sh test@me --expires 6mo --machine-id <uuid>
#
# What it does:
#   1. Translates friendly --expires (1y / 6mo / 30d / "2027-04-27") into
#      an ISO date the Rust mint_license binary expects.
#   2. Forwards the rest unchanged to `cargo run --bin mint_license`.
#   3. Prints the token + a Markdown snippet you can paste into a chat.
#
# Security:
#   This script is safe to commit to a public repo IF AND ONLY IF the
#   private key (~/.corey-license/private.pem) lives outside the repo
#   AND outside any cloud-synced folder. The script itself contains no
#   secrets — it just calls cargo with arguments. The actual signing
#   happens locally with the maintainer's key.

set -euo pipefail

usage() {
  sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

# Detect which `date` flavour we're on. macOS / *BSD use `-v +Ny`;
# GNU coreutils use `-d "+N year"`. We sniff once at startup so the
# parse function below stays branch-free per call.
_DATE_FLAVOUR=""
detect_date_flavour() {
  if date --version >/dev/null 2>&1; then
    _DATE_FLAVOUR="gnu"
  else
    _DATE_FLAVOUR="bsd"
  fi
}
detect_date_flavour

# Parse a friendly duration like "1y" / "6mo" / "30d" or pass-through
# an ISO date. Returns YYYY-MM-DD on stdout. Empty string for
# --perpetual. Works on macOS/BSD `date` AND GNU `date` so a Linux
# maintainer host stays a viable fallback.
parse_expires() {
  local input="$1"
  case "$input" in
    "")
      echo ""
      return
      ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
      # Already an ISO date — pass through.
      echo "$input"
      return
      ;;
  esac

  local n unit gnu_unit
  case "$input" in
    *y)  n="${input%y}";  unit="y"; gnu_unit="year" ;;
    *mo) n="${input%mo}"; unit="m"; gnu_unit="month" ;;
    *m)  # Ambiguous; treat single-letter `m` as months because nobody
         # wants a 5-minute license. Use *d for days.
         n="${input%m}";  unit="m"; gnu_unit="month" ;;
    *d)  n="${input%d}";  unit="d"; gnu_unit="day" ;;
    *)
      echo "error: --expires must be a duration (1y, 6mo, 30d) or YYYY-MM-DD, got: $input" >&2
      exit 2
      ;;
  esac

  if [[ "$_DATE_FLAVOUR" == "gnu" ]]; then
    date -d "+${n} ${gnu_unit}" +%Y-%m-%d
  else
    date -v +"${n}${unit}" +%Y-%m-%d
  fi
}

# Default args
USER_ID=""
EXPIRES_HUMAN=""
MACHINE_ID=""
FEATURES=""
PERPETUAL=0

# First positional is the user id; everything after is flags.
if [[ $# -lt 1 ]]; then usage; fi
case "$1" in
  -h|--help) usage ;;
esac
USER_ID="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expires)
      EXPIRES_HUMAN="$2"; shift 2 ;;
    --perpetual)
      PERPETUAL=1; shift ;;
    --machine-id)
      MACHINE_ID="$2"; shift 2 ;;
    --features)
      FEATURES="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$EXPIRES_HUMAN" && $PERPETUAL -eq 0 ]]; then
  echo "error: pass --expires <1y|6mo|30d|YYYY-MM-DD> or --perpetual" >&2
  exit 2
fi

# Hard requirement: every license must be machine-bound.
# Portable licenses (no `--machine-id`) make it trivial for a buyer
# to share the token with friends, which defeats the entire point of
# the gate. Force the maintainer to ALWAYS ask for the buyer's UUID
# before signing — the friction here is by design, not laziness on
# our part.
if [[ -z "$MACHINE_ID" ]]; then
  cat >&2 <<'EOF'
error: --machine-id is required.

Every license must be bound to a specific install. Ask the buyer to:
  1. Launch Corey
  2. Copy the UUID shown in the activation modal (or Settings → 许可证)
  3. Send it to you

Then re-run with --machine-id <that-uuid>.

Example:
  bash scripts/mint-license.sh wang@acme.com \
       --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
       --expires 1y

If you really want a portable license (e.g. for testing), call the
underlying Rust binary directly:
  cargo run --manifest-path src-tauri/Cargo.toml --bin mint_license -- \
       --user <id> --expires <date>
EOF
  exit 2
fi

EXPIRES_ISO=""
if [[ $PERPETUAL -eq 0 ]]; then
  EXPIRES_ISO="$(parse_expires "$EXPIRES_HUMAN")"
fi

# Build cargo argv. We always run from the repo root so cargo finds the
# manifest deterministically regardless of where the user invoked us.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARGS=(--user "$USER_ID")
[[ -n "$EXPIRES_ISO" ]] && ARGS+=(--expires "$EXPIRES_ISO")
[[ -n "$MACHINE_ID" ]] && ARGS+=(--machine-id "$MACHINE_ID")
[[ -n "$FEATURES" ]] && ARGS+=(--features "$FEATURES")

# Run the actual minter. The `-q` keeps cargo's "Compiling…" chatter
# off stderr on a warm cache; on a cold cache the user still sees the
# build line, which is fine.
TOKEN="$(cargo run --quiet --manifest-path "$REPO_ROOT/src-tauri/cli/Cargo.toml" \
  --bin mint_license -- "${ARGS[@]}")"

# Pretty output. Stdout is the token by itself so callers can pipe;
# stderr gets the "ready to send" decoration so it doesn't pollute
# scripted callers.
echo "$TOKEN"
{
  echo
  echo "──────────────────────── License minted ────────────────────────"
  echo "  user      : $USER_ID"
  if [[ -n "$EXPIRES_ISO" ]]; then
    echo "  expires   : $EXPIRES_ISO"
  else
    echo "  expires   : perpetual"
  fi
  if [[ -n "$MACHINE_ID" ]]; then
    echo "  bound to  : $MACHINE_ID"
  else
    echo "  bound to  : (portable — works on any machine)"
  fi
  [[ -n "$FEATURES" ]] && echo "  features  : $FEATURES"
  echo "  length    : ${#TOKEN} chars"
  echo
  echo "Send the buyer the line above. They paste it into Corey's"
  echo "Activate dialog and Corey unlocks."
  echo "─────────────────────────────────────────────────────────────────"
} >&2
