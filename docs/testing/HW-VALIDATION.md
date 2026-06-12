# Hardware validation log

What was **actually observed on real hardware** (vs. mocked/inferred) — NEW-PROJECT-GUIDE §10. Newest
first. "Bench" = i4 + S1 + Pico rig, **not** wired to the EcoStar.

## 2026-06-12 — Transport matrix (all 3) + Wear background-drive fixes (closed-loop)

Continued the same bench closed loop (phone + watch + Pico `door_sim`, observed via MQTT). Re-ran the
key paths over **each transport** and fixed three issues found live.

**Transport matrix — every transport now exercised with the full state machine + watch + background:**

| | State render | Commands | Background drive (app killed) |
|---|---|---|---|
| Wi-Fi direct (HTTP) | ✅ 2 s poll | ✅ full 8-step matrix (above) | ✅ |
| Local broker (mTLS) | ✅ prompt push | ✅ incl. mid-travel `stop` | ✅ |
| Cloud (WSS) | ✅ prompt push | ✅ + `isStale` order guard | ✅ (WSS from killed app) |

- **Broker/cloud push** rendered OPENING/CLOSING promptly (event-driven `onUpdate`), not on the 2 s poll.
- **`isStale` out-of-order guard (cloud):** the open→stop→close sequence that used to flash OPENING showed
  clean forward-only motion; device `ts` strictly increasing on the wire.
- **Commands delivered via MQTT publish** on both broker (`fires` 118/120/121/124) and cloud
  (125/126/130), incl. the 3-pulse continue dance over broker.

**🐞 Three issues found + fixed live (all re-verified on hardware):**
1. **Watch went "Unknown" after a backgrounded command.** `GarageWearService` did one early poll
   (`sleep(1500)`) then exited; over the broker/cloud transport the freshly-opened connection often had no
   heartbeat yet, so it read OFFLINE — and `WearLink.publishIfChanged` mapped that *null* reading to the
   string `"UNKNOWN"`, **clobbering the watch's good state**. Fixes: (a) the service now FOLLOWS the door
   for the travel window (`BackgroundFollow`, polls ~1 s, publishes each change, stops once moved+at-rest
   or 12 s); (b) a null/blank reading is never published (a real i4 `"UNKNOWN"` still is). Re-test: watch
   tracked **Closing… → Closed** on a backgrounded broker command, and **→ Open** on a backgrounded cloud
   command.
