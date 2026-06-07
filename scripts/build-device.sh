#!/usr/bin/env bash
# Generate the deployable, minified device scripts (device/<name>.min.js) from the readable sources
# (device/<name>.js) by stripping full-line comments, blank lines, and leading indentation.
#
# WHY: the Shelly mJS heap is tiny — a fully-commented source can OOM on boot. Deploy the .min.js.
# Keep the readable source in git. (NEW-PROJECT-GUIDE §4.) Sources must have no "//" starting a line
# inside a string literal (ours don't), so dropping full-line // comments is safe.
#
# Usage:
#   scripts/build-device.sh            # (re)build all device/*.min.js
#   scripts/build-device.sh --check    # exit 1 if any .min.js is stale (CI / pre-deploy guard)
set -euo pipefail
cd "$(dirname "$0")/.."

SCRIPTS=(monitor)   # add 'controller' here when device/controller.js lands (Phase 3)

minify() { # $1 = source file
  awk '
    /^[[:space:]]*\/\// { next }            # drop full-line // comments
    /^[[:space:]]*$/    { next }            # drop blank lines
    { sub(/^[[:space:]]+/, ""); print }     # strip leading indentation
  ' "$1"
}

check=0; [ "${1:-}" = "--check" ] && check=1
rc=0
for name in "${SCRIPTS[@]}"; do
  src="device/$name.js"; out="device/$name.min.js"
  [ -f "$src" ] || { echo "missing $src" >&2; rc=1; continue; }
  if [ "$check" = 1 ]; then
    if ! diff -q <(minify "$src") "$out" >/dev/null 2>&1; then
      echo "STALE: $out — run scripts/build-device.sh" >&2; rc=1
    else echo "ok: $out up to date"; fi
  else
    minify "$src" > "$out"
    echo "wrote $out ($(wc -c < "$out") B, from $(wc -c < "$src") B)"
  fi
done
exit $rc
