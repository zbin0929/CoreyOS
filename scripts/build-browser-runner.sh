#!/bin/bash
set -e

cd "$(dirname "$0")/scripts"

echo "==> Installing @yao-pkg/pkg..."
npm install -g @yao-pkg/pkg 2>/dev/null || true

echo "==> Building browser-runner for macOS ARM64..."
pkg . --target node18-macos-arm64 --output browser-runner-macos-arm64

echo "==> Building browser-runner for macOS x64..."
pkg . --target node18-macos-x64 --output browser-runner-macos-x64

echo "==> Building browser-runner for Windows x64..."
pkg . --target node18-win-x64 --output browser-runner-win-x64.exe

echo "==> Done! Binaries in scripts/dist/"
ls -lh browser-runner-*