2. **Watch button had no re-tap lock** (the phone's was missing on Wear). Added the same action-lock
   (cleared on door-state change; safety backstop **6 s** on the watch — longer than the phone's 3 s
   because the cloud-background round-trip can exceed 3 s and was briefly un-dimming the button before the
   new state landed). Re-test: re-tap blocked.
3. **Transport change in Settings stuck until app kill.** `ensureConnected` keeps a live connection and
   only upgrades cloud→local, never tears down — so blanking the local host left the app on the stale
   broker connection. Fixes: (a) **pull-to-refresh** forces a re-roam through the preferred order on
   demand; (b) a settings change now disconnects first so the loop re-roams against the new config. Re-test:
   Cloud→(brief Offline)→Wi-Fi·broker on Save without a kill; pull-to-refresh spinner re-roams; UI intact.

All app unit tests pass (added `BackgroundFollow` + `WearLink.shouldPublish` coverage). Both APKs CI-signed
with the shared committed debug key.

## 2026-06-12 — Full app + watch functional test round (closed-loop, observed via MQTT)

End-to-end functional round on the **bench closed loop**: phone app + OnePlus Watch 2R driving the real
i4+S1, with the Pico running `door_sim.py` as a fast "virtual EcoStar" (TRAVEL 8 s) — it senses the S1
relay impulse and drives the i4 inputs, so the i4 derives real states from a real motion model. Claude
observed only (`mosquitto_sub` on both heartbeats, `garage-devtool` cert); user tapped phone/watch.
Door travel observed ~8–9 s; controller `fires` counter advanced exactly as predicted each step.

| # | Action (source) | Controller | Monitor (i4) | Verdict |
|---|---|---|---|---|
| 1 | Open from CLOSED (phone) | `open`, pulses 1, fires→102 | CLOSED→OPENING→OPEN | ✅ |
| 2 | Close from OPEN (phone) | `close`, pulses 1, fires→103 | OPEN→CLOSING→CLOSED | ✅ |
| 3 | Stop mid-OPENING (phone) | `stop`, pulses 1, fires→105 (door `moving:true`) | OPENING→STOPPED_OPENING (`0000`) | ✅ |
| 4 | Reverse: STOPPED_OPENING + close (phone) | `close`, **pulses 1**, fires→106 | →CLOSING | ✅ 1-pulse reverse (D-09) |
| 5 | Continue: STOPPED_OPENING + open (phone) | `open`, **pulses 3**, fires→109 | CLOSING→STOPPED_CLOSING→OPENING | ✅ 3-pulse dance |
| 5b | Continue: STOPPED_CLOSING + close (phone, bonus) | `close`, **pulses 3**, fires→112 | OPENING→STOPPED_OPENING→CLOSING→CLOSED | ✅ mirror of #5 |
| 6 | Q-16: 2nd `open` while OPENING (raw HTTP) | `open`, **pulses 0**, fires unchanged (115) | stays OPENING | ✅ counterproductive pulse suppressed |
| 7 | Close from watch (Data Layer→phone→S1) | `close`, pulses 1, fires→116 | OPEN→CLOSING→CLOSED | ✅ watch round-trip + state mirror |
| 8 | **Open from watch, phone app swiped from recents** | `open`, pulses 1, fires→117 | CLOSED→OPENING→OPEN | ✅ background drive (WearableListenerService) |

- **#4/#5 confirm the EcoStar impulse model both ways on the real controller:** reverse-from-stopped = 1
  pulse; continue-same-direction = the 3-pulse dance, with the i4 deriving the intermediate flicker states
  from `door_sim`'s genuine micro-moves. #5b is the closing-direction mirror (caught during free play).
- **#6 Q-16 defense-in-depth proven at both layers:** the app **cannot** emit a counterproductive command
  (morphing button only offers *Stop* while moving + action-lock blocks re-taps), and the controller
  **also** suppresses it (`pulses:0`, `fires` flat) when a raw command bypasses the UI. Injected via
  `GET /script/1/command?cmd=open` on the S1 while OPENING.
- **#8 closes the "drive when backgrounded" goal (app v2):** watch command fired the real relay with the
  phone app **not foreground** — `GarageWearService` receives the Data Layer message and calls `GarageNet`.
- **Event-driven push held up:** OPENING was rendered promptly each cycle (no missed transient), and no
  stale/out-of-order flash — the `isStale` guard + `door_sim` 8 s travel did their job on the cloud path.
- Action-lock behaved: `locked:true` on each fire, cleared on the next door-state change (no perma-block).
- **Provisional:** still the bench loop, not the EcoStar — physical alternation/timing (Q-02/Q-03) and RSSI
  remain real-door commissioning items.

## 2026-06-11 — Resource re-assessment (after stop + 3-pulse + cfgObj growth)

Re-check vs. the 2026-06-08 baseline, after the controller gained `stop`, the 3-pulse sequencer,
`resumeSameDir`, and `cfgObj` (and the monitor gained `cfgObj`). **Verdict: still healthy on every axis;
no storage/RAM/heap concern.** Uptimes: i4 ~16 h, S1 ~3.2 d.

| Metric | i4 (monitor) | S1 (controller) | vs. 06-08 |
|---|---|---|---|
| Device RAM min-free | **110 KB / 251 KB (44%)** | **99 KB / 262 KB (38%)** | i4 −5 KB, S1 −11 KB |
| Script heap peak | 6.0 KB | **8.1 KB** | i4 +0.9, S1 +2.1 (the new code) |
| Script heap free | 21.9 KB | 19.7 KB | S1 −2.3 KB |
| Flash FS free | 106 KB (27%) | 422 KB (46%) | flat |
| Script CPU | **~85%** | 4% | i4 +2 (noise) |
| Deployed code (min) | 7.0 KB | 9.8 KB | S1 +0.75 KB |

- **RAM:** both still well above headroom — the S1 dip to 99 KB min-free reflects *transient* use during
  this session's active testing (rolling 3-pulse sequences, config flips, a deliberate crash+recovery),
  **not** a leak (the 24 h soak proved no steady decline). 38% worst-case free is comfortable.
- **Script heap (the one to watch):** the controller is now the heavier script — peak **8.1 KB** of ~25 KB
  VM (~68% free at peak), heap-free 19.7 KB. Roomy, but it's the component to keep an eye on as the app v2
  features (alarms etc. are app-side, not device) — device-side controller growth from here should be modest.
- **CPU:** i4 ~85% is the **known, accepted Q-14** (100 ms input poll; coffee plug on same fw = 0% with a
  30 s timer → frequency-driven, not an artifact). S1 4%. Unchanged posture.
- **Flash:** untouched (~static scripts/KVS/certs). Plenty free on both.

No action needed. Mitigation levers remain if ever required (Q-14 event-driven poll; trim min build).

## 2026-06-11 — STOPPED 3-pulse "continue" path + config-tunable model + boot-safety (hardware)

Backend for the app v2 STOPPED split-pair (spec 16 V2-6 / Q-03 / D-19). Bench = i4 + S1 + Pico, not wired
to the EcoStar — so this validates the **controller's pulse mechanics**, not the door's physical response.

**Method:** drove the S1 door picture directly (`POST /door_state`), sent a command, and **counted real
relay pulses** by polling `Switch.GetStatus` at ~80 ms and counting rising edges. i4 STOPPED derivation
driven via `pico.sh`.

| Case | `pulses` reported | relay rising edges |
|---|---|---|
| STOPPED_OPENING + open (continue) | 3 | **3** (spaced ~1.2 s) |
| STOPPED_OPENING + close (reverse) | 1 | **1** |
| STOPPED_CLOSING + close (continue) | 3 | **3** |
| STOPPED_CLOSING + open (reverse) | 1 | **1** |

- **i4 derivation (Pico):** opening→motor-off-mid-travel → `STOPPED_OPENING`; closing→motor-off →
  `STOPPED_CLOSING`; both observed on `GET /script/1/state`. Full chain i4-derive → S1-pulse confirmed.
- **Config-tunable model:** `KVS.Set logic_cfg {resumeSameDir:true}` + restart → continue/reverse **flipped**
  (STOPPED_OPENING+open became 1, +close became 3). `KVS.Delete` + restart → back to alternation (continue=3).
  Active model echoed on the heartbeat (`resumeSameDir`).
- **🐞 Boot-safety bug found + fixed.** Setting `logic_cfg` via RPC `GET ...&value={...}` made the Shelly
  store the value as a **JSON object**, so `KVS.Get` returned `value` as an object; `JSON.parse(object)`
  **threw `SyntaxError` and crashed the controller at boot** (`running:false`, endpoints never registered —
  same failure class as the 2026-06-08 empty-body crash). Fixed: `applyWdCfg`/`applyLogicCfg` now route
  through `cfgObj()` which never parses a non-string (object passes through, only JSON text is parsed).
  Re-verified: object-form `logic_cfg` now boots clean **and** applies. Regression-tested in `controller.test.js`.
- **Provisional:** the *physical* alternation-vs-resume question (Q-03) still needs the real door; the
  mechanism + tunability are done. 60/60 device tests pass.

## 2026-06-10 — Q-16 Problems 2 & 3: controller pulse-safety (hardware)
Controller at-rest guard + full-sequence pulse-lockout + config-tunable timing (KVS `logic_cfg`).
45 device tests pass. Validated on the real i4+S1 (relay not wired to the EcoStar — pulse count/timing
only; door reaction is a commissioning check).

- **At-rest guard (Problem 2) — end-to-end via Pico:** drove an arrival overlap (closed-reed + closing
  motor → i4 derives CLOSED, `moving=true`, POSTs to S1), commanded **open** mid-overlap → S1 **queued**
  it (`queued:open`, no pulse). Dropped the motor (i4 pushed `moving=false`) → S1 **fired the queued open**
  (`lastCmd:open, lastPulses:1, queued:""`). Exercises the monitor's new **moving-change push** (state
  stays CLOSED, but a picture is sent when the motor stops) + the controller queue/fire. ✅
