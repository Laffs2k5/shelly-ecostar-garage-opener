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
| D-14 | i4 inputs run as type **`switch`** (level), not `button` — door sensing is level-based; Plug-S button quirk N/A | Confirmed on fw 1.7.5 (spec 10) |
| D-15 | MQTT identities (CN) = **`garage-monitor`** (i4) and **`garage-controller`** (S1) | User Q-11: clean topics, no MAC leak, role-named for the garage |
| D-16 | i4 inputs are **switch-to-`−`** (active when `SWn` pulled to ground); use **`invert:false`** | Official i4 DC diagram (spec 12); matches hardware-spec. NC reed broken-wire → floats to `+` → reads inactive = fail-safe |
| D-17 | Test rig = **Pico (MicroPython) → 4× PS2501 optos → i4 inputs**, driven from WSL via `mpremote resume` | Isolated (5 V never hits the Pico), on-hand parts, faithful to the real motor-sense optos (spec 12) |
| D-18 | Of the 4 rig optos, **2 are permanent** (SW3/SW4 motor-sense — solder, dual-use) and **2 are test-only** (SW1/SW2 reed sims — breadboard, replaced by real reeds at install) | Final install has only 2 optos (D from hardware-spec §3.3/§3.4); the permanent pair's i4 side never changes, only the LED side rewires Pico→motor (spec 12) |
| D-19 | Controller command→pulse: `toggle`=always 1 pulse; directional commands suppress when already there/going, 1 pulse from the matching end/stop, 2 pulses (stop+reverse) when moving the wrong way, and **1 best-effort pulse when door state is UNKNOWN** | Mirrors the physical button; UNKNOWN (i4 down/boot) still lets remote control work. Implemented in `controller.js`, verified on hardware |
| D-20 | Devices are **stateless across reboot** (monitor re-derives from inputs; controller boots relay-off) → the connectivity **watchdog needs no `reset_reason`/resume gate**; it only reboots-to-recover on prolonged Wi-Fi/broker loss | Simpler + safer than the coffee-timer resume gate; watchdog validated on hardware (spec 13) |

## Open questions

