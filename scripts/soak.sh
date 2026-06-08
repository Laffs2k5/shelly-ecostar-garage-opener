#!/usr/bin/env bash
# Soak monitor — sample both device's health periodically so we can prove ≥24 h stability
# (Phase 3). Detects: script crash (running flips false / errors), watchdog/unexpected reboot
# (uptime resets), and memory leak (ram_min_free low-water mark collapsing over time).
#
# Usage:  scripts/soak.sh [interval_sec=600] [duration_hours=24]
#   logs CSV to logs/soak-<startepoch>.csv ; prints a PASS/FAIL-style summary at the end.
#   Re-checkable any time:  scripts/soak.sh --summary logs/soak-*.csv
set -euo pipefail
cd "$(dirname "$0")/.."

I4="${I4:-192.0.2.160}"; S1="${S1:-192.0.2.161}"

sample_dev() { # ip -> "uptime,ram_free,ram_min_free,fs_free,reset_reason,scr_running,scr_cpu,scr_mem_free,mqtt"
  local ip="$1" sys scr mq
  sys=$(curl -s --max-time 6 "http://$ip/rpc/Sys.GetStatus" 2>/dev/null || echo '{}')
  scr=$(curl -s --max-time 6 "http://$ip/rpc/Script.GetStatus?id=1" 2>/dev/null || echo '{}')
  mq=$(curl -s --max-time 6 "http://$ip/rpc/Mqtt.GetStatus" 2>/dev/null || echo '{}')
  jq -rn --argjson s "$sys" --argjson c "$scr" --argjson m "$mq" \
    '[$s.uptime, $s.ram_free, $s.ram_min_free, $s.fs_free, $s.reset_reason,
      $c.running, $c.cpu, $c.mem_free, $m.connected] | map(tostring) | join(",")' 2>/dev/null \
    || echo "ERR,ERR,ERR,ERR,ERR,ERR,ERR,ERR,ERR"
}

if [ "${1:-}" = "--summary" ]; then LOG="$2"; else
  INTERVAL="${1:-600}"; HOURS="${2:-24}"
  mkdir -p logs
  START=$(date +%s); LOG="logs/soak-$START.csv"
  echo "ts_iso,dev,uptime,ram_free,ram_min_free,fs_free,reset_reason,scr_running,scr_cpu,scr_mem_free,mqtt" > "$LOG"
  END=$(( START + HOURS*3600 ))
  echo "soak: logging to $LOG every ${INTERVAL}s for ${HOURS}h (i4=$I4 s1=$S1)"
  while :; do
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "$now,i4,$(sample_dev "$I4")" >> "$LOG"
    echo "$now,s1,$(sample_dev "$S1")" >> "$LOG"
    [ "$(date +%s)" -ge "$END" ] && break
    sleep "$INTERVAL"
  done
fi

# ---- summary: did anything regress between first and last sample per device? ----
echo "=== soak summary: $LOG ==="
for dev in i4 s1; do
  first=$(grep ",$dev," "$LOG" | head -1); last=$(grep ",$dev," "$LOG" | tail -1)
  [ -z "$first" ] && { echo "$dev: no samples"; continue; }
  n=$(grep -c ",$dev," "$LOG")
  u0=$(echo "$first" | cut -d, -f3);  uL=$(echo "$last" | cut -d, -f3)
  mmf0=$(echo "$first" | cut -d, -f5); mmfL=$(echo "$last" | cut -d, -f5)
  run_false=$(grep ",$dev," "$LOG" | awk -F, '$8!="true"' | wc -l)
  mqtt_false=$(grep ",$dev," "$LOG" | awk -F, '$11!="true"' | wc -l)
  # uptime should be monotonic; a drop => reboot/watchdog trip
  reboots=$(grep ",$dev," "$LOG" | cut -d, -f3 | awk 'NR>1 && $1<prev{c++} {prev=$1} END{print c+0}')
  echo "$dev: $n samples | uptime ${u0}s->${uL}s | ram_min_free ${mmf0}->${mmfL} B | script-not-running:$run_false | mqtt-down:$mqtt_false | uptime-drops(reboots):$reboots"
done
echo "PASS criteria: uptime grows by ≥86400s, reboots=0, script-not-running=0, ram_min_free stable (no steady decline)."
