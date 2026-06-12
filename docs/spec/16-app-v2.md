# 16 — Android app v2 (scope & design)

> **Status: IN PROGRESS (2026-06-11).** Supersedes the §4D checklist in [09-phase-plan.md](09-phase-plan.md).
> v1 (all three transports validated on-device) is the baseline; this is the redesign on top of it.
>
> **All functionality is built (compiles + JVM unit tests pass on the Windows toolchain).** Cyber Garage
> Control neon theme · main screen (three bands, animated `DoorSchematic`, morphing button, STOPPED
> split-divider button, connection footer + mono log) · `ActionModel` · `stop` command · `DemoEngine` +
> Settings toggle (zero comms) · **notifications (3 modes) + both alarms** (`NotifyRules` pure+tested,
> `Notifier` channels, `NotifyController` latches) · **periodic-wake** (`DoorCheckWorker` WorkManager +
> `TimeAlarm` AlarmManager exact + `Scheduler`) · permissions/channels · Settings UI for it all · app name
> + launcher icon. **Demo mode drives the real on-device notifications/alarms** from simulated state.
> **Remaining = on-phone validation + polish:** notification display / alarm fire / Doze behaviour /
> exact-alarm prompt (drive via demo), settings-redesign polish, adaptive+monochrome icon layers, and the
> visual pass (screenshots → iterate). The runtime device-coupled behaviour can only be confirmed on-phone,
> per the project's validate-on-hardware discipline.

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

## Visual design — locked 2026-06-11

Based on **`docs/visual_design_ideas/`** (Stitch "Cyber Garage Control" mocks + `cyber_garage_control/DESIGN.md`
+ two iconikai icon packs). The DESIGN.md is the source of truth for tokens; it already maps to our
three-band layout (Identity / State / Action).

- **Theme:** Cyber Garage Control — dark-only Material 3 + neon. Base `#121212`; **primary neon cyan
  `#00f2ff`** (open/close, connected, safe); **caution orange `#ff9500`** (stop, motion states); neon outer
  glows (15–30% blur) instead of Material shadows. Roboto Flex (display/headline/body) + JetBrains Mono
  (technical readouts: state subtext, connection log, timestamps).
- **Structure:** **single screen + Settings** (gear → Settings; no bottom nav). History lives in the footer.
- **Bands:** Identity (brand wordmark + gear) · State (door schematic + big state label + mono subtext) ·
  Action (full-width neon button; **STOPPED = one wide button split by a center divider** into Open ｜ Close,
  sharp inner / rounded outer corners — *not* two separate buttons; user's call overrides the stopped mock).
- **Action colours:** cyan for Open/Close/Engage; **orange for Stop** with an active glow during motion.
- **Connection footer:** transport line (dot + `Wi-Fi · direct live`) + mono history log (newest-first, cap 4).
- **Launcher icon:** **custom adaptive icon built from the cyan garage brand mark** (`ic_launcher_*`
  vectors: dark + neon-glow background, cyan foreground, monochrome layer). Replaced the glassy iconikai
  PNGs (user preferred the brand mark). Density PNGs removed; adaptive XML only (minSdk 35).
- **App name:** **"Garage control"** (also the top-bar wordmark).
- **Iterate later:** install on phone → screenshots → refine together (per user).

## Design assets & animation (graphic-designer brief)

What to commission, in deliverable terms. **Everything vector/SVG** unless noted — Android consumes vector
drawables; the build converts SVG→`VectorDrawable` XML (Android Studio "Vector Asset", or `svg2vectordrawable`).

### UI icons (in-app) — designer brief (2026-06-11)

The app currently fakes a few of these with Unicode glyphs (`▦`, `⚙`, `▲▼■`) — they render inconsistently
across devices and aren't on-brand. We want a proper set.

- **Format:** **SVG**, each on a **24×24 dp** artboard (Material baseline grid) with ~**2 dp** safe padding
  (≈20×20 live area). **Flat, single-colour, black `#000` on transparent** — the app tints them in code
  (neon cyan / caution orange / grey per context), so **bake no colour**. Outlined style, **2 dp** stroke,
  rounded joins/caps to match the neon aesthetic. Deliver at 24 dp; add a **48 dp** version for any with
  fine detail (the action icons especially, since they sit in 64 dp buttons).
- **Style:** thin neon-line look (think the door schematic) — consistent weight, geometric, slightly rounded.

| Icon | Where it's used | What it represents |
|---|---|---|
| **Brand mark** | top-left of the banner, beside "GARAGE" | the app's identity — a garage/door motif; should echo the **launcher icon** (pack 2: garage + roof). Deliver also as a wider **lockup** (mark + "GARAGE" wordmark) option. |
| **Settings (gear)** | top-right of the banner → opens Settings | configuration |
| **Open (▲ up)** | action button @ CLOSED / split-pair left | raise/open the door |
| **Close (▼ down)** | action button @ OPEN / split-pair right | lower/close the door |
| **Stop (■ square)** | action button while OPENING/CLOSING | halt a moving door (safety) — pairs with caution-orange |
| **Engage (power/?)** | action button @ UNKNOWN | best-effort toggle when state is unknown |
| **Connection dot** | footer status (currently a filled dot) | transport health — green=connected, red=offline (a simple disc is fine; optional Wi-Fi/cloud glyphs) |
| **Settings-row icons** (optional) | notification, open-too-long alarm, time-of-day alarm, demo | bell · clock-with-warning · alarm-clock · flask/"sim" — small leading icons for the settings rows |

Sizes recap: **24 dp** master, **48 dp** for the 4 action icons. One colour (black), transparent bg, SVG.
The brand mark + action set are the priority; the settings-row icons are nice-to-have.

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
