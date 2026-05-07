#!/usr/bin/env bash
# B-8 v1.1 helper — fetch the Talk Mode binaries + the MeloTTS
# Chinese/English model into `<hermes>/talk/{bin,models}/`.
#
# Replaces the v1.0 piper-based fetcher. The new pipeline pulls
# directly from the sherpa-onnx + Hugging Face upstreams instead
# of waiting for a CoreyOS release to repackage everything — that
# made sense for piper because piper's macOS arm64 prebuilt was
# broken and we had to ship our own source-built binary, but
# sherpa-onnx ships native correctly-architected binaries for
# every platform we target so we can just consume them as-is.
#
# Usage:
#   bash scripts/fetch-talk-binaries.sh
#   bash scripts/fetch-talk-binaries.sh --sherpa-version v1.13.0
#
# What it does:
#   1. Detects the host triple (macOS arm64/x64, Windows x64; this
#      script doesn't run under PowerShell, so Windows users are
#      expected to be in Git Bash / MSYS / WSL).
#   2. Downloads + extracts `sherpa-onnx-<ver>-<triple>-shared.tar.bz2`
#      from `k2-fsa/sherpa-onnx` releases. Lays the
#      `sherpa-onnx-offline-tts` binary + its shared libs flat
#      into `<hermes>/talk/bin/` so DYLD_LIBRARY_PATH resolution
#      lines up with what the Rust `SherpaTts` impl expects.
#   3. Downloads + extracts the `vits-melo-tts-zh_en` model bundle
#      (~165 MB ONNX + tokens + lexicon + dict) from Hugging Face
#      into `<hermes>/talk/models/vits-melo-tts-zh_en/`.
#
# The whisper-cli binary is NOT touched here — that still ships
# via the in-app downloader / GH Actions release. Whisper has its
# own packaging pipeline and isn't migrating in this task.
#
# Mirrors: every download has a hf-mirror.com / ghfast.top
# fallback so users behind the GFW don't need a VPN.

set -euo pipefail

SHERPA_VERSION="v1.13.0" # k2-fsa/sherpa-onnx latest as of 2026-05; bump to taste
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sherpa-version) SHERPA_VERSION="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "[talk] unknown arg: $1" >&2
      exit 2 ;;
  esac
done

# ─── Host triple ──────────────────────────────────────
# Note: Windows assets carry the `MD-Release` MSVC runtime suffix —
# k2-fsa/sherpa-onnx ships a separate Debug/MinSizeRel/RelWithDebInfo
# build for each MD/MT runtime variant. We pick MD-Release (dynamic
# CRT, optimized) because that's what their docs recommend for app
# integration.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)        SHERPA_TRIPLE="osx-arm64-shared" ;;
  Darwin-x86_64)       SHERPA_TRIPLE="osx-x64-shared" ;;
  Linux-x86_64)        SHERPA_TRIPLE="linux-x64-shared" ;;
  MINGW*-*|MSYS*-*|CYGWIN*-*)
                       SHERPA_TRIPLE="win-x64-shared-MD-Release" ;;
  *)
    echo "[talk] unsupported host: $(uname -s) $(uname -m)" >&2
    echo "[talk] CoreyOS Talk Mode v1.1 ships sherpa-onnx for macOS arm64/x64, Linux x64, Windows x64." >&2
    exit 1
    ;;
esac

# ─── <hermes>/talk paths ──────────────────────────────
if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
  TALK_DIR="${HERMES_DATA_DIR:-$HOME/.hermes}/talk"
else
  TALK_DIR="${HERMES_DATA_DIR:-$USERPROFILE/.hermes}/talk"
fi
TALK_BIN="$TALK_DIR/bin"
TALK_MODELS="$TALK_DIR/models"
mkdir -p "$TALK_BIN" "$TALK_MODELS"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ─── Mirror-chain downloader ──────────────────────────
# Every URL has a primary + ghfast.top + ghproxy.com fallback for
# GitHub-hosted assets, plus hf-mirror.com for HF-hosted ones. The
# `--connect-timeout 15` cap keeps a dead mirror from stalling for
# 75+ s before failing over (curl's default).
fetch() {
  local dest="$1"; shift
  local url
  for url in "$@"; do
    echo "[talk]   trying $url"
    if curl -fL --connect-timeout 15 --retry 1 -o "$dest" "$url"; then
      echo "[talk]   downloaded from $url"
      return 0
    fi
    echo "[talk]   that mirror failed, trying next..."
  done
  echo "[talk] all mirrors failed for $dest" >&2
  return 1
}

