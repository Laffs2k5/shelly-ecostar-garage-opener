// controller.js — Shelly 1 Gen3, the CONTROLLING unit.
//
// Holds the latest door picture (pushed by the i4 over HTTP, also visible on MQTT) and turns
// open/close/toggle commands into EcoStar impulse pulses — but only when a pulse actually helps
// (suppresses counterproductive ones). Pulses the relay (terminals 1+2) as a 0.5 s momentary contact.
//
// Inputs to this script:
//   - HTTP POST  /script/<id>/door_state   <- i4 pushes {state,dir,inputs,since,ts,v} (low latency, D-03)
//   - MQTT       devices/garage-controller/command   <- "open"|"close"|"toggle"|"stop" (or {"cmd":...})
//   - HTTP GET   /script/<id>/command?cmd=open|close|toggle|stop   <- local control
// Outputs: relay pulse (Switch.Set, auto-off 0.5 s); retained heartbeat + mon/<id>/alive.
//
// Safety / boot-to-safe: the relay is configured initial_state=off and the script never auto-acts on
// boot — it only pulses on an explicit command — so a reboot can never move the door (no resume needed).
// The physical wall button is wired in PARALLEL with the relay across terminals 1+2, so it works with
// this device/script/Wi-Fi entirely down (D-04).
//
// EcoStar impulse model (D-09): one pulse to a moving door STOPS it; a second pulse (after a gap) starts
// it in the OPPOSITE direction. So reversing a moving door = 2 pulses. mJS: ES5 only; one repeating
// timer; chain Shelly.call. Deploy the minified build.

var SCHEMA = 1;
var PULSE_GAP_MS = 1200;     // gap between the 2 pulses of a stop-then-reverse (tune on bench, Q-03)
var ALIVE_MS = 30000;
var TICK_MS = 1000;
var STALE_MS = 0;            // (door-picture staleness threshold; 0 = don't flag yet)
// Pulse safety (Q-16 / spec 14). All provisional / config-tunable via KVS "logic_cfg" — re-confirm at
// commissioning. PULSE_MS = relay auto-off width. Full-sequence LOCKOUT (user choice): after firing,
// drop new commands until the whole pulse sequence has played (so rapid taps can't coalesce into one
// long pulse or land too close for the slow EcoStar). QUEUE = the at-rest guard: if a command lands while
// the door is at an end-state but still MOVING (arrival overlap), hold it and fire once the motor stops.
var PULSE_MS = 500;
var LOCK_MARGIN_MS = 300;
var QUEUE_TIMEOUT_TICKS = 5;  // drop a queued at-rest command after this many ticks (~5 s at 1 s tick)
// EcoStar restart-from-stop model (Q-03): false = ALTERNATES direction each start (D-09, our default);
// true = RESUMES the same direction. Flips which STOPPED_* command is the cheap 1-pulse reverse vs. the
// 3-pulse continue. KVS-tunable ("logic_cfg".resumeSameDir) so commissioning can match the real door.
var RESUME_SAME_DIR = false;

// Connectivity watchdog (Phase 7): reboot to recover a wedged Wi-Fi/MQTT stack after a prolonged
// outage. The controller is boot-safe (relay initial_state:off, never auto-acts) and holds no resumable
// state, so boot is always safe — no reset_reason gate. Overridable via KVS "wd_cfg" {on,wifi,mqtt}.
var WD = { on: true, wifiMs: 600000, mqttMs: 1800000, mqttEnabled: false, wifiDown: 0, mqttDown: 0 };

var CFG = { hbTopic: "", aliveTopic: "", cmdTopic: "", id: "" };
var DOOR = { state: "UNKNOWN", dir: "", since: 0, ts: 0, rx: 0, moving: false };   // last picture from the i4
var LASTCMD = ""; var LASTCMD_TS = 0; var LASTPULSES = 0;
var FIRES = 0;                               // monotonic count of pulse sequences actually fired (diagnostic)
var LOCKED = false;                          // full-sequence pulse lockout (drop commands while set)
var PENDING = { cmd: "", deadline: 0 };      // at-rest queue: a command waiting for the door to stop moving
var ticks = 0; var booted = false;

