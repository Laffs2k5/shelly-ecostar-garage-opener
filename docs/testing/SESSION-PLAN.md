# Bench testing session — plan (run when back at the house)

Interactive session: **you tap, I observe + instruct.** Bench = i4 (`192.0.2.160`), S1 (`192.0.2.161`),
**Pico connected** (COM5, `scripts/pico.sh`), **phone on USB**, **watch on a non-isolated network** (home
Wi-Fi — corp Wi-Fi blocks watch adb; use a phone hotspot there). Watch has a **static reservation:
`192.0.2.162`** on home Wi-Fi, but the **wireless-debugging port still rotates** each session — grab it
from the watch's Wireless debugging screen, then `adb connect 192.0.2.162:<port>` (pairing persists).
Ping me when set up and we go live.

## 0. Pre-flight (do first)
- **⚠ Uninstall the old phone + watch apps first** — the debug signing key changed (now a committed shared
  key), so installing over the old build fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Uninstall both,
  then install fresh.
- Build + install latest: phone (`scripts/win-build.sh assembleDebug` → `adb install`) and watch
  (`WB_SRC=wear WB_NAME=garage-wear scripts/win-build.sh assembleDebug` → `adb pair/connect/install`).
  Or pull both APKs from the latest green CI run / a `v*` release.
- Confirm devices: `curl http://192.0.2.160/script/1/state` and S1 reachable. `scripts/pico.sh init`.

## 1. Phone real-mode control (Pico-driven) — devices, not demo
Goal: phone mirrors real i4 state and drives the S1 relay. *(I observe via curl `/state`, S1 `/command`
responses, and relay edge-count; you watch the phone + tap.)*
- Drive the Pico through CLOSED → OPENING → OPEN → CLOSING → CLOSED; **confirm the phone shows each state**.
- Tap **Open** at CLOSED → I verify S1 fired 1 pulse; **suppression**: tap Open at OPEN → 0 pulses.
- Tap **Stop** while OPENING → 1 pulse. Drive to **STOPPED_OPENING**; the morphing button shows the
  **Open｜Close split** — tap each, I edge-count (reverse = 1, continue = 3, per spec 14).
- Confirm transport label (`direct`/`broker`/`cloud`) matches how the phone reached the devices.

## 2. Watch rides the phone — REAL mode (new committed key)
Goal: prove the Data-Layer pairing works with the **new shared key**, and the watch mirrors real state.
- Phone app **foreground, demo OFF**. Watch should show the **real** state (no DEMO stamp) + transport.
- Drive the Pico → **watch updates promptly** (mirrors the phone's published state).
- Tap **Open/Close/Stop on the watch → confirm Yes** → I verify the **S1 relay** fires and the watch
  reflects the new state (round-trip through the phone).

## 3. Background drive — THE key untested path (Phase 2b)
Goal: watch controls the door with the **phone app closed** (via `GarageWearService`).
- **Close/background the phone app.** On the watch, open the app → it sends `refresh`; I verify the service
  woke and published current state (watch shows it, not "open phone").
- Tap **Open → Yes on the watch** → I verify **S1 relay fires** (service ran the real command) and the
  watch refreshes to the new state. Repeat for Close/Stop.
- If it doesn't fire: check `adb logcat` for the service, confirm settings (not demo), confirm node link.

## 4. Notifications + alarms on real state
- Drive the Pico to **OPEN** and leave it. With notification mode = **Always**, confirm the persistent
  "Garage open" appears; **open-too-long** (set 1 min) fires; **time-of-day** (set ~1 min out) fires.
- Drive Pico to **CLOSED** → confirm the open notification **and** both alarms clear immediately.
- (Watch) confirm the two alarms bridge to the watch if the app is enabled in the watch's companion app;
  the ongoing "open" stays phone-only.

## 5. At the real door (later commissioning, not the bench)
- **Q-03:** confirm the EcoStar restart-from-stop model (alternation vs resume). If it **resumes**, set
  `logic_cfg.resumeSameDir=true` (KVS) so the STOPPED continue/reverse pulse counts flip — no reflash.
- Tune provisional timing (`pulseGap`, gate) on the real door; D-04 wall-button-with-broker-down;
  force/obstruction. WiFi RSSI survey at the mounted location.

## My instrumentation during the session
`curl http://192.0.2.160/script/1/state` (i4 derived state) · S1 `/command?cmd=…` responses + relay
edge-count poll (`Switch.GetStatus`) · `adb -s <phone> logcat` + `adb -s <watch> logcat` · `scripts/pico.sh`
to drive inputs · `scripts/i4-scenario.sh` for timed scenarios.
