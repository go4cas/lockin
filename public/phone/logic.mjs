// @ts-check
// Pure helpers for the team phone (B7): which screen to show, how to read the
// view and how to turn what a team typed into an answer. No DOM, no Arrow, so
// tests/phone/logic.test.ts runs them in Bun. No business logic: the phone never
// marks, scores or decides the lock (TECH-SPEC 3.4); it only reads the view.

/** @typedef {import("../../src/shared/protocol").TeamView} TeamView */
/** @typedef {import("../../src/shared/protocol").QuestionPublic} QuestionPublic */
/** @typedef {import("../../src/shared/protocol").TeamAnswer} TeamAnswer */
/** @typedef {import("../../src/shared/rules-api").AnswerValue} AnswerValue */

export const STORAGE_KEY = "lockin.team";
/** Room codes: 4 letters from this set (TECH-SPEC 4). */
export const ROOM_ALPHABET = "BCDFGHJKMNPQRSTVWXZ";
/** Rejoin and move codes (TECH-SPEC 11.2, 11.3). */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const NAME_MAX = 30;
/** Join key in the QR code (D1): 10 characters of CODE_ALPHABET. */
export const JOIN_KEY_LENGTH = 10;
export const TEXT_MAX = 100;

/**
 * Reads the phone's URL: /j/<room code>-<join key> fills in the room code and keeps the
 * join key (QR target, D1; plain /j/<room code> still works), /m/<move code> takes over a
 * team moved by the host (11.3).
 * @param {string} pathname
 * @returns {{ roomCode: string; joinKey: string; moveCode: string }}
 */
export function parsePath(pathname) {
  const j = /^\/j\/([^/]+)\/?$/.exec(pathname);
  const m = /^\/m\/([^/]+)\/?$/.exec(pathname);
  const clean = (/** @type {string} */ s, /** @type {string} */ alphabet, /** @type {number} */ max) => {
    let v = "";
    try { v = decodeURIComponent(s); } catch { v = ""; }
    v = v.toUpperCase();
    return v.length <= max && [...v].every((c) => alphabet.includes(c)) ? v : "";
  };
  const [room = "", key = ""] = j ? (j[1] ?? "").split("-") : [];
  const roomCode = j ? clean(room, ROOM_ALPHABET, 4) : "";
  return {
    roomCode,
    joinKey: roomCode && key.length === JOIN_KEY_LENGTH ? clean(key, CODE_ALPHABET, JOIN_KEY_LENGTH) : "",
    moveCode: m ? clean(m[1] ?? "", CODE_ALPHABET, 8) : "",
  };
}

/**
 * Keeps only the characters a code can have, upper-cased.
 * @param {string} raw
 * @param {string} alphabet
 * @param {number} max
 */
export function cleanCode(raw, alphabet, max) {
  return [...raw.toUpperCase()].filter((c) => alphabet.includes(c)).join("").slice(0, max);
}

/**
 * The saved team identity (TECH-SPEC 11.1), or null.
 * @param {Storage | null | undefined} storage
 * @returns {{ nightId: string; teamId: string; token: string } | null}
 */
