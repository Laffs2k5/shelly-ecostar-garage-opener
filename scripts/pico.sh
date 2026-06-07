#!/usr/bin/env bash
# Drive the Pico i4-input simulator from WSL. The Pico's USB is on the WINDOWS side, so we go via
# powershell.exe -> Windows Python -> mpremote -> COM port. State is held on the Pico across calls
# using `mpremote resume` (connect WITHOUT a soft-reset). Run `pico.sh init` once after the Pico is
# (re)powered to get a clean, imported simulator; every other call uses resume so GPIO state persists.
#
# Why this shape (see docs/spec/12): mpremote enters a clean raw REPL that skips main.py at boot and
# soft-resets on each plain connect — which would wipe pin state. `resume` + a cached `import main`
# avoids that.
#
# Usage:
#   scripts/pico.sh init                 # clean start (soft-reset, import, all channels off)
#   scripts/pico.sh state                # print asserted channels
#   scripts/pico.sh set <ch> <0|1>       # assert/release one channel (ch 1..4 = SW1..SW4)
#   scripts/pico.sh closed|open|opening|closing|stopped   # set a door-scenario pattern
#   scripts/pico.sh pulse <ch> [ms]      # momentary assert (transient/edge tests)
#   scripts/pico.sh raw "<python>"       # run arbitrary main.* code
# Env: PICO_PORT (default COM5).
set -euo pipefail
PORT="${PICO_PORT:-COM5}"

run() { # $1 = mpremote args after the port (already a single string)
  powershell.exe -NoProfile -Command "python -m mpremote connect $PORT $1" 2>&1
}
ex()  { run "resume exec 'import main; $1'"; }   # state-preserving call

cmd="${1:-state}"; shift || true
case "$cmd" in
  init)     run "exec 'import main; main.alloff()'" ;;        # NO resume -> fresh
  state)    ex "main.state()" ;;
  set)      ex "main.sw($1,$2)" ;;
  closed)   ex "main.set_closed()" ;;
  open)     ex "main.set_open()" ;;
  opening)  ex "main.set_opening()" ;;
  closing)  ex "main.set_closing()" ;;
  stopped)  ex "main.set_stopped()" ;;
  pulse)    ex "main.pulse($1, ${2:-200})" ;;
  raw)      ex "$1" ;;
  *) echo "usage: pico.sh {init|state|set <ch> <0|1>|closed|open|opening|closing|stopped|pulse <ch> [ms]|raw <py>}" >&2; exit 1 ;;
esac
