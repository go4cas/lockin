// @ts-check
// Pure helpers for the Run night console (B5). No DOM and no Arrow, so `bun test`
// can import them (tests/host-run/). The server decides everything (TECH-SPEC 3.4):
// these only choose labels and which allowed command is the obvious next step.

/** @typedef {import("../../../src/shared/protocol").HostView} HostView */
/** @typedef {import("../../../src/shared/protocol").CommandName} CommandName */
/** @typedef {import("../../../src/shared/protocol").QuestionHost} QuestionHost */
/** @typedef {import("../../../src/shared/protocol").TimerView} TimerView */
/** @typedef {import("../../../src/shared/protocol").MarkingQuestion} MarkingQuestion */
/** @typedef {import("../../../src/shared/rules-api").AnswerGroup} AnswerGroup */

/**
 * @typedef {object} Action
 * @property {CommandName} name
 * @property {object} args
 * @property {string} label
 * @property {string} [hint]
 * @property {boolean} [confirm]   true: ask before sending (ending early)
 * @property {"danger"} [tone]
 */

/**
 * Is a command allowed now? Only the server's `can` decides (10.3).
 * @param {HostView | null} view
 * @param {CommandName} name
 */
export function can(view, name) {
  return !!(view && view.can && view.can[name]);
}

/** @param {number} n */
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] || "th");
}

/** @param {HostView} view */
function roundNo(view) {
  const r = view.night && view.night.round;
  return r ? r.index + 1 : 0;
}

/**
 * The big button at the bottom of the side panel: the next step of the night,
 * picked from the commands the server allows now. Null when nothing moves the night on.
 * @param {HostView | null} view
 * @returns {Action | null}
 */
export function primaryAction(view, now = 0) {
  if (!view) return null;
  const night = view.night;
  const round = night && night.round;
  const n = roundNo(view);
  /** @type {Action[]} */
  const options = [];
  switch (view.phase) {
    case "lobby":
      options.push({ name: "quiz.start", args: {}, label: "Start the quiz",
        hint: view.teams.length ? `${plural(view.teams.length, "team")}. Joining closes when you start.` : "Waiting for the first team to join." });
      break;
    case "round_intro":
      options.push({ name: "round.start", args: {}, label: `Start round ${n}`, hint: round ? round.title : undefined });
      break;
    case "asking": {
      const shown = view.round ? view.round.shown : 0;
      const count = round ? round.questionCount : 0;
      const perRound = night && night.lockMode === "round";
      options.push({ name: "round.finish", args: {}, label: "Finish the round", hint: "Every question is locked. Go to marking." });
      options.push({ name: "question.next", args: {}, label: `Show question ${shown + 1}`,
        hint: shown + 1 === count ? "The last question of the round." : `Then ${count - shown - 1} more.` });
      options.push({ name: "timer.start", args: {}, label: perRound ? "Start the round timer" : "Start the timer",
        hint: perRound ? "Every question shown so far locks together when it ends." : "The question locks when it ends." });
      options.push({ name: "lock", args: {}, label: perRound ? "Lock the round now" : "Lock now",
        hint: timerHint(view.current && view.current.timer, perRound) });
      break;
    }
    case "marking": {
      const left = view.marking ? view.marking.pendingTotal : 0;
      options.push({ name: "reveal.start", args: {}, label: "Reveal the answers" });
      if (left > 0) return { name: "reveal.start", args: {}, label: "Reveal the answers", hint: `${plural(left, "answer")} left to mark before the reveal.` };
      break;
    }
    case "reveal": {
      const num = view.reveal ? view.reveal.question.number : 0;
      const count = round ? round.questionCount : 0;
      options.push({ name: "reveal.next", args: {}, label: num < count ? `Show answer ${num + 1}` : "Show the leaderboard",
        hint: num < count ? undefined : "That was the last answer of the round." });
      break;
    }
    case "leaderboard":
      if (view.suddenDeathNeeded) {
        options.push({ name: "sd.start", args: {}, label: "Start Deadlock",
          hint: `Sudden death for ${ordinal(view.suddenDeathNeeded.position)} place: ${plural(view.suddenDeathNeeded.teamIds.length, "team")} tied.` });
      }
      options.push({ name: "round.next", args: {}, label: round && round.isHalftimeRound && night && !night.round?.isLast ? "Go to halftime" : `Next: round ${n + 1}` });
      if (round && round.isLast) options.push({ name: "quiz.end", args: {}, label: "End the quiz", hint: "Shows the winner and saves the night." });
      break;
    case "halftime":
      options.push({ name: "round.next", args: {}, label: `Next: round ${n + 1}`, hint: "Ends halftime." });
      break;
    case "sudden_death": {
      const sd = view.suddenDeath;
      options.push({ name: "sd.reveal", args: {}, label: "Reveal who was right" });
      options.push({ name: "timer.start", args: {}, label: "Start the timer" });
      options.push({ name: "lock", args: {}, label: "Lock now", tone: "danger", hint: "Then mark and reveal who was right." });
      options.push({ name: "sd.ask", args: {}, label: sd ? `Ask question ${sd.status === "waiting" ? sd.questionNumber : sd.questionNumber + 1}` : "Ask the next question" });
      options.push({ name: "sd.start", args: {}, label: "Start the next Deadlock" });
      options.push({ name: "quiz.end", args: {}, label: "End the quiz", hint: "Shows the winner and saves the night." });
      break;
    }
    case "ended":
      options.push({ name: "final.show", args: {}, label: "Show the final standings",
        hint: view.finalStandingsAt ? `The display moves on by itself in ${Math.max(0, Math.ceil((view.finalStandingsAt - now) / 1000))} s.` : "The winner is on the display. Move on when the room is ready." });
      options.push({ name: "night.close", args: {}, label: "Close the night", hint: "The display goes back to the venue's waiting screen." });
      break;
    case "idle":
      break;
  }
  return options.find((a) => can(view, a.name)) || null;
}

