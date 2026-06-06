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

Source hardware design: [../initial-research/hardware-spec.md](../initial-research/hardware-spec.md).
Reference build lessons: `private/NEW-PROJECT-GUIDE.md` (gitignored).
