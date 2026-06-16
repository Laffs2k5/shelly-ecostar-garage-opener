# Specification — index

Design docs for the Shelly EcoStar garage opener. Numbered loosely after the reference repo so the
mapping is obvious. (Gaps 04–07 are intentional — the numbering mirrors the reference build.)

| Doc | Topic |
|---|---|
| [00-overview.md](00-overview.md) | Goals, scope, hardware summary, success criteria |
| [01-architecture.md](01-architecture.md) | Two-device split (i4 monitor / S1 controller), transports |
| [02-state-machine.md](02-state-machine.md) | Door states + transitions (lives on the i4) |
| [03-mqtt-and-monitoring.md](03-mqtt-and-monitoring.md) | MQTT topics, retain rules, monitor-spec adherence |
| [08-decisions-and-open-questions.md](08-decisions-and-open-questions.md) | Decision log + open questions |
| [10-i4-device-facts.md](10-i4-device-facts.md) | i4 RPC snapshot: firmware, inputs, capabilities |
| [11-broker-provisioning.md](11-broker-provisioning.md) | mTLS onboarding: broker facts, identity→topic map, RPC sequence, the "order" |
| [12-test-rig-and-wiring.md](12-test-rig-and-wiring.md) | Pico input simulator, opto interface, i4 wiring, the closed test loop |
| [13-device-resilience.md](13-device-resilience.md) | Connectivity watchdog (reboot-to-recover); why no reset_reason gate |
| [14-motion-timing-and-pulse-safety.md](14-motion-timing-and-pulse-safety.md) | Motion timing + pulse safety: reed-departure asymmetry + cross-device pulse race (Q-16) — debounce/gate/queue/lockout |
| [16-app-v2.md](16-app-v2.md) | Android app design: periodic-wake background model, notifications/alarms/demo, morphing action button |
| [17-wear-os-exploration.md](17-wear-os-exploration.md) | Wear OS companion (OnePlus Watch 2R): watch app + watch-face complication; rides the phone via the Data Layer, sideloaded |

The **install schematic** ([install-schematic-schemdraw.svg](install-schematic-schemdraw.svg), regenerate
via `install-schematic-schemdraw.py`) shows the full in-box wiring + RJ-45 pinout.

One-page system overview: [../ARCHITECTURE.md](../ARCHITECTURE.md).
Source hardware design: [../initial-research/hardware-spec.md](../initial-research/hardware-spec.md).
Reference build lessons: `private/NEW-PROJECT-GUIDE.md` (gitignored).

## Archive

Completed/historical records live in [../archive/](../archive/README.md): the gated
[phase plan](../archive/09-phase-plan.md) (all phases done at v1.0.0) and the one-time
[in-garage i4 observation session](../archive/15-garage-i4-observation.md).