/**
 * @param {TimerView | null | undefined} timer
 * @param {boolean | null} perRound
 */
function timerHint(timer, perRound) {
  if (!timer) return undefined;
  if (timer.state === "running") return "Or wait: it locks by itself when the timer ends.";
  if (timer.state === "paused") return "The timer is paused.";
  if (timer.state === "idle") return perRound ? "No timer running: the round stays open until you lock it." : "No timer running: the question stays open until you lock it.";
  return undefined;
}

/**
 * "Quiz End" from the night menu. Early unless the night is at its normal end (7.2).
 * @param {HostView | null} view
 * @returns {Action | null}
 */
export function endAction(view) {
  if (!view || !can(view, "quiz.end")) return null;
  const atEnd = (view.phase === "leaderboard" && !!(view.night && view.night.round && view.night.round.isLast)) || view.phase === "sudden_death";
  return atEnd
    ? { name: "quiz.end", args: {}, label: "End the quiz", confirm: true }
    : { name: "quiz.end", args: { early: true }, label: "End the quiz early", confirm: true, tone: "danger" };
}

/**
 * The step pills above the question: Q1 locked, Q2 timer running, Q3, Mark, Reveal, Leaderboard.
 * @param {HostView} view
 * @returns {{ key: string, label: string, state: "done" | "now" | "todo" }[]}
 */
export function steps(view) {
  const round = view.night && view.night.round;
  /** @type {{ key: string, label: string, state: "done" | "now" | "todo" }[]} */
  const out = [];
  const qs = view.round ? view.round.questions : [];
  const shown = view.round ? view.round.shown : 0;
  const phase = view.phase;
  qs.forEach((q, i) => {
    if (phase === "reveal") {
      const num = view.reveal ? view.reveal.question.number : 0;
      out.push({ key: q.id, label: q.number === num ? `Q${q.number} answer` : `Q${q.number}`, state: q.number < num ? "done" : q.number === num ? "now" : "todo" });
      return;
    }
    if (phase !== "asking") {
      out.push({ key: q.id, label: `Q${q.number}`, state: phase === "round_intro" ? "todo" : "done" });
      return;
    }
    if (i >= shown) { out.push({ key: q.id, label: `Q${q.number}`, state: "todo" }); return; }
    const isCurrent = !!view.current && view.current.id === q.id;
    if (q.status === "locked") out.push({ key: q.id, label: `Q${q.number} locked`, state: isCurrent ? "now" : "done" });
    else if (view.night && view.night.lockMode === "round") out.push({ key: q.id, label: `Q${q.number} open`, state: "now" });
    else out.push({ key: q.id, label: `Q${q.number} ${timerWord(q.timer)}`, state: isCurrent ? "now" : "done" });
  });
  const after = [
    { key: "mark", label: "Mark", on: phase === "marking" },
    { key: "reveal", label: "Reveal", on: false },
    { key: "leaderboard", label: "Leaderboard", on: phase === "leaderboard" },
  ];
  if (phase === "reveal") after.splice(0, 2);
  const pastMarking = phase === "reveal" || phase === "leaderboard" || phase === "halftime";
  for (const s of after) out.push({ key: s.key, label: s.label, state: s.on ? "now" : pastMarking && s.key === "mark" ? "done" : "todo" });
  if (round && round.isHalftimeRound) out.push({ key: "halftime", label: "Halftime", state: phase === "halftime" ? "now" : "todo" });
  return out;
}

/**
 * Where the night is on the header's step line Lobby · Ask · Lock · Reveal · Table:
 * 0 to 4, or -1 when no night is open.
 * @param {HostView | null} view
 */
