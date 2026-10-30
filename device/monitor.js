// monitor.js — Shelly Plus i4 DC, the MONITORING unit.
//
// Reads 4 dry-contact inputs, derives the door state (spec 02), and on every change:
//   (a) publishes a retained heartbeat to MQTT  devices/<id>/heartbeat   (any subscriber follows it)
//   (b) HTTP-POSTs the state to the controller (S1) for low latency — fire-and-forget, NEVER blocks (D-10)
// It also re-sends the picture to the S1 every ALIVE_MS, so the S1 heals after its own reboot or a failed POST.
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
var TICK_MS = 200;         // input poll (5 Hz). One tick costs ~100 ms of script CPU on the i4, so a 100 ms
                           // timer can't keep up: on 2026-10-30 it silently fired every other slot and
                           // doubled every tick-counted period. Declare the rate it can hold (D-23, Q-14).
                           // Every period below derives from TICK_MS — never hard-code ticks per second.
var DEBOUNCE_TICKS = 2;    // snapshot must be stable this many ticks before we accept it (~400ms)
// Motor-direction tiebreaker gate (Q-16 / spec 14, garage observation 2026-06-10). A reed engaged while
// the motor drives AWAY from it looks identical for a real DEPARTURE (sustained, measured ~510-780ms) and
// the EcoStar's end-of-travel relief REVERSE kick (brief, measured 140-220ms). Only treat it as departure
// once the conflict persists this many ticks. 4 ticks (~800ms) never trips on the reverse (it spans at most
// 2 samples); a departure mostly shows when the reed releases instead (D-23). PROVISIONAL — config-tunable.
var GATE_TICKS = 4;
var ALIVE_MS = 30000;      // liveness ping period
var POST_TIMEOUT = 5;      // seconds; controller POST is fire-and-forget
// Controller POSTs are single-flight so pictures reach the S1 in order: a periodic re-send in flight must
// not land AFTER a newer state-change POST and overwrite it. A POST asked for while one is in flight sets
// POST_AGAIN and the LATEST picture follows when it completes. POST_STUCK_TICKS: if a callback never comes,
// stop waiting for it (a stuck flag would silently kill the S1's feed).
var POST_STUCK_TICKS = (POST_TIMEOUT + 5) * 1000 / TICK_MS;
var POSTING = false; var POST_AGAIN = false; var POST_T = 0;

// Connectivity watchdog (Phase 7): reboot to recover a wedged Wi-Fi/MQTT stack after a prolonged
// outage. Our devices are STATELESS across reboot (door state is re-derived from live inputs), so boot
// is always safe — no reset_reason/resume gate needed. Defaults overridable via KVS "wd_cfg"
// {on:0|1, wifi:<s>, mqtt:<s>}; for the on-device test, set a short threshold then restore.
// Weak-signal guard (spec 13): Shelly's own roaming can leave us on a far AP for hours; only a reboot is
// proven to re-pick the strongest one. Reboot when the MEDIAN of the last RSSI_N samples over rssiWinMs is
// below rssi dBm and the motor is idle; at most once per rssiGapS, then hold until the signal is seen
// recovered (so a spot where every AP is weak can't loop). KVS "wd_cfg" {rssiOn,rssi,rssiWin,rssiGap}.
var WD = { on: true, wifiMs: 600000, mqttMs: 1800000, mqttEnabled: false, wifiDown: 0, mqttDown: 0,
           rssiOn: true, rssi: -85, rssiWinMs: 900000, rssiGapS: 21600 };
var RSSI_N = 15;           // samples per window (odd: the median is the middle one)
var RSSI_HYST = 5;         // dB above the threshold the median must reach to count as "recovered"
// guard runtime: sample ring, sample-period accumulator, current AP, persisted last guard reboot (KVS
// "wd_last" {ts,why,rssi,hold}), a KVS write in flight, and the commit-to-reboot latch.
var RG = { buf: [], i: 0, acc: 0, bssid: "", rec: null, busy: false, going: false };

