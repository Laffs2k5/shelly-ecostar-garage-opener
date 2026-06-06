# 10 — i4 device facts (RPC snapshot)

Live `Shelly.*` RPC pull from the monitoring unit, **2026-06-07**, driven directly from WSL with `curl`
(see note below). Device: `shellyplusi4-example` @ 192.0.2.160.

## Identity & firmware

| Field | Value |
|---|---|
| id / app | `shellyplusi4-example` / `PlusI4` |
| model / gen | `SNSN-0D24X` / gen 2 |
| firmware | `1.7.5` (`20260311-095904/1.7.5-g9979d16`) |
| auth | disabled (`auth_en:false`) |
| WiFi | `sta_ip 192.0.2.160`, SSID `HomeWiFi`, RSSI −39 (excellent) |

## Inputs — resolves Q-01

All four inputs (`id 0..3`):

```json
{"id":N,"name":null,"type":"switch","enable":true,"invert":false,"factory_reset":true}
{"id":N,"state":false}
```

- **Type `switch` = level sensing.** Status is `{id, state:bool}`; the firmware emits `input:N` **toggle**
  events on change. This is exactly what reeds + optocoupler dry-contacts need — no `button` mode, no
  `single_push`/`long_push`. **The Plug-S "button toggles the switch, use a `script_switching` flag"
  quirk does NOT apply here** (the i4 has real, independent Input components).
- mJS access: `Shelly.addStatusHandler` / `addEventHandler` on `input:N` (`.delta.state` / event
  `"toggle"`), or poll `Input.GetStatus`. All currently `false` (nothing wired yet).
- **`invert` is per-input** — usable to normalise NC reed semantics (see Q-09).
- **`factory_reset:true` on every input** — a specific input held during boot triggers a factory reset.
  With reeds/optocouplers wired in, consider setting `factory_reset:false` per input so a stuck/closed
  contact at boot can't wipe the device (Q-09).

## Capabilities relevant to the design (from `Shelly.ListMethods`)

| Need | Method(s) | Status |
|---|---|---|
| i4 → S1 low-latency push | `HTTP.Request` / `HTTP.POST` / `HTTP.GET` | ✅ outbound HTTP available |
| Local broker mTLS provisioning | `Shelly.PutTLSClientKey` / `PutTLSClientCert` / `PutUserCA` + `Mqtt.SetConfig` | ✅ supported via RPC |
| Persist state | `KVS.*` | ✅ |
| Deploy script | `Script.Create/PutCode/Start/SetConfig` | ✅ |
| Boot-to-safe gating | `Sys.GetStatus.reset_reason` | ✅ present (see below) |

## System status

- `reset_reason: 1` (power-on) at snapshot; `uptime 5122s`. NTP synced (`last_sync_ts` set,
  `utc_offset 7200` = Europe/Oslo summer, `time 00:55`). `restart_required:false`.
- RAM: `ram_free 140200` / `ram_size 251516`; FS: `fs_free 126976` / `fs_size 393216`. Plenty for an
  mJS script (mind the heap rules in CLAUDE.md regardless).
- `reset_reason` is available → the boot-to-safe / resume-only-on-`==3` pattern is feasible on this
  device (matters most for the S1 controller; the i4 is stateless-ish but can use it too).

## MQTT / Cloud — current (needs provisioning in Phase 1.4)

- `Mqtt.GetConfig`: `enable:false`, `server:null`, `use_client_cert:false`, `ssl_ca:null` → **not yet
  pointed at the local broker**. `client_id`/`topic_prefix` default to the device id. **`rpc_ntf:true`**
  — must be set **`false`** before production (guide: avoids flooding the bridge); `status_ntf` already
  `false`. `Mqtt.GetStatus`: `connected:false`.
- `Cloud.GetConfig`: `enable:true` (EU server). Decide whether to keep or disable Shelly Cloud on the
  device under the local-broker architecture (Q-10).

## Note — WSL reaches the LAN here

Contrary to the reference repo's environment, **WSL2 on this machine can reach the LAN directly**
(verified: `curl http://192.0.2.160/rpc/Shelly.GetDeviceInfo` works). Shelly Plus/Gen2 RPC over GET
returns the result object **directly** — no `.result` envelope (that wrapper is only for JSON-RPC POSTs
to `/rpc`). No need for the Windows/`pwsh.exe` detour for device control.
