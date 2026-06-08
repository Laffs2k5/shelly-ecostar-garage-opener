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

### 4A — Broker/cloud onboarding for clients — [x] ISSUED
- [x] **`garage-app`** LAN cert (mTLS-only, CN=username, no password, broad `devices/#`) + cloud
  user/pass — issued; in the Bitwarden vault (spec 11). Web uses cloud user/pass + random client-id.
- [x] Imported on the phone (`ca.crt` + `garage-app.p12` + p12-password) + cloud creds entered;
  on-device broker-path integration test passed (Wi-Fi · broker, live state + commands). 2026-06-08.

### 4B — Android (Kotlin/Compose, Paho `mqttv3`) — `app/` — [~] foundation done
- [x] Build config + manifest + theme; package `no.leiflan.garage`
- [x] **Pure core + JVM tests** (`api/`): `GarageApi.decide` (HTTP-direct>local>cloud>offline) + cmd/URL
  helpers + HTTP-direct calls + JSON parse; `DoorModel` (7 states, labels, duration); `ConnectionUi`
  (labels + capped event log); `MqttTls` (cert→SSLSocketFactory, copied verbatim) + throwaway fixtures
- [x] `api/MqttTransport.kt` — Paho: local mTLS + cloud WSS; sub `garage-monitor/heartbeat`, pub
  `garage-controller/command` (QoS1, non-retained); client-id = CN `garage-app`; auto-reconnect off
- [x] `MainActivity.kt` — Compose Settings + Main (door card + Open/Close/Toggle + connection footer);
  runtime `.p12`/CA import; lifecycle-gated poll loop; tear down MQTT when HTTP-direct works
- [x] **Compiles + unit tests pass on the Windows toolchain** (driven from WSL via `scripts/win-build.sh`):
  `testDebugUnitTest` **16/16**, `assembleDebug` BUILD SUCCESSFUL (23 MB debug APK). 2026-06-08
- [x] **On-phone test (HTTP-direct)** — installed via adb, settings injected; live state tracking
  (CLOSED→OPENING→OPEN, Wi-Fi·direct), **Open→relay pulse**, suppression (Open@OPEN→0). Stable signing
  confirmed (no wipe-on-update). The transient "Offline" was phone sleep (Q-15), not a network issue.
- [x] **On-phone test (local-broker mTLS)** — forced broker path; **Wi-Fi · broker** as `garage-app`,
  live state via broker, **Open→relay pulse** over MQTT. Settings restored.
- [ ] On-phone **cloud (WSS)** path — off-LAN test (phone on cellular), user/later
- [ ] **UX polish:** show in Settings *which* CA / `.p12` are imported (cert CN / status); optional
  foreground notification ("door OPEN N min")

### 4C — Web fallback — `web/` — [x] DONE
- [x] `web/garage-core.js` (pure, **9 Node tests** — `scripts/test-web.sh`) + `web/index.html`:
  cloud-WSS, door state from `garage-monitor` heartbeat, open/close/toggle to `garage-controller`
  (non-retained), settings in `localStorage`, random client-id

**Gate:** app + web show correct door state and drive open/close over HTTP-direct **and** broker/cloud;
HTTP-direct works with the broker down; no identity hardcoded/bundled. *(web ✓; app HTTP-direct ✓ on the
phone; app broker path pending cert import)*

---

## Phase 5 — Testing & quality — 💻

- [x] Device: Node mock-harness green (27); [x] App: JVM unit tests (16); [x] Web: Node tests (9)
- [x] `docs/testing/REGRESSION.md` (manual checklist, 🤖/🧑) + `docs/testing/AI-TEST-GUIDE.md` (agent-runnable)
- [x] `HW-VALIDATION.md` running log (real-hardware observations) + [x] `docs/ARCHITECTURE.md` overview

**Gate:** ✅ automated suites green (31+9+16); regression checklist + agent guide + architecture overview exist.

---

## Phase 6 — CI/CD (GitHub Actions) — ✅ GATE PASSED

- [x] `build.yml` — **js-tests** job (device 27 + web 9 Node tests + `build-device.sh --check`) +
  **android** job (`testDebugUnitTest` + `assembleDebug`, APK artifact). Verified green (run `success`).
- [x] `release.yml` — on `v*` tag: signed APK + changelog-from-conventional-commits + GitHub Release.
- [x] `deploy-pages.yml` — `web/**` → gh-pages (Pages serving activates when the repo goes public).
- [x] 🔴→✅ **Stable debug keystore**: `DEBUG_KEYSTORE` secret set + explicit `signingConfigs.debug`
  (storeFile via `DEBUG_KEYSTORE_FILE`); CI prints the apksigner cert (guide §8).
- [x] Node 24 for JS actions; build badge in README.

**Gate: PASSED** — push to main builds + runs all suites green; release workflow + stable signing in place.

---

## Phase 7 — Device hardening & resilience — ☁ (device-side; do before install)

- [x] **Connectivity watchdog** in both scripts (spec 13): reboot on prolonged Wi-Fi/broker loss; KVS
  `wd_cfg` overrides thresholds. **Validated on hardware** (i4): detects real broker disconnect, counter
  climbs, resets on reconnect, no false reboot; 31 device tests incl. the reboot path. Defaults armed.
- [x] **No `reset_reason` gate needed (D-20)** — devices are stateless across reboot (boot always safe);
  `reset_reason` 1/3 observed, nothing depends on it.
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
