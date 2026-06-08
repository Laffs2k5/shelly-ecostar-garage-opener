# Shelly EcoStar Garage Opener

[![Build](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml/badge.svg)](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml)

Smart automation of a **Hörmann EcoStar B** garage door operator using two Shelly devices, with full
galvanic isolation from the opener's electronics. Remote open/close + full door-state tracking, while
the physical wall button and RF remotes keep working independently of WiFi.

> Status: **device tier + clients built and verified on the bench.** i4 monitor + S1 controller scripts
> run on hardware (door-state derivation, command logic, MQTT + HTTP); Android app + web page build and
> unit-test green in CI. Remaining: on-phone functional test, device hardening, and the real garage
> install. Design in `docs/spec/` (start at `INDEX.md`); plan in `docs/spec/09-phase-plan.md`.
> Private repo for now (intended to go public once hardened — see `CLAUDE.md`).

## Two devices, two roles

- **Shelly Plus i4 DC — monitoring unit.** Derives door state (CLOSED / CLOSING / OPEN / OPENING /
  STOPPED_OPENING / STOPPED_CLOSING / UNKNOWN) from 2 reed switches + 2 optocoupler motor signals.
  Publishes every change to MQTT *and* HTTP-direct to the controller.
- **Shelly 1 Gen3 — controlling unit.** Takes open/close commands, holds the door picture, and pulses
  the EcoStar impulse input — suppressing pulses that would be counterproductive given current state.

## Layout

```
device/              mJS scripts (monitor + controller) + Node test harness
app/                 Android app (Kotlin/Compose) — later phase
web/                 HTML control page — later phase
scripts/             Bash/Node helpers (build/minify, deploy, test)
docs/spec/           Design docs (INDEX.md is the map)
docs/testing/        Test guides
docs/initial-research/  Original hardware spec, motor-sense circuit, EcoStar manual
.github/workflows/   CI/CD — later phase
private/             gitignored: real keys/certs/creds + network inventory + lessons guide
```

## Where to start

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the one-page overview, then
[`docs/spec/INDEX.md`](docs/spec/INDEX.md) and the phase plan in
[`docs/spec/09-phase-plan.md`](docs/spec/09-phase-plan.md).