// ---- pure: how many pulses does (cmd, doorState) need? (spec 02 table + D-09) ----
// 0 = suppress (already there / already going the right way). Kept dependency-free for the Node tests.
function pulsesFor(cmd, state, resume) {
  if (cmd === "toggle") return 1;                       // toggle = the physical-button equivalent: 1 pulse
  if (cmd === "stop") {                                 // safety stop: halt a MOVING door, else no-op
    return (state === "OPENING" || state === "CLOSING") ? 1 : 0;   // never starts a stopped/UNKNOWN door
  }
  // STOPPED_* (door halted mid-travel): the next impulse alternates direction (D-09), so one direction is
  // a 1-pulse REVERSE and the other is the 3-pulse CONTINUE dance (start-reverse -> stop -> start-wanted).
  // Which is which flips if the opener RESUMES the same direction instead of alternating (Q-03) -> the
  // `resume` arg (RESUME_SAME_DIR, KVS-tunable) lets commissioning swap it without a reflash.
  if (cmd === "open") {
    if (state === "OPENING" || state === "OPEN") return 0;          // suppress
    if (state === "CLOSED") return 1;                               // start opening
    if (state === "CLOSING") return 2;                              // stop, then reverse to open
    if (state === "STOPPED_OPENING") return resume ? 1 : 3;         // continue opening
    if (state === "STOPPED_CLOSING") return resume ? 3 : 1;         // reverse from closing-stop to open
    return 1;  // UNKNOWN -> best-effort single pulse
  }
  if (cmd === "close") {
    if (state === "CLOSING" || state === "CLOSED") return 0;        // suppress
    if (state === "OPEN") return 1;                                 // start closing
    if (state === "OPENING") return 2;                             // stop, then reverse to close
    if (state === "STOPPED_CLOSING") return resume ? 1 : 3;         // continue closing
    if (state === "STOPPED_OPENING") return resume ? 3 : 1;         // reverse from opening-stop to close
    return 1;  // UNKNOWN -> best-effort single pulse
  }
  return 0;  // unknown command
}

// pure watchdog decision (shared shape with monitor.js) — tested in the harness.
function wdReboot(wifiDownMs, mqttDownMs, cfg) {
  if (!cfg.on) return "";
  if (wifiDownMs >= cfg.wifiMs) return "wifi";
  if (mqttDownMs >= cfg.mqttMs) return "mqtt";
  return "";
}

// ---- parse a command from an MQTT message or a query value ----
function parseCmd(msg) {
  if (!msg && msg !== 0) return "";
  msg = "" + msg;
  if (msg.indexOf("{") >= 0) { var o = JSON.parse(msg); return (o && o.cmd) ? ("" + o.cmd) : ""; }
  return msg;
}
function validCmd(c) { return c === "open" || c === "close" || c === "toggle" || c === "stop"; }

function qparam(q, key) {
  if (!q) return "";
  var pat = key + "=";
  var i = q.indexOf(pat);
  if (i < 0) return "";
  var rest = q.slice(i + pat.length);
  var amp = rest.indexOf("&");
  return amp < 0 ? rest : rest.slice(0, amp);
}

// ---- helpers ----
function nowTs() { var s = Shelly.getComponentStatus("sys"); return (s && s.unixtime) ? s.unixtime : 0; }
function relayOn() { var s = Shelly.getComponentStatus("switch:0"); return !!(s && s.output === true); }

function firePulse() {
  // relay configured auto_off=0.5s, so a single Set(on) is a momentary pulse on terminals 1+2
  Shelly.call("Switch.Set", { id: 0, on: true }, function (r, ec, em) {
    if (ec) print("controller: Switch.Set failed:", ec, em);
  });
}
// Rolling N-pulse sequencer: fire one pulse, then re-arm a SINGLE one-shot for the next, PULSE_GAP_MS
// apart, until SEQ_LEFT drains. One rolling timer (mJS timer budget) handles any count (1, 2 reverse, or
// 3 for the STOPPED continue dance). A new pulseSeq() overwrites SEQ_LEFT, so any new command (or stop)
// supersedes a leftover in-flight sequence; a stale pending timer then finds SEQ_LEFT<=0 and no-ops.
var SEQ_LEFT = 0;
function pulseStep() {
  if (SEQ_LEFT <= 0) return;
  firePulse();
  SEQ_LEFT--;
  if (SEQ_LEFT > 0) Timer.set(PULSE_GAP_MS, false, pulseStep);
}
function pulseSeq(n) {
  if (n <= 0) return;
  SEQ_LEFT = n;
  pulseStep();
}
function lockMs(n) {
  // cover the whole sequence: pulses are PULSE_MS wide, (PULSE_MS+PULSE_GAP_MS) apart start-to-start, +margin.
  if (n <= 1) return PULSE_MS + LOCK_MARGIN_MS;
  return (n - 1) * (PULSE_MS + PULSE_GAP_MS) + PULSE_MS + LOCK_MARGIN_MS;
}
function atEnd(st) { return st === "CLOSED" || st === "OPEN"; }
// at-rest guard applies only when the door is AT an end but the motor is still running (arrival overlap):
// a single "start" pulse there would STOP the door instead of moving it. Mid-travel (OPENING/CLOSING) is
// handled by pulsesFor (suppress / 2-pulse reverse) and must NOT be deferred.
function needsRest(cmd) { return atEnd(DOOR.state) && DOOR.moving && pulsesFor(cmd, DOOR.state, RESUME_SAME_DIR) > 0; }

