#!/usr/bin/env bash
# The Wear module reuses pure logic copied VERBATIM from the phone app (there's no shared Gradle module
# yet — wear/ is a separate Gradle project). Guard against silent drift: these files must stay
# byte-identical. Run in CI and locally. If this fails, re-copy app -> wear (or extract a shared module).
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(
  "java/no/leiflan/garage/api/DoorModel.kt"
  "java/no/leiflan/garage/api/ActionModel.kt"
  "java/no/leiflan/garage/api/GarageApi.kt"
  "java/no/leiflan/garage/ui/theme/Color.kt"
)

fail=0
for f in "${FILES[@]}"; do
  if ! diff -q "app/src/main/$f" "wear/src/main/$f" >/dev/null 2>&1; then
    echo "DRIFT: app/src/main/$f  !=  wear/src/main/$f"
    fail=1
  fi
done

if [ "$fail" = 0 ]; then
  echo "wear shared-logic in sync with app (${#FILES[@]} files)"
else
  echo "Wear copies drifted from the phone app — re-sync them (cp app -> wear)." >&2
  exit 1
fi
