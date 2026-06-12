# 02 — Door state machine

Lives on the **i4 (monitoring unit)**. Derived from four dry-contact inputs.

## Inputs

| Input | Signal | Source | Sense |
|---|---|---|---|
| SW1 | Door CLOSED | Reed at floor | NC — closed when magnet present (door shut) |
| SW2 | Door OPEN | Reed at top of travel | NC — closed when magnet present (door open) |
| SW3 | Motor OPENING | Optocoupler 1 | Closed while motor drives +V |
| SW4 | Motor CLOSING | Optocoupler 2 | Closed while motor drives −V |

NC reeds are fail-safe: a broken wire reads "not in position" rather than a false "in position".

## States

| State | Meaning | Primary derivation |
|---|---|---|
| `CLOSED` | Fully closed | SW1 active |
| `OPEN` | Fully open | SW2 active |
| `OPENING` | Moving toward open | SW3 active |
| `CLOSING` | Moving toward closed | SW4 active |
| `STOPPED_OPENING` | Stopped mid-travel, last motion was opening | no motor signal, no reed, last dir = open |
| `STOPPED_CLOSING` | Stopped mid-travel, last motion was closing | no motor signal, no reed, last dir = close |
| `UNKNOWN` | Bootstrap / no data yet | power-on default |

> Note: this refines the original hardware-spec's single `STOPPED_MID` into two states
> (`STOPPED_OPENING` / `STOPPED_CLOSING`), per the user's role description, so the controller can
> decide the *next* useful pulse. The split needs the i4 to remember the last travel direction.

## Rules

1. **Reeds win.** SW1/SW2 are ground truth for end positions, regardless of motor tracking.
2. **Direction from motor sense.** SW3 ⇒ opening, SW4 ⇒ closing. When the motor stops mid-travel,
   the state becomes `STOPPED_OPENING`/`STOPPED_CLOSING` based on the last active direction.
3. **Bootstrap = UNKNOWN.** Wait for any reed or motor event before asserting a state.
4. **Safety reversal.** If `CLOSING` and SW3 (opening) activates without a stop, the EcoStar has
   reversed; reeds resolve the final position.
5. **Manual (cord-pull) moves** produce no motor signal; reeds still catch end positions. Mid-travel
   by hand is invisible — accepted edge case.

## Signal overlap & transients (nuance)

Inputs are **not** mutually exclusive instantaneously — expect transient windows where two signals are
active at once:

- **Reed-then-motor-coast:** as the door reaches an end position the reed (SW1/SW2) triggers, but the
  EcoStar may drive the motor a little longer before disengaging — so SW4 (CLOSING) can still be active
  for a short window *after* SW1 (CLOSED) goes active. Symmetrically for SW2/SW3 at the open end.
- **Motor spin-down / contact bounce:** SW3/SW4 may flicker briefly as the H-bridge relays release,
  and reed contacts can bounce.

**Reeds win on *arrival*** — the moment SW1 is active during a *close* (lingering SW4) the door **is**
`CLOSED`, and likewise SW2 ⇒ `OPEN` over a lingering SW3. The point is an **implementation** one, called
out so the i4 script handles it deliberately rather than glitching through a spurious state:

> ⚠️ **Arrival vs departure.** With the real MR-00326 reed's wide ~5 cm window, "reed active + motor
> driving *away* from that end" (e.g. SW1 still active + SW3 opening, just after leaving closed) is a
> *departure* — there the reed reading is stale and the motor direction is the truth. **Fixed (Q-16):**
> `derive()` uses a **time-gated motor-direction tiebreaker** (`GATE_TICKS`, ~400 ms — a brief reverse-kick
> is absorbed, a sustained departure flips the state). See
> [14-motion-timing-and-pulse-safety.md](14-motion-timing-and-pulse-safety.md). Hardware-validated
> 2026-06-10; the exact gate is provisional/tunable pending commissioning.

- Evaluate state from the **full input snapshot** with reed precedence, not from "whichever edge fired
  last" — otherwise a CLOSED→(SW4 still on) read could momentarily emit `CLOSING` right after arrival.
- **Debounce** reed and optocoupler edges (short settle, e.g. tens of ms — tune on the Pico rig), and
  prefer a brief settle before publishing a state change, so coast/bounce doesn't produce a flurry of
  MQTT/HTTP updates.
