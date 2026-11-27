// @ts-check
// Host console top nav (Last Call): the Lock-In lockup · Quizzes · Venue settings · Run night ·
// History, under a hairline. The current section (from <body data-section>) gets a 2 px venue
// underline. While a night runs, Run night shows a venue dot and the nav shows the room code:
// the Run night page reports that through LockIn.nav.setNight(roomCode | null).
(function () {
  "use strict";
  const SECTIONS = [
    { id: "build", label: "Quizzes", href: "/host/build" },
    { id: "brand", label: "Venue settings", href: "/host/brand" },
    { id: "run", label: "Run night", href: "/host/run" },
    { id: "history", label: "History", href: "/host/history" },
  ];
  const SVG = "http://www.w3.org/2000/svg";

  /**
   * The Lock-In lockup, drawn with DOM calls (the same drawing as public/shared/mark.mjs).
   * @param {boolean} mono
   */
  function lockup(mono) {
    const wrap = document.createElement("span");
    wrap.className = "lockup";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Lock-In");
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", mono ? "mark mono" : "mark");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("aria-hidden", "true");
    /** @param {string} tag @param {Record<string, string>} attrs */
    const add = (tag, attrs) => {
      const el = document.createElementNS(SVG, tag);
      for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k] || "");
      svg.appendChild(el);
    };
    add("circle", { class: "mk-ring", cx: "50", cy: "50", r: "38", "stroke-dasharray": "179 239", "stroke-dashoffset": "-60", transform: "rotate(-90 50 50)" });
    add("circle", { class: "mk-arc", cx: "50", cy: "50", r: "38", "stroke-dasharray": "54 239", transform: "rotate(-90 50 50)" });
    add("circle", { class: "mk-hole", cx: "50", cy: "45", r: "8" });
    add("path", { class: "mk-hole", d: "M45 48 L55 48 L57 66 L43 66 Z" });
    wrap.appendChild(svg);
    const word = document.createElement("span");
    word.className = "lockup-word";
    word.setAttribute("aria-hidden", "true");
    word.textContent = "Lock-In";
    wrap.appendChild(word);
    return wrap;
  }

  const w = /** @type {any} */ (window);
  w.LockIn = w.LockIn || {};
  w.LockIn.lockup = lockup;

  const nav = document.getElementById("host-nav");
  if (!nav) return;
  const current = document.body.dataset.section;

  const home = document.createElement("a");
  home.href = "/host";
  home.className = "host-brand";
  home.appendChild(lockup(false));
  nav.appendChild(home);

  const list = document.createElement("ul");
  /** @type {HTMLElement | null} */
  let runLink = null;
  for (const s of SECTIONS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.href;
    a.textContent = s.label;
    if (s.id === current) a.setAttribute("aria-current", "page");
    if (s.id === "run") runLink = a;
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);

  const room = document.createElement("span");
  room.className = "nav-room";
  room.hidden = true;
  nav.appendChild(room);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "host-signout";
  out.textContent = "Sign out";
  out.addEventListener("click", async () => {
    if (isDirty()) { askToLeave(() => out.click()); return; }
    out.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      location.href = "/host/login";
    }
  });
  nav.appendChild(out);

  /** @param {string | null} code the open night's room code, or null */
  function setNight(code) {
    room.hidden = !code;
    room.textContent = "";
    if (code) {
      room.appendChild(document.createTextNode("Room"));
      const b = document.createElement("b");
      b.textContent = code;
      room.appendChild(b);
    }
    if (runLink) {
      const dot = runLink.querySelector(".live-dot");
      if (code && !dot) {
        const d = document.createElement("span");
        d.className = "live-dot";
        d.setAttribute("aria-label", "A night is running");
        runLink.appendChild(d);
      } else if (!code && dot) dot.remove();
    }
  }
  // ---- Unsaved changes (UI-16) --------------------------------------------------------------
  // A page with unsaved work registers a check. Leaving it through a link or Sign out asks in the
  // design system's dialog. Reloading or closing the tab can only use the browser's own prompt
  // (browsers allow nothing else there), which the pages keep through beforeunload.
  /** @type {(() => boolean)[]} */
  const dirtyChecks = [];
  let leaving = false;
  const isDirty = () => !leaving && dirtyChecks.some((f) => { try { return f(); } catch { return false; } });

  /**
   * Asks in the design system's dialog (UI-41): never the browser's own confirm(). Resolves true
   * when the person picks `ok`, false on `cancel` or Escape. The safe choice has the focus.
   * @param {{ title: string, text: string, ok: string, cancel: string, danger?: boolean, className?: string }} o
   * @returns {Promise<boolean>}
   */
  function ask(o) {
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      dlg.className = "dlg" + (o.className ? " " + o.className : "");
      const id = "dlg-title-" + Math.random().toString(36).slice(2, 8);
      dlg.setAttribute("aria-labelledby", id);
      const h = document.createElement("h2");
      h.id = id;
      h.textContent = o.title;
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = o.text;
      const row = document.createElement("div");
      row.className = "row end";
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = o.danger ? "btn danger" : "btn primary";
      yes.textContent = o.ok;
      const no = document.createElement("button");
      no.type = "button";
      no.className = o.danger ? "btn primary" : "btn ghost";
      no.textContent = o.cancel;
      if (o.danger) { row.appendChild(yes); row.appendChild(no); } else { row.appendChild(no); row.appendChild(yes); }
      dlg.appendChild(h);
      dlg.appendChild(p);
      dlg.appendChild(row);
      document.body.appendChild(dlg);
      /** @param {boolean} v */
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      no.addEventListener("click", () => done(false));
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
      yes.addEventListener("click", () => done(true));
      dlg.showModal();
      (o.danger ? no : yes).focus();
    });
  }

  /** @param {() => void} go what leaving does */
  function askToLeave(go) {
    ask({
      title: "Leave without saving?",
      text: "You have changes on this page that are not saved yet. If you leave now, they are lost.",
      ok: "Leave without saving", cancel: "Stay on this page", danger: true, className: "leave-dlg",
    }).then((yes) => { if (yes) { leaving = true; go(); } });
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest("a[href]") : null);
    if (!a || !(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;   // a tab on this page
    if (!isDirty()) return;
    e.preventDefault();
    askToLeave(() => { location.href = url.href; });
  }, true);

  /**
   * Register a page's unsaved-work check. Also returns whether the browser's own prompt should
   * show on reload or close (false once the person chose "Leave without saving").
   * @param {() => boolean} check
   */
  function guardUnsaved(check) {
    dirtyChecks.push(check);
    window.addEventListener("beforeunload", (e) => {
      if (leaving || !check()) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  w.LockIn.nav = { setNight, guardUnsaved, ask };

  // "Powered by Lock-In", linked to the source (AGPL-3.0 section 13; the address is in shared/source.js).
  const source = w.LockIn.SOURCE_URL;
  if (source) {
    const credit = document.createElement("footer");
    credit.className = "host-credit";
    credit.appendChild(document.createTextNode("Powered by"));
    const link = document.createElement("a");
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Lock-In, free software under the AGPL-3.0");
    link.appendChild(lockup(true));
    credit.appendChild(link);
    credit.appendChild(document.createTextNode("· free software under the AGPL-3.0"));
    const version = document.createElement("span");
    version.className = "app-version";
    credit.appendChild(version);
    document.body.appendChild(credit);
    if (w.LockIn.version) w.LockIn.version((/** @type {string} */ v) => { version.textContent = "· v" + v; });
  }
})();
