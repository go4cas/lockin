// Lock-In service worker (B7, P-10). Served at /sw.js.
// It caches the phone's app shell so the installed app opens full screen even
// on a bad connection, and then shows "Offline, reconnecting" by itself.
// It never answers for the server: answers, views, the theme's live CSS, media,
// the API and the WebSocket always go to the network, and it ignores every page
// that is not the phone (/display, /host). Answers are never queued (P-20 is Later).
"use strict";

var VERSION = "lockin-phone-v1";
var SHELL = [
  "/",
  "/static/phone/phone.css",
  "/static/phone/app.mjs",
  "/static/phone/state.mjs",
  "/static/phone/screens.mjs",
  "/static/phone/logic.mjs",
  "/static/phone/icons/icon-192.png",
  "/static/phone/icons/apple-touch-icon.png",
  "/static/shared/tokens.css",
  "/static/shared/base.css",
  "/static/shared/clock.js",
  "/static/shared/ws-client.js",
  "/static/shared/view.js",
  "/static/shared/source.js",
  "/static/shared/parts.mjs",
  "/static/logo/lockin-mark.svg",
  "/static/fonts/atkinson-hyperlegible-400.woff2",
  "/static/fonts/atkinson-hyperlegible-700.woff2",
  "/static/fonts/caveat-brush.woff2",
  "/vendor/arrow/index.mjs",
  "/vendor/arrow/chunks/internal-DchK7S7v.mjs",
];

/** Phone pages: "/", "/j/<room>", "/m/<code>". */
function isPhonePage(path) {
  return path === "/" || /^\/[jm]\/[^/]+\/?$/.test(path);
}

function isShellFile(path) {
  return SHELL.indexOf(path) !== -1 || path === "/theme.css" || path === "/manifest.webmanifest";
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // One missing file must not stop the install, so each is added on its own.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: "no-cache" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf("lockin-phone-") === 0 && k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network first, so a new release or a new theme shows at once; the cached copy
// is used only when the network fails.
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  var page = req.mode === "navigate" && isPhonePage(path);
  if (!page && !isShellFile(path)) return;   // not ours: the browser handles it as if there were no worker
  var key = page ? "/" : path;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(VERSION).then(function (cache) { cache.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(key).then(function (hit) {
        return hit || new Response("Offline. Reconnect to the internet and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      });
    })
  );
});
