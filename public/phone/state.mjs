// @ts-check
// The phone's two stores (TECH-SPEC 3.4): `page` holds the server's view and the
// connection status, `ui` holds what only this phone knows (what is being typed,
// open sheets, the join form). A new view replaces page.view and never touches ui,
// so a half-typed answer and the focused box survive every update.
// Actions send commands through the shared client and keep at most one pending
// command per button (TECH-SPEC 10.5).

import { reactive } from "/vendor/arrow/index.mjs";
import * as L from "./logic.mjs";

/** @typedef {import("../../src/shared/protocol").TeamView} TeamView */
/** @typedef {import("../../src/shared/protocol").QuestionPublic} QuestionPublic */

/** @type {any} */
const W = typeof window !== "undefined" ? window : globalThis;

function storage() {
  try { return W.localStorage; } catch { return null; }
}

const path = L.parsePath(W.location ? W.location.pathname : "/");

export const page = reactive({
  /** @type {TeamView | null} */ view: null,
  /** "connecting" | "online" | "offline" */ status: "connecting",
  /** @type {string | null} */ bye: null,
});

/** The screen on show. Changed only through show(), so screens swap in two steps. */
export const nav = reactive({ screen: "connecting" });

export const ui = reactive({
  joinMode: /** @type {"join" | "rejoin"} */ ("join"),
  name: "",
  room: path.roomCode,
  /** @type {{ code: string; message: string } | null} */ joinError: null,
  joining: false,
  rejoinCode: "",
  /** @type {string | null} */ rejoinError: null,
  rejoining: false,
  moving: !!path.moveCode,
  menu: false,
  guide: false,
  guideTab: L.isApple(W.navigator ? W.navigator.userAgent : "") ? "ios" : "android",
  /** @type {string | null} */ picked: null,
  /** @type {Record<string, string>} */ drafts: {},
  /** @type {Record<string, boolean>} */ sending: {},
  /** @type {Record<string, string>} */ sendError: {},
  /** @type {number | null} */ jokerConfirm: null,
  /** @type {Record<string, boolean>} */ jokerSkip: {},
  jokerBusy: false,
  /** @type {string | null} */ jokerError: null,
  /** @type {string | null} */ zoom: null,
  /** @type {{ id: number; line: string } | null} */ toast: null,
  /** Server time, ticking, for timers and countdowns. */ now: Date.now(),
});

/** @type {any} */
let client = null;
let sentToken = false;
let moveTried = false;
let lastFlash = 0;
/** @type {string | null} */
let themeVersion = null;
/** @type {any} */
let toastTimer = null;

/** Starts the connection. Called once by app.mjs. */
export function start() {
  client = W.LockIn.connect({
    role: "team",
    getToken() {
      const t = L.loadTeam(storage());
      sentToken = !!t;
      return t ? t.token : null;
    },
    onWelcome(/** @type {{ teamId: string | null }} */ msg) {
      // A token for a night that has ended, or for a team that moved away, binds nothing (11.1).
      if (sentToken && !msg.teamId) L.saveTeam(storage(), null);
    },
    onStatus(/** @type {string} */ s) { page.status = s; },
    onBye(/** @type {string} */ reason) {
      if (reason === "moved" || reason === "removed") {
        L.saveTeam(storage(), null);
        page.bye = reason;
        reroute();
      }
    },
    onState: receive,
  });
  setInterval(() => { ui.now = client.clock.now(); }, 250);
  return client;
}

function localState() {
  return { bye: page.bye, joinMode: ui.joinMode, moving: ui.moving };
}

/**
 * Puts a view on screen and picks the screen for it.
 * @param {TeamView | null} view
 */
export function show(view) {
  page.view = view;
  const next = L.screenOf(view, localState());
  if (next !== nav.screen) nav.screen = next;
}

/** Re-checks the screen after the page's own state changed (join form, moved, moving). */
function reroute() {
  show(page.view);
}

/** @param {TeamView} view */
function receive(view) {
  show(view);
  if (page.status !== "online") page.status = "online";
  const self = view.self;
  if (self) {
    const saved = L.loadTeam(storage());
    if (saved && saved.teamId === self.id && view.night && saved.nightId !== view.night.id) {
      L.saveTeam(storage(), { ...saved, nightId: view.night.id });
    }
    // After a reload or a rejoin, fill the boxes with what the server already holds.
    for (const a of view.answers) {
      if (ui.drafts[a.questionId] === undefined) ui.drafts[a.questionId] = L.draftOf(a.value);
    }
  }
  if (ui.moving && !moveTried) {
    moveTried = true;
    moveHere();
  }
  showFlash(view);
  reloadTheme(view.venue.themeVersion);
}

/** Flashes (10.4): shown once per id, dropped after 6 s. */
function showFlash(/** @type {TeamView} */ view) {
  const f = view.flash;
  if (!f || f.id <= lastFlash) return;
  lastFlash = f.id;
  if (f.teamId && view.self && f.teamId !== view.self.id) return;
  const age = client ? client.clock.now() - f.at : 0;
  if (age > 6000) return;
  ui.toast = { id: f.id, line: f.line };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; }, 6000 - Math.max(0, age));
}

