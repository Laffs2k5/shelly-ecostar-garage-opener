# Manual regression checklist

What automated tests can't cover — the things a human (or AI driving hardware) verifies. Automated
suites (run them first): `scripts/test-device.sh` (device, 27), `scripts/test-web.sh` (web, 9),
`scripts/win-build.sh testDebugUnitTest` (app, 16). 🤖 = an agent can do it from WSL; 🧑 = needs a human.

## Device tier — bench rig (i4 + S1 + Pico, no EcoStar)

- [ ] 🤖 Deploy current scripts: `scripts/deploy-device.sh monitor` (i4), `… controller` (S1); both `running:true`.
- [ ] 🤖 Door matrix via `scripts/pico.sh` → `scripts/i4-watch.sh` + `curl …/script/1/state`:
  CLOSED→OPENING→OPEN→CLOSING→CLOSED, both STOPPED_* states, reed-coast overlap → correct derived state.
- [ ] 🤖 Commands to S1 (HTTP `…/command?cmd=` **and** MQTT via `scripts/mqtt-pub.sh`): `open` from CLOSED → 1 relay pulse;
  `open` while OPEN/OPENING → **suppressed**; `open` while CLOSING → **2 pulses** (~1.2 s apart).
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

## Web page (cloud-WSS)

- [ ] 🧑 Open the Pages URL; enter cloud creds + ids in ⚙; door state appears; Open/Close/Toggle work.
- [ ] 🧑 Change state from the app → web reflects it within a few seconds.

## Cross-client

- [ ] 🧑 Command from app → observe on web + `mqtt-sub.sh`, and vice-versa.

## Real install (Phase 8 — at the garage)

- [ ] 🧑 Physical wall button opens/closes with Wi-Fi **and** broker down (D-04).
- [ ] 🧑 RF remotes unaffected. Obstruction reversal still works (EcoStar safety).
- [ ] 🧑 Full cycle from the app matches the real door incl. mid-travel stop/reverse.
