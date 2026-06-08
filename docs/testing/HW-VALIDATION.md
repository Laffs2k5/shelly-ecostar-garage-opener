# Hardware validation log

What was **actually observed on real hardware** (vs. mocked/inferred) — NEW-PROJECT-GUIDE §10. Newest
first. "Bench" = i4 + S1 + Pico rig, **not** wired to the EcoStar.

## 2026-06-08 — On-phone app test (OnePlus CPH2653, Android 16, via adb)
- **Install:** CI-built debug APK installs via `adb install -r` (Success). **Signing is stable** — the
  APK's signer SHA-256 (`a9286ff0…d26af1`) **equals** our `DEBUG_KEYSTORE` `androiddebugkey` cert, proving
  CI uses our fixed key (explicit `signingConfigs.debug.storeFile`, §8) → updates won't wipe data. We did
  **not** hit the coffee-dev random-key trap.
- **Settings:** injected via `run-as` into `shared_prefs/garage_settings.xml` (debuggable app) — reliable,
  no UI tapping needed.
- **HTTP-direct path WORKS:** app showed live door state and tracked changes — **CLOSED → "Opening…" →
  "Open"** — footer **Wi-Fi · direct**, driven by the Pico, no broker/certs.
- **Commands WORK (HTTP-direct):** tapped **Open** while CLOSED → S1 relay pulsed ~0.5 s, heartbeat
  `lastCmd:open, lastPulses:1`. Tapped **Open** while OPEN → **suppressed**, relay stayed off,
  `lastPulses:0`. Full app→S1→relay chain + the spec-02 suppression logic verified on the phone.
- **Transient "Offline" was the PHONE SLEEPING** (not AP isolation — Q-15 corrected): 5-min screen
  timeout → Wi-Fi power-save → HTTP polls fail. `svc power stayon true` + wake fixed it; the phone then
  `curl`ed the i4 fine. No isolation/firewall (user-confirmed). On-demand polling stops when backgrounded
  by design (no churn); background/push would need the broker path + a foreground service (future).
- **Broker (mTLS) path WORKS on the phone too:** with the IPs blanked (HTTP-direct off), the app connected
  **Wi-Fi · broker** as `garage-app` (imported `client.p12`+`ca.crt`); driving CLOSED updated the app live
  (broker retained heartbeat → phone), and **Open → relay pulse** via MQTT publish (`lastPulses:1`). Settings
  restored after. So both LAN paths (HTTP-direct + local mTLS) are validated on-device.
- **Cloud (WSS) path WORKS on the phone too:** forced cloud by blanking `i4_ip`/`s1_ip`/`mqtt_local_host`
  (so roaming falls through to cloud) — phone stayed on Wi-Fi but the EMQX endpoint is public internet, so
  the WSS transport + cloud creds are exercised identically to a cellular client. App connected **Cloud**
  (`garage-app`), driving Pico CLOSED updated the app live (**"Closed"** via cloud-delivered heartbeat),
  and **Open → S1 relay pulse** — controller heartbeat `lastCmd:open, lastPulses:1` (phone → EMQX cloud →
  bridge → local broker → S1). All three transports now validated on-device. Settings restored after; the
  only thing a true cellular test would add is proving the radio, not app logic.
- **Remaining:** UX polish — show in the app *which* CA/`.p12` are imported (user request); a broader
  UI-polish pass is planned but low-priority (functionality at install time is the priority).

## 2026-06-08 — Resource headroom assessment
- **RAM:** i4 min-free **115 KB / 251 KB (46%)**; S1 min-free 110 KB / 262 KB (42%). Good margin.
- **Script heap:** i4 peak **5.1 KB**, S1 peak 6.0 KB — of ~27 KB each (~80% free). Lots of room.
- **Flash FS:** i4 **104 KB free (27%)**, S1 416 KB free (46%). Fine — our scripts/KVS/certs are ~static.
- **Script CPU:** S1 **4%** (1 s tick); i4 **~83% steady** (100 ms input poll, converged at 23 min uptime).
  Cross-checked the **coffee plug** (.159, same fw 1.7.5): its always-on script = **0%** CPU with a 30 s
  timer (45 h uptime). So the figure is **real and timer-frequency-driven** (30 s→0, 1 s→4, 100 ms→83),
  not a metric artifact — the i4's fast poll genuinely loads the script core. Halving 50→100 ms didn't
  move it (curve is flat-high until a much lower frequency). **Decision: accepted as a known issue** —
  RAM/heap/FS margins are fine and the device is rock-stable. **Mitigation if ever needed (Q-14):**
  go event-driven on the i4's real input events (D-14) + a slow housekeeping timer, or drop the poll to
  ~1 Hz (≈4%, at the cost of ~2 s state-confirm latency). (Coffee's own heap is nearly full,
  `mem_free 2520` — our ~22 KB free is comparatively roomy.)

