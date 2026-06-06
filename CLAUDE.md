# CLAUDE.md

## Project overview

Smart automation of a **Hörmann EcoStar B** garage door operator (circa 2006) using **two Shelly
devices**, with full galvanic isolation from the opener's electronics. Remote open/close + full door
state tracking, while the physical wall button and RF remotes keep working independently of WiFi.

> **Naming:** the operator is **EcoStar** (Hörmann). The repo dir / original PDF say "eurostar" —
> that's a typo; do not propagate it into code, topics, or identifiers. See spec 08.

Two devices, two roles (see `docs/spec/01-architecture.md`):

- **Shelly Plus i4 DC — MONITORING unit.** Owns door-state derivation from 4 dry-contact inputs (2 reed
  switches + 2 optocoupler motor-direction signals). On every state change it (a) publishes to MQTT so
  any subscriber can follow the door, and (b) HTTP-POSTs the state directly to the controller for
  lowest latency.
- **Shelly 1 Gen3 — CONTROLLING unit.** Receives open/close/toggle commands from the outside world,
  holds the latest door picture (from the i4), and pulses the EcoStar impulse input (terminals 1+2) —
  but *suppresses counterproductive pulses* (e.g. won't pulse while already OPENING, which would stop
  the door).

**Safety-first.** The door is a security device. Core control (physical button, RF remotes) never
depends on WiFi/MQTT. No unattended remote *close* until visual confirmation is designed (spec 08).
Carry the coffee-timer boot-to-safe pattern: resume persisted state only on a software/watchdog reboot
(`reset_reason == 3`), never on mains power loss.

## Reference material (read-only, do NOT edit)

- `private/NEW-PROJECT-GUIDE.md` — hard-won lessons from the reference build. Read it.
- `~/code/github/Laffs2k5/shelly-coffee-timer` — the reference repo (same tech stack & structure).
- `C:\temp\mqtt-leiflan` — operator-side local Mosquitto (mTLS) + cloud bridge + PKI.
- `C:\temp\nas-leiflan\docs\layer3-monitor-spec.md` — WIP monitor spec we adhere to. Flag breakage.
- `docs/initial-research/hardware-spec.md` — the original hardware design (wiring, BOM, circuits).

## Tech stack (mirrors the reference repo)

| Component | Tech | Location |
|---|---|---|
| Device scripts | mJS (JS subset on ESP32) | `device/<name>.js` → `<name>.min.js` (deploy the minified artifact) |
| Android app | Kotlin + Jetpack Compose, Paho mqttv3 | `app/` (build on Windows — see below) |
| Web fallback | Vanilla HTML/CSS/JS, MQTT over WSS | `web/` |
| Helper scripts | Bash + curl + Node | `scripts/` |
| Broker | Local Mosquitto (mTLS) bridged to cloud EMQX | external (mqtt-leiflan) |
| Dev/test rig | Raspberry Pi Pico + breadboard, simulating the i4's dry-contact inputs | (Phase 2) |

## MQTT topics & monitoring (see spec 03)

Two channels, **both kept by design** (do not collapse them):

- `devices/<id>/heartbeat` — **retained**, app status (door state, config version, ts). Immediate-on-connect.
- `mon/<id>/alive` — **non-retained**, LAN-only infra liveness. **The monitor watches `alive`, never the
  retained heartbeat** (a retained payload would resurrect a dead device on monitor restart).
- `devices/<id>/online` — retained LWT, firmware-published.
- `devices/<controller-id>/command` — open/close/toggle to the controller.

Keep `mon/#` off the cloud bridge. Set `status_ntf`/`rpc_ntf` = `false` (else firmware floods the bridge).

## mJS constraints (these WILL bite — see NEW-PROJECT-GUIDE §4)

- No Promises/async/await, no template literals, no arrow functions, no `Array.indexOf`/`String.split`.
- `JSON.parse()` returns `undefined` on failure (not null, never throws). Don't rely on try/catch.
- Max ~4–5 timers (consolidate into ONE with counter dispatch); max ~3 concurrent `Shelly.call` (chain
  them). HTTP request size limit ≈ 3072 bytes. Minify before deploying (heap is tiny).
- **The i4 HAS real Input components** (`input:0..3` with proper events) — unlike the Plug S, so the
  coffee-timer's "button-toggle flag" workaround does NOT apply here. Verify on firmware.

## Development environment

Windows ARM64 + WSL2 (Ubuntu). Same constraints as the reference repo:
- **APK cannot be built in WSL** (aapt2 is x86_64-only) — build on Windows. **Emulator doesn't work on
  Windows-ARM** — test on a physical device via `adb.exe` (Windows paths, not `/mnt/c/...`).
- **WSL can't reach the LAN** — drive Shellys from Windows via `pwsh.exe` → `Invoke-RestMethod
  http://<ip>/rpc`. **RPC result is under `.result`.**

## Credentials & public-repo hygiene

Repo starts **private**, intended to go public later → adopt no-hardcoded-identity discipline from day
one. No real keys/usernames/IPs/hostnames/device-IDs/MACs in committed files. All real material in
`private/` + `.env` (both gitignored). `.env.example` documents the shape. mTLS `.p12` + CA public cert
are runtime-provisioned per device, never committed/bundled.

## Git workflow

- Commit to `main`. Semantic commit subjects, max 70 chars (`feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`chore:`).
- Diagrams in **mermaid**, not ASCII. Keep docs concise; link to code rather than duplicate it.
- Keep this CLAUDE.md current in the same commit when architecture changes.

## Docs

`docs/spec/INDEX.md` is the map. Phase plan: `docs/spec/09-phase-plan.md`. Open questions &
decision log: `docs/spec/08-decisions-and-open-questions.md`.
