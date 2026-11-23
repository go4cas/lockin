// Shared sample data for the view fixtures (TECH-SPEC 13.2).
// Made-up venue and team names only (TECH-SPEC 12.5).

import type { AnswerSpec } from "../../../src/shared/formats.ts";
import type {
  HostTeam, Lines, MarkingQuestion, NightInfo, QuestionHost, QuestionPublic, Standings, SuddenDeathPublic, TeamChip, TimerView,
} from "../../../src/shared/protocol.ts";
import { emptyLines } from "../../../src/shared/protocol.ts";
import type { AnswerGroup } from "../../../src/shared/rules-api.ts";

/** Server time every fixture is written at. The fixture server makes clients' clocks start here. */
export const NOW = Date.UTC(2026, 10, 20, 20, 0, 0);
const MIN = 60_000;

export const VENUE = { name: "The Example Arms", themeVersion: "fixture", teamColours: 8 };

export const TEAM_NAMES = [
  "Quizteama Aguilera", "Les Quizerables", "Agatha Quiztie", "The Quizzly Bears", "Universally Challenged",
  "Tequila Mockingbird", "Quiz Khalifa", "Sherlock Ohms", "The Smartinis", "Pub Fiction",
  "Risky Quizness", "Norfolk in Chance", "E=MC Hammer", "Trivia Newton-John", "The Know-It-Ales",
  "Bohemian Quizody", "Quizzy Rascal", "Victorious Secret", "The Nerdy Birds", "Kings of Leon-ardo",
  "Ctrl Alt Defeat", "The Ale Mary's", "Brew Fighters", "Hoppy Days", "Spice Squirrels",
  "Lord of the Pints", "Bad Answer Bears", "Mean Quizzers", "Dumb and Dumbledore", "The Lager Louts",
];

export const teamId = (i: number) => `t-team${String(i + 1).padStart(4, "0")}`;

export function chips(n: number, jokerAt: number[] = []): TeamChip[] {
  return TEAM_NAMES.slice(0, n).map((name, i) => ({ id: teamId(i), name, colour: (i % 8) + 1, jokerThisRound: jokerAt.includes(i) }));
}

export function hostTeams(n: number, opts: { answered?: number; totals?: boolean; offline?: number[] } = {}): HostTeam[] {
  return chips(n).map((c, i) => ({
    ...c,
    connected: !(opts.offline ?? []).includes(i),
    lastSeenAt: (opts.offline ?? []).includes(i) ? NOW - 3 * MIN : NOW - 2_000,
    jokerRound: i === 1 ? 2 : null,
    answeredCurrent: i < (opts.answered ?? 0),
    total: opts.totals ? Math.max(0, 22 - i * 2) : 0,
  }));
}

export const ROUND_TITLES = ["General knowledge", "Picture round", "Music", "Sport", "Science and nature", "Food and drink"];

export function night(over: Partial<NightInfo> = {}): NightInfo {
  return {
    id: "n-20261120-1930-ab12",
    roomCode: "BKTW",
    joinUrl: "https://quiz.example.com/j/BKTW",
    quizTitle: "Friday classics",
    plannedStart: NOW + 30 * MIN,
    holdingFrom: NOW,
    holdingPanels: ["countdown", "teams", "join", "install", "animation", "prizes"],
    prizes: [{ place: 1, text: "A round of drinks" }, { place: 2, text: "A bowl of chips" }],
    roundCount: 6,
    round: null,
    joker: true,
    lockMode: "question",
    teamCount: 6,
    started: false,
    ...over,
  };
}

export function roundInfo(index: number) {
  return { index, title: ROUND_TITLES[index] ?? "", questionCount: 5, isHalftimeRound: index === 2, isLast: index === 5 };
}

