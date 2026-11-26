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
  lockShouldSnap, ordinal, pageBrand, questionSize, revealProgress, screenFor, themeReloadDue, wonTieBreak,
} from "./logic.mjs";
import { recovery } from "/static/shared/parts.mjs";
import { countdown } from "/static/shared/countdown.mjs";
import { lockup, mark } from "/static/shared/mark.mjs";

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
  const recover = recovery({ limit: 3, windowMs: 60_000, sources: ["/vendor/arrow/", "/static/display/", "/static/shared/parts.mjs", "/static/shared/countdown.mjs", "/static/shared/mark.mjs"] });
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
  const EMPTY_Q = { id: "", roundIndex: 0, number: 0, text: "", image: null, input: { type: "text" }, status: "locked", timer: { state: "done", durationMs: 1, locksAt: null, remainingMs: null }, answered: 0, answeredIds: [], of: 0 };
  /** @type {NonNullable<DisplayView["suddenDeath"]>} */
  const EMPTY_SD = { position: 1, teams: [], out: [], questionNumber: 0, maxQuestions: 0, question: null, status: "waiting", rightIds: null, outcome: null };

  /** A fresh tick each time: one template instance must not be mounted in two places. */
  const tick = () => html`<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /** The venue's logo, or the lock in lockup when the venue has none. @param {string} cls */
  function brandMark(cls) {
    return BRAND.logo ? html`<img class="${"venue-logo " + cls}" src="${BRAND.logo}" alt="">` : lockup(html, cls);
  }

  /** A team bubble: team colour with initials, or an empty ring while waiting. @param {TeamChip} c @param {string} [cls] */
  function bubble(c, cls) {
    return html`<span class="${"bubble" + (cls ? " " + cls : "")}" style="${"--b:" + LockIn.view.teamColour(c.colour)}">${LockIn.view.initials(c.name)}</span>`;
  }

  /**
   * The venue's own name, or "" when the theme names none: the server then sends Lock-In's
   * name (DEFAULT_VENUE_NAME in src/server/night/sources.ts) and the lockup stands in for it.
   */
  const venueName = () => {
    const n = page.view ? v().venue.name : "";
    return n === "Lock-In" ? "" : n;
  };

  /** Header: venue logo and name (or the screen's title), round and topic, question number. */
  function head() {
    const showLockup = () => !BRAND.logo && !sp().title && !venueName();
    return html`<div class="display-head">
      <div class="head-venue">${BRAND.logo ? html`<img class="venue-logo" src="${BRAND.logo}" alt="">` : ""}<span class="head-lockup" hidden="${() => !showLockup()}">${lockup(html)}</span><span class="head-name">${() => sp().title || venueName()}</span></div>
      <div class="head-strip">${() => sp().strip}</div>
      <div class="head-right"><span class="head-num">${() => sp().num}</span><span class="head-of">${() => sp().of}</span><span class="head-venue-r">${() => sp().right}</span></div>
    </div>`;
  }

  /** A team in a list: bubble, name, and the JOKER tag when it plays one. @param {TeamChip} c @param {boolean} [joker] */
  function chip(c, joker) {
    return html`<div class="chip">${bubble(c)}<span class="chip-name">${c.name}</span><span class="${joker ? "joker-tag" : "off"}">${joker ? "JOKER" : ""}</span></div>`.key(c.id);
  }

  /** The join block: QR (B8's /qr/join.svg), address and room code. @param {boolean} small */
  function joinBlock(small) {
    return html`<div class="${small ? "join join-side" : "join join-main"}">
      <div class="qr"><img src="${() => page.qr}" alt="" hidden="${() => !page.qr}"></div>
      <div class="join-url">${small ? "" : "Scan, or go to "}<b>${() => hostOf(withNight((n) => n.joinUrl, ""))}</b></div>
      <div class="overline code-label">Room code</div>
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
      ${brandMark("idle-mark")}
      <div class="moment-title mt3 venue-name">${venueName}</div>
      <div class="voice-line mt2">${BRAND.tagline}</div>
    </div>`;
  }

  /** The pairing code, or "" when the server has none to give (SA-03: too many displays waiting). */
  const pairCode = () => (page.view && v().pairing ? (v().pairing || { code: "" }).code : "");

  /** Not paired yet (REVIEW finding 4): only the pairing code, which the host types on the console. */
  function pairingScreen() {
    return html`<div class="display-main col center">
      ${brandMark("idle-mark small")}
      <div class="t-s fog mt4 pair-help">${() => (pairCode() ? 'Quizmaster: to show the quiz here, type this code on the console under "Pair a display".' : "Too many screens are waiting to be paired. Reload this page in a minute.")}</div>
      <div class="pair-code mt3">${() => pairCode()}</div>
      <div class="t-xs muted mt3">${venueName}</div>
    </div>`;
  }

  function connectingScreen() {
    return html`<div class="display-main col center">
      ${lockup(html, "idle-mark")}
      <div class="t-xs muted mt4">Connecting to the quiz…</div>
    </div>`;
  }

  function lobbyScreen() {
    return html`<div class="display-main row lobby-main">
      ${joinBlock(false)}
      <div class="grow col lobby-side">
        <div class="row lobby-count"><span class="big-num">${() => pad2(v().teams.length)}</span><span class="t-s muted">${() => (v().teams.length === 1 ? "team in" : "teams in")}</span></div>
        <div class="t-xs muted mt1">${() => (v().teams.length === 0 ? "No teams yet. Be the first." : "")}</div>
        <div class="${() => "chips lobby-chips mt3" + (v().teams.length <= 4 ? " big" : v().teams.length > 20 ? " many lots" : v().teams.length > 12 ? " many" : "")}">${() => { fitChipsSoon(); return v().teams.map(function (c) { return chip(c); }); }}</div>
        <div class="t-xs muted chips-more" hidden="${() => page.chipsMore === 0}">${() => "+" + page.chipsMore + " more"}</div>
        ${() => (withNight((n) => n.prizes.length > 0, false)
          ? html`<div class="row prize-strip"><div class="overline nowrap">Tonight's prizes</div><div class="t-xs prize-list">${() => prizeItems(true)}</div></div>`
          : "")}
      </div>
    </div>`;
  }

  /** Two digits for big quiet counts: "08". @param {number} n */
  function pad2(n) { return n < 10 ? "0" + n : String(n); }

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
    const startsIn = () => countdownText(withNight((n) => n.plannedStart, /** @type {number | null} */ (null)), page.now);
    if (name === "countdown") {
      return html`<div class="grow col center fade-in">
        <div class="overline">${() => (startsIn() ? "The quiz starts in" : "The quiz is")}</div>
        <div class="${() => "start-count" + (startsIn() ? "" : " soon")}">${() => startsIn() || "Starting soon"}</div>
        <div class="t-xs muted">${() => (withNight((n) => (n.plannedStart !== null ? "at " + clockTime(n.plannedStart) + " · " : ""), ""))}${() => teamCountText(v().teams.length)}</div>
      </div>`;
    }
    if (name === "teams") {
      return html`<div class="grow col fade-in">
        <div class="row lobby-count"><span class="big-num">${() => pad2(v().teams.length)}</span><span class="t-s muted">${() => (v().teams.length === 1 ? "team in" : "teams in")}</span></div>
        <div class="chips mt3">${() => v().teams.map(function (c) { return chip(c); })}</div>
      </div>`;
    }
    if (name === "join") {
      return html`<div class="grow col fade-in panel-centre">
        <div class="panel-title">How to join</div>
        <div class="steps mt3">
          <div><span class="step-n">01</span>Open your phone's camera and scan the code</div>
          <div><span class="step-n">02</span>Or go to <b>${() => hostOf(withNight((n) => n.joinUrl, ""))}</b> and type the room code</div>
          <div><span class="step-n">03</span>Pick a team name. One phone per team.</div>
        </div>
      </div>`;
    }
    if (name === "install") {
      return html`<div class="row fade-in panel-centre install">
        <div class="phone-mock" aria-hidden="true">
          <div class="pm-home"><i></i><i></i><i></i><i></i><i></i><i></i><i class="new">${mark(html)}</i></div>
          <div class="pm-dock"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="grow col">
          <div class="panel-title">Put the quiz on your home screen</div>
          <div class="t-xs muted mt2">Optional. Opens full screen next week, no app store.</div>
          <div class="steps mt3">
            <div><span class="step-n">iPhone</span>Tap <b>Share</b>, then <b>Add to Home Screen</b></div>
            <div><span class="step-n">Android</span>Tap <b>⋮</b>, then <b>Add to Home screen</b></div>
          </div>
        </div>
      </div>`;
    }
    if (name === "animation") {
      return html`<div class="grow col center fade-in">
        ${mark(html, "sweep")}
        <div class="voice-line mt4">${BRAND.tagline}</div>
      </div>`;
    }
    if (name === "prizes") {
      return html`<div class="grow col fade-in panel-centre">
        <div class="panel-title">Playing for</div>
        <div class="prizes big mt3">${() => prizeItems(false)}</div>
      </div>`;
    }
    return "";
  }

  function roundScreen() {
    const jokers = () => v().teams.filter(function (c) { return c.jokerThisRound; });
    return html`<div class="display-main col round-main">
      <div class="overline">${() => { const n = v().night; return n && n.round ? "Round " + (n.round.index + 1) + " of " + n.roundCount : ""; }}</div>
      <div class="round-title">${() => { const n = v().night; return n && n.round ? n.round.title : ""; }}</div>
      ${() => (v().lines.round ? html`<div class="voice-line mt3">${() => v().lines.round}</div>` : "")}
      ${() => (jokers().length
        ? html`<div class="jokers mt4"><div class="overline">Jokers on this round</div><div class="chips mt2">${() => jokers().map(function (c) { return chip(c, true); })}</div></div>`
        : "")}
    </div>`;
  }

  /** @returns {QuestionPublic} */
  /** @type {any} */ let lastQ = null;
  const q = () => /** @type {QuestionPublic} */ (lastQ = (page.view && v().question) || lastQ || EMPTY_Q);

  /** 5 or 6 options: everything steps down a size and the countdown shrinks (UI-03). */
  const manyOpts = () => q().input.type === "choice" && /** @type {{ options: string[] }} */ (q().input).options.length > 4;
  const compact = () => !!q().image || manyOpts();

  /** The venue's countdown on the TV. @param {() => any} timer */
  function tvCountdown(timer) {
    return countdown(html, { style: () => (page.view ? v().venue.countdown : "ring"), timer, now: () => page.now, size: "tv" });
  }

  function questionScreen() {
    return html`<div class="${() => "display-main row question-main" + (q().image ? " with-image" : "") + (compact() ? " compact" : "")}">
      ${() => (q().image ? html`<div class="q-img"><img src="${() => q().image || ""}" alt=""></div>` : "")}
      <div class="grow col q-body">
        <div class="${() => "q-text t-" + questionSize(q().text, compact())}">${() => q().text}</div>
        ${() => (q().input.type === "choice" ? html`<div class="${() => "opts" + (manyOpts() ? " many" : "")}">${() => options(-1)}</div>` : "")}
        <div class="answered-row">${() => answeredBubbles(q())}<span class="answered"><b>${() => q().answered}</b> of ${() => q().of} in</span></div>
      </div>
      <div class="q-cd"><div class="q-cd-in">${tvCountdown(() => q().timer)}</div>
        <div class="t-xs muted cd-note">${() => (q().timer.state === "paused" ? "Paused" : "")}</div></div>
    </div>`;
  }

  /**
   * One bubble per team that can answer: filled (with initials) once it has answered, an
   * empty ring while it is still thinking. Never shows what anyone answered. A keyed list
   * straight in the slot; the key carries the state (UI-13).
   * @param {QuestionPublic} question
   */
  function answeredBubbles(question) {
    const done = byId(question.answeredIds.map(function (id) { return { id: id }; }));
    const teams = v().teams;
    const size = teams.length > 20 ? " tiny" : teams.length > 12 ? " small" : "";
    return teams.map(function (c) {
      const on = !!done[c.id];
      return html`<span class="${"bubble ab" + size + (on ? "" : " waiting")}" style="${"--b:" + LockIn.view.teamColour(c.colour)}">${on && !size ? LockIn.view.initials(c.name) : ""}</span>`.key(c.id + (on ? "y" : "n"));
    });
  }

  /** Multiple-choice options; `right` is the right index in a reveal, -1 while asking. @param {number} right */
  function options(right) {
    const opts = (q().input.type === "choice" ? /** @type {{ options: string[] }} */ (q().input).options : []);
    return opts.map(function (o, i) {
      const cls = right < 0 ? "opt" : i === right ? "opt right" : "opt faded";
      return html`<div class="${cls}"><b>${letter(i)}</b><span class="opt-text">${o}</span><span class="${i === right ? "verdict" : "off"}">${tick()}Right</span></div>`.key(i);
    });
  }

  function lockedScreen() {
    const snap = () => page.snap;
    return html`<div class="display-main col center locked-main">
      <div class="${() => "lock-mark" + (snap() ? " snap" : "")}">${mark(html, "locked")}</div>
      <div class="${() => "moment-title mt4 lock-word" + (snap() ? " rise" : "")}">Answers locked</div>
      ${() => (v().lines.locked ? html`<div class="${() => "voice-line mt2" + (snap() ? " rise" : "")}">${() => v().lines.locked}</div>` : "")}
      <div class="${() => "answered mt3" + (snap() ? " rise" : "")}">${() => lockedCount()}</div>
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
      ${mark(html, "marking-mark")}
      <div class="moment-title mt4">${() => { const n = v().night; return n && n.round ? "Round " + (n.round.index + 1) + " is in" : "Answers are in"; }}</div>
      <div class="t-s muted mt2">The quizmaster is marking. Answers next.</div>
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
      <div class="${() => "q-text reveal-q t-" + (isChoice() ? (many() ? "s" : "m") : "m")}">${() => rq().text}</div>
      ${() => (isChoice()
        ? html`<div class="${() => "opts reveal-in" + (many() ? " many" : "")}">${() => { const qq = rq(); const opts = qq.input.type === "choice" ? qq.input.options : []; return revealOptions(opts, choiceIndex(opts, r().answerText)); }}</div>`
        : html`<div class="answer reveal-in"><span class="answer-text">${() => r().answerText}</span><span class="verdict">${tick()}Right</span></div>`)}
      <div class="tally reveal-in"><span class="${() => (Math.min(of(), 30) > 15 ? "dots small" : "dots")}">${() => tallyDots(r().rightCount, of())}</span><span><b>${() => r().rightCount + " of " + of()}</b> ${() => (of() === 1 ? "team got it" : "teams got it")}</span></div>
    </div>`;
  }

  /** @param {string[]} opts @param {number} right */
  function revealOptions(opts, right) {
    return opts.map(function (o, i) {
      const cls = i === right ? "opt right" : "opt faded";
      return html`<div class="${cls}"><b>${letter(i)}</b><span class="opt-text">${o}</span><span class="${i === right ? "verdict" : "off"}">${tick()}Right</span></div>`.key(i);
    });
  }

  /**
   * One dot per team, filled for each team that got it (moments.md 7). A keyed list straight in
   * the slot: inside a reused wrapper template the list kept the previous reveal's dots (UI-13,
   * the Arrow 1.0.6 pitfall in NOTES). The key carries the state, so a dot is never recycled
   * with the wrong class.
   * @param {number} right @param {number} of
   */
  function tallyDots(right, of) {
    const out = [];
    const n = Math.min(of, 30);
    for (let i = 0; i < n; i++) out.push(html`<i class="${i < right ? "ok" : ""}"></i>`.key(i + (i < right ? "y" : "n")));
    return out;
  }

  // ---------------------------------------------------------------- standings

  /** @returns {Row[]} */
  const rows = () => (page.view && v().standings ? /** @type {Standings} */ (v().standings).rows : []);
  const rowById = () => byId(rows().map(function (r) { return { id: r.teamId, row: r }; }));

  /**
   * One standings table, the departures board: POS · TEAM · ROUND · MOVE · TOTAL. Rows are
   * keyed by team id; their contents read the current view by id, so a changed score updates
   * the row in place.
   * @param {{ mode: "leaderboard" | "compact" | "final"; perPage: number; slice: () => number[]; shown: () => number }} o
   */
  function board(o) {
    const layout = () => boardLayout(rows().length, o.perPage);
    const tb = () => wonTieBreak(rows());
    const full = () => o.mode === "leaderboard" && layout().density === "full";
    return html`<div class="${() => "lb" + (layout().density === "dense" || o.mode !== "leaderboard" ? " dense" : "") + (layout().columns === 2 ? " two" : "") + (o.mode === "compact" ? " compact" : "") + (full() ? " full" : "")}" style="${() => "--lb-rows:" + Math.min(10, Math.max(1, sliceLen(o.slice())))}">
      <div class="lb-head"><span class="pos">Pos</span><span class="bub"></span><span class="name">Team</span><span class="${() => (full() ? "rnd" : "rnd-none")}">${() => (full() ? "Round" : "")}</span><span class="mv">${() => (o.mode === "final" ? "" : "Move")}</span><span class="tot">Total</span></div>
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
          const mv = movement(r);
          return html`<div class="${"lb-row" + (r.position === 1 ? " first" : "") + (((s[0] || 0) + i) % 2 ? " alt" : "") + state}" data-key="${id}">
            <span class="pos">${(r.shared ? "=" : "") + r.position}</span>
            <span class="bub"><span class="bubble" style="${"--b:" + LockIn.view.teamColour(r.colour)}">${LockIn.view.initials(r.name)}</span></span>
            <span class="name"><span class="name-text">${r.name}</span><span class="${joker ? "joker-tag" : "off"}">${joker ? "JOKER" : ""}</span><span class="${tbTag ? "badge-tb" : "off"}">${tbTag ? "more round wins" : ""}</span></span>
            <span class="${isFull ? "rnd" : "rnd-none"}">${isFull ? "+" + r.roundScore : ""}</span>
            <span class="${o.mode === "final" ? "mv" : "mv " + mv.cls}">${o.mode === "final" ? "" : mv.text}</span>
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
    return html`<div class="display-main col lb-main">
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
    const after = r && n ? "after round " + (r.index + 1) + " of " + n.roundCount : "";
    let strip = after;
    if (pages.length > 1) strip += (strip ? " · " : "") + "places " + ((sl[0] || 0) + 1) + "–" + sl[1] + " of " + count + (p < pages.length - 1 ? " · top 20 next" : "");
    else if (count > 8) strip += (strip ? " · " : "") + count + " teams";
    return parts({ title: "Standings", strip: strip, right: venueName() });
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
    return html`<div class="display-main row halftime-main">
      <div class="col halftime-col">
        <div class="moment-title">Halftime</div>
        ${() => (v().lines.halftime ? html`<div class="voice-line mt2">${() => v().lines.halftime}</div>` : "")}
        <div class="grow"></div>
        ${() => (withNight((n) => n.prizes.length > 0, false)
          ? html`<div class="playing-for"><div class="overline">Playing for</div><div class="prizes">${() => prizeItems(false)}</div></div>`
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
    return html`<span class="dl-sub">Deadlock · sudden death</span><span class="grow"></span>${() => (sd().question
      ? html`<span class="dl-count">Question <b>${() => sd().questionNumber}</b><span class="dim"> / ${() => sd().maxQuestions}</span></span>`
      : html`<span class="dl-count">For <b>${() => ordinal(sd().position)} place</b></span>`)}`;
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
        out.push(html`<div class="${isOut ? "side out" : "side"}">${bubble(c, "vs-bubble")}<div class="nm">${c.name}</div>${extra(c)}</div>`.key(c.id));
      }
      return out;
    }}</div>`;
  }

  function deadlockIntro() {
    return html`<div class="display-main col center">
      <div class="dl-word mt1">Deadlock</div>
      <div class="t-s dl-for mt2">${() => "For " + ordinal(sd().position) + " place"}</div>
      ${faceOff(function (c) { return html`<div class="t-xs dl-info">${tiedInfo(c.id)}</div>`; }, "big mt4")}
    </div>`;
  }

  function deadlockQuestion() {
    const many = () => sdq().input.type === "choice" && /** @type {any} */ (sdq().input).options.length > 4;
    return html`<div class="display-main col dl-question">
      <div class="row grow dl-q-row">
        <div class="grow col">
          <div class="${() => "q-text t-" + questionSize(sdq().text, many())}">${() => sdq().text}</div>
          ${() => (sdq().input.type === "choice" ? html`<div class="${() => "opts" + (many() ? " many" : "")}">${() => { const qq = sdq(); return qq.input.type === "choice" ? qq.input.options.map(function (o, i) { return html`<div class="opt"><b>${letter(i)}</b><span class="opt-text">${o}</span></div>`.key(i); }) : []; }}</div>` : "")}
        </div>
        <div class="q-cd dl-cd"><div class="q-cd-in">${tvCountdown(() => sdq().timer)}</div></div>
      </div>
      ${faceOff(function () { return ""; }, "small")}
      <div class="answered dl-answered"><b>${() => sdq().answered}</b> of ${() => sdq().of} in</div>
    </div>`;
  }

  function deadlockResult() {
    const right = () => sd().rightIds || [];
    return html`<div class="display-main col center">
      ${() => (sdq() ? html`<div class="t-s dl-muted">${() => sdq().text}</div>` : "")}
      ${faceOff(function (c) {
        const ok = right().indexOf(c.id) >= 0;
        return html`<span class="${ok ? "state ok" : "state out"}">${ok ? "Right" : "Wrong"}</span>`;
      }, "mt4")}
      <div class="dl-outcome mt4">${() => outcomeText()}</div>
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
    return html`<div class="display-main col winner-main">
      <div class="overline">${() => (winners().length > 1 ? "Joint champions" : "Champions")}</div>
      <div class="${() => "winners mt2" + (winners().length > 1 ? " shared" : "")}">${() => winners().map(function (/** @type {TeamChip} */ c) {
        return html`<div class="winner-row">${bubble(c, "winner-bubble")}<div class="${"crown-name" + (c.name.length > 22 ? " longer" : c.name.length > 12 ? " long" : "")}">${c.name}</div></div>`.key(c.id);
      })}</div>
      ${() => (points() !== null ? html`<div class="winner-points mt3"><span class="big-num venue">${() => points()}</span><span class="t-s muted">points</span></div>` : "")}
      ${() => (v().lines.winner ? html`<div class="voice-line mt3">${() => v().lines.winner}</div>` : "")}
      ${() => (first() ? html`<div class="first-prize mt4"><span class="overline">1st prize</span><span class="t-s">${() => (first() ? /** @type {any} */ (first()).text : "")}</span></div>` : "")}
    </div>`;
  }

  function finalScreen() {
    return html`<div class="display-main row final-main">
      <div class="${() => "final-board" + (rows().length > 10 ? " wide" : "")}">
        ${board({ mode: "final", perPage: 20, slice: flipSlice(20), shown: () => 999 })}
      </div>
      <div class="grow col final-lines">
        ${() => (v().lines.lastPlace ? html`<div class="voice-line small">${() => v().lines.lastPlace}</div>` : "")}
        ${() => (v().lines.goodbye ? html`<div class="voice-line mt4">${() => v().lines.goodbye}</div>` : "")}
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
   * The header as plain text parts: a title that replaces the venue name (Standings), the
   * round strip, the question number and its total, and the venue name on the right when the
   * title replaced it. Fixed shape with plain values only: a template that appears in a slot
   * that first held text is printed as source code by Arrow 1.0.6 (NOTES).
   * @typedef {{ title: string, strip: string, num: string, of: string, right: string }} StripParts
   */
  /** @param {Partial<StripParts>} p @returns {StripParts} */
  const parts = (p) => ({ title: "", strip: "", num: "", of: "", right: "", ...p });
  const sp = () => stripParts();

  /**
   * "Round 2 — Music and Film", or "Round 2" when the title only repeats the number
   * ("Round 2", "Round number 2"), so the strip never reads "Round 2 Round 2" (UI-07).
   * @param {{ index: number; title: string }} r
   */
  function roundLabel(r) {
    const t = (r.title || "").trim();
    const n = "Round " + (r.index + 1);
    if (!t || new RegExp("^round\\s*(number|no\\.?)?\\s*" + (r.index + 1) + "$", "i").test(t)) return n;
    return n + " — " + t;
  }

  /** @returns {StripParts} */
  function stripParts() {
    const s = page.screen;
    if (!page.view) return parts({});
    const n = v().night;
    const r = n && n.round;
    if (s === "lobby" || s === "holding") return n && n.plannedStart !== null ? parts({ strip: "Starts at " + clockTime(n.plannedStart) }) : parts({ strip: "Starting soon" });
    // The round intro says "Round 1 of 6" in the middle of the screen already (UI-07).
    if (s === "round") return parts({});
    if (s === "question" || s === "locked") {
      const qq = v().question;
      return r ? parts({ strip: roundLabel(r), num: qq ? pad2(qq.number) : "", of: qq ? " / " + pad2(r.questionCount) : "" }) : parts({});
    }
    if (s === "marking") return r ? parts({ strip: roundLabel(r) }) : parts({});
    if (s === "reveal") {
      const rv = v().reveal;
      return r ? parts({ strip: roundLabel(r) + " · answers", num: rv ? pad2(rv.question.number) : "", of: rv ? " / " + pad2(r.questionCount) : "" }) : parts({});
    }
    if (s === "leaderboard") return leaderboardStrip();
    if (s === "halftime") return r ? parts({ strip: "Halftime · round " + (r.index + 2) + " next" }) : parts({ strip: "Halftime" });
    if (s === "ended") return stageNow() === "winner" ? parts({ strip: "Final result" }) : parts({ title: "Final standings", right: venueName() });
    return parts({});
  }

  const deadlock = () => page.screen.indexOf("dl-") === 0;
  const bare = () => page.screen === "idle" || page.screen === "pairing" || page.screen === "connecting";

  const app = html`<div class="${() => "display-screen" + (deadlock() ? " deadlock" : "") + (bare() ? " bare" : "")}">
    <div class="${() => "display-safe" + (page.status === "offline" ? " stale" : "")}">
      ${() => (deadlock() ? html`<div class="display-head">${() => html`<div class="dl-strip">${deadlockStrip()}</div>`}</div>` : head())}
      ${() => (SCREENS[page.screen] || idleScreen)()}
      <div class="display-foot">
        <div class="display-voice">${() => footerLine(page.view, page.screen, page.now) || ""}</div>
        <div class="display-credit"><span class="credit-by">Powered by</span>${lockup(html, "mono")}</div>
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
