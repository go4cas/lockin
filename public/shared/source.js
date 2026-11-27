// @ts-check
// Where Lock-In's source code is (AGPL-3.0, section 13). The phone and the host console link
// the "Powered by Lock-In" credit here. If you run a changed copy of Lock-In for other people,
// change this one line to point at your copy's source, so they can get it.
// Classic script, loaded with a plain <script> tag; follows the display baseline (TECH-SPEC 3.3).
(/** @param {any} root */ function (root) {
  "use strict";
  var LockIn = root.LockIn || (root.LockIn = {});
  LockIn.SOURCE_URL = "https://github.com/go4cas/lockin";

  // The running server's version (from /api/ping), shown small beside the credit on the host
  // console, the display and the phone. Asked once per page; on a failure the next call asks again.
  /** @type {Promise<string | null> | null} */
  var asked = null;
  LockIn.version = function (/** @type {(v: string) => void} */ done) {
    if (!asked) {
      if (typeof fetch !== "function") return;
      asked = fetch("/api/ping", { cache: "no-store" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) { return body && typeof body.version === "string" ? body.version : null; })
        .then(null, function () { return null; });
      asked.then(function (/** @type {string | null} */ v) { if (!v) asked = null; });
    }
    asked.then(function (/** @type {string | null} */ v) { if (v) done(v); });
  };
})(typeof window !== "undefined" ? window : globalThis);