- **Pulse lockout (Problem 3) — via `fires` counter:** two **open** commands back-to-back (inside the
  lock) advanced the monotonic `fires` counter by **1, not 2** (2nd dropped); a 3rd after the lock
  cleared advanced it to **2** (lock releases). ✅
- **Config tunability (KVS `logic_cfg`):** set `queueTimeout=30` then `lockMargin=4000` via `KVS.Set`,
  restart → both took effect (longer queue window / ~4.5 s lock), proving timing params tune without
  reflashing. Cleared back to defaults (lockMargin 300, queueTimeout 5) after. ✅
- **Fail-open preserved (D-19):** UNKNOWN / missing-`moving` still pulses best-effort (unit-tested).
- Note: the heartbeat now also carries `door.moving`, `queued`, `locked`, `fires` for observability.

## 2026-06-10 — Q-16 gate: hardware timing verification (Pico timed scenarios)
The time-gated tiebreaker (Q-16 P1, `GATE_TICKS=4`/~400 ms) verified on the **real i4** by replaying the
measured real-door timings as **on-Pico timed sequences** (`device/test-rig/main.py`: `close_arrival`,
`open_arrival`, `depart_closed`, `depart_open` — precise sub-tick timing on-device; the host link is too
laggy). Verification watches the **heartbeat state-change stream** (a transient glitch would publish an
extra OPENING/CLOSING), not just the end state.

