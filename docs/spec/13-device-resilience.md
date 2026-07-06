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

## Command re-subscription on broker reconnect (controller)

The watchdog recovers a *wedged* stack, but it cannot recover a subtler failure: the controller stays
`mqtt.connected == true` yet silently stops receiving commands. Shelly clears a script's `MQTT.subscribe`
subscriptions when the script stops and **does not guarantee they survive a broker drop/reconnect** (the
docs only promise the connect-established handler fires on each reconnect). If a transient outage (Wi-Fi
blip, broker restart, keepalive timeout) drops and restores the link, a subscribe-once-at-boot controller
becomes **"connected but deaf"** until a manual restart — and the watchdog never fires, because
`mqtt.connected` reads back `true` (any reconnect resets `mqttDown` to 0).

**Fix (controller only — the i4 subscribes to nothing):** `subscribeCmd()` runs at boot **and again on
every MQTT down→up edge**, detected by the existing 1 s tick (`mqttUp()`), re-subscribing exactly once per
reconnect. `mqttWasUp` is seeded at boot so a steady connection never re-subscribes. Unit-tested
(`controller.test.js` — re-subscribe on transition + no steady-state churn). Latency to re-subscribe is
≤ 1 tick; a sub-second drop+reconnect entirely inside one tick window is not detected (acceptable — a blip
that brief is unlikely to have dropped the subscription). This complements the app-side gaps (fire-and-
forget QoS-1 to a **non-retained** command topic, no end-to-end ACK) — a command that lands while the
controller is briefly deaf is still lost, so the app path is the other half of the reliability story.

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

## Known: i4 monitor CPU (~83%) — accepted (Q-14)

The i4 monitor polls its inputs every 100 ms, which costs **~83% of the script core** — confirmed real
(the coffee plug's always-on script, same fw, reads **0%** with a 30 s timer; the S1 controller reads
**4%** at 1 s). It's **accepted for now**: RAM/heap/FS margins are healthy and the device is stable.
**Mitigation if it ever matters** (more per-tick work, heat/power, or a second script on the device):

- **Event-driven** inputs — react to the i4's real `input:N` events (D-14) + a slow (1 s) housekeeping
  timer for alive/watchdog. Best: ~5% CPU and keeps fast/faithful detection (incl. brief STOPPED). Cost:
  rewrites the validated input path (re-verify via Node tests + bench door-matrix).
- **Slow the poll to ~1 Hz** — trivial, ~4% CPU, but ~2 s to confirm a state change and a brief mid-travel
  STOPPED during a 2-pulse reverse may not register.

## Tuning the threshold on the bench
```bash
# set a short broker-down threshold, restart the script so boot reads it
curl -s -X POST http://192.0.2.160/rpc -d '{"id":1,"method":"KVS.Set","params":{"key":"wd_cfg","value":"{\"on\":1,\"wifi\":86400,\"mqtt\":150}"}}'
# … induce a disconnect, observe via Script.Eval "WD.mqttDown" …
curl -s -X POST http://192.0.2.160/rpc -d '{"id":1,"method":"KVS.Delete","params":{"key":"wd_cfg"}}'   # back to defaults
```
