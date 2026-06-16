# Manual regression checklist

What automated tests can't cover — the things a human (or AI driving hardware) verifies. Automated
suites (run them first): `scripts/test-device.sh` (device, 60), `scripts/test-web.sh` (web, 15),
`scripts/win-build.sh testDebugUnitTest` (app, 41), `scripts/check-wear-sync.sh`,
`python3 device/test-rig/test_door_sim.py`. 🤖 = an agent can do it from WSL; 🧑 = needs a human.

## Device tier — bench rig (i4 + S1 + Pico, no EcoStar)

- [ ] 🤖 Deploy current scripts: `scripts/deploy-device.sh monitor` (i4), `… controller` (S1); both `running:true`.
- [ ] 🤖 Door matrix via `scripts/pico.sh` → `scripts/i4-watch.sh` + `curl …/script/1/state`:
  CLOSED→OPENING→OPEN→CLOSING→CLOSED, both STOPPED_* states, reed-coast overlap → correct derived state.
- [ ] 🤖 Commands to S1 (HTTP `…/command?cmd=` **and** MQTT via `scripts/mqtt-pub.sh`): `open` from CLOSED → 1 relay pulse;
  `open` while OPEN/OPENING → **suppressed** (`pulses:0`, Q-16); `stop` while moving → 1 pulse.
- [ ] 🤖 STOPPED resume (D-09 / `resumeSameDir` default off): from STOPPED_OPENING, `close` (reverse) → **1 pulse**;
  `open` (continue) → **3 pulses** (start-reverse→stop→start). Mirror for STOPPED_CLOSING.
- [ ] 🤖 MQTT end-to-end: `scripts/mqtt-sub.sh` shows i4 heartbeat tracking each state + `mon/alive`.
- [ ] 🤖 Boot-to-safe: reboot S1 (`Shelly.Reboot`) → relay stays OFF, no spurious pulse; `reset_reason` 3.
- [ ] 🤖 Soak ≥ 24 h: both scripts `running:true`, RAM stable, no crash.

## App (on a physical phone — APK from CI artifact or `assembleDebug`)

- [ ] 🧑 Install APK; first run shows Settings; enter i4 IP, S1 IP, ids, broker hosts, cloud user/pass,
  client id (`garage-app`); import `.p12` + CA. Settings persist across restart.
- [ ] 🧑 On home Wi-Fi: door state matches reality; footer shows **Wi-Fi · direct**; Open/Close/Toggle act.
- [ ] 🧑 Kill the broker (or leave it): HTTP-direct still works (state + commands) — proves no broker dependency.
- [ ] 🧑 On cellular (off-LAN): footer shows **Cloud**; state + commands work via the bridge.
- [ ] 🧑 Background the app a while, return: reconnects without a flood; no battery drain spike (Doze).
- [ ] 🧑 Update test: install a newer CI APK over the old one with `adb install -r` → **no signature error**
  (proves stable CI signing, guide §8).

## Wear OS watch (OnePlus Watch 2R — sideloaded, shares the phone's `applicationId` + signing key)

- [ ] 🧑 Watch mirrors the phone live (state + connectivity); DEMO stamp appears/clears with the phone's demo toggle.
- [ ] 🧑 Confirm Yes/No dialog on every command; re-tap is briefly blocked (action lock), never perma-blocked.
- [ ] 🧑 Watch round-trip: command from the watch drives S1 and the phone mirrors the new state.
- [ ] 🧑 **Background drive**: with the phone app swiped from recents, a watch command still fires the relay
  (via `GarageWearService`) and the watch tracks the door to its settled state — on broker **and** cloud.
- [ ] 🧑 **Watch-face complication** (added to a configurable slot): shows the door glyph
  (closed = two bars / mid-travel = one orange bar / open = no bars / unknown = dimmed); tap opens the watch
  app; state refreshes after opening the app. Zero background work — no recurring battery warning beyond the
  one-time add prompt (spec 17 Phase 2c).

## Web page (cloud-WSS)

- [ ] 🧑 Open the Pages URL; enter cloud creds + ids in ⚙; door state appears; Open/Close/Toggle work.
- [ ] 🧑 Change state from the app → web reflects it within a few seconds.

## Cross-client

- [ ] 🧑 Command from app → observe on web + `mqtt-sub.sh`, and vice-versa.

## Real install (Phase 8 — at the garage)

- [ ] 🧑 Physical wall button opens/closes with Wi-Fi **and** broker down (D-04).
- [ ] 🧑 RF remotes unaffected. Obstruction reversal still works (EcoStar safety).
- [ ] 🧑 Full cycle from the app matches the real door incl. mid-travel stop/reverse.
