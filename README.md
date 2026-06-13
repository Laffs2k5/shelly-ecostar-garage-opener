# Shelly EcoStar Garage Opener

[![Build](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml/badge.svg)](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml)

Smart automation of a **Hörmann EcoStar B** garage door operator using two Shelly devices, with full
galvanic isolation from the opener's electronics. Remote open/close + full door-state tracking, while
the physical wall button and RF remotes keep working independently of WiFi.

> Status: **device tier + all clients built and validated on the bench.** i4 monitor + S1 controller
> scripts run on hardware (door-state derivation, command logic incl. safety `stop`, MQTT + HTTP); the
> Android app and a Wear OS watch companion are functionally tested on-device across all three transports
> incl. background drive (HW-VALIDATION 2026-06-12); web page tested; CI green. Remaining: the real garage
> install (wire-up + commissioning) and going public. Design in `docs/spec/` (start at `INDEX.md`); plan in
> `docs/spec/09-phase-plan.md`. **No secrets are committed** — all keys/certs/hosts/IDs are runtime-provisioned
> from `.env` + the app settings + a private vault (`private/` and `.env` are gitignored). Example IPs in docs
> are RFC 5737 placeholders.

## Two devices, two roles

- **Shelly Plus i4 DC — monitoring unit.** Derives door state (CLOSED / CLOSING / OPEN / OPENING /
  STOPPED_OPENING / STOPPED_CLOSING / UNKNOWN) from 2 reed switches + 2 optocoupler motor signals.
  Publishes every change to MQTT *and* HTTP-direct to the controller.
- **Shelly 1 Gen3 — controlling unit.** Takes open/close commands, holds the door picture, and pulses
  the EcoStar impulse input — suppressing pulses that would be counterproductive given current state.

## Layout

```
device/              mJS scripts (monitor + controller) + Node test harness + Pico test-rig
app/                 Android app (Kotlin/Compose)
wear/                Wear OS companion (Kotlin/Compose) — rides the phone over the Data Layer
web/                 HTML control page (cloud-WSS fallback)
scripts/             Bash/Node helpers (build/minify, deploy, observe, test)
docs/spec/           Design docs (INDEX.md is the map)
docs/testing/        Test guides + HW-validation log
docs/initial-research/  Original hardware spec + motor-sense circuit design
.github/workflows/   CI/CD (build, release, deploy-pages)
private/             gitignored: real keys/certs/creds + network inventory + lessons guide + vendor manual
```

## Where to start

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the one-page overview, then
[`docs/spec/INDEX.md`](docs/spec/INDEX.md) and the phase plan in
[`docs/spec/09-phase-plan.md`](docs/spec/09-phase-plan.md).

## Safety

The door is a security device. Manual control — the **physical wall button and RF remotes** — is wired
in parallel at the opener and works with Wi-Fi, the broker, and this software **completely down**
(decision D-04). The smart layer only *adds* remote control; it can never disable manual operation. The
controller is detached/off at boot and resumes persisted state only on a software/watchdog reboot, never
on mains loss. See [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Laffs2k5. This is a personal project provided as-is; deploy at your own
risk and use your own credentials/PKI (no secrets are shipped here).