export function phaseSteps(view) {
  if (!view || !view.night) return -1;
  switch (view.phase) {
    case "lobby": return 0;
    case "round_intro": return 1;
    case "asking": return view.current && view.current.status === "locked" ? 2 : 1;
    case "marking": return 2;
    case "reveal": return 3;
    case "leaderboard": case "halftime": case "ended": return 4;
    case "sudden_death": return view.suddenDeath && view.suddenDeath.status === "revealed" ? 3 : view.suddenDeath && view.suddenDeath.status === "locked" ? 2 : 1;
    default: return -1;
  }
}

/** @param {TimerView} t */
function timerWord(t) {
  if (t.state === "running") return "timer running";
  if (t.state === "paused") return "paused";
  if (t.state === "done") return "locked";
  return "open";
}

/**
 * Title and subtitle for the top bar.
 * @param {HostView | null} view
 * @returns {{ title: string, sub: string }}
 */
export function topTitle(view) {
  if (!view || !view.night) return { title: "Run night", sub: "" };
  const round = view.night.round;
  const head = round ? `Round ${round.index + 1} · ${round.title}` : view.night.quizTitle;
  switch (view.phase) {
    case "lobby": return { title: view.night.quizTitle, sub: "Lobby open" };
    case "round_intro": return { title: head, sub: "Up next" };
    case "asking": {
      const shown = view.round ? view.round.shown : 0;
      return { title: head, sub: shown ? `Question ${shown} of ${round ? round.questionCount : shown}` : "Round started" };
    }
    case "marking": return { title: round ? `Round ${round.index + 1} · Marking` : "Marking", sub: "" };
    case "reveal": return { title: round ? `Round ${round.index + 1} · Reveal` : "Reveal", sub: "" };
    case "leaderboard": return { title: round ? `After round ${round.index + 1}` : "Leaderboard", sub: "Leaderboard" };
    case "halftime": return { title: "Halftime", sub: round ? `After round ${round.index + 1}` : "" };
    case "sudden_death": return { title: "Deadlock", sub: view.suddenDeath ? `Sudden death for ${ordinal(view.suddenDeath.position)} place` : "Sudden death" };
    case "ended": return { title: view.night.quizTitle, sub: "Quiz ended" };
    default: return { title: "Run night", sub: "" };
  }
}

/**
 * A plain sentence about what the display shows now, for the side panel.
 * @param {HostView | null} view
 */
export function displayNow(view) {
  if (!view) return "";
  const l = view.lines;
  const round = view.night && view.night.round;
  switch (view.phase) {
    case "idle": return "The venue's waiting screen.";
    case "lobby": {
      const holding = view.night && view.night.holdingFrom !== null && view.night.holdingFrom !== undefined;
      return `${holding ? "Lobby, then the holding page" : "Lobby"}: join QR code, room code, ${plural(view.teams.length, "team")}.`;
    }
    case "round_intro": return round ? `Round ${round.index + 1}: ${round.title}.` : "The next round.";
    case "asking": {
      const q = view.current;
      if (!q) return l.question || "Round started, no question yet.";
      return `Question ${q.number}${q.status === "locked" ? ", locked" : ""} · ${q.answered} of ${q.of} answered.`;
    }
    case "marking": return l.locked || "The round is in. The quizmaster is marking.";
    case "reveal": return view.reveal ? `Q${view.reveal.question.number} answer: ${view.reveal.answerText} · ${view.reveal.rightCount} right.` : "The answers.";
    case "leaderboard": return l.leaderboard || "The leaderboard.";
    case "halftime": return l.halftime || "Halftime standings.";
    case "sudden_death": {
      const sd = view.suddenDeath;
      if (!sd) return "Deadlock.";
      return sd.status === "waiting" ? "Deadlock: who is in it." : `Deadlock · question ${sd.questionNumber} · ${sd.status === "open" ? "answering" : sd.status}.`;
    }
    case "ended": return view.can["final.show"] ? (l.winner || "The winner.") : "The final standings.";
    default: return "";
  }
}

/**
 * Groups to mark first: pending ones, nearest matches first; then marked ones.
 * @param {AnswerGroup[]} groups
 */
export function sortGroups(groups) {
  const sim = (/** @type {AnswerGroup} */ g) => (g.nearest ? g.nearest.similarity : -1);
  return groups.slice().sort((a, b) => {
    const pa = a.mark === "pending" ? 0 : 1;
    const pb = b.mark === "pending" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return sim(b) - sim(a);
  });
}

/**
 * The question to show first on the marking screen: the first with pending answers, else the first.
 * @param {MarkingQuestion[]} questions
 * @param {string | null} wanted   the id the host picked, if still there
 */
