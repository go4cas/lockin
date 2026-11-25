// The shape of a night (TECH-SPEC 7.1, 7.2, S-08): opening and closing it, rounds and
// questions, reveal, leaderboard, halftime and Quiz End. Split from the engine (code review
// LI-016); each function is one host command run inside the engine's unit of work.

import type { Prize } from "../../shared/formats.ts";
import { randomCode } from "../auth.ts";
import type { CommandResult } from "../ws.ts";
import { halftimeRound, joinNames, timerSecondsOf } from "./quiz.ts";
import { idleTimer, initialState } from "./state.ts";
import { JOIN_KEY_LENGTH, randomId, roomCode } from "./teams.ts";
import { lockOpen } from "./timer.ts";
import { fail, isInt, isObj, len, OK, type NightReader, type Vars, type Work } from "./work.ts";

export const LOBBY_LINE_MS = 45_000;

function parsePrizes(v: unknown): Prize[] | null {
  if (!Array.isArray(v) || v.length > 30) return null;
  const out: Prize[] = [];
  for (const p of v) {
    if (!isObj(p) || !isInt(p.place) || p.place < 1 || p.place > 100) return null;
    if (typeof p.text !== "string" || p.text.trim() === "" || len(p.text) > 80) return null;
    out.push({ place: p.place, text: p.text.trim() });
  }
  return out;
}

function parsePlannedStart(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  return undefined;
}

// --- the night --------------------------------------------------------------------------------

/** night.open runs with no night open yet: `w.m` and `w.s` are not there until openNight(). */
export function nightOpen(w: Work, a: Record<string, unknown>): CommandResult {
  if (typeof a.quizId !== "string") return fail("bad_args");
  let plannedStart: number | null = null;
  if (a.plannedStart !== undefined) {
    const ps = parsePlannedStart(a.plannedStart);
    if (ps === undefined) return fail("bad_args");
    plannedStart = ps;
  }
  let prizes = w.venue().venue.prizes;
  if (a.prizes !== undefined) {
    const p = parsePrizes(a.prizes);
    if (!p) return fail("bad_args", "Each prize needs a place and 1 to 80 characters of text.");
    prizes = p;
  }
  const load = w.sources.loadQuiz(a.quizId);
  if (!load.ok) {
    if (load.code === "not_found") return fail("not_found", "That quiz could not be found.");
    const first = load.problems[0]?.message;
    return fail("quiz_not_ready", first ? `That quiz isn't ready yet: ${first}` : undefined);
  }
  const now = w.now();
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `n-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}-${randomId(4)}`;
  const code = roomCode();
  const state = initialState();
  state.joinKey = randomCode(JOIN_KEY_LENGTH);
  w.guard.resetJoins();
  w.openNight({
    night: {
      id, quizId: load.quiz.id, quizTitle: load.quiz.title, quiz: load.quiz, roomCode: code, status: "open", openedAt: now,
      plannedStart, startedAt: null, endedAt: null, endReason: null, prizes,
    },
    teams: new Map(), answers: new Map(), sd: [], state,
  });
  w.dirty.nightNew = true;
  w.setPhase("lobby");
  w.setLine("lobby", "lobby", { n: 0 });
  w.setLobbyLineAt(now + LOBBY_LINE_MS);
  return { ok: true, result: { nightId: id, roomCode: code } };
}

export function nightUpdate(w: Work, a: Record<string, unknown>): CommandResult {
  const n = w.m.night;
  if (a.plannedStart !== undefined) {
    const ps = parsePlannedStart(a.plannedStart);
    if (ps === undefined) return fail("bad_args");
    n.plannedStart = ps;
  }
  if (a.prizes !== undefined) {
    const p = parsePrizes(a.prizes);
    if (!p) return fail("bad_args", "Each prize needs a place and 1 to 80 characters of text.");
    n.prizes = p;
  }
  w.dirty.night = true;
  return OK;
}

export function nightClose(w: Work): CommandResult {
  const n = w.m.night;
  if (w.s.phase === "lobby") {
    n.status = "ended";
    n.endReason = "early";
    n.endedAt = w.now();
  }
  w.dirty.night = true;
  for (const t of w.read.teams()) w.bye({ teamId: t.id, reason: "night_closed" });
  w.closeNight();
  return OK;
}

export function quizStart(w: Work): CommandResult {
  w.m.night.startedAt = w.now();
  w.dirty.night = true;
  enterRoundIntro(w, 0);
  return OK;
}

function enterRoundIntro(w: Work, r: number): void {
  const s = w.s;
  s.round = r;
  s.shown = 0;
  s.revealIndex = 0;
  s.timer = idleTimer();
  w.setPhase("round_intro");
  const line = w.pick("round_start", { round: r + 1 });
  s.lines.round = line;
  s.lines.question = line;
}

// --- rounds and questions ----------------------------------------------------------------------

export function roundStart(w: Work): CommandResult {
  const s = w.s;
  for (const q of w.read.roundQuestions()) s.questions[q.id] = { status: "hidden" };
  s.shown = 0;
  s.timer = w.quiz.settings.lockMode === "round" ? idleTimer(w.quiz.settings.timerSeconds * 1000) : idleTimer();
  w.setPhase("asking");
  return OK;
}

