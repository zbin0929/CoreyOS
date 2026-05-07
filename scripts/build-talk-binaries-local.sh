#!/usr/bin/env bash
# B-8 Talk Mode v1.1 — 本地一键构建 whisper-cli + sherpa-onnx
#                      落到 <hermes>/talk/bin/
#
# 用法（macOS arm64 / Intel / Linux x64 都支持）：
#   bash scripts/build-talk-binaries-local.sh
#
# 这个脚本是 fetch-talk-binaries.sh 的"原料从源码或上游拉"版本：
#   - whisper.cpp 在本机编（3-5 分钟），不依赖 release 包
#   - sherpa-onnx 直接拉上游官方 prebuilt（30 秒）
# 跟 fetch-talk-binaries.sh 的区别仅在 whisper：fetch 是从 CoreyOS
# 自己的 release 拉已经编好的 zip，build 是本机现编。两个脚本最终
# 落在同一个 <hermes>/talk/bin/ 布局，运行时表现一致。
#
# 完成后回到 Corey → Settings → Voice，"本地语音包" 表头会从
# 「模型已安装，等待 sidecar 二进制到位」翻到「全本地链路已启用」。

set -euo pipefail

# ─── 1. 解析平台 + 配置 ─────────────────────────────────────
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    SHERPA_TRIPLE="osx-arm64-shared"
    WHISPER_CMAKE_FLAGS=("-DGGML_METAL=ON" "-DGGML_NATIVE=ON")
    ;;
  Darwin-x86_64)
    SHERPA_TRIPLE="osx-x64-shared"
    WHISPER_CMAKE_FLAGS=("-DGGML_METAL=OFF" "-DGGML_NATIVE=ON")
    ;;
  Linux-x86_64)
    SHERPA_TRIPLE="linux-x64-shared"
    WHISPER_CMAKE_FLAGS=("-DGGML_NATIVE=ON")
    ;;
  *)
    echo "[talk] 不支持的平台: $(uname -s) $(uname -m)" >&2
    echo "[talk] 本脚本只覆盖 macOS arm64/x64 + Linux x64；Windows 请走 GH Actions。" >&2
    exit 1
    ;;
esac

WHISPER_REF="${WHISPER_REF:-v1.7.4}"
SHERPA_VERSION="${SHERPA_VERSION:-v1.13.0}"
TALK_BIN="${HERMES_DATA_DIR:-$HOME/.hermes}/talk/bin"
mkdir -p "$TALK_BIN"

# ─── 2. 工具链检查 ─────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "[talk] 缺少 $1，请先安装（macOS: brew install $1）" >&2; exit 1; }; }
need cmake
need curl
need git
need tar

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ─── 3. whisper.cpp ─────────────────────────────────────────
echo "[talk] 1/2 编译 whisper.cpp ${WHISPER_REF}（约 3-5 分钟）..."
git clone --depth 1 --branch "$WHISPER_REF" https://github.com/ggerganov/whisper.cpp "$WORK_DIR/whisper.cpp" \
  || { echo "[talk] GitHub 直连失败，改用 ghfast.top 镜像..."
       git clone --depth 1 --branch "$WHISPER_REF" https://ghfast.top/https://github.com/ggerganov/whisper.cpp "$WORK_DIR/whisper.cpp"; }

cmake -S "$WORK_DIR/whisper.cpp" -B "$WORK_DIR/whisper.cpp/build" \
  -DCMAKE_BUILD_TYPE=Release \
  "${WHISPER_CMAKE_FLAGS[@]}"
cmake --build "$WORK_DIR/whisper.cpp/build" -j --config Release --target whisper-cli

cp "$WORK_DIR/whisper.cpp/build/bin/whisper-cli" "$TALK_BIN/whisper-cli"
chmod +x "$TALK_BIN/whisper-cli"
echo "[talk] ✓ whisper-cli → $TALK_BIN/whisper-cli"

# ─── 4. sherpa-onnx 预构 ───────────────────────────────────
echo "[talk] 2/2 拉 sherpa-onnx ${SHERPA_VERSION} 预构 (${SHERPA_TRIPLE})..."
SHERPA_ASSET="sherpa-onnx-${SHERPA_VERSION}-${SHERPA_TRIPLE}.tar.bz2"
SHERPA_URLS=(
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}"
  "https://ghfast.top/https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}"
  "https://ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}"
)
SHERPA_TARBALL="$WORK_DIR/$SHERPA_ASSET"
DOWNLOADED=0
for url in "${SHERPA_URLS[@]}"; do
  echo "[talk]   尝试 $url"
  if curl -fL --connect-timeout 15 -o "$SHERPA_TARBALL" "$url"; then
    DOWNLOADED=1; break
  fi
done
if [[ "$DOWNLOADED" -ne 1 ]]; then
  echo "[talk] sherpa-onnx 所有镜像都失败，手动下载放到 $SHERPA_TARBALL 再重跑脚本" >&2
  exit 1
fi

tar -xjf "$SHERPA_TARBALL" -C "$WORK_DIR/"
SHERPA_DIR="$(find "$WORK_DIR" -maxdepth 1 -type d -name 'sherpa-onnx-*' | head -n1)"
if [[ -z "${SHERPA_DIR:-}" || ! -d "$SHERPA_DIR" ]]; then
  echo "[talk] 解压 sherpa-onnx 后没找到目录" >&2
  exit 1
fi

# 把 bin/* + lib/* 拍平进 talk/bin/。SherpaTts 在 spawn 时把这个目录
# 加到 DYLD_LIBRARY_PATH / LD_LIBRARY_PATH，所以平铺布局是最稳的。
[[ -d "$SHERPA_DIR/bin" ]] && cp -R "$SHERPA_DIR/bin/." "$TALK_BIN/"
[[ -d "$SHERPA_DIR/lib" ]] && cp -R "$SHERPA_DIR/lib/." "$TALK_BIN/"
# 部分 release 把动态库直接放在 tarball 根，处理一下兜底。
for f in "$SHERPA_DIR"/*.dylib "$SHERPA_DIR"/*.so "$SHERPA_DIR"/*.so.* "$SHERPA_DIR"/*.dll; do
  [[ -e "$f" ]] && cp "$f" "$TALK_BIN/" || true
done
chmod +x "$TALK_BIN/sherpa-onnx-offline-tts" 2>/dev/null || true

echo "[talk] ✓ sherpa-onnx-offline-tts → $TALK_BIN/sherpa-onnx-offline-tts"

# ─── 5. 烟测 ───────────────────────────────────────────────
echo ""
echo "[talk] 安装完成。验证："
echo "  $TALK_BIN/whisper-cli --help | head -3"
echo "  $TALK_BIN/sherpa-onnx-offline-tts --help 2>&1 | head -5"
echo ""
echo "[talk] 模型还需要单独下：跑 scripts/fetch-talk-binaries.sh 或者"
echo "       打开 Corey → Settings → Voice → '下载本地语音包' 拉 MeloTTS。"
echo "[talk] 全部就位后，本地语音包表头会显示绿色「全本地链路已启用"
echo "       （whisper + sherpa-onnx）」。"
