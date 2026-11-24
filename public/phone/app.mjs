// @ts-check
// Team phone and web app (B7): join, play, rejoin (P-01 to P-10).
// Loaded as a module after the shared classic scripts (clock.js, ws-client.js,
// view.js), which provide window.LockIn (TECH-SPEC 3.4).

import { mount } from "./screens.mjs";
import { start } from "./state.mjs";

const app = document.getElementById("app");
if (app) {
  while (app.firstChild) app.removeChild(app.firstChild);
  mount(app);
}
start();

// The service worker caches the app shell only, so the page opens from the home
// screen even on a bad connection. It never answers for the server (P-10, 9.1).
if ("serviceWorker" in navigator && window.isSecureContext && !/[?&]fixture=/.test(location.search)) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* optional: the page works without it */ });
}
