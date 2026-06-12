#!/usr/bin/env python3
# Host unit test for the Pico door_sim "virtual EcoStar" state machine. Mocks MicroPython's `machine`/`time`
# so the LOGIC (D-09 alternation, movement phases, end-of-travel kick) is validated deterministically off
# the hardware. Run: python3 device/test-rig/test_door_sim.py   (exit 0 = pass).
import sys, os, types, importlib.util

# --- fake MicroPython modules, injected before importing door_sim ---
machine = types.ModuleType("machine")
class Pin:
    OUT = 1; IN = 0; PULL_DOWN = 2
    def __init__(self, gpio, mode=None, pull=None, value=0): self._v = value
    def value(self, v=None):
        if v is None: return self._v
        self._v = 1 if v else 0
machine.Pin = Pin
sys.modules["machine"] = machine

ftime = types.ModuleType("time")
ftime._clock = 0
ftime.ticks_ms = lambda: ftime._clock
ftime.ticks_diff = lambda a, b: a - b
ftime.sleep_ms = lambda ms: None
sys.modules["time"] = ftime

spec = importlib.util.spec_from_file_location("door_sim", os.path.join(os.path.dirname(__file__), "door_sim.py"))
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)   # __name__ != "__main__", so run() is NOT entered

# --- helpers ---
def pins():
    return tuple(ds._pin[n].value() for n in (1, 2, 3, 4))   # (SW1 closed, SW2 open, SW3 opening, SW4 closing)

def reset(state="CLOSED", last_dir="closing"):
    ds.state = state; ds.phase = "rest"; ds.last_dir = last_dir
    ftime._clock = 0; ds._t0 = 0
    pat = {"CLOSED": (1, 0, 0, 0), "OPEN": (0, 1, 0, 0)}.get(state, (0, 0, 0, 0))
    ds._set(*pat)

def settle(target, max_steps=400):
    """Advance the fake clock in 50 ms steps, ticking, until the door reaches `target` at rest."""
    for _ in range(max_steps):
        if ds.state == target and ds.phase == "rest":
            return
        ftime._clock += 50
        ds.tick()
    raise AssertionError("stuck at %s/%s, wanted %s" % (ds.state, ds.phase, target))

PASS = 0
def check(name, cond):
    global PASS
    if cond: PASS += 1; print("ok   -", name)
    else: print("FAIL -", name); sys.exit(1)

# --- tests ---
# 1. impulse from CLOSED -> OPENING, departure overlap holds the closed reed + motor-opening
reset("CLOSED")
ds.handle_impulse()
check("CLOSED + impulse -> OPENING/depart", ds.state == "OPENING" and ds.phase == "depart")
check("depart asserts closed-reed + motor-opening (SW1,SW3)", pins() == (1, 0, 1, 0))
settle("OPEN")
check("OPENING completes -> OPEN", ds.state == "OPEN")
check("OPEN asserts open-reed only (SW2)", pins() == (0, 1, 0, 0))
check("last_dir is opening after opening", ds.last_dir == "opening")

# 2. impulse while moving STOPS (direction-aware); reeds + motors all released
reset("CLOSED")
ds.handle_impulse()          # OPENING
ds.handle_impulse()          # stop
check("impulse while OPENING -> STOPPED_OPENING", ds.state == "STOPPED_OPENING")
check("stopped asserts nothing (mid-travel)", pins() == (0, 0, 0, 0))

# 3. alternation: from a STOPPED state, one impulse starts the OPPOSITE of the last direction (= reverse)
ds.handle_impulse()          # STOPPED_OPENING (last=opening) -> reverse -> CLOSING
check("STOPPED_OPENING + 1 impulse -> CLOSING (reverse = 1 pulse)", ds.state == "CLOSING")

# 4. the STOPPED 'continue' costs 3 impulses (matches the controller's 3-pulse path) and ends up OPENING
reset("CLOSED")
ds.handle_impulse()          # OPENING
ds.handle_impulse()          # STOPPED_OPENING
ds.handle_impulse()          # -> CLOSING   (pulse 1 of the continue dance)
ds.handle_impulse()          # -> STOPPED_CLOSING (pulse 2)
ds.handle_impulse()          # -> OPENING   (pulse 3) — continuing the original open
check("3 impulses continue STOPPED_OPENING back to OPENING", ds.state == "OPENING")

# 5. full close cycle from OPEN
reset("OPEN", last_dir="opening")
ds.handle_impulse()          # OPEN (last=opening) -> reverse -> CLOSING
check("OPEN + impulse -> CLOSING", ds.state == "CLOSING")
settle("CLOSED")
check("CLOSING completes -> CLOSED", ds.state == "CLOSED")
check("CLOSED asserts closed-reed only (SW1)", pins() == (1, 0, 0, 0))

# 6. end-of-travel kick is brief and the arrive phase carries the end reed (gate must not glitch it)
reset("CLOSED")
ds.handle_impulse()          # OPENING
# walk to the arrive phase and confirm the open reed is already asserted with a brief closing kick
for _ in range(200):
    ftime._clock += 50; ds.tick()
    if ds.state == "OPENING" and ds.phase == "arrive": break
check("OPENING/arrive asserts open-reed + brief closing-kick (SW2,SW4)", pins() == (0, 1, 0, 1))

print("\nALL %d door_sim logic checks passed" % PASS)
