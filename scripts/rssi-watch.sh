#!/usr/bin/env bash
# WiFi/RSSI survey — log both Shellys' signal strength over time at the FINAL install location, to judge
# whether the spot has enough margin for the connectivity watchdog (spec 13) before mounting for good.
# Motivated by the in-garage observation (HW-VALIDATION 2026-06-10): RSSI there was −73 to −85 dBm, thin
# margin. This runs overnight from a PC that stays on the same WiFi; the devices need no Pico and no door.
#
# Each sample polls WiFi.GetStatus (rssi/ssid/sta_ip) AND Sys.GetStatus (uptime) per device over the LAN,
# so it also catches a WiFi-drop severe enough to reboot a device (uptime would reset) and any outage
# (device unreachable → reachable=0, an outage the watchdog would have to survive).
#
# Usage:
#   scripts/rssi-watch.sh                         # log forever at 60 s, to logs/rssi-<UTC date>.csv
#   INTERVAL=30 scripts/rssi-watch.sh [csv]       # custom interval / file
#   DURATION_H=12 scripts/rssi-watch.sh           # stop after 12 h (0 = forever)
#   scripts/rssi-watch.sh --summary <csv>         # print the verdict for an existing log
#   I4=… S1=… scripts/rssi-watch.sh               # override device IPs (else .env MONITOR_HOST/CONTROLLER_HOST)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a || true
I4="${I4:-${MONITOR_HOST:-192.0.2.160}}"
S1="${S1:-${CONTROLLER_HOST:-192.0.2.161}}"
INTERVAL="${INTERVAL:-60}"
DURATION_H="${DURATION_H:-0}"   # 0 = forever

sample_dev() { # ip -> reachable,rssi,ssid,uptime,sta_ip   (reachable=0 with blanks on timeout)
  local ip="$1" wifi sys
  wifi=$(curl -s --max-time 6 "http://$ip/rpc/WiFi.GetStatus" 2>/dev/null || echo '')
  sys=$(curl -s --max-time 6 "http://$ip/rpc/Sys.GetStatus" 2>/dev/null || echo '')
  if [ -z "$wifi" ] || [ "$wifi" = '{}' ]; then echo "0,,,,"; return; fi
  [ -n "$sys" ] || sys='{}'
  jq -rn --argjson w "$wifi" --argjson s "$sys" \
    '[1,($w.rssi//""),($w.ssid//""),($s.uptime//""),($w.sta_ip//"")]|map(tostring)|join(",")' 2>/dev/null \
    || echo "0,,,,"
}

new_log() { mkdir -p "$(dirname "$1")"; echo "ts_iso,dev,reachable,rssi,ssid,uptime,sta_ip" > "$1"; }
add_sample() { local csv="$1" now; now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$now,i4,$(sample_dev "$I4")" >> "$csv"
  echo "$now,s1,$(sample_dev "$S1")" >> "$csv"; }

summary() { # csv interval_sec
  local LOG="$1" intv="${2:-$INTERVAL}"
  echo "=== rssi survey: $LOG  (interval ${intv}s) ==="
  for dev in i4 s1; do
    awk -F, -v dev="$dev" -v intv="$intv" '
      $2==dev {
        n++
        if ($3==1) {
          up++
          r=$4+0; sum+=r; nr++
          if (mn==""||r<mn) mn=r
          if (mx==""||r>mx) mx=r
          if (r< -80) below80++
          if (prevu!=""&&($6+0)<prevu) reboots++
          prevu=$6+0
          if (curgap>maxgap) maxgap=curgap
          curgap=0
          ssid=$5
        } else { down++; curgap++ }
      }
      END {
        if (curgap>maxgap) maxgap=curgap
        if (n==0) { printf "  %s: no samples\n", dev }
        else {
          printf "  %s (%s): %d samples, reachable %d (%.1f%%), unreachable %d\n", dev, ssid, n, up, 100*up/n, down
          if (nr>0) printf "       rssi  min %d  mean %.1f  max %d dBm   |  %d samples < -80 (%.1f%%)\n", mn, sum/nr, mx, below80, 100*below80/nr
          printf "       longest outage streak: %d samples (~%d min)   reboots: %d\n", maxgap, int(maxgap*intv/60), reboots
          if (nr>0 && sum/nr < -80) print "       ⚠ mean below -80 dBm — thin margin for the watchdog; consider antenna/AP placement"
          else if (nr>0 && below80>0) print "       note: some dips below -80 dBm — watch the longest-outage figure"
        }
      }' "$LOG"
  done
}

if [ "${1:-}" = "--summary" ]; then
  [ -n "${2:-}" ] || { echo "usage: $0 --summary <csv>" >&2; exit 1; }
  summary "$2" "$INTERVAL"; exit 0
fi

CSV="${1:-logs/rssi-$(date -u +%Y%m%d).csv}"
[ -f "$CSV" ] || new_log "$CSV"
echo "rssi-watch: i4=$I4 s1=$S1  every ${INTERVAL}s -> $CSV  (duration ${DURATION_H}h; 0=forever)"
echo "  tip: morning verdict ->  scripts/rssi-watch.sh --summary $CSV"
END_TS=0; [ "$DURATION_H" -gt 0 ] 2>/dev/null && END_TS=$(( $(date +%s) + DURATION_H*3600 ))
while :; do
  add_sample "$CSV"
  tail -2 "$CSV"
  [ "$END_TS" -ne 0 ] && [ "$(date +%s)" -ge "$END_TS" ] && { echo "duration reached"; break; }
  sleep "$INTERVAL"
done
