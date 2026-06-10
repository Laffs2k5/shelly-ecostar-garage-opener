# Specification — index

Design docs for the Shelly EcoStar garage opener. Numbered loosely after the reference repo so the
mapping is obvious.

| Doc | Topic |
|---|---|
| [00-overview.md](00-overview.md) | Goals, scope, hardware summary, success criteria |
| [01-architecture.md](01-architecture.md) | Two-device split (i4 monitor / S1 controller), transports |
| [02-state-machine.md](02-state-machine.md) | Door states + transitions (lives on the i4) |
| [03-mqtt-and-monitoring.md](03-mqtt-and-monitoring.md) | MQTT topics, retain rules, monitor-spec adherence |
| [08-decisions-and-open-questions.md](08-decisions-and-open-questions.md) | Decision log + open questions |
| [09-phase-plan.md](09-phase-plan.md) | Gated phase plan |
| [10-i4-device-facts.md](10-i4-device-facts.md) | i4 RPC snapshot: firmware, inputs, capabilities (Phase 1.1) |
| [11-broker-provisioning.md](11-broker-provisioning.md) | mTLS onboarding: broker facts, identity→topic map, RPC sequence, the "order" |
| [12-test-rig-and-wiring.md](12-test-rig-and-wiring.md) | Pico input simulator, opto interface, i4 wiring, the closed test loop |
| [13-device-resilience.md](13-device-resilience.md) | Connectivity watchdog (reboot-to-recover); why no reset_reason gate |
| [14-motion-timing-and-pulse-safety.md](14-motion-timing-and-pulse-safety.md) | **DEFERRED task:** reed departure asymmetry + cross-device pulse-timing race (Q-16) |
| [15-garage-i4-observation.md](15-garage-i4-observation.md) | In-garage **i4-only** signal-capture session (observe-only) → input data for Q-02/Q-03/Q-16 |

One-page system overview: [../ARCHITECTURE.md](../ARCHITECTURE.md).
Source hardware design: [../initial-research/hardware-spec.md](../initial-research/hardware-spec.md).
Reference build lessons: `private/NEW-PROJECT-GUIDE.md` (gitignored).
