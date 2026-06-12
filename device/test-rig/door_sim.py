# door_sim.py — Pico "virtual EcoStar" for the bench FINAL-VALIDATION session.
#
# Unlike main.py (host drives each input by hand), this runs AUTONOMOUSLY: it SENSES the S1 impulse pulse
# and drives the i4's SW1..SW4 to mimic a real door responding — but FAST (TRAVEL_MS), like the app's demo
# mode. So the full chain is real, just without the door:
#
#     phone / watch  ->  S1 (relay impulse)  ->  [this Pico]  ->  i4 inputs  ->  i4 derive  ->  phone / watch
#
# It implements the real EcoStar impulse model (D-09): one impulse STOPS a moving door; one impulse to a
# stopped door STARTS it in the OPPOSITE of the last direction (alternation). So the controller's 1 / 2 /
# 3-pulse sequences (open/close/stop, stop-then-reverse, the STOPPED 3-pulse continue) produce the correct
# physical outcome here — a true end-to-end FW + app check. It also reproduces the departure overlap and
# the end-of-travel relief reverse-kick, so the i4's Q-16 gate is exercised.
#
# WIRING (bench only — no real door connected):
#   The S1 relay is a dry contact between terminals 'O' and 'I' (closes ~0.5 s per impulse). Wire it across
#   the Pico's 3V3 and GP15:   Pico 3V3 -> S1 'O' ,  S1 'I' -> Pico GP15 (input, internal pull-down).
#   At rest GP15 is LOW; the relay closure loops 3V3 back to GP15 = HIGH = one impulse. 'O'/'I' are
#   interchangeable. SW1..SW4 = GP2..GP5 as in main.py.
#   (At the real install 'O'/'I' go to EcoStar terminals 1+2, NOT the Pico — this sim is bench-only.)
#
# RUN:  mpremote connect COM5 run device/test-rig/door_sim.py   (streams DOOR transitions to the host so the
#       operator can watch state alongside MQTT). Or deploy as main.py to auto-run at boot for the session.

from machine import Pin
import time

CHAN_GPIO = {1: 2, 2: 3, 3: 4, 4: 5}   # SW1 closed-reed, SW2 open-reed, SW3 motor-opening, SW4 motor-closing
SENSE_GP = 15                          # S1 impulse sense (HIGH while the relay is pulsed)

TRAVEL_MS = 8000     # fast-ish full travel: < real door (~17 s) but > cloud round-trip, so the app doesn't
                     # render bunched/overlapping transitions on the laggy cloud path (bench realism).
DEPART_MS = 600      # reed held while the motor starts (> i4 gate ~400 ms, so the gate detects the departure)
KICK_MS   = 160      # end-of-travel relief reverse-kick (< gate, so it must NOT glitch the end state)
DEBOUNCE_MS = 250    # ignore re-triggers within this window (one ~0.5 s closure = one impulse)

_pin = {n: Pin(g, Pin.OUT, value=0) for n, g in CHAN_GPIO.items()}
_sense = Pin(SENSE_GP, Pin.IN, Pin.PULL_DOWN)
_led = Pin(25, Pin.OUT, value=0)

state = "CLOSED"        # CLOSED OPEN OPENING CLOSING STOPPED_OPENING STOPPED_CLOSING
phase = "rest"          # rest | depart | travel | arrive
last_dir = "closing"    # how we last moved (CLOSED was reached by closing)
_t0 = time.ticks_ms()

def _set(c1, c2, c3, c4):
    _pin[1].value(c1); _pin[2].value(c2); _pin[3].value(c3); _pin[4].value(c4)

def _enter(s, ph):
    global state, phase, _t0
    state = s; phase = ph; _t0 = time.ticks_ms()
    _led.value(1); time.sleep_ms(12); _led.value(0)
    print("DOOR", state, ("" if ph == "rest" else ph))

def _el():
    return time.ticks_diff(time.ticks_ms(), _t0)

def _start_open(from_end):
    global last_dir
    last_dir = "opening"
    if from_end:
        _set(1, 0, 1, 0); _enter("OPENING", "depart")   # closed reed held + motor opening (departure overlap)
    else:
        _set(0, 0, 1, 0); _enter("OPENING", "travel")    # from a stopped mid-travel: motor only

def _start_close(from_end):
    global last_dir
    last_dir = "closing"
    if from_end:
        _set(0, 1, 0, 1); _enter("CLOSING", "depart")    # open reed held + motor closing
    else:
        _set(0, 0, 0, 1); _enter("CLOSING", "travel")

def handle_impulse():
    # Moving -> STOP. At rest -> start in the OPPOSITE of the last direction (D-09 alternation).
    if state == "OPENING":
        _set(0, 0, 0, 0); _enter("STOPPED_OPENING", "rest")
    elif state == "CLOSING":
        _set(0, 0, 0, 0); _enter("STOPPED_CLOSING", "rest")
    elif last_dir == "opening":
        _start_close(state == "OPEN")
    else:
        _start_open(state == "CLOSED")

def tick():
    e = _el()
    if state == "OPENING":
        if phase == "depart" and e >= DEPART_MS:
            _set(0, 0, 1, 0); _enter("OPENING", "travel")          # reed released, still opening
        elif phase == "travel" and e >= TRAVEL_MS:
            _set(0, 1, 0, 1); _enter("OPENING", "arrive")          # open reed + brief closing kick
        elif phase == "arrive" and e >= KICK_MS:
            _set(0, 1, 0, 0); _enter("OPEN", "rest")
    elif state == "CLOSING":
        if phase == "depart" and e >= DEPART_MS:
            _set(0, 0, 0, 1); _enter("CLOSING", "travel")
        elif phase == "travel" and e >= TRAVEL_MS:
            _set(1, 0, 1, 0); _enter("CLOSING", "arrive")          # closed reed + brief opening kick
        elif phase == "arrive" and e >= KICK_MS:
            _set(1, 0, 0, 0); _enter("CLOSED", "rest")

def run():
    _set(1, 0, 0, 0)   # start CLOSED
    _enter("CLOSED", "rest")
    print("door_sim ready: SENSE=GP%d  SW=%s  TRAVEL=%dms" % (SENSE_GP, CHAN_GPIO, TRAVEL_MS))
    prev = _sense.value()
    last_edge = time.ticks_ms()
    while True:
        v = _sense.value()
        if v and not prev and time.ticks_diff(time.ticks_ms(), last_edge) > DEBOUNCE_MS:
            last_edge = time.ticks_ms()
            handle_impulse()
        prev = v
        tick()
        time.sleep_ms(20)

if __name__ == "__main__":   # runs on the Pico (mpremote run / boot main.py); skipped when host-imported for tests
    run()
