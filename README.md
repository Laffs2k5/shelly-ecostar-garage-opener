# web/

Vanilla HTML/CSS/JS control page (MQTT over WSS), GitHub Pages. Phase 4.

Mirrors the phone app's UI + control logic (see `docs/spec/16-app-v2.md`): the **Cyber Garage Control**
neon theme, the **morphing action button** (Open / Close / **Stop** / Engage; STOPPED = an Open｜Close
split), a connection footer with history, and a **demo mode** (local simulation, no broker) — all driven
by the pure `garage-core.js` (unit-tested, `scripts/test-web.sh`). Cloud-broker only (in-browser: no client
cert, no HTTP-direct); the phone app owns same-Wi-Fi direct + the local broker. **Notifications/alarms are
app-only** (OS features); there is no watch surface here.
