// @ts-check
// Pure helpers for the display (B6). No DOM and no Arrow, so tests/display/ can
// import this file directly. Nothing here computes scores, marks, positions or
// the lock (TECH-SPEC 3.4): it only decides how to show what the view says.
// Follows the display baseline (TECH-SPEC 3.3).

/** @typedef {import("../../src/shared/protocol").DisplayView} DisplayView */
/** @typedef {import("../../src/shared/protocol").NightInfo} NightInfo */
/** @typedef {import("../../src/shared/protocol").TimerView} TimerView */
/** @typedef {import("../../src/shared/protocol").Standings} Standings */
/** @typedef {Standings["rows"][number]} StandingRowView */

/** Seconds a holding-page panel stays up before the next one (moments.md 2). */
export const PANEL_MS = 12000;
/** A flash line is shown for this long after it arrives (TECH-SPEC 10.4). */
export const FLASH_MS = 6000;
/** Pause between leaderboard rows in the bottom-up reveal (--motion-row-gap). */
export const ROW_GAP_MS = 900;
/** How long the 21-30 page holds before the top 20 start (T-06). */
export const PAGE_HOLD_MS = 5000;
/** Halftime and final standings with more than one page flip pages this often. */
export const PAGE_FLIP_MS = 10000;
/** The winner screen holds this long before the final standings (moments.md 12). */
/** A lock that arrived more than this long after the server locked shows the padlock already shut. */
export const LOCK_ANIMATE_WITHIN_MS = 5000;
/** The last seconds of a timer are "hot" (moments.md 4). */
export const HOT_MS = 10000;

/**
 * Which screen the display shows. The holding page depends on the time, so
 * this is called again as the clock ticks (TECH-SPEC 7.4).
 * @param {DisplayView | null} view
 * @param {number} now server time
 * @returns {string}
 */
export function screenFor(view, now) {
  if (!view) return "connecting";
  const night = view.night;
  switch (view.phase) {
    case "idle":
      return "idle";
    case "lobby":
      return night && isHolding(night, now) ? "holding" : "lobby";
    case "round_intro":
      return "round";
    case "asking":
      if (view.question && view.question.status === "locked" && view.lockedMoment) return "locked";
      return view.question ? "question" : "round";
    case "marking":
      return "marking";
    case "reveal":
      return view.reveal ? "reveal" : "marking";
    case "leaderboard":
      return "leaderboard";
    case "halftime":
      return "halftime";
    case "sudden_death": {
      const sd = view.suddenDeath;
      if (!sd || sd.status === "waiting" || !sd.question) return "dl-intro";
      if (sd.status === "revealed") return "dl-result";
      if (sd.status === "locked" || sd.question.status === "locked") return "dl-locked";
      return "dl-question";
    }
    case "ended":
      return "ended";
    default:
      return "idle";
  }
}

/**
 * From holdingFrom until Quiz Start the lobby is the holding page (TECH-SPEC 7.4).
 * @param {NightInfo} night
 * @param {number} now
 */
export function isHolding(night, now) {
  if (night.started) return false;
  if (night.holdingFrom === null || night.plannedStart === null) return false;
  return now >= night.holdingFrom;
}

/**
 * The holding-page panels to rotate, in the venue's order, skipping panels with
 * nothing to show (H-17). The join details are always on screen beside the
 * rotating panel, so a "join" panel is a how-to with steps, not a second QR.
 * @param {NightInfo} night
 * @param {number} teamCount
 * @returns {string[]}
 */
export function holdingPanels(night, teamCount) {
  const out = [];
  for (const p of night.holdingPanels) {
    if (p === "countdown" && night.plannedStart === null) continue;
    if (p === "teams" && teamCount === 0) continue;
    if (p === "prizes" && night.prizes.length === 0) continue;
    if (["countdown", "teams", "join", "install", "animation", "prizes"].indexOf(p) < 0) continue;  // unknown panels are ignored (5.4)
    if (out.indexOf(p) < 0) out.push(p);
  }
  return out;
}

/**
 * "12:34", or "1:02:03" over an hour. Null once it has passed zero ("Starting soon").
 * @param {number | null} target server time
 * @param {number} now
 * @returns {string | null}
 */
export function countdownText(target, now) {
  if (target === null) return null;
  const left = Math.ceil((target - now) / 1000);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const ss = (s < 10 ? "0" : "") + s;
  if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
  return m + ":" + ss;
}

/**
 * Clock time of day for a server timestamp, "19:30" (the display's own time zone).
 * @param {number} t
 */