// ---- runtime state ----
var CFG = { hbTopic: "", aliveTopic: "", controllerUrl: "" };
var STATE = "UNKNOWN";
var LASTDIR = "";          // "opening" | "closing" | ""
var SINCE = 0;             // unixtime when STATE last changed
var LASTMOVING = false;    // last published motor-moving (op||cl) — push on change so S1 sees the motor stop
var ticks = 0;
var lastSnap = "";         // for debounce
var stableCount = 0;
var conflictTicks = 0;     // consecutive ticks of (reed + opposite-motor) — gates departure vs reverse-kick
var appliedSnap = "";      // last snapshot we actually derived from
var booted = false;

// ---- pure state derivation (spec 02). Kept dependency-free so the Node tests exercise it directly. ----
// c,o,op,cl = booleans (closed reed, open reed, motor-opening, motor-closing). lastDir carries memory.
// returns { state: <STR>, dir: <updated lastDir> }.
// gateMet = the motor driving AWAY from an engaged reed has persisted past GATE_TICKS (real departure,
// not the brief end-of-travel reverse kick). Arrival overlap (reed + SAME-direction motor, e.g. c+cl) is
// NOT a conflict and the reed still wins immediately. See spec 14 / Q-16.
function derive(c, o, op, cl, lastDir, gateMet) {
  if (c && o) return { state: "UNKNOWN", dir: lastDir };    // both reeds active = sensor fault
  if (op && cl) return { state: "UNKNOWN", dir: lastDir };  // motor can't drive both ways = fault
  if (c && !(op && gateMet)) return { state: "CLOSED", dir: lastDir };  // at closed unless SUSTAINED opening (departing)
  if (o && !(cl && gateMet)) return { state: "OPEN", dir: lastDir };    // at open unless SUSTAINED closing (departing)
  if (op) return { state: "OPENING", dir: "opening" };      // pure opening, or departing-closed past the gate
  if (cl) return { state: "CLOSING", dir: "closing" };
  if (lastDir === "opening") return { state: "STOPPED_OPENING", dir: lastDir };
  if (lastDir === "closing") return { state: "STOPPED_CLOSING", dir: lastDir };
  return { state: "UNKNOWN", dir: lastDir };                // bootstrap: never moved, no reed
}

// pure watchdog decision: which outage (if any) warrants a reboot. Tested in the harness.
function wdReboot(wifiDownMs, mqttDownMs, cfg) {
  if (!cfg.on) return "";
  if (wifiDownMs >= cfg.wifiMs) return "wifi";
  if (mqttDownMs >= cfg.mqttMs) return "mqtt";
  return "";
}

// pure: median of the first n entries of a (n odd). Counting selection — no sort/temp array in mJS.
function medianOf(a, n) {
  var k = (n - 1) / 2;
  for (var i = 0; i < n; i++) {
    var lt = 0; var eq = 0;
    for (var j = 0; j < n; j++) { if (a[j] < a[i]) lt++; else if (a[j] === a[i]) eq++; }
    if (lt <= k && k < lt + eq) return a[i];
  }
  return null;
}
// pure weak-signal guard decision (shared shape with controller.js) — tested in the harness.
// med = window median (null until the window is full); rec = last guard reboot {ts,hold} or null.
// -> "reboot" | "recover" (clear the hold) | "".
function rssiGuard(med, idle, now, rec, cfg) {
  if (!cfg.on || !cfg.rssiOn || med === null) return "";
  if (rec && rec.hold) return (med >= cfg.rssi + RSSI_HYST) ? "recover" : "";
  if (med >= cfg.rssi || !idle || now <= 0) return "";
  if (rec && rec.ts && now - rec.ts < cfg.rssiGapS) return "";
  return "reboot";
}

// ---- helpers ----
function readInput(id) {
  var s = Shelly.getComponentStatus("input:" + id);
  return !!(s && s.state === true);
}
function wifiUp() { var w = Shelly.getComponentStatus("wifi"); return !!(w && w.status === "got ip"); }
function wifiRssi() { var w = Shelly.getComponentStatus("wifi"); return (w && typeof w.rssi === "number") ? w.rssi : null; }
function mqttUp() { var m = Shelly.getComponentStatus("mqtt"); return !!(m && m.connected === true); }
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
    since: SINCE, ts: nowTs(), rssi: wifiRssi(), v: SCHEMA
  };
}
function wdInfo() {
  var r = RG.rec;
  if (!r) return { last: 0, why: "", rssi: null, hold: false };
  return { last: r.ts || 0, why: r.why || "", rssi: (typeof r.rssi === "number") ? r.rssi : null, hold: !!r.hold };
}

