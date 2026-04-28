#!/usr/bin/env bash
# bootstrap-macos.sh — One-click Hermes Agent installer for macOS
# Usage: bash scripts/bootstrap-macos.sh
# Idempotent. Logs to ~/Library/Logs/Corey/bootstrap-macos.log
set -euo pipefail

LOG_DIR="$HOME/Library/Logs/Corey"; mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/bootstrap-macos.log"
_ts() { date "+%Y-%m-%d %H:%M:%S"; }
info() { local m="[$(_ts)] [INFO] $*"; echo "$m" >> "$LOG_FILE"; printf "\033[0;32m[+]\033[0m %s\n" "$*"; }
warn() { local m="[$(_ts)] [WARN] $*"; echo "$m" >> "$LOG_FILE"; printf "\033[1;33m[!]\033[0m %s\n" "$*"; }
die()  { local m="[$(_ts)] [ERR]  $*"; echo "$m" >> "$LOG_FILE"; printf "\033[0;31m[x]\033[0m %s\n" "$*" >&2; exit 1; }
step() { local m="[$(_ts)] [STEP] $*"; echo "$m" >> "$LOG_FILE"; printf "\033[0;36m   %s\033[0m\n" "$*"; }

info "=== Bootstrap started ==="

step "Network connectivity"
curl -fsSL --connect-timeout 10 --head https://raw.githubusercontent.com >/dev/null 2>&1 || die "Cannot reach GitHub."

step "Homebrew"
if command -v brew &>/dev/null; then info "Homebrew found"; else
  warn "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null || true)"
  command -v brew &>/dev/null || die "Homebrew install failed."
fi

step "Python"
if python3 --version &>/dev/null; then
  PYMIN=$(python3 -c 'import sys;print(sys.version_info.minor)')
  if [ "$PYMIN" -lt 11 ]; then warn "Python 3.$PYMIN < 3.11, upgrading..."; brew install python@3.12; fi
  info "Python $(python3 --version 2>&1)"
else warn "Installing Python..."; brew install python@3.12; fi

step "Git"
if ! git --version &>/dev/null; then
  warn "Installing Xcode CLI tools..."; xcode-select --install 2>/dev/null || true
  until git --version &>/dev/null; do warn "Waiting..."; sleep 10; done
fi
info "Git $(git --version 2>&1)"

step "Hermes install"
if command -v hermes &>/dev/null; then
  info "Hermes already installed: $(command -v hermes)"
else
  info "Running official install script..."
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
  source "$HOME/.bashrc" 2>/dev/null || true
  source "$HOME/.zshrc" 2>/dev/null || true
fi

HERMES_BIN=""
if command -v hermes &>/dev/null; then HERMES_BIN="$(command -v hermes)"
elif [ -x "$HOME/.hermes/venv/bin/hermes" ]; then
  HERMES_BIN="$HOME/.hermes/venv/bin/hermes"
  mkdir -p "$HOME/.local/bin"; ln -sf "$HERMES_BIN" "$HOME/.local/bin/hermes"
  grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  export PATH="$HOME/.local/bin:$PATH"
else die "Hermes binary not found after install."; fi
info "Hermes binary: $HERMES_BIN"

step "HERMES_HOME"
HERMES_HOME_VAL="${COREY_DATA_DIR:-$HOME/.hermes}"
if [ "$HERMES_HOME_VAL" != "$HOME/.hermes" ]; then
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$rc" ] && grep -q 'export HERMES_HOME=' "$rc" || echo "export HERMES_HOME=\"$HERMES_HOME_VAL\"" >> "$rc"
  done; export HERMES_HOME="$HERMES_HOME_VAL"; info "HERMES_HOME=$HERMES_HOME_VAL"
else info "HERMES_HOME using default ~/.hermes"; fi
mkdir -p "$HERMES_HOME_VAL"

echo ""; echo "============================================================"
echo "  Hermes bootstrap complete"; echo "============================================================"
echo "  Binary:   $HERMES_BIN"; echo "  Data dir: $HERMES_HOME_VAL"; echo "  Log:      $LOG_FILE"
echo ""; echo "  Next steps:"; echo "  1) hermes model"; echo "  2) hermes gateway start"
echo "  3) Open Corey — auto-detects Hermes"
echo "  Troubleshoot: hermes gateway status | hermes doctor"
echo "============================================================"
