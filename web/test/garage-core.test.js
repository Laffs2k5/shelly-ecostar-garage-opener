// Tests for the web control-page core logic. Run: scripts/test-web.sh
const { test } = require("node:test");
const assert = require("node:assert");
const G = require("../garage-core");

test("topics: derived from the two device identities", function () {
  const t = G.topics("garage-monitor", "garage-controller");
  assert.equal(t.state, "devices/garage-monitor/heartbeat");
  assert.equal(t.monAlive, "mon/garage-monitor/alive");
  assert.equal(t.command, "devices/garage-controller/command");
  assert.equal(t.ctrlState, "devices/garage-controller/heartbeat");
});

test("brokerUrl: cloud WSS on 8084", function () {
  assert.equal(G.brokerUrl("ex.emqxsl.com"), "wss://ex.emqxsl.com:8084/mqtt");
});

test("randomClientId: web-prefixed and varies", function () {
  const a = G.randomClientId(), b = G.randomClientId();
  assert.match(a, /^garage-web-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test("validCmd / buildCommand (incl. stop)", function () {
  for (const c of ["open", "close", "toggle", "stop"]) { assert.ok(G.validCmd(c)); assert.equal(G.buildCommand(c), c); }
  assert.equal(G.validCmd("banana"), false);
  assert.equal(G.buildCommand("banana"), "");
});

// ---- morphing button parity with the app's ActionModel ----
test("actionsFor: morphing button per state", function () {
  assert.deepEqual(G.actionsFor("CLOSED").map(a => a.cmd), ["open"]);
  assert.deepEqual(G.actionsFor("OPEN").map(a => a.cmd), ["close"]);
  assert.equal(G.actionsFor("OPENING")[0].cmd, "stop");
  assert.equal(G.actionsFor("OPENING")[0].tone, "caution");
  assert.equal(G.actionsFor("CLOSING")[0].cmd, "stop");
  assert.equal(G.actionsFor(null)[0].cmd, "toggle");   // UNKNOWN -> best-effort
});
test("actionsFor: STOPPED is the Open|Close split pair", function () {
  for (const s of ["STOPPED_OPENING", "STOPPED_CLOSING"]) {
    assert.ok(G.isSplit(s));
    assert.deepEqual(G.actionsFor(s).map(a => a.cmd), ["open", "close"]);
  }
  assert.equal(G.isSplit("OPEN"), false);
});
test("shortLabel drops the parenthetical", function () {
  assert.equal(G.shortLabel("STOPPED_OPENING"), "Stopped");
  assert.equal(G.shortLabel("STOPPED_CLOSING"), "Stopped");
  assert.equal(G.shortLabel("OPENING"), "Opening…");
  assert.equal(G.shortLabel("CLOSED"), "Closed");
});

// ---- connection history (mirrors ConnectionUi.pushIfChanged) ----
test("pushLog: newest-first, capped at 4, dedup on unchanged mode", function () {
  let log = [];
  log = G.pushLog(log, "OFFLINE", "t0");
  const same = G.pushLog(log, "OFFLINE", "t1");
  assert.equal(same.length, 1);                 // unchanged mode -> no new entry
  log = G.pushLog(log, "CLOUD", "t2");
  log = G.pushLog(log, "OFFLINE", "t3");
  log = G.pushLog(log, "CLOUD", "t4");
  log = G.pushLog(log, "DEMO", "t5");
  assert.equal(log.length, 4);                  // capped
  assert.equal(log[0].mode, "DEMO");            // newest first
});

// ---- demo simulation (mirrors the app's DemoEngine) ----
test("createDemo: open auto-completes after travel; stop yields STOPPED", function () {
  const d = G.createDemo(4000);
  assert.equal(d.door(0).state, "CLOSED");
  d.command("open", 0);
  assert.equal(d.door(1000).state, "OPENING");
  assert.equal(d.door(4000).state, "OPEN");
  d.command("close", 4000);
  d.command("stop", 5000);
  assert.equal(d.door(5500).state, "STOPPED_CLOSING");
  d.command("open", 6000);                       // resume from stopped
  assert.equal(d.door(6500).state, "OPENING");
});
test("createDemo: stop is a no-op when not moving", function () {
  const d = G.createDemo();
  d.command("stop", 0);
  assert.equal(d.door(100).state, "CLOSED");
});

test("parseDoor: valid payload (string and object)", function () {
  const d = G.parseDoor('{"state":"OPENING","dir":"opening","since":5,"ts":9,"inputs":{"c":false}}');
  assert.equal(d.state, "OPENING");
  assert.equal(d.dir, "opening");
  assert.equal(d.since, 5);
  const d2 = G.parseDoor({ state: "CLOSED", since: 1 });
  assert.equal(d2.state, "CLOSED");
});

test("parseDoor: garbage / missing state -> null", function () {
  assert.equal(G.parseDoor("not json"), null);
  assert.equal(G.parseDoor("{}"), null);
  assert.equal(G.parseDoor(null), null);
});

test("label / isMoving / isStopped cover the 7 states", function () {
  assert.equal(G.label("STOPPED_CLOSING"), "Stopped (closing)");
  assert.equal(G.label("CLOSED"), "Closed");
  assert.equal(G.label("WUT"), "WUT");
  assert.ok(G.isMoving("OPENING") && G.isMoving("CLOSING"));
  assert.ok(!G.isMoving("OPEN"));
  assert.ok(G.isStopped("STOPPED_OPENING") && !G.isStopped("OPEN"));
});

test("durationSec / fmtDur", function () {
  assert.equal(G.durationSec({ since: 100 }, 160), 60);
  assert.equal(G.durationSec({ since: 0 }, 160), 0);     // no since
  assert.equal(G.durationSec({ since: 200 }, 160), 0);   // clock behind (guard)
  assert.equal(G.fmtDur(45), "45s");
  assert.equal(G.fmtDur(60), "1m");
  assert.equal(G.fmtDur(3 * 3600 + 25 * 60), "3h 25m");
});

test("decide: broker door when connected, else offline", function () {
  const door = { state: "OPEN" };
  assert.deepEqual(G.decide(door, true), { door: door, mode: "CLOUD" });
  assert.equal(G.decide(null, true).mode, "CONNECTED");
  assert.equal(G.decide(door, false).mode, "OFFLINE");
});
