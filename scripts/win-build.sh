#!/usr/bin/env bash
# Build/test the Android app via the WINDOWS toolchain, driven from WSL. The Android build can't run in
# the WSL Linux toolchain (aapt2 is x86_64) — but we can invoke Windows gradle + the Android Studio JBR.
# UNC (\\wsl.localhost) project reads are slow, so we sync app/ to a Windows-local build dir and build
# there (NEW-PROJECT-GUIDE §3). Test reports land in C:\temp\garage-app\build.
#
# Usage:
#   scripts/win-build.sh                      # default: testDebugUnitTest
#   scripts/win-build.sh assembleDebug        # compile the whole app (no emulator needed)
#   scripts/win-build.sh testDebugUnitTest assembleDebug
#
# Requires (already present on this machine): Android Studio JBR, Android SDK, a cached gradle 8.11.1
# (populated by opening any Android project in Android Studio once).
set -euo pipefail
cd "$(dirname "$0")/.."
WINDIR_WSL=/mnt/c/temp/garage-app
WINDIR_WIN='C:\temp\garage-app'
JBR='C:\Program Files\Android\Android Studio\jbr'
GRADLE_BAT=$(powershell.exe -NoProfile -Command 'Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.11.1-bin" -Recurse -Filter gradle.bat -EA SilentlyContinue | Select-Object -First 1 -Expand FullName' | tr -d '\r')
[ -n "$GRADLE_BAT" ] || { echo "no cached gradle 8.11.1 — open an Android project in Android Studio once to populate it" >&2; exit 1; }

mkdir -p "$WINDIR_WSL"
rsync -rt --delete --exclude 'build/' --exclude '.gradle/' --exclude 'local.properties' app/ "$WINDIR_WSL"/

TASK="$*"; [ -n "$TASK" ] || TASK="testDebugUnitTest"
cat > /mnt/c/temp/gw.ps1 <<PSEOF
\$env:JAVA_HOME = "$JBR"
\$env:ANDROID_HOME = "\$env:LOCALAPPDATA\\Android\\Sdk"
Set-Location "$WINDIR_WIN"
& "$GRADLE_BAT" $TASK --no-daemon --console=plain
exit \$LASTEXITCODE
PSEOF
echo "win-build: $TASK  (in $WINDIR_WIN)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\temp\gw.ps1' 2>&1