export function questionNext(w: Work): CommandResult {
  const s = w.s;
  const q = w.read.roundQuestions()[s.shown]!;
  s.shown++;
  s.questions[q.id] = { status: "open", openedAt: w.now() };
  s.lines.locked = null;
  if (w.quiz.settings.lockMode === "question") {
    s.timer = idleTimer(timerSecondsOf(w.quiz, q) * 1000);
    s.lines.question = null;
  } else if (s.shown === 1) {
    s.lines.question = null;
  }
  s.lines.round = null;
  return OK;
}

export function roundFinish(w: Work): CommandResult {
  w.setPhase("marking");
  return OK;
}

// --- reveal, leaderboard, halftime -------------------------------------------------------------

export function revealStart(w: Work): CommandResult {
  w.s.revealIndex = 0;
  w.setPhase("reveal");
  w.setLine("reveal", "reveal");
  return OK;
}

export function revealNext(w: Work): CommandResult {
  const s = w.s;
  if (s.revealIndex + 1 >= w.read.roundQuestions().length) showLeaderboard(w);
  else s.revealIndex++;
  return OK;
}

export function leaderboardShow(w: Work): CommandResult {
  showLeaderboard(w);
  return OK;
}

function showLeaderboard(w: Work): void {
  w.setPhase("leaderboard");
  const r = w.s.round;
  const after = w.read.standingsRows(r, false);
  const before = r > 0 ? w.read.standingsRows(r - 1, false) : null;
  const key = w.rules.leaderboardLine(before, after);
  if (!key) return;
  const name = (id: string) => w.m.teams.get(id)?.name ?? "";
  const leaders = after.filter((x) => x.position === 1).map((x) => name(x.teamId));
  let vars: Vars = {};
  if (key === "lead_change" || key === "tie_breaker") vars = { team: joinNames(leaders) };
  if (key === "big_climb" && before) {
    let best: { team: string; n: number } | null = null;
    for (const row of after) {
      const prev = before.find((b) => b.teamId === row.teamId);
      if (!prev) continue;
      const climb = prev.position - row.position;
      if (!best || climb > best.n) best = { team: name(row.teamId), n: climb };
    }
    if (best) vars = { team: best.team, n: best.n };
  }
  // Several joint leaders: lead_change lines are singular ("{team} takes the top spot"), so a
  // shared lead uses lines written for a list of names (UI-09), as winner_shared does.
  w.setLine("leaderboard", key === "lead_change" && leaders.length > 1 ? "lead_change_shared" : key, vars);
}

export function roundNext(w: Work): CommandResult {
  const s = w.s;
  if (s.phase === "leaderboard" && halftimeRound(w.quiz) === s.round && !s.halftimeShown) {
    s.halftimeShown = true;
    w.setPhase("halftime");
    w.setLine("halftime", "halftime");
    return OK;
  }
  enterRoundIntro(w, s.round + 1);
  return OK;
}

// --- Quiz End (S-08) ---------------------------------------------------------------------------

/** True when Quiz End would be a normal finish (not early). */
export function naturalEnd(r: NightReader): boolean {
  if (!r.m) return false;
  const s = r.state;
  if (s.phase === "leaderboard" && r.isLastRound()) return true;
  if (s.phase === "sudden_death" && (!s.sd?.current || s.sd.current.status === "revealed")) return true;
  return false;
}

export function quizEnd(w: Work, a: Record<string, unknown>): CommandResult {
  const early = a.early === true;
  if (!naturalEnd(w.read) && !early) return fail("wrong_phase", "The quiz isn't finished. End it early instead?");
  const s = w.s;
  if (Object.values(s.questions).some((q) => q.status === "open")) lockOpen(w, w.now());
  s.timer = idleTimer();
  const n = w.m.night;
  const last = Math.min(Math.max(s.round, 0), w.quiz.rounds.length - 1);
  const rows = w.read.standingsRows(early ? last : w.quiz.rounds.length - 1);
  n.status = "ended";
  n.endedAt = w.now();
  n.endReason = naturalEnd(w.read) ? "finished" : "early";
  w.dirty.night = true;
  w.dirty.results = rows;
  w.setPhase("ended");
  const after = w.venue().venue.afterWinner;
  s.finalStandingsAt = after.mode === "host" ? null : n.endedAt + after.seconds * 1000;
  const name = (id: string) => w.m.teams.get(id)?.name ?? "";
  const winners = rows.filter((r) => r.position === 1).map((r) => name(r.teamId));
  if (winners.length > 1) w.setLine("winner", "winner_shared", { team: joinNames(winners), n: winners.length });
  else if (winners.length === 1) w.setLine("winner", "winner", { team: winners[0] });
  const lastPos = Math.max(0, ...rows.map((r) => r.position));
  if (lastPos > 1) {
    const losers = rows.filter((r) => r.position === lastPos).map((r) => name(r.teamId));
    w.setLine("lastPlace", "last_place", { team: joinNames(losers), n: losers.length });
  }
  w.setLine("goodbye", "goodbye");
  return OK;
}

export function finalShow(w: Work): CommandResult {
  w.s.finalStandingsAt = w.now();
  return OK;
}
