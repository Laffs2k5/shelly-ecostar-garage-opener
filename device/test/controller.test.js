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

// ---------- STOPPED_* mid-travel: reverse = 1 pulse, continue = 3-pulse dance (D-09 alternation) ----------
test("pulsesFor: STOPPED reverse is 1 pulse (alternation default)", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("close", "STOPPED_OPENING"), 1);   // was opening, reverse to close = natural 1 pulse
  assert.equal(pulsesFor("open", "STOPPED_CLOSING"), 1);    // was closing, reverse to open = natural 1 pulse
});
test("pulsesFor: STOPPED continue is the 3-pulse dance (alternation default)", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("open", "STOPPED_OPENING"), 3);    // continue opening: close, stop, open
  assert.equal(pulsesFor("close", "STOPPED_CLOSING"), 3);   // continue closing: open, stop, close
});
test("pulsesFor: resumeSameDir=true flips continue/reverse (1 <-> 3)", function () {
  const { pulsesFor } = mk();
  assert.equal(pulsesFor("open", "STOPPED_OPENING", true), 1);   // resume: continue is the natural 1 pulse
  assert.equal(pulsesFor("close", "STOPPED_CLOSING", true), 1);
  assert.equal(pulsesFor("close", "STOPPED_OPENING", true), 3);  // reverse now needs the 3-pulse dance
  assert.equal(pulsesFor("open", "STOPPED_CLOSING", true), 3);
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

// ---------- STOPPED continue: the 3-pulse sequence on the wire (V2-6 / spec 16) ----------
test("continue from STOPPED_OPENING fires exactly 3 relay pulses, spaced by the gap", function () {
  const h = mk(); setDoor(h, "STOPPED_OPENING");
  h.post("command", { query: "cmd=open" });
  assert.equal(h.lastHeartbeat().lastPulses, 3, "reports 3 pulses");
  assert.equal(h.switchSets.length, 1, "first pulse immediate");
  assert.ok(h.oneShotMs().indexOf(1200) >= 0, "next pulse scheduled at the 1200ms gap");
  h.fireOneShots();                                   // drain the rolling sequence
  assert.equal(h.switchSets.length, 3, "all three pulses fired");
});
test("continue from STOPPED_CLOSING also fires 3 pulses", function () {
  const h = mk(); setDoor(h, "STOPPED_CLOSING");
  h.post("command", { query: "cmd=close" });
  h.fireOneShots();
  assert.equal(h.switchSets.length, 3);
});
test("STOPPED reverse stays a single pulse (no dance)", function () {
  const h = mk(); setDoor(h, "STOPPED_OPENING");
  h.post("command", { query: "cmd=close" });          // reverse
  h.fireOneShots();
  assert.equal(h.switchSets.length, 1);
});
test("3-pulse sequence sets a lockout sized for the whole dance (4200ms)", function () {
  const h = mk(); setDoor(h, "STOPPED_OPENING");
  h.post("command", { query: "cmd=open" });
  // lockMs(3) = (3-1)*(500+1200) + 500 + 300 = 4200
  assert.ok(h.oneShotMs().indexOf(4200) >= 0, "lockout timer sized 4200ms");
  assert.equal(h.lastHeartbeat().locked, true);
});
test("a command during the 3-pulse sequence is dropped (lockout)", function () {
  const h = mk(); setDoor(h, "STOPPED_OPENING");
  h.post("command", { query: "cmd=open" });           // starts the dance, LOCKED
  h.post("command", { query: "cmd=open" });           // arrives mid-sequence
  assert.equal(h.lastHeartbeat().fires, 1, "only one sequence fired; the 2nd command was dropped");
});

// ---------- boot-time config: resumeSameDir via KVS logic_cfg ----------
test("logic_cfg.resumeSameDir=true applied at boot flips STOPPED behaviour end-to-end", function () {
  const h = mk({ kvs: { logic_cfg: JSON.stringify({ resumeSameDir: true }) } });
  assert.equal(h.lastHeartbeat().resumeSameDir, true, "heartbeat reflects the active model");
  setDoor(h, "STOPPED_OPENING");
  h.post("command", { query: "cmd=open" });            // resume mode: continue is the cheap 1 pulse
  h.fireOneShots();
  assert.equal(h.switchSets.length, 1, "continue is 1 pulse when the opener resumes same direction");
});
test("default model is alternation (resumeSameDir=false) on the heartbeat", function () {
  const h = mk();
  assert.equal(h.lastHeartbeat().resumeSameDir, false);
});
test("boot-safe: logic_cfg stored as an OBJECT (not string) must not crash boot, still applies", function () {
  // Reproduces the hardware footgun: KVS.Set via RPC GET stored {...} as an object, so KVS.Get returns an
  // object; JSON.parse(object) threw on-device and crashed the controller at boot. cfgObj must tolerate it.
  const h = mk({ kvs: { logic_cfg: { resumeSameDir: true, pulseGap: 1500 } } });   // object, not a string
  const hb = h.lastHeartbeat();
  assert.ok(hb, "booted: a heartbeat was published (script did not crash)");
  assert.ok(h.endpoints["command"], "HTTP endpoints registered (boot chain completed past applyLogicCfg)");
  assert.equal(hb.resumeSameDir, true, "object-form config still applied");
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

// ---------- reconnect: re-subscribe on a broker drop/reconnect (Shelly clears script subs; watchdog
// can't catch a "connected but deaf" controller — see spec 13) ----------
test("re-subscribes to the command topic on an MQTT down->up transition", function () {
  const h = mk(); setDoor(h, "CLOSED");
  assert.ok(h.subs["devices/garage-controller/command"], "subscribed at boot");
  // Simulate the broker drop clearing the script's subscription (firmware does not guarantee it survives).
  h.subs = {};
  h.setNet(true, false); h.tick();                       // controller observes MQTT down
  assert.ok(!h.subs["devices/garage-controller/command"], "still unsubscribed while the broker is down");
  h.setNet(true, true); h.tick();                        // broker back: down->up edge -> re-subscribe
  assert.ok(h.subs["devices/garage-controller/command"], "re-subscribed on reconnect");
  h.sendCmd("open");                                     // and the fresh subscription actually delivers
  assert.equal(h.switchSets.length, 1, "command received and acted on after the reconnect");
});
test("no double-subscribe churn while the broker stays connected", function () {
  const h = mk(); setDoor(h, "CLOSED");
  let subCalls = 0;
  const realSub = h.sandbox.MQTT.subscribe;              // count subscribe calls across steady-state ticks
  h.sandbox.MQTT.subscribe = function (t, cb) { subCalls++; return realSub.call(this, t, cb); };
  h.setNet(true, true); h.tick(5);
  assert.equal(subCalls, 0, "no re-subscribe while continuously connected (only on a down->up edge)");
});
