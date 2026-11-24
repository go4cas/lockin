// Views for each role (TECH-SPEC 10.3). The display view never carries
// answers or marks before reveal; a team view carries only that team's answers.

import type {
  Common, DisplayView, Flash, HostTeam, HostView, Lines, MarkingQuestion, NightInfo, QuestionHost, QuestionPublic,
  RevealItem, Role, RoundInfo, Standings, SuddenDeathPublic, TeamAnswer, TeamChip, TeamView, TimerView, View,
} from "../../shared/protocol.ts";
import type { AnswerGroup, StandingRow } from "../../shared/rules-api.ts";
import { FLASH_MS, TEAM_COLOURS, type Engine } from "./engine.ts";
import { answerText, halftimeRound, inputOf, timerSecondsOf, valueKey, valueText } from "./quiz.ts";
import { LINE_SLOTS } from "./state.ts";

function common(e: Engine): Omit<Common, "flash"> {
  const v = e.venue();
  return { phase: e.m ? e.state.phase : "idle", venue: { name: v.name, themeVersion: v.themeVersion, teamColours: TEAM_COLOURS }, night: nightInfo(e) };
}

function roundInfo(e: Engine, r: number): RoundInfo {
  const round = e.quiz.rounds[r]!;
  return {
    index: r, title: round.title, questionCount: round.questions.length,
    isHalftimeRound: halftimeRound(e.quiz) === r, isLast: e.isLastRound(r),
  };
}

function nightInfo(e: Engine): NightInfo | null {
  if (!e.m) return null;
  const n = e.m.night;
  const s = e.state;
  const venue = e.venue().venue;
  return {
    id: n.id,
    roomCode: n.roomCode,
    joinUrl: `${e.publicUrl}/j/${n.roomCode}`,
    quizTitle: n.quizTitle,
    plannedStart: n.plannedStart,
    holdingFrom: n.plannedStart === null ? null : n.plannedStart - venue.holding.minutesBefore * 60_000,
    holdingPanels: venue.holding.panels,
    prizes: n.prizes,
    roundCount: n.quiz.rounds.length,
    round: s.phase === "lobby" || s.phase === "ended" ? null : roundInfo(e, Math.min(s.round, n.quiz.rounds.length - 1)),
    joker: n.quiz.settings.joker,
    lockMode: n.quiz.settings.lockMode,
    teamCount: e.teams().length,
    started: n.startedAt !== null,
  };
}

function lines(e: Engine): Lines {
  const out = {} as Lines;
  for (const k of LINE_SLOTS) out[k] = e.m ? e.state.lines[k] ?? null : null;
  return out;
}

const fresh = (e: Engine, f: Flash | null | undefined): Flash | null => (f && e.now() - f.at < FLASH_MS ? f : null);

function chip(e: Engine, teamId: string): TeamChip {
  const t = e.m!.teams.get(teamId)!;
  return { id: t.id, name: t.name, colour: t.colour, jokerThisRound: t.jokerRound !== null && t.jokerRound === e.state.round };
}

function chips(e: Engine): TeamChip[] {
  return e.teams().map((t) => chip(e, t.id));
}

function timerView(e: Engine, qid: string): TimerView {
  const s = e.state;
  const qs = s.questions[qid];
  const ref = e.qIndex.get(qid)!;
  const perRound = e.quiz.settings.lockMode === "round" && ref.round !== -1;
  const isCurrent = perRound ? ref.round === s.round : e.currentQuestionId() === qid;
  if (isCurrent && (s.phase === "asking" || s.phase === "sudden_death")) {
    const t = s.timer;
    return { state: t.state, durationMs: t.durationMs, locksAt: t.locksAt, remainingMs: t.remainingMs };
  }
  const durationMs = (perRound ? e.quiz.settings.timerSeconds : timerSecondsOf(e.quiz, ref.q)) * 1000;
  if (qs?.status === "locked") return { state: "done", durationMs, locksAt: qs.lockedAt ?? null, remainingMs: null };
  return { state: "idle", durationMs, locksAt: null, remainingMs: null };
}

function answeredCount(e: Engine, qid: string): number {
  return e.participants(qid).filter((t) => !!e.answer(t, qid)?.value).length;
}

