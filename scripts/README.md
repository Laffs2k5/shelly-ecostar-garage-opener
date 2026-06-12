# scripts/

Bash + Node helpers for building, deploying, observing, and testing the devices + clients. Most read
device IPs from `.env` (`MONITOR_HOST`/`CONTROLLER_HOST`) or an `IP=`/role override; WSL reaches the LAN
directly, so the Shellys are driven over `curl http://<ip>/rpc/…` (no Windows detour).

## Build & deploy (device firmware)

| Script | What |
|---|---|
| `build-device.sh` | Minify `device/<name>.js` → `<name>.min.js` (strip comments/blanks/indent). Deploy the minified artifact. |
| `deploy-device.sh <monitor\|controller>` | Find-or-create the script by name, chunked `Script.PutCode` over RPC (~1 KB chunks for the ~3072 B HTTP limit), enable autostart, start, verify. `IP=` overrides the target (defaults to the i4 — set it for the controller). |

## Test

| Script | What |
|---|---|
| `test-device.sh` | Node mock-harness unit suite (**60** tests) + checks the `.min.js` artifacts are fresh. No hardware. |
| `test-web.sh` | Web control-page logic tests (**15**, Node, no browser). |
| `win-build.sh [tasks]` | Build / JVM-unit-test the Android app (and `wear/` via `WB_SRC=wear WB_NAME=garage-wear`) on the Windows toolchain, driven from WSL. Default task `testDebugUnitTest`; `assembleDebug` for an APK. |
| `check-wear-sync.sh` | Guard that the pure-logic files copied `app/` → `wear/` stay byte-identical (CI + local). |

## Observe & survey (hardware)

| Script | What |
|---|---|
| `i4-watch.sh` | Watch the i4's 4 inputs (SW1..SW4) and print state changes with timestamps. |
| `i4-scenario.sh` | Replay a precisely-timed door sequence **on the Pico** (sub-tick timing) and capture the i4 heartbeat stream — verifies the Q-16 gate / debounce / reverse-kick. |
| `pico.sh` | Drive the Pico test rig (`init`/`set`/`closed`/`opening`/… and `raw`). USB on Windows COM5, reached via `powershell.exe`. |
| `mqtt-sub.sh` / `mqtt-pub.sh` | Subscribe / publish on the local broker over mTLS as the `garage-devtool` tooling identity (watch heartbeats; inject commands). |
| `soak.sh` | Prove ≥24 h device stability — `--baseline` / `--check` / `--summary` (offline-safe: reads the devices' persistent uptime/RAM/reset counters). |
| `rssi-watch.sh` | Overnight WiFi/RSSI survey at the install location — logs both devices' RSSI + reachability + reboots; `--summary <csv>` prints the verdict (mean/min/max, outage streaks, sub-−80 dBm count). |
