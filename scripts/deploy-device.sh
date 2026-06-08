#!/usr/bin/env bash
# Deploy a minified device script to a Shelly over RPC (from WSL — we reach the LAN directly).
# Find-or-create the script by name, stop it, chunked Script.PutCode (HTTP ~3072 B limit -> 1 KB
# chunks), enable autostart, start, verify. Re-run anytime to redeploy.
#
# Usage:  scripts/deploy-device.sh monitor|controller       (IP resolved by role from .env)
#         IP=192.0.2.161 scripts/deploy-device.sh controller   (explicit override)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a || true
NAME="${1:-monitor}"
# Resolve target IP from the device ROLE (override with IP=...). This avoids the footgun of deploying
# the controller to the i4: monitor -> MONITOR_HOST (.160), controller -> CONTROLLER_HOST (.161).
if [ -z "${IP:-}" ]; then
  case "$NAME" in
    monitor)    IP="${MONITOR_HOST:-192.0.2.160}" ;;
    controller) IP="${CONTROLLER_HOST:-192.0.2.161}" ;;
    *) echo "unknown device '$NAME' — pass an explicit IP=..." >&2; exit 1 ;;
  esac
fi
echo "deploying '$NAME' -> $IP"
FILE="device/$NAME.min.js"
[ -f "$FILE" ] || { echo "no $FILE — run scripts/build-device.sh first" >&2; exit 1; }
rpc() { curl -s --max-time 10 -X POST "http://$IP/rpc" -H 'Content-Type: application/json' -d "$1"; }

id=$(curl -s --max-time 5 "http://$IP/rpc/Script.List" | jq --arg n "$NAME" '[.scripts[]?|select(.name==$n)|.id][0]')
if [ "$id" = "null" ] || [ -z "$id" ]; then
  id=$(rpc "{\"id\":1,\"method\":\"Script.Create\",\"params\":{\"name\":\"$NAME\"}}" | jq '.result.id')
  echo "created script '$NAME' id=$id"
else
  echo "reusing script '$NAME' id=$id"
fi

rpc "{\"id\":1,\"method\":\"Script.Stop\",\"params\":{\"id\":$id}}" >/dev/null || true

tmp=$(mktemp -d); split -b 1024 "$FILE" "$tmp/c."
first=true
for c in "$tmp"/c.*; do
  ap=true; [ "$first" = true ] && ap=false
  payload=$(jq -Rs --argjson id "$id" --argjson ap "$ap" '{id:1,method:"Script.PutCode",params:{id:$id,code:.,append:$ap}}' < "$c")
  echo "  $(basename "$c") append=$ap -> $(rpc "$payload" | jq -c '.result // .error')"
  first=false
done
rm -rf "$tmp"

devlen=$(rpc "{\"id\":1,\"method\":\"Script.GetCode\",\"params\":{\"id\":$id}}" | jq '.result.data|length')
rpc "{\"id\":1,\"method\":\"Script.SetConfig\",\"params\":{\"id\":$id,\"config\":{\"enable\":true}}}" >/dev/null
echo "start -> $(rpc "{\"id\":1,\"method\":\"Script.Start\",\"params\":{\"id\":$id}}" | jq -c '.result // .error')"
echo "status -> $(rpc "{\"id\":1,\"method\":\"Script.GetStatus\",\"params\":{\"id\":$id}}" | jq -c '{running:.running,errors:.errors}')"
echo "local $(wc -c < "$FILE") B vs device $devlen chars; endpoint: http://$IP/script/$id/state"
