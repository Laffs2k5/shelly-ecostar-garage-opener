#!/usr/bin/env bash
# Observe the garage devices on the local broker over mTLS, as the `garage-devtool` tooling identity.
# A core verification tool: watch what the i4/S1 actually publish (heartbeat, mon/alive, online LWT).
#
# Usage:
#   scripts/mqtt-sub.sh                       # both devices + their mon/alive (until Ctrl-C)
#   W=35 scripts/mqtt-sub.sh                  # run 35s then exit
#   scripts/mqtt-sub.sh 'devices/garage-monitor/#'   # custom topic(s)
# Env: MQTT_LOCAL_HOST (192.0.2.130), MQTT_LOCAL_PORT (8883), W (0 = forever).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${MQTT_LOCAL_HOST:-192.0.2.130}"; PORT="${MQTT_LOCAL_PORT:-8883}"
CA=private/ca.crt; CRT=private/garage-devtool.crt; KEY=private/garage-devtool.key
for f in "$CA" "$CRT" "$KEY"; do [ -f "$f" ] || { echo "missing $f (broker maintainer must deliver it)" >&2; exit 1; }; done

topics=("$@")
[ ${#topics[@]} -eq 0 ] && topics=(devices/garage-monitor/# mon/garage-monitor/# devices/garage-controller/# mon/garage-controller/#)
ta=(); for t in "${topics[@]}"; do ta+=(-t "$t"); done
extra=(); [ "${W:-0}" != "0" ] && extra=(-W "$W")

exec mosquitto_sub -h "$HOST" -p "$PORT" \
  --cafile "$CA" --cert "$CRT" --key "$KEY" --tls-version tlsv1.2 \
  -v "${extra[@]}" "${ta[@]}"
