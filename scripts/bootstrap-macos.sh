#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bootstrap-macos.sh — One-click Hermes Agent installer for macOS
#
# Usage:
#   bash scripts/bootstrap-macos.sh
#
# What it does:
#   1. Checks / installs Homebrew (if missing)
#   2. Checks / installs Python 3 (via brew)
#   3. Checks / installs git (via Xcode CLI tools)
#   4. Clones hermes-agent repo
#   5. Creates venv + installs Hermes with all extras
#   6. Creates ~/.local/bin/hermes symlink
#   7. Runs hermes model (interactive model picker)
#   8. Starts hermes gateway
# ──────────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { printf "${GREEN}[✓]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
die()   { printf "${RED}[✗]${NC} %s\n" "$1" >&2; exit 1; }

# ── 1. Homebrew ──────────────────────────────────────────────
if command -v brew &>/dev/null; then
    info "Homebrew found: $(brew --version | head -1)"
else
    warn "Homebrew not found — installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add to PATH for this session
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null || true)"
    command -v brew &>/dev/null || die "Homebrew install failed. Install manually: https://brew.sh"
    info "Homebrew installed"
fi

# ── 2. Python 3 ──────────────────────────────────────────────
if python3 --version &>/dev/null; then
    PYVER=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
    info "Python ${PYVER} found"
else
    warn "Python 3 not found — installing via brew..."
    brew install python@3.12
    info "Python installed: $(python3 --version)"
fi

# ── 3. Git ───────────────────────────────────────────────────
if git --version &>/dev/null; then
    info "Git found: $(git --version)"
else
    warn "Git not found — installing Xcode CLI tools..."
    xcode-select --install 2>/dev/null || true
    # Wait for user to complete installation
    until git --version &>/dev/null; do
        warn "Waiting for Xcode CLI tools to finish installing..."
        sleep 10
    done
    info "Git installed"
fi

# ── 4. Clone Hermes Agent ────────────────────────────────────
HERMES_SRC="$HOME/.hermes/hermes-agent"
if [ -d "$HERMES_SRC" ]; then
    info "Hermes source already at ${HERMES_SRC} — pulling latest..."
    cd "$HERMES_SRC"
    git pull --ff-only || warn "git pull failed (non-fatal, using existing source)"
else
    info "Cloning hermes-agent..."
    git clone https://github.com/NousResearch/hermes-agent.git "$HERMES_SRC"
fi

# ── 5. Create venv + install ─────────────────────────────────
HERMES_VENV="$HOME/.hermes/venv"
if [ ! -d "$HERMES_VENV" ]; then
    info "Creating Python virtual environment..."
    python3 -m venv "$HERMES_VENV"
fi

info "Installing Hermes Agent (this may take a few minutes)..."
source "$HERMES_VENV/bin/activate"
pip install --upgrade pip --quiet
pip install -e "$HERMES_SRC[all]" --quiet 2>&1 | tail -1
deactivate
info "Hermes installed"

# ── 6. Create symlink ────────────────────────────────────────
HERMES_BIN="$HOME/.local/bin/hermes"
mkdir -p "$HOME/.local/bin"
ln -sf "$HERMES_VENV/bin/hermes" "$HERMES_BIN"

# Ensure ~/.local/bin is in PATH
SHELL_RC="$HOME/.zshrc"
grep -q '.local/bin' "$SHELL_RC" 2>/dev/null || {
    echo '' >> "$SHELL_RC"
    echo '# Added by Corey bootstrap' >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
}
export PATH="$HOME/.local/bin:$PATH"

info "hermes command available at ${HERMES_BIN}"

# ── 7. Configure model ───────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Hermes is installed! Next steps:"
echo ""
echo "  1. Choose your LLM provider:"
echo "     hermes model"
echo ""
echo "  2. Start the gateway:"
echo "     hermes gateway start"
echo ""
echo "  3. Open Corey — it will auto-detect Hermes."
echo ""
echo "  Or run the setup wizard:"
echo "     hermes setup"
echo "──────────────────────────────────────────────────────────"
