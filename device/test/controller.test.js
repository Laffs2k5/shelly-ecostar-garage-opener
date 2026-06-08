// Tests for the S1 controller script. Run: scripts/test-device.sh
const { test } = require("node:test");
const assert = require("node:assert");
const { createHarness } = require("./harness");

const CFG = { script: "controller.js", mqttConfig: { topic_prefix: "devices/garage-controller", client_id: "garage-controller" } };
const mk = (o) => createHarness(Object.assign({}, CFG, o));

// ---------- pure: command -> pulse count (spec 02 table + D-09) ----------
test("pulsesFor: toggle is always one pulse", function () {
  const { pulsesFor } = mk();
  for (const s of ["CLOSED", "OPEN", "OPENING", "CLOSING", "STOPPED_OPENING", "STOPPED_CLOSING", "UNKNOWN"]) {
    assert.equal(pulsesFor("toggle", s), 1, "toggle@" + s);
  }
});

test("pulsesFor: open", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("open", "CLOSED"), 1);
  assert.equal(pulsesFor("open", "STOPPED_CLOSING"), 1);
  assert.equal(pulsesFor("open", "CLOSING"), 2);          // stop, then reverse
  assert.equal(pulsesFor("open", "OPENING"), 0);          // suppress
  assert.equal(pulsesFor("open", "OPEN"), 0);             // suppress
  assert.equal(pulsesFor("open", "UNKNOWN"), 1);          // best-effort
});

test("pulsesFor: close", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("close", "OPEN"), 1);
  assert.equal(pulsesFor("close", "STOPPED_OPENING"), 1);
  assert.equal(pulsesFor("close", "OPENING"), 2);
  assert.equal(pulsesFor("close", "CLOSING"), 0);         // suppress
  assert.equal(pulsesFor("close", "CLOSED"), 0);          // suppress
  assert.equal(pulsesFor("close", "UNKNOWN"), 1);
});

// ---------- boot ----------
test("boot: relay configured safe (detached, off, 0.5s auto-off) + subscribes + heartbeat", function () {
  const h = mk();
  assert.deepEqual(h.switchConfig, { in_mode: "detached", initial_state: "off", auto_on: false, auto_off: true, auto_off_delay: 0.5 });
  assert.ok(h.subs["devices/garage-controller/command"], "subscribed to command topic");
  const hb = h.heartbeats()[0];
  assert.equal(hb.topic, "devices/garage-controller/heartbeat");
  assert.equal(hb.retain, true);
  assert.equal(h.alives()[0].topic, "mon/garage-controller/alive");
  assert.equal(h.switchSets.length, 0, "no pulse on boot (boot-to-safe)");
});

// ---------- door picture from the i4 ----------
test("door_state POST updates the held picture, and it's used for decisions", function () {
  const h = mk();
  const out = h.post("door_state", { body: JSON.stringify({ state: "OPEN", dir: "opening", since: 5, ts: 9, v: 1 }) });
  assert.equal(out.code, 200);
  // 'open' must now be suppressed because the door is OPEN -> proves the picture was updated + consulted
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0);
  assert.equal(h.lastHeartbeat().door.state, "OPEN");
});

// ---------- commands -> pulses ----------
function setDoor(h, state) { h.post("door_state", { body: JSON.stringify({ state: state, ts: 1 }) }); }

test("HTTP command: open while CLOSED -> exactly one pulse", function () {
  const h = mk(); setDoor(h, "CLOSED");
  const out = h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1);
  assert.equal(h.switchSets[0].on, true);
  assert.equal(JSON.parse(out.body).pulses, 1);
});

test("command suppressed when already going the right way (open while OPENING)", function () {
  const h = mk(); setDoor(h, "OPENING");
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0, "no pulse — would stop the door");
  assert.equal(h.lastHeartbeat().lastPulses, 0);
});

test("stop-then-reverse: open while CLOSING -> two pulses (2nd is delayed)", function () {
  const h = mk(); setDoor(h, "CLOSING");
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1, "first pulse immediate");
  assert.ok(h.timers.some(function (t) { return !t.repeat; }), "second pulse scheduled");
  h.fireOneShots();
  assert.equal(h.switchSets.length, 2, "reverse pulse fired after the gap");
});

test("MQTT command works (plain string and JSON)", function () {
  const h = mk(); setDoor(h, "CLOSED");
  h.sendCmd("open");
  assert.equal(h.switchSets.length, 1);
  setDoor(h, "OPEN");
  h.sendCmd(JSON.stringify({ cmd: "close" }));
  assert.equal(h.switchSets.length, 2);
});

test("invalid command is ignored (no pulse)", function () {
  const h = mk(); setDoor(h, "CLOSED");
  h.post("command", { query: "cmd=banana" });
  h.sendCmd("");
  assert.equal(h.switchSets.length, 0);
});

test("UNKNOWN door state -> best-effort single pulse for open/close", function () {
  const h = mk(); // no door_state posted yet -> UNKNOWN
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1);
});

// ---------- heartbeat shape ----------
test("heartbeat carries relay, lastCmd, door and ts", function () {
  const h = mk(); setDoor(h, "CLOSED");
  h.post("command", { query: "cmd=open" });
  const hb = h.lastHeartbeat();
  for (const k of ["relay", "lastCmd", "lastPulses", "door", "ts", "v"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(hb, k), "missing field " + k);
  }
  assert.equal(hb.lastCmd, "open");
  assert.equal(hb.door.state, "CLOSED");
});

// ---------- watchdog ----------
test("watchdog reboots S1 after a broker-down threshold; safe when connected", function () {
  const h = mk();
  h.sandbox.WD.on = true; h.sandbox.WD.mqttEnabled = true; h.sandbox.WD.mqttMs = 1000; h.sandbox.WD.wifiMs = 9e9;
  h.setNet(true, true); h.tick(3);
  assert.equal(h.reboots, 0, "no reboot while broker connected");
  h.setNet(true, false); h.tick(3);   // TICK_MS=1000 → mqttDown hits 1000 within a few ticks
  assert.ok(h.reboots >= 1, "reboot once broker is down past threshold");
});
