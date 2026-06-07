#!/usr/bin/env bash
# Device-logic tests: run the Node mock-harness suite, and verify the minified artifacts are fresh.
# No hardware needed.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== node tests (mocked Shelly runtime) =="
node --test 'device/test/*.test.js'
echo "== minified artifacts fresh? =="
scripts/build-device.sh --check