export function pickMarkingQuestion(questions, wanted) {
  if (wanted && questions.some((q) => q.question.id === wanted)) return wanted;
  const pending = questions.find((q) => q.pending > 0);
  const first = pending || questions[0];
  return first ? first.question.id : null;
}

/**
 * Milliseconds left on a timer, given the server time now.
 * @param {TimerView | null | undefined} t
 * @param {number} serverNow
 */
export function timerLeft(t, serverNow) {
  if (!t) return 0;
  if (t.state === "running" && t.locksAt !== null) return Math.max(0, t.locksAt - serverNow);
  if (t.state === "paused" && t.remainingMs !== null) return t.remainingMs;
  if (t.state === "idle") return t.durationMs;
  return 0;
}

/** @param {number} ms */
export function clockText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * @param {number} n
 * @param {string} word
 */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The answer a host reads out, with the accepted alternatives for text.
 * @param {QuestionHost} q
 */
export function acceptedList(q) {
  return q.answer.type === "text" ? q.answer.accepted.slice() : [q.answerText];
}

/**
 * "19:30" for a server time, in the console's own time zone.
 * @param {number | null | undefined} t
 */
export function hhmm(t) {
  if (t === null || t === undefined) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The next time today (or tomorrow, if already past by more than 6 hours) at "HH:MM".
 * Returns null for an empty or bad value.
 * @param {string} value   "19:30"
 * @param {number} now     server time
 */
export function plannedFromInput(value, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < now - 6 * 3600_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Prize rows from the edit form: blank text drops the row (and its picture), places run 1, 2, 3 …
 * @param {{ text: string, image?: string | null }[]} rows
 * @returns {{ place: number, text: string, image?: string }[]}
 */
export function cleanPrizes(rows) {
  return rows
    .map((r) => ({ text: r.text.trim().slice(0, 80), image: r.image || null }))
    .filter((r) => r.text.length > 0)
    .map((r, i) => (r.image ? { place: i + 1, text: r.text, image: r.image } : { place: i + 1, text: r.text }));
}

/**
 * Edit rows from prizes (the venue's defaults or the night's).
 * @param {{ text: string, image?: string }[]} prizes
 * @returns {{ text: string, image: string | null }[]}
 */
export function prizeRowsFrom(prizes) {
  return prizes.map((p) => ({ text: p.text, image: p.image ?? null }));
}

/**
 * Names for a list of team ids, using the teams in the view.
 * @param {HostView} view
 * @param {string[]} ids
 */
export function teamNames(view, ids) {
  const byId = new Map(view.teams.map((t) => [t.id, t.name]));
  return ids.map((id) => byId.get(id) || "A team that left");
}

/**
 * A short plain-English description of an answer value from the history API.
 * @param {unknown} v
 */
export function answerValueText(v) {
  if (v === null || v === undefined) return "no answer";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = /** @type {Record<string, unknown>} */ (v);
    if (typeof o.display === "string") return o.display;
    if (typeof o.text === "string") return o.text;
    if (typeof o.value === "string" || typeof o.value === "number") return String(o.value);
    if (typeof o.option === "number") return String.fromCharCode(65 + o.option);
  }
  return "an answer";
}

/**
 * The movement arrow for a standings row, like the display's: up, down or the same as
 * after the round before. Nothing after the first round.
 * @param {{ position: number, prevPosition?: number | null } | undefined} row
 * @returns {{ text: string, cls: string, label: string }}
 */
export function moveMark(row) {
  if (!row || row.prevPosition === null || row.prevPosition === undefined) return { text: "", cls: "", label: "" };
  const d = row.prevPosition - row.position;
  if (d > 0) return { text: `▲${d}`, cls: "up", label: `Up ${plural(d, "place")}` };
  if (d < 0) return { text: `▼${-d}`, cls: "down", label: `Down ${plural(-d, "place")}` };
  return { text: "–", cls: "same", label: "Same place" };
}

/** The device setting key for "Hide answers on this screen". */
export const HIDE_ANSWERS_KEY = "lockin.host.hideAnswers";

/**
 * How long ago, in words: "just now", "5 minutes ago", "3 hours ago", "2 days ago".
 * @param {number} ms
 */
export function agoText(ms) {
  const mins = Math.floor(Math.max(0, ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * One line per paired display for the console's list (SA-11), numbered in pairing order:
 * "Display 1 · connected now from 203.0.113.7 · paired 2 days ago".
 * @param {{ id: string, pairedAt: number, lastSeenAt: number, connected: boolean, ip: string | null }} d
 * @param {number} index 0-based
 * @param {number} now server time
 */
export function pairedDisplayLine(d, index, now) {
  const where = d.connected ? `connected now${d.ip ? ` from ${d.ip}` : ""}` : `last seen ${agoText(now - d.lastSeenAt)}`;
  return `Display ${index + 1} · ${where} · paired ${agoText(now - d.pairedAt)}`;
}
