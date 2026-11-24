// Fakes for the engine tests (TECH-SPEC 13.1): Rules (B2) and CopyPicker (B4)
// stand-ins, a fake clock with a scheduler, and helpers to build an engine on
// a temporary data folder and database.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnswerSpec, Question, QuizFile, QuizSettings } from "../../src/shared/formats.ts";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT } from "../../src/shared/formats.ts";
import type {
  AnswerGroup, AnswerValue, CopyPicker, Mark, Rules, ScoreInput, ScoreResult, StandingRow, SuddenDeathOutcome,
} from "../../src/shared/rules-api.ts";
import { openDb } from "../../src/server/db.ts";
import { Engine, type Actor } from "../../src/server/night/engine.ts";
import { ClockScheduler } from "../../src/server/night/scheduler.ts";
import { fileSources } from "../../src/server/night/sources.ts";
import { FakeClock } from "../helpers/fake-clock.ts";

// --- Rules: a small, literal implementation of TECH-SPEC 8 -------------------------

function normalise(text: string): string {
  let s = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, "and");
  s = s.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return s.replace(/^(the|a|an) /, "");
}

function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}

function similarity(x: string, y: string): number {
  const a = normalise(x), b = normalise(y);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - osa(a, b) / max;
}

function numOf(spec: AnswerSpec, v: AnswerValue): number | null {
  if (v.type === "number") return v.value;
  if (v.type === "datetime" && spec.type === "datetime") {
    if (spec.precision === "year") return Number(v.value);
    if (spec.precision === "time") { const [h, m] = v.value.split(":").map(Number); return h! * 60 + m!; }
    return Date.parse(v.value) / 86_400_000;
  }
  return null;
}

