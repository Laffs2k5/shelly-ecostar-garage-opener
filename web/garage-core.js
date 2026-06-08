// garage-core.js — pure logic for the web control page (no DOM, no network), so it's unit-testable in
// Node and reusable in the browser. Mirrors the device contract: read door state from the i4
// (garage-monitor heartbeat), send commands to the S1 (garage-controller command). See docs/spec 02/03.
(function (root) {
  "use strict";

  var VALID = ["open", "close", "toggle"];

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
  function isMoving(state) { return state === "OPENING" || state === "CLOSING"; }
  function isStopped(state) { return state === "STOPPED_OPENING" || state === "STOPPED_CLOSING"; }

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
    label: label, isMoving: isMoving, isStopped: isStopped, durationSec: durationSec, fmtDur: fmtDur,
    decide: decide,
    DEFAULTS: { monitorId: "garage-monitor", controllerId: "garage-controller" }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GarageCore = api;
})(typeof self !== "undefined" ? self : this);