function fireCmd(cmd, src) {
  var n = pulsesFor(cmd, DOOR.state, RESUME_SAME_DIR);
  LASTCMD = cmd; LASTCMD_TS = nowTs(); LASTPULSES = n;
  print("controller: cmd", cmd, "state", DOOR.state, "->", n, "pulse(s) (" + src + ")");
  if (n > 0) {
    FIRES++;
    pulseSeq(n);
    LOCKED = true;
    Timer.set(lockMs(n), false, function () { LOCKED = false; });   // clear the full-sequence lockout
  }
  publishHeartbeat();
}
function tryPending() {
  if (PENDING.cmd === "" || LOCKED || DOOR.moving) return;   // wait until truly at rest + not mid-pulse
  var c = PENDING.cmd; PENDING.cmd = "";
  print("controller: door at rest — firing queued", c);
  fireCmd(c, "queued");
}

function payload() {
  return {
    relay: relayOn(), lastCmd: LASTCMD, lastCmdTs: LASTCMD_TS, lastPulses: LASTPULSES,
    door: { state: DOOR.state, dir: DOOR.dir, ts: DOOR.ts, rx: DOOR.rx, moving: DOOR.moving },
    queued: PENDING.cmd, locked: LOCKED, fires: FIRES, resumeSameDir: RESUME_SAME_DIR,
    ts: nowTs(), rssi: wifiRssi(), v: SCHEMA
  };
}
function publishHeartbeat() {
  if (CFG.hbTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.hbTopic, JSON.stringify(payload()), 0, true);   // retained
}
function publishAlive() {
  if (CFG.aliveTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.aliveTopic, JSON.stringify({ ts: nowTs() }), 0, false);
}

function handleCommand(raw, src) {
  var cmd = parseCmd(raw);
  if (!validCmd(cmd)) { print("controller: ignoring invalid cmd:", raw, "(" + src + ")"); return; }
  // safety stop always gets through the pulse-lockout; its state-gate (pulsesFor) keeps it from firing a
  // bad pulse anyway — if the door isn't confirmed moving, stop is a no-op.
  if (cmd !== "stop" && LOCKED) { print("controller: locked (pulse in progress) — dropping", cmd, "(" + src + ")"); return; }
  if (needsRest(cmd)) {            // at an end but still moving (arrival overlap) -> queue until at rest
    PENDING.cmd = cmd; PENDING.deadline = ticks + QUEUE_TIMEOUT_TICKS;
    print("controller: door moving into", DOOR.state, "— queued", cmd, "(" + src + ")");
    publishHeartbeat();
    return;
  }
  fireCmd(cmd, src);
}

function updateDoor(bodyStr) {
  if (!bodyStr) return false;          // empty/missing body: ignore (a stray GET/health-check must
  var d = JSON.parse(bodyStr);          // not crash the script — JSON.parse("") throws on-device)
  if (!d || !d.state) return false;
  DOOR.state = d.state; DOOR.dir = d.dir || ""; DOOR.since = d.since || 0; DOOR.ts = d.ts || 0;
  DOOR.moving = !!(d.inputs && (d.inputs.op || d.inputs.cl));
  DOOR.rx = nowTs();
  tryPending();   // a queued at-rest command may now be firable (motor just stopped)
  return true;
}

function registerHttp() {
  if (typeof HTTPServer === "undefined") return;
  HTTPServer.registerEndpoint("door_state", function (req, res) {
    var ok = updateDoor(req.body);
    res.code = 200; res.body = ok ? "ok" : "bad"; res.send();
  });
  HTTPServer.registerEndpoint("command", function (req, res) {
    var cmd = qparam(req.query, "cmd");
    handleCommand(cmd, "http");
    res.code = 200; res.headers = [["Content-Type", "application/json"]];
    res.body = JSON.stringify({ ok: validCmd(parseCmd(cmd)), state: DOOR.state, pulses: LASTPULSES });
    res.send();
  });
}

