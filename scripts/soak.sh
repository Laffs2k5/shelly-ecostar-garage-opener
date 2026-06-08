#!/usr/bin/env bash
# Soak monitor — prove ≥24 h device stability (Phase 3). Detects: script crash (running flips
# false / errors), watchdog/unexpected reboot (uptime not keeping pace with wall-clock), and memory
# leak (ram_min_free low-water mark collapsing).
#
# The devices track uptime / ram_min_free / reset_reason **persistently**, so a continuous connection
# is NOT required: take a baseline, leave the devices powered, then re-check once after ≥24 h — even
# if this computer was offline the whole time, the verdict holds.
#
# Usage:
#   scripts/soak.sh --baseline [csv]        # record a baseline (default logs/soak-baseline.csv)
#   scripts/soak.sh --check    [csv]        # append a fresh sample to the csv, then print verdict
#   scripts/soak.sh --summary  <csv>        # just print the verdict for an existing csv
#   scripts/soak.sh [interval_sec] [hours]  # continuous sampling (only useful while online)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a || true
I4="${I4:-${MONITOR_HOST:-192.0.2.160}}"; S1="${S1:-${CONTROLLER_HOST:-192.0.2.161}}"
DEFAULT_CSV="logs/soak-baseline.csv"

sample_dev() { # ip -> uptime,ram_free,ram_min_free,fs_free,reset_reason,scr_running,scr_cpu,scr_mem_free,mqtt
  local ip="$1" sys scr mq
  sys=$(curl -s --max-time 6 "http://$ip/rpc/Sys.GetStatus" 2>/dev/null || echo '{}')
  scr=$(curl -s --max-time 6 "http://$ip/rpc/Script.GetStatus?id=1" 2>/dev/null || echo '{}')
  mq=$(curl -s --max-time 6 "http://$ip/rpc/Mqtt.GetStatus" 2>/dev/null || echo '{}')
  jq -rn --argjson s "$sys" --argjson c "$scr" --argjson m "$mq" \
    '[$s.uptime,$s.ram_free,$s.ram_min_free,$s.fs_free,$s.reset_reason,
      $c.running,$c.cpu,$c.mem_free,$m.connected]|map(tostring)|join(",")' 2>/dev/null \
    || echo "ERR,ERR,ERR,ERR,ERR,ERR,ERR,ERR,ERR"
}
new_log() { mkdir -p "$(dirname "$1")"; echo "ts_iso,dev,uptime,ram_free,ram_min_free,fs_free,reset_reason,scr_running,scr_cpu,scr_mem_free,mqtt" > "$1"; }
add_sample() { local csv="$1" now; now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$now,i4,$(sample_dev "$I4")" >> "$csv"; echo "$now,s1,$(sample_dev "$S1")" >> "$csv"; }

summary() { local LOG="$1"
  echo "=== soak verdict: $LOG ==="
  local fail=0
  for dev in i4 s1; do
    local first last n t0 tL u0 uL wall ugain mmf0 mmfL runbad mqbad rebooted
    first=$(grep ",$dev," "$LOG" | head -1); last=$(grep ",$dev," "$LOG" | tail -1)
    [ -z "$first" ] && { echo "$dev: no samples"; continue; }
    n=$(grep -c ",$dev," "$LOG")
    t0=$(echo "$first" | cut -d, -f1);  tL=$(echo "$last" | cut -d, -f1)
    u0=$(echo "$first" | cut -d, -f3);  uL=$(echo "$last" | cut -d, -f3)
    mmf0=$(echo "$first" | cut -d, -f5); mmfL=$(echo "$last" | cut -d, -f5)
    runbad=$(grep ",$dev," "$LOG" | awk -F, 'NR>0 && $8!="true"' | wc -l | tr -d ' ')
    mqbad=$(grep ",$dev," "$LOG" | awk -F, '$11!="true"' | wc -l | tr -d ' ')
    wall=$(( $(date -d "$tL" +%s) - $(date -d "$t0" +%s) ))
    ugain=$(( uL - u0 ))
    # uptime must keep pace with wall-clock (120 s slack); if it lags, a reboot happened in the gap
    rebooted=no; [ "$wall" -gt 300 ] && [ "$ugain" -lt $(( wall - 120 )) ] && rebooted=YES
    echo "$dev: $n sample(s) over ${wall}s wall | uptime +${ugain}s | ram_min_free ${mmf0}→${mmfL} B | crashes:$runbad | mqtt-down:$mqbad | rebooted:$rebooted"
    [ "$runbad" != 0 ] && fail=1; [ "$rebooted" = YES ] && fail=1
  done
  echo "----"
  if [ "$fail" = 0 ]; then echo "PASS (so far). Need wall ≥86400s with rebooted:no, crashes:0, ram_min_free not steadily declining."
  else echo "⚠ FAIL — investigate the flagged device above (crash and/or unexpected reboot)."; fi
}

case "${1:-}" in
  --summary) summary "$2" ;;
  --baseline) csv="${2:-$DEFAULT_CSV}"; new_log "$csv"; add_sample "$csv"
    echo "baseline written: $csv (i4=$I4 s1=$S1)"; column -s, -t "$csv" ;;
  --check) csv="${2:-$DEFAULT_CSV}"; [ -f "$csv" ] || { echo "no $csv — run --baseline first" >&2; exit 1; }
    add_sample "$csv"; summary "$csv" ;;
  *) INTERVAL="${1:-600}"; HOURS="${2:-24}"; csv="logs/soak-$(date +%s).csv"; new_log "$csv"
    END=$(( $(date +%s) + HOURS*3600 )); echo "soak: $csv every ${INTERVAL}s for ${HOURS}h"
    while :; do add_sample "$csv"; [ "$(date +%s)" -ge "$END" ] && break; sleep "$INTERVAL"; done
    summary "$csv" ;;
esac
