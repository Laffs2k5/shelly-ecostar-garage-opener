# i4 input simulator — runs on a Raspberry Pi Pico (MicroPython), drives 4 channels that stand in for
# the Shelly Plus i4 DC's four inputs (SW1..SW4). Each Pico GPIO drives one isolation element (relay or
# optocoupler — see docs/spec/12) whose contact asserts the corresponding i4 input.
#
# Convention: GPIO HIGH = channel ASSERTED ("contact closed" / signal present). The i4's own `invert`
# config maps assert->logical sense per input (e.g. NC reeds). So this sim is polarity-agnostic.
#
# Channel -> i4 input mapping (door semantics, see docs/spec/02):
#   SW1 = reed CLOSED     SW2 = reed OPEN     SW3 = motor OPENING     SW4 = motor CLOSING
#
# This file is deployed as main.py so it runs at boot and leaves the REPL free. The host (WSL) drives it
# with: mpremote ... exec "sw(3,1)"  /  "set_opening()"  /  "state()"  — globals below persist.

from machine import Pin
import time

CHAN_GPIO = {1: 2, 2: 3, 3: 4, 4: 5}     # SWn -> Pico GPn
_pin = {n: Pin(g, Pin.OUT, value=0) for n, g in CHAN_GPIO.items()}
_led = Pin(25, Pin.OUT, value=0)          # onboard LED = activity blip

def _blip():
    _led.value(1); time.sleep_ms(20); _led.value(0)

def state():
    """Current asserted channels as {1..4: 0/1}. Printed so the host can parse it."""
    s = {n: _pin[n].value() for n in CHAN_GPIO}
    print("STATE", s)
    return s

def sw(n, v):
    """Assert (v=1) or release (v=0) channel n (1..4)."""
    _pin[n].value(1 if v else 0); _blip(); return state()

def alloff():
    for n in CHAN_GPIO: _pin[n].value(0)
    return state()

# --- door scenario primitives (set the channel pattern for a door state) ---
def set_closed():  alloff(); _pin[1].value(1); _blip(); return state()   # SW1
def set_open():    alloff(); _pin[2].value(1); _blip(); return state()   # SW2
def set_opening(): alloff(); _pin[3].value(1); _blip(); return state()   # SW3
def set_closing(): alloff(); _pin[4].value(1); _blip(); return state()   # SW4
def set_stopped(): alloff(); _blip(); return state()                     # none (mid-travel)

def pulse(n, ms=200):
    """Momentary assert of channel n for ms milliseconds (for transient/edge tests)."""
    _pin[n].value(1); time.sleep_ms(ms); _pin[n].value(0); return state()

# --- timed scenario sequences (run ON the Pico for precise sub-tick timing; the host link is too
#     laggy). Each step is (pattern, dwell_ms); pattern is the set of channels to hold during the dwell.
#     Replays the real-door timings measured at the garage 2026-06-10 (spec 15 / HW-VALIDATION), so the
#     i4's gate logic (Q-16) is exercised with realistic timing. Watch devices/.../heartbeat to assert. ---
def _seq(steps):
    for pat, ms in steps:
        for n in CHAN_GPIO: _pin[n].value(1 if (n in pat) else 0)
        time.sleep_ms(ms)
    _blip(); return state()

def close_arrival(kick_ms=180, overlap_ms=850):
    """Realistic CLOSE arrival ending with the EcoStar relief reverse-kick (brief OPENING blip).
       Expect i4: ... -> CLOSING -> CLOSED, with NO OPENING when kick_ms < gate (~400ms)."""
    return _seq([((4,), 400), ((4, 1), overlap_ms), ((1, 3), kick_ms), ((1,), 100)])

def open_arrival(kick_ms=180, overlap_ms=750):
    """Realistic OPEN arrival ending with the reverse-kick (brief CLOSING blip)."""
    return _seq([((3,), 400), ((3, 2), overlap_ms), ((2, 4), kick_ms), ((2,), 100)])

def depart_closed(overlap_ms=650):
    """Leave CLOSED: opening motor starts, closed reed held through the departure overlap, then releases.
       Expect i4: CLOSED -> OPENING (once opposite motor persists past the gate)."""
    return _seq([((1,), 300), ((1, 3), overlap_ms), ((3,), 400)])

def depart_open(overlap_ms=550):
    """Leave OPEN: closing motor starts, open reed held through the overlap, then releases."""
    return _seq([((2,), 300), ((2, 4), overlap_ms), ((4,), 400)])

print("simrig ready:", {n: g for n, g in CHAN_GPIO.items()}, "(GPIO HIGH = asserted)")
state()
