# app/ — EcoStar Garage (Android, Kotlin/Compose)

Two-device-aware controller: shows door state from the **i4** (`garage-monitor`) and sends
open/close/toggle to the **S1** (`garage-controller`), roaming HTTP-direct → local broker (mTLS) → cloud.
Adapted from the `shelly-coffee-timer` app (settings + local-HTTP + hybrid-broker patterns). Package
`no.leiflan.garage`.

## Status (Phase 4B)

**Done (this pass):**
- Build config (`build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`, wrapper props), manifest, minimal theme.
- Pure, JVM-tested core under `api/`:
  - `GarageApi` — `decide()` (HTTP-direct > local > cloud > offline), command validation + URL builders,
    plus the on-device HTTP-direct calls (`fetchLocalDoor`/`sendLocalCommand`) and JSON parse.
  - `DoorModel` — the 7-state value type + label/duration helpers.
  - `ConnectionUi` — connection labels + newest-first capped event log.
  - `MqttTls` — cert→`SSLSocketFactory` builder (copied verbatim from the proven reference).
- Unit tests (`src/test/...`) + throwaway TLS fixtures (`src/test/resources/test_ca.crt`, `test_client.p12`, pass `testpass`).

**Pending (next pass):**
- `api/MqttTransport.kt` — Paho mqttv3: local mTLS (`ssl://<broker>:8883`) + cloud WSS
  (`wss://<host>:8084/mqtt`), subscribe `devices/garage-monitor/heartbeat`, publish
  `devices/garage-controller/command` (QoS 1, **non-retained**), client-id = cert CN `garage-app`,
  `isAutomaticReconnect=false`, keepalive 60 s.
- `MainActivity.kt` — Compose Settings + Main screens (door card + Open/Close/Toggle + connection
  footer), runtime `.p12`/CA import, lifecycle-gated poll loop.
- App identity from the broker (Phase 4A): cert `garage-app` + cloud user/pass (spec 11).

## Building (Windows — NOT WSL)

The APK can't be built in WSL (aapt2 is x86_64-only) and there's no Windows-ARM emulator — **build with
Android Studio on Windows and test on a physical device** (NEW-PROJECT-GUIDE §3). Open the `app/` folder
in Android Studio; it generates the Gradle wrapper jar + `gradlew` on import. Unit tests:
`gradlew testDebugUnitTest`. Nothing identity-specific is bundled — the user enters settings + imports
the `.p12`/CA at runtime (D-06).
