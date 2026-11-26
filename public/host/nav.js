// @ts-check
// Host console top nav (Last Call): the lock in lockup · Library · Branding · Run night ·
// History, under a hairline. The current section (from <body data-section>) gets a 2 px venue
// underline. While a night runs, Run night shows a venue dot and the nav shows the room code:
// the Run night page reports that through LockIn.nav.setNight(roomCode | null).
(function () {
  "use strict";
  const SECTIONS = [
    { id: "build", label: "Library", href: "/host/build" },
    { id: "brand", label: "Branding", href: "/host/brand" },
    { id: "run", label: "Run night", href: "/host/run" },
    { id: "history", label: "History", href: "/host/history" },
  ];
  const SVG = "http://www.w3.org/2000/svg";

  /**
   * The lock in lockup, drawn with DOM calls (the same drawing as public/shared/mark.mjs).
   * @param {boolean} mono
   */
  function lockup(mono) {
    const wrap = document.createElement("span");
    wrap.className = "lockup";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "lock in");
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
    word.textContent = "lock in";
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
  w.LockIn.nav = { setNight };

  // "Powered by Lock In", linked to the source (AGPL-3.0 section 13; the address is in shared/source.js).
  const source = w.LockIn.SOURCE_URL;
  if (source) {
    const credit = document.createElement("footer");
    credit.className = "host-credit";
    credit.appendChild(document.createTextNode("Powered by"));
    const link = document.createElement("a");
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Lock In, free software under the AGPL-3.0");
    link.appendChild(lockup(true));
    credit.appendChild(link);
    credit.appendChild(document.createTextNode("· free software under the AGPL-3.0"));
    document.body.appendChild(credit);
  }
})();
