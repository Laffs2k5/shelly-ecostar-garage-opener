# 09 — Phase plan

Gated phases, mirroring the reference repo. Each phase produces something independently testable; each
gate must pass before the next starts. The **device tier comes first** — app/web are later.

---

## Phase 0 — Repo & scaffold — IN PROGRESS

**Goal:** version-controlled project with structure, decisions captured, nothing lost.

- [x] `git init`, mirror reference layout (`device/ app/ web/ scripts/ docs/ .github/ private/`)
- [x] Port `.gitignore`, `.env.example`, `CLAUDE.md`, move lessons guide to `private/`
- [x] Write decision docs (00–03, 08) + this plan
- [x] Create the **private** GitHub remote under Laffs2k5 and push
- [ ] Resolve Q-07 (repo name) — currently `shelly-eurostar-garage-opener`

**Gate:** repo pushed, scaffold in place, architecture decisions written down.

---

## Phase 1 — Info gathering & prove the unknowns

**Goal:** retire the high-risk assumptions before writing production mJS.

| # | Task | Success criteria |
|---|---|---|
| 1.1 | ~~Pull i4 device info + Input config via RPC~~ — **DONE** (spec 10) | fw 1.7.5; inputs type `switch`; mTLS + HTTP.* capabilities confirmed |
| 1.2 | Bench-verify optocoupler SW3/SW4 toggling against motor voltage (Q-02) | Clean OPENING/CLOSING signals observed |
| 1.3 | Bench-confirm the stop-then-reverse model (D-09) + inter-pulse delay + the STOPPED_* resume edge (Q-03) | Command→pulse table in spec 02 confirmed on hardware; delay value chosen |
| 1.4 | ~~Broker mTLS provisioning~~ — **DONE for i4** (spec 11) | `garage-monitor` connected to broker over mTLS (`connected:true`). S1 pending (Q-06) |
| 1.5 | Reserve S1 static IP + add to network (Q-06) | S1 reachable, recorded in `private/network-inventory.md` |

**Gate:** Q-01..Q-03 answered (or workarounds designed); spec 02 table final; broker recipe written.

---

## Phase 2 — Pico dev rig + i4 monitor script

**Goal:** develop the door-state derivation with **no wiring to the actual EcoStar**.

- [x] **Simulator contract + control path** — Pico MicroPython sim ([device/test-rig/main.py](../../device/test-rig/main.py))
  driving 4 channels (SW1–SW4), controlled from WSL via [scripts/pico.sh](../../scripts/pico.sh);
  observe with [scripts/i4-watch.sh](../../scripts/i4-watch.sh). Design: spec 12. (Established 2026-06-07.)
- [x] Build `device/monitor.js` (i4 script): derive state → MQTT heartbeat + `mon/alive` + HTTP POST to
  S1 (fire-and-forget) + `/state` HTTP endpoint. Built/minified ([scripts/build-device.sh](../../scripts/build-device.sh)).
- [x] Node test harness (`device/test/`, 15 tests) mocking the Shelly runtime — `scripts/test-device.sh`.
- [x] **Deployed + running on the live i4** ([scripts/deploy-device.sh](../../scripts/deploy-device.sh)):
  `running:true`, `/state` returns `UNKNOWN` (unwired inputs float released). 2026-06-07.
- [~] **Opto interface board** per spec 12 — **ch1 (SW1) wired + verified** with **10 kΩ** (3/3 clean,
  → `CLOSED`); 10 kΩ confirmed for all channels. Remaining: wire ch2–4 (SW2/SW3/SW4), then run the full
  door-scenario matrix.
- [x] MQTT end-to-end confirmed via `garage-devtool` ([scripts/mqtt-sub.sh](../../scripts/mqtt-sub.sh)):
  observed the retained heartbeat + `online` LWT. (Fresh heartbeat + `mon/alive` to re-check with the
  board powered + driven.)

**Gate:** all door scenarios on the Pico rig produce correct state; Node tests pass; `mon/alive` +
retained heartbeat observed on the broker.

---

## Phase 3 — S1 controller script

**Goal:** command logic that pulses the EcoStar only when useful.

- Build `device/controller.js`: consume i4 state (HTTP) + commands (MQTT/HTTP), apply the spec 02
  command→pulse table, suppress counterproductive pulses, 0.5s relay pulse.
- Boot-to-safe + `reset_reason` validation (Q via NEW-PROJECT-GUIDE §4).

**Gate:** open/close from MQTT + local HTTP work; counterproductive pulses suppressed; button still
works with broker down; 24h+ stable.

---

## Phase 4 — Clients (app + web)

Android app (Kotlin/Compose, Paho) + HTML fallback. Two-device aware. Reuse reference patterns.
Remote open **and** close are supported — no visual-confirmation gate (D-11).

## Phase 5 — Testing & quality

Node device tests, app/web pure-logic tests, manual regression checklist, hardware-validation log.

## Phase 6 — CI/CD

Adapt the reference workflows (build, release, pages). Device-minify check in CI.

---

## What can run in parallel

- Phase 1 bench work (1.2/1.3) is independent of 1.1/1.4 — do them as hardware is free.
- The Pico rig (Phase 2) can be wired while Phase 1 bench tests run.