function questionPublic(e: Engine, qid: string): QuestionPublic {
  const ref = e.qIndex.get(qid)!;
  const q = ref.q;
  const sdNumber = ref.round === -1 ? e.state.sd?.asked ?? ref.index + 1 : ref.index + 1;
  return {
    id: q.id,
    roundIndex: ref.round,
    number: ref.round === -1 ? sdNumber : ref.index + 1,
    text: q.text,
    image: q.media?.kind === "image" ? `/media/q/${q.id}` : null,
    input: inputOf(q.answer),
    status: e.state.questions[qid]?.status === "locked" ? "locked" : "open",
    timer: timerView(e, qid),
    answered: answeredCount(e, qid),
    of: e.participants(qid).length,
  };
}

function questionHost(e: Engine, qid: string): QuestionHost {
  const q = e.qIndex.get(qid)!.q;
  return { ...questionPublic(e, qid), answer: structuredClone(q.answer), note: q.note ?? null, answerText: answerText(q.answer) };
}

/** Questions shown this round (asking), in order. */
function shownIds(e: Engine): string[] {
  return e.roundQuestions().slice(0, e.state.shown).map((q) => q.id);
}

function markingQuestion(e: Engine, qid: string): MarkingQuestion {
  const rules = e.rulesOrThrow();
  const spec = e.qIndex.get(qid)!.q.answer;
  const teamIds = e.participants(qid);
  const answered = teamIds.map((t) => e.answer(t, qid)).filter((a) => !!a?.value)
    .sort((a, b) => (a!.receivedAt ?? 0) - (b!.receivedAt ?? 0));
  let groups: AnswerGroup[];
  if (spec.type === "text") {
    groups = rules.groupText(spec, answered.map((a) => ({ teamId: a!.teamId, text: (a!.value as { text: string }).text, mark: a!.mark })));
  } else {
    const byKey = new Map<string, AnswerGroup>();
    for (const a of answered) {
      const key = valueKey(a!.value!);
      const g = byKey.get(key);
      if (g) {
        g.teamIds.push(a!.teamId);
        if (g.mark !== a!.mark) g.mark = "pending";
      } else byKey.set(key, { key, display: valueText(a!.value!, spec), teamIds: [a!.teamId], mark: a!.mark, nearest: null });
    }
    groups = [...byKey.values()];
  }
  const noAnswer = teamIds.filter((t) => !e.answer(t, qid)?.value);
  const pending = teamIds.filter((t) => (e.answer(t, qid)?.mark ?? "pending") === "pending").length;
  return { question: questionHost(e, qid), groups, noAnswer, pending };
}

function rightCount(e: Engine, qid: string): number {
  return e.participants(qid).filter((t) => e.answer(t, qid)?.mark === "correct").length;
}

function revealItem(e: Engine): RevealItem | null {
  if (e.state.phase !== "reveal") return null;
  const q = e.roundQuestions()[e.state.revealIndex];
  if (!q) return null;
  return { question: questionPublic(e, q.id), answerText: answerText(q.answer), rightCount: rightCount(e, q.id) };
}

function standingsFor(e: Engine, upTo: number): Standings | null {
  if (!e.rules()) return null;
  const rows: StandingRow[] = e.standingsRows(upTo);
  // Movement (T-09 arrows): positions after the round before, without sudden death.
  const prev = new Map<string, number>();
  if (upTo > 0) for (const r of e.standingsRows(upTo - 1, false)) prev.set(r.teamId, r.position);
  return {
    round: upTo,
    rows: rows.map((r) => {
      const t = e.m!.teams.get(r.teamId)!;
      return { ...r, name: t.name, colour: t.colour, roundScore: r.roundScores[upTo] ?? 0, jokerThisRound: t.jokerRound === upTo, prevPosition: prev.get(r.teamId) ?? null };
    }),
  };
}

/** Standings the room sees: leaderboard, halftime and ended only. */
function publicStandings(e: Engine): Standings | null {
  const p = e.state.phase;
  if (p !== "leaderboard" && p !== "halftime" && p !== "ended") return null;
  return standingsFor(e, Math.min(e.state.round, e.quiz.rounds.length - 1));
}