export function loadTeam(storage) {
  try {
    const v = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    return v && typeof v.token === "string" && typeof v.teamId === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * @param {Storage | null | undefined} storage
 * @param {{ nightId: string; teamId: string; token: string } | null} team
 */
export function saveTeam(storage, team) {
  try {
    if (team) storage?.setItem(STORAGE_KEY, JSON.stringify(team));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or storage full: the team still plays; it just cannot rejoin automatically.
  }
}

/**
 * The screen for a view. `local` is the page's own state: the join form's mode
 * and whether the phone was moved away or removed.
 * @param {TeamView | null} view
 * @param {{ bye: string | null; joinMode: "join" | "rejoin"; moving: boolean }} local
 * @returns {string}
 */
export function screenOf(view, local) {
  if (local.bye === "moved") return "moved";
  if (local.bye === "removed") return "removed";
  if (local.moving) return "moving";
  if (!view) return "connecting";
  if (!view.self) {
    if (local.joinMode === "rejoin") return "rejoin";
    if (view.phase === "idle" || !view.night) return "no-night";
    if (view.phase === "lobby" && !view.night.started) return "join";
    return "join-closed";
  }
  switch (view.phase) {
    case "idle": return "no-night";
    case "lobby": return "lobby";
    case "round_intro": return "round-intro";
    case "asking": return "asking";
    case "marking":
    case "reveal": return "waiting";
    case "leaderboard": return "score";
    case "halftime": return "halftime";
    case "sudden_death": return view.self.inSuddenDeath ? "deadlock-in" : "deadlock-watch";
    case "ended": return "end";
    default: return "waiting";
  }
}

/**
 * The round a joker could be played on now, or null (P-04, TECH-SPEC 7.2 joker.play).
 * lobby: round 0; round_intro: the upcoming round; leaderboard and halftime: the next round.
 * @param {TeamView | null} view
 * @returns {number | null}
 */
export function jokerRoundNow(view) {
  if (!view || !view.self || !view.night || !view.night.joker || !view.self.jokerAvailable) return null;
  const n = view.night;
  if (view.phase === "lobby") return 0;
  if (view.phase === "round_intro") return n.round ? n.round.index : null;
  if (view.phase === "leaderboard" || view.phase === "halftime") {
    if (!n.round || n.round.isLast) return null;
    return n.round.index + 1 < n.roundCount ? n.round.index + 1 : null;
  }
  return null;
}

/**
 * "Played on round 3", "Still available", or null when the quiz has no joker.
 * @param {TeamView | null} view
 */
export function jokerStatus(view) {
  if (!view || !view.self || !view.night || !view.night.joker) return null;
  if (view.self.jokerRound !== null) return `Played on round ${view.self.jokerRound + 1}`;
  return view.self.jokerAvailable ? "Still available" : "Not available";
}

/**
 * The team's answer for a question, from the view (what the server holds).
 * @param {TeamView | null} view
 * @param {string} questionId
 * @returns {TeamAnswer | null}
 */
export function answerFor(view, questionId) {
  return view?.answers.find((a) => a.questionId === questionId) ?? null;
}

/**
 * The question to answer: the sudden-death question, or the current question(s) while asking.
 * @param {TeamView | null} view
 * @returns {QuestionPublic[]}
 */
export function liveQuestions(view) {
  if (!view) return [];
  if (view.phase === "sudden_death") return view.suddenDeath?.question ? [view.suddenDeath.question] : [];
  return view.questions;
}

/**
 * Which question the phone shows: the one picked in per-round mode if it is still there,
 * else the first open one, else the last.
 * @param {QuestionPublic[]} questions
 * @param {string | null} picked
 * @returns {QuestionPublic | null}
 */
export function pickQuestion(questions, picked) {
  return questions.find((q) => q.id === picked) ?? questions.find((q) => q.status === "open") ?? questions[questions.length - 1] ?? null;
}

const LETTERS = "ABCDEFGHIJ";

/**
 * An answer as the team reads it: "Wings", "B, Saturn", "1989", "20 July 1969", "20:17".
 * @param {AnswerValue} value
 * @param {QuestionPublic["input"]} [input]
 */
export function formatValue(value, input) {
  switch (value.type) {
    case "text": return value.text;
    case "choice": {
      const opt = input && input.type === "choice" ? input.options[value.index] : undefined;
      return opt === undefined ? (LETTERS[value.index] ?? String(value.index + 1)) : `${LETTERS[value.index] ?? value.index + 1}, ${opt}`;
    }
    case "number": return formatNumber(value.value);
    case "datetime": return formatDatetime(value.value);
    default: return "";
  }
}

/** @param {number} n */
export function formatNumber(n) {
  return Number.isInteger(n) && Math.abs(n) >= 10000 ? n.toLocaleString("en-GB") : String(n);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "1969", "20 July 1969" or "20:17". @param {string} v */
export function formatDatetime(v) {
  const d = /^(-?\d{1,4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1] ?? d[2]} ${d[1]}`;
  return v;
}

/**
 * Turns the typed draft into an answer, or says plainly what is wrong with it.
 * @param {QuestionPublic["input"]} input
 * @param {string} draft
 * @returns {{ ok: true; value: AnswerValue } | { ok: false; message: string }}
 */
export function buildValue(input, draft) {
  const raw = draft.trim();
  switch (input.type) {
    case "text":
      if (!raw) return { ok: false, message: "Type an answer first." };
      if (raw.length > TEXT_MAX) return { ok: false, message: `Keep it under ${TEXT_MAX} characters.` };
      return { ok: true, value: { type: "text", text: raw } };
    case "number": {
      const n = Number(raw.replace(/[\s,]/g, ""));
      if (!raw || !Number.isFinite(n)) return { ok: false, message: "Type a number, like 42 or 3.5." };
      return { ok: true, value: { type: "number", value: n } };
    }
    case "datetime": {
      if (input.precision === "year") {
        if (!/^-?\d{1,4}$/.test(raw)) return { ok: false, message: "Type a year, like 1989." };
        return { ok: true, value: { type: "datetime", value: raw.startsWith("-") ? raw : raw.padStart(4, "0") } };
      }
      if (input.precision === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, message: "Pick a date." };
        return { ok: true, value: { type: "datetime", value: raw } };
      }
      if (!/^\d{2}:\d{2}$/.test(raw)) return { ok: false, message: "Pick a time." };
      return { ok: true, value: { type: "datetime", value: raw } };
    }
    case "choice": {
      const i = Number(raw);
      if (!Number.isInteger(i) || i < 0 || i >= input.options.length) return { ok: false, message: "Tap an option." };
      return { ok: true, value: { type: "choice", index: i } };
    }
    default:
      return { ok: false, message: "This phone can't answer this kind of question. Tell the quizmaster." };
  }
}

/**
 * The draft as the server would hold it, to tell "sent" from "changed, not sent".
 * @param {QuestionPublic["input"]} input
 * @param {string} draft
 * @param {TeamAnswer | null} held
 */
export function draftMatches(input, draft, held) {
  if (!held) return false;
  const built = buildValue(input, draft);
  return built.ok && JSON.stringify(built.value) === JSON.stringify(held.value);
}

/**
 * What to put in an input box for an answer the server already holds (after a reload or rejoin).
 * @param {AnswerValue} value
 */
export function draftOf(value) {
  switch (value.type) {
    case "text": return value.text;
    case "choice": return String(value.index);
    case "number": return String(value.value);
    case "datetime": return value.value;
    default: return "";
  }
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st... @param {number} n */
export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

/**
 * This team's row in the standings.
 * @param {TeamView | null} view
 */
export function myRow(view) {
  if (!view || !view.self || !view.standings) return null;
  const id = view.self.id;
  return view.standings.rows.find((r) => r.teamId === id) ?? null;
}

/**
 * One plain line on how the place was decided.
 * @param {{ shared: boolean; decidedBy: string }} row
 */
export function decidedLine(row) {
  if (row.shared) return "Shared with another team";
  if (row.decidedBy === "tie_breaker") return "Tied on points, ahead on round wins";
  if (row.decidedBy === "sudden_death") return "Decided by sudden death";
  return "";
}

/**
 * The prize for a place, if any.
 * @param {TeamView | null} view
 * @param {number} position
 */
export function prizeFor(view, position) {
  return view?.night?.prizes.find((p) => p.place === position) ?? null;
}

/**
 * "R3 · Q2 of 5", "Round 3", or "" outside a round.
 * @param {TeamView | null} view
 * @param {QuestionPublic | null} q
 */
export function progressLabel(view, q) {
  const r = view?.night?.round;
  if (!r) return "";
  if (view?.night?.lockMode === "round" || !q) return `Round ${r.index + 1}`;
  return `R${r.index + 1} · Q${q.number} of ${r.questionCount}`;
}

/**
 * Milliseconds left on a question's timer, or null when no timer runs yet.
 * @param {QuestionPublic["timer"]} t
 * @param {number} serverNow
 */
export function timerLeft(t, serverNow) {
  if (t.state === "running" && t.locksAt !== null) return Math.max(0, t.locksAt - serverNow);
  if (t.state === "paused") return t.remainingMs ?? 0;
  if (t.state === "done") return 0;
  return null;
}

/**
 * Is this an iPhone or iPad (for the home-screen guide's first tab)?
 * @param {string} ua
 */
export function isApple(ua) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
}
