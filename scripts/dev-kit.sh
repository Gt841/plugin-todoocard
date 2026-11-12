#!/usr/bin/env bash
# DEPRECATED (2026-11-12): Phase 1 的 fork 分发验证工具，已作废。
# 分发模型改为「上游源码 tarball + 版本匹配扩展包」，请改用：
#   ../todoocard-core-dist/scripts/build-extension.sh
#   ../todoocard-core-dist/scripts/build-manifest.sh
#   ../todoocard-core-dist/scripts/verify.sh
# 本脚本仅保留作历史回溯；它仍会 clone 旧 base b0f2673 并打废弃补丁。
#
# Build a LOCAL dev kit for real-machine validation of plugin-todoocard.
#
# Produces in $DEV_DIR (default /tmp/todoocard-dev):
#   eink-patched.zip            eink fork with BOTH fork-patch/*.patch applied (files at zip root)
#   python-<platform>.tar.gz    relocatable portable Python, repacked FLAT (<dest>/bin/python3)
#   manifest.json               points at the two assets over local HTTP
#
# The installer downloads assets via Node http/https (NOT file://), so you must serve
# $DEV_DIR over HTTP while validating. Only the manifestUrl setting itself may be file://.
#
# Reproducible: re-run anytime. Defaults target macOS arm64; override the vars below.
# Usage:
#   bash scripts/dev-kit.sh
#   EINK_SRC=/path/to/eink-clone bash scripts/dev-kit.sh   # reuse a local clone instead of cloning
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="${DEV_DIR:-/tmp/todoocard-dev}"
WORK="$(mktemp -d /tmp/todoocard-devwork.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# --- eink source: local clone (EINK_SRC) or clone EINK_REPO pinned to EINK_REF ---
EINK_REPO="${EINK_REPO:-https://github.com/shidaifufen/todoocard-eink}"
EINK_REF="${EINK_REF:-b0f2673}"
EINK_SRC="${EINK_SRC:-}"

# --- portable Python: python-build-standalone relocatable install_only build ---
PY_RELEASE="${PY_RELEASE:-20261110}"
PY_VERSION="${PY_VERSION:-3.11.18}"
PY_ARCH="${PY_ARCH:-aarch64-apple-darwin}"   # Intel mac: x86_64-apple-darwin
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE}/cpython-${PY_VERSION}%2B${PY_RELEASE}-${PY_ARCH}-install_only.tar.gz"

HTTP_PORT="${HTTP_PORT:-8000}"
PLATFORM_KEY="${PLATFORM_KEY:-darwin-arm64}"  # manifest platform key (platform-arch)
VERSION="${VERSION:-1.0.0}"

mkdir -p "$DEV_DIR"

echo "==> [1/4] eink fork: apply both patches, zip tracked files flat"
if [ -n "$EINK_SRC" ]; then
  cp -R "$EINK_SRC" "$WORK/eink"
else
  git clone "$EINK_REPO" "$WORK/eink"
fi
git -C "$WORK/eink" checkout -q "$EINK_REF"
git -C "$WORK/eink" apply "$REPO_ROOT/fork-patch/force-python.patch"
git -C "$WORK/eink" apply "$REPO_ROOT/fork-patch/localhost-bind.patch"
( cd "$WORK/eink" && python3 -m py_compile card.py server.py )
# zip exactly the git-tracked files (working-tree content = patched), no .git/runtime junk
( cd "$WORK/eink" && git ls-files -z | xargs -0 zip -q "$DEV_DIR/eink-patched.zip" )
echo "    eink-patched.zip written"

echo "==> [2/4] portable Python: download + repackage FLAT"
curl -fL --retry 3 -o "$WORK/py.tar.gz" "$PY_URL"
mkdir -p "$WORK/pyextract"
tar -xzf "$WORK/py.tar.gz" -C "$WORK/pyextract"
# install_only extracts to a top-level python/; repack its CONTENTS so <dest>/bin/python3 exists
tar -czf "$DEV_DIR/python-${PLATFORM_KEY}.tar.gz" -C "$WORK/pyextract/python" .
echo "    python-${PLATFORM_KEY}.tar.gz written"

echo "==> [3/4] sha256"
EINK_SHA="$(shasum -a 256 "$DEV_DIR/eink-patched.zip" | awk '{print $1}')"
PY_SHA="$(shasum -a 256 "$DEV_DIR/python-${PLATFORM_KEY}.tar.gz" | awk '{print $1}')"

echo "==> [4/4] manifest.json"
cat > "$DEV_DIR/manifest.json" <<JSON
{
  "version": "${VERSION}",
  "platforms": {
    "${PLATFORM_KEY}": {
      "pythonUrl": "http://127.0.0.1:${HTTP_PORT}/python-${PLATFORM_KEY}.tar.gz",
      "pythonSha256": "${PY_SHA}",
      "einkUrl": "http://127.0.0.1:${HTTP_PORT}/eink-patched.zip",
      "einkSha256": "${EINK_SHA}"
    }
  }
}
JSON

echo ""
echo "Dev kit ready in $DEV_DIR:"
ls -la "$DEV_DIR"
echo ""
echo "NEXT (see docs/real-machine-validation.md for the full checklist):"
echo "  1) Serve assets:   cd $DEV_DIR && python3 -m http.server $HTTP_PORT"
echo "  2) SiYuan plugin setting 'Manifest URL' = file://$DEV_DIR/manifest.json"
echo "  3) Control panel -> 安装/更新 -> 启动 -> 打开传图界面"