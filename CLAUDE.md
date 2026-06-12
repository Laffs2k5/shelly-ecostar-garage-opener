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
  lowest latency. If the controller is unreachable the i4 just keeps publishing to MQTT — the POST is
  fire-and-forget and **never blocks** (D-10).
- **Shelly 1 Gen3 — CONTROLLING unit.** Receives open/close/toggle commands from the outside world,
  holds the latest door picture (from the i4), and pulses the EcoStar impulse input (terminals 1+2) —
  but *suppresses counterproductive pulses* (e.g. won't pulse while already OPENING, which would stop
  the door).

**Safety-first.** The door is a security device. Core control (physical button, RF remotes) never
depends on WiFi/MQTT. Remote open/close does **not** require visual confirmation (D-11); a camera check
is a possible future addition, not a gate.
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
| Wear OS app | Kotlin + Wear Compose; rides the phone over the Data Layer (no own MQTT) | `wear/` (separate Gradle project, **same `applicationId` + signing key** as `app/`; pure logic copied from `app/` and guarded byte-identical by `scripts/check-wear-sync.sh`) |
| Web fallback | Vanilla HTML/CSS/JS, MQTT over WSS | `web/` |
| Helper scripts | Bash + curl + Node | `scripts/` |
| Broker | Local Mosquitto (mTLS) bridged to cloud EMQX | external (mqtt-leiflan) |
| Dev/test rig | Raspberry Pi Pico: `main.py` (host-driven inputs) + `door_sim.py` (autonomous "virtual EcoStar" — senses the S1 relay, drives the i4 inputs for a full closed-loop bench test) | `device/test-rig/` |

## MQTT topics & monitoring (see spec 03)

Two channels, **both kept by design** (do not collapse them):

- `devices/<id>/heartbeat` — **retained**, app status (door state, `rssi`, schema version `v`, `ts`).
  Immediate-on-connect.
- `mon/<id>/alive` — **non-retained**, LAN-only infra liveness. **The monitor watches `alive`, never the
  retained heartbeat** (a retained payload would resurrect a dead device on monitor restart).
- `devices/<id>/online` — retained LWT, firmware-published.
- `devices/<controller-id>/command` — open/close/toggle/**stop** to the controller. (Config tuning is via
  KVS `logic_cfg`/`wd_cfg` over RPC — there is **no** MQTT config topic.)

Keep `mon/#` off the cloud bridge. Set `status_ntf`/`rpc_ntf` = `false` (else firmware floods the bridge).

## mJS constraints (these WILL bite — see NEW-PROJECT-GUIDE §4)

- No Promises/async/await, no template literals, no arrow functions, no `Array.indexOf`/`String.split`.
- `JSON.parse()` returns `undefined` on failure (not null, never throws). Don't rely on try/catch.
- Max ~4–5 timers (consolidate into ONE with counter dispatch); max ~3 concurrent `Shelly.call` (chain
  them). HTTP request size limit ≈ 3072 bytes. Minify before deploying (heap is tiny).
- **The i4 HAS real Input components** — confirmed on fw 1.7.5: inputs are type `switch`, status
  `{id,state:bool}`, emit `input:N` toggle events. Unlike the Plug S, the coffee-timer's
  "button-toggle flag" workaround does NOT apply here. See `docs/spec/10-i4-device-facts.md`.

## Device dev loop (i4 monitor)

`scripts/test-device.sh` (Node mock-harness, no hardware) → `scripts/build-device.sh` (minify
`device/monitor.js` → `.min.js`) → `scripts/deploy-device.sh monitor` (chunked `Script.PutCode` over
RPC). Observe with `scripts/i4-watch.sh` (raw inputs), `curl http://<i4>/script/<id>/state` (derived
state), and the Pico rig `scripts/pico.sh` (drive inputs). See spec 12. Stability/WiFi surveys:
`scripts/soak.sh` (24 h device stability) and `scripts/rssi-watch.sh` (overnight RSSI survey at the
install location — `--summary` for the verdict).

## Development environment

Windows ARM64 + WSL2 (Ubuntu).
- **The Android build runs on the Windows toolchain, driven from WSL** via `scripts/win-build.sh`
  (syncs `app/` to a Windows-local dir, runs Android Studio JBR gradle + SDK). **I can compile +
  JVM-unit-test the app myself headless** (`testDebugUnitTest`, `assembleDebug` both verified). The WSL
  *Linux* toolchain still can't (aapt2). **Emulator doesn't work here** — only **on-phone functional
  tests need the user** (physical device via `adb.exe`, Windows paths).
- **WSL CAN reach the LAN here** (verified 2026-06-07 — `curl http://192.0.2.160/rpc/...` reaches the
  i4). This **differs from the reference repo's environment**; drive the Shellys directly from WSL with
  `curl`. Shelly Plus/Gen2 RPC over `GET http://<ip>/rpc/<Method>?<params>` returns the result object
  **directly** — no `.result` envelope (that wrapper is only for JSON-RPC POSTs to `/rpc`). No
  `pwsh.exe` detour needed for device control.
- **Test-rig Pico** (RP2040, MicroPython) is USB-attached to **Windows** as **COM5** — WSL can't see it
  directly (no usbipd). Drive it from WSL via `powershell.exe` → Windows `python -m mpremote`. State
  persists across calls only with `mpremote resume`. Wrapped in `scripts/pico.sh`; see spec 12.

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
