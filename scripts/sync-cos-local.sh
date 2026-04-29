#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?Usage: ./sync-cos-local.sh <tag>  e.g. ./sync-cos-local.sh v0.1.9}"

REPO="zbin0929/CoreyOS"
BUCKET="corey-update-1259005327"
REGION="cos.ap-guangzhou.myqcloud.com"
BASE_URL="https://${BUCKET}.${REGION}/releases/${TAG}"

COS_SECRET_ID="${COS_SECRET_ID:?Set COS_SECRET_ID env var}"
COS_SECRET_KEY="${COS_SECRET_KEY:?Set COS_SECRET_KEY env var}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

COSCLI=""
if [ -f "${PROJECT_DIR}/coscli" ]; then
    COSCLI="${PROJECT_DIR}/coscli"
elif command -v coscli &>/dev/null; then
    COSCLI="coscli"
else
    echo "coscli not found. Downloading..."
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"
    if [ "$ARCH" = "arm64" ]; then BIN="coscli-${OS}-arm64"; else BIN="coscli-${OS}-amd64"; fi
    curl -sL "https://cosbrowser.cloud.tencent.com/software/coscli/${BIN}" -o "${PROJECT_DIR}/coscli"
    chmod +x "${PROJECT_DIR}/coscli"
    COSCLI="${PROJECT_DIR}/coscli"
fi

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== Sync ${TAG} to COS ==="
echo "Download dir: $TMPDIR"
echo "coscli: $COSCLI"

FILES=(
    "latest.json"
    "Corey_${TAG#v}_universal.dmg"
    "Corey_universal.app.tar.gz"
    "Corey_universal.app.tar.gz.sig"
    "Corey_${TAG#v}_x64-setup.exe"
    "Corey_${TAG#v}_x64-setup.exe.sig"
    "Corey_${TAG#v}_x64_en-US.msi"
    "Corey_${TAG#v}_x64_en-US.msi.sig"
)

echo "--- Downloading from GitHub ---"
for f in "${FILES[@]}"; do
    echo "  $f"
    curl -fSL -o "${TMPDIR}/${f}" "https://github.com/${REPO}/releases/download/${TAG}/${f}" &
done
wait
echo "  Done."
ls -lh "${TMPDIR}/"

echo "--- Uploading to COS ---"
$COSCLI cp "${TMPDIR}/" "cos://${BUCKET}/releases/${TAG}/" -r \
    -i "$COS_SECRET_ID" \
    -k "$COS_SECRET_KEY" \
    -e "${REGION}"

echo "--- Rewriting latest.json URLs ---"
python3 -c "
import json
data = json.load(open('${TMPDIR}/latest.json'))
base = '${BASE_URL}'
for p in data.get('platforms', {}).values():
    old_url = p.get('url', '')
    filename = old_url.split('/')[-1] if '/' in old_url else old_url
    p['url'] = f'{base}/{filename}'
json.dump(data, open('${TMPDIR}/latest.json', 'w'), indent=2)
"
$COSCLI cp "${TMPDIR}/latest.json" "cos://${BUCKET}/releases/latest.json" \
    -i "$COS_SECRET_ID" \
    -k "$COS_SECRET_KEY" \
    -e "${REGION}"

echo "--- Verify ---"
curl -sL "https://${BUCKET}.${REGION}/releases/latest.json" | python3 -m json.tool | head -15
echo ""
echo "=== Done! ==="