export const fakeRules: Rules = {
  normalise,
  similarity,
  autoMark(spec, value) {
    switch (spec.type) {
      case "text": {
        if (value.type !== "text") return "wrong";
        const n = normalise(value.text);
        return n !== "" && spec.accepted.some((a) => normalise(a) === n) ? "correct" : "pending";
      }
      case "choice": return value.type === "choice" && value.index === spec.correct ? "correct" : "wrong";
      case "number": return value.type === "number" && Math.abs(value.value - spec.value) < 1e-9 ? "correct" : "wrong";
      case "closest": return "pending";
      case "datetime":
        if (spec.scoring === "closest") return "pending";
        return value.type === "datetime" && value.value === spec.value ? "correct" : "wrong";
    }
  },
  markClosest(spec, values, scoring) {
    const target = spec.type === "closest" ? spec.value : spec.type === "datetime" ? numOf(spec, { type: "datetime", value: spec.value })! : 0;
    const range = spec.type === "closest" || spec.type === "datetime" ? spec.range ?? 0 : 0;
    const dist = new Map<string, number>();
    for (const [id, v] of values) { const n = numOf(spec, v); if (n !== null) dist.set(id, Math.abs(n - target)); }
    const best = Math.min(...dist.values());
    const out = new Map<string, Mark>();
    for (const id of values.keys()) {
      const d = dist.get(id);
      out.set(id, d === undefined ? "wrong" : scoring === "closest" ? (Math.abs(d - best) < 1e-9 ? "correct" : "wrong") : (d <= range ? "correct" : "wrong"));
    }
    return out;
  },
  groupText(spec, answers) {
    const groups = new Map<string, AnswerGroup>();
    for (const a of answers) {
      const key = normalise(a.text);
      const g = groups.get(key);
      if (g) { g.teamIds.push(a.teamId); if (g.mark !== a.mark) g.mark = "pending"; continue; }
      let nearest: AnswerGroup["nearest"] = null;
      for (const acc of spec.accepted) {
        const s = similarity(a.text, acc);
        if (!nearest || s > nearest.similarity) nearest = { accepted: acc, similarity: s };
      }
      groups.set(key, { key, display: a.text, teamIds: [a.teamId], mark: a.mark, nearest });
    }
    return [...groups.values()].sort((x, y) => (y.nearest?.similarity ?? -1) - (x.nearest?.similarity ?? -1));
  },
  score(input: ScoreInput): ScoreResult {
    const teams = input.teams.map((t) => {
      const roundScores = input.rounds.map((r, ri) => {
        const n = r.questionIds.filter((q) => input.correct.has(`${t.id}:${q}`)).length;
        return t.jokerRound === ri ? n * 2 : n;
      });
      return { id: t.id, roundScores, total: roundScores.reduce((a, b) => a + b, 0), roundWins: 0 };
    });
    input.rounds.forEach((_, ri) => {
      const top = Math.max(0, ...teams.map((t) => t.roundScores[ri]!));
      if (top > 0) for (const t of teams) if (t.roundScores[ri] === top) t.roundWins++;
    });
    return { teams };
  },
  rank(score, sd) {
    const ts = [...score.teams].sort((a, b) => b.total - a.total || b.roundWins - a.roundWins);
    const rows: StandingRow[] = [];
    let i = 0;
    while (i < ts.length) {
      const level = ts.filter((t) => t.total === ts[i]!.total && t.roundWins === ts[i]!.roundWins);
      const sameTotal = ts.filter((t) => t.total === ts[i]!.total).length > 1;
      const position = i + 1;
      const outcome = sd.find((o) => o.position === position && level.every((t) => o.order.flat().includes(t.id)));
      if (level.length > 1 && outcome) {
        let p = position;
        for (const group of outcome.order) {
          const inGroup = level.filter((t) => group.includes(t.id));
          for (const t of inGroup) rows.push({ teamId: t.id, position: p, shared: inGroup.length > 1, total: t.total, roundScores: t.roundScores, roundWins: t.roundWins, decidedBy: inGroup.length > 1 ? "shared" : "sudden_death" });
          p += inGroup.length;
        }
      } else {
        for (const t of level) rows.push({ teamId: t.id, position, shared: level.length > 1, total: t.total, roundScores: t.roundScores, roundWins: t.roundWins, decidedBy: level.length > 1 ? "shared" : sameTotal ? "tie_breaker" : "points" });
      }
      i += level.length;
    }
    return rows;
  },
  suddenDeathNeeded(rows, scope, done) {
    const positions = [...new Set(rows.filter((r) => r.shared).map((r) => r.position))].sort((a, b) => a - b);
    for (const p of positions) {
      if (scope === "first" && p !== 1) continue;
      if (done.some((o) => o.position === p)) continue;
      return { position: p, teamIds: rows.filter((r) => r.position === p).map((r) => r.teamId) };
    }
    return null;
  },
  resolveSuddenDeath(teamIds, rightIds) {
    const right = teamIds.filter((t) => rightIds.includes(t));
    if (right.length === 1) return { winner: right[0]!, remaining: teamIds.filter((t) => t !== right[0]) };
    if (right.length === 0 || right.length === teamIds.length) return { winner: null, remaining: teamIds };
    return { winner: null, remaining: right };
  },
  leaderboardLine(before, after) {
    if (after[0]?.decidedBy === "tie_breaker") return "tie_breaker";
    const lead = (rows: StandingRow[]) => rows.filter((r) => r.position === 1).map((r) => r.teamId);
    if (before && lead(after).some((t) => !lead(before).includes(t))) return "lead_change";
    if (after.length > 1 && after[0]!.total > 0 && after[0]!.total - after[1]!.total <= 1) return "close_race";
    return null;
  },
};

// --- CopyPicker: "<key>#<index>[ team]" lines, never the same index twice in a row ----------

export function fakeCopy(poolSize = 3): CopyPicker & { calls: { key: string; vars: object }[] } {
  const calls: { key: string; vars: object }[] = [];
  return {
    calls,
    pick(key, vars, last) {
      calls.push({ key, vars });
      const index = ((last[key] ?? -1) + 1) % poolSize;
      return { text: `${key}#${index}${vars.team ? ` ${vars.team}` : ""}`, index };
    },
  };
}

// --- quizzes -----------------------------------------------------------------------------

let qn = 0;
export function q(answer: AnswerSpec, extra: Partial<Question> = {}): Question {
  qn++;
  return { id: `q-${String(qn).padStart(8, "0")}`, text: `Question ${qn}?`, answer, ...extra };
}
export const text = (...accepted: string[]): AnswerSpec => ({ type: "text", accepted });
export const choice = (correct: number): AnswerSpec => ({ type: "choice", options: ["Paris", "Rome", "Oslo", "Bern"], correct });
export const number = (value: number): AnswerSpec => ({ type: "number", value });

