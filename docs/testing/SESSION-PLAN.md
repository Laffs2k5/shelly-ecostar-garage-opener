# Bench testing session — plan (run at the house; not a calendar item, just noted)

**Goal: final validation of the apps + firmware before moving on.** Interactive: **you configure + tap, I
observe over MQTT and tell you what to do next.**

**The trick — the Pico runs `device/test-rig/door_sim.py` (a "virtual EcoStar").** It senses the S1 impulse
and drives the i4 inputs to mimic a real door responding — but **fast** (~3 s travel), like the app's demo
mode. So everything is the *real* stack, just without the physical door:

```
phone / watch  →  S1 (relay impulse)  →  Pico door_sim  →  i4 inputs  →  i4 derive  →  back to phone / watch
```

It implements the real EcoStar model (D-09 alternation: an impulse stops a moving door, or starts a stopped
one in the opposite of the last direction) plus the departure overlap + end-of-travel reverse-kick — so the
controller's 1/2/3-pulse logic and the monitor's Q-16 gate are all exercised for real.

Bench: i4 `192.0.2.160`, S1 `192.0.2.161`, broker `192.0.2.130`, **Pico on COM5**, **phone on USB**,
watch `192.0.2.162` (home Wi-Fi; grab the rotating wireless-debugging port → `adb connect 192.0.2.162:<port>`).

## 0. Pre-flight
- **⚠ Uninstall the old phone + watch apps first** — the debug signing key changed (committed shared key);
  installing over the old build fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Uninstall both, install fresh
  (build via `win-build.sh` or pull both APKs from the latest green CI run / a `v*` release).
- **Wire the door_sim sense line (two wires to S1's dry-contact relay terminals `O`/`I`):** Pico **`3V3` →
  S1 `O`**, and **S1 `I` → Pico `GP15`** (input, internal pull-down). At rest GP15 is LOW; the ~0.5 s relay
  closure loops the Pico's 3V3 back to GP15 = HIGH = one impulse. `O`/`I` are interchangeable. **Bench only**
  — at the real install `O`/`I` go to EcoStar terminals 1+2; don't put 3V3 there.
- **Start the sim:** `mpremote connect COM5 run device/test-rig/door_sim.py` (streams `DOOR …` transitions I
  can watch), or deploy it as `main.py` for the session. It boots the door at CLOSED.
- **You configure the phone for REAL** (not demo): i4/S1 IPs for HTTP-direct, and/or broker creds. I confirm
  the i4 is reachable and subscribe to the heartbeats.

## 1. Core control loop (phone) — the heart of the validation
Goal: tap on the phone → S1 pulses → door_sim "moves" → i4 derives → app reflects it. *(I watch
`devices/garage-monitor/heartbeat` for derived state and `devices/garage-controller/heartbeat` for
`relay`/`fires`/`lastPulses`.)*
- **CLOSED → Open:** tap Open → S1 1 pulse → app shows Opening… (~3 s) → Open. **Suppression:** tap Open at
  OPEN → 0 pulses (I see `fires` unchanged).
- **Stop:** tap Stop while Opening → door_sim halts → **STOPPED_OPENING**; the morphing button becomes the
  **Open｜Close split**.
- **STOPPED continue vs reverse (Q-16/spec 14):** from STOPPED_OPENING, tap **Close** (reverse → 1 pulse →
  closes) vs **Open** (continue → 3 pulses → the door_sim does stop-then-reverse-twice and ends up opening).
  I confirm `lastPulses` 1 vs 3 and the resulting state. *(This validates the alternation assumption end to
  end — the sim alternates, matching `resumeSameDir=false`.)*
- **Reverse while moving:** tap Close while Opening → 2 pulses (stop+reverse) → door_sim → Closing.
- Confirm the transport label (`direct`/`broker`/`cloud`) matches the path.

## 2. Watch rides the phone — REAL mode (new shared key)
- Phone app **foreground, demo OFF**. Watch shows the **real** state (no DEMO stamp) + transport, and
  **updates promptly** as the door_sim moves.
- Tap **Open/Close/Stop on the watch → confirm Yes** → I verify the S1 relay fires and the watch follows
  (round-trip phone → S1 → door_sim → i4 → phone → watch). Confirms the Data-Layer pairs on the new key.

## 3. Background drive — THE key untested path (Phase 2b)
Goal: watch controls the door with the **phone app closed** (via `GarageWearService`).
- **Close/background the phone app.** Open the watch app → it sends `refresh` → I verify the service woke and
  published current state (watch shows it, not "open phone").
- Tap **Open → Yes on the watch** → I verify **S1 fires**, the door_sim moves, and the watch refreshes to the
  new state. Repeat Close/Stop. If it doesn't fire: `adb logcat` the service, confirm not-demo + node link.

## 4. Notifications + alarms on real state
- Drive to **OPEN** (tap, let door_sim finish). Mode **Always** → persistent "Garage open" appears;
  **open-too-long** (set 1 min) fires; **time-of-day** (~1 min out) fires.
- Close the door → the open notification **and** both alarms clear immediately.
- Watch: the two alarms bridge if the app is enabled in the watch's companion app; the ongoing "open" stays
  phone-only.

## 5. Deferred to the real door (NOT this bench session)
- **Q-03:** confirm the EcoStar's *physical* restart model (alternation vs resume). The bench sim assumes
  alternation; if the real door **resumes**, flip `logic_cfg.resumeSameDir=true` (KVS, no reflash).
- Tune provisional timing on the real door; D-04 wall-button-with-broker-down; force/obstruction; WiFi RSSI
  survey at the mounted location.

## My instrumentation
MQTT (primary): subscribe to `devices/garage-monitor/heartbeat` (derived door state, `inputs`, `since`) and
`devices/garage-controller/heartbeat` (`relay`, `fires`, `lastPulses`, `queued`, `locked`) — via
`mosquitto_sub` to the broker, or the cloud. Backup: `curl http://192.0.2.160/script/1/state`, S1 relay
edge-count (`Switch.GetStatus`). Plus the `door_sim` `DOOR …` console stream and `adb logcat` on both devices.
