# 08 — Decisions & open questions

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D-01 | Two-device role split: i4 = monitoring, S1 = controlling | i4 is the only device wired to sensors; S1 owns the relay + command logic |
| D-02 | Door **state machine lives on the i4**, not S1 (differs from the original hardware-spec §4) | First-hand sensor truth; derive + broadcast without a round-trip. S1 consumes the picture |
| D-03 | i4→S1 over **HTTP-direct**; MQTT is an additional broadcast, not the inter-device link | Latency + broker-independence (NEW-PROJECT-GUIDE §1 lesson) |
| D-04 | Core control (button, RF) never depends on WiFi/MQTT | Safety; garage is a security device |
| D-05 | Keep retained `heartbeat` **and** non-retained `mon/alive`; monitor watches only `alive` | Reference spec 11 §4.1; avoids dead-device resurrection (HA #148860) |
| D-06 | Repo starts **private**, no-hardcoded-identity discipline from day one | Eases going public later without a scrub (guide §6/§9) |
| D-07 | Split `STOPPED_MID` into `STOPPED_OPENING` / `STOPPED_CLOSING` | Controller needs last direction to choose the next useful pulse |
| D-08 | Unit is **EcoStar** (Hörmann). "eurostar" in repo dir / PDF is a typo — don't propagate | User confirmed |
| D-09 | EcoStar impulse = **stop-then-reverse**: 1 pulse stops a moving door; a 2nd pulse (after a delay) reverses it. Unit alternates direction each start | User-confirmed Q-03 |
| D-10 | **i4 never blocks/fails on S1 being unreachable** — its HTTP POST to S1 is fire-and-forget; i4 still publishes to MQTT and carries on | User Q-06 |
| D-11 | Remote open/close does **not** require visual confirmation; a camera check is a possible future addition, not a gate | User Q-04 |
| D-12 | This project's job is to **expose rich door status** (state, duration, time-of-day) on the heartbeat; alerting decisions belong to HA, not us | User Q-05 |
| D-13 | Repo + working dir renamed to **ecostar** | User Q-07 |

## Open questions

| # | Question | Notes |
|---|---|---|
| Q-01 | i4 firmware version + exact Input component event model? | Confirm `input:0..3` push/toggle semantics on the real device before writing the script |
| Q-02 | Confirm motor-voltage / optocoupler behaviour on the bench | hardware-spec measured ±19–24V; verify SW3/SW4 actually toggle cleanly |
| Q-03 | ~~Impulse stop/reverse semantics~~ | RESOLVED → D-09. Remaining bench item: the `STOPPED_OPENING`+open / `STOPPED_CLOSING`+close "resume same direction" edge (next start reverses) — confirm pulse count on hardware (spec 02) |
| Q-04 | ~~Visual confirmation for remote close~~ | RESOLVED → D-11 (not required; possible future) |
| Q-05 | ~~Monitor door-state alerts~~ | RESOLVED → D-12 (we expose status; HA decides alerts) |
| Q-06 | S1 static IP reservation (suggest .161) + hostname | Open — not yet on network. Non-blocking: i4 tolerates S1 absence (D-10) |
| Q-07 | ~~Repo name~~ | RESOLVED → D-13 (renamed to ecostar) |
| Q-08 | ~~LICENSE choice~~ | RESOLVED: none for now (private repo); revisit if it goes public |

## Flagged design tensions vs. source docs

- **Original hardware-spec §1/§4** places the state machine on S1 and uses Shelly Cloud for the phone.
  We moved state to the i4 (D-02) and adopted the local-broker + cloud-bridge stack (matching
  mqtt-leiflan + the monitor spec). The hardware-spec remains the authority on **wiring/BOM/circuits**;
  this spec/ folder is the authority on **software architecture**.
