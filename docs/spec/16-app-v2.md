# 16 — Android app v2 (scope & design)

> **Status: SCOPING (2026-06-11). No code yet.** Supersedes the §4D checklist in
> [09-phase-plan.md](09-phase-plan.md) — that section now links here. v1 (all three transports validated
> on-device) is the baseline; this is the redesign on top of it.

## Goal

Turn the working-but-minimal v1 (single `MainActivity`, live-only, foreground-only) into a polished,
background-aware app: it tells you when the garage is open without being open, lets you act in one tap,
and is themeable/brandable — while staying **light on battery** and never depending on an always-on socket.

## Background model — periodic wake, NOT an always-on service ✅

**Decision (2026-06-11, confirmed):** background awareness uses a **periodic wake** (coffee-plug pattern),
not a persistent foreground service. The ~15-min staleness tradeoff (below) is **accepted**.

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

## Main screen layout

One scrolling-free screen, three bands top→bottom: **identity**, **state** (the answer to "is my garage
open?" — dominant), **action** (one tap, thumb-reachable). Connection is ambient at the very bottom.

| Band | Zone | Content | Placement / behaviour |
|---|---|---|---|
| 1 | **Top app bar** | brand wordmark/logo (left) · settings gear (right) | gear → Settings screen (nav). Thin. |
| 1 | **Demo ribbon** | "DEMO MODE — simulated" | appears *only* in demo mode, directly under the app bar, unmistakable accent colour. |
| 2 | **Door-state hero** (dominant, upper-centre) | door illustration reflecting state · large state label · time-in-state subtext | the visual focus; biggest element. See state-visuals below. |
| 3 | **Primary action** (lower third, thumb zone) | the morphing button (or the STOPPED two-button pair) | large, centred; colour by intent (below). |
| — | **Connection footer** (bottom edge) | transport chip · freshness | ambient; see footer below. |

### State visuals (hero + button), per door state

| Door state | Hero illustration | Hero label | Subtext | Action button |
|---|---|---|---|---|
| CLOSED | closed door | **Closed** | "Closed since 09:14" | **Open** (primary) |
| OPEN | open door | **Open** | "Open for 12 min" | **Close** (primary) |
| OPENING | door + upward motion (animated) | **Opening…** | indeterminate (no position %) | **Stop** (caution colour) |
| CLOSING | door + downward motion (animated) | **Closing…** | indeterminate | **Stop** (caution colour) |
| STOPPED_OPENING | partially-open door, halted | **Stopped** | "Stopped while opening" | **Open ｜ Close** pair (V2-3) |
| STOPPED_CLOSING | partially-open door, halted | **Stopped** | "Stopped while closing" | **Open ｜ Close** pair (V2-3) |
| UNKNOWN | muted door + "?" | **Unknown** | "No fresh data — as of HH:MM" | **Engage** (muted/secondary) |

Notes:
- **Motion = indeterminate animation**, never a progress bar — we only have reed + motor signals, no
  position. The animation conveys *direction*, not how far.
- **Button colour semantics:** neutral/primary for Open/Close; **caution** (amber/red) for Stop; muted for
  Engage. The button never shows a suppressed action — it only offers what `pulsesFor` would actually act on.
- **Freshness drives trust:** the hero subtext + footer make staleness visible (esp. important given the
  ~15-min background model — but the main screen is foreground/live, so it's usually "live / updated Ns ago").

### Connection footer + history
Mirror the **coffee app's connection history** exactly:
- A current-status line: **transport label** (`Wi-Fi · direct` / `Wi-Fi · broker` / `Cloud` / `Offline`,
  + `Demo`) and a **freshness** note ("live" / "updated 3s ago" / "as of 10:42").
- Below it, the **connection event log**: newest-first, **capped at 4**, each row `HH:MM   <label>`, muted
  styling — a new row is appended *only when the transport actually changes*.
- **Already implemented in our core:** `ConnectionUi.pushIfChanged` + `LogEntry` ([ConnectionUi.kt](../../app/src/main/java/no/leiflan/garage/api/ConnectionUi.kt))
  match coffee's `ConnectionUi` 1:1 — v2 just needs to *render* the log in the footer (coffee's
  `MainActivity` shows it as a max-4 dark-on-black list). No new logic.

## Features

### Persistent "door open" notification
- **3 modes (configurable):** *always show while open* · *only after open ≥ X minutes* · *off (hide)*.
- **No action buttons** ✅ — tap opens the app; that's it.
- Driven by the periodic wake reading the retained heartbeat.

### Single morphing action button
**The only layout** (no classic three-button option — less to maintain; decided 2026-06-11). One primary
button whose label+action follows door state:
- CLOSED → **Open** · OPEN → **Close** · OPENING/CLOSING → **Stop** · UNKNOWN → **Engage** (best-effort toggle).
- **STOPPED_OPENING / STOPPED_CLOSING** → the **split pair** (Open ｜ Close), decided 2026-06-11 (V2-3).
- **FW ready (single-pulse cmds):** controller accepts `stop` (safety halt, moving-door-only; D-19,
  [spec 14](14-motion-timing-and-pulse-safety.md)).

**Shape:** normally one **wide rectangle, rounded corners**. The STOPPED **pair is the *same* wide button
split down the middle by a divider** into Open ｜ Close — not two separate buttons. Use directional
arrow glyphs (▲ open / ▼ close, or emoji ⬆️⬇️) alongside the labels for at-a-glance meaning.

> **✅ FW IMPLEMENTED & hardware-validated 2026-06-11 (the STOPPED pair's backend).** From a stopped-partway
> door the EcoStar restart **alternates direction** (one impulse = opposite of last direction, D-09). So the
> **reverse** direction is a natural **1 pulse**; the **continue** direction is the **3-pulse dance**
> (start-reverse → stop → start-wanted) the user described. The controller now implements a rolling N-pulse
> sequencer and `pulsesFor` returns **1 (reverse) / 3 (continue)** per state, with `lockMs` sized to 4200 ms
> for the 3-pulse case (spec 14). **Bench-verified by relay edge-counting:** STOPPED_OPENING+open = 3 pulses,
> +close = 1; STOPPED_CLOSING+close = 3, +open = 1; i4 derives both STOPPED states (Pico).
> **Still pending real-door confirmation (Q-03):** *which* physical direction actually continues — the
> alternation assumption. If the door turns out to **resume** instead, flip it with **zero reflash** via the
> KVS `logic_cfg.resumeSameDir` flag (swaps the 1↔3 mapping; the active model is echoed on the heartbeat).
> UX caveat (user-accepted): the continue button makes the door visibly jog the wrong way first.

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
- Surface **demo mode** + **alarms config** + **notification mode** in the main settings area.

### UI refresh + branding
- Visual redesign, app name/branding, icon set (adaptive launcher icon + in-app iconography). User drives
  creative direction with external design tools + Claude assist. **Lands last**, but can run in parallel
  (design-driven) — don't let feature churn rework finished screens.

## Design assets & animation (graphic-designer brief)

What to commission, in deliverable terms. **Everything vector/SVG** unless noted — Android consumes vector
drawables; the build converts SVG→`VectorDrawable` XML (Android Studio "Vector Asset", or `svg2vectordrawable`).

### UI icons (in-app)
- **Format:** SVG on a **24×24 dp** canvas (Material baseline grid), ~**2 dp** padding → ~20×20 live area;
  single-path where possible, **1.5–2 dp** stroke if outlined, **flat single-colour** (we tint in code, so
  deliver black `#000` on transparent — no baked colours).
- **Provide each at 24 dp** (code scales). Also a few at **48 dp** if any icon has fine detail that must
  stay crisp large.
- **List:** gear/settings, alarm/clock, notification/bell, demo/flask, info, chevron/back, signal/Wi-Fi,
  cloud, offline, check/imported, plus the **action glyphs** ▲ open / ▼ close / ■ stop / ⏻ engage.

### Launcher icon (adaptive)
- **Adaptive icon = two layers, each 108×108 dp**, with only the inner **72×72 dp "safe zone"** guaranteed
  visible (outer 18 dp per side is mask/parallax margin — keep nothing critical there):
  - **`ic_launcher_foreground`** — the mark, SVG (or 432×432 px PNG @xxxhdpi if raster).
  - **`ic_launcher_background`** — solid colour or simple shape, same canvas.
- **`ic_launcher_monochrome`** — **NEW for v2** (Android 13 themed icons): a **single-colour alpha** version
  of the foreground on the same 108 dp / 72 dp safe-zone canvas. Goes in the `<adaptive-icon>` `<monochrome>`
  slot. *(Coffee's adaptive-icon has only background+foreground — we add monochrome.)*
- Studio's Image Asset wizard generates all density buckets from these layers; the designer only delivers
  the three layer sources.

### Door illustration + animation
- **Deliver ONE layered door SVG**, not 7 per-state PNGs — separate layers: **frame/opening** (static),
  **door panel** (the moving slab, ideally segmented), optional **shadow/interior**. Code composes every
  state (CLOSED/OPEN/partial/UNKNOWN) by positioning the panel, and animates motion by translating/clipping
  it. One artwork drives all states + the animation; far less to maintain.
- **How we realise motion (recommended):** **Compose-driven animation of the layered vector** — animate the
  panel's offset/clip in code. We only have *direction*, not position (reed + motor signals, no encoder), so
  OPENING/CLOSING is an **indeterminate looping** slide, never a progress bar. No extra dependency, fully
  testable.
- **Alternative:** **Lottie** (designer exports After Effects → JSON) if richer motion is wanted — but adds
  a runtime dependency + AE/Lottie tooling on the designer. Default to the Compose approach unless the door
  motion needs more than a slide.
- **Brand/colour:** deliver the palette (light + dark theme) and the door artwork in flat, tintable layers
  so it can follow the app theme.

### Mock
- See **[16-app-v2-mock.svg](16-app-v2-mock.svg)** — 4 representative frames (CLOSED · OPENING · OPEN ·
  STOPPED-pair). Schematic, for layout iteration; not final art.

## Recommended build order
1. **Arch:** state-source abstraction → WorkManager/AlarmManager wake → Compose Navigation (+ permissions, channels).
2. **Features:** persistent notification (3 modes) → morphing button → both alarms → demo mode.
3. **Settings redesign** (rides on nav).
4. **Branding / UI / icons** (parallel; lands last).

## Resolved
- **V2-1** ~15-min background staleness — **accepted** (2026-06-11).
- **V2-2** Two layouts? — **No.** Morphing button is the *only* layout; no classic option (2026-06-11).
- **V2-3** STOPPED button — **the split pair** (one wide button divided into Open ｜ Close), with arrow
  glyphs (2026-06-11). Both halves genuinely act — backed by the 3-pulse FW path below.
- **V2-6** STOPPED 3-pulse "continue" FW path — **IMPLEMENTED & hardware-validated 2026-06-11** (not
  deferred). Rolling N-pulse sequencer + `resumeSameDir` KVS flag; relay-edge-counted on the bench. Only the
  *physical* alternation-vs-resume assumption awaits the real door (Q-03), flippable without reflash.

## Open questions
| # | Question | Lean |
|---|---|---|
| V2-4 | Time-of-day alarm: "still open at T" only, or also "opened/closed since"? | Start with **still-open-at-T** |
| V2-5 | Home-screen widget / Quick-Settings tile? | **Out of scope** for v2 (conscious cut) |

## Out of scope (conscious cuts)
- Always-on push / instant open-alert (→ HA + FCM future, D-12).
- Home-screen widget, Quick-Settings tile.
- Camera/visual confirmation (D-11).