export const timer = {
  idle: (seconds = 60): TimerView => ({ state: "idle", durationMs: seconds * 1000, locksAt: null, remainingMs: null }),
  running: (seconds = 60, left = 42): TimerView => ({ state: "running", durationMs: seconds * 1000, locksAt: NOW + left * 1000, remainingMs: null }),
  paused: (seconds = 60, left = 30): TimerView => ({ state: "paused", durationMs: seconds * 1000, locksAt: null, remainingMs: left * 1000 }),
  done: (seconds = 60): TimerView => ({ state: "done", durationMs: seconds * 1000, locksAt: NOW - 1000, remainingMs: null }),
};

interface SampleQuestion { text: string; input: QuestionPublic["input"]; answer: AnswerSpec; answerText: string; note?: string; image?: boolean }

/** Round 3 (index 2), "Music": one question of each input type. */
export const SAMPLE: SampleQuestion[] = [
  { text: "Which band released the album 'Rumours' in 1977?", input: { type: "text" }, answer: { type: "text", accepted: ["Fleetwood Mac"] }, answerText: "Fleetwood Mac", note: "Accept 'The Mac'." },
  { text: "Who sang 'Respect' in 1967?", input: { type: "choice", options: ["Aretha Franklin", "Diana Ross", "Tina Turner", "Etta James"] }, answer: { type: "choice", options: ["Aretha Franklin", "Diana Ross", "Tina Turner", "Etta James"], correct: 0 }, answerText: "A. Aretha Franklin" },
  { text: "How many strings does a standard bass guitar have?", input: { type: "number" }, answer: { type: "number", value: 4 }, answerText: "4" },
  { text: "Name this album cover.", input: { type: "text" }, answer: { type: "text", accepted: ["Abbey Road"] }, answerText: "Abbey Road", image: true },
  { text: "In what year did Live Aid take place?", input: { type: "datetime", precision: "year" }, answer: { type: "datetime", precision: "year", value: "1985", scoring: "exact" }, answerText: "1985" },
];

export const questionId = (round: number, n: number) => `q-r${round}n${n}abcde`.slice(0, 10);

export function question(n: number, over: Partial<QuestionPublic> = {}, round = 2): QuestionPublic {
  const q = SAMPLE[(n - 1) % SAMPLE.length]!;
  const id = questionId(round, n);
  return {
    id, roundIndex: round, number: n, text: q.text, image: q.image ? `/media/q/${id}` : null, input: q.input,
    status: "open", timer: timer.running(), answered: 4, of: 6, ...over,
  };
}

export function questionHost(n: number, over: Partial<QuestionPublic> = {}, round = 2): QuestionHost {
  const q = SAMPLE[(n - 1) % SAMPLE.length]!;
  return { ...question(n, over, round), answer: q.answer, note: q.note ?? null, answerText: q.answerText };
}

export function lines(over: Partial<Lines> = {}): Lines {
  return { ...emptyLines(), ...over };
}

/** Standings after `round` for `n` teams, with a shared position and a tie broken by round wins. */
export function standings(n: number, round = 2, jokerAt: number[] = [1]): Standings {
  const totals = TEAM_NAMES.slice(0, n).map((_, i) => Math.max(0, 40 - i - (i > 4 ? 2 : 0) + (i === 3 ? 1 : 0)));
  // Make teams 3 and 4 level on points (the tie breaker decides), and 7 and 8 share a place.
  if (n > 4) totals[4] = totals[3]!;
  if (n > 8) totals[8] = totals[7]!;
  const roundWins = totals.map((_, i) => (i === 3 ? 2 : i === 4 ? 1 : 0));
  const rows = totals.map((total, i) => ({ i, total, wins: roundWins[i]! }));
  rows.sort((a, b) => b.total - a.total || b.wins - a.wins);
  return {
    round,
    rows: rows.map((r) => {
      const firstSame = rows.findIndex((x) => x.total === r.total && x.wins === r.wins);
      const sameTotal = rows.filter((x) => x.total === r.total).length > 1;
      const shared = rows.filter((x) => x.total === r.total && x.wins === r.wins).length > 1;
      const roundScores = Array.from({ length: round + 1 }, (_, j) => (j === round ? Math.min(5, Math.round(r.total / (round + 1))) : Math.floor(r.total / (round + 1))));
      return {
        teamId: teamId(r.i), position: firstSame + 1, shared, total: r.total, roundScores, roundWins: r.wins,
        decidedBy: shared ? "shared" as const : sameTotal ? "tie_breaker" as const : "points" as const,
        name: TEAM_NAMES[r.i]!, colour: (r.i % 8) + 1, roundScore: roundScores[round]!, jokerThisRound: jokerAt.includes(r.i),
      };
    }),
  };
}

