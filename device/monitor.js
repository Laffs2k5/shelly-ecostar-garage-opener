// monitor.js — Shelly Plus i4 DC, the MONITORING unit.
//
// Reads 4 dry-contact inputs, derives the door state (spec 02), and on every change:
//   (a) publishes a retained heartbeat to MQTT  devices/<id>/heartbeat   (any subscriber follows it)
//   (b) HTTP-POSTs the state to the controller (S1) for low latency — fire-and-forget, NEVER blocks (D-10)
// Also publishes a non-retained liveness ping to  mon/<id>/alive  periodically (spec 03), and exposes
// the current state at the local HTTP endpoint  /script/<id>/state  (handy for tests, no MQTT needed).
//
// mJS constraints (NEW-PROJECT-GUIDE §4): ES5 only (var/function, no arrow/let/const/template), ONE
// repeating timer with counter dispatch, read inputs synchronously via Shelly.getComponentStatus (no
// Shelly.call needed for reads), JSON.parse returns undefined on failure. Deploy the MINIFIED build.
//
// Inputs (type switch, invert:false, D-16 — state true = contact closed = SWn pulled to ground):
//   input:0 = SW1 reed CLOSED   input:1 = SW2 reed OPEN
//   input:2 = SW3 motor OPENING  input:3 = SW4 motor CLOSING

var SCHEMA = 1;            // heartbeat payload version
var TICK_MS = 50;          // input poll interval
var DEBOUNCE_TICKS = 2;    // snapshot must be stable this many ticks before we accept it (~100ms)
var ALIVE_MS = 30000;      // liveness ping period
var POST_TIMEOUT = 5;      // seconds; controller POST is fire-and-forget

// ---- runtime state ----
var CFG = { hbTopic: "", aliveTopic: "", controllerUrl: "" };
var STATE = "UNKNOWN";
var LASTDIR = "";          // "opening" | "closing" | ""
var SINCE = 0;             // unixtime when STATE last changed
var ticks = 0;
var lastSnap = "";         // for debounce
var stableCount = 0;
var appliedSnap = "";      // last snapshot we actually derived from
var booted = false;

// ---- pure state derivation (spec 02). Kept dependency-free so the Node tests exercise it directly. ----
// c,o,op,cl = booleans (closed reed, open reed, motor-opening, motor-closing). lastDir carries memory.
// returns { state: <STR>, dir: <updated lastDir> }.
function derive(c, o, op, cl, lastDir) {
  if (c && o) return { state: "UNKNOWN", dir: lastDir };   // both reeds active = sensor fault
  if (op && cl) return { state: "UNKNOWN", dir: lastDir };  // motor can't drive both ways = fault
  if (c) return { state: "CLOSED", dir: lastDir };          // reeds win (ground truth)
  if (o) return { state: "OPEN", dir: lastDir };
  if (op) return { state: "OPENING", dir: "opening" };
  if (cl) return { state: "CLOSING", dir: "closing" };
  if (lastDir === "opening") return { state: "STOPPED_OPENING", dir: lastDir };
  if (lastDir === "closing") return { state: "STOPPED_CLOSING", dir: lastDir };
  return { state: "UNKNOWN", dir: lastDir };                // bootstrap: never moved, no reed
}

// ---- helpers ----
function readInput(id) {
  var s = Shelly.getComponentStatus("input:" + id);
  return !!(s && s.state === true);
}
function nowTs() {
  var sys = Shelly.getComponentStatus("sys");
  return (sys && sys.unixtime) ? sys.unixtime : 0;
}
function snapshot() {
  return {
    c: readInput(0), o: readInput(1), op: readInput(2), cl: readInput(3)
  };
}
function snapKey(s) {
  return (s.c ? "1" : "0") + (s.o ? "1" : "0") + (s.op ? "1" : "0") + (s.cl ? "1" : "0");
}
function payload() {
  var s = snapshot();
  return {
    state: STATE, dir: LASTDIR,
    inputs: { c: s.c, o: s.o, op: s.op, cl: s.cl },
    since: SINCE, ts: nowTs(), v: SCHEMA
  };
}

function publishHeartbeat() {
  if (CFG.hbTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.hbTopic, JSON.stringify(payload()), 0, true);   // retained
}
function publishAlive() {
  if (CFG.aliveTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.aliveTopic, JSON.stringify({ ts: nowTs() }), 0, false);  // NOT retained
}
function postController() {
  if (CFG.controllerUrl === "") return;   // S1 not configured yet -> skip cleanly
  // fire-and-forget; the callback only logs. NEVER block on the controller (D-10).
  Shelly.call("HTTP.POST",
    { url: CFG.controllerUrl, body: JSON.stringify(payload()), timeout: POST_TIMEOUT },
    function (res, ec, em) {
      if (ec) { print("monitor: controller POST failed (ignored):", ec, em); }
    });
}

function onStateChange() {
  SINCE = nowTs();
  print("monitor: state ->", STATE, "(dir", LASTDIR + ")");
  publishHeartbeat();
  postController();
}

function evaluate() {
  var s = snapshot();
  var key = snapKey(s);
  if (key === lastSnap) { stableCount++; } else { stableCount = 0; lastSnap = key; }
  if (stableCount < DEBOUNCE_TICKS) return;        // wait for the snapshot to settle
  if (key === appliedSnap) return;                 // already derived from this exact snapshot
  appliedSnap = key;
  var d = derive(s.c, s.o, s.op, s.cl, LASTDIR);
  LASTDIR = d.dir;
  if (d.state !== STATE) { STATE = d.state; onStateChange(); }
}

function tick() {
  ticks++;
  evaluate();
  if ((ticks % (ALIVE_MS / TICK_MS)) === 0) publishAlive();
}

// ---- HTTP status endpoint: GET /script/<id>/state ----
function registerHttp() {
  if (typeof HTTPServer === "undefined") return;
  HTTPServer.registerEndpoint("state", function (req, res) {
    res.code = 200;
    res.headers = [["Content-Type", "application/json"]];
    res.body = JSON.stringify(payload());
    res.send();
  });
}

// ---- boot: fetch MQTT identity (for topics) then optional controller URL, then start the loop ----
function startLoop() {
  if (booted) return;
  booted = true;
  // derive an initial state immediately so the first heartbeat reflects reality
  var s = snapshot();
  lastSnap = snapKey(s); appliedSnap = lastSnap; stableCount = DEBOUNCE_TICKS;
  var d = derive(s.c, s.o, s.op, s.cl, LASTDIR);
  LASTDIR = d.dir; STATE = d.state; SINCE = nowTs();
  publishHeartbeat(); publishAlive();
  Timer.set(TICK_MS, true, tick);
  print("monitor: started; state =", STATE);
}

function boot() {
  Shelly.call("MQTT.GetConfig", {}, function (cfg) {
    if (cfg) {
      var prefix = cfg.topic_prefix || "";
      var id = cfg.client_id || "";
      if (prefix !== "") CFG.hbTopic = prefix + "/heartbeat";
      if (id !== "") CFG.aliveTopic = "mon/" + id + "/alive";
    }
    // controller URL lives in KVS so it's not hardcoded; absent until S1 exists (Q-06).
    Shelly.call("KVS.Get", { key: "controller_url" }, function (r) {
      if (r && r.value) CFG.controllerUrl = r.value;
      registerHttp();
      startLoop();
    });
  });
}

boot();
