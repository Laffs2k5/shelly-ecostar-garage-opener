# 14 — Motion timing & pulse safety (DEFERRED design task)

> **Status: NOT YET IMPLEMENTED.** This captures a known correctness gap so we can implement it to
> bullseye later **without** iterating on the real garage door (hardware testing there is painful).
> Approach: **write the tests first (they fail against today's code), then fix the code, then evaluate
> regression coverage.** Tracked as **Q-16** (spec 08) and a Phase-7 task (spec 09).

## Why this exists

The reeds we're using (mrsmart MR-00326, closed-loop NC) have a **large operating window — ~5 cm in
free air** (will shrink once mounted on the steel door — Q-13/Q-02). So a reed reports "in the end
zone" across several cm of travel, not at a point. That width exposes two timing problems the current
logic gets wrong. Both stem from the same physics: **a reed tells you *position zone*; only the motor
signal tells you what the door is doing *right now*.**

## Problem 1 — `derive()` departure asymmetry (i4 monitor)

`derive()` ([device/monitor.js](../../device/monitor.js)) checks **reeds before motor direction**, so a
reed unconditionally wins. That is correct when *arriving* at an end, wrong when *departing*:

| Window | Inputs | Reality | Today | Want |
|---|---|---|---|---|
| Arriving closed | `c=1, cl=1` | seating into closed | CLOSED ✅ | CLOSED |
| **Departing closed** | `c=1, op=1` | leaving closed, opening | **CLOSED ❌** | **OPENING** |
| Arriving open | `o=1, op=1` | seating into open | OPEN ✅ | OPEN |
| **Departing open** | `o=1, cl=1` | leaving open, closing | **OPEN ❌** | **CLOSING** |

For the whole ~5 cm of initial travel the monitor reports the *old* end-state. Existing tests
([monitor.test.js:12-13](../../device/test/monitor.test.js#L12-L13)) only cover the arriving cases,
which is why this is invisible today. Spec 02's "reeds win resolves the overlap" claim is therefore
**incomplete** — it only holds for arrival.

**Fix (pure, no timers):** make motor-direction the tiebreaker over a reed *only when they disagree*:

```js
if (c && !op) return CLOSED;   // at closed, not being driven open
if (o && !cl) return OPEN;     // at open,  not being driven closed
if (op) return OPENING;        // c && op => departing closed
if (cl) return CLOSING;        // o && cl => departing open
```

All existing arrival tests still pass (their "away" motor signal is off, so the reed still wins).

> **⚠ Refined by garage observation 2026-06-10 (HW-VALIDATION) — the fix above is INCOMPLETE.** The
> EcoStar does a **~140–220 ms reverse motor pulse at each end-of-travel** (n=2 catches), which **is opto-visible**:
> at the close seat the sequence is `1001 → 1010 → 1000` — i.e. **`c=1 & op=1` for ~140 ms** at arrival.
> That's the *same input pattern as a departure*, so the naive `c && !op` rule would glitch
> `CLOSED → OPENING` on **every** close. Distinguish them by **duration**: the end-reverse is
> **140–220 ms (n=2)**; a real departure holds the reed engaged **~500–780 ms** (measured). **So the
> tiebreaker must be time-gated:** only let an opposite-direction motor signal override an engaged reed
> once it has **persisted past the gate** (gap now ~**220 → 510 ms**). Below that, the reed still wins (it's the
> arrival relief-kick, still at that end). Make the gate a config tunable; unit-test with the 140 ms blip
> as an explicit case that must NOT flip the state.
>
> **Margins — these are small-sample observations, NOT statistics.** n=2 for the reverse (140 ms, 220 ms —
> already a 57% spread!), n≈3–4 for departures (0.51–0.78 s). We have no opportunity for repeated/statistical
> measurement, so **choose thresholds with safety margin *inside* the ~220 → 510 ms gap, not tuned to the
> measured points** — the reverse could run longer and a departure shorter than what we happened to catch
> (the 2nd reverse was already 57% longer than the 1st). Pick the gate with headroom both ways (~300–350 ms
> in the narrowed band), keep it **config-tunable**, and treat every timing constant
> here (gate, `REST_GUARD_MS`, `PULSE_GAP_MS`, debounce) as **provisional — widen/re-confirm at
> commissioning**. Prefer conservative margins over tight fits everywhere.

> **✅ IMPLEMENTED 2026-06-10 (monitor, Problem 1 only).** `derive()` takes a `gateMet` arg; the tick
> loop counts consecutive ticks of the conflict `(c&&op)||(o&&cl)` and sets `gateMet` once it persists
> `GATE_TICKS`. Chose **`GATE_TICKS = 4` (≈400 ms)** — integer-tick granularity (100 ms), 4 over 3 for
> margin above the 220 ms reverse; consequence is asymmetric (too-low glitches every close; too-high just
> leaves a brief stale-CLOSED that self-corrects when the reed releases). Still provisional / should become
> config-tunable. Unit + tick-loop tests added; **bench-validated** (200 ms kick → stays CLOSED; sustained
> opening → OPENING). **Problems 2 & 3 below remain TODO.**

## Problem 2 — pulse-timing race across the two devices (the hard one)

EcoStar impulse semantics (D-09): **a pulse to a *moving* door = STOP; a pulse to a *stopped* door =
START in the reverse of its last direction.** So a pulse's meaning depends entirely on whether the
motor is moving at the instant it lands.

**The race:** user issues *Open* while the picture says `CLOSED`, but the door was only *almost* closed
— still finishing its close travel (motor moving, reed already in the 5 cm zone), or just-arrived but
not yet mechanically settled. The controller fires its naive **1 pulse** (open@CLOSED, D-19) → the
EcoStar, seeing a *moving* door, reads it as **STOP** → the door **halts just shy of closed** instead
of opening. Symmetric at the open end.

**Design principle (user):** before sending the *initiate-motion-from-an-end* pulse, **wait until the
door is genuinely at rest at that end — both the reed engaged AND the motor signals inactive AND
settled** for a short guard. If the door is still moving, don't fire the naive pulse; apply
moving-door semantics (suppress, or 2-pulse stop-then-reverse) per actual motion.

### The cross-device wrinkle

- The **i4** owns live truth (reeds + motor + derived state + moving/at-rest).
- The **S1** owns commands and pulse decisions but acts on the **latest *pushed* picture** from the i4
  (HTTP POST + MQTT), which can be slightly stale and carries no "settled at rest" guarantee.
- The **i4 knows nothing about pending commands.** So the coordination has to live in the *data* the
  i4 publishes, not in a request/response handshake.

### Good news: the data is (almost) already there

The pushed picture is `{state, dir, inputs:{c,o,op,cl}, since, ts, v}`
([controller.js](../../device/controller.js) stores it in `DOOR`). So the controller can already derive:

- **moving** = `inputs.op || inputs.cl`
- **settled duration** = `ts - since` (how long the current state has held)

**Proposed approach (both pure & unit-testable, no real-door iteration):**
1. **Monitor:** apply the Problem-1 fix. Optionally add an explicit `moving` bool to the payload for
   clarity (don't *rely* on adding it — `op||cl` already works; keep the heartbeat field contract
   intact, [monitor.test.js](../../device/test/monitor.test.js) asserts the keys).
2. **Controller:** extend `pulsesFor(cmd, state)` → `pulsesFor(cmd, picture)` where `picture` carries
   `state`, `moving`, and `settledMs`. New rule for directional commands that would *initiate from an
   end*: require `state == CLOSED/OPEN && !moving && settledMs >= REST_GUARD_MS`. If `moving`, route to
   the moving-door branch (suppress when already going the right way; 2-pulse reverse when wrong way).
   Keep the D-19 **UNKNOWN → 1 best-effort pulse** escape (i4 down/boot must still allow control).
3. `REST_GUARD_MS` is a small tunable (start ~300–500 ms; the EcoStar is slow). Make it config-driven
   so it can be tuned at install without reflashing (ties into the existing "tunables via config" plan
   item).

## Problem 3 — no minimum spacing between *separate* commands (pulse coalescing)

We enforce a gap *within* a stop-then-reverse (`PULSE_GAP_MS = 1200`, [controller.js:23](../../device/controller.js#L23)),
and each pulse is 0.5 s (`auto_off_delay`). But `handleCommand` calls `pulseSeq` **immediately on every
command** ([controller.js:119-122](../../device/controller.js#L119-L122)) with **no rate-limit between
separate commands**. Consequences when commands arrive close together (fast double-tap, app+MQTT racing,
retries):
- Pulses can land closer than the EcoStar's slow logic can resolve as two distinct impulses.
- A 2nd `Switch.Set(on)` while the 0.5 s `auto_off` is still pending **extends the closure into one long
  pulse** → the EcoStar sees a *single* impulse, not two.

**Fix:** a **post-pulse lockout** on the controller — after firing, ignore (or briefly queue) further
commands for `≥ pulse_len + PULSE_GAP_MS + margin`, so every impulse the opener receives is cleanly
spaced and atomic. Pure + testable; reuses the same config tunable as `REST_GUARD_MS`. Heartbeat could
expose a `locked`/`busy` flag so clients don't double-fire.

## Test strategy (write these FIRST — they should fail against today's code)

**Monitor (`derive` + tick loop):**
- Departing-closed: `c=1, op=1` ⇒ `OPENING` (and the reverse: `o=1, cl=1` ⇒ `CLOSING`).
- Confirm arriving cases unchanged (regression): `c=1, cl=1`⇒CLOSED, `o=1, op=1`⇒OPEN.
- Full-cycle through the tick loop with the 5 cm overlap modelled: CLOSED → (c&op) OPENING → (op) →
  (o&op) OPEN → (o&cl) CLOSING → (c&cl) CLOSED, asserting the departure edges flip immediately.

**Controller (introduce TIME as a factor — this is the key new dimension):**
- "Almost closed" race: drive a sequence where state reads `CLOSED` but `inputs.cl` still true (or
  `settledMs < guard`), inject *Open* at that instant, assert **0 pulses** (or the moving-door action),
  **not** the naive 1 pulse that would halt the door.
- At-rest case: same command after `!moving && settledMs >= guard` ⇒ the correct **1 pulse**.
- Symmetric "almost open" + *Close*.
- Guard boundary: command at `settledMs == guard-ε` vs `guard+ε`.
- The controller test harness already has `tick`/`sendCmd`; extend it to advance simulated time and set
  the door picture (state + inputs + since/ts) independently, so a command can land mid-transition.
- **Lockout (Problem 3):** two commands within the lockout window ⇒ the 2nd is ignored/queued (assert
  only one pulse sequence fired); a command after the window ⇒ fires normally. Assert the relay is never
  re-`Set(on)` while a pulse's `auto_off` is still pending (no coalescing into one long pulse).

## Regression coverage to evaluate when implementing

- The full 13-case door matrix still derives correctly (HW-VALIDATION 2026-06-07).
- D-19 pulse table intact: toggle=1; suppress-when-already-there/going; 2-pulse stop+reverse when
  moving the wrong way; **UNKNOWN ⇒ 1 best-effort pulse** still works (don't let the at-rest guard
  block control when the i4 is down — `moving`/`settledMs` unknown must fall back to best-effort).
- Heartbeat field contract unchanged (or additively extended) — the app/web parse it.
- Both command transports (HTTP POST + MQTT) honour the new guard identically.
- Suppression latency: the guard adds up to `REST_GUARD_MS` before a legitimate end-pulse — confirm
  that's acceptable (EcoStar is slow; a few hundred ms is nothing).

## Hardware dependency

Problem 1's fix assumes the **motor-direction opto is active throughout the initial departure** (the
first cm while the reed is still engaged). Almost certainly true (the motor energises immediately) —
**we engineer for it** — but it's exactly what **Q-02** (motor→opto on the real door) will confirm.
If the opto only blips at start rather than holding while moving, revisit Problem 2's `moving`
detection. Likewise the real (post-mount) reed window from **Q-13/Q-02** sets how wide these overlap
zones actually are.