function wifiUp() { var w = Shelly.getComponentStatus("wifi"); return !!(w && w.status === "got ip"); }
function wifiRssi() { var w = Shelly.getComponentStatus("wifi"); return (w && typeof w.rssi === "number") ? w.rssi : null; }
function mqttUp() { var m = Shelly.getComponentStatus("mqtt"); return !!(m && m.connected === true); }
function watchdogTick() {
  WD.wifiDown = wifiUp() ? 0 : (WD.wifiDown + TICK_MS);
  WD.mqttDown = (!WD.mqttEnabled || !wifiUp() || mqttUp()) ? 0 : (WD.mqttDown + TICK_MS);
  var why = wdReboot(WD.wifiDown, WD.mqttDown, WD);
  if (why !== "") { print("controller: watchdog reboot —", why, "down too long"); Shelly.call("Shelly.Reboot", {}); }
}
// KVS values can come back either as a JSON STRING or, if they were stored as JSON, as an already-parsed
// OBJECT. JSON.parse(object) THROWS on-device (SyntaxError) and would crash boot — so never parse a
// non-string. Boot-safe: object passes through, JSON text is parsed, anything else is ignored.
function cfgObj(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string" && v.indexOf("{") === 0) return JSON.parse(v);
  return null;
}
function applyWdCfg(str) {
  var c = cfgObj(str);
  if (!c) return;
  if (typeof c.on !== "undefined") WD.on = c.on ? true : false;
  if (c.wifi) WD.wifiMs = c.wifi * 1000;
  if (c.mqtt) WD.mqttMs = c.mqtt * 1000;
}
// pulse-safety tunables (KVS "logic_cfg" {pulseGap,lockMargin,queueTimeout}, all ms except ticks) —
// lets commissioning tune timing on the real door without reflashing (spec 14, Q-16).
function applyLogicCfg(str) {
  var c = cfgObj(str);
  if (!c) return;
  if (c.pulseGap) PULSE_GAP_MS = c.pulseGap;
  if (c.lockMargin) LOCK_MARGIN_MS = c.lockMargin;
  if (c.queueTimeout) QUEUE_TIMEOUT_TICKS = c.queueTimeout;
  if (typeof c.resumeSameDir !== "undefined") RESUME_SAME_DIR = c.resumeSameDir ? true : false;
}

function tick() {
  ticks++;
  watchdogTick();
  if (PENDING.cmd !== "" && ticks > PENDING.deadline) {   // at-rest queue timed out -> drop
    print("controller: queued", PENDING.cmd, "timed out — dropped"); PENDING.cmd = "";
  }
  if ((ticks % (ALIVE_MS / TICK_MS)) === 0) { publishAlive(); publishHeartbeat(); }
}

function startLoop() {
  if (booted) return; booted = true;
  publishHeartbeat(); publishAlive();
  Timer.set(TICK_MS, true, tick);
  print("controller: started");
}

function boot() {
  // ensure the relay is a safe momentary pulser: detached from the SW input, off on boot, 0.5s auto-off
  Shelly.call("Switch.SetConfig",
    { id: 0, config: { in_mode: "detached", initial_state: "off", auto_on: false, auto_off: true, auto_off_delay: 0.5 } },
    function () {
      Shelly.call("MQTT.GetConfig", {}, function (cfg) {
        if (cfg) {
          var prefix = cfg.topic_prefix || ""; var id = cfg.client_id || "";
          if (prefix !== "") { CFG.hbTopic = prefix + "/heartbeat"; CFG.cmdTopic = prefix + "/command"; }
          if (id !== "") CFG.aliveTopic = "mon/" + id + "/alive";
          WD.mqttEnabled = (cfg.enable === true);
        }
        if (CFG.cmdTopic !== "" && typeof MQTT !== "undefined") {
          MQTT.subscribe(CFG.cmdTopic, function (topic, msg) { handleCommand(msg, "mqtt"); });
        }
        Shelly.call("KVS.Get", { key: "wd_cfg" }, function (w) {
          applyWdCfg(w && w.value);
          Shelly.call("KVS.Get", { key: "logic_cfg" }, function (lc) {
            applyLogicCfg(lc && lc.value);
            registerHttp();
            startLoop();
          });
        });
      });
    });
}

boot();