export function textGroups(): AnswerGroup[] {
  return [
    { key: "fleetwood mac", display: "Fleetwood Mac", teamIds: [teamId(0), teamId(2), teamId(3)], mark: "correct", nearest: { accepted: "Fleetwood Mac", similarity: 1 } },
    { key: "fleetwod mac", display: "fleetwod mac", teamIds: [teamId(1)], mark: "pending", nearest: { accepted: "Fleetwood Mac", similarity: 0.92 } },
    { key: "mac", display: "The Mac", teamIds: [teamId(4)], mark: "pending", nearest: { accepted: "Fleetwood Mac", similarity: 0.23 } },
  ];
}

export function marking(n: number, locked: number): MarkingQuestion[] {
  return Array.from({ length: locked }, (_, k) => {
    const q = questionHost(k + 1, { status: "locked", timer: timer.done(), answered: n - 1, of: n });
    const text = q.input.type === "text" && k === 0;
    const groups: AnswerGroup[] = text ? textGroups() : [
      { key: "a", display: q.answerText, teamIds: chips(n).slice(0, 3).map((c) => c.id), mark: "correct", nearest: null },
      { key: "b", display: "something else", teamIds: chips(n).slice(3, n - 1).map((c) => c.id), mark: "wrong", nearest: null },
    ];
    return { question: q, groups, noAnswer: [teamId(n - 1)], pending: text ? 2 : 0 };
  });
}

export function suddenDeath(status: SuddenDeathPublic["status"], over: Partial<SuddenDeathPublic> = {}): SuddenDeathPublic {
  const tied = chips(3);
  const id = "q-sd000001";
  return {
    position: 1,
    teams: tied,
    out: [],
    questionNumber: 1,
    maxQuestions: 3,
    question: status === "waiting" ? null : {
      id, roundIndex: -1, number: 1, text: "How many pints are in a gallon?", image: null, input: { type: "number" },
      status: status === "open" ? "open" : "locked", timer: status === "open" ? timer.running(30, 18) : timer.done(30), answered: 2, of: 3,
    },
    status,
    rightIds: status === "revealed" ? [teamId(1)] : null,
    outcome: status === "revealed" ? { position: 1, teamIds: [teamId(1)], result: "won" } : null,
    ...over,
  };
}

/** Empty TV fields; a fixture spreads this and sets what its phase shows. */
export function tvBase() {
  return { role: "tv" as const, teams: [] as TeamChip[], question: null, lockedMoment: null, reveal: null, standings: null, suddenDeath: null, final: null };
}

/** Empty team fields; a fixture spreads this and sets what its phase shows. */
export function teamBase() {
  return { role: "team" as const, teams: [] as TeamChip[], questions: [] as QuestionPublic[], answers: [], standings: null, suddenDeath: null };
}

/** Empty host fields; a fixture spreads this and sets what its phase shows. */
export function hostBase() {
  return {
    role: "host" as const, teams: [] as HostTeam[], round: null, current: null, marking: null, reveal: null, standings: null,
    suddenDeath: null, suddenDeathNeeded: null, can: {}, lines: lines(),
  };
}

/** The whole of round 3 for the host's script, `shown` questions in. */
export function hostRound(shown: number, over: Partial<QuestionPublic> = {}) {
  return { questions: [1, 2, 3, 4, 5].map((n) => questionHost(n, n <= shown ? over : { status: "open", timer: timer.idle(), answered: 0 })), shown };
}
