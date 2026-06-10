// Tests for the i4 monitor script. Run: scripts/test-device.sh  (or: node --test device/test/)
const { test } = require("node:test");
const assert = require("node:assert");
const { createHarness } = require("./harness");

// ---------- pure derivation (spec 02) ----------
test("derive: reeds win and map to end states", function () {
  const { derive } = createHarness();
  assert.equal(derive(true, false, false, false, "").state, "CLOSED");
  assert.equal(derive(false, true, false, false, "").state, "OPEN");
  // reed beats a lingering motor signal (coast overlap, spec 02)
  assert.equal(derive(true, false, false, true, "closing").state, "CLOSED");
  assert.equal(derive(false, true, true, false, "opening").state, "OPEN");
});

test("derive: motor signals map to moving states and set direction", function () {
  const { derive } = createHarness();
  let d = derive(false, false, true, false, "");
  assert.equal(d.state, "OPENING"); assert.equal(d.dir, "opening");
  d = derive(false, false, false, true, "");
  assert.equal(d.state, "CLOSING"); assert.equal(d.dir, "closing");
});

test("derive: mid-travel stop uses last direction", function () {
  const { derive } = createHarness();
  assert.equal(derive(false, false, false, false, "opening").state, "STOPPED_OPENING");
  assert.equal(derive(false, false, false, false, "closing").state, "STOPPED_CLOSING");
  assert.equal(derive(false, false, false, false, "").state, "UNKNOWN"); // bootstrap, never moved
});

test("derive: impossible combinations are faults -> UNKNOWN", function () {
  const { derive } = createHarness();
  assert.equal(derive(true, true, false, false, "").state, "UNKNOWN");   // both reeds
  assert.equal(derive(false, false, true, true, "").state, "UNKNOWN");   // both motor dirs
});

// ---------- boot behaviour ----------
test("boot: no inputs -> UNKNOWN, publishes a retained heartbeat + an alive", function () {
  const h = createHarness();
  assert.equal(h.state(), "UNKNOWN");
  const hb = h.heartbeats()[0];
  assert.equal(hb.retain, true, "heartbeat must be retained");
  assert.equal(hb.topic, "devices/garage-monitor/heartbeat");
  assert.equal(h.alives().length, 1);
  assert.equal(h.alives()[0].retain, false, "alive must NOT be retained");
  assert.equal(h.alives()[0].topic, "mon/garage-monitor/alive");
});

test("boot: door already closed -> initial state CLOSED", function () {
  const h = createHarness({ inputs: { c: true } });
  assert.equal(h.state(), "CLOSED");
});

// ---------- live transitions through the tick loop ----------
test("full cycle: CLOSED -> OPENING -> OPEN -> CLOSING -> CLOSED", function () {
  const h = createHarness({ inputs: { c: true } });
  assert.equal(h.state(), "CLOSED");
  h.setInputs(false, false, true, false); h.settle();   // motor opening
  assert.equal(h.state(), "OPENING");
  h.setInputs(false, true, false, false); h.settle();   // open reed
  assert.equal(h.state(), "OPEN");
  h.setInputs(false, false, false, true); h.settle();   // motor closing
  assert.equal(h.state(), "CLOSING");
  h.setInputs(true, false, false, false); h.settle();   // closed reed
  assert.equal(h.state(), "CLOSED");
});

test("stop mid-travel yields direction-aware STOPPED state, then reverse", function () {
  const h = createHarness({ inputs: { c: true } });
  h.setInputs(false, false, false, true); h.settle();   // CLOSING
  assert.equal(h.state(), "CLOSING");
  h.setInputs(false, false, false, false); h.settle();  // motor stops, no reed
  assert.equal(h.state(), "STOPPED_CLOSING");
  h.setInputs(false, false, true, false); h.settle();   // 2nd pulse reverses -> opening
  assert.equal(h.state(), "OPENING");
});

test("debounce: a sub-threshold transient does not change state", function () {
  const h = createHarness({ inputs: { c: true } });
  assert.equal(h.state(), "CLOSED");
  const before = h.heartbeats().length;
  // single-tick blip to OPENING then immediately back to CLOSED -> never stable -> ignored
  h.setInputs(false, false, true, false); h.tick(1);
  h.setInputs(true, false, false, false); h.tick(1);
  assert.equal(h.state(), "CLOSED");
  assert.equal(h.heartbeats().length, before, "no new heartbeat for a filtered transient");
});

test("reed-then-motor-coast overlap settles to the end state without a glitch", function () {
  const h = createHarness({ inputs: { c: false, o: false, op: false, cl: true } });
  h.settle();
  assert.equal(h.state(), "CLOSING");
  // closed reed engages while motor still coasting (both c and cl true) -> reed wins -> CLOSED
  h.setInputs(true, false, false, true); h.settle();
  assert.equal(h.state(), "CLOSED");
  // motor releases; still CLOSED, no spurious transition — but we DO push once (moving:false) so the
  // controller's at-rest guard learns the motor stopped (Q-16 P2). State stays CLOSED (no glitch).
  const n = h.heartbeats().length;
  h.setInputs(true, false, false, false); h.settle();
  assert.equal(h.state(), "CLOSED", "no spurious transition on motor-stop");
  assert.equal(h.heartbeats().length, n + 1, "one push on motor-stop carrying moving:false");
});