function publishHeartbeat() {
  if (CFG.hbTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.hbTopic, JSON.stringify(payload()), 0, true);   // retained
}
// alive also carries the monitoring extras (rssi, weak-signal guard): LAN-only, never bridged (spec 03).
// Sent every ALIVE_MS, so HA gets a fresh rssi/wd even though the heartbeat only goes out on door changes.
function publishAlive() {
  if (CFG.aliveTopic === "" || typeof MQTT === "undefined" || !MQTT.isConnected()) return;
  MQTT.publish(CFG.aliveTopic, JSON.stringify({ ts: nowTs(), rssi: wifiRssi(), wd: wdInfo() }), 0, false);  // NOT retained
}
function postController() {
  if (CFG.controllerUrl === "") return;   // S1 not configured yet -> skip cleanly
  if (POSTING && ticks - POST_T < POST_STUCK_TICKS) { POST_AGAIN = true; return; }
  POSTING = true; POST_AGAIN = false; POST_T = ticks;
  // fire-and-forget: the tick never waits on it. NEVER block on the controller (D-10).
  Shelly.call("HTTP.POST",
    { url: CFG.controllerUrl, body: JSON.stringify(payload()), timeout: POST_TIMEOUT },
    function (res, ec, em) {
      POSTING = false;
      if (ec) { print("monitor: controller POST failed (ignored):", ec, em); }
      if (POST_AGAIN) postController();    // a newer picture was asked for meanwhile -> send the latest
    });
}

function pushPicture() {
  print("monitor: state", STATE, "moving", (LASTMOVING ? 1 : 0), "(dir", LASTDIR + ")");
  publishHeartbeat();
  postController();
}

function evaluate() {
  var s = snapshot();
  var key = snapKey(s);
  // conflict = reed engaged while the motor drives AWAY from it (departure OR end-reverse kick).
  // Count consecutive ticks; gate distinguishes a sustained departure from the brief reverse (spec 14).
  var conflict = (s.c && s.op) || (s.o && s.cl);
  conflictTicks = conflict ? (conflictTicks + 1) : 0;
  var gateMet = conflictTicks >= GATE_TICKS;
  if (key === lastSnap) { stableCount++; } else { stableCount = 0; lastSnap = key; }
  if (stableCount < DEBOUNCE_TICKS) return;        // wait for the snapshot to settle
  var akey = key + (gateMet ? "G" : "g");          // re-derive when the gate flips, even if inputs are unchanged
  if (akey === appliedSnap) return;
  appliedSnap = akey;
  var d = derive(s.c, s.o, s.op, s.cl, LASTDIR, gateMet);
  LASTDIR = d.dir;
  var moving = (s.op || s.cl) ? true : false;
  if (d.state !== STATE) {                  // state change -> stamp SINCE, push
    STATE = d.state; SINCE = nowTs(); LASTMOVING = moving; pushPicture();
  } else if (moving !== LASTMOVING) {        // motor started/stopped within the same state (e.g. arrival
    LASTMOVING = moving; pushPicture();       // overlap settling) -> push so the controller's at-rest guard sees it
  }
}

function watchdogTick() {
  WD.wifiDown = wifiUp() ? 0 : (WD.wifiDown + TICK_MS);
  WD.mqttDown = (!WD.mqttEnabled || !wifiUp() || mqttUp()) ? 0 : (WD.mqttDown + TICK_MS);
  var why = wdReboot(WD.wifiDown, WD.mqttDown, WD);
  if (why !== "") { print("monitor: watchdog reboot —", why, "down too long"); Shelly.call("Shelly.Reboot", {}); }
}

