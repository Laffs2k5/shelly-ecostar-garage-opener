# 09 — Phase plan

Gated phases, mirroring the reference repo. Each phase produces something independently testable; each
gate must pass before the next starts. The **device tier comes first** — app/web are later.

---

## Phase 0 — Repo & scaffold — IN PROGRESS

**Goal:** version-controlled project with structure, decisions captured, nothing lost.

- [x] `git init`, mirror reference layout (`device/ app/ web/ scripts/ docs/ .github/ private/`)
- [x] Port `.gitignore`, `.env.example`, `CLAUDE.md`, move lessons guide to `private/`
- [x] Write decision docs (00–03, 08) + this plan
- [ ] Create the **private** GitHub remote under Laffs2k5 and push
- [ ] Resolve Q-07 (repo name) — currently `shelly-eurostar-garage-opener`

**Gate:** repo pushed, scaffold in place, architecture decisions written down.

---

## Phase 1 — Info gathering & prove the unknowns

**Goal:** retire the high-risk assumptions before writing production mJS.

| # | Task | Success criteria |
|---|---|---|
| 1.1 | Pull i4 device info + Input config via RPC (`Shelly.GetDeviceInfo`, `Input.GetConfig`) (Q-01) | Firmware + input event model known |
| 1.2 | Bench-verify optocoupler SW3/SW4 toggling against motor voltage (Q-02) | Clean OPENING/CLOSING signals observed |
| 1.3 | Bench-verify EcoStar impulse semantics mid-travel (Q-03) | Command→pulse table in spec 02 finalised |
| 1.4 | Capture broker mTLS provisioning steps from `mqtt-leiflan` | Repeatable `Mqtt.SetConfig` recipe per device |
| 1.5 | Reserve S1 static IP + add to network (Q-06) | S1 reachable, recorded in `private/network-inventory.md` |

**Gate:** Q-01..Q-03 answered (or workarounds designed); spec 02 table final; broker recipe written.

---

## Phase 2 — Pico dev rig + i4 monitor script

**Goal:** develop the door-state derivation with **no wiring to the actual EcoStar**.

- Define the **simulator contract**: the Pico drives the 4 dry-contact lines (SW1–SW4) to replay every
  door scenario (close→open, open→close, stop-mid, safety reversal, manual move), and can watch for the
  S1 relay pulse. This is the physical-layer analogue of the reference repo's Node mock harness.
- Build `device/monitor.js` (the i4 script): derive state → HTTP POST to S1 + MQTT publish + `mon/alive`.
- Node test harness (`device/test/`) mocking the Shelly runtime for the pure state-derivation logic.

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
**Remote close stays disabled until Q-04 (visual confirmation) is designed.**

## Phase 5 — Testing & quality

Node device tests, app/web pure-logic tests, manual regression checklist, hardware-validation log.

## Phase 6 — CI/CD

Adapt the reference workflows (build, release, pages). Device-minify check in CI.

---

## What can run in parallel

- Phase 1 bench work (1.2/1.3) is independent of 1.1/1.4 — do them as hardware is free.
- The Pico rig (Phase 2) can be wired while Phase 1 bench tests run.
