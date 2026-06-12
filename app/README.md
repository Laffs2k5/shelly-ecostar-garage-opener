# app/ — Garage control (Android, Kotlin/Compose)

Two-device-aware controller: shows door state from the **i4** (`garage-monitor`) and sends
open/close/**stop**/engage to the **S1** (`garage-controller`), roaming HTTP-direct → local broker (mTLS)
→ cloud. Adapted from the `shelly-coffee-timer` app (settings + local-HTTP + hybrid-broker patterns).
Package `no.leiflan.garage`. **Full v2 scope/design: [spec 16](../docs/spec/16-app-v2.md).**

## Status — v2 shipped, validated on-phone 2026-06-12

App v2 is built and bench-validated across all three transports incl. background drive (see
`docs/testing/HW-VALIDATION.md`). What's in the box:

- **Pure, JVM-tested core (`api/`)** — `GarageApi` (`decide` HTTP-direct > local > cloud > offline, command
  validation/URLs, HTTP-direct calls, JSON parse, `isStale` out-of-order guard, heartbeat parse), `DoorModel`
  (7 states), `ConnectionUi` (labels + capped log), `ActionModel` (morphing button / STOPPED split),
  `DemoEngine` (offline simulation), `NotifyRules`, `BackgroundFollow`, `MqttTls`.
- **`MqttTransport`** — Paho: local mTLS (`ssl://…:8883`) + cloud WSS (`wss://…:8084/mqtt`), subscribe
  `…/heartbeat`, publish `…/command` (QoS 1, non-retained), client-id = CN `garage-app`, poll-driven
  reconnect; **event-driven push** via `onUpdate`.
- **UI (`ui/`, `MainActivity`)** — Cyber Garage Control neon theme; three bands (BrandBar · animated
  `DoorSchematic` + state · morphing action button incl. STOPPED split · connection footer + log); demo
  toggle; **pull-to-refresh** connection re-roam; **self-clearing action lock**; runtime `.p12`/CA import;
  Settings (transports + notifications + alarms).
- **Notifications + periodic-wake (`notification/`)** — open-door notification (3 modes) + two alarms
  (open-too-long, time-of-day) via `Notifier`/`NotifyController`; `DoorCheckWorker` (WorkManager) +
  `TimeAlarm` (AlarmManager exact) + `Scheduler`.
- **Wear OS bridge (`wear/`)** — `WearLink` publishes the door picture to the watch; `GarageWearService`
  runs watch commands even when the app is backgrounded (spec 17).
- Adaptive/monochrome launcher icon from the cyan brand mark; throwaway TLS test fixtures in `src/test/`.

**Remaining:** visual polish only — Settings grouping, on-phone visual refinement, optional Compose Navigation.

## Building (Windows — NOT WSL)

The APK can't be built in WSL (aapt2 is x86_64-only) and there's no Windows-ARM emulator — **build with
Android Studio on Windows and test on a physical device** (NEW-PROJECT-GUIDE §3). Open the `app/` folder
in Android Studio; it generates the Gradle wrapper jar + `gradlew` on import. Unit tests:
`gradlew testDebugUnitTest`. Nothing identity-specific is bundled — the user enters settings + imports
the `.p12`/CA at runtime (D-06).
