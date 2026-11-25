// @ts-check
// The display (B6, T-01 to T-12). Renders the DisplayView the server sends; it
// never takes input (T-01) and never computes scores, marks or the lock
// (TECH-SPEC 3.4). Built with the vendored ArrowJS core and the shared classic
// scripts (ws-client.js, clock.js, view.js), which the page loads first.
// Follows the display baseline (TECH-SPEC 3.3).

import { html, reactive, nextTick } from "/vendor/arrow/index.mjs";
import {
  FLASH_MS, PAGE_FLIP_MS, PANEL_MS,
  boardLayout, byId, choiceIndex, clockTime, countdownText, endStage, footerLine, movement, holdingPanels, letter,
  lockShouldSnap, ordinal, pageBrand, questionSize, revealProgress, screenFor, themeReloadDue, timerNow, wonTieBreak,
} from "./logic.mjs";
import { recovery } from "/static/shared/parts.mjs";

/** @typedef {import("../../src/shared/protocol").DisplayView} DisplayView */
/** @typedef {import("../../src/shared/protocol").TeamChip} TeamChip */
/** @typedef {import("../../src/shared/protocol").QuestionPublic} QuestionPublic */
/** @typedef {import("../../src/shared/protocol").Standings} Standings */
/** @typedef {Standings["rows"][number]} Row */

/** @type {any} */
const W = window;
const LockIn = W.LockIn;
/** The venue logo and tagline, filled into the page by GET /display. */
const BRAND = pageBrand(document);
/** Where the display keeps its pairing token (REVIEW finding 4). */
const PAIR_KEY = "lockin.display";
/** The token in memory too, for a browser that refuses localStorage (paired for this visit only). */
let pairTokenMem = "";
/** @returns {string} */
function pairToken() {
  try { return W.localStorage.getItem(PAIR_KEY) || pairTokenMem; } catch (e) { return pairTokenMem; }
}

// check.js has already shown the "browser too old" page; draw nothing.
if (!W.LockInDisplayUnsupported) start();

/**
 * Connects and mounts the display. If a render ever throws, the whole Arrow
 * tree is thrown away and mounted again from the last view, with a fresh store,
 * so the TV never stays stuck (T-11: no reload by hand). Arrow 1.0.6 can throw
 * "expressionPool[effect] is not a function" from a slot left over from an
 * earlier screen, and then stops updating the slots queued after it (NOTES).
 */
function start() {
  const root = /** @type {HTMLElement} */ (document.getElementById("display"));
  /** @type {import("../../src/shared/client-api").LockInClient | null} */ let client = null;
  /** @type {DisplayView | null} */ let lastView = null;
  let status = "connecting";
  let connections = 0;
  /** @type {string | null} */ let themeSeen = null;
  const now = function () { return client ? client.clock.now() : Date.now(); };

  /** @type {ReturnType<typeof createDisplay>} */
  let display = createDisplay(root, now);

  // Remount only for errors from rendering code (Arrow and the display's own modules), at
  // most 3 times a minute, so an error that comes straight back can't loop (code review
  // LI-017). The old tree is disposed first: its timers and QR fetch stop touching the page.
  const recover = recovery({ limit: 3, windowMs: 60_000, sources: ["/vendor/arrow/", "/static/display/", "/static/shared/parts.mjs"] });
  let remounting = false;
  window.addEventListener("error", function (e) {
    if (remounting || !recover.isRenderError(e, window.location.origin)) return;
    if (!recover.allow()) {
      W.LockInDisplayRecovery = recover.stats();
      return;
    }
    remounting = true;
    W.LockInDisplayRecovery = recover.stats();
    setTimeout(function () {
      remounting = false;
      display.dispose();
      while (root.firstChild) root.removeChild(root.firstChild);
      display = createDisplay(root, now);
      display.setStatus(status);
      display.welcome(true);   // resume: no replayed reveal or padlock snap
      if (lastView) display.receive(lastView, false);
    }, 50);
  });

  client = LockIn.connect({
    role: "display",
    getToken: function () { return pairToken() || null; },
    onPaired: function (/** @type {string} */ token) {
      pairTokenMem = token;
      try { W.localStorage.setItem(PAIR_KEY, token); } catch (e) { /* private mode: paired for this visit only */ }
    },
    onWelcome: function () { connections++; display.welcome(connections > 1); },
    onState: function (/** @type {DisplayView} */ view) {
      // A new theme: reload so the new logo, tagline and fonts show (a few seconds' blank at most).
      if (themeSeen === null) themeSeen = view.venue ? view.venue.themeVersion : null;
      else if (themeReloadDue(themeSeen, view, lastView)) { themeSeen = null; window.location.reload(); return; }
      lastView = view;
      display.receive(view, true);
    },
    onStatus: function (/** @type {string} */ s) { status = s; display.setStatus(s); },
  });

  setInterval(function () { display.tick(); }, 250);
}

/**
 * One mounted display: its store, its screens and its Arrow tree.
 * @param {HTMLElement} root
 * @param {() => number} now server time
 */
