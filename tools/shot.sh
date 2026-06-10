#!/usr/bin/env bash
# tools/shot.sh <outname> [extra chrome flags] — headless screenshot of localhost:8137
set -e
cd "$(dirname "$0")/.."
OUT="tools/.cache/shots/${1:-shot}.png"; shift || true
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROF="/tmp/cb-chrome-$$-$RANDOM"
# disk-cache-size=1 + a random query bust ES-module caching (imports carry no ?v=)
"$CHROME" --headless=new --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$PROF" --enable-unsafe-swiftshader --disk-cache-size=1 --disable-application-cache \
  --window-size=1500,950 --virtual-time-budget=4500 "$@" \
  --screenshot="$OUT" "http://127.0.0.1:8137/?cb=$RANDOM$$" >/dev/null 2>&1 || true
rm -rf "$PROF"
echo "wrote $OUT ($(stat -f%z "$OUT" 2>/dev/null || echo 0) bytes)"