- `close_arrival(180)` (kick < gate): `… CLOSING → CLOSED` — **no OPENING; 180 ms reverse kick absorbed.** ✅
- `open_arrival(180)`: `OPENING → OPEN` — **no CLOSING; symmetric.** ✅
- **Negative control `close_arrival(500)`** (kick > gate): `CLOSING → CLOSED → OPENING → CLOSED` — the
  500 ms kick **does** flip transiently → **proves the gate is a real ~400 ms threshold, not blanket
  suppression.** ✅
- `depart_closed(650)`: `CLOSED → OPENING`; `depart_open(550)`: `OPEN → CLOSING` — **departures detected.** ✅
- Margin note: observed real kicks were 140–220 ms; the 500 ms control shows the boundary sits between
  400–500 ms (= gate). Provisional/tunable; re-confirm at commissioning.

## 2026-06-10 — In-garage i4 observation session (Q-02/Q-03/Q-16 data)
i4 wired observe-only at the real door (reeds SW1/SW2 + anti-parallel motor optos SW3/SW4, USB power,
no S1/impulse — spec 15). User drove the door; high-rate `Shelly.GetStatus` capture (inputs + RSSI),
raw log: [data/2026-06-10-i4-observation-capture.log](data/2026-06-10-i4-observation-capture.log).
Bits = `SW1 SW2 SW3 SW4` (closed-reed, open-reed, opening-motor, closing-motor).

- **Reeds + motor optos all work at the real install.** Full CLOSE: open-reed releases → SW4 held through
  travel → closed-reed seats. Full OPEN symmetric. STOPPED mid-travel = **`0000`** (all off) → derives
  `STOPPED_CLOSING`/`_OPENING` via lastDir. **Q-13 + Q-02 confirmed on the real motor** (optos toggle
  cleanly on real ±24 V, no chatter, held for the whole travel).
- **D-09 alternation confirmed BOTH ways:** stopped-while-closing → next press → **OPENING** (SW3);
  stopped-while-opening → next press → **CLOSING** (SW4). Matches the impulse model the controller relies on.
- **Departure overlap (Q-16 Problem 1), measured:** reed stays engaged **~0.5–0.8 s** *after* the motor
  starts driving away (open-end 0.51–0.63 s, closed-end 0.78 s). Real and well above the 200 ms debounce.
