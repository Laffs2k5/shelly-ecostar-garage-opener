# 03 — MQTT topics & monitoring adherence

## Two channels, both kept by design

This mirrors the reference repo's spec 11 §4.1 ("app last-seen vs. infra monitoring — kept separate").
Do **not** collapse them.

| Topic | Retain | Consumer | Purpose |
|---|---|---|---|
| `devices/<id>/heartbeat` | **YES** | app / web | Application status: door state, last direction, config version, ts. Retained so a client gets the current picture immediately on connect. |
| `mon/<id>/alive` | **NO** | layer-3 monitor | Pure infra liveness. Payload irrelevant. LAN-only, staleness-based (`expire_after`). |
| `devices/<id>/online` | YES (LWT) | both | Firmware-published last-will connect/disconnect. |
| `devices/<controller-id>/command` | NO | controller (S1) | open / close / toggle from the outside world. |
| `devices/<controller-id>/config` | YES | controller (S1) | Version-gated config (rejects `v <= current`). |

`<id>` is the per-device id (the i4 publishes door state + its own alive; S1 publishes command-status +
its own alive). Both devices appear in `mon/#`.

## The one rule the monitor spec is really after

**The monitor watches `mon/<id>/alive`, never the retained heartbeat.** A retained heartbeat would let
the broker replay the last payload on monitor restart and *resurrect a dead device to "online"*
(reference: HA issue #148860). `alive` can't be replaced by the heartbeat — it carries no payload and
is not retained. The heartbeat is **not** deprecated; it is the app's status channel and is
deliberately retained for immediate-on-connect state.

## Bridge & quota discipline (carry-forward)

- Keep `mon/#` **outside** the bridged `devices/#` tree, so high-frequency `alive` stays LAN-only and
  never burns the cloud free-tier quota.
- On each Shelly, set MQTT `status_ntf` and `rpc_ntf` = **`false`** (else the firmware publishes its
  whole `devices/<id>/status/#` tree and the bridge mirrors it to the cloud).
- Set a unique, stable `client_id` per device; `topic_prefix` must be non-empty.

## Adherence to the WIP monitor spec (`nas-leiflan/docs/layer3-monitor-spec.md`)

| Spec convention | This project |
|---|---|
| `mon/<device-id>/alive`, non-retained, periodic | ✅ both Shellys publish |
| `devices/<device-id>/online` retained LWT | ✅ firmware-published per device |
| Local broker `192.0.2.130:8883`, mTLS, CN = identity | ✅ both devices provisioned via RPC |
| Monitor never subscribes to retained heartbeat | ✅ by design |

**Flag for the monitor maintainers:** door **state** is application data, not liveness — it rides the
retained `heartbeat`, not `alive`. If the monitor ever wants door-state-derived alerts (e.g. "door OPEN
> 30 min"), that's an app/HA automation consuming the heartbeat, *not* a `mon/` liveness check. Keep
the two concerns separate. (Open item — see 08 Q-05.)