## 2026-06-08 — Connectivity watchdog (Phase 7)
- Both scripts carry the watchdog (spec 13); 31 device tests incl. the reboot path.
- **i4 hardware:** broker up → `mqttUp()=true`, counter 0, no false reboot. Booted into a dead-broker
  config → `mqttUp()=false`, `WD.mqttDown` climbed monotonically (5150→13150 ms), `wd_cfg` (mqtt=150 s)
  read from KVS. Restored → reconnected, script running. Defaults armed (Wi-Fi 600 s / broker 1800 s).
- Observation: under heavy `Script.Eval` polling the 50 ms tick ran a bit slow → thresholds approximate
  (fine for recover-a-wedged-stack). `Mqtt.SetConfig` server change needs a reboot to apply (`restart_required`).

## 2026-06-08 — Clients + CI; bench re-confirm
- **Android app** compiles on the Windows toolchain (driven from WSL via `scripts/win-build.sh`):
  `assembleDebug` BUILD SUCCESSFUL → 23 MB debug APK; `testDebugUnitTest` 16/16.
- **CI** (GitHub Actions) run `success`: js-tests (device 27 + web 9) + android (unit 16 + APK artifact).
  Stable debug signing via `DEBUG_KEYSTORE` secret + explicit `signingConfigs.debug`.
- **Bench re-confirm:** both device scripts `running:true` (RAM ~22 KB free); Pico CLOSED → i4 `/state`
  CLOSED → S1 `open` decision `pulses:1`. Chain intact.
- *Not yet on hardware:* app on a phone (functional), web in a browser, real EcoStar.

## 2026-06-07 — S1 controller + two-device chain
- S1 (Shelly 1 Gen3, `S3SW-001X16EU`, fw 1.7.5) on `192.0.2.161`; mTLS-provisioned as
  `garage-controller`, `Mqtt.GetStatus connected:true`, `online true` on the broker.
- `controller.js` deployed, `running:true`; relay configured `in_mode:detached`, `initial_state:off`,
  `auto_off 0.5 s`. A command produced a **~0.5 s relay pulse** then auto-off (observed via Switch.GetStatus).
- **End-to-end:** Pico→i4→(HTTP POST)→S1 picture→decision: `open`@CLOSED=1 pulse; `open`@OPEN/OPENING=0
  (suppressed); `open`@CLOSING=**2 pulses, relay fired twice ~1.2 s apart**. Commands work over **HTTP
  and MQTT** (`garage-devtool` publish). i4 `controller_url` persisted in KVS.

## 2026-06-07 — i4 monitor + opto rig
- i4 (Shelly Plus i4 DC, `SNSN-0D24X`, fw 1.7.5) on `192.0.2.160`; inputs type `switch` (D-14);
  mTLS-provisioned as `garage-monitor`, `connected:true`. `reset_reason`: 1=power-on, 3=software reboot.
- Input polarity: activating an input = `SWn`→`−` (D-16), per the official i4 DC diagram (matches hardware-spec).
- **Opto board** (4× PS2501, **10 kΩ** LED resistor — confirmed sufficient, 3/3 clean cycles on SW1):
  all 4 channels map correctly (GP2→SW1…GP5→SW4), no cross-talk.
- **Door matrix 13/13** on hardware: CLOSED→OPENING→OPEN→CLOSING→CLOSED, both STOPPED_* states,
  stop-then-reverse, reed-coast overlap (reed wins) — all derive the correct state.
- **MQTT:** every state change observed on `devices/garage-monitor/heartbeat` + `mon/alive` via
  `garage-devtool`; `online` LWT flips false when the device is powered down (retained heartbeat persists).

## Pending real-hardware items (Phase 8, real door)
- Q-02: motor voltage → opto SW3/SW4 on the actual motor.
- Q-03: STOPPED-resume pulse edge + final `PULSE_GAP_MS` tuning on the real door.
- Physical wall-button operates the door with Wi-Fi/broker down (D-04).
