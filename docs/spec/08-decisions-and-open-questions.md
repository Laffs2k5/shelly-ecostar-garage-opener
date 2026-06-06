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

## Open questions

| # | Question | Notes |
|---|---|---|
| Q-01 | i4 firmware version + exact Input component event model? | Confirm `input:0..3` push/toggle semantics on the real device before writing the script |
| Q-02 | Confirm motor-voltage / optocoupler behaviour on the bench | hardware-spec measured ±19–24V; verify SW3/SW4 actually toggle cleanly |
| Q-03 | EcoStar impulse semantics while CLOSING/OPENING: does one pulse **stop**, and does reversing need a second pulse? | Determines S1's command→pulse table (spec 02). Bench-test |
| Q-04 | Visual-confirmation design for unattended remote **close** | Gating requirement; close stays manual-only until designed |
| Q-05 | Should the monitor get door-state alerts? If so, via HA automation on the heartbeat (not `mon/`) | Flagged to monitor-spec maintainers (spec 03) |
| Q-06 | S1 static IP reservation (suggest .161) + hostname | Not yet on network |
| Q-07 | GitHub repo name: keep `shelly-eurostar-garage-opener` (matches dir) or correct to `...-ecostar-...`? | Typo vs. churn; decide before going public |
| Q-08 | LICENSE choice | Reference repo has one; add when going public |

## Flagged design tensions vs. source docs

- **Original hardware-spec §1/§4** places the state machine on S1 and uses Shelly Cloud for the phone.
  We moved state to the i4 (D-02) and adopted the local-broker + cloud-bridge stack (matching
  mqtt-leiflan + the monitor spec). The hardware-spec remains the authority on **wiring/BOM/circuits**;
  this spec/ folder is the authority on **software architecture**.
