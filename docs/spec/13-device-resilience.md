# 13 — Device resilience (connectivity watchdog)

Both device scripts carry a **connectivity watchdog**: if Wi-Fi or the broker is down for too long, reboot
to recover a wedged network/TLS stack. (NEW-PROJECT-GUIDE §4 pattern.)

## Why it's safe here — no resume gate

The coffee-timer had to gate resume on `reset_reason == 3` because it resumed a running countdown (a
mains loss must boot to OFF). **Our devices hold no resumable runtime state:**

- **i4 (monitor):** re-derives door state from live inputs at boot — always correct.
- **S1 (controller):** relay `initial_state:off`, never auto-acts; the door picture is repopulated by the
  next i4 push.

So **boot is always safe regardless of cause** → the watchdog needs no `reset_reason` gate and no resume
logic (D-20). It only ever reboots-to-recover. (`reset_reason` 1=power / 3=software was observed on both
devices, spec 11 — but nothing depends on it.)

## Logic

One pure function in each script (unit-tested):
```
wdReboot(wifiDownMs, mqttDownMs, cfg) -> "wifi" | "mqtt" | ""
```
The single repeating timer accumulates `wifiDown`/`mqttDown` each tick (broker-down only counts while
Wi-Fi is up and MQTT is enabled; any reconnect resets to 0) and reboots when a threshold is crossed.

- Defaults: **Wi-Fi down ≥ 600 s** or **broker down ≥ 1800 s** → `Shelly.Reboot`.
- Overridable via KVS key **`wd_cfg`** = `{"on":0|1,"wifi":<s>,"mqtt":<s>}` (read at boot). Absent → defaults.
- `mqttEnabled` comes from `Mqtt.GetConfig.enable` at boot; if MQTT is disabled the broker check is skipped.

## Validation (2026-06-07/08)

- **Unit:** 31 device tests incl. `wdReboot` decision + an integration that reboots after the broker-down
  threshold (mocked Wi-Fi/MQTT) and *doesn't* when connected or when MQTT is disabled.
- **Hardware (i4):** with the real broker up, `mqttUp()=true`, counter stays 0 (no false reboot). Rebooted
  into a dead-broker config → `mqttUp()=false`, `WD.mqttDown` climbed monotonically; on restore the device
  reconnected and the script resumed. `wd_cfg` from KVS applied. (Threshold restored before an actual
  reboot — that path is unit-tested.)
- **Note:** under heavy `Script.Eval` polling the 50 ms monitor tick ran slightly slow, so wall-clock
  thresholds are approximate — acceptable for a recover-a-wedged-stack timer; revisit if exact timing
  ever matters.

## Tuning the threshold on the bench
```bash
# set a short broker-down threshold, restart the script so boot reads it
curl -s -X POST http://192.0.2.160/rpc -d '{"id":1,"method":"KVS.Set","params":{"key":"wd_cfg","value":"{\"on\":1,\"wifi\":86400,\"mqtt\":150}"}}'
# … induce a disconnect, observe via Script.Eval "WD.mqttDown" …
curl -s -X POST http://192.0.2.160/rpc -d '{"id":1,"method":"KVS.Delete","params":{"key":"wd_cfg"}}'   # back to defaults
```