# ─── 1. sherpa-onnx prebuilt ──────────────────────────
SHERPA_ASSET="sherpa-onnx-${SHERPA_VERSION}-${SHERPA_TRIPLE}.tar.bz2"
SHERPA_TARBALL="$TMP_DIR/$SHERPA_ASSET"
echo "[talk] 1/2 fetching sherpa-onnx ${SHERPA_VERSION} (${SHERPA_TRIPLE})..."
fetch "$SHERPA_TARBALL" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}" \
  "https://ghfast.top/https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}" \
  "https://ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_ASSET}"

echo "[talk]   extracting..."
tar -xjf "$SHERPA_TARBALL" -C "$TMP_DIR"
SHERPA_DIR="$TMP_DIR/sherpa-onnx-${SHERPA_VERSION}-${SHERPA_TRIPLE}"
if [[ ! -d "$SHERPA_DIR" ]]; then
  # Some releases drop the version segment — fall back to a glob.
  SHERPA_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'sherpa-onnx-*' | head -n1)"
fi
if [[ -z "${SHERPA_DIR:-}" || ! -d "$SHERPA_DIR" ]]; then
  echo "[talk] unexpected sherpa-onnx tarball layout" >&2
  exit 1
fi

# Copy bin + lib (or just bin on Windows where DLLs live in bin/)
# into a flat <hermes>/talk/bin/ — `SherpaTts` adds that dir to
# DYLD_LIBRARY_PATH / LD_LIBRARY_PATH at spawn time, so flat is
# the layout that resolves cleanly on both macOS and Linux.
echo "[talk]   installing into $TALK_BIN..."
if [[ -d "$SHERPA_DIR/bin" ]]; then
  cp -R "$SHERPA_DIR/bin/." "$TALK_BIN/"
fi
if [[ -d "$SHERPA_DIR/lib" ]]; then
  cp -R "$SHERPA_DIR/lib/." "$TALK_BIN/"
fi
# Some releases ship binaries at the root + lib/ alongside.
for f in "$SHERPA_DIR"/*.dylib "$SHERPA_DIR"/*.so "$SHERPA_DIR"/*.so.* "$SHERPA_DIR"/*.dll; do
  [[ -e "$f" ]] && cp "$f" "$TALK_BIN/" || true
done

# +x on the binary; copying from a tarball over a non-Unix FS
# can drop the executable bit.
for bin in "$TALK_BIN/sherpa-onnx-offline-tts" "$TALK_BIN/sherpa-onnx-offline-tts.exe"; do
  [[ -e "$bin" ]] && chmod +x "$bin" || true
done

# ─── 2. MeloTTS Chinese/English model ─────────────────
MODEL_DIR="$TALK_MODELS/vits-melo-tts-zh_en"
MODEL_TARBALL="$TMP_DIR/vits-melo-tts-zh_en.tar.bz2"
echo "[talk] 2/2 fetching MeloTTS zh_en model..."

# k2-fsa publishes the bundled tarball as a GitHub release asset
# under their `tts-models` tag. The HF repo holds the raw files
# but we want the dict/ + *.fst tree which only ships in the
# tarball. HF mirror is a community proxy that resolves the same
# tag URLs.
fetch "$MODEL_TARBALL" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2" \
  "https://ghfast.top/https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2" \
  "https://ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2"

echo "[talk]   extracting into $MODEL_DIR..."
mkdir -p "$MODEL_DIR"
# Strip the leading `vits-melo-tts-zh_en/` directory in the tarball
# so files land directly under our target dir — works regardless
# of whether the upstream tarball pre-pends the dir or not.
tar -xjf "$MODEL_TARBALL" -C "$TMP_DIR"
EXTRACTED="$TMP_DIR/vits-melo-tts-zh_en"
if [[ ! -d "$EXTRACTED" ]]; then
  EXTRACTED="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'vits-melo-tts*' | head -n1)"
fi
if [[ -z "${EXTRACTED:-}" || ! -d "$EXTRACTED" ]]; then
  echo "[talk] unexpected MeloTTS tarball layout" >&2
  exit 1
fi
cp -R "$EXTRACTED/." "$MODEL_DIR/"

# ─── Sanity probe ─────────────────────────────────────
echo
echo "[talk] verification:"
for required in \
  "$TALK_BIN/sherpa-onnx-offline-tts" \
  "$TALK_BIN/sherpa-onnx-offline-tts.exe" \
  "$MODEL_DIR/model.onnx" \
  "$MODEL_DIR/tokens.txt" \
  "$MODEL_DIR/lexicon.txt"; do
  if [[ -e "$required" ]]; then
    size=$(wc -c < "$required" 2>/dev/null | tr -d ' ')
    echo "  ✓ $required (${size} bytes)"
  fi
done

echo
echo "[talk] sherpa-onnx + MeloTTS installed."
echo "[talk] still missing on this host: whisper-cli (ggml). Use Settings → Voice → '下载本地语音包' or run the GH Actions release pipeline."
