# 00 — Overview

## Goal

Smart, safe automation of a **Hörmann EcoStar B** garage door operator (TR10C001 RE, ~2006) using two
Shelly devices, with full galvanic isolation from the opener electronics.

## Scope (v1)

- Remote open/close over local WiFi (and optionally internet via cloud-bridged MQTT).
- Full door state tracking: `CLOSED`, `OPENING`, `OPEN`, `CLOSING`, `STOPPED_OPENING`,
  `STOPPED_CLOSING`, `UNKNOWN`.
- Physical wall button and RF remotes keep working with no WiFi/Shelly/broker dependency.
- Door state published to MQTT for any subscriber (incl. the layer-3 monitor).

## Out of scope / deferred

- Visual confirmation (camera) before remote close — a possible future addition, **not** required for
  remote operation (D-11).
- Obstruction / safety sensing beyond what the EcoStar already enforces.
- Android app & web client — later phases (the device tier comes first).

## Hardware summary

Full detail in [../initial-research/hardware-spec.md](../initial-research/hardware-spec.md). In brief:

- **Shelly 1 Gen3** (230V): dry-contact relay → EcoStar impulse terminals 1+2, auto-off 0.5s, detached mode.
- **Shelly Plus i4 DC** (5V USB): 4 dry-contact inputs — SW1 reed CLOSED, SW2 reed OPEN, SW3 motor
  OPENING (optocoupler), SW4 motor CLOSING (optocoupler).
- **Motor direction sensing**: 2× PS2501-1 optocouplers anti-parallel across the motor leads (5kV
  isolation), giving SW3/SW4.
- **Reed switches**: NC (fail-safe) at floor (CLOSED) and top-of-travel (OPEN).
- **Push button**: momentary NO, parallel with the relay across terminals 1+2 — WiFi-independent.
- Single Cat5/6 run carries impulse pair, motor-sense pair, and both reed pairs.

## Success criteria (device tier)

- i4 derives correct door state for all real transitions (validated on the Pico rig, then hardware).
- i4 state changes reach S1 over HTTP within a low, bounded latency, and reach MQTT subscribers.
- S1 suppresses counterproductive pulses (e.g. "open" while already OPENING).
- Physical button + RF remotes operate the door with the broker and/or WiFi down.
- Boot-to-safe behavior validated against `reset_reason` on the actual firmware.