export function clockTime(t) {
  const d = new Date(t);
  const h = d.getHours();
  const m = d.getMinutes();
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

/**
 * What the timer shows now.
 * Digits hold at 0 when the time is up; nothing here ever says "locked" (T-04).
 * @param {TimerView} timer
 * @param {number} now server time
 * @returns {{ text: string; fraction: number; hot: boolean; running: boolean; paused: boolean; started: boolean }}
 */
export function timerNow(timer, now) {
  const dur = timer.durationMs > 0 ? timer.durationMs : 1;
  let left = dur;
  if (timer.state === "running" && timer.locksAt !== null) left = Math.max(0, timer.locksAt - now);
  else if (timer.state === "paused" && timer.remainingMs !== null) left = Math.max(0, timer.remainingMs);
  else if (timer.state === "done") left = 0;
  const secs = Math.ceil(left / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const text = m > 0 ? m + ":" + (s < 10 ? "0" : "") + s : String(s);
  const started = timer.state !== "idle";
  return {
    text,
    fraction: Math.max(0, Math.min(1, left / dur)),
    hot: started && left <= HOT_MS,
    running: timer.state === "running",
    paused: timer.state === "paused",
    started,
  };
}

/**
 * Question text size step (docs/design/README.md, "Legibility"): text-only
 * questions use l up to 90 characters and m to 200; picture questions m and s.
 * @param {string} text
 * @param {boolean} hasImage
 * @returns {"l" | "m" | "s"}
 */
export function questionSize(text, hasImage) {
  const long = text.length > 90;
  if (hasImage) return long ? "s" : "m";
  return long ? "m" : "l";
}

/** "A", "B", ... for multiple-choice options. @param {number} i */
export function letter(i) {
  return String.fromCharCode(65 + i);
}

/**
 * The index of the right option in a choice reveal. answerText is "B. Paris"
 * (TECH-SPEC 10.3), so the letter is read back; -1 when it cannot be found.
 * @param {string[]} options
 * @param {string} answerText
 */
export function choiceIndex(options, answerText) {
  const m = /^([A-Z])\.\s/.exec(answerText);
  if (m) {
    const i = (m[1] || "").charCodeAt(0) - 65;
    if (i >= 0 && i < options.length) return i;
  }
  return options.indexOf(answerText);
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". @param {number} n */
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + "th";
  const u = n % 10;
  return n + (u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th");
}

/**
 * How a leaderboard of n teams is laid out (docs/design/README.md, "Leaderboard
 * density"): 1-8 one column with round points, 9-20 two columns of 10, 21-30
 * pages of up to 20. Pages are [start, end) slices of the rows, in the order
 * they are shown: bottom page first.
 * @param {number} n
 * @param {number} [perPage]
 * @returns {{ density: "full" | "dense"; columns: number; pages: number[][] }}
 */
export function boardLayout(n, perPage) {
  const size = perPage || 20;
  if (n <= 8) return { density: "full", columns: 1, pages: [[0, n]] };
  if (n <= size) return { density: "dense", columns: size > 10 ? 2 : 1, pages: [[0, n]] };
  const pages = [];
  for (let start = 0; start < n; start += size) pages.push([start, Math.min(n, start + size)]);
  pages.reverse();
  return { density: "dense", columns: size > 10 ? 2 : 1, pages };
}

/**
 * Team ids that sit above a team level on points because of round wins
 * (S-07), so the row can carry the "more round wins" tag. The other team in
 * the pair also has decidedBy "tie_breaker", but it lost the tie breaker.
 * @param {StandingRowView[]} rows
 * @returns {Object<string, boolean>}
 */
export function wonTieBreak(rows) {
  /** @type {Object<string, boolean>} */
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.decidedBy !== "tie_breaker") continue;
    for (let j = i + 1; j < rows.length; j++) {
      const below = rows[j];
      if (!below || below.total !== r.total) break;
      if (below.position > r.position) { out[r.teamId] = true; break; }
    }
  }
  return out;
}

/**
 * A chip lookup by team id. @param {{ id: string }[]} chips
 * @returns {Object<string, any>}
 */
export function byId(chips) {
  /** @type {Object<string, any>} */
  const out = {};
  for (const c of chips) out[c.id] = c;
  return out;
}

/**
 * The footer line for a screen (TECH-SPEC 10.4). A fresh flash (team joined,
 * joker played) replaces the screen's line for FLASH_MS.
 * @param {DisplayView | null} view
 * @param {string} screen
 * @param {number} now
 * @returns {string | null}
 */
export function footerLine(view, screen, now) {
  if (!view) return null;
  const f = view.flash;
  if (f && f.key !== "no_answer" && now - f.at < FLASH_MS && now - f.at >= -FLASH_MS) return f.line;
  const l = view.lines;
  switch (screen) {
    case "lobby":
    case "holding": return l.lobby;
    case "round": return null;               // the round line is the headline on this screen
    case "question": return l.question;
    case "locked": return null;              // the locked line is under the padlock
    case "marking": return l.reveal || null;
    case "reveal": return l.reveal;
    case "leaderboard": return l.leaderboard;
    case "halftime": return null;            // under the title
    case "dl-intro":
    case "dl-result": return l.suddenDeath;
    default: return null;
  }
}

/**
 * The line under "Answers locked" (T-04). The engine picks locked or
 * all_locked into lines.locked when the question locks.
 * @param {DisplayView} view
 */
export function lockedLine(view) {
  return view.lines.locked;
}

/**
 * Whether the padlock should snap now (play the animation) or show already
 * shut. It never shows before the server locked (the view only carries
 * lockedMoment once the server has locked); a display that is a few seconds
 * late still plays it, a display that reconnects long after shows it shut.
 * @param {{ at: number } | null} moment
 * @param {number} now
 */
export function lockShouldSnap(moment, now) {
  if (!moment) return false;
  return now - moment.at < LOCK_ANIMATE_WITHIN_MS;
}

/**
 * The leaderboard reveal plan for n rows (T-06): one step per row, from the
 * last place up, page by page. Returns how many rows of each page are visible
 * after `step` steps, and which page is on screen.
 * @param {number} n
 * @param {number} elapsedMs since the reveal began
 * @returns {{ page: number; shown: number; done: boolean }}
 */
export function revealProgress(n, elapsedMs) {
  const layout = boardLayout(n);
  let t = elapsedMs;
  for (let p = 0; p < layout.pages.length; p++) {
    const pg = layout.pages[p] || [0, 0];
    const len = (pg[1] || 0) - (pg[0] || 0);
    const pageMs = len * ROW_GAP_MS;
    const last = p === layout.pages.length - 1;
    if (t < pageMs) return { page: p, shown: Math.min(len, Math.floor(t / ROW_GAP_MS) + 1), done: false };
    if (last) return { page: p, shown: len, done: true };
    if (t < pageMs + PAGE_HOLD_MS) return { page: p, shown: len, done: false };
    t -= pageMs + PAGE_HOLD_MS;
  }
  return { page: 0, shown: n, done: true };
}

/**
 * "Round 3 of 6"-style strip text pieces for the header.
 * @param {NightInfo | null} night
 */
export function roundLabel(night) {
  if (!night || !night.round) return null;
  return { number: night.round.index + 1, of: night.roundCount, title: night.round.title };
}

/** Phases with nothing timed on screen, where a reload to pick up a new theme is not noticed. */
const CALM_PHASES = ["idle", "lobby", "halftime", "ended"];

/**
 * Whether the display should reload itself to pick up a theme change (logo, tagline,
 * fonts; H-16 "from the next screen they show"). `seen` is the themeVersion the page
 * loaded with. It reloads at once in a calm phase, otherwise on the next phase change.
 * @param {string | null} seen @param {any} view @param {any} last
 */
export function themeReloadDue(seen, view, last) {
  const version = view && view.venue ? view.venue.themeVersion : null;
  if (seen === null || version === null || version === seen) return false;
  return CALM_PHASES.indexOf(view.phase) >= 0 || !last || last.phase !== view.phase;
}

/**
 * The venue logo URL and tagline the server put in the page (GET /display).
 * Only a same-site path is used as a logo.
 * @param {{ querySelector(s: string): { getAttribute(n: string): string | null } | null }} doc
 */
export function pageBrand(doc) {
  const get = function (/** @type {string} */ name) {
    const el = doc.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  };
  const logo = get("lockin-logo");
  return {
    logo: /^\/theme\/assets\/[A-Za-z0-9._-]+$/.test(logo) ? logo : null,
    tagline: get("lockin-tagline") || "Lock in your answers.",
  };
}

/**
 * Ended: the winner screen, then the final standings once the server's
 * `final.standingsAt` has passed (venue afterWinner: a timer, or the host's Next).
 * @param {{ standingsAt: number | null } | null} final @param {number} now server time
 */
export function endStage(final, now) {
  return final && final.standingsAt !== null && now >= final.standingsAt ? "final" : "winner";
}

/**
 * The leaderboard movement arrow for a row: places moved since the round before.
 * Up is a smaller position number. Null prevPosition (after the first round) shows nothing.
 * @param {{ position: number, prevPosition?: number | null }} row
 * @returns {{ cls: string, text: string }}
 */
export function movement(row) {
  const prev = row.prevPosition;
  if (prev === null || prev === undefined) return { cls: "mv", text: "" };
  const by = prev - row.position;
  if (by > 0) return { cls: "mv up", text: "▲" + by };
  if (by < 0) return { cls: "mv down", text: "▼" + -by };
  return { cls: "mv same", text: "–" };
}
