# Hardware validation log

What was **actually observed on real hardware** (vs. mocked/inferred) — NEW-PROJECT-GUIDE §10. Newest
first. "Bench" = i4 + S1 + Pico rig, **not** wired to the EcoStar.

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
