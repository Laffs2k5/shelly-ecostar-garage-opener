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

## Provisioning record

| Device | CN | Date | Result |
|---|---|---|---|
| i4 (monitor) | `garage-monitor` | 2026-06-07 | **DONE** — certs uploaded (CA 668 / crt 725 / key 241 B), `Mqtt.SetConfig` applied, `Mqtt.GetStatus → connected:true` ~6 s after reboot |
| S1 (controller) | `garage-controller` | 2026-06-07 | **DONE** — on network at 192.0.2.161; certs uploaded (CA 668 / crt 733 / key 241 B), `Mqtt.SetConfig` applied, `connected:true` ~3 s after reboot, `online true` on broker. Default per-CN ACL |
| dev tooling | `garage-devtool` | 2026-06-07 | **cert issued + verified, in `private/`**; scoped ACL deployed (SIGHUP reload). **Verified live** via `scripts/mqtt-sub.sh` — observed `garage-monitor` retained heartbeat + `online` LWT |

### Dev tooling identity (`garage-devtool`)

A separate mTLS identity so we can `mosquitto_sub`/`pub` from WSL to **verify the heartbeat/alive
end-to-end** and **inject test commands/configs** to the controller — without reusing a device CN
(which would clash with the live device). It needs broader-than-default scope, so the maintainer must
add an explicit ACL block (the default `pattern …/%u/#` only grants it `devices/garage-devtool/#`):

```
user garage-devtool
topic readwrite devices/garage-monitor/#
topic readwrite devices/garage-controller/#
topic read      mon/garage-monitor/#
topic read      mon/garage-controller/#
```

Least-privilege: limited to *our* two devices' subtrees (read their state, write the controller's
command/config for tests), read-only on their `mon/` liveness. Then redeploy the broker to load the ACL.

Notes from the i4 provisioning:

- Cert material (ECDSA P-256, CN `garage-monitor`, EKU clientAuth, valid 2026-06-07 → 2028-06-06)
  verified locally before upload: chain OK against `ca.crt`, cert↔key pubkey match. Kept in `private/`
  (gitignored) for re-provisioning after any factory reset; the broker can re-issue anytime.
- Cert upload **persists across a mains power cycle** (proven: connect succeeded after a `reset_reason 1`
  boot, then a `reset_reason 3` software reboot). There is no `GetUserCA` read-back — a successful mTLS
  connect is the verification.
- **`reset_reason` confirmed on this hardware:** `1` = mains power-on, `3` = software reboot — the gate
  the boot-to-safe / watchdog-resume pattern depends on.
- At this phase there is **no device script yet**, so the only broker traffic is the firmware's retained
  `devices/garage-monitor/online` LWT. Heartbeat + `mon/garage-monitor/alive` arrive with the Phase 2
  script. (Don't subscribe from tooling using the `garage-monitor` identity — it would clash with the
  live device; use a separate tooling CN if broker-side inspection is needed.)

## Client identities — Phase 4A (ISSUED 2026-06-08)

**`garage-app` is issued and delivered** — credentials live in the **Bitwarden vault**, not the repo:
- BW item **`mqtt.leiflan - mqtt creds for garage-app`** — attachments `ca.crt`, `garage-app.crt`,
  `garage-app.key`, `garage-app.p12` + hidden field `p12-password`; fields host `mqtt.leiflan /
  192.0.2.130`, port `8883`, tls = mTLS client cert (verify server with `ca.crt`), username
  `garage-app`, **password = none (LAN is cert-only)**, client-id.
- BW item **`emqx.com - mqtt garage-app`** — cloud user/pass for off-LAN (WSS).
- **App setup:** import `ca.crt` + `garage-app.p12` (+ p12-password) into the app's cert store; enter the
  cloud user/pass. Nothing identity-specific is bundled/committed (D-06). *(Device + `garage-devtool`
  certs stay in `private/`; the app creds stay in BW — the phone imports them.)*

The phone app + web page need broker access too. **Model (from maintainer, full spec
`mqtt-leiflan/docs/onboarding-devices.md`): per-app credential, household-flat.**

- **Unit of credential = per app.** The garage app on the operator's phone gets its OWN cert + cloud
  user/pass. Naming `<person>-<app>` → **CN `garage-app`** (durable across phone swaps, readable in logs/ACL).
- **ACL: one broad block per app**, identical to existing clients:
  ```
  user garage-app
  topic readwrite devices/#
  ```
- **Client-id = CN** (`garage-app`). Unique CN per app ⇒ no cross-app client-id collision (the
  takeover-war class can't happen between apps). Within one app, still never open two connections at once.
- **Cloud:** each app cert pairs with its own cloud user/pass (matching CN) for per-app revocation.
- **Retention:** command topic **`retain=false`** (safety) — door **state** may be retained. (Our
  controller subscribes `devices/garage-controller/command`; web/app publish non-retained.)
- **Accepted trade-off (deliberate, not a gap):** flat `devices/#` means `garage-app` can also touch the
  coffee plug / any appliance. Chosen for household simplicity; matches `oneplus-13`/`backend-automations`.
- **Web page:** cloud-WSS only (browsers can't present a client cert over MQTT-WSS; a Pages https page
  can't HTTP-direct to a Shelly — mixed content). Uses a **cloud user/pass + random client-id**;
  HTTP-direct + local-broker mTLS are the **Android app's** paths.
- **4A order:** issue `garage-app` cert (broad block above) + a cloud user/pass. Additional household
  apps add `user2-garage` etc. the same way. (`oneplus-13` = the coffee app from the sibling project — left as-is.)
