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

step "Hermes version"
HERMES_VER=""
HERMES_VER=$("$HERMES_BIN" --version 2>&1 || true)
if [ -n "$HERMES_VER" ]; then info "Version: $HERMES_VER"; else warn "Could not determine Hermes version."; fi

step "HERMES_HOME"
HERMES_HOME_VAL="${COREY_DATA_DIR:-$HOME/.hermes}"
if [ "$HERMES_HOME_VAL" != "$HOME/.hermes" ]; then
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$rc" ] && grep -q 'export HERMES_HOME=' "$rc" || echo "export HERMES_HOME=\"$HERMES_HOME_VAL\"" >> "$rc"
  done; export HERMES_HOME="$HERMES_HOME_VAL"; info "HERMES_HOME=$HERMES_HOME_VAL"
else info "HERMES_HOME using default ~/.hermes"; fi
mkdir -p "$HERMES_HOME_VAL"

step "API key check"
ENV_FILE="$HERMES_HOME_VAL/.env"
HAS_KEY=false
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|DEEPSEEK_API_KEY)
        if [ -n "$v" ] && [ "$v" != "your-key-here" ] && [ "$v" != "sk-"*"<"* ]; then
          HAS_KEY=true; info "Found: $k"; break
        fi ;;
    esac
  done < "$ENV_FILE"
fi
if [ "$HAS_KEY" = false ]; then
  warn "No API key found in $ENV_FILE"
  warn "You need at least one provider key to use Hermes."
fi

step "Gateway start"
GW_STARTED=false
if "$HERMES_BIN" gateway status &>/dev/null 2>&1; then
  info "Gateway already running."
  GW_STARTED=true
else
  info "Starting Hermes gateway..."
  if "$HERMES_BIN" gateway start &>/dev/null 2>&1; then
    info "Gateway started successfully."
    GW_STARTED=true
  else
    warn "Gateway start failed. You can start it manually: hermes gateway start"
  fi
fi

echo ""; echo "============================================================"
echo "  Hermes bootstrap complete"; echo "============================================================"
echo "  Binary:   $HERMES_BIN"
echo "  Version:  ${HERMES_VER:-unknown}"
echo "  Data dir: $HERMES_HOME_VAL"
echo "  Gateway:  $([ "$GW_STARTED" = true ] && echo 'running' || echo 'not running')"
echo "  Log:      $LOG_FILE"
echo ""
if [ "$HAS_KEY" = false ]; then
echo "  ⚠️  No API key configured!"; echo "     hermes model   (choose provider + enter key)"; echo ""
fi
echo "  Next steps:"
if [ "$GW_STARTED" = false ]; then echo "  1) hermes gateway start"; else echo "  1) ✅ Gateway already running"; fi
if [ "$HAS_KEY" = false ]; then echo "  2) hermes model              (choose LLM provider)"; fi
echo "  3) Open Corey — auto-detects Hermes"
echo ""
echo "  Troubleshoot: hermes gateway status | hermes doctor"
echo "============================================================"