function createDisplay(root, now) {
  /**
   * The one view store (TECH-SPEC 3.4) plus the display's own short-lived state.
   * `now` is server time, ticked a few times a second for timers and countdowns.
   * Moment start times (`*At`) are server times, so progress is worked out from `now`.
   */
  const page = reactive({
    /** @type {DisplayView | null} */ view: null,
    status: "connecting",
    screen: "connecting",
    now: now(),
    lbAt: 0,          // leaderboard reveal began
    lbDone: false,    // shown complete (seen again, or after a reconnect)
    snap: false,      // the padlock moment should animate
    // Derived from the clock in update(), so slots that build whole screens or
    // lists never read the fast-changing `now` themselves (Arrow: keep fast
    // state in leaf slots only).
    panel: "",        // holding-page panel on show
    lbPage: 0,        // leaderboard page on show (index into boardLayout().pages)
    lbShown: 0,       // rows of that page revealed so far
    flip: 0,          // page counter for halftime and final standings
    endStage: "winner",
    qr: "",           // the join QR as a data: URL (SA-11: fetched with the token in a header, never in a URL)
    chipsMore: 0,     // lobby team chips that did not fit (UI-05)
  });

  let lbKey = "";
  let lockKey = "";
  const LAST_ROW_MS = 1500;
  let freshConnection = false;   // true for the first state after a reconnect

  /** @returns {DisplayView} */
  const v = () => /** @type {DisplayView} */ (page.view);
  /** @returns {import("../../src/shared/protocol").NightInfo | null} */
  const nt = () => (page.view ? v().night : null);
  /** @template T @param {(n: import("../../src/shared/protocol").NightInfo) => T} f @param {T} dflt @returns {T} */
  const withNight = (f, dflt) => { const n = nt(); return n ? f(n) : dflt; };

  /** Sets the screen and its moment state from a new view or a clock tick. */
  function update() {
    const view = /** @type {DisplayView | null} */ (page.view);
    const t = now();
    const screen = screenFor(view, t);
    if (view && view.standings && screen === "leaderboard") {
      const key = view.night ? view.night.id + ":" + view.standings.round : String(view.standings.round);
      if (key !== lbKey) {
        lbKey = key;
        page.lbAt = t;
        page.lbDone = freshConnection;   // after a reconnect, jump to the full table without replaying (moments.md 14)
      }
    }
    if (view && view.standings && screen === "leaderboard" && !page.lbDone) {
      // Once the last row has had time to arrive, the reveal is over: later
      // changes (a dispute) re-order rows without replaying it.
      if (revealProgress(view.standings.rows.length, t - page.lbAt - LAST_ROW_MS).done) page.lbDone = true;
    }
    if (view && view.lockedMoment && (screen === "locked" || screen === "dl-locked")) {
      const key = String(view.lockedMoment.at);
      if (key !== lockKey) { lockKey = key; page.snap = lockShouldSnap(view.lockedMoment, t); }
    }
    if (view && screen === "holding" && view.night) {
      const list = holdingPanels(view.night, view.teams.length);
      const panel = list.length ? list[Math.floor(t / PANEL_MS) % list.length] || "" : "";
      if (page.panel !== panel) page.panel = panel;
    }
    if (view && view.standings && screen === "leaderboard") {
      const n = view.standings.rows.length;
      const pages = boardLayout(n).pages;
      const pr = page.lbDone ? { page: pages.length - 1, shown: 999 } : revealProgress(n, t - page.lbAt);
      if (page.lbPage !== pr.page) page.lbPage = pr.page;
      if (page.lbShown !== pr.shown) page.lbShown = pr.shown;
    }
    const flip = Math.floor(t / PAGE_FLIP_MS);
    if (page.flip !== flip) page.flip = flip;
    const stage = endStage(view && screen === "ended" ? view.final : null, t);
    if (page.endStage !== stage) page.endStage = stage;
    if (page.screen !== screen) page.screen = screen;
  }

  // ---------------------------------------------------------------- moves
  // Leaderboard rows are keyed by team id, so a re-order (a dispute changed a
  // score) moves the same nodes. Snapshot their places, render, then slide each
  // from its old place to its new one (FLIP), using transforms only.

  /** @returns {Object<string, number>} */
  function rowTops() {
    /** @type {Object<string, number>} */
    const out = {};
    const rows = root.querySelectorAll(".lb-row[data-key]");
    for (let i = 0; i < rows.length; i++) {
      const el = /** @type {HTMLElement} */ (rows[i]);
      out[el.getAttribute("data-key") || ""] = el.getBoundingClientRect().top;
    }
    return out;
  }

  /** @param {Object<string, number>} before */
  function slideRows(before) {
    const rows = root.querySelectorAll(".lb-row[data-key]");
    for (let i = 0; i < rows.length; i++) {
      const el = /** @type {HTMLElement} */ (rows[i]);
      const old = before[el.getAttribute("data-key") || ""];
      if (old === undefined) continue;
      const dy = old - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = "none";
      el.style.transform = "translateY(" + dy + "px)";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.style.transition = "transform var(--motion-slow) var(--ease-out)";
          el.style.transform = "";
        });
      });
    }
  }

  // ---------------------------------------------------------------- views in

  let shownKey = "";
  /** @type {any} */ let pending = null;
  /** What a screen's content belongs to; a change means "redraw from scratch". @param {DisplayView} view */
  function contentKey(view) {
    return (view.night ? view.night.id : "") + "|" + view.phase + "|" + (view.standings ? view.standings.round + ":" + view.standings.rows.length : "");
  }

  /** @param {DisplayView} view */
  function show(view) {
    const before = rowTops();
    page.view = view;
    update();
    freshConnection = false;
    nextTick(function () { slideRows(before); });
  }

  /**
   * A new view from the server. `animate` is false when remounting after an error.
   * @param {DisplayView} view @param {boolean} animate
   */
  function receive(view, animate) {
    loadQr(view);
    if (pending) { clearTimeout(pending); pending = null; }
    const key = contentKey(view);
    if (animate && page.view && key !== shownKey) {
      // A new phase or new standings: unmount the old screen first and draw the
      // new one a moment later, so one change never both updates and removes
      // the same slots (Arrow 1.0.6, see NOTES).
      shownKey = key;
      page.screen = "blank";
      // A timer, not nextTick: Arrow drains its unmount stack in a later microtask.
      pending = setTimeout(function () { pending = null; show(view); }, 30);
      return;
    }
    shownKey = key;
    show(view);
  }

  let qrKey = "";
  /**
   * Fetches the join QR when the join address changes (SA-11). The pairing token goes in an
   * Authorization header, not the URL, so it stays out of access logs and history; a display
   * paired by the console's session (D5) has no token and is let in by the session cookie.
   * @param {DisplayView} view
   */
  function loadQr(view) {
    const n = view && !view.pairing ? view.night : null;
    const key = n && n.joinUrl ? n.joinUrl : "";
    if (key === qrKey) return;
    qrKey = key;
    if (!key) { page.qr = ""; return; }
    const token = pairToken();
    /** @type {Record<string, string>} */ const headers = token ? { Authorization: "Bearer " + token } : {};
    fetch("/qr/join.svg", { headers: headers, cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("QR " + r.status)); })
      .then(function (svg) { if (qrKey === key) page.qr = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); })
      .catch(function () { if (qrKey === key) qrKey = ""; });   // tried again with the next view
  }

  // ---------------------------------------------------------------- pieces

  /** Stand-ins used for one last redraw of a screen whose data just left the view. */
  /** @type {QuestionPublic} */
  const EMPTY_Q = { id: "", roundIndex: 0, number: 0, text: "", image: null, input: { type: "text" }, status: "locked", timer: { state: "done", durationMs: 1, locksAt: null, remainingMs: null }, answered: 0, of: 0 };
  /** @type {NonNullable<DisplayView["suddenDeath"]>} */
  const EMPTY_SD = { position: 1, teams: [], out: [], questionNumber: 0, maxQuestions: 0, question: null, status: "waiting", rightIds: null, outcome: null };

  /** A fresh tick each time: one template instance must not be mounted in two places. */
  const tick = () => html`<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /** The Lock-In padlock. Inline (not <use>) so CSS can move the shackle on its own. @param {string} cls */
  function padlock(cls) {
    return html`<svg class="${cls}" viewBox="0 0 100 120" aria-hidden="true"><path class="shackle" d="M28 58 V36 A22 22 0 0 1 72 36 V58"/><rect class="body" x="10" y="54" width="80" height="62" rx="13"/><path class="qmark" d="M40 75 A10 10 0 1 1 55.5 83.3 C51.5 86 50 88 50 92"/><circle class="hole" cx="50" cy="104" r="4.6"/></svg>`;
  }

  /** The venue logo (the Lock-In mark when the venue has none) and venue name. */
  function head() {
    return html`<div class="display-head">
      <div class="display-logo">${BRAND.logo ? html`<img class="venue-logo" src="${BRAND.logo}" alt="">` : padlock("mark")}<span>${() => (page.view ? v().venue.name : "")}</span></div>
      <div class="display-strip"><span class="strip-in">${() => sp().a}<b>${() => sp().b}</b>${() => sp().c}<b>${() => sp().d}</b>${() => sp().e}<span class="display-pips">${() => stripPips()}</span></span></div>
    </div>`;
  }

  /** @param {TeamChip} c @param {boolean} [joker] */
  function chip(c, joker) {
    return html`<div class="chip"><i style="${"background:" + LockIn.view.teamColour(c.colour)}"></i><span class="chip-name">${c.name}</span><span class="${joker ? "joker" : "off"}">${joker ? "JOKER" : ""}</span></div>`.key(c.id);
  }

  /** Question pips in the header: done, now, to come. @param {number} current 1-based */
  function pips(/** @type {number} */ count, current) {
    const out = [];
    for (let i = 1; i <= count; i++) out.push(html`<i class="${i < current ? "done" : i === current ? "now" : ""}"></i>`.key(i));
    return out;
  }

  /** The join block: QR (B8's /qr/join.svg), address and room code. @param {boolean} small */
  function joinBlock(small) {
    return html`<div class="${small ? "join panel join-side" : "join join-main"}">
      ${small ? html`<div class="t-xs b join-title">Join now</div>` : ""}
      <div class="qr"><img src="${() => page.qr}" alt="" hidden="${() => !page.qr}"></div>
      <div class="join-url">${small ? "" : "Scan, or go to "}<b>${() => hostOf(withNight((n) => n.joinUrl, ""))}</b></div>
      ${small ? "" : html`<div class="code-label">Room code</div>`}
      <div class="code">${() => withNight((n) => n.roomCode, "")}</div>
    </div>`;
  }

  /** "quiz.example.com" from the join URL. @param {string} url */
  function hostOf(url) {
    const m = /^https?:\/\/([^/]+)/.exec(url);
    return m ? m[1] : url;
  }

  /** Prizes as "1st R300 bar tab" items. */
  function prizeItems(/** @type {boolean} */ inline) {
    const prizes = withNight((n) => n.prizes, /** @type {import("../../src/shared/formats").Prize[]} */ ([]));
    return prizes.map(function (p) {
      return inline
        ? html`<span class="prize-inline"><b>${ordinal(p.place)}</b> ${p.text}</span>`.key(p.place)
        : html`<div class="prize"><b>${ordinal(p.place)}</b><span>${p.text}</span></div>`.key(p.place);
    });
  }

  // ---------------------------------------------------------------- screens

  function idleScreen() {
    return html`<div class="display-main col center">
      ${BRAND.logo ? html`<img class="idle-logo" src="${BRAND.logo}" alt="">` : padlock("lock idle-mark")}
      <div class="t-xl b mt3 venue-name">${() => (page.view ? v().venue.name : "")}</div>
      <div class="display t-l mt2 status-colour">${BRAND.tagline}</div>
    </div>`;
  }

  /** The pairing code, or "" when the server has none to give (SA-03: too many displays waiting). */
  const pairCode = () => (page.view && v().pairing ? (v().pairing || { code: "" }).code : "");

  /** Not paired yet (REVIEW finding 4): only the pairing code, which the host types on the console. */
  function pairingScreen() {
    return html`<div class="display-main col center">
      ${BRAND.logo ? html`<img class="idle-logo" src="${BRAND.logo}" alt="">` : padlock("lock idle-mark")}
      <div class="t-l b mt3 venue-name">${() => (page.view ? v().venue.name : "")}</div>
      <div class="t-s muted mt3">${() => (pairCode() ? 'Quizmaster: to show the quiz here, type this code on the console under "Pair a display".' : "Too many screens are waiting to be paired. Reload this page in a minute.")}</div>
      <div class="pair-code mt2">${() => pairCode()}</div>
    </div>`;
  }

  function connectingScreen() {
    return html`<div class="display-main col center">
      ${padlock("lock idle-mark")}
      <div class="t-s muted mt3">Connecting to the quiz…</div>
    </div>`;
  }

  function lobbyScreen() {
    return html`<div class="display-main row">
      ${joinBlock(false)}
      <div class="grow col">
        <div class="display t-l">${() => v().lines.lobby || "Scan the code to join."}</div>
        <div class="t-xs muted mt3">${() => teamCountText(v().teams.length)}</div>
        <div class="${() => "chips lobby-chips mt2" + (v().teams.length <= 4 ? " big" : v().teams.length > 20 ? " many lots" : v().teams.length > 12 ? " many" : "")}">${() => { fitChipsSoon(); return v().teams.map(function (c) { return chip(c); }); }}</div>
        <div class="t-xs muted chips-more" hidden="${() => page.chipsMore === 0}">${() => "+" + page.chipsMore + " more"}</div>
        <div class="grow"></div>
        ${() => (withNight((n) => n.prizes.length > 0, false)
          ? html`<div class="panel row prize-strip"><div class="t-xs muted mr4 nowrap">Tonight's prizes</div><div class="t-xs prize-list">${() => prizeItems(true)}</div></div>`
          : "")}
      </div>
    </div>`;
  }

  /**
   * UI-05: the chips that do not fit the lobby box are hidden and counted ("+3 more"), so the
   * screen never cuts a team in half or drops teams without saying so. Measured after layout.
   */
  let fitQueued = false;
  function fitChipsSoon() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () { requestAnimationFrame(function () { fitQueued = false; fitChips(); }); });
  }
  function fitChips() {
    const box = /** @type {HTMLElement | null} */ (root.querySelector(".lobby-chips"));
    if (!box) { page.chipsMore = 0; return; }
    const chips = /** @type {HTMLElement[]} */ (Array.prototype.slice.call(box.children));
    chips.forEach(function (c) { c.classList.remove("cut"); });
    const bottom = box.getBoundingClientRect().bottom;
    let cut = 0;
    chips.forEach(function (c) { if (c.getBoundingClientRect().bottom > bottom + 1) { c.classList.add("cut"); cut++; } });
    page.chipsMore = cut;
  }

  /** @param {number} n */
  function teamCountText(n) {
    if (n === 0) return "No teams yet. Be the first.";
    return n === 1 ? "1 team in" : n + " teams in";
  }

  function holdingScreen() {
    /** The panel on show: they take turns every PANEL_MS, from the server clock so every display agrees. */
    const panels = () => holdingPanels(/** @type {any} */ (v().night), v().teams.length);
    const current = () => page.panel;
    return html`<div class="display-main row">
      <div class="grow col holding-panel">
        <div class="grow col panel-body">${() => holdingPanel(current())}</div>
        <div class="slots">${() => {
          const list = panels();
          const cur = current();
          return list.length > 1 ? list.map(function (p) { return html`<i class="${p === cur ? "now" : ""}"></i>`.key(p); }) : "";
        }}</div>
      </div>
      ${joinBlock(true)}
    </div>`;
  }

  /** One holding-page panel (T-12, H-17). @param {string} name */
  function holdingPanel(name) {
    const night = v().night;
    if (!night) return "";
    if (name === "countdown") {
      return html`<div class="grow col center fade-in">
        <div class="t-s muted">${() => (countdownText(withNight((n) => n.plannedStart, /** @type {number | null} */ (null)), page.now) ? "The quiz starts in" : "The quiz is")}</div>
        <div class="${() => "countdown num" + (countdownText(withNight((n) => n.plannedStart, /** @type {number | null} */ (null)), page.now) ? "" : " soon")}">${() => countdownText(withNight((n) => n.plannedStart, /** @type {number | null} */ (null)), page.now) || "Starting soon"}</div>
        <div class="t-s">${() => (withNight((n) => (n.plannedStart !== null ? html`<span>at <b class="num">${clockTime(n.plannedStart)}</b> · </span>` : ""), ""))}<b>${() => teamCountText(v().teams.length)}</b></div>
      </div>`;
    }
    if (name === "teams") {
      return html`<div class="grow col fade-in">
        <div class="t-l b">${() => teamCountText(v().teams.length)}</div>
        <div class="chips mt3">${() => v().teams.map(function (c) { return chip(c); })}</div>
      </div>`;
    }
    if (name === "join") {
      return html`<div class="grow col fade-in panel-centre">
        <div class="t-l b">How to join</div>
        <div class="steps mt3">
          <div>Open your phone's camera and scan the code</div>
          <div>Or go to <b>${() => hostOf(withNight((n) => n.joinUrl, ""))}</b> and type the room code</div>
          <div>Pick a team name. One phone per team.</div>
        </div>
      </div>`;
    }
    if (name === "install") {
      return html`<div class="row fade-in panel-centre install">
        <div class="phone-mock mr4" aria-hidden="true">
          <div class="pm-screen"><div class="pm-title">Lock-In</div><div class="pm-line"></div><div class="pm-line short"></div></div>
          <div class="pm-sheet"><div class="pm-sheet-row"></div><div class="pm-sheet-row add">Add to Home Screen</div><div class="pm-sheet-row"></div></div>
          <div class="pm-home"><i></i><i></i><i></i><i class="new">${padlock("pm-icon")}</i></div>
          <div class="bar"><i></i><i class="hl"></i><i></i><i></i></div>
          <div class="pm-finger"></div>
        </div>
        <div class="grow col">
          <div class="t-l b">Put the quiz on your home screen</div>
          <div class="t-xs muted mt1">Optional. Opens full screen next week, no app store.</div>
          <div class="steps mt3">
            <div>iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b></div>
            <div>Android: tap <b>⋮</b>, then <b>Add to Home screen</b></div>
          </div>
        </div>
      </div>`;
    }
    if (name === "animation") {
      return html`<div class="grow col center fade-in">
        ${padlock("lock brand-lock")}
        <div class="display t-l mt3 status-colour">${BRAND.tagline}</div>
      </div>`;
    }
    if (name === "prizes") {
      return html`<div class="grow col fade-in panel-centre">
        <div class="t-l b">Playing for</div>
        <div class="prizes big mt3">${() => prizeItems(false)}</div>
      </div>`;
    }
    return "";
  }

  function roundScreen() {
    const jokers = () => v().teams.filter(function (c) { return c.jokerThisRound; });
    return html`<div class="display-main col center">
      <div class="t-xs muted">${() => { const n = v().night; return n && n.round ? "Round " + (n.round.index + 1) + " of " + n.roundCount : ""; }}</div>
      <div class="round-title b">${() => { const n = v().night; return n && n.round ? n.round.title : ""; }}</div>
      ${() => (v().lines.round ? html`<div class="display t-l mt3 status-colour">${() => v().lines.round}</div>` : "")}
      ${() => (jokers().length
        ? html`<div class="row mt4 jokers"><span class="t-xs muted mr3 nowrap">Jokers on this round</span><div class="chips">${() => jokers().map(function (c) { return chip(c, true); })}</div></div>`
        : "")}
    </div>`;
  }

  /** @returns {QuestionPublic} */
  /** @type {any} */ let lastQ = null;
  const q = () => /** @type {QuestionPublic} */ (lastQ = (page.view && v().question) || lastQ || EMPTY_Q);
  const tnow = () => timerNow(q().timer, page.now);

  /** 5 or 6 options: the timer moves into the meta row and everything steps down a size (UI-03). */
  const manyOpts = () => q().input.type === "choice" && /** @type {{ options: string[] }} */ (q().input).options.length > 4;
  const compact = () => !!q().image || manyOpts();

  function questionScreen() {
    return html`<div class="${() => "display-main row question-main" + (q().image ? " with-image" : "")}">
      ${() => (q().image ? html`<div class="q-img"><img src="${() => q().image || ""}" alt=""></div>` : "")}
      <div class="grow col q-body">
        <div class="row q-meta">
          <div class="t-xs muted grow">${() => "Question " + q().number}</div>
          ${() => (compact() ? timerDigits(true) : html`<span></span>`)}
        </div>
        <div class="${() => "q-text mt2 t-" + questionSize(q().text, compact())}">${() => q().text}</div>
        ${() => (q().input.type === "choice" ? html`<div class="${() => "opts" + (manyOpts() ? " many" : "")}">${() => options(-1)}</div>` : "")}
        ${() => (compact() ? html`<div class="answered mt3">${answered}</div>` : "")}
      </div>
      ${() => (compact() ? "" : html`<div class="col center timer-col">${timerDigits(false)}<div class="answered mt2">${answered}</div></div>`)}
      <div class="${() => "timerbar" + (tnow().hot ? " hot" : "")}"><b style="${() => "transform:scaleX(" + tnow().fraction + ")"}"></b></div>
    </div>`;
  }

  function answered() {
    return html`<span><b>${() => q().answered}</b> of ${() => q().of} answered</span>`;
  }

  /** @param {boolean} small */
  function timerDigits(small) {
    return html`<div class="timer-box"><div class="${() => "timer" + (small ? " small" : "") + (tnow().hot ? " hot" : "") + (tnow().hot && tnow().running ? " pulse" : "") + (tnow().started ? "" : " idle") + (tnow().text.length > 2 ? " long" : "")}">${() => tnow().text}</div>
      ${() => (tnow().paused ? html`<div class="t-xs muted">Paused</div>` : "")}</div>`;
  }

  /** Multiple-choice options; `right` is the right index in a reveal, -1 while asking. @param {number} right */
  function options(right) {
    const opts = (q().input.type === "choice" ? /** @type {{ options: string[] }} */ (q().input).options : []);
    return opts.map(function (o, i) {
      const cls = right < 0 ? "opt" : i === right ? "opt right" : "opt faded";
      return html`<div class="${cls}"><b>${letter(i)}</b><span class="opt-text">${o}</span><span class="${i === right ? "tick-slot" : "off"}">${tick()}</span></div>`.key(i);
    });
  }

  function lockedScreen() {
    const snap = () => page.snap;
    return html`<div class="display-main col center locked-main">
      <div class="lock-wrap">
        <div class="${() => "ring" + (snap() ? "" : " still")}"></div>
        <div class="${() => "lock-box" + (snap() ? " snap" : "")}">${padlock("lock")}</div>
      </div>
      <div class="${() => "t-xl b mt3 lock-word" + (snap() ? " rise" : "")}">Answers locked</div>
      ${() => (v().lines.locked ? html`<div class="${() => "display t-l mt1" + (snap() ? " rise" : "")}">${() => v().lines.locked}</div>` : "")}
      <div class="${() => "answered mt2" + (snap() ? " rise" : "")}">${() => lockedCount()}</div>
    </div>`;
  }

  function lockedCount() {
    const question = v().question || (v().suddenDeath ? /** @type {any} */ (v().suddenDeath).question : null);
    if (!question) return "";
    if (v().lockedMoment && /** @type {any} */ (v().lockedMoment).all) return "Every team answered";
    return html`<span><b>${question.answered}</b> of ${question.of} teams answered</span>`;
  }

  function markingScreen() {
    return html`<div class="display-main col center">
      ${padlock("lock lock-small")}
      <div class="t-xl b mt3">${() => { const n = v().night; return n && n.round ? "Round " + (n.round.index + 1) + " is in" : "Answers are in"; }}</div>
      <div class="t-s muted mt1">The quizmaster is marking. Answers next.</div>
    </div>`;
  }

  function revealScreen() {
    /** @type {any} */ let lastR = null;
    const r = () => /** @type {NonNullable<DisplayView["reveal"]>} */ (lastR = (page.view && v().reveal) || lastR || { question: EMPTY_Q, answerText: "", rightCount: 0 });
    const rq = () => r().question;
    const isChoice = () => rq().input.type === "choice";
    const many = () => isChoice() && /** @type {{ options: string[] }} */ (rq().input).options.length > 4;
    const of = () => withNight((n) => n.teamCount, v().teams.length);
    return html`<div class="display-main col reveal-main">
      <div class="t-xs muted">${() => "Question " + rq().number}</div>
      <div class="${() => "mt1 q-text t-" + (isChoice() ? (many() ? "s" : "m") : "m muted")}">${() => rq().text}</div>
      ${() => (isChoice()
        ? html`<div class="${() => "opts reveal-in" + (many() ? " many" : "")}">${() => { const qq = rq(); const opts = qq.input.type === "choice" ? qq.input.options : []; return revealOptions(opts, choiceIndex(opts, r().answerText)); }}</div>`
        : html`<div class="t-xl answer mt3 reveal-in">${tick()}<span>${() => r().answerText}</span></div>`)}
      <div class="tally reveal-in">${() => tallyDots(r().rightCount, of())}<span><b>${() => r().rightCount + " of " + of()}</b> ${() => (of() === 1 ? "team got it" : "teams got it")}</span></div>
    </div>`;
  }

  /** @param {string[]} opts @param {number} right */
  function revealOptions(opts, right) {
    return opts.map(function (o, i) {
      const cls = i === right ? "opt right" : "opt faded";
      return html`<div class="${cls}"><b>${letter(i)}</b><span class="opt-text">${o}</span><span class="${i === right ? "tick-slot" : "off"}">${tick()}</span></div>`.key(i);
    });
  }

  /** One dot per team, filled for each team that got it (moments.md 7). @param {number} right @param {number} of */
  function tallyDots(right, of) {
    const out = [];
    const n = Math.min(of, 30);
    // The key carries the state: a recycled dot keeps its first class (UI-13).
    for (let i = 0; i < n; i++) out.push(html`<i class="${i < right ? "ok" : ""}"></i>`.key(i + (i < right ? "y" : "n")));
    return html`<span class="${n > 15 ? "dots small" : "dots"}">${out}</span>`;
  }

  // ---------------------------------------------------------------- leaderboard

  /** @returns {Row[]} */
  const rows = () => (page.view && v().standings ? /** @type {Standings} */ (v().standings).rows : []);
  const rowById = () => byId(rows().map(function (r) { return { id: r.teamId, row: r }; }));

  /**
   * One standings table. Rows are keyed by team id; their contents read the
   * current view by id, so a changed score updates the row in place.
   * @param {{ mode: "leaderboard" | "compact" | "final"; perPage: number; slice: () => number[]; shown: () => number }} o
   */
  function board(o) {
    const layout = () => boardLayout(rows().length, o.perPage);
    const tb = () => wonTieBreak(rows());
    const full = () => o.mode === "leaderboard" && layout().density === "full";
    return html`<div class="${() => "lb" + (layout().density === "dense" || o.mode !== "leaderboard" ? " dense" : "") + (layout().columns === 2 ? " two" : "") + (o.mode === "compact" ? " compact" : "")}" style="${() => "--lb-rows:" + Math.min(10, Math.max(1, sliceLen(o.slice())))}">
      ${() => {
        const s = o.slice();
        const list = rows().slice(s[0], s[1]);
        const shownFrom = list.length - o.shown();
        const tags = tb();
        const isFull = full();
        // Rows hold plain values, no slots of their own: this list slot re-runs on
        // every change and Arrow re-binds the keyed rows (Arrow 1.0.6 leaks the
        // watchers of nested slots in recycled rows, see NOTES).
        return list.map(function (r, i) {
          const id = r.teamId;
          // Bottom-up reveal: rows above the reveal point are hidden; the rest slide in once.
          const state = i < shownFrom ? " hidden" : o.mode === "leaderboard" && !page.lbDone ? " enter" : "";
          // Plain values only, also for the optional tags (a slot that held text cannot later hold a template).
          const joker = r.jokerThisRound && o.mode !== "final";
          const tbTag = !!tags[id] && isFull;
          return html`<div class="${"lb-row" + (r.position === 1 ? " first" : "") + state}" data-key="${id}">
            <span class="pos">${(r.shared ? "=" : "") + r.position}</span>
            <i class="dot" style="${"background:" + LockIn.view.teamColour(r.colour)}"></i>
            <span class="name"><span class="name-text">${r.name}</span><span class="${joker ? "joker" : "off"}">${joker ? "JOKER" : ""}</span><span class="${tbTag ? "badge-tb" : "off"}">${tbTag ? "more round wins" : ""}</span></span>
            <span class="${isFull ? "rnd" : "rnd-none"}">${isFull ? "+" + r.roundScore : ""}</span>
            <span class="${o.mode === "final" ? "mv" : movement(r).cls}">${o.mode === "final" ? "" : movement(r).text}</span>
            <span class="tot">${r.total}</span>
          </div>`.key(id);
        });
      }}
    </div>`;
  }

  /** @param {number[]} s */
  function sliceLen(s) { const len = (s[1] || 0) - (s[0] || 0); return Math.ceil(len / (len > 10 ? 2 : 1)); }

  function leaderboardScreen() {
    const progress = () => ({ page: page.lbPage, shown: page.lbShown });
    const slice = () => {
      const pages = boardLayout(rows().length).pages;
      return pages[Math.min(progress().page, pages.length - 1)] || [0, 0];
    };
    return html`<div class="display-main col">
      ${() => (boardLayout(rows().length).density === "full" ? html`<div class="${() => (rows().length > 6 ? "t-l" : "t-xl") + " b lb-title"}">Leaderboard</div>` : "")}
      ${board({ mode: "leaderboard", perPage: 20, slice, shown: () => Math.min(progress().shown, (slice()[1] || 0) - (slice()[0] || 0)) })}
    </div>`;
  }

  /** @returns {StripParts} */
  function leaderboardStrip() {
    const n = v().night;
    const count = rows().length;
    const pages = boardLayout(count).pages;
    const p = Math.min(page.lbPage, pages.length - 1);
    const sl = pages[p] || [0, count];
    const r = n && n.round;
    const after = r && n ? { a: "After round ", b: String(r.index + 1), c: " of " + n.roundCount } : { a: "", b: "", c: "" };
    if (pages.length > 1) {
      return parts({ ...after, c: after.c + (after.a ? " \u00b7 " : "") + "places ", d: ((sl[0] || 0) + 1) + "\u2013" + sl[1], e: " of " + count + (p < pages.length - 1 ? " \u00b7 top 20 next" : "") });
    }
    return count > 8 ? parts({ ...after, c: after.c + (after.a ? " \u00b7 " : ""), d: String(count), e: " teams" }) : parts(after);
  }


  /** Pages that flip every PAGE_FLIP_MS (halftime and final standings with many teams). @param {number} perPage */
  function flipSlice(perPage) {
    return function () {
      const n = rows().length;
      if (n <= perPage) return [0, n];
      const pages = Math.ceil(n / perPage);
      const p = page.flip % pages;
      return [p * perPage, Math.min(n, (p + 1) * perPage)];
    };
  }

  function halftimeScreen() {
    const perPage = () => (rows().length > 10 ? 20 : 10);
    return html`<div class="display-main row">
      <div class="grow col halftime-col">
        <div class="display halftime-title">Halftime</div>
        ${() => (v().lines.halftime ? html`<div class="display halftime-line mt2">${() => v().lines.halftime}</div>` : "")}
        <div class="grow"></div>
        ${() => (withNight((n) => n.prizes.length > 0, false)
          ? html`<div class="panel"><div class="t-xs muted panel-label">Playing for</div><div class="prizes">${() => prizeItems(false)}</div></div>`
          : "")}
      </div>
      <div class="${() => "side-board" + (rows().length > 10 ? " wide" : "")}">
        ${board({ mode: "compact", perPage: 20, slice: function () { return flipSlice(perPage())(); }, shown: () => 999 })}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- sudden death ("Deadlock")

  /** @type {any} */ let lastSd = null;
  const sd = () => /** @type {NonNullable<DisplayView["suddenDeath"]>} */ (lastSd = (page.view && v().suddenDeath) || lastSd || EMPTY_SD);
  /** @type {any} */ let lastSdq = null;
  const sdq = () => /** @type {QuestionPublic} */ (lastSdq = sd().question || lastSdq || EMPTY_Q);

  /** Points and round wins for a tied team, from the standings. @param {string} id */
  function tiedInfo(id) {
    const e = rowById()[id];
    if (!e) return "";
    return e.row.total + " pts · " + e.row.roundWins + (e.row.roundWins === 1 ? " round win" : " round wins");
  }

  function deadlockStrip() {
    return html`<span class="dl-sub small">Deadlock · sudden death</span><span class="grow"></span>${() => (sd().question
      ? html`<span>Question <b>${() => sd().questionNumber}</b> of up to ${() => sd().maxQuestions} <span class="dl-pips">${() => dlPips()}</span></span>`
      : html`<span>For <b>${() => ordinal(sd().position)} place</b></span>`)}`;
  }

  function dlPips() {
    const out = [];
    const done = sd().status === "revealed" ? sd().questionNumber : sd().questionNumber - 1;
    for (let i = 1; i <= sd().maxQuestions; i++) out.push(html`<i class="${i <= done ? "done" : ""}"></i>`.key(i));
    return out;
  }

  /** Teams side by side with "vs" between them. @param {(c: TeamChip) => any} extra @param {string} size */
  function faceOff(extra, size) {
    return html`<div class="${() => "vs " + size + (sd().teams.length + sd().out.length > 2 ? " many" : "")}">${() => {
      const all = sd().teams.concat(sd().out);
      const out = [];
      for (let i = 0; i < all.length; i++) {
        const c = /** @type {TeamChip} */ (all[i]);
        if (i > 0) out.push(html`<div class="mid">vs</div>`.key("vs" + i));
        const isOut = sd().out.some(function (o) { return o.id === c.id; });
        out.push(html`<div class="${isOut ? "side out" : "side"}"><div class="nm">${c.name}</div>${extra(c)}</div>`.key(c.id));
      }
      return out;
    }}</div>`;
  }

  function deadlockIntro() {
    return html`<div class="display-main col center">
      <div class="dl-sub">Sudden death</div>
      <div class="dl-word mt1">Dead<em>lock</em></div>
      <div class="chain mt3"></div>
      <div class="t-s dl-for mt2">${() => "For " + ordinal(sd().position) + " place"}</div>
      ${faceOff(function (c) { return html`<div class="t-xs dl-info">${tiedInfo(c.id)}</div>`; }, "big mt3")}
    </div>`;
  }

  function deadlockQuestion() {
    const t = () => timerNow(sdq().timer, page.now);
    return html`<div class="display-main col dl-question">
      <div class="row grow dl-q-row">
        <div class="${() => "q-text grow t-" + questionSize(sdq().text, sdq().input.type === "choice" && /** @type {any} */ (sdq().input).options.length > 4)}">${() => sdq().text}</div>
        <div class="${() => "timer dl-timer" + (t().running ? " pulse" : "") + (t().started ? "" : " idle")}">${() => t().text}</div>
      </div>
      ${() => (sdq().input.type === "choice" ? html`<div class="${() => "opts" + (sdq().input.type === "choice" && /** @type {any} */ (sdq().input).options.length > 4 ? " many" : "")}">${() => { const qq = sdq(); return qq.input.type === "choice" ? qq.input.options.map(function (o, i) { return html`<div class="opt"><b>${letter(i)}</b><span class="opt-text">${o}</span></div>`.key(i); }) : []; }}</div>` : "")}
      ${faceOff(function () { return ""; }, "")}
      <div class="answered dl-answered"><b>${() => sdq().answered}</b> of ${() => sdq().of} answered</div>
      <div class="timerbar"><b style="${() => "transform:scaleX(" + t().fraction + ")"}"></b></div>
    </div>`;
  }

  function deadlockResult() {
    const right = () => sd().rightIds || [];
    const outcome = () => sd().outcome;
    return html`<div class="display-main col center">
      ${() => (sdq() ? html`<div class="t-s dl-muted">${() => sdq().text}</div>` : "")}
      ${faceOff(function (c) {
        const ok = right().indexOf(c.id) >= 0;
        return html`<span class="${ok ? "state ok" : "state out"}">${ok ? "Right" : "Wrong"}</span>`;
      }, "mt4")}
      <div class="t-l b mt4 dl-outcome">${() => outcomeText()}</div>
    </div>`;
  }

  function outcomeText() {
    const o = sd().outcome;
    const names = byId(sd().teams.concat(sd().out));
    if (!o) {
      const r = sd().rightIds || [];
      if (r.length === 0) return "Nobody got it. Next question.";
      if (r.length === sd().teams.length + sd().out.length) return "Everyone got it. Next question.";
      return "Still level. Next question.";
    }
    const teamNames = o.teamIds.map(function (id) { return names[id] ? names[id].name : ""; }).filter(Boolean);
    if (o.result === "won") return LockIn.view.joinNames(teamNames) + " take " + ordinal(o.position) + " place";
    return LockIn.view.joinNames(teamNames) + " share " + ordinal(o.position) + " place";
  }

  // ---------------------------------------------------------------- winner and final standings

  const stageNow = () => page.endStage;

  function endedScreen() {
    return html`<div class="ended-wrap">${() => (stageNow() === "winner" ? winnerScreen() : finalScreen())}</div>`;
  }

  function winnerScreen() {
    const winners = () => (v().final ? /** @type {any} */ (v().final).winners : /** @type {TeamChip[]} */ ([]));
    const first = () => withNight((n) => n.prizes.filter(function (p) { return p.place === 1; })[0], undefined);
    const points = () => { const w = winners()[0]; const e = w ? rowById()[w.id] : null; return e ? e.row.total : null; };
    return html`<div class="display-main col center winner-main">
      <div class="burst"></div>
      <div class="display t-l lock-colour">Champions</div>
      <div class="${() => "winners mt2" + (winners().length > 1 ? " shared" : "")}">${() => winners().map(function (/** @type {TeamChip} */ c) {
        return html`<div class="row winner-row"><i class="winner-dot" style="${"background:" + LockIn.view.teamColour(c.colour)}"></i><div class="${"crown-name" + (c.name.length > 22 ? " longer" : c.name.length > 12 ? " long" : "")}">${c.name}</div></div>`.key(c.id);
      })}</div>
      ${() => (points() !== null ? html`<div class="t-m mt2"><b class="num">${() => points()}</b> points</div>` : "")}
      ${() => (v().lines.winner ? html`<div class="display t-l mt3 status-colour">${() => v().lines.winner}</div>` : "")}
      ${() => (first() ? html`<div class="panel mt4 t-s"><b class="prize-label">1st prize</b> <span>${() => (first() ? /** @type {any} */ (first()).text : "")}</span></div>` : "")}
    </div>`;
  }

  function finalScreen() {
    return html`<div class="display-main row">
      <div class="${() => "final-board" + (rows().length > 10 ? " wide" : "")}">
        ${board({ mode: "final", perPage: 20, slice: flipSlice(20), shown: () => 999 })}
      </div>
      <div class="grow col final-lines">
        ${() => (v().lines.lastPlace ? html`<div class="display t-m muted">${() => v().lines.lastPlace}</div>` : "")}
        ${() => (v().lines.goodbye ? html`<div class="display t-l mt4 status-colour">${() => v().lines.goodbye}</div>` : "")}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- frame

  /** @type {Object<string, () => any>} */
  const SCREENS = {
    connecting: connectingScreen,
    blank: function () { return html`<div class="display-main"></div>`; },
    idle: idleScreen,
    pairing: pairingScreen,
    lobby: lobbyScreen,
    holding: holdingScreen,
    round: roundScreen,
    question: questionScreen,
    locked: lockedScreen,
    marking: markingScreen,
    reveal: revealScreen,
    leaderboard: leaderboardScreen,
    halftime: halftimeScreen,
    "dl-intro": deadlockIntro,
    "dl-question": deadlockQuestion,
    "dl-locked": lockedScreen,
    "dl-result": deadlockResult,
    ended: endedScreen,
  };

  /**
   * The header strip as plain text parts: a <b>b</b> c <b>d</b> e, then question pips.
   * Fixed shape with plain values only: a template that appears in a slot that
   * first held text is printed as source code by Arrow 1.0.6 (NOTES).
   * @typedef {{ a: string, b: string, c: string, d: string, e: string, pips: number[] | null }} StripParts
   */
  /** @param {Partial<StripParts>} p @returns {StripParts} */
  const parts = (p) => ({ a: "", b: "", c: "", d: "", e: "", pips: null, ...p });
  const sp = () => stripParts();

  /**
   * " · Music and Film" after "Round 2", or nothing when the title only repeats the number
   * ("Round 2", "Round number 2"), so the strip never reads "Round 2 Round 2".
   * @param {{ index: number; title: string }} r
   */
  function roundTitleSuffix(r) {
    const t = (r.title || "").trim();
    if (!t || new RegExp("^round\\s*(number|no\\.?)?\\s*" + (r.index + 1) + "$", "i").test(t)) return "";
    return " \u00b7 " + t;
  }

  /** @returns {StripParts} */
  function stripParts() {
    const s = page.screen;
    if (!page.view) return parts({});
    const n = v().night;
    const r = n && n.round;
    if (s === "lobby") return n && n.plannedStart !== null ? parts({ a: "Starts at ", b: clockTime(n.plannedStart) }) : parts({ a: "Starting soon" });
    // The round intro says "Round 1 of 6" in the middle of the screen already (UI-07).
    if (s === "round") return parts({});
    if (s === "question" || s === "locked") {
      const qq = v().question;
      return r ? parts({ a: "Round ", b: String(r.index + 1), c: roundTitleSuffix(r), pips: qq ? [r.questionCount, qq.number] : null }) : parts({});
    }
    if (s === "marking") return r ? parts({ a: "Round ", b: String(r.index + 1), c: roundTitleSuffix(r) }) : parts({});
    if (s === "reveal") {
      const rv = v().reveal;
      return r ? parts({ a: "Round ", b: String(r.index + 1), c: " answers", pips: rv ? [r.questionCount, rv.question.number] : null }) : parts({});
    }
    if (s === "leaderboard") return leaderboardStrip();
    if (s === "halftime") return r ? parts({ a: "Halftime \u00b7 round ", b: String(r.index + 2), c: " next" }) : parts({ a: "Halftime" });
    if (s === "ended") return parts({ a: stageNow() === "winner" ? "Final result" : "Final standings" });
    return parts({});
  }

  /** Question pips: done, now, to come. A keyed list from its own slot. */
  function stripPips() {
    const p = sp().pips;
    return p ? pips(p[0] || 0, p[1] || 0) : [];
  }

  const deadlock = () => page.screen.indexOf("dl-") === 0;

  const app = html`<div class="${() => "display-screen" + (deadlock() ? " deadlock" : "") + (page.screen === "idle" || page.screen === "pairing" || page.screen === "connecting" ? " bare" : "")}">
    <div class="${() => "display-safe" + (page.status === "offline" ? " stale" : "")}">
      ${() => (deadlock() ? html`<div class="display-head">${() => html`<div class="dl-strip">${deadlockStrip()}</div>`}</div>` : head())}
      ${() => (SCREENS[page.screen] || idleScreen)()}
      <div class="display-foot">
        <div class="display-voice">${() => footerLine(page.view, page.screen, page.now) || ""}</div>
        <div class="display-credit">Powered by <b>Lock-In</b></div>
      </div>
    </div>
    ${() => (page.status === "offline" ? html`<div class="reconnect" role="status"><i></i>Reconnecting…</div>` : "")}
  </div>`;

  app(root);
  void FLASH_MS;

  let disposed = false;
  return {
    /** @param {DisplayView} view @param {boolean} animate */
    receive: function (view, animate) { if (!disposed) receive(view, animate); },
    /** @param {boolean} reconnect */
    welcome: function (reconnect) { freshConnection = reconnect; },
    /** @param {string} s */
    setStatus: function (s) { if (!disposed && page.status !== s) page.status = s; },
    tick: function () { if (!disposed) { page.now = now(); update(); } },
    /** Before a remount: stops this tree's pending swap and late QR answers changing anything. */
    dispose: function () {
      disposed = true;
      if (pending) { clearTimeout(pending); pending = null; }
      qrKey = "\u0000disposed";
    },
  };
}
