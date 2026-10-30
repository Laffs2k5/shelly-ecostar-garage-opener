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

// ---------- weak-signal guard (spec 13): reboot to re-pick the strongest AP ----------
// rssiWin=15 s -> one sample per 1 s tick, so 15 ticks fill the window. Clock = 1 s per tick here.
const FAST = { wd_cfg: JSON.stringify({ rssiWin: 15 }) };
const mkG = (o) => mk(Object.assign({ kvs: Object.assign({}, FAST) }, o));
function feed(h, seq) { seq.forEach(function (r) { h.wifiRssi = r; h.tick(); }); }
function weak(n) { const a = []; for (let i = 0; i < n; i++) a.push(-90); return a; }

test("medianOf: middle value of an unsorted window, duplicates ok", function () {
  const { medianOf } = mk();
  assert.equal(medianOf([-90, -70, -80], 3), -80);
  assert.equal(medianOf([-88, -88, -60, -92, -88], 5), -88);
  assert.equal(medianOf([-91, -76, -87, -79, -90, -92, -84, -89, -88, -77, -90, -86, -91, -78, -89], 15), -88);
});

test("rssiGuard pure decision table", function () {
  const { rssiGuard } = mk();
  const cfg = { on: true, rssiOn: true, rssi: -85, rssiGapS: 21600 };
  const now = 100000;
  assert.equal(rssiGuard(null, true, now, null, cfg), "", "window not full yet");
  assert.equal(rssiGuard(-84, true, now, null, cfg), "", "at/above threshold");
  assert.equal(rssiGuard(-85, true, now, null, cfg), "", "threshold itself is not weak");
  assert.equal(rssiGuard(-86, true, now, null, cfg), "reboot");
  assert.equal(rssiGuard(-90, false, now, null, cfg), "", "door busy");
  assert.equal(rssiGuard(-90, true, 0, null, cfg), "", "no wall clock -> can't rate-limit -> don't");
  assert.equal(rssiGuard(-90, true, now, { ts: now - 3600, hold: 0 }, cfg), "", "inside the 6 h gap");
  assert.equal(rssiGuard(-90, true, now, { ts: now - 21600, hold: 0 }, cfg), "reboot", "gap passed");
  assert.equal(rssiGuard(-90, true, now, { ts: 1, hold: 1 }, cfg), "", "hold: last reboot didn't help");
  assert.equal(rssiGuard(-81, true, now, { ts: 1, hold: 1 }, cfg), "", "hold needs thr+5 to clear");
  assert.equal(rssiGuard(-80, false, now, { ts: 1, hold: 1 }, cfg), "recover", "recovery doesn't need idle");
  assert.equal(rssiGuard(-95, true, now, null, Object.assign({}, cfg, { rssiOn: false })), "", "guard off");
  assert.equal(rssiGuard(-95, true, now, null, Object.assign({}, cfg, { on: false })), "", "watchdog off");
});

test("guard defaults (-85 dBm, 900 s window, 6 h gap) and wd_cfg overrides with range checks", function () {
  const d = mk().sandbox.WD;
  assert.equal(d.rssiOn, true); assert.equal(d.rssi, -85); assert.equal(d.rssiWinMs, 900000); assert.equal(d.rssiGapS, 21600);
  const o = mk({ kvs: { wd_cfg: JSON.stringify({ rssiOn: 0, rssi: -88, rssiWin: 600, rssiGap: 7200 }) } }).sandbox.WD;
  assert.equal(o.rssiOn, false); assert.equal(o.rssi, -88); assert.equal(o.rssiWinMs, 600000); assert.equal(o.rssiGapS, 7200);
  const bad = mk({ kvs: { wd_cfg: JSON.stringify({ rssi: -20, rssiWin: 5, rssiGap: 1 }) } }).sandbox.WD;
  assert.equal(bad.rssi, -85, "a threshold that would fire on a good signal is ignored");
  assert.equal(bad.rssiWinMs, 900000); assert.equal(bad.rssiGapS, 21600);
});

test("guard: sustained weak signal -> records the reboot in KVS first, then reboots", function () {
  const h = mkG(); setDoor(h, "CLOSED");
  feed(h, weak(14));
  assert.equal(h.reboots, 0, "window not full yet");
  feed(h, weak(1));
  assert.equal(h.reboots, 1, "rebooted once the 15-sample window is weak");
  const rec = h.wdLast();
  assert.equal(rec.why, "rssi"); assert.equal(rec.rssi, -90); assert.equal(rec.hold, 1); assert.ok(rec.ts > 0);
  assert.ok(h.logs.some(function (l) { return /rssi guard reboot/.test(l); }), "reason printed");
  assert.equal(h.lastHeartbeat().wd.hold, true, "heartbeat shows the guard reboot before going down");
  assert.equal(h.switchSets.length, 0, "the guard never touches the relay");
});

test("guard: median rides out ±5 dB swings (a third of samples strong still reboots)", function () {
  const h = mkG();
  const seq = []; for (let i = 0; i < 15; i++) seq.push(i % 3 === 0 ? -80 : -90);   // 5 strong, 10 weak
  feed(h, seq);
  assert.equal(h.reboots, 1);
});
test("guard: a mostly-good signal with weak dips does not reboot", function () {
  const h = mkG();
  const seq = []; for (let i = 0; i < 45; i++) seq.push(i % 3 === 0 ? -92 : -78);   // 1/3 weak
  feed(h, seq);
  assert.equal(h.reboots, 0);
});
test("guard: an AP change (BSSID) starts a fresh window", function () {
  const h = mkG();
  feed(h, weak(14));
  h.wifiBssid = "aa:bb:cc:00:00:02";          // firmware roamed/reassociated
  feed(h, weak(14));
  assert.equal(h.reboots, 0, "old AP's samples don't count");
  feed(h, weak(1));
  assert.equal(h.reboots, 1);
});
test("guard: samples without an IP are skipped (that's the Wi-Fi watchdog's job)", function () {
  const h = mkG();
  h.sandbox.WD.wifiMs = 9e9;
  h.wifiUp = false; feed(h, weak(30));
  assert.equal(h.reboots, 0);
});