- **⚠ End-of-travel reverse is REAL and opto-visible (not mechanical):** at the close seat, after the
  closed-reed engages and the motor drives in ~1 s, **SW3 (opening) pulses ON then off** (`1001→1010→1000`).
  Caught twice: **~140 ms and ~220 ms (n=2, 57% spread)**. Electrically present on the opto (deliberate
  relief pulse or relay-release transient). **This is `c=1 & op=1` — identical pattern to a departure,
  distinguished only by duration (140–220 ms vs ~500–780 ms).** Directly reshapes the Q-16 fix (spec 14):
  the motor-direction tiebreaker must be **time-gated (~300–350 ms, in the narrowed ~220→510 ms gap, with
  margin — small sample!)**, else it would glitch `CLOSED→OPENING` at every arrival. Open-end reverse not
  directly captured (~140 ms blip, sampler missed it) — assumed symmetric; the gate covers both ends.
- **Travel times:** close ~16–17 s, open ~14–15 s (opening ~1.3 s faster).
- **WiFi RSSI at the garage: −73 to −85 dBm** (weak; loosely tracks door position — better open ~−74,
  worse closed ~−82, dipped to −85). Held connection throughout, but margin is thin for the watchdog once
  live — flagged for later (antenna/AP placement).
- **Capture caveat:** single-session, small sample (no statistical runs); every timing figure here is
  **provisional — choose FW thresholds with margin and keep config-tunable; re-confirm at commissioning.**

## 2026-06-10 — 24 h soak PASS (Phase 3) — both devices
- **≥24 h stability met, decisively: ~33.4 h observed** (120173 s wall) on both i4 and S1, via the
  offline-safe baseline+check model (`scripts/soak.sh`; baseline 2026-06-08 20:45). The computer slept /
  went to work and back across the window — irrelevant, since the verdict reads the devices' own
  persistent counters.
- **Zero memory drift:** `ram_min_free` (low-water since boot — the leak canary) **unchanged** the whole
  time: i4 112068 B, S1 109204 B. No leak.
- **No reboots / watchdog trips:** uptime kept pace with wall-clock exactly (i4 +120175 s, S1 +120178 s
  over 120173 s) → `rebooted:no`.
- **No crashes, MQTT unbroken:** both scripts `running:true` across all samples; `mqtt-down:0`.
- Verdict reproducible any time: `scripts/soak.sh --summary logs/soak-baseline.csv`.

## 2026-06-09 — Real reed bench test (Q-13) — mrsmart MR-00326
- **First real reed validated end-to-end** (rig had only used opto reed-*sims*). Wired **directly**:
  one lead → i4 input **I1 (SW1, id0)**, other → **−** rail — no opto, no resistor (passive dry contact,
  D-16). Pico/SW1-opto removed for an unambiguous single-source test.
- **Clean wiring:** magnet away → input0 `false` (steady, 3/3 reads), no short/float.
- **Polarity confirms closed-loop (matches D-16, `invert:false`):** magnet **present → input0 `true`**
  → i4 derives **CLOSED**; magnet **away → `false`**. (Derived state with magnet off reads
  `STOPPED_OPENING` — correct: bare reed release with no motor signal just falls back to lastDir.)
- **Repeatability sweep (~22 s, 0.25 s poll):** **4/4 clean on/off cycles**, each a single edge on
  **SW1 only** — no contact bounce visible at 250 ms (the monitor's 200 ms debounce would absorb any
  sub-sample chatter anyway), **no cross-talk** to SW2–SW4.
- **Soak unaffected:** done *during* the running 24 h soak without power-cycling the i4 — `--check`
  after showed uptime kept pace, `ram_min_free` unchanged, no reboot/crash. Reed activity is just
  normal monitor work.
- **Remaining (Phase 8, real door):** post-mount operating gap on the steel door (free-air ~5 cm,
  shrinks on ferrous — spacers may be needed), and SW2 "open" reed (same part, not separately waved).

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