/** A new theme version reloads /theme.css (TECH-SPEC 5.3). */
function reloadTheme(/** @type {string} */ version) {
  if (themeVersion === null) { themeVersion = version; return; }
  if (version === themeVersion) return;
  themeVersion = version;
  const link = W.document && W.document.getElementById("theme-css");
  if (link) link.setAttribute("href", `/theme.css?v=${encodeURIComponent(version)}`);
}

/** @param {{ teamId: string; token: string }} result */
function remember(result) {
  if (!result || typeof result.token !== "string") return;
  L.saveTeam(storage(), { nightId: page.view && page.view.night ? page.view.night.id : "", teamId: result.teamId, token: result.token });
}

/** Leaves /j/… or /m/… in the address bar once it has done its job, so a reload goes to "/". */
function forgetPath() {
  try {
    if (W.location.pathname !== "/") W.history.replaceState(null, "", "/");
  } catch { /* not important */ }
}

/** @param {any} e */
function errorOf(e) {
  return { code: e && e.code ? String(e.code) : "server_error", message: e && e.message ? String(e.message) : "Something went wrong. Try again." };
}

export function join() {
  if (ui.joining) return;
  const name = ui.name.trim();
  const room = L.cleanCode(ui.room, L.ROOM_ALPHABET, 4);
  if (!name) { ui.joinError = { code: "bad_args", message: "Type a team name first." }; return; }
  if (room.length !== 4) { ui.joinError = { code: "room_code", message: "The room code has 4 letters. It's on the TV." }; return; }
  ui.joining = true;
  ui.joinError = null;
  client.cmd("team.join", { roomCode: room, name }).then(
    (/** @type {any} */ r) => { ui.joining = false; remember(r); forgetPath(); },
    (/** @type {any} */ e) => { ui.joining = false; ui.joinError = errorOf(e); },
  );
}

export function rejoin() {
  if (ui.rejoining) return;
  const code = L.cleanCode(ui.rejoinCode, L.CODE_ALPHABET, 8);
  if (code.length < 6) { ui.rejoinError = "A rejoin code has 6 letters and numbers. Your team's old phone shows it in the team menu."; return; }
  ui.rejoining = true;
  ui.rejoinError = null;
  client.cmd("team.rejoin", { code }).then(
    (/** @type {any} */ r) => { ui.rejoining = false; ui.joinMode = "join"; ui.rejoinCode = ""; remember(r); forgetPath(); reroute(); },
    (/** @type {any} */ e) => { ui.rejoining = false; ui.rejoinError = errorOf(e).message; },
  );
}

/** /m/<code>: take over a team the host is moving to this phone (11.3). */
function moveHere() {
  const code = L.parsePath(W.location.pathname).moveCode;
  client.cmd("team.rejoin", { code }).then(
    (/** @type {any} */ r) => { remember(r); ui.moving = false; forgetPath(); reroute(); },
    (/** @type {any} */ e) => {
      ui.moving = false;
      ui.joinMode = "rejoin";
      ui.rejoinError = `${errorOf(e).message} Ask the quizmaster for a new move link, or type your team's rejoin code.`;
      forgetPath();
      reroute();
    },
  );
}

/** @param {"join" | "rejoin"} mode */
export function setJoinMode(mode) {
  ui.joinMode = mode;
  ui.joinError = null;
  ui.rejoinError = null;
  reroute();
}

/**
 * Sends an answer (P-05). Free text and numbers send on the button; choices send on tap.
 * @param {QuestionPublic} q
 */
export function send(q) {
  if (ui.sending[q.id]) return;
  const built = L.buildValue(q.input, ui.drafts[q.id] ?? "");
  if (!built.ok) { ui.sendError[q.id] = built.message; return; }
  ui.sending[q.id] = true;
  ui.sendError[q.id] = "";
  client.cmd("answer.submit", { questionId: q.id, value: built.value }).then(
    () => { ui.sending[q.id] = false; },
    (/** @type {any} */ e) => {
      ui.sending[q.id] = false;
      const err = errorOf(e);
      ui.sendError[q.id] = err.code === "disconnected"
        ? "Not sent. You're offline, so this answer has not reached the quizmaster. Tap Send again once you're back."
        : err.message;
    },
  );
}

/**
 * @param {QuestionPublic} q
 * @param {number} index
 */
export function choose(q, index) {
  ui.drafts[q.id] = String(index);
  send(q);
}

/** @param {number} round */
export function playJoker(round) {
  if (ui.jokerBusy) return;
  if (ui.jokerConfirm !== round) { ui.jokerConfirm = round; ui.jokerError = null; return; }
  ui.jokerBusy = true;
  client.cmd("joker.play", { round }).then(
    () => { ui.jokerBusy = false; ui.jokerConfirm = null; },
    (/** @type {any} */ e) => { ui.jokerBusy = false; ui.jokerConfirm = null; ui.jokerError = errorOf(e).message; },
  );
}

/** @param {number} round */
export function skipJoker(round) {
  if (ui.jokerConfirm === round) { ui.jokerConfirm = null; return; }
  ui.jokerSkip[String(round)] = true;
}

export function offline() {
  return page.status === "offline";
}