test("guard: never reboots mid-pulse, mid-lockout or with a command queued", function () {
  const h = mkG(); setDoor(h, "CLOSED");
  h.post("command", { query: "cmd=open" });   // fires: relay on + LOCKED (harness relay stays on)
  feed(h, weak(20));
  assert.equal(h.reboots, 0, "pulse/lockout in progress");
  h.fireOneShots(); h.switchOutput = false;   // sequence done, lockout cleared, relay auto-off
  setDoorMoving(h, "CLOSED", false, true);    // arrival overlap -> a command gets queued
  h.post("command", { query: "cmd=open" });
  assert.equal(h.lastHeartbeat().queued, "open");
  h.wifiRssi = -90; h.tick();
  assert.equal(h.reboots, 0, "queued command pending");
});
test("guard: waits while the door picture says moving, but a stale moving picture doesn't block it", function () {
  const h = mkG();
  setDoorMoving(h, "OPENING", true, false);   // fresh: door travelling
  feed(h, weak(20));
  assert.equal(h.reboots, 0, "door moving");
  h.clock += 200;                              // the i4 feed died mid-travel (> DOOR_FRESH_S)
  feed(h, weak(1));
  assert.equal(h.reboots, 1, "stale picture is not motion");
});
test("guard: commands are dropped once the reboot is committed (no truncated pulse sequence)", function () {
  const h = mkG(); setDoor(h, "CLOSED");
  h.kvsDefer = true;
  feed(h, weak(15));                           // decision made, KVS write in flight
  assert.equal(h.reboots, 0);
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 0, "open dropped while rebooting");
  h.flushKvs();
  assert.equal(h.reboots, 1);
});
test("guard: if the record can't be saved it does not reboot, and commands work again", function () {
  const h = mkG(); setDoor(h, "CLOSED");
  h.kvsFail = true;
  feed(h, weak(15));
  assert.equal(h.reboots, 0, "unrecorded reboot would defeat the rate limit");
  h.post("command", { query: "cmd=open" });
  assert.equal(h.switchSets.length, 1, "not stuck in the rebooting state");
});

test("guard: rate limit — no second guard reboot inside rssiGap", function () {
  const h = mkG({ kvs: Object.assign({ wd_last: JSON.stringify({ ts: 900, why: "rssi", rssi: -90, hold: 0 }) }, FAST) });
  feed(h, weak(30));
  assert.equal(h.reboots, 0, "last guard reboot was minutes ago");
  h.clock += 21600;
  feed(h, weak(1));
  assert.equal(h.reboots, 1, "allowed again after the gap");
});
test("guard: hold after a reboot that didn't help; clears on recovery; then may fire again", function () {
  const h = mkG({ kvs: Object.assign({ wd_last: JSON.stringify({ ts: 1, why: "rssi", rssi: -91, hold: 1 }) }, FAST) });
  assert.deepEqual(h.lastHeartbeat().wd, { last: 1, why: "rssi", rssi: -91, hold: true }, "boot loads the record");
  feed(h, weak(60));
  assert.equal(h.reboots, 0, "still weak after the reboot -> every AP is weak here -> hold");
  const seq = []; for (let i = 0; i < 15; i++) seq.push(-82);
  feed(h, seq);
  assert.equal(h.wdLast().hold, 1, "-82 isn't a recovery (needs >= -80)");
  feed(h, [-75, -75, -75, -75, -75, -75, -75, -75]);
  assert.equal(h.wdLast().hold, 0, "median >= -80 -> hold cleared in KVS");
  assert.equal(h.lastHeartbeat().wd.hold, false, "and on the heartbeat");
  h.clock += 21600;                            // and the 6 h gap since that reboot has passed
  feed(h, weak(15));
  assert.equal(h.reboots, 1, "a fresh weak spell can reboot again");
});
test("guard: wd_last stored as an OBJECT (KVS footgun) still loads and doesn't crash boot", function () {
  const h = mkG({ kvs: Object.assign({ wd_last: { ts: 1, why: "rssi", rssi: -90, hold: 1 } }, FAST) });
  assert.ok(h.endpoints["command"], "boot chain completed");
  assert.equal(h.lastHeartbeat().wd.hold, true);
});
test("guard: heartbeat wd defaults when no guard reboot has happened", function () {
  const h = mk();
  assert.deepEqual(h.lastHeartbeat().wd, { last: 0, why: "", rssi: null, hold: false });
});
test("guard: off via wd_cfg rssiOn:0, or with the whole watchdog off", function () {
  const a = mk({ kvs: { wd_cfg: JSON.stringify({ rssiWin: 15, rssiOn: 0 }) } });
  feed(a, weak(30)); assert.equal(a.reboots, 0);
  const b = mk({ kvs: { wd_cfg: JSON.stringify({ rssiWin: 15, on: 0 }) } });
  feed(b, weak(30)); assert.equal(b.reboots, 0);
});
