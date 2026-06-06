# device/

mJS scripts for the two Shellys. Built/minified before deploy (heap is tiny — see `CLAUDE.md`).

- `monitor.js` — Shelly Plus i4 DC: derive door state, HTTP-POST to controller, publish MQTT + `mon/alive`. *(Phase 2)*
- `controller.js` — Shelly 1 Gen3: command logic + relay pulse. *(Phase 3)*
- `test/` — Node `node:test` harness mocking the Shelly runtime (pure logic, no hardware).

Deploy the **minified** artifact via RPC `Script.PutCode` (chunked ≤ ~1200 chars). Keep readable source in git.
