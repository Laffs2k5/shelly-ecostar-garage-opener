# Security policy

This project controls a **physical garage door** — a security device. Please read this before
deploying or reporting.

## Threat model & scope

- **No credentials or network identity are in this repository.** All real keys, certificates, broker
  hosts, device IDs, and network addresses are provisioned at runtime from a local `.env` / the app's
  settings / a private vault (see `CLAUDE.md` and `docs/spec/11-broker-provisioning.md`). Cloning this
  repo grants **no access** to anyone's door.
- Remote open/close requires the operator's **own** broker credentials and/or LAN access. The local
  MQTT path is **mTLS**; the cloud path uses per-app credentials. Example IPs in docs are RFC 5737
  placeholders, not real hosts.
- **Safety-by-design:** core control (the physical wall button and RF remotes) is wired in parallel at
  the opener and **never depends on Wi-Fi, MQTT, or this software** (decision D-04). A failure or
  compromise of the smart layer cannot disable manual operation. The controller boots to a safe state
  and only resumes persisted state on a software/watchdog reboot, never on mains loss.

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories
("Report a vulnerability" on the repository's **Security** tab) rather than a public issue.
Include steps to reproduce and the affected component (device script, app, watch, web, or CI).
There is no formal SLA — this is a personal project — but reports will be acknowledged and addressed
on a best-effort basis.

## If you deploy this yourself

- Keep your `private/` material and `.env` out of git (they are gitignored here).
- Use your own mTLS PKI and broker ACLs; do not reuse example identities.
- The debug signing key committed for reproducible builds is **not** a release credential.