export function makeQuiz(id: string, rounds: Question[][], settings: Partial<QuizSettings> = {}, suddenDeath: Question[] = []): QuizFile {
  return {
    format: QUIZ_FORMAT, id, title: `Quiz ${id}`, updatedAt: "2026-11-20T18:00:00.000Z",
    settings: { ...DEFAULT_QUIZ_SETTINGS, ...settings },
    rounds: rounds.map((qs, i) => ({ id: `r-${String(i + 1).padStart(8, "0")}`, title: `Round ${i + 1}`, questions: qs })),
    suddenDeath,
  };
}

export function writeQuiz(dataDir: string, quiz: QuizFile, media: Record<string, Uint8Array> = {}): void {
  const dir = join(dataDir, "quizzes", quiz.id);
  mkdirSync(join(dir, "media"), { recursive: true });
  writeFileSync(join(dir, "quiz.json"), JSON.stringify(quiz, null, 2));
  for (const [file, bytes] of Object.entries(media)) writeFileSync(join(dir, "media", file), bytes);
}

// --- an engine on fake time ----------------------------------------------------------------

export interface Rig {
  engine: Engine;
  clock: FakeClock;
  scheduler: ClockScheduler;
  dataDir: string;
  copy: ReturnType<typeof fakeCopy>;
  saved: [string, string, string][];
  events: Parameters<Engine["onChange"]>[0][];
  host: Actor;
  /** Moves fake time on and runs every timed event that has come due. */
  advance(ms: number): void;
  /** A new engine on the same database and data folder (a restart). */
  restart(): Rig;
  close(): void;
}

export function rig(opts: { dataDir?: string; clock?: FakeClock; rules?: Rules | undefined; copy?: ReturnType<typeof fakeCopy> } = {}): Rig {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "lockin-night-"));
  const clock = opts.clock ?? new FakeClock();
  const db = openDb(join(dataDir, "lockin.db"));
  const scheduler = new ClockScheduler(clock);
  const copy = opts.copy ?? fakeCopy();
  const saved: [string, string, string][] = [];
  const rules = "rules" in opts ? opts.rules : fakeRules;
  const engine = new Engine({
    db, clock, scheduler, sources: fileSources(dataDir), rules: () => rules, copy: () => copy,
    saveAcceptedAnswer: () => (quizId, qid, t) => { saved.push([quizId, qid, t]); }, publicUrl: "https://quiz.example.com",
  });
  const events: Rig["events"] = [];
  engine.onChange = (e) => events.push(e);
  engine.load();
  const r: Rig = {
    engine, clock, scheduler, dataDir, copy, saved, events, host: { role: "host" },
    advance(ms) { clock.advance(ms); scheduler.runDue(); },
    restart() {
      engine.stop(); scheduler.stop(); db.close();
      return rig({ dataDir, clock, rules, copy });
    },
    close() { engine.stop(); scheduler.stop(); db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
  return r;
}

let conn = 1000;
/** A team actor; join() returns the bound actor. */
export function joinTeam(r: Rig, name: string): Actor & { role: "team"; teamId: string; token: string } {
  const actor = { role: "team" as const, teamId: null, connId: conn++ };
  const res = r.engine.command(actor, "team.join", { roomCode: r.engine.m!.night.roomCode, name });
  if (!res.ok) throw new Error(`join failed: ${JSON.stringify(res.error)}`);
  const { teamId, token } = res.result as { teamId: string; token: string };
  return { role: "team", teamId, connId: actor.connId, token };
}

/** Runs a host command and throws if it fails. */
export function host(r: Rig, name: Parameters<Engine["command"]>[1], args: Record<string, unknown> = {}): unknown {
  const res = r.engine.command(r.host, name, args);
  if (!res.ok) throw new Error(`${name} failed: ${JSON.stringify(res.error)}`);
  return res.result;
}

export function code(res: { ok: boolean; error?: { code: string } }): string {
  return res.ok ? "ok" : res.error!.code;
}
