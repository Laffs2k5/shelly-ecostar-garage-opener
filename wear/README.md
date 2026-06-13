# wear/

Wear OS companion for the Shelly EcoStar garage opener (built/tested on a OnePlus Watch 2R).
Kotlin + Wear Compose.

It does **not** connect to the broker or the devices itself — it **rides the phone over the Wear Data
Layer**: the phone app publishes door state to `/garage/state`, and the watch sends open/close/stop to
`/garage/cmd` (a `WearableListenerService` on the phone runs the command even when the phone app is
killed). Design + rationale: [docs/spec/17-wear-os-exploration.md](../docs/spec/17-wear-os-exploration.md).

**Same `applicationId` (`no.leiflan.garage`) and the same committed debug signing key as `app/`** — both
are required for the Data Layer to pair (spec 17). The pure logic (`DoorModel`, `ActionModel`,
`GarageApi`, theme) is **copied verbatim from `app/`** and guarded byte-identical by
`scripts/check-wear-sync.sh` — edit it in `app/` then re-sync; never let the copies diverge.

## Build (Windows toolchain, driven from WSL)

```bash
WB_SRC=wear WB_NAME=garage-wear scripts/win-build.sh assembleDebug
```

The released watch APK (`shelly-ecostar-garage-wear-debug.apk`) ships on the
[Releases](https://github.com/Laffs2k5/shelly-ecostar-garage-opener/releases) page, built by
`.github/workflows/release.yml` on a `vX.Y.Z` tag. CI (`build.yml`) asserts the phone and watch share an
identical signing certificate, so updates pair and never wipe data.
