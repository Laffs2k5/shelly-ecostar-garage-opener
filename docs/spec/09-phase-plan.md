# 09 — Phase plan

Gated phases. Each produces something independently testable; each gate must pass before the next is
*finished* (phases can overlap — see "Sequencing" at the end). The **device tier comes first**; the app
comes before the real install (it's the easiest way to test/control the door during commissioning).

Legend: **[x]** done · **[~]** partial · **[ ]** todo. ☁ = needs LAN/device access · 💻 = offline-doable.

---

## Phase 0 — Repo & scaffold — ✅ DONE

**Goal:** version-controlled project with structure + decisions captured, nothing lost.

- [x] `git init`, mirror reference layout; `.gitignore` / `.env.example` / `CLAUDE.md`; lessons guide → `private/`
- [x] Decision docs (00–03, 08) + this plan; **private** GitHub remote pushed
- [x] Repo + working dir named **ecostar** (Q-07 → D-13)

**Gate:** ✅ repo pushed, scaffold in place, architecture decisions written down.

---

## Phase 1 — Info gathering & prove the unknowns — ✅ DONE (dev); 2 items deferred to install

**Goal:** retire high-risk assumptions before writing production mJS.

| # | Task | Status |
|---|---|---|
| 1.1 | i4 device info + Input model via RPC | **[x]** fw 1.7.5, inputs `switch`, mTLS+HTTP.* (spec 10 / D-14) |
| 1.2 | Optocoupler SW3/SW4 vs **real motor voltage** (Q-02) | **[ ] deferred → Phase 8** (needs the real EcoStar motor; rig proved the opto→input path) |
| 1.3 | Stop-then-reverse model + final inter-pulse gap + STOPPED-resume edge (Q-03) | **[~]** model confirmed + coded (D-09); exact gap + resume edge **deferred → Phase 8** (real door) |
| 1.4 | Broker mTLS provisioning recipe | **[x]** spec 11 |
| 1.5 | S1 on network + provisioned | **[x]** .161, `garage-controller` connected (Q-06) |

**Gate:** ✅ for development — Q-01/Q-03(model)/Q-04–Q-08/Q-11 resolved; rig substitutes for the real
motor. Q-02 + the Q-03 timing/resume edge are **real-door** items carried into Phase 8.

---

## Phase 2 — Pico rig + i4 monitor script — ✅ GATE PASSED

**Goal:** door-state derivation, developed with **no wiring to the actual EcoStar**.

- [x] Pico MicroPython input simulator + WSL control (`scripts/pico.sh`); observe via `scripts/i4-watch.sh` (spec 12)
- [x] `device/monitor.js` (+min): derive state → retained heartbeat + `mon/alive` + fire-and-forget POST to S1 + `/state` endpoint
- [x] Node mock-harness tests (15) — `scripts/test-device.sh`
- [x] Deployed + running on the live i4 (`scripts/deploy-device.sh`)
- [x] 4× PS2501 opto board verified (correct mapping, no cross-talk); **door matrix 13/13 PASS** on hardware
- [x] MQTT end-to-end via `garage-devtool` — every state change observed live

**Gate:** ✅ all scenarios correct on the rig; tests pass; heartbeat + `mon/alive` on the broker.

---

## Phase 3 — S1 controller script — ✅ CORE DONE; soak + at-install checks pending

**Goal:** command logic that pulses the EcoStar only when useful.

- [x] `device/controller.js` (+min): door-picture endpoint (i4 POST), commands via MQTT + local HTTP,
  spec-02 pulse logic (suppress / 1 / 2-pulse stop-then-reverse — D-09/D-19), 0.5 s relay pulse,
  retained heartbeat + `mon/alive`; boot-to-safe by construction (relay `initial_state:off`)
- [x] Node tests (12); 27 total pass
- [x] Deployed + running on S1 (.161); relay configured detached/off/auto-off 0.5 s
- [x] **End-to-end on hardware:** Pico→i4→S1 picture→decision correct; suppression + 2-pulse reverse
  confirmed; commands over **HTTP and MQTT**; i4 `controller_url` persisted in KVS
- [ ] ☁ Soak ≥ 24 h stable (both scripts)
- [ ] ☁ Physical wall-button (parallel to relay) verified — at install (works by design, D-04)

**Gate:** open/close over MQTT + HTTP ✓; counterproductive pulses suppressed ✓; button-with-broker-down
(verify at install); 24 h soak (pending).

---

## Phase 4 — Clients: Android app + web — 💻 mostly offline

**Goal:** a two-device-aware phone app + an HTML fallback to see door state and send open/close/toggle.

### 4A — Broker/cloud onboarding for clients (☁ broker-side "order")
- [ ] Order a **client mTLS identity** for the phone (e.g. CN `garage-phone`) — broker ACL needs
  read/write on **both** `devices/garage-monitor/#` + `devices/garage-controller/#` (like `garage-devtool`)
- [ ] **Cloud** (EMQX) username/password for off-LAN use (broker maintainers); web uses a random client-id

### 4B — Android (Kotlin/Compose, Paho `mqttv3`) — `app/`
- [ ] Single-activity, main + settings. State in `remember`/`mutableStateOf`
- [ ] **Two-device UI:** door card (i4 state + duration, the 7 states) + controls (open/close/toggle → S1)
- [ ] **Connection roaming**, re-evaluated each poll: HTTP-direct (per-device IP) > local broker (mTLS) >
  cloud (TLS user/pass). Tear down MQTT when HTTP-direct works. Surface active path + event log
- [ ] **HTTP-direct** path: read i4 `/state`, POST S1 `/command` — must work with the broker down
- [ ] Settings: 2 device IPs + 2 CNs + broker hosts + cloud creds, **import `.p12` + CA at runtime**
  (never bundled — NEW-PROJECT-GUIDE §6/D-06)
- [ ] Lifecycle-aware MQTT (no Doze keepalive churn); optional foreground notification (e.g. "door OPEN N min")
- [ ] Extract **pure, Android-free functions** (connection decision, topic build, state parse,
  cert→SSLSocketFactory) for JVM tests
- ⚠️ APK **builds on Windows** (aapt2 x86_64); **test on a physical device** (no Windows-ARM emulator)

### 4C — Web fallback — `web/`
- [ ] Vanilla HTML/CSS/JS, MQTT over **WSS** to cloud; same controls; creds in `localStorage`, random client-id
- [ ] Split pure logic into a testable `web/<core>.js`

**Gate:** app + web show correct door state and drive open/close over HTTP-direct **and** broker/cloud;
HTTP-direct works with the broker down; no identity hardcoded/bundled.

---

## Phase 5 — Testing & quality — 💻

- [ ] Device: keep the Node mock-harness green; add scenarios as logic grows; running `HW-VALIDATION.md`
  log of what was checked on real hardware vs mocked (observe-don't-infer, NEW-PROJECT-GUIDE §10)
- [ ] App: JVM unit tests for the pure functions (connection/decision/parse/cert with throwaway CA+`.p12`)
- [ ] Web: Node tests for `web/<core>.js`
- [ ] `docs/testing/REGRESSION.md` (manual checklist) + `docs/testing/AI-TEST-GUIDE.md` (agent-runnable)
- [ ] `docs/ARCHITECTURE.md` overview consolidating the spec set

**Gate:** one command runs all automated tests green; regression checklist exists and has been walked once.

---

## Phase 6 — CI/CD (GitHub Actions) — 💻

- [ ] `build.yml` — Node device tests + `scripts/build-device.sh --check` (min artifacts fresh) +
  debug APK on push to main (artifact)
- [ ] `release.yml` — on `v*` tag: APK + changelog-from-conventional-commits + GitHub Release
- [ ] `deploy-pages.yml` — `web/**` → GitHub Pages
- [ ] 🔴 **Stable debug keystore** passed explicitly to Gradle; prove identical signer with `apksigner`
  (NEW-PROJECT-GUIDE §8 — avoids `INSTALL_FAILED_UPDATE_INCOMPATIBLE` wiping user data)
- [ ] Node 24 for JS actions; build status badge in README

**Gate:** push to main builds + tests; tag cuts a Release with a stable-signed APK.

---

## Phase 7 — Device hardening & resilience — ☁ (device-side; do before install)

- [ ] **Connectivity watchdog** (coffee-timer pattern): reboot on prolonged Wi-Fi/broker loss to recover a
  wedged stack. Monitor re-derives from inputs on boot; controller is already boot-safe → no risky resume
- [ ] Validate `reset_reason` gating on **both** devices (1 = power-on → safe; 3 = sw/watchdog) — confirmed
  ad-hoc already; make it explicit + logged
- [ ] **Tunables via config** (optional): pulse gap (Q-03), debounce — version-gated `…/config` topic so a
  client can change them without reflashing; expose current version in heartbeat
- [ ] Q-09: set i4 inputs `factory_reset:false` (stuck reed at boot must not wipe the device)
- [ ] Q-10: decide device Shelly Cloud on/off (local broker already bridges to cloud)
- [ ] `status_ntf`/`rpc_ntf` confirmed `false` on both (done); `docs/spec` watchdog note

**Gate:** a forced Wi-Fi/broker outage self-recovers within the watchdog window without moving the door;
device config hardened.

---

## Phase 8 — Real install & commissioning — ☁🔧 (after the app; the app drives testing on-site)

**Goal:** move from bench to the actual garage, safely.

### 8A — Full install electrical diagram (deliverable)
- [ ] `docs/spec/install-schematic.svg` — the **complete** install: 230 V→S1 (C7), 5 V USB→i4, S1 relay +
  parallel push-button → EcoStar **T1/T2**, motor leads → 2× motor-sense optos (anti-parallel, 10 kΩ) →
  i4 SW3/SW4, 2× reed switches → i4 SW1/SW2 + ⏚, single Cat5 pairing, enclosure/grommets. Supersedes the
  `hardware-spec.md` sketches; cross-check against them

### 8B — Wire-up
- [ ] Mount enclosure; power both Shellys; **rewire the 2 motor-sense optos' LED side** Pico→motor leads
  (anti-parallel, hardware-spec §3.3 — D-18); fit the **real reed switches** on SW1/SW2 (remove the
  breadboard reed-sims); S1 relay + button across T1/T2
- [ ] Re-confirm i4↔S1 on-site (`/state`, heartbeats); `controller_url` already in KVS

### 8C — Resolve the real-door bench items
- [ ] **Q-02** — confirm motor voltage drives SW3/SW4 cleanly (opening/closing) on the real motor
- [ ] **Q-03** — confirm the STOPPED-resume pulse behaviour + **tune `PULSE_GAP_MS`** on the real door;
  update `controller.js`/spec 02

### 8D — Commissioning & safety
- [ ] EcoStar force settings (P1/P2) + obstruction-reversal still correct after automation
- [ ] **RF remotes** unaffected; **physical button** opens/closes with Wi-Fi/broker **down** (D-04)
- [ ] App-driven open/close/toggle from local + off-LAN; door-state tracking matches reality through a
  full cycle (incl. mid-travel stop/reverse)
- [ ] ≥ 24 h soak in situ; `HW-VALIDATION.md` updated

**Gate:** door operates correctly + safely from app and button; state tracking accurate; no regressions to
manual/RF operation.

---

## Phase 9 — Public release — 💻

The repo started **private** intending to go public (D-06).

- [ ] Secrets/identity scrub audit: grep for placeholders; confirm **nothing** real (keys/IPs/MACs/IDs) is
  committed — incl. archived docs/history (NEW-PROJECT-GUIDE §9)
- [ ] **LICENSE** (Q-08); README polish (badges, web Pages link, photos); `docs/ARCHITECTURE.md` linked
- [ ] Flip repo to public; verify the released APK + Pages work from a clean clone

**Gate:** public repo with nothing identity-specific; clean build from a fresh clone.

---

## Sequencing / parallelism

- **Done:** 0–2; 3 core. **Now (off-LAN, 💻):** Phase 4 (app+web code + JVM/Node tests), Phase 6 (CI/CD),
  Phase 5 docs — none need the devices until integration testing.
- **Needs LAN/devices (☁):** finishing 3 (soak), Phase 7 (watchdog), and on-device integration of 4.
- **Phase 8 (install)** is gated on Phase 4 (app) being usable and ideally Phase 7 (hardened firmware).
- **Phase 9** last.
- Real-door unknowns (**Q-02**, **Q-03** timing/resume) are intentionally parked until Phase 8 — the rig
  covers everything else.