- The Pico rig **replays these overlaps on purpose** (reed asserts while motor signal is still on; motor
  flicker on release) as test cases — done on-device (`main.py` timed scenarios + `door_sim.py`).

(Debounce + the gated overlap handling are implemented and hardware-validated 2026-06-10; see
[08-decisions-and-open-questions.md](08-decisions-and-open-questions.md) Q-16. Final confidence on the
real motor is the Q-02 commissioning item.)

## Transitions

```mermaid
stateDiagram-v2
    [*] --> UNKNOWN: power on
    UNKNOWN --> CLOSED: SW1
    UNKNOWN --> OPEN: SW2
    UNKNOWN --> OPENING: SW3
    UNKNOWN --> CLOSING: SW4

    CLOSED --> OPENING: SW3
    OPENING --> OPEN: SW2
    OPENING --> STOPPED_OPENING: motor stops, no reed

    OPEN --> CLOSING: SW4
    CLOSING --> CLOSED: SW1
    CLOSING --> STOPPED_CLOSING: motor stops, no reed
    CLOSING --> OPENING: safety reversal (SW3)

    STOPPED_OPENING --> OPENING: SW3
    STOPPED_OPENING --> CLOSING: SW4
    STOPPED_CLOSING --> CLOSING: SW4
    STOPPED_CLOSING --> OPENING: SW3
```

## Controller use of state (on S1)

### Impulse model (confirmed — D-09)

The EcoStar has no "open"/"close" notion. Each impulse just advances a fixed cycle:

```
… MOVING(dir) ──[pulse]──► STOPPED ──[pulse]──► MOVING(opposite dir) ──[pulse]──► STOPPED …
```

- **One pulse to a moving door = STOP** it ("stop what you're doing").
- **One pulse to a stopped door = START in the *opposite* direction to its last movement** ("reverse").
- The unit **alternates direction on each start**, so reversing a moving door takes **two pulses**
  (stop, then reverse) with a **deliberate delay between them** — the unit must register them as
  distinct presses. Tune the delay on the bench (Phase 1.3).

So S1 maps `command + current door state` to a pulse sequence:

As-built in `controller.js` (`pulsesFor`), default `resumeSameDir:false`:

| Command | Door state | Pulse sequence | Result |
|---|---|---|---|
| open | CLOSED | 1 pulse | OPENING |
| open | STOPPED_CLOSING | 1 pulse | OPENING (reverse of last move) |
| open | CLOSING | pulse · **delay** · pulse (2) | stop → OPENING |
| open | OPENING, OPEN | none — **suppress** | already going / there |
| open | STOPPED_OPENING | **3 pulses** (reverse→stop→start) | resume OPENING (1 if `resumeSameDir`) |
| close | OPEN | 1 pulse | CLOSING |
| close | STOPPED_OPENING | 1 pulse | CLOSING (reverse of last move) |
| close | OPENING | pulse · **delay** · pulse (2) | stop → CLOSING |
| close | CLOSING, CLOSED | none — **suppress** | already going / there |
| close | STOPPED_CLOSING | **3 pulses** (reverse→stop→start) | resume CLOSING (1 if `resumeSameDir`) |
| stop | OPENING, CLOSING | 1 pulse | STOPPED_* |
| stop | not moving | none — **suppress** | nothing to stop |
| toggle | any | 1 pulse (best-effort) | advance the cycle |
| open/close | UNKNOWN | 1 pulse (best-effort, **fail-open** D-19) | act rather than freeze |

### Multi-pulse execution (as-built)

The implemented path is a **timed rolling sequencer** (`pulseSeq`/`pulseStep`, fixed `PULSE_GAP_MS`): for
the 2- and 3-pulse cases it fires the pulses blind at the bench-tuned gap, because the i4 may be offline
(D-10). A full sequence is **pulse-locked** (no new command interrupts it). See spec 14 for the timings.

### STOPPED-resume (Q-03 — mechanism done, physical model is a real-door item)

"Resume the same direction" from a STOPPED state isn't a single pulse: the unit's next start always
*reverses*, so continuing takes the **3-pulse dance** (reverse → stop → start) — hardware-validated
2026-06-11 (relay edge-count = 3). It's tunable: `resumeSameDir:true` (KVS `logic_cfg`) flips which of
continue/reverse costs 1 vs 3 pulses. The only open item is the *physical* alternation-vs-resume question
on the **real door** (Q-03, Phase 8) — the controller mechanics are complete.
