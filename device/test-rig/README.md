# device/test-rig/ — Pico i4-input simulator

A Raspberry Pi Pico (MicroPython) that drives the Shelly Plus i4 DC's four inputs through optocouplers,
so we can develop/test/fix the i4 mJS with **no wiring to the real garage**. Full design + wiring:
[docs/spec/12](../../docs/spec/12-test-rig-and-wiring.md).

- **`main.py`** — deployed to the Pico as `main.py`. Defines 4 output channels (GP2–GP5 = SW1–SW4) and
  helpers (`sw`, `state`, `set_closed/open/opening/closing/stopped`, `pulse`). `GPIO HIGH = asserted`.
- Driven from WSL via [`scripts/pico.sh`](../../scripts/pico.sh) (powershell → Windows Python →
  `mpremote` → COM5). State persists across calls via `mpremote resume`.

## Quick start

```bash
scripts/pico.sh init          # clean start after (re)powering the Pico
scripts/pico.sh closing       # assert SW4 (motor closing)
scripts/i4-watch.sh           # (other terminal) watch the i4 see it -> SW4=1
scripts/pico.sh init          # release all
```

## Redeploy main.py to the Pico

```bash
cp device/test-rig/main.py /mnt/c/temp/pico/main.py
powershell.exe -NoProfile -Command 'python -m mpremote connect COM5 fs cp C:\temp\pico\main.py :main.py'
scripts/pico.sh init
```

## Environment facts (this machine)

- Pico = **Raspberry Pi Pico H, RP2040**, MicroPython **v1.28.0**, USB on **Windows** as **COM5**
  (VID:PID `2E8A:0005`).
- Tooling: `mpremote` installed in Windows Python (`python -m mpremote`). WSL can't see the COM port
  directly (no usbipd), hence the `powershell.exe` hop.
