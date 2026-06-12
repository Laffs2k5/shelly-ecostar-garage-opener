// garage-core.js — pure logic for the web control page (no DOM, no network), so it's unit-testable in
// Node and reusable in the browser. Mirrors the device contract: read door state from the i4
// (garage-monitor heartbeat), send commands to the S1 (garage-controller command). See docs/spec 02/03.
(function (root) {
  "use strict";

  var VALID = ["open", "close", "toggle", "stop"];

  // MQTT topics derived from the two device identities (CN = topic root; D-15).
  function topics(monitorId, controllerId) {
    return {
      state: "devices/" + monitorId + "/heartbeat",       // i4 door state (retained)
      monAlive: "mon/" + monitorId + "/alive",
      command: "devices/" + controllerId + "/command",     // -> S1
      ctrlState: "devices/" + controllerId + "/heartbeat",
    };
  }

  // Cloud broker WSS endpoint (EMQX). The web is cloud-only (mixed-content + no client-cert in-browser).
  function brokerUrl(host) { return "wss://" + host + ":8084/mqtt"; }

  // Web client-ids are random so they never collide with the phone's stable id.
  function randomClientId() {
    var s = "";
    for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
    return "garage-web-" + s;
  }

  function validCmd(c) { return VALID.indexOf(c) >= 0; }
  // The controller accepts a plain command string (or {cmd}). Keep it simple: send the bare word.
  function buildCommand(cmd) { return validCmd(cmd) ? cmd : ""; }

  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  // Parse an i4 heartbeat payload (string or object) into a door picture, or null if unusable.
  function parseDoor(payload) {
    var o = (typeof payload === "string") ? safeParse(payload) : payload;
    if (!o || !o.state) return null;
    return { state: o.state, dir: o.dir || "", since: o.since || 0, ts: o.ts || 0, inputs: o.inputs || null };
  }

  // ---- display helpers ----
  var LABELS = {
    CLOSED: "Closed", OPEN: "Open", OPENING: "Opening…", CLOSING: "Closing…",
    STOPPED_OPENING: "Stopped (opening)", STOPPED_CLOSING: "Stopped (closing)", UNKNOWN: "Unknown"
  };
  function label(state) { return LABELS[state] || state || "—"; }
  // Big-display label drops the "(opening/closing)" parenthetical (the subtext carries it) — mirrors the app.
  function shortLabel(state) { return isStopped(state) ? "Stopped" : label(state); }
  function isMoving(state) { return state === "OPENING" || state === "CLOSING"; }
  function isStopped(state) { return state === "STOPPED_OPENING" || state === "STOPPED_CLOSING"; }

  // Morphing action button — mirrors the app's ActionModel. Returns 1 action (full-width), or 2 (the
  // STOPPED split pair). tone: "primary" (cyan, open/close/engage) or "caution" (orange, stop).
  function actionsFor(state) {
    switch (state) {
      case "CLOSED": return [{ label: "Open", cmd: "open", tone: "primary", arrow: "▲" }];
      case "OPEN": return [{ label: "Close", cmd: "close", tone: "primary", arrow: "▼" }];
      case "OPENING":
      case "CLOSING": return [{ label: "Stop", cmd: "stop", tone: "caution", arrow: "■" }];
      case "STOPPED_OPENING":
      case "STOPPED_CLOSING":
        return [{ label: "Open", cmd: "open", tone: "primary", arrow: "▲" },
                { label: "Close", cmd: "close", tone: "primary", arrow: "▼" }];
      default: return [{ label: "Engage", cmd: "toggle", tone: "primary", arrow: "" }];
    }
  }
  function isSplit(state) { return isStopped(state); }

  // Connection history (mirrors ConnectionUi.pushIfChanged): newest-first, capped at 4, only on change.
  function pushLog(log, mode, time) {
    if (log.length && log[0].mode === mode) return log;
    return [{ mode: mode, time: time }].concat(log).slice(0, 4);
  }
  function connLabel(mode) {
    return { CLOUD: "Cloud", CONNECTED: "Cloud", OFFLINE: "Offline", DEMO: "Demo" }[mode] || mode;
  }

  // Demo simulation (mirrors the app's DemoEngine): self-contained, no network. ms-driven + deterministic.
  function createDemo(travelMs) {
    travelMs = travelMs || 4000;
    var state = "CLOSED", phaseStart = 0;
    function enter(s, now) { state = s; phaseStart = now; }
    function advance(now) {
      var e = now - phaseStart;
      if (state === "OPENING" && e >= travelMs) enter("OPEN", now);
      else if (state === "CLOSING" && e >= travelMs) enter("CLOSED", now);
    }
    var O = "OPENING", C = "CLOSING", SO = "STOPPED_OPENING", SC = "STOPPED_CLOSING";
    return {
      door: function (now) {
        advance(now);
        var dir = state === O ? "opening" : state === C ? "closing" : "";
        return { state: state, dir: dir, since: Math.floor(phaseStart / 1000), ts: Math.floor(now / 1000) };
      },
      command: function (cmd, now) {
        if (cmd === "open" && (state === "CLOSED" || state === SO || state === SC)) enter(O, now);
        else if (cmd === "close" && (state === "OPEN" || state === SO || state === SC)) enter(C, now);
        else if (cmd === "stop") { if (state === O) enter(SO, now); else if (state === C) enter(SC, now); }
        else if (cmd === "toggle") {
          if (state === "CLOSED") enter(O, now); else if (state === "OPEN") enter(C, now);
          else if (state === O) enter(SO, now); else if (state === C) enter(SC, now); else enter(O, now);
        }
      },
      state: function () { return state; }
    };
  }

  function durationSec(door, nowSec) {
    if (!door || !door.since || !nowSec || nowSec < door.since) return 0;
    return nowSec - door.since;
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  }

  // Connection decision (web): a fresh broker door picture, else offline. (HTTP-direct is the app's job.)
  function decide(brokerDoor, connected) {
    if (connected && brokerDoor) return { door: brokerDoor, mode: "CLOUD" };
    return { door: null, mode: connected ? "CONNECTED" : "OFFLINE" };
  }

  var api = {
    VALID: VALID, topics: topics, brokerUrl: brokerUrl, randomClientId: randomClientId,
    validCmd: validCmd, buildCommand: buildCommand, parseDoor: parseDoor,
    label: label, shortLabel: shortLabel, isMoving: isMoving, isStopped: isStopped,
    durationSec: durationSec, fmtDur: fmtDur,
    actionsFor: actionsFor, isSplit: isSplit, pushLog: pushLog, connLabel: connLabel, createDemo: createDemo,
    decide: decide,
    DEFAULTS: { monitorId: "garage-monitor", controllerId: "garage-controller" }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GarageCore = api;
})(typeof self !== "undefined" ? self : this);
