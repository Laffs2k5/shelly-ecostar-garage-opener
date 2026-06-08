#!/usr/bin/env bash
# Publish to the local broker over mTLS as `garage-devtool` (dev/test tooling identity).
# Usage:
#   scripts/mqtt-pub.sh devices/garage-controller/command open
#   scripts/mqtt-pub.sh devices/garage-controller/command '{"cmd":"close"}'
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${MQTT_LOCAL_HOST:-192.0.2.130}"; PORT="${MQTT_LOCAL_PORT:-8883}"
CA=private/ca.crt; CRT=private/garage-devtool.crt; KEY=private/garage-devtool.key
[ $# -ge 2 ] || { echo "usage: mqtt-pub.sh <topic> <message> [--retain]" >&2; exit 1; }
extra=(); [ "${3:-}" = "--retain" ] && extra=(-r)
exec mosquitto_pub -h "$HOST" -p "$PORT" \
  --cafile "$CA" --cert "$CRT" --key "$KEY" --tls-version tlsv1.2 \
  -t "$1" -m "$2" "${extra[@]}"
