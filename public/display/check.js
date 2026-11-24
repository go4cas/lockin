// Display browser check (B6, T-01, TECH-SPEC 1.2). Plain ES5 classic script, no eval,
// so it runs on any TV browser and passes the page CSP. If the browser is older
// than the display baseline (Chromium 86 / Safari 14) it shows a plain-English
// page instead of a blank screen, and tells display.mjs not to start.
(function (root) {
  "use strict";

  // True when this browser can run the display: ES modules and
  // Element.prototype.replaceChildren (Chromium 86, Safari 14), which Arrow needs.
  function supported(win) {
    var doc = win.document;
    var hasModules = !!(win.HTMLScriptElement && "noModule" in win.HTMLScriptElement.prototype);
    var hasReplace = !!(win.Element && typeof win.Element.prototype.replaceChildren === "function");
    return hasModules && hasReplace && !!doc;
  }

  function text(doc, tag, cls, value) {
    var el = doc.createElement(tag);
    el.className = cls;
    el.appendChild(doc.createTextNode(value));
    return el;
  }

  // Builds the message with DOM methods only (no HTML parsing of any kind).
  function showTooOld(win) {
    var doc = win.document;
    var box = doc.createElement("div");
    box.className = "too-old";
    box.setAttribute("role", "alert");
    box.appendChild(text(doc, "h1", "too-old-title", "This TV's browser is too old for Lock-In"));
    box.appendChild(text(doc, "p", "too-old-text", "Show the quiz from a laptop plugged in with HDMI, or cast a Chrome tab to a Chromecast or Google TV, and open this address there:"));
    box.appendChild(text(doc, "p", "too-old-url", win.location.host + "/display"));
    box.appendChild(text(doc, "p", "too-old-small", "Lock-In needs a TV browser from about 2022 or newer (Chrome 86 or Safari 14 class)."));
    var host = doc.getElementById("display") || doc.body;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(box);
  }

  root.LockInDisplayCheck = { supported: supported, showTooOld: showTooOld };

  if (root.document && !supported(root)) {
    root.LockInDisplayUnsupported = true;
    if (root.document.body) showTooOld(root);
    else root.document.addEventListener("DOMContentLoaded", function () { showTooOld(root); });
  }
})(typeof window !== "undefined" ? window : this);
