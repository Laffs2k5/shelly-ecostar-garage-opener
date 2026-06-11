# 16 — Android app v2 (scope & design)

> **Status: SCOPING (2026-06-11). No code yet.** Supersedes the §4D checklist in
> [09-phase-plan.md](09-phase-plan.md) — that section now links here. v1 (all three transports validated
> on-device) is the baseline; this is the redesign on top of it.

## Goal

Turn the working-but-minimal v1 (single `MainActivity`, live-only, foreground-only) into a polished,
background-aware app: it tells you when the garage is open without being open, lets you act in one tap,
and is themeable/brandable — while staying **light on battery** and never depending on an always-on socket.

## Background model — periodic wake, NOT an always-on service ✅

**Decision (2026-06-11):** background awareness uses a **periodic wake** (coffee-plug pattern), not a
persistent foreground service.

- A scheduled job (**WorkManager periodic**, ~15-min floor) wakes, connects, reads the **retained**
  `devices/garage-monitor/heartbeat` (current state delivered *immediately* on connect — the reason it's
  retained, spec 03), updates the notification / evaluates alarms, then **disconnects**.
- Time-of-day alarm = a **scheduled exact wake** (AlarmManager), connect-check-disconnect — the poll model
  fits it perfectly.

**Why not an always-on foreground service (MQTT socket 24/7):**
- Android **forces a permanent notification** for any FGS — a "running" notification even when CLOSED.
- Needs a **battery-optimization exemption** or Doze kills it overnight (when you'd most want the alert).
- OEM task-killers (Samsung et al.) are hostile to long-lived services.
- Battery itself is only moderate, but the reliability tax is the real cost.

**Accepted tradeoff:** background door-state can lag reality by **up to ~15 min** (WorkManager's reliable
floor). Fine for an awareness aid; the "open > X min" and time-of-day alarms tolerate it by nature. **No
instant "garage just opened" push** — if ever wanted, that's an HA→FCM concern, not an app FGS (consistent
with D-12: alerting lives in HA, we expose status).

**Foreground is unaffected:** when the app is open it uses the **live** connection exactly as v1
(HTTP-direct on LAN, else MQTT) — real-time state + the morphing button. The 15-min floor only governs
background.

## Features

### Persistent "door open" notification
- **3 modes (configurable):** *always show while open* · *only after open ≥ X minutes* · *off (hide)*.
- **No action buttons** ✅ — tap opens the app; that's it.
- Driven by the periodic wake reading the retained heartbeat.

### Single morphing action button
- **Option that replaces** the three separate buttons. Label+action follows door state:
  - CLOSED → **Open** · OPEN → **Close** · OPENING/CLOSING → **Stop** · UNKNOWN → **Engage** (best-effort
    toggle) · STOPPED_OPENING/STOPPED_CLOSING → offer the resume/reverse direction.
- **Default layout: morphing button** (cleaner single-action UX; safety-stop falls out naturally). Settings
  toggle reverts to the classic three-button layout.
- **FW ready:** controller accepts `stop` (safety halt, moving-door-only; D-19, [spec 14](14-motion-timing-and-pulse-safety.md)).

### Alarms
- **Open > X minutes** — user threshold; fires a notification. Poll model detects within ~15 min slop.
- **Open at time-of-day** — time-picker; a scheduled exact wake checks state and alerts if open. Must fire
  even if no live connection is up (scheduled wake, not a watching service).

### Demo mode
- Exercises **as much of the UI + on-device behavior as possible** — state changes, travel animation,
  button morphing, **and real local notifications/alarms** (so those can be tested without a door).
- **Zero real communication** ✅ — no MQTT connect, no commands sent, nothing leaves the phone. Fully
  sandboxed behind the state-source abstraction (below).

## Architecture prerequisites (build these first)

These aren't user-facing features but everything above leans on them:
1. **Injectable door-state source** — one interface with two implementations: *live* (HTTP-direct/MQTT, as
   v1) and *demo* (simulated). The UI, notifications, and alarms depend on the interface, never on the
   transport. Makes demo mode and testing fall out cleanly.
2. **WorkManager periodic job + AlarmManager exact alarm** — the background wake plumbing.
3. **Compose Navigation** — settings redesign needs multiple screens; v1 is a single screen.

## Android plumbing (real requirements, easy to forget)
- **POST_NOTIFICATIONS** runtime permission (Android 13+) — request, or notifications silently never show.
- **Notification channels** — at least two: low-importance *status* (the open-door notification) vs.
  high-importance *alarm* (the two alarms buzz; status stays quiet).
- **Exact-alarm permission** (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`, Android 12+) for the time-of-day alarm.
- *No battery-opt exemption needed* — that was the FGS path we're not taking. (WorkManager respects Doze
  windows by design; the ~15-min latency already accounts for it.)

### Settings redesign
- Auth/certs → a **sub-menu** (rarely touched after first import; show imported CA / `.p12` CN + status).
- Surface **demo mode** + **alarms config** + **button-layout toggle** + **notification mode** in the main
  settings area.

### UI refresh + branding
- Visual redesign, app name/branding, icon set (adaptive launcher icon + in-app iconography). User drives
  creative direction with external design tools + Claude assist. **Lands last**, but can run in parallel
  (design-driven) — don't let feature churn rework finished screens.

## Recommended build order
1. **Arch:** state-source abstraction → WorkManager/AlarmManager wake → Compose Navigation (+ permissions, channels).
2. **Features:** persistent notification (3 modes) → morphing button → both alarms → demo mode.
3. **Settings redesign** (rides on nav).
4. **Branding / UI / icons** (parallel; lands last).

## Open questions
| # | Question | Lean |
|---|---|---|
| V2-1 | Is ~15-min background staleness on the open-door notification acceptable? | **Yes** — awareness aid, not an intrusion alarm (confirm) |
| V2-2 | Morphing button as the default layout? | **Yes**, with a settings toggle to classic |
| V2-3 | Time-of-day alarm: "still open at T" only, or also "opened/closed since"? | Start with **still-open-at-T** |
| V2-4 | Home-screen widget / Quick-Settings tile? | **Out of scope** for v2 (conscious cut) |

## Out of scope (conscious cuts)
- Always-on push / instant open-alert (→ HA + FCM future, D-12).
- Home-screen widget, Quick-Settings tile.
- Camera/visual confirmation (D-11).
