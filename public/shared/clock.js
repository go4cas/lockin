// @ts-check
// Server clock offset (TECH-SPEC 10.6). Shared by the display, phone and host console.
// Classic script, loaded with a plain <script> tag before a page's Arrow module (TECH-SPEC 3.4).
// Follows the display baseline (TECH-SPEC 3.3).
(/** @param {any} root */ function (root) {
  "use strict";
  var LockIn = root.LockIn || (root.LockIn = {});
  var KEEP = 5;

  class Clock {
    constructor() {
      /** @type {number[]} */
      this.samples = [];
      this.offsetMs = 0;
    }

    /**
     * Records one ping/pong round trip. Offset = s - (c + rtt / 2); the clock uses the
     * median of the last five offsets.
     * @param {number} c client time the ping was sent
     * @param {number} s server time in the pong
     * @param {number} [now] client time the pong arrived
     */
    sample(c, s, now) {
      var received = typeof now === "number" ? now : Date.now();
      var rtt = Math.max(0, received - c);
      this.samples.push(s - (c + rtt / 2));
      if (this.samples.length > KEEP) this.samples.shift();
      var sorted = this.samples.slice().sort(function (a, b) { return a - b; });
      var mid = Math.floor(sorted.length / 2);
      this.offsetMs = sorted.length % 2 ? Number(sorted[mid]) : (Number(sorted[mid - 1]) + Number(sorted[mid])) / 2;
      return this.offsetMs;
    }

    /**
     * A rough first estimate from a server time (for example welcome.serverNow),
     * used only until the first ping comes back.
     * @param {number} serverNow
     */
    seed(serverNow) {
      if (this.samples.length === 0) this.offsetMs = serverNow - Date.now();
    }

    /** Milliseconds to add to Date.now() to get server time. */
    offset() {
      return this.offsetMs;
    }

    /** The server's time now, as this client best knows it. */
    now() {
      return Date.now() + this.offsetMs;
    }

    /**
     * Milliseconds until a server time such as a timer's locksAt, never below 0.
     * @param {number} serverTime
     */
    remaining(serverTime) {
      return Math.max(0, serverTime - this.now());
    }
  }

  LockIn.Clock = Clock;
  LockIn.createClock = function () { return new Clock(); };
})(typeof window !== "undefined" ? window : globalThis);
