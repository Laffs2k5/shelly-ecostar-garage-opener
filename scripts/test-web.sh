#!/usr/bin/env bash
# Web control-page logic tests (Node, no browser).
set -euo pipefail
cd "$(dirname "$0")/.."
node --test 'web/test/*.test.js'
