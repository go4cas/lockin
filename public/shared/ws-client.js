// @ts-check
// Reconnecting WebSocket client for every screen (TECH-SPEC 10.2, 10.5, 10.6, 11).
// Classic script, loaded with a plain <script> tag before a page's Arrow module (TECH-SPEC 3.4).
// Follows the display baseline (TECH-SPEC 3.3).
// Load clock.js first.
//
//   var client = LockIn.connect({
//     role: "display",                              // "display" | "team" | "host"
//     getToken: function () { return null; },       // team device token or display pairing token, read on every connect
//     onPaired: function (token) {},                // display only: keep this token (REVIEW finding 4)
//     onState: function (view, msg) {},             // render the view
//     onStatus: function (status) {},               // "connecting" | "online" | "offline"
//     onWelcome: function (msg) {},
//     onBye: function (reason) {},
//   });
//   client.cmd("answer.submit", { questionId: "q-…", value: {…} })
//     .then(function (result) {}, function (error) { /* error.code, error.message */ });
//   client.clock.remaining(locksAt);
(/** @param {any} root */ function (root) {
  "use strict";
  var LockIn = root.LockIn || (root.LockIn = {});

  var PROTOCOL = 1;
  var BACKOFF_MS = [500, 1000, 2000, 4000];
  var BACKOFF_MAX_MS = 5000;
  var JITTER = 0.3;
  var FAST_PING_MS = 2000;
  var FAST_PING_FOR_MS = 10000;
  var SLOW_PING_MS = 25000;
  var OFFLINE_AFTER_MS = 2000;
  // Dead-connection detection (code review LI-001). A socket can stay OPEN while the network
  // silently drops everything (Wi-Fi handover, a phone's radio asleep), and the browser only
  // fires close much later, if ever. So the client keeps its own deadlines:
  var HANDSHAKE_TIMEOUT_MS = 10000;   // from creating the socket to the server's welcome
  var SILENCE_MS = SLOW_PING_MS + 10000;   // no message at all for this long: the socket is dead (35 s)
  var WATCHDOG_MS = 5000;             // how often the client checks
  var WAKE_PROBE_MS = 10000;          // after a suspension, the server gets this long to answer a ping
  var COMMAND_TIMEOUT_MS = 10000;     // an unanswered command settles as "timeout"
  /** @type {Object<string, boolean>} */
  var STOP_ON_BYE = { moved: true, removed: true, signed_out: true, protocol: true };

  function noop() {}

  /** Delay before reconnect attempt n (0-based): 0.5, 1, 2, 4, then 5 s, each plus up to 30% jitter. */
  /**
   * @param {number} attempt
   * @param {function(): number} [random]
   */
  function backoff(attempt, random) {
    var base = Number(attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : BACKOFF_MAX_MS);
    return Math.round(base + base * JITTER * (random ? random() : Math.random()));
  }

  /**
   * True on this machine only (localhost or 127.0.0.1), where scripts/fixture-server.ts runs.
   * Test plumbing such as ?fixture= is ignored anywhere else (audit SA-21).
   * @param {any} loc
   */
  function isFixtureHost(loc) {
    return !!loc && (loc.hostname === "localhost" || loc.hostname === "127.0.0.1");
  }

  /** The /ws address for this page. Passes ?fixture= through for scripts/fixture-server.ts, on localhost only. */
  function defaultUrl() {
    var loc = root.location;
    var url = (loc.protocol === "https:" ? "wss://" : "ws://") + loc.host + "/ws";
    var m = isFixtureHost(loc) ? /[?&]fixture=([^&#]*)/.exec(loc.search || "") : null;
    if (m) url += "?fixture=" + m[1];
    return url;
  }

  class Client {
    /** @param {any} opts */
    constructor(opts) {
      if (!opts || !opts.role) throw new Error("LockIn.connect needs a role");
      this.role = opts.role;
      this.url = opts.url || defaultUrl();
      this.getToken = opts.getToken || function () { return null; };
      this.onState = opts.onState || noop;
      this.onStatus = opts.onStatus || noop;
      this.onWelcome = opts.onWelcome || noop;
      this.onBye = opts.onBye || noop;
      this.onPaired = opts.onPaired || noop;
      this.createSocket = opts.createSocket || function (/** @type {string} */ url) { return new WebSocket(url); };
      this.offlineAfterMs = typeof opts.offlineAfterMs === "number" ? opts.offlineAfterMs : OFFLINE_AFTER_MS;
      this.random = opts.random || Math.random;
      this.clock = opts.clock || LockIn.createClock();
      // Timer functions; tests pass a virtual clock here.
      var timers = opts.timers || {};
      this.now = timers.now || function () { return Date.now(); };
      this.setTimer = timers.setTimeout || function (/** @type {function(): void} */ fn, /** @type {number} */ ms) { return setTimeout(fn, ms); };
      this.clearTimer = timers.clearTimeout || function (/** @type {any} */ t) { clearTimeout(t); };
      this.commandTimeoutMs = typeof opts.commandTimeoutMs === "number" ? opts.commandTimeoutMs : COMMAND_TIMEOUT_MS;

      /** @type {any} */
      this.socket = null;
      this.status = "connecting";
      this.attempt = 0;
      this.nextId = 1;
      /** @type {Object<string, {resolve: function(any): void, reject: function(any): void, timer: any}>} */
      this.pending = {};
      this.lastSeq = -1;
      /** @type {any} */
      this.view = null;
      this.teamId = null;
      this.stopped = false;
      this.welcomed = false;
      this.connectedAt = 0;
      /** @type {any} */ this.pingTimer = null;
      /** @type {any} */ this.retryTimer = null;
      /** @type {any} */ this.offlineTimer = null;
      /** @type {any} */ this.watchTimer = null;
      this.lastInbound = 0;    // when the current socket last delivered a message
      this.lastWatch = 0;      // when the watchdog last ran (a big gap means the page was suspended)
      this.deadline = 0;       // the current socket is abandoned if nothing arrives by then

      this.open();
    }

    /** @param {string} status */
    setStatus(status) {
      if (this.status === status) return;
      this.status = status;
      this.onStatus(status);
    }

    open() {
      var self = this;
      if (this.stopped) return;
      this.welcomed = false;
      /** @type {any} */
      var socket;
      try {
        socket = this.createSocket(this.url);
      } catch (e) {
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      this.lastInbound = this.now();
      this.deadline = this.now() + HANDSHAKE_TIMEOUT_MS;
      this.watch();
      socket.onopen = function () {
        if (self.socket !== socket) return;
        self.connectedAt = self.now();
        /** @type {any} */
        var hello = { t: "hello", protocol: PROTOCOL, role: self.role };
        var token = self.getToken();
        if (token) hello.token = token;
        self.sendRaw(hello);
        self.ping();
      };
      socket.onmessage = function (/** @type {any} */ event) {
        if (self.socket !== socket) return;
        var msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        self.heard();
        self.receive(msg);
      };
      socket.onclose = function () {
        if (self.socket !== socket) return;
        self.socket = null;
        self.dropped();
      };
      socket.onerror = function () { /* onclose follows */ };
    }

    /** @param {any} msg */
    receive(msg) {
      if (msg.t === "welcome") {
        this.welcomed = true;
        this.attempt = 0;
        this.deadline = this.now() + SILENCE_MS;
        this.lastSeq = -1;           // a new connection's first state is always current
        this.teamId = msg.teamId;
        this.clock.seed(msg.serverNow);
        this.onWelcome(msg);
      } else if (msg.t === "state") {
        if (msg.seq < this.lastSeq) return;   // older than what is on screen
        this.lastSeq = msg.seq;
        this.view = msg.view;
        if (this.offlineTimer) { this.clearTimer(this.offlineTimer); this.offlineTimer = null; }
        this.setStatus("online");
        this.onState(msg.view, msg);
      } else if (msg.t === "ack") {
        var p = this.pending[msg.id];
        if (!p) return;      // unknown, or already settled by a timeout: ids are never reused
        delete this.pending[msg.id];
        if (p.timer) this.clearTimer(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(msg.error);
      } else if (msg.t === "pong") {
        this.clock.sample(msg.c, msg.s, Date.now());
      } else if (msg.t === "paired") {
        this.onPaired(msg.token);
      } else if (msg.t === "bye") {
        if (STOP_ON_BYE[msg.reason]) this.stopped = true;
        this.onBye(msg.reason);
      }
    }

    ping() {
      var self = this;
      if (this.pingTimer) this.clearTimer(this.pingTimer);
      this.pingTimer = null;
      if (!this.socket) return;
      this.sendRaw({ t: "ping", c: Date.now() });
      var every = this.now() - this.connectedAt < FAST_PING_FOR_MS ? FAST_PING_MS : SLOW_PING_MS;
      this.pingTimer = this.setTimer(function () { self.ping(); }, every);
    }

    /** The current socket delivered a message: it is alive. */
    heard() {
      this.lastInbound = this.now();
      if (this.welcomed) this.deadline = this.lastInbound + SILENCE_MS;
    }

    /** Checks the current socket's deadline every few seconds (LI-001). */
    watch() {
      var self = this;
      if (this.watchTimer) this.clearTimer(this.watchTimer);
      this.lastWatch = this.now();
      this.watchTimer = this.setTimer(function () {
        self.watchTimer = null;
        if (!self.socket || self.stopped) return;
        var now = self.now();
        if (now - self.lastWatch > WATCHDOG_MS * 3 && self.welcomed) {
          // The page was suspended (a phone asleep, a background tab): our own timers did not
          // run, so silence says nothing yet. Ask the server and give it a short while to answer.
          self.deadline = Math.max(self.deadline, now + WAKE_PROBE_MS);
          self.ping();
        } else if (now >= self.deadline) {
          self.abandon();
          return;
        }
        self.watch();
      }, WATCHDOG_MS);
    }

    /** Gives up on the current socket without waiting for the browser to notice, and reconnects. */
    abandon() {
      var socket = this.socket;
      if (!socket) return;
      this.socket = null;     // its late events are ignored from now on
      try { socket.close(); } catch (e) { /* already closed */ }
      this.dropped();
    }

    /**
     * Settles every pending command with an error and clears their timers.
     * @param {{code: string, message: string}} error
     */
    rejectPending(error) {
      var pending = this.pending;
      this.pending = {};
      var ids = Object.keys(pending);
      for (var i = 0; i < ids.length; i++) {
        var p = pending[String(ids[i])];
        if (!p) continue;
        if (p.timer) this.clearTimer(p.timer);
        p.reject(error);
      }
    }

    dropped() {
      var self = this;
      if (this.pingTimer) { this.clearTimer(this.pingTimer); this.pingTimer = null; }
      if (this.watchTimer) { this.clearTimer(this.watchTimer); this.watchTimer = null; }
      this.welcomed = false;
      this.rejectPending({ code: "disconnected", message: "Not connected. Trying again…" });
      if (!this.offlineTimer && this.status !== "offline") {
        this.offlineTimer = this.setTimer(function () {
          self.offlineTimer = null;
          self.setStatus("offline");
        }, this.offlineAfterMs);
      }
      this.scheduleReconnect();
    }

    scheduleReconnect() {
      var self = this;
      if (this.stopped || this.retryTimer) return;
      var delay = backoff(this.attempt, this.random);
      this.attempt++;
      this.retryTimer = this.setTimer(function () {
        self.retryTimer = null;
        self.open();
      }, delay);
    }

    /** @param {any} msg */
    sendRaw(msg) {
      if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(msg));
    }

    /**
     * Sends a command. Resolves with the ack's result, or rejects with { code, message }.
     * Rejects at once with code "disconnected" when there is no connection, with "disconnected"
     * when the connection drops before the ack, and with "timeout" when no ack arrives in time.
     * After "disconnected" (once sent) or "timeout" the command may or may not have been applied:
     * nothing is resent; the next state from the server shows what happened (LI-001).
     * Page code sees this as LockInClient.cmd (src/shared/client-api.ts), typed per command (LI-019).
     * @param {import("../../src/shared/protocol").CommandName} name
     * @param {object} [args]
     * @returns {Promise<any>}
     */
    cmd(name, args) {
      var self = this;
      if (!this.socket || this.socket.readyState !== 1 || !this.welcomed) {
        return Promise.reject({ code: "disconnected", message: "Not connected. Trying again…" });
      }
      var id = this.nextId++;
      return new Promise(function (resolve, reject) {
        var timer = self.setTimer(function () {
          if (!self.pending[id]) return;
          delete self.pending[id];
          reject({ code: "timeout", message: "No reply from Lock-In, so this may or may not have worked. Reconnecting to check…" });
          // No ack in time: the connection is most likely dead. Reconnect and resume from the
          // server's state rather than guessing.
          self.abandon();
        }, self.commandTimeoutMs);
        self.pending[id] = { resolve: resolve, reject: reject, timer: timer };
        self.sendRaw({ t: "cmd", id: id, name: name, args: args || {} });
      });
    }

    /** Closes the connection for good. */
    close() {
      this.stopped = true;
      if (this.retryTimer) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
      if (this.offlineTimer) { this.clearTimer(this.offlineTimer); this.offlineTimer = null; }
      if (this.pingTimer) { this.clearTimer(this.pingTimer); this.pingTimer = null; }
      if (this.watchTimer) { this.clearTimer(this.watchTimer); this.watchTimer = null; }
      var socket = this.socket;
      this.socket = null;
      if (socket) {
        try { socket.close(); } catch (e) { /* already closed */ }
      }
      this.rejectPending({ code: "disconnected", message: "Closed." });
    }

    /** Drops the current socket and reconnects (for tests and a manual "retry" button). */
    reconnect() {
      this.abandon();
    }
  }

  LockIn.PROTOCOL = PROTOCOL;
  LockIn.backoff = backoff;
  LockIn.isFixtureHost = isFixtureHost;
  LockIn.Client = Client;
  /** @type {import("../../src/shared/client-api").LockInGlobal["connect"]} */
  LockIn.connect = function (opts) { return new Client(opts); };
})(typeof window !== "undefined" ? window : globalThis);