function suddenDeath(e: Engine): SuddenDeathPublic | null {
  const sd = e.state.sd;
  if (!sd || e.state.phase !== "sudden_death") return null;
  const rows = e.m!.sd.filter((r) => r.position === sd.position);
  const first = rows[0]?.teamIds ?? sd.teamIds;
  const cur = sd.current;
  const row = cur ? rows.find((r) => r.questionId === cur.questionId) : undefined;
  const decided = sd.decided.find((x) => x.position === sd.position);
  return {
    position: sd.position,
    teams: sd.teamIds.map((t) => chip(e, t)),
    out: first.filter((t) => !sd.teamIds.includes(t)).map((t) => chip(e, t)),
    questionNumber: Math.max(1, cur && (cur.status !== "revealed" || decided) ? sd.asked : sd.asked + 1),
    maxQuestions: e.quiz.settings.suddenDeathMax,
    question: cur ? questionPublic(e, cur.questionId) : null,
    status: cur ? cur.status : "waiting",
    rightIds: cur?.status === "revealed" ? row?.rightIds ?? [] : null,
    outcome: decided ? { position: decided.position, teamIds: decided.teamIds, result: decided.outcome } : null,
  };
}

// --- per role -------------------------------------------------------------------

export function displayView(e: Engine): DisplayView {
  const base = { ...common(e), flash: null, role: "display" as const };
  if (!e.m) {
    return { ...base, teams: [], question: null, lockedMoment: null, reveal: null, standings: null, suddenDeath: null, final: null, lines: lines(e) };
  }
  const s = e.state;
  const cur = s.phase === "asking" ? e.currentQuestionId() : null;
  const flash = fresh(e, s.flash);
  return {
    ...base,
    flash: flash && flash.key !== "no_answer" ? flash : null,
    teams: chips(e),
    question: cur ? questionPublic(e, cur) : null,
    lockedMoment: lockedMoment(e),
    reveal: revealItem(e),
    standings: publicStandings(e),
    suddenDeath: suddenDeath(e),
    final: finalOf(e),
    lines: lines(e),
  };
}

function lockedMoment(e: Engine): { at: number; all: boolean } | null {
  const s = e.state;
  if (s.phase !== "asking") return null;
  let ids: string[];
  if (e.quiz.settings.lockMode === "round") {
    const qs = e.roundQuestions();
    if (s.shown < qs.length || !qs.every((q) => s.questions[q.id]?.status === "locked")) return null;
    ids = qs.map((q) => q.id);
  } else {
    const cur = e.currentQuestionId();
    if (!cur || s.questions[cur]?.status !== "locked") return null;
    ids = [cur];
  }
  const at = Math.max(...ids.map((id) => s.questions[id]?.lockedAt ?? 0));
  const all = ids.every((id) => answeredCount(e, id) === e.participants(id).length);
  return { at, all };
}

function finalOf(e: Engine): DisplayView["final"] {
  if (e.state.phase !== "ended" || !e.rules()) return null;
  const st = publicStandings(e);
  if (!st) return null;
  const winners = st.rows.filter((r) => r.position === 1).map((r) => chip(e, r.teamId));
  const lastPos = Math.max(0, ...st.rows.map((r) => r.position));
  const lastPlace = lastPos > 1 ? st.rows.filter((r) => r.position === lastPos).map((r) => chip(e, r.teamId)) : [];
  return { winners, lastPlace, standingsAt: e.state.finalStandingsAt ?? null };
}

