// Node test harness — loads a REAL device script (monitor.js or controller.js) into a vm context with a
// mocked Shelly runtime, so tests drive inputs/commands and assert on captured output (MQTT, HTTP posts,
// relay Switch.Set, endpoint bodies). Black-box: tests read captured effects, not internals.
//
// (Plain Node — modern JS is fine here. Only the device scripts must be mJS/ES5.)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createHarness(opts) {
  opts = opts || {};
  const h = {
    inputs: { 0: false, 1: false, 2: false, 3: false },
    clock: 1000,
    mqttConnected: opts.mqttConnected !== false,
    mqttConfig: opts.mqttConfig || { topic_prefix: "devices/garage-monitor", client_id: "garage-monitor" },
    kvs: {},
    switchOutput: false,
    switchConfig: null,
    wifiUp: true,
    wifiRssi: (opts.wifiRssi !== undefined ? opts.wifiRssi : -55),
    mqttConn: opts.mqttConnected !== false,
    reboots: 0,
    published: [],   // {topic, msg, qos, retain}
    posts: [],       // HTTP.POST {url, body}
    switchSets: [],  // {id, on}
    subs: {},        // topic -> cb
    logs: [],
    timers: [],      // {ms, repeat, cb}
    endpoints: {},   // name -> cb
  };
  if (opts.controllerUrl) h.kvs.controller_url = opts.controllerUrl;
  if (opts.kvs) Object.assign(h.kvs, opts.kvs);   // seed KVS before boot() reads it (e.g. logic_cfg)
  if (opts.inputs) {
    h.inputs[0] = !!opts.inputs.c; h.inputs[1] = !!opts.inputs.o;
    h.inputs[2] = !!opts.inputs.op; h.inputs[3] = !!opts.inputs.cl;
  }

  function compStatus(key) {
    if (key.indexOf("input:") === 0) { const id = parseInt(key.slice(6), 10); return { id: id, state: !!h.inputs[id] }; }
    if (key.indexOf("switch:") === 0) { return { id: 0, output: h.switchOutput }; }
    if (key === "wifi") return { status: h.wifiUp ? "got ip" : "disconnected", rssi: h.wifiRssi };
    if (key === "mqtt") return { connected: h.mqttConn };
    if (key === "sys") return { unixtime: h.clock };
    return undefined;
  }

  const Shelly = {
    getComponentStatus: compStatus,
    call: function (method, params, cb) {
      if (method === "MQTT.GetConfig") return void cb(h.mqttConfig, 0, "");
      if (method === "KVS.Get") {
        const key = params && params.key;
        if (Object.prototype.hasOwnProperty.call(h.kvs, key)) return void cb({ value: h.kvs[key] }, 0, "");
        return void cb(null, -105, "no such key");
      }
      if (method === "HTTP.POST") { h.posts.push({ url: params.url, body: params.body }); return void cb({ code: 200 }, 0, ""); }
      if (method === "Switch.Set") { h.switchSets.push({ id: params.id, on: params.on }); h.switchOutput = !!params.on; return void (cb && cb({ was_on: false }, 0, "")); }
      if (method === "Switch.SetConfig") { h.switchConfig = params.config; return void (cb && cb({ restart_required: false }, 0, "")); }
      if (method === "Shelly.Reboot") { h.reboots++; return void (cb && cb(null, 0, "")); }
      if (cb) cb(null, -1, "unhandled " + method);
    },
  };
  const MQTT = {
    isConnected: function () { return h.mqttConnected; },
    publish: function (topic, msg, qos, retain) { h.published.push({ topic: topic, msg: msg, qos: qos | 0, retain: !!retain }); },
    subscribe: function (topic, cb) { h.subs[topic] = cb; },
  };
  const Timer = {
    set: function (ms, repeat, cb) { h.timers.push({ ms: ms, repeat: repeat, cb: cb }); return h.timers.length; },
    clear: function () {},
  };
  const HTTPServer = { registerEndpoint: function (name, cb) { h.endpoints[name] = cb; } };
  const sandbox = {
    Shelly: Shelly, MQTT: MQTT, Timer: Timer, HTTPServer: HTTPServer, JSON: JSON, Date: Date,
    print: function () { h.logs.push(Array.prototype.join.call(arguments, " ")); },
  };
  const src = fs.readFileSync(path.join(__dirname, "..", opts.script || "monitor.js"), "utf8");
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: opts.script || "monitor.js" });

  // ---- controls / observation ----
  h.sandbox = sandbox;
  h.derive = sandbox.derive;            // monitor pure fn
  h.pulsesFor = sandbox.pulsesFor;      // controller pure fn
  h.wdReboot = sandbox.wdReboot;        // watchdog pure fn (both scripts)
  h.setNet = function (wifiUp, mqttConn) { h.wifiUp = wifiUp; h.mqttConn = mqttConn; };
  h.setInputs = function (c, o, op, cl) { h.inputs[0] = c; h.inputs[1] = o; h.inputs[2] = op; h.inputs[3] = cl; };
  h._repeatCb = function () { const t = h.timers.filter(function (t) { return t.repeat; })[0]; return t && t.cb; };
  h.tick = function (n) { const cb = h._repeatCb(); n = n || 1; for (let i = 0; i < n; i++) { h.clock++; cb(); } };
  h.settle = function () { h.tick(4); };                                  // monitor debounce
  // Fire pending one-shots, draining repeatedly so a rolling self-rescheduling sequence (the N-pulse
  // controller sequencer) plays to completion. Capped to avoid an infinite loop on a bug.
  h.fireOneShots = function () {
    for (let guard = 0; guard < 50; guard++) {
      const os = h.timers.filter(function (t) { return !t.repeat; });
      if (os.length === 0) return;
      h.timers = h.timers.filter(function (t) { return t.repeat; });
      os.forEach(function (t) { t.cb(); });
    }
  };
  h.oneShotMs = function () { return h.timers.filter(function (t) { return !t.repeat; }).map(function (t) { return t.ms; }); };
  h.sendCmd = function (msg) { for (const t in h.subs) h.subs[t](t, msg); };  // simulate an MQTT command
  h.post = function (name, o) {
    o = o || {}; const out = { code: 0, body: null };
    const res = { code: 0, headers: null, body: null, send: function () { out.code = this.code; out.body = this.body; } };
    h.endpoints[name]({ body: o.body || "", query: o.query || "" }, res);
    return out;
  };
  h.heartbeats = function () { return h.published.filter(function (p) { return /\/heartbeat$/.test(p.topic); }); };
  h.lastHeartbeat = function () { const hb = h.heartbeats(); return hb.length ? JSON.parse(hb[hb.length - 1].msg) : null; };
  h.state = function () { const hb = h.lastHeartbeat(); return hb && hb.state; };
  h.alives = function () { return h.published.filter(function (p) { return /^mon\/.*\/alive$/.test(p.topic); }); };
  h.endpointState = function () {
    let body = null;
    const res = { code: 0, headers: null, body: null, send: function () { body = this.body; } };
    h.endpoints["state"]({}, res);
    return JSON.parse(body);
  };
  return h;
}

module.exports = { createHarness: createHarness };
