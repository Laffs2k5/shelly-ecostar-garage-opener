# AI test guide — agent-runnable verification (from WSL)

How an agent re-verifies the system without a human. Companion to `REGRESSION.md` (which also covers the
🧑 on-phone steps). All commands run from the repo root in WSL.

## Prerequisites
- On the LAN. Devices: i4 `192.0.2.160`, S1 `192.0.2.161` (see `private/network-inventory.md`).
- Pico rig on Windows `COM5` (`device/test-rig/main.py` host-driven inputs, or `door_sim.py` autonomous).
- Broker certs in `private/` (`ca.crt`, `garage-devtool.{crt,key}`). Windows: Android Studio JBR + SDK.

## 1. Automated suites (no hardware)
```bash
scripts/test-device.sh                     # device mJS logic, 60 tests
scripts/test-web.sh                         # web core, 15 tests
python3 device/test-rig/test_door_sim.py    # Pico door_sim state-machine logic (host mock)
scripts/check-wear-sync.sh                  # app->wear shared logic byte-identical
scripts/win-build.sh testDebugUnitTest      # app pure logic, 42 tests (Windows toolchain)
scripts/win-build.sh assembleDebug          # app compiles -> debug APK
WB_SRC=wear WB_NAME=garage-wear scripts/win-build.sh assembleDebug   # watch APK
```

## 2. Device deploy (if scripts changed)
```bash
scripts/build-device.sh                      # minify monitor + controller
IP=192.0.2.160 scripts/deploy-device.sh monitor
IP=192.0.2.161 scripts/deploy-device.sh controller
```
Expect `running:true` for each; i4 `controller_url` is in KVS (set once).

## 3. Bench door-state matrix (Pico → i4)
Drive each pattern and check the derived state at `http://192.0.2.160/script/1/state`:
```bash
scripts/pico.sh raw "main.alloff();main.sw(1,1)"   # -> CLOSED
scripts/pico.sh raw "main.alloff();main.sw(3,1)"   # -> OPENING
scripts/pico.sh raw "main.alloff();main.sw(2,1)"   # -> OPEN
scripts/pico.sh raw "main.alloff();main.sw(4,1)"   # -> CLOSING
scripts/pico.sh raw "main.alloff()"                # after CLOSING -> STOPPED_CLOSING
scripts/pico.sh init                               # all off
```
(`scripts/i4-watch.sh` streams raw input changes live.)

## 4. Controller command decisions (S1)
With the i4 pushed a state, ask S1 to act and read its decision (`pulses`):
```bash
# door CLOSED -> open = 1 pulse ; OPEN/OPENING -> 0 (suppress) ; CLOSING -> 2 (stop+reverse)
curl -s "http://192.0.2.161/script/1/command?cmd=open" | jq '{state,pulses}'
```
Relay pulse is 0.5 s (auto-off); a 2-pulse reverse fires twice ~1.2 s apart. Verify the relay with
`curl "http://192.0.2.161/rpc/Switch.GetStatus?id=0"` (`output` true during a pulse).

## 5. MQTT end-to-end (as garage-devtool)
```bash
W=8 scripts/mqtt-sub.sh        # watch both devices' heartbeat + mon/alive
scripts/mqtt-pub.sh devices/garage-controller/command open   # command over the broker
```
Expect the i4 heartbeat to track each derived state and `mon/<id>/alive` to tick.

## Last full pass
2026-06-12: full closed-loop round via the Pico `door_sim` "virtual EcoStar" — 8-step functional matrix
(open/close/stop/reverse/3-pulse-continue/Q-16-suppress/watch round-trip/background drive) over all three
transports (HTTP-direct, local broker, cloud), observed on MQTT; three Wear background-drive bugs found +
fixed. Suites 60+15+41 green; `assembleDebug` OK (app + watch). See `HW-VALIDATION.md` (two 2026-06-12
entries). Earlier 2026-06-08 pass: bench matrix 13/13, devices `running:true`, RAM stable.