export function teamView(e: Engine, teamId: string | null): TeamView {
  const base = { ...common(e), role: "team" as const };
  const team = e.m && teamId ? e.m.teams.get(teamId) : undefined;
  if (!e.m) {
    return { ...base, flash: null, self: null, teams: [], questions: [], answers: [], standings: null, suddenDeath: null, lines: lines(e) };
  }
  const s = e.state;
  const active = team && team.removedAt === null ? team : undefined;
  let questions: QuestionPublic[] = [];
  if (s.phase === "asking") {
    const ids = e.quiz.settings.lockMode === "round" ? shownIds(e) : [e.currentQuestionId()].filter((x): x is string => !!x);
    questions = ids.map((id) => questionPublic(e, id));
  }
  const sdv = suddenDeath(e);
  const answerIds = [...questions.map((q) => q.id), ...(sdv?.question ? [sdv.question.id] : [])];
  const answers: TeamAnswer[] = [];
  if (active) {
    for (const qid of answerIds) {
      const a = e.answer(active.id, qid);
      if (a?.value) answers.push({ questionId: qid, value: a.value, receivedAt: a.receivedAt ?? 0, counted: true });
    }
  }
  const shared = fresh(e, s.flash);
  const own = active ? fresh(e, e.teamFlash.get(active.id)) : null;
  const flash = own && (!shared || own.id > shared.id) ? own : shared && shared.key !== "no_answer" ? shared : null;
  const up = e.upcomingRound();
  return {
    ...base,
    flash,
    self: active ? {
      id: active.id, name: active.name, colour: active.colour, rejoinCode: active.rejoinCode, jokerRound: active.jokerRound,
      jokerAvailable: e.quiz.settings.joker && active.jokerRound === null && up !== null,
      inSuddenDeath: !!s.sd && s.phase === "sudden_death" && s.sd.teamIds.includes(active.id),
    } : null,
    teams: s.phase === "lobby" ? chips(e) : [],
    questions,
    answers,
    standings: publicStandings(e),
    suddenDeath: sdv,
    lines: lines(e),
  };
}

export function hostView(e: Engine): HostView {
  const base = { ...common(e), role: "host" as const };
  if (!e.m) {
    return {
      ...base, flash: null, teams: [], round: null, current: null, marking: null, reveal: null, standings: null,
      suddenDeath: null, suddenDeathNeeded: null, finalStandingsAt: null, can: e.can(), lines: lines(e),
    };
  }
  const s = e.state;
  const started = e.m.night.startedAt !== null;
  const hasRules = !!e.rules();
  const live = started && hasRules ? standingsFor(e, Math.min(s.round, e.quiz.rounds.length - 1)) : null;
  const totals = new Map(live?.rows.map((r) => [r.teamId, r.total]) ?? []);
  const cur = e.currentQuestionId();
  const teams: HostTeam[] = e.teams().map((t) => {
    const p = e.presence(t.id);
    return {
      ...chip(e, t.id), connected: p.connected, lastSeenAt: p.lastSeenAt, jokerRound: t.jokerRound,
      answeredCurrent: !!cur && !!e.answer(t.id, cur)?.value, total: totals.get(t.id) ?? 0,
    };
  });
  const inRound = s.phase !== "lobby" && s.phase !== "ended" && s.phase !== "sudden_death";
  const roundQs = inRound ? e.roundQuestions().map((q) => questionHost(e, q.id)) : null;
  let marking: HostView["marking"] = null;
  if ((s.phase === "asking" || s.phase === "marking") && hasRules) {
    const locked = e.roundQuestions().filter((q) => s.questions[q.id]?.status === "locked").map((q) => markingQuestion(e, q.id));
    marking = { questions: locked, pendingTotal: locked.reduce((n, q) => n + q.pending, 0) };
  }
  const sdv = suddenDeath(e);
  const sdCur = s.sd?.current;
  const flash = fresh(e, s.flash);
  let needed: HostView["suddenDeathNeeded"] = null;
  if (hasRules && ((s.phase === "leaderboard" && e.isLastRound()) || s.phase === "sudden_death")) needed = e.sdNeeded();
  return {
    ...base,
    flash: flash && flash.key !== "no_answer" ? flash : null,
    teams,
    round: roundQs ? { questions: roundQs, shown: s.shown } : null,
    current: s.phase === "asking" && cur ? questionHost(e, cur) : null,
    marking,
    reveal: revealItem(e),
    standings: live,
    suddenDeath: sdv ? {
      ...sdv,
      questionHost: sdCur ? questionHost(e, sdCur.questionId) : null,
      marking: sdCur && s.questions[sdCur.questionId]?.status === "locked" && hasRules ? markingQuestion(e, sdCur.questionId) : null,
    } : null,
    suddenDeathNeeded: needed,
    finalStandingsAt: s.phase === "ended" ? s.finalStandingsAt ?? null : null,
    can: e.can(),
    lines: lines(e),
  };
}

export function viewFor(e: Engine, role: Role, teamId: string | null): View {
  if (role === "host") return hostView(e);
  if (role === "team") return teamView(e, teamId);
  return displayView(e);
}
