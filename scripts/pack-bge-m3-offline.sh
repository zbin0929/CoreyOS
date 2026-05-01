#!/usr/bin/env bash
# Download BGE-M3 ONNX model files and pack them into bge-m3-offline.zip.
# Run on a machine with internet access, then ship the zip to offline clients.
#
# Usage:
#   bash scripts/pack-bge-m3-offline.sh          # creates bge-m3-offline.zip in CWD
#   bash scripts/pack-bge-m3-offline.sh /tmp/out  # creates zip in /tmp/out

set -euo pipefail

OUT_DIR="${1:-.}"
mkdir -p "$OUT_DIR"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Downloading BGE-M3 model files to $WORK_DIR ..."

declare -A URLS=(
  [model.onnx]="https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/model.onnx"
  [model.onnx_data]="https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/model.onnx_data"
  [tokenizer.json]="https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/tokenizer.json"
  [sentencepiece.bpe.model]="https://paddlenlp.bj.bcebos.com/models/community/BAAI/bge-m3/onnx/sentencepiece.bpe.model"
)

for name in "${!URLS[@]}"; do
  url="${URLS[$name]}"
  target="$WORK_DIR/$name"
  echo "  $name ..."
  curl -fSL --progress-bar -o "$target" "$url"
done

ZIP_PATH="$OUT_DIR/bge-m3-offline.zip"
echo "Packing $ZIP_PATH ..."
(cd "$WORK_DIR" && zip -0 -X "$ZIP_PATH" ./*)

SIZE=$(du -h "$ZIP_PATH" | cut -f1)
echo "Done: $ZIP_PATH ($SIZE)"
