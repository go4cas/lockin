// Sudden death (TECH-SPEC 8.5, H-14): which position needs deciding, the outcomes so far
// (replayed from the sudden_deaths rows), and the sd.* commands. Split from the engine
// (code review LI-016).

import type { StandingRow, SuddenDeathOutcome } from "../../shared/rules-api.ts";
import type { CommandResult } from "../ws.ts";
import { joinNames, timerSecondsOf } from "./quiz.ts";
import { idleTimer } from "./state.ts";
import { fail, OK, type NightReader, type Work } from "./work.ts";

/** Sudden-death outcomes so far, replayed from the sudden_deaths rows (8.5). */
export function outcomes(r: NightReader): SuddenDeathOutcome[] {
  if (!r.m) return [];
  const rules = r.rules;
  const positions = [...new Set(r.m.sd.map((row) => row.position))];
  const out: SuddenDeathOutcome[] = [];
  for (const position of positions) {
    const decided = r.state.sd?.decided.find((x) => x.position === position);
    if (!decided) continue;
    const drops: string[][] = [];
    let order: string[][] | null = null;
    for (const row of r.m.sd.filter((x) => x.position === position)) {
      if (row.rightIds === null) continue;
      const res = rules.resolveSuddenDeath(row.teamIds, row.rightIds);
      if (res.winner) {
        order = [[res.winner], row.teamIds.filter((t) => t !== res.winner), ...[...drops].reverse()];
        break;
      }
      const dropped = row.teamIds.filter((t) => !res.remaining.includes(t));
      if (dropped.length > 0) drops.push(dropped);
    }
    if (!order) order = [decided.teamIds, ...[...drops].reverse()];
    out.push({ position, order: order.filter((g) => g.length > 0) });
  }
  return out;
}

/** The next sudden-death position to decide, if any; `rows` are the final standings with outcomes so far. */
export function needed(r: NightReader, rows: StandingRow[]): { position: number; teamIds: string[] } | null {
  return r.rules.suddenDeathNeeded(rows, r.quiz.settings.suddenDeathScope, outcomes(r));
}

/** True while the current sudden-death position is still being decided. */
export function live(r: NightReader): boolean {
  const sd = r.state.sd;
  return !!sd && !sd.decided.some((x) => x.position === sd.position);
}

export function sdStart(w: Work, need: { position: number; teamIds: string[] }): CommandResult {
  w.s.sd = { position: need.position, teamIds: need.teamIds, asked: 0, nextQuestion: 0, current: null, decided: [] };
  w.setPhase("sudden_death");
  w.setLine("suddenDeath", "sudden_death", { n: need.teamIds.length });
  return OK;
}

export function sdAsk(w: Work, need: () => { position: number; teamIds: string[] } | null): CommandResult {
  const s = w.s;
  const sd = s.sd!;
  if (!live(w.read)) {
    const next = need();
    if (!next) return fail("wrong_phase");
    sd.position = next.position;
    sd.teamIds = next.teamIds;
    sd.asked = 0;
    w.setLine("suddenDeath", "sudden_death", { n: next.teamIds.length });
  }
  const q = w.quiz.suddenDeath[sd.nextQuestion]!;
  sd.nextQuestion++;
  sd.asked++;
  sd.current = { questionId: q.id, status: "open" };
  s.questions[q.id] = { status: "open", openedAt: w.now() };
  s.timer = idleTimer(timerSecondsOf(w.quiz, q) * 1000);
  const seq = (w.m.sd[w.m.sd.length - 1]?.seq ?? 0) + 1;
  w.m.sd.push({ seq, position: sd.position, teamIds: [...sd.teamIds], questionId: q.id, rightIds: null });
  w.dirty.sd.add(seq);
  return OK;
}

export function sdReveal(w: Work): CommandResult {
  const s = w.s;
  const sd = s.sd!;
  const qid = sd.current!.questionId;
  const row = w.m.sd.find((x) => x.questionId === qid)!;
  const rightIds = row.teamIds.filter((t) => w.read.answer(t, qid)?.mark === "correct");
  row.rightIds = rightIds;
  w.dirty.sd.add(row.seq);
  sd.current!.status = "revealed";
  const res = w.rules.resolveSuddenDeath(row.teamIds, rightIds);
  const name = (id: string) => w.m.teams.get(id)?.name ?? "";
  if (res.winner) {
    sd.decided.push({ position: sd.position, teamIds: [res.winner], outcome: "won" });
    sd.teamIds = [res.winner];
    w.setLine("suddenDeath", "sudden_death_won", { team: name(res.winner) });
  } else if (sd.asked >= w.quiz.settings.suddenDeathMax || sd.nextQuestion >= w.quiz.suddenDeath.length) {
    sd.teamIds = res.remaining;
    sd.decided.push({ position: sd.position, teamIds: res.remaining, outcome: "shared" });
    w.setLine("suddenDeath", "sudden_death_shared", { team: joinNames(res.remaining.map(name)), n: res.remaining.length });
  } else {
    sd.teamIds = res.remaining;
    if (res.remaining.length === 1) {
      sd.decided.push({ position: sd.position, teamIds: res.remaining, outcome: "won" });
      w.setLine("suddenDeath", "sudden_death_won", { team: name(res.remaining[0]!) });
    } else w.setLine("suddenDeath", "sudden_death_again");
  }
  return OK;
}
