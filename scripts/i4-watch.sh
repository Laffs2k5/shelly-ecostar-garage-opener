#!/usr/bin/env bash
# Watch the i4's 4 inputs (SW1..SW4 = input 0..3) and print state changes with timestamps.
# A core dev/verification tool: drive inputs (real switches, jumpers, or the Pico rig) and SEE the
# i4's view change live. WSL reaches the i4 directly (no Windows detour).
#
# Usage:
#   scripts/i4-watch.sh                 # watch forever (Ctrl-C to stop)
#   DURATION=120 scripts/i4-watch.sh    # watch for 120 s then exit
#   IP=192.0.2.160 scripts/i4-watch.sh
set -euo pipefail
IP="${IP:-192.0.2.160}"
INTERVAL="${INTERVAL:-0.4}"
DURATION="${DURATION:-0}"   # 0 = forever

snapshot() { # prints "s0 s1 s2 s3" as 0/1, or "ERR"
  local out="" i st
  for i in 0 1 2 3; do
    st=$(curl -s --max-time 3 "http://$IP/rpc/Input.GetStatus?id=$i" | jq -r '.state' 2>/dev/null)
    case "$st" in true) st=1;; false) st=0;; *) echo "ERR"; return;; esac
    out="$out$st "
  done
  echo "${out% }"
}

ts() { date '+%H:%M:%S.%2N'; }
echo "[$(ts)] watching i4 $IP inputs SW1..SW4 (id0..3); interval ${INTERVAL}s; duration ${DURATION:-forever}s"
prev=""
start=$(date +%s)
while :; do
  cur=$(snapshot)
  if [ "$cur" != "$prev" ]; then
    echo "[$(ts)] SW1..SW4 = $cur${prev:+   (was $prev)}"
    prev="$cur"
  fi
  if [ "$DURATION" != "0" ] && [ $(( $(date +%s) - start )) -ge "$DURATION" ]; then
    echo "[$(ts)] done (${DURATION}s elapsed)"; break
  fi
  sleep "$INTERVAL"
done
