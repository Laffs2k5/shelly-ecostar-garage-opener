# 11 — Broker provisioning (mTLS onboarding)

How the two Shellys attach to the local MQTT broker. The broker repo (`mqtt-leiflan`) is **operator-owned
and read-only to us** — we *request* certs/ACL from its maintainers (via the project owner), we never
change it. This doc records the facts + our side of the work.

## Broker facts (from mqtt-leiflan, snapshot 2026-06-07)

| Item | Value |
|---|---|
| Host / port | `192.0.2.130:8883` (also mDNS `mqtt` / `mqtt.local` / `mqtt.leiflan`) |
| Listener | mTLS only — `require_certificate true`, `use_identity_as_username true`, `allow_anonymous false` |
| CA | offline **ECDSA P-256**, root CN `leiflan-mqtt-ca`, public root = `pki/ca.crt` |
| Client cert | ECDSA P-256, **unencrypted PKCS#8 PEM**, 730-day validity, **CN = device identity** |
| Issuer script (maintainer) | `pwsh pki\ca.ps1 issue-client <CN>` → `pki/issued/<CN>.crt` + `pki/private/<CN>.key` |
| ACL (default, per CN) | `pattern readwrite devices/%u/#` and `pattern readwrite mon/%u/#` — auto-grants each CN its own subtree |
| Bridge | `devices/#` mirrored **both** ways to EMQX Serverless; **`mon/#` is NOT bridged** (LAN-only) |

ESP32/Shelly fit: P-256 + PEM + unencrypted key + TLS 1.2 are all natively supported; **no ALPN/SNI
needed on the LAN broker** (those are only for the cloud bridge, which is the broker's job, not ours).

## Identity → topic mapping (our design)

Each device's **CN = its MQTT identity = its `topic_prefix` root**. With CN `<MONITOR_ID>` / `<CONTROLLER_ID>`:

Identities (D-15): i4 = **`garage-monitor`**, S1 = **`garage-controller`**.

| Device | CN / identity | Publishes | Subscribes |
|---|---|---|---|
| i4 (monitor) | `garage-monitor` | `devices/garage-monitor/heartbeat` (retained door state), `mon/garage-monitor/alive`, `devices/garage-monitor/online` (LWT) | — |
| S1 (controller) | `garage-controller` | `devices/garage-controller/heartbeat`, `mon/garage-controller/alive`, `…/online` | `devices/garage-controller/command`, `…/config` |

**ACL fit:** the default per-CN pattern is **sufficient for both Shellys** — each only touches its own
`devices/<own-CN>/#` + `mon/<own-CN>/#`. No broad-scope ACL entry needed for them.

- The **i4→S1 link is HTTP-direct** (D-03), not MQTT, so S1 needs no cross-subtree read for normal
  operation. *(Optional resilience — see Q-12: if we later want S1 to also read the i4's heartbeat as a
  fallback when an HTTP push is missed, `garage-controller` would need read on `devices/garage-monitor/#`,
  an explicit ACL grant to request.)*
- The **app/web/HA** clients that read both devices + send commands are **separate identities** with
  broad `devices/#` scope (like the broker's existing `oneplus-13`). Those are ordered later (Phase 4 /
  monitor), not now.

## Our provisioning sequence (per device, via RPC from WSL)

Once the maintainer delivers `ca.crt`, `<CN>.crt`, `<CN>.key` (kept in `private/`, gitignored):

```
# 1. upload trust anchor + client identity (PEM strings)
Shelly.PutUserCA        { "data": "<ca.crt contents>",     "append": false }
Shelly.PutTLSClientCert { "data": "<<CN>.crt contents>",   "append": false }
Shelly.PutTLSClientKey  { "data": "<<CN>.key contents>",   "append": false }

# 2. point MQTT at the local broker over mTLS
Mqtt.SetConfig { "config": {
    "enable": true,
    "server": "192.0.2.130:8883",
    "ssl_ca": "user_ca.pem",
    "use_client_cert": true,
    "client_id": "<CN>",
    "topic_prefix": "devices/<CN>",
    "rpc_ntf": false,        # OUR project: false (devices/# is bridged — avoid flooding cloud)
    "status_ntf": false      # false — do not publish the status/* tree
}}
Shelly.Reboot
```

> Note: the broker repo's generic Shelly example uses `rpc_ntf:true`; **we override to `false`** per
> NEW-PROJECT-GUIDE because our `devices/#` tree is cloud-bridged. Verify with `Mqtt.GetStatus`
> (`connected:true`) after reboot.

## What to request from the broker maintainers ("the order")

For **each** device we onboard:

1. **Issue a client cert** — `pwsh pki\ca.ps1 issue-client <CN>` (CN per the decided convention).
2. **Deliver three PEM files** securely: `ca.crt`, `<CN>.crt`, `<CN>.key` (unencrypted PKCS#8).
3. **ACL:** default per-CN pattern is enough — **no custom ACL entry needed** (unless we adopt Q-11).
4. **No broker restart needed** if ACL is unchanged.

**Order now:** the **i4** (it's on the network). **Order later:** the **S1** once it's on the network and
its identity is fixed (Q-06). Exact order text lives with the project owner to relay.
