#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v pkg &>/dev/null; then
  echo "  Installing @yao-pkg/pkg..."
  npm install -g @yao-pkg/pkg 2>/dev/null
fi

cd scripts

OS="$(uname -s)"
ARCH="$(uname -m)"

TARGET=""
BINARY_NAME=""

if [[ "$OS" == "Darwin" && "$ARCH" == "arm64" ]]; then
  TARGET="node18-macos-arm64"
  BINARY_NAME="browser-runner-macos-arm64"
elif [[ "$OS" == "Darwin" && "$ARCH" == "x86_64" ]]; then
  TARGET="node18-macos-x64"
  BINARY_NAME="browser-runner-macos-x64"
elif [[ "$OS" == "Linux" ]]; then
  TARGET="node18-linuxstatic-x64"
  BINARY_NAME="browser-runner-linux-x64"
elif [[ "$OS" == "MINGW"* || "$OS" == "CYGWIN"* || "$OS" == "Windows_NT" ]]; then
  TARGET="node18-win-x64"
  BINARY_NAME="browser-runner-win-x64.exe"
else
  echo "  Unsupported platform: $OS $ARCH, skipping browser-runner build"
  exit 0
fi

echo "  Building browser-runner ($TARGET)..."
pkg . --target "$TARGET" --output "$BINARY_NAME" 2>&1 | sed 's/^/    /'

DEST="../src-tauri/scripts/$BINARY_NAME"
cp "$BINARY_NAME" "$DEST"
chmod +x "$DEST"

echo "  ✓ $DEST ($(du -h "$DEST" | cut -f1))"
