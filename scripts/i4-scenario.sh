#!/usr/bin/env bash
# Hardware verification of TIME-SENSITIVE i4 logic (Q-16 gate, debounce, reverse-kick) — see spec 12 §
# "Timed scenario testing". The Pico replays a precisely-timed door sequence ON-DEVICE (the host link is
# too laggy for sub-tick timing); we capture the i4's HEARTBEAT state-change stream so a transient glitch
# is visible (it would publish an extra OPENING/CLOSING), not just the settled end state.
#
# Usage:  scripts/i4-scenario.sh '<pico-call>'
#   e.g.  scripts/i4-scenario.sh 'close_arrival(180)'      # realistic close + 180ms reverse kick
#         scripts/i4-scenario.sh 'close_arrival(500)'      # negative control: kick > gate -> SHOULD glitch
#         scripts/i4-scenario.sh 'depart_closed(650)'      # departure -> expect CLOSED->OPENING
#   Scenarios are defined in device/test-rig/main.py (deploy them once with: scripts/pico.sh deploy).
# Env: I4 (default 192.0.2.160), HBTOPIC (default devices/garage-monitor/heartbeat), WINDOW secs (15).
set -euo pipefail
cd "$(dirname "$0")/.."
I4="${I4:-192.0.2.160}"
CALL="${1:?usage: i4-scenario.sh '<pico-call>'  e.g. 'close_arrival(180)'}"
HBTOPIC="${HBTOPIC:-devices/garage-monitor/heartbeat}"
log="$(mktemp)"
pass_time() { local n="$1"; for _ in $(seq "$n"); do curl -s --max-time 1 "http://$I4/script/1/state" >/dev/null 2>&1; done; }

timeout "${WINDOW:-15}" ./scripts/mqtt-sub.sh "$HBTOPIC" >"$log" 2>/dev/null &
pass_time 22                       # let the subscriber connect (grabs the retained start state)
echo "scenario: main.$CALL"
./scripts/pico.sh raw "main.$CALL" >/dev/null 2>&1
pass_time 22                       # capture the post-sequence settle
wait 2>/dev/null || true
echo "published state changes: $(grep -o '"state":"[A-Z_]*"' "$log" | sed 's/.*://;s/"//g' | tr '\n' ' ')"
echo "(a transient glitch shows as an extra OPENING/CLOSING between the start and end states)"
rm -f "$log"
