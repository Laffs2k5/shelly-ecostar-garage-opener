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

test("pulsesFor: stop halts a moving door, no-op otherwise (never starts a stopped door)", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("stop", "OPENING"), 1);
  assert.equal(pulsesFor("stop", "CLOSING"), 1);
  assert.equal(pulsesFor("stop", "OPEN"), 0);
  assert.equal(pulsesFor("stop", "CLOSED"), 0);
  assert.equal(pulsesFor("stop", "STOPPED_OPENING"), 0);
  assert.equal(pulsesFor("stop", "STOPPED_CLOSING"), 0);
  assert.equal(pulsesFor("stop", "UNKNOWN"), 0);        // crucially: don't risk starting an unknown door
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

test("heartbeat carries rssi (our payload, not mon/alive)", function () {
  const h = mk();
  const hb = JSON.parse(h.heartbeats()[0].msg);
  assert.ok(Object.prototype.hasOwnProperty.call(hb, "rssi"), "heartbeat has rssi");
  assert.equal(hb.rssi, -55);
  // mon/alive must stay minimal (ts only) — monitor-spec bound, no rssi
  const alive = JSON.parse(h.alives()[0].msg);
  assert.ok(!Object.prototype.hasOwnProperty.call(alive, "rssi"), "alive must NOT carry rssi");
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

test("door_state with empty/missing body does not crash, returns bad, keeps prior picture", function () {
  const h = mk();
  h.post("door_state", { body: JSON.stringify({ state: "OPEN", ts: 9 }) });   // seed a good picture
  const out = h.post("door_state", { body: "" });                              // stray GET / empty POST
  assert.equal(out.code, 200);
  assert.equal(out.body, "bad");                                               // ignored, not crashed
  // prior picture intact: 'open' is still suppressed (door is OPEN) + heartbeat confirms OPEN
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0);
  assert.equal(h.lastHeartbeat().door.state, "OPEN");
});

// ---------- commands -> pulses ----------
function setDoor(h, state) { h.post("door_state", { body: JSON.stringify({ state: state, ts: 1 }) }); }
function setDoorMoving(h, state, op, cl) {  // picture with motor running (op/cl) -> DOOR.moving=true
  h.post("door_state", { body: JSON.stringify({ state: state, inputs: { c: false, o: false, op: !!op, cl: !!cl }, ts: 1 }) });
}

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
  h.fireOneShots();             // clear the pulse lockout (real commands are seconds apart)
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

// ---------- at-rest guard: don't pulse a door that's still moving into an end (Q-16 Problem 2) ----------
test("at-rest guard: command while motor still running into an end is queued, not pulsed", function () {
  const h = mk();
  setDoorMoving(h, "CLOSED", false, true);          // arrived CLOSED but motor still closing (overlap)
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0, "no pulse while moving — a pulse would STOP the door near closed");
  assert.equal(h.lastHeartbeat().queued, "open", "command queued");
});
test("at-rest guard: queued command fires once the motor stops", function () {
  const h = mk();
  setDoorMoving(h, "CLOSED", false, true);
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0);
  setDoorMoving(h, "CLOSED", false, false);         // motor stopped -> at rest -> queued cmd fires
  assert.equal(h.switchSets.length, 1, "queued open fired at rest");
  assert.equal(h.lastHeartbeat().queued, "", "queue cleared");
});
test("at-rest guard: queued command is dropped after the timeout", function () {
  const h = mk();
  setDoorMoving(h, "CLOSED", false, true);
  h.post("command", { query: "cmd=open" });         // queued
  h.tick(6);                                         // > QUEUE_TIMEOUT_TICKS -> dropped
  setDoorMoving(h, "CLOSED", false, false);          // motor stops later
  assert.equal(h.switchSets.length, 0, "timed-out command does not fire");
});
test("at-rest guard does NOT defer a mid-travel reverse (open while CLOSING is still 2 pulses)", function () {
  const h = mk();
  setDoorMoving(h, "CLOSING", false, true);          // mid-travel, moving — intentional reverse, not an overlap
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1, "first reverse pulse immediate (not queued)");
  assert.equal(h.lastHeartbeat().queued, "", "not queued");
  h.fireOneShots();
  assert.equal(h.switchSets.length, 2, "2-pulse stop-then-reverse");
});
test("fail-open: UNKNOWN pulses best-effort even if inputs show motion (never block control, D-19)", function () {
  const h = mk();
  setDoorMoving(h, "UNKNOWN", true, false);
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1, "best-effort pulse, not queued");
});

// ---------- safety stop ----------
test("stop while OPENING -> one pulse (halts the door)", function () {
  const h = mk(); setDoor(h, "OPENING");
  h.post("command", { query: "cmd=stop" });
  assert.equal(h.switchSets.length, 1, "one pulse stops the moving door");
  assert.equal(h.lastHeartbeat().lastCmd, "stop");
});
test("stop while at rest is a no-op (never starts the door)", function () {
  const h = mk(); setDoor(h, "CLOSED");
  h.post("command", { query: "cmd=stop" });
  assert.equal(h.switchSets.length, 0, "no pulse — a stopped door must not be started by stop");
});
test("stop bypasses the pulse lockout (safety always gets through)", function () {
  const h = mk(); setDoor(h, "CLOSED");
  h.post("command", { query: "cmd=open" });             // fires + sets the lockout
  assert.equal(h.switchSets.length, 1);
  setDoor(h, "OPENING");                                 // i4 reports the door now moving
  h.post("command", { query: "cmd=stop" });              // arrives during the lockout
  assert.equal(h.switchSets.length, 2, "stop fired despite the lockout");
});

// ---------- full-sequence pulse lockout (Q-16 Problem 3) ----------
test("pulse lockout: a 2nd command during the sequence is dropped until it clears", function () {
  const h = mk(); setDoor(h, "CLOSED");              // at rest (no inputs -> moving false)
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1, "first pulse fired");
  h.post("command", { query: "cmd=open" });           // arrives during the lockout
  assert.equal(h.switchSets.length, 1, "2nd command dropped while locked");
  h.fireOneShots();                                    // sequence completes -> lockout clears
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 2, "command accepted after the lockout clears");
  assert.equal(h.lastHeartbeat().fires, 2, "fires counter: only the 2 accepted commands, not the dropped one");
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
