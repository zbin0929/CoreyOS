#!/usr/bin/env bash
# Fix Hermes profiles seeded with an empty `{}` config (macOS / Linux).
#
# Symptom: sending a message to an expert/agent 400s with
#   "The supported API model names are ... but you passed ."
# Cause:  profiles under ~/.hermes/profiles/<name>/config.yaml were
#         created with the `{}` sentinel, so they carry no `model:`
#         section and Hermes POSTs an empty model name.
# Fix:    copy the `model:` section from ~/.hermes/config.yaml into every
#         profile that is still the `{}` sentinel, then the user restarts
#         Corey (or the gateway) to reload.
#
# Usage:  bash scripts/fix-profile-model.sh
set -euo pipefail

HERMES_DIR="${COREY_HERMES_DIR:-$HOME/.hermes}"
ROOT_CFG="$HERMES_DIR/config.yaml"
PROFILES_DIR="$HERMES_DIR/profiles"

echo "=== Hermes profile model backfill ==="
echo "  hermes dir : $HERMES_DIR"

if [ ! -f "$ROOT_CFG" ]; then
  echo "[!] root config not found: $ROOT_CFG — nothing to inherit. Aborting." >&2
  exit 1
fi

# Extract the top-level `model:` block (the header line plus its indented
# children) from the root config.
MODEL="$(awk '/^model:/{f=1;print;next} f{ if(/^[^ ]/){exit} print }' "$ROOT_CFG")"
if ! printf '%s\n' "$MODEL" | grep -q 'default:'; then
  echo "[!] no 'model:' section with a 'default:' in $ROOT_CFG. Aborting." >&2
  exit 1
fi

echo "[+] inheriting model section:"
printf '%s\n' "$MODEL" | sed 's/^/      /'

if [ ! -d "$PROFILES_DIR" ]; then
  echo "[+] no profiles dir at $PROFILES_DIR — nothing to repair."
  exit 0
fi

# The mapping-form model block used to replace an empty scalar model,
# indented one level (URL slashes escaped for perl below).
MODEL_MAP="$(printf '%s\n' "$MODEL" | sed 's|https://api.deepseek.com/v1|https:\\/\\/api.deepseek.com\\/v1|')"

n=0
for d in "$PROFILES_DIR"/*/; do
  [ -d "$d" ] || continue
  cfg="$d/config.yaml"
  [ -f "$cfg" ] || continue

  # Shape 1: the bare `{}` sentinel (never used yet) — seed the whole
  # file with the minimal model-only config.
  if grep -qxE '\{\}' "$cfg"; then
    printf '# Hermes profile · managed by Corey\n%s\n' "$MODEL" > "$cfg"
    echo "    repaired ({} sentinel): $(basename "$d")"
    n=$((n + 1))
    continue
  fi

  # Shape 2: a full config Hermes expanded on first use, left with an
  # EMPTY string model (`model: ''` or `model: ""`). Replace ONLY that
  # line with the model mapping, preserving every other key (mcp_servers,
  # etc.). perl -0777/m so ^ and $ match line boundaries.
  if grep -qE "^model:[[:space:]]*(''|\"\")[[:space:]]*$" "$cfg"; then
    perl -0777 -pi -e "s/^model:[ \t]*(''|\"\")[ \t]*\$/${MODEL_MAP}/m" "$cfg"
    echo "    repaired (empty model): $(basename "$d")"
    n=$((n + 1))
  fi
done

echo "[+] repaired $n profile(s)."
echo "[+] Now fully quit and reopen Corey (or click the gateway Restart button)."
