// Node test harness for monitor.js — loads the REAL device script into a vm context with a mocked
// Shelly runtime, so we can drive inputs and assert on what the script publishes / posts. Black-box:
// tests read the captured MQTT heartbeats, HTTP posts, and the /state endpoint body, not internals.
//
// (This harness is plain Node — modern JS is fine here. Only device/monitor.js must be mJS/ES5.)
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
    published: [],   // {topic, msg, qos, retain}
    posts: [],       // {url, body}
    logs: [],
    timers: [],
    endpoints: {},
  };
  if (opts.controllerUrl) h.kvs.controller_url = opts.controllerUrl;
  if (opts.inputs) {
    h.inputs[0] = !!opts.inputs.c; h.inputs[1] = !!opts.inputs.o;
    h.inputs[2] = !!opts.inputs.op; h.inputs[3] = !!opts.inputs.cl;
  }

  function compStatus(key) {
    if (key.indexOf("input:") === 0) {
      const id = parseInt(key.slice(6), 10);
      return { id: id, state: !!h.inputs[id] };
    }
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
        return void cb(null, -105, "no such key");   // real Shelly errors on a missing KVS key
      }
      if (method === "HTTP.POST") {
        h.posts.push({ url: params.url, body: params.body });
        return void cb({ code: 200 }, 0, "");
      }
      if (cb) cb(null, -1, "unhandled " + method);
    },
  };
  const MQTT = {
    isConnected: function () { return h.mqttConnected; },
    publish: function (topic, msg, qos, retain) {
      h.published.push({ topic: topic, msg: msg, qos: qos | 0, retain: !!retain });
    },
  };
  const Timer = {
    set: function (ms, repeat, cb) { h.timers.push({ ms: ms, repeat: repeat, cb: cb }); return h.timers.length; },
    clear: function () {},
  };
  const HTTPServer = {
    registerEndpoint: function (name, cb) { h.endpoints[name] = cb; },
  };
  const sandbox = {
    Shelly: Shelly, MQTT: MQTT, Timer: Timer, HTTPServer: HTTPServer,
    JSON: JSON, Date: Date,
    print: function () { h.logs.push(Array.prototype.join.call(arguments, " ")); },
  };
  const src = fs.readFileSync(path.join(__dirname, "..", "monitor.js"), "utf8");
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "monitor.js" });

  // ---- controls / observation ----
  h.sandbox = sandbox;
  h.derive = sandbox.derive;                       // the pure function, for direct unit tests
  h.setInputs = function (c, o, op, cl) { h.inputs[0] = c; h.inputs[1] = o; h.inputs[2] = op; h.inputs[3] = cl; };
  h._tickCb = function () { const t = h.timers.filter(function (t) { return t.repeat; })[0]; return t && t.cb; };
  h.tick = function (n) { const cb = h._tickCb(); n = n || 1; for (let i = 0; i < n; i++) { h.clock++; cb(); } };
  // tick enough for the debounce to accept a freshly-changed snapshot
  h.settle = function () { h.tick(4); };
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
