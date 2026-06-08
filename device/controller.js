// controller.js — Shelly 1 Gen3, the CONTROLLING unit.
//
// Holds the latest door picture (pushed by the i4 over HTTP, also visible on MQTT) and turns
// open/close/toggle commands into EcoStar impulse pulses — but only when a pulse actually helps
// (suppresses counterproductive ones). Pulses the relay (terminals 1+2) as a 0.5 s momentary contact.
//
// Inputs to this script:
//   - HTTP POST  /script/<id>/door_state   <- i4 pushes {state,dir,inputs,since,ts,v} (low latency, D-03)
//   - MQTT       devices/garage-controller/command   <- "open"|"close"|"toggle" (or {"cmd":...})
//   - HTTP GET   /script/<id>/command?cmd=open|close|toggle   <- local control
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

// Connectivity watchdog (Phase 7): reboot to recover a wedged Wi-Fi/MQTT stack after a prolonged
// outage. The controller is boot-safe (relay initial_state:off, never auto-acts) and holds no resumable
// state, so boot is always safe — no reset_reason gate. Overridable via KVS "wd_cfg" {on,wifi,mqtt}.
var WD = { on: true, wifiMs: 600000, mqttMs: 1800000, mqttEnabled: false, wifiDown: 0, mqttDown: 0 };

var CFG = { hbTopic: "", aliveTopic: "", cmdTopic: "", id: "" };
var DOOR = { state: "UNKNOWN", dir: "", since: 0, ts: 0, rx: 0 };   // last picture from the i4
var LASTCMD = ""; var LASTCMD_TS = 0; var LASTPULSES = 0;
var ticks = 0; var booted = false;

// ---- pure: how many pulses does (cmd, doorState) need? (spec 02 table + D-09) ----
// 0 = suppress (already there / already going the right way). Kept dependency-free for the Node tests.
function pulsesFor(cmd, state) {
  if (cmd === "toggle") return 1;                       // toggle = the physical-button equivalent: 1 pulse
  if (cmd === "open") {
    if (state === "OPENING" || state === "OPEN") return 0;          // suppress
    if (state === "CLOSED" || state === "STOPPED_CLOSING") return 1;
    if (state === "CLOSING") return 2;                              // stop, then reverse
    return 1;  // STOPPED_OPENING (resume edge, Q-03) / UNKNOWN -> best-effort single pulse
  }
  if (cmd === "close") {
    if (state === "CLOSING" || state === "CLOSED") return 0;        // suppress
    if (state === "OPEN" || state === "STOPPED_OPENING") return 1;
    if (state === "OPENING") return 2;                             // stop, then reverse
    return 1;  // STOPPED_CLOSING (resume edge, Q-03) / UNKNOWN -> best-effort single pulse
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
function validCmd(c) { return c === "open" || c === "close" || c === "toggle"; }

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
function pulseSeq(n) {
  if (n <= 0) return;
  firePulse();
  if (n >= 2) Timer.set(PULSE_GAP_MS, false, function () { firePulse(); });  // delayed reverse pulse
}

function payload() {
  return {
    relay: relayOn(), lastCmd: LASTCMD, lastCmdTs: LASTCMD_TS, lastPulses: LASTPULSES,
    door: { state: DOOR.state, dir: DOOR.dir, ts: DOOR.ts, rx: DOOR.rx },
    ts: nowTs(), v: SCHEMA
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
  var n = pulsesFor(cmd, DOOR.state);
  LASTCMD = cmd; LASTCMD_TS = nowTs(); LASTPULSES = n;
  print("controller: cmd", cmd, "state", DOOR.state, "->", n, "pulse(s) (" + src + ")");
  pulseSeq(n);
  publishHeartbeat();
}

function updateDoor(bodyStr) {
  if (!bodyStr) return false;          // empty/missing body: ignore (a stray GET/health-check must
  var d = JSON.parse(bodyStr);          // not crash the script — JSON.parse("") throws on-device)
  if (!d || !d.state) return false;
  DOOR.state = d.state; DOOR.dir = d.dir || ""; DOOR.since = d.since || 0; DOOR.ts = d.ts || 0;
  DOOR.rx = nowTs();
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
function mqttUp() { var m = Shelly.getComponentStatus("mqtt"); return !!(m && m.connected === true); }
function watchdogTick() {
  WD.wifiDown = wifiUp() ? 0 : (WD.wifiDown + TICK_MS);
  WD.mqttDown = (!WD.mqttEnabled || !wifiUp() || mqttUp()) ? 0 : (WD.mqttDown + TICK_MS);
  var why = wdReboot(WD.wifiDown, WD.mqttDown, WD);
  if (why !== "") { print("controller: watchdog reboot —", why, "down too long"); Shelly.call("Shelly.Reboot", {}); }
}
function applyWdCfg(str) {
  if (!str) return;
  var c = JSON.parse(str);
  if (!c) return;
  if (typeof c.on !== "undefined") WD.on = c.on ? true : false;
  if (c.wifi) WD.wifiMs = c.wifi * 1000;
  if (c.mqtt) WD.mqttMs = c.mqtt * 1000;
}

function tick() {
  ticks++;
  watchdogTick();
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
          registerHttp();
          startLoop();
        });
      });
    });
}

boot();
