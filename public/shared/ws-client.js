// @ts-check
// Reconnecting WebSocket client for every screen (TECH-SPEC 10.2, 10.5, 10.6, 11).
// Classic script, loaded with a plain <script> tag before a page's Arrow module (TECH-SPEC 3.4).
// Follows the display baseline (TECH-SPEC 3.3).
// Load clock.js first.
//
//   var client = LockIn.connect({
//     role: "display",                              // "display" | "team" | "host"
//     getToken: function () { return null; },       // team device token, read on every connect
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

  /** The /ws address for this page. Passes ?fixture= through for scripts/fixture-server.ts. */
  function defaultUrl() {
    var loc = root.location;
    var url = (loc.protocol === "https:" ? "wss://" : "ws://") + loc.host + "/ws";
    var m = /[?&]fixture=([^&#]*)/.exec(loc.search || "");
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
      this.createSocket = opts.createSocket || function (/** @type {string} */ url) { return new WebSocket(url); };
      this.offlineAfterMs = typeof opts.offlineAfterMs === "number" ? opts.offlineAfterMs : OFFLINE_AFTER_MS;
      this.random = opts.random || Math.random;
      this.clock = opts.clock || LockIn.createClock();

      /** @type {any} */
      this.socket = null;
      this.status = "connecting";
      this.attempt = 0;
      this.nextId = 1;
      /** @type {Object<string, {resolve: function(any): void, reject: function(any): void}>} */
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
      socket.onopen = function () {
        if (self.socket !== socket) return;
        self.connectedAt = Date.now();
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
        this.lastSeq = -1;           // a new connection's first state is always current
        this.teamId = msg.teamId;
        this.clock.seed(msg.serverNow);
        this.onWelcome(msg);
      } else if (msg.t === "state") {
        if (msg.seq < this.lastSeq) return;   // older than what is on screen
        this.lastSeq = msg.seq;
        this.view = msg.view;
        if (this.offlineTimer) { clearTimeout(this.offlineTimer); this.offlineTimer = null; }
        this.setStatus("online");
        this.onState(msg.view, msg);
      } else if (msg.t === "ack") {
        var p = this.pending[msg.id];
        if (!p) return;
        delete this.pending[msg.id];
        if (msg.ok) p.resolve(msg.result);
        else p.reject(msg.error);
      } else if (msg.t === "pong") {
        this.clock.sample(msg.c, msg.s, Date.now());
      } else if (msg.t === "bye") {
        if (STOP_ON_BYE[msg.reason]) this.stopped = true;
        this.onBye(msg.reason);
      }
    }

    ping() {
      var self = this;
      if (this.pingTimer) clearTimeout(this.pingTimer);
      if (!this.socket) return;
      this.sendRaw({ t: "ping", c: Date.now() });
      var every = Date.now() - this.connectedAt < FAST_PING_FOR_MS ? FAST_PING_MS : SLOW_PING_MS;
      this.pingTimer = setTimeout(function () { self.ping(); }, every);
    }

    dropped() {
      var self = this;
      if (this.pingTimer) { clearTimeout(this.pingTimer); this.pingTimer = null; }
      var ids = Object.keys(this.pending);
      for (var i = 0; i < ids.length; i++) {
        var p = this.pending[String(ids[i])];
        if (p) p.reject({ code: "disconnected", message: "Not connected. Trying again…" });
      }
      this.pending = {};
      if (!this.offlineTimer && this.status !== "offline") {
        this.offlineTimer = setTimeout(function () {
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
      this.retryTimer = setTimeout(function () {
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
     * Rejects at once with code "disconnected" when there is no connection.
     * @param {string} name
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
        self.pending[id] = { resolve: resolve, reject: reject };
        self.sendRaw({ t: "cmd", id: id, name: name, args: args || {} });
      });
    }

    /** Closes the connection for good. */
    close() {
      this.stopped = true;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      if (this.offlineTimer) { clearTimeout(this.offlineTimer); this.offlineTimer = null; }
      if (this.pingTimer) { clearTimeout(this.pingTimer); this.pingTimer = null; }
      var socket = this.socket;
      this.socket = null;
      if (socket) {
        try { socket.close(); } catch (e) { /* already closed */ }
      }
      var ids = Object.keys(this.pending);
      for (var i = 0; i < ids.length; i++) {
        var p = this.pending[String(ids[i])];
        if (p) p.reject({ code: "disconnected", message: "Closed." });
      }
      this.pending = {};
    }

    /** Drops the current socket and reconnects (for tests and a manual "retry" button). */
    reconnect() {
      if (this.socket) {
        try { this.socket.close(); } catch (e) { /* ignore */ }
      }
    }
  }

  LockIn.PROTOCOL = PROTOCOL;
  LockIn.backoff = backoff;
  LockIn.Client = Client;
  /** @param {any} opts */
  LockIn.connect = function (opts) { return new Client(opts); };
})(typeof window !== "undefined" ? window : globalThis);