// ---------- departure vs end-of-travel reverse kick (Q-16 / spec 14, garage data 2026-06-10) ----------
test("derive: brief opposite-motor (gate NOT met) = end-reverse kick -> holds the end state", function () {
  const { derive } = createHarness();
  assert.equal(derive(true, false, true, false, "closing", false).state, "CLOSED"); // closed-reed + opening blip
  assert.equal(derive(false, true, false, true, "opening", false).state, "OPEN");   // open-reed + closing blip
});
test("derive: sustained opposite-motor (gate met) = departure -> moving state", function () {
  const { derive } = createHarness();
  assert.equal(derive(true, false, true, false, "closing", true).state, "OPENING"); // departing closed
  assert.equal(derive(false, true, false, true, "opening", true).state, "CLOSING"); // departing open
});
test("tick: ~140-220ms reverse kick at close arrival does NOT glitch CLOSED->OPENING", function () {
  const h = createHarness({ inputs: { c: true } });
  h.settle();
  assert.equal(h.state(), "CLOSED");
  const n = h.heartbeats().length;
  h.setInputs(true, false, true, false); h.tick(2);   // opening kick ~200ms, closed reed still engaged
  h.setInputs(true, false, false, false); h.tick(2);  // kick ends
  assert.equal(h.state(), "CLOSED", "reverse kick absorbed — no spurious OPENING");
  assert.equal(h.heartbeats().length, n, "no extra heartbeat from the kick");
});
test("tick: sustained opening while closed reed engaged (departure) -> OPENING past the gate", function () {
  const h = createHarness({ inputs: { c: true } });
  h.settle();
  h.setInputs(true, false, true, false); h.tick(5);   // >= GATE_TICKS with closed reed still engaged
  assert.equal(h.state(), "OPENING", "departure detected once opposite motor persists past the gate");
});
test("tick: symmetric at open end — brief closing kick stays OPEN, sustained closing departs", function () {
  const h = createHarness({ inputs: { o: true } });
  h.settle();
  assert.equal(h.state(), "OPEN");
  h.setInputs(false, true, false, true); h.tick(2); h.setInputs(false, true, false, false); h.tick(2);
  assert.equal(h.state(), "OPEN", "closing kick at open end absorbed");
  h.setInputs(false, true, false, true); h.tick(5);
  assert.equal(h.state(), "CLOSING", "sustained closing = departure from open");
});

// ---------- outputs: HTTP POST to controller (D-10) ----------
test("controller POST: skipped when no controller_url is set", function () {
  const h = createHarness({ inputs: { c: true } });
  h.setInputs(false, false, true, false); h.settle();
  assert.equal(h.posts.length, 0, "must not POST when S1 is unconfigured");
});

test("controller POST: fires on state change when controller_url is set", function () {
  const h = createHarness({ inputs: { c: true }, controllerUrl: "http://10.0.0.5/script/1/door_state" });
  h.setInputs(false, false, true, false); h.settle();
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].url, "http://10.0.0.5/script/1/door_state");
  assert.equal(JSON.parse(h.posts[0].body).state, "OPENING");
});

// ---------- outputs: MQTT skipped when disconnected (never blocks) ----------
test("MQTT disconnected: no publishes, but derivation/endpoint still work", function () {
  const h = createHarness({ inputs: { c: true }, mqttConnected: false });
  h.setInputs(false, false, true, false); h.settle();
  assert.equal(h.published.length, 0, "nothing published while MQTT down");
  assert.equal(h.endpointState().state, "OPENING", "state still derived + exposed via HTTP");
});

// ---------- HTTP /state endpoint ----------
test("/state endpoint returns the current door picture", function () {
  const h = createHarness({ inputs: { o: true } });
  const s = h.endpointState();
  assert.equal(s.state, "OPEN");
  assert.equal(s.inputs.o, true);
  assert.equal(s.v, 1);
});

// ---------- heartbeat payload shape (spec 03 / D-12) ----------
test("heartbeat carries state, dir, inputs, since, ts and rssi for HA", function () {
  const h = createHarness({ inputs: { c: true } });
  const hb = h.lastHeartbeat();
  for (const k of ["state", "dir", "inputs", "since", "ts", "rssi", "v"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(hb, k), "missing heartbeat field: " + k);
  }
  assert.equal(hb.rssi, -55, "rssi from wifi status");
});

test("heartbeat rssi is null when wifi rssi unavailable", function () {
  const h = createHarness({ inputs: { c: true }, wifiRssi: null });
  assert.equal(h.lastHeartbeat().rssi, null);
});

// ---------- watchdog (Phase 7) ----------
test("watchdog pure decision: wifi/mqtt thresholds + disable", function () {
  const { wdReboot } = createHarness();
  const cfg = { on: true, wifiMs: 1000, mqttMs: 2000 };
  assert.equal(wdReboot(0, 0, cfg), "");
  assert.equal(wdReboot(1000, 0, cfg), "wifi");
  assert.equal(wdReboot(0, 2000, cfg), "mqtt");
  assert.equal(wdReboot(500, 1500, cfg), "");                 // both under threshold
  assert.equal(wdReboot(9e9, 9e9, { on: false, wifiMs: 1, mqttMs: 1 }), ""); // disabled
});

test("watchdog reboots after the broker-down threshold (wifi up)", function () {
  const h = createHarness();
  h.sandbox.WD.on = true; h.sandbox.WD.mqttEnabled = true;
  h.sandbox.WD.mqttMs = 100; h.sandbox.WD.wifiMs = 9e9;       // short broker threshold
  h.setNet(true, false);                                      // wifi up, broker down
  h.tick(5);
  assert.ok(h.reboots >= 1, "should reboot when the broker is down past the threshold");
});

test("watchdog: no reboot while connected, or when broker disabled", function () {
  const h = createHarness();
  h.sandbox.WD.on = true; h.sandbox.WD.mqttEnabled = true; h.sandbox.WD.mqttMs = 100;
  h.setNet(true, true); h.tick(10);                           // all good
  assert.equal(h.reboots, 0);
  h.sandbox.WD.mqttEnabled = false; h.setNet(true, false); h.tick(10); // broker down but MQTT disabled
  assert.equal(h.reboots, 0);
});
