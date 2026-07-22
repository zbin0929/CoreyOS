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

# Runtime hook: scrubs stale SSL_CERT_FILE / REQUESTS_CA_BUNDLE left
# behind by a prior PyInstaller `_MEI*` dir. Resolves the "SSL_CERT_FILE
# points to a missing CA bundle" 500 on user machines where Corey/Tauri
# inherited a stale var. Hook lives next to this script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_HOOK="$SCRIPT_DIR/hermes-runtime-hook.py"

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

# Patch Hermes ssl_guard.py to auto-heal stale CA bundle paths.
# Must run BEFORE pyinstaller so the fix is compiled into the binary.
echo "Patching ssl_guard.py..."
"$HERMES_DIR/venv/bin/python" "$SCRIPT_DIR/patch-hermes-ssl-guard.py" || {
    echo "⚠ ssl_guard patch failed — binary may still crash on stale SSL_CERT_FILE"
}

# 打包
#
# PyInstaller 默认只做静态 import 分析；Hermes 和 openai SDK 大量使用
# 延迟导入（函数内 / 运行时拼接模块路径），静态分析抓不到 → 打出来的
# 二进制运行时报 `OpenAI SDK: Not installed`、Gateway 启动即崩。
# 修复方式：对 Hermes pyproject.toml [project.dependencies] 里的每一个
# 核心包显式 --collect-all（子模块 + 数据文件 + 元数据）。
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
    --collect-all openai \
    --collect-all httpx \
    --collect-all rich \
    --collect-all tenacity \
    --collect-all yaml \
    --collect-all ruamel.yaml \
    --collect-all requests \
    --collect-all jinja2 \
    --collect-all pydantic \
    --collect-all pydantic_core \
    --collect-all prompt_toolkit \
    --collect-all croniter \
    --collect-all jwt \
    --collect-all psutil \
    --collect-all dotenv \
    --collect-all fire \
    --collect-all uuid \
    --collect-all certifi \
    --collect-all packaging \
    --collect-all markdown \
    --collect-all urllib3 \
    --collect-all cryptography \
    --hidden-import hermes_cli \
    --hidden-import hermes_constants \
    --runtime-hook "$RUNTIME_HOOK" \
    --collect-submodules tools \
    --collect-submodules agent \
    --collect-submodules gateway \
    hermes_cli/main.py 2>&1 | tail -30

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
