# Shelly EcoStar Garage Opener

Smart automation of a **Hörmann EcoStar B** garage door operator using two Shelly devices, with full
galvanic isolation from the opener's electronics. Remote open/close + full door-state tracking, while
the physical wall button and RF remotes keep working independently of WiFi.

> Status: **early scaffold.** Design is in `docs/spec/`. No device/app code yet.
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

`docs/spec/INDEX.md` → `01-architecture.md`, then the phase plan in `09-phase-plan.md`.
