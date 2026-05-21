#!/usr/bin/env bash
# bundle-hermes.sh — 用 PyInstaller 打包 Hermes 成独立可执行文件
#
# 用法：
#   bash scripts/bundle-hermes.sh [--output <dir>]
#
# 产物：
#   <output>/hermes-standalone (macOS) 或 hermes-standalone.exe (Windows)
#
# 依赖：
#   - Hermes 源码在 ~/.hermes/hermes-agent/
#   - Python 3.11+ 和 pip

set -euo pipefail

OUTPUT_DIR="${1:-$(pwd)/dist}"
HERMES_DIR="$HOME/.hermes/hermes-agent"
VENV_PIP="$HERMES_DIR/venv/bin/pip3"
VENV_PYINSTALLER="$HERMES_DIR/venv/bin/pyinstaller"

echo "=== Hermes Standalone Builder ==="
echo "Hermes source: $HERMES_DIR"
echo "Output: $OUTPUT_DIR"

# 检查 Hermes 源码
if [[ ! -d "$HERMES_DIR" ]]; then
    echo "❌ Hermes source not found at $HERMES_DIR"
    echo "   Run 'hermes doctor' first to install Hermes"
    exit 1
fi

# 安装 PyInstaller（如果没有）
if [[ ! -f "$VENV_PYINSTALLER" ]]; then
    echo "Installing PyInstaller..."
    "$VENV_PIP" install pyinstaller
fi

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 打包
echo "Building hermes-standalone with PyInstaller..."
cd "$HERMES_DIR"

"$VENV_PYINSTALLER" \
    --onefile \
    --name hermes-standalone \
    --distpath "$OUTPUT_DIR" \
    --workpath "$OUTPUT_DIR/build" \
    --specpath "$OUTPUT_DIR/build" \
    --clean \
    --noconfirm \
    hermes_cli/main.py 2>&1 | tail -20

# 验证
BINARY="$OUTPUT_DIR/hermes-standalone"
if [[ -f "$BINARY" ]]; then
    SIZE=$(du -h "$BINARY" | cut -f1)
    echo ""
    echo "✅ Build successful!"
    echo "   Binary: $BINARY"
    echo "   Size: $SIZE"
    echo ""
    echo "Testing..."
    "$BINARY" --version
else
    echo "❌ Build failed - binary not found"
    exit 1
fi