// idle = motor not running (live inputs and the last applied picture), so a reboot never blinds the
// controller mid-travel. The i4 holds nothing else a reboot could cut short (D-20).
function doorIdle() {
  var s = snapshot();
  return !s.op && !s.cl && !LASTMOVING;
}
function saveRec(rec, cb) {
  RG.busy = true;
  Shelly.call("KVS.Set", { key: "wd_last", value: JSON.stringify(rec) }, function (r, ec) {
    RG.busy = false;
    cb(!ec);
  });
}
function rssiTick() {
  RG.acc += TICK_MS;
  if (RG.acc < WD.rssiWinMs / RSSI_N) return;
  RG.acc = 0;
  var w = Shelly.getComponentStatus("wifi");
  if (!w || w.status !== "got ip" || typeof w.rssi !== "number") return;   // no IP: the Wi-Fi watchdog's job
  if (w.bssid !== RG.bssid) { RG.bssid = w.bssid; RG.buf = []; RG.i = 0; }   // (re)associated: fresh window
  // ring: fill by push, then overwrite the oldest (index RG.i)
  if (RG.buf.length < RSSI_N) RG.buf.push(w.rssi); else { RG.buf[RG.i] = w.rssi; RG.i = (RG.i + 1) % RSSI_N; }
  if (RG.busy || RG.going) return;
  var med = (RG.buf.length === RSSI_N) ? medianOf(RG.buf, RSSI_N) : null;
  var act = rssiGuard(med, doorIdle(), nowTs(), RG.rec, WD);
  if (act === "recover") {
    var ok = { ts: RG.rec.ts, why: RG.rec.why, rssi: RG.rec.rssi, hold: 0 };
    saveRec(ok, function (saved) {
      if (!saved) return;
      RG.rec = ok; print("monitor: rssi guard — signal recovered (median", med, "dBm), hold cleared");
      publishAlive();
    });
  } else if (act === "reboot") {
    RG.going = true;
    var rec = { ts: nowTs(), why: "rssi", rssi: med, hold: 1 };
    print("monitor: rssi guard reboot — median", med, "dBm <", WD.rssi, "over", WD.rssiWinMs / 1000, "s");
    // persist FIRST: without the record the rate limit can't survive the reboot -> never reboot unrecorded
    saveRec(rec, function (saved) {
      if (!saved) { RG.going = false; print("monitor: rssi guard — KVS.Set failed, not rebooting"); return; }
      RG.rec = rec; publishAlive();
      Shelly.call("Shelly.Reboot", {});
    });
  }
}

function tick() {
  ticks++;
  evaluate();
  watchdogTick();
  rssiTick();
  if ((ticks % (ALIVE_MS / TICK_MS)) === 0) { publishAlive(); postController(); }
}

// KVS values may come back as a JSON STRING or an already-parsed OBJECT; JSON.parse(object) throws on-device
// and would crash boot, so never parse a non-string. Object passes through, JSON text is parsed, else ignore.
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
  if (typeof c.rssiOn !== "undefined") WD.rssiOn = c.rssiOn ? true : false;
  if (typeof c.rssi === "number" && c.rssi >= -100 && c.rssi <= -60) WD.rssi = c.rssi;   // sane range only
  if (c.rssiWin >= 15) WD.rssiWinMs = c.rssiWin * 1000;
  if (c.rssiGap >= 60) WD.rssiGapS = c.rssiGap;
}
function applyWdLast(v) {
  var r = cfgObj(v);
  if (r && typeof r.ts === "number") RG.rec = r;
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
      WD.mqttEnabled = (cfg.enable === true);
    }
    // controller URL lives in KVS so it's not hardcoded; absent until S1 exists (Q-06).
    Shelly.call("KVS.Get", { key: "controller_url" }, function (r) {
      if (r && r.value) CFG.controllerUrl = r.value;
      Shelly.call("KVS.Get", { key: "wd_cfg" }, function (w) {
        applyWdCfg(w && w.value);
        Shelly.call("KVS.Get", { key: "wd_last" }, function (wl) {
          applyWdLast(wl && wl.value);
          registerHttp();
          startLoop();
        });
      });
    });
  });
}

boot();