| # | Question | Notes |
|---|---|---|
| Q-01 | ~~i4 firmware + Input event model~~ | RESOLVED → D-14. fw 1.7.5; inputs type `switch`, `{id,state:bool}`, `input:N` toggle events (spec 10) |
| Q-02 | Confirm motor-voltage / optocoupler behaviour on the bench | hardware-spec measured ±19–24V; verify SW3/SW4 actually toggle cleanly |
| Q-03 | ~~Impulse stop/reverse semantics~~ | RESOLVED → D-09. Remaining bench item: the `STOPPED_OPENING`+open / `STOPPED_CLOSING`+close "resume same direction" edge (next start reverses) — confirm pulse count on hardware (spec 02) |
| Q-04 | ~~Visual confirmation for remote close~~ | RESOLVED → D-11 (not required; possible future) |
| Q-05 | ~~Monitor door-state alerts~~ | RESOLVED → D-12 (we expose status; HA decides alerts) |
| Q-06 | ~~S1 static IP + hostname~~ | RESOLVED: `192.0.2.161` / `shelly1g3-example`; on network + mTLS-provisioned (spec 11) |
| Q-07 | ~~Repo name~~ | RESOLVED → D-13 (renamed to ecostar) |
| Q-08 | ~~LICENSE choice~~ | RESOLVED: none for now (private repo); revisit if it goes public |
| Q-09 | ~~Disable per-input `factory_reset`?~~ | RESOLVED 2026-06-08: set **`factory_reset:false`** on all 4 i4 inputs via `Input.SetConfig` (a stuck/closed reed at boot can't factory-wipe the device). Device-config (not in script) — re-apply if the i4 is ever factory-reset. `invert:false` per D-16 |
| Q-10 | ~~Keep or disable Shelly Cloud on the devices?~~ | RESOLVED 2026-06-08 — **keep enabled (default)**. User: leave it on. Redundant with the broker→cloud bridge but harmless; no reason to change device config |
| Q-11 | ~~MQTT CN/identity convention~~ | RESOLVED → D-15 (`garage-monitor` / `garage-controller`) |
| Q-12 | ~~Should S1 also subscribe to the i4 heartbeat over MQTT as a fallback when an HTTP push is missed?~~ | RESOLVED 2026-06-08 — **no** (user). HTTP-direct push (D-03) is the inter-device link; not worth the cross-subtree ACL grant + extra surface |
| Q-15 | ~~AP client isolation~~ | RESOLVED 2026-06-08 — **misdiagnosed; it was the phone sleeping** (5-min screen timeout → Wi-Fi power-save → HTTP polls fail → "Offline"). **No isolation/firewall** (user-confirmed; phone `curl`s the i4 fine when awake). HTTP-direct works. On-demand polling stops when backgrounded by design (repeatOnLifecycle, guide §5, no churn); **background/push would need the broker path + a foreground service** (future, like coffee's notification) |
| Q-14 | i4 monitor script CPU ~83% (from the 10 Hz input poll) — **accepted as known** | RAM/heap/FS margins fine, device stable; confirmed real (coffee plug's 30 s-timer script = 0%, spec 13/HW-VALIDATION). Mitigation if needed: **event-driven** inputs (D-14) + slow housekeeping timer, or ~1 Hz poll (~4%, +~2 s latency) |
| Q-13 | ~~**Bench-test at least one real reed switch** (mrsmart **MR-00326**, closed-loop NC) into an i4 input~~ | **RESOLVED 2026-06-09 (HW-VALIDATION).** Reed wired straight to **I1 (SW1)** + **−** (no opto/resistor). Magnet present → input0 `true` → derives **CLOSED**; away → `false`. **4/4 clean on/off cycles, no bounce, no cross-talk.** Polarity = closed-loop → D-16 `invert:false` correct. Done *during* the soak without perturbing it. Part facts: metal ~25×48 mm, 2-wire, ~10 W max, free-air gap **~5 cm** (shrinks on steel — spacers may be needed at install). Remaining: SW2 "open" reed + post-mount gap are Phase-8/Q-02. |
| Q-17 | **Publish device-health flags to MQTT for monitoring** (FUTURE — don't explore yet) — surface things like `Script.GetStatus` `running:false` + `errors`/`error_msg` (e.g. the syntax-error crash found 2026-06-08) so a dead script is visible remotely, not just by polling RPC. | Nuance: a *crashed* script can't publish its own death — the mechanism must be **external** to the script (firmware `status_ntf` on the Script component, a cross-device check, or treat the existing **stale retained heartbeat + `mon/alive` gap** as the implicit "something's wrong" signal the monitor spec already leans on). Scope later. **DONE 2026-06-10:** added **`rssi`** (WiFi signal) to **OUR retained heartbeat** `devices/<id>/heartbeat` (app-status payload, spec 03) on **BOTH i4 and S1** — *not* `mon/<id>/alive` (monitor-spec-bound, D-05, untouched; test enforces this). Additive field, `v` unchanged. Deployed + verified on hardware (i4 −45, S1 −39 on bench). Enables the unattended garage **RSSI survey** (lowest seen −85 dBm; ESP32 drops ~−90). The *crash-flag* part of Q-17 (running:false/errors) remains future. |
| Q-16 | **Motion-timing & pulse safety** (DEFERRED, [spec 14](14-motion-timing-and-pulse-safety.md)) — three timing bugs: (1) `derive()` reports the *old* end-state while *departing* it (reed checked before motor dir); (2) a pulse to an "almost-closed" door is read by the EcoStar as STOP, halting it instead of opening; (3) no minimum spacing between *separate* commands → pulses can coalesce / land too close for the opener to resolve as distinct impulses (post-pulse lockout fix). | **Engineer for it, don't iterate on the real door.** Plan: write failing tests first (incl. **time as a factor** — command landing mid-transition), then fix monitor `derive()` (motor-dir tiebreaker) + controller at-rest guard (`!moving && settledMs >= REST_GUARD`), then eval regression. Data already in the pushed picture (`inputs.op/cl`, `since`/`ts`). Depends on Q-02 (motor opto active *throughout* travel) |

## Flagged design tensions vs. source docs

- **Original hardware-spec §1/§4** places the state machine on S1 and uses Shelly Cloud for the phone.
  We moved state to the i4 (D-02) and adopted the local-broker + cloud-bridge stack (matching
  mqtt-leiflan + the monitor spec). The hardware-spec remains the authority on **wiring/BOM/circuits**;
  this spec/ folder is the authority on **software architecture**.
