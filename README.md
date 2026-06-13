# Shelly EcoStar Garage Opener

[![Build](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml/badge.svg)](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/Laffs2k5/shelly-ecostar-garage-opener?sort=semver)](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Smart automation of a **Hörmann EcoStar B** garage door operator using two Shelly devices, with full
galvanic isolation from the opener's electronics. Remote open/close + full door-state tracking, while
the physical wall button and RF remotes keep working independently of Wi-Fi.

> **Status: v1.0.0 — released & deployed.** The hardware box is installed and running. The device
> scripts (i4 monitor + S1 controller), the Android app + Wear OS watch companion (APKs on the
> [Releases](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/releases) page), and the
> [web control page](https://laffs2k5.github.io/shelly-ecostar-garage-opener/) are all live and
> validated on-device across HTTP-direct, local broker, and cloud. **No secrets are committed** — all
> keys/hosts/device-IDs are runtime-provisioned (`private/` + `.env` are gitignored; example IPs in
> docs are RFC 5737 placeholders).

## Two devices, two roles

- **Shelly Plus i4 DC — monitoring unit.** Derives door state (CLOSED / CLOSING / OPEN / OPENING /
  STOPPED_OPENING / STOPPED_CLOSING / UNKNOWN) from 2 reed switches + 2 optocoupler motor signals.
  Publishes every change to MQTT *and* HTTP-direct to the controller.
- **Shelly 1 Gen3 — controlling unit.** Takes open/close/stop commands, holds the door picture, and
  pulses the EcoStar impulse input — suppressing pulses that would be counterproductive given the
  current state.

## Getting started

**Just want to see it?** Open the **[web control page](https://laffs2k5.github.io/shelly-ecostar-garage-opener/)**
and toggle **Demo mode** (or the phone app's demo toggle) — the full UI runs with **zero hardware or
credentials**.

**Have the hardware and want to run it?**

1. **Build the box** — wiring, BOM, and the in-box layout:
   [hardware-spec](docs/initial-research/hardware-spec.md) + the
   [install schematic](docs/spec/install-schematic-schemdraw.svg) (RJ-45 pinout, opto board, 230 V split).
2. **Flash the device scripts** — `scripts/build-device.sh` (minify) → `scripts/deploy-device.sh`
   (chunked upload). Deploy the minified build; the heap is tiny. See [device/](device/README.md) and
   [scripts/](scripts/README.md).
3. **Provision the broker** — a local Mosquitto (mTLS) bridged to a cloud broker, per
   [11-broker-provisioning](docs/spec/11-broker-provisioning.md) (device identities → topic/ACL map).
4. **Install the clients** — grab the phone + watch APKs from
   [Releases](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/releases), then in the app's
   **Settings** enter your i4/S1 IPs + broker host and import your client cert. The web page is
   cloud-WSS only ([web/](web/README.md)).

Full commissioning + validation steps: [docs/testing/REGRESSION.md](docs/testing/REGRESSION.md).

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — one-page system map (start here).
- **[docs/spec/INDEX.md](docs/spec/INDEX.md)** — the design-doc map: state machine, MQTT, broker
  provisioning, device resilience, motion/pulse safety, app/watch design.
- **[docs/testing/](docs/testing/README.md)** — regression checklist, AI-runnable test guide, and the
  hardware-validation log.
- **[docs/archive/](docs/archive/README.md)** — completed phase plan + historical session records.
- **[SECURITY.md](SECURITY.md)** — threat model, no-secrets promise, how to report issues.
- Contributors: **[CLAUDE.md](CLAUDE.md)** — tech stack, mJS gotchas, the device dev loop.

## Layout

```text
device/              mJS scripts (monitor + controller) + Node test harness + Pico test-rig
app/                 Android app (Kotlin/Compose)
wear/                Wear OS companion (Kotlin/Compose) — rides the phone over the Data Layer
web/                 HTML control page (cloud-WSS fallback)
scripts/             Bash/Node helpers (build/minify, deploy, observe, test)
docs/spec/           Design docs (INDEX.md is the map)
docs/testing/        Test guides + HW-validation log
docs/archive/        Completed phase plan + historical session records
docs/initial-research/  Original hardware spec + motor-sense circuit design
.github/workflows/   CI/CD (build, release, deploy-pages)
private/             gitignored: real keys/certs/creds + network inventory + lessons guide + vendor manual
```

## Safety

The door is a security device. Manual control — the **physical wall button and RF remotes** — is wired
in parallel at the opener and works with Wi-Fi, the broker, and this software **completely down**
(decision D-04). The smart layer only *adds* remote control; it can never disable manual operation. The
controller is detached/off at boot and resumes persisted state only on a software/watchdog reboot, never
on mains loss. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Laffs2k5. This is a personal project provided as-is; deploy at your own risk and
use your own credentials/PKI (no secrets are shipped here).
