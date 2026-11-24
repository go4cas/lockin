// What phones send (TECH-SPEC 7.2, S-04, P-04): answers, checked against the strict lock, and
// the joker. Checks that change nothing run before the unit of work (SA-04). Split from the
// engine (code review LI-016).

import { validDatetime } from "../../shared/formats.ts";
import type { AnswerValue } from "../../shared/rules-api.ts";
import type { CommandResult } from "../ws.ts";
import type { QuestionRef } from "./quiz.ts";
import type { AnswerRec, TeamRec } from "./store.ts";
import { activeTeam } from "./teams.ts";
import { fail, isInt, isObj, len, OK, type NightReader, type Refusal, type TeamActor, type Work } from "./work.ts";

/** The round a joker can go on now, or null (P-04). */
export function upcomingRound(r: NightReader): number | null {
  if (!r.m) return null;
  const s = r.state;
  if (s.phase === "lobby") return 0;
  if (s.phase === "round_intro") return s.round;
  if (s.phase === "leaderboard" || s.phase === "halftime") return r.isLastRound() ? null : s.round + 1;
  return null;
}

export function jokerCheck(r: NightReader, actor: TeamActor, a: Record<string, unknown>): Refusal | { ok: true; team: TeamRec; up: number } {
  const team = activeTeam(r, actor.teamId);
  if (!team) return fail("not_allowed", "Join a team first.");
  if (!r.quiz.settings.joker) return fail("joker_off");
  if (team.jokerRound !== null) return fail("joker_used");
  if (!isInt(a.round)) return fail("bad_args");
  const up = upcomingRound(r);
  if (up === null || a.round !== up) return fail("joker_wrong_round");
  return { ok: true, team, up };
}

export function jokerPlay(w: Work, actor: TeamActor, a: Record<string, unknown>): CommandResult {
  const c = jokerCheck(w.read, actor, a);
  if (!c.ok) return c;
  const { team, up } = c;
  team.jokerRound = up;
  w.dirty.teams.add(team.id);
  w.s.flash = w.flash("joker_played", team.id, { team: team.name, round: up + 1 });
  return OK;
}

function validValue(v: unknown, ref: QuestionRef): AnswerValue | null {
  if (!isObj(v)) return null;
  const spec = ref.q.answer;
  switch (spec.type) {
    case "text": {
      if (v.type !== "text" || typeof v.text !== "string") return null;
      const text = v.text.trim();
      return len(text) >= 1 && len(text) <= 100 ? { type: "text", text } : null;
    }
    case "choice":
      return v.type === "choice" && isInt(v.index) && v.index >= 0 && v.index < spec.options.length ? { type: "choice", index: v.index } : null;
    case "number": case "closest":
      return v.type === "number" && typeof v.value === "number" && Number.isFinite(v.value) ? { type: "number", value: v.value } : null;
    case "datetime":
      return v.type === "datetime" && typeof v.value === "string" && validDatetime(spec.precision, v.value) ? { type: "datetime", value: v.value } : null;
  }
}

export type AnswerCheck = Refusal | { ok: true; team: TeamRec; ref: QuestionRef; value: AnswerValue; prev: AnswerRec | undefined; now: number };

export function answerCheck(r: NightReader, actor: TeamActor, a: Record<string, unknown>): AnswerCheck {
  const team = activeTeam(r, actor.teamId);
  if (!team) return fail("not_allowed", "Join a team first.");
  if (typeof a.questionId !== "string") return fail("bad_args");
  const ref = r.qIndex.get(a.questionId);
  const s = r.state;
  const qs = ref ? s.questions[ref.q.id] : undefined;
  if (!ref || !qs || qs.status === "hidden") return fail("question_closed");
  if (s.phase === "asking" && ref.round !== s.round) return fail("question_closed");
  if (s.phase === "sudden_death" && (ref.round !== -1 || s.sd?.current?.questionId !== ref.q.id)) return fail("question_closed");
  if (!r.participants(ref.q.id).includes(team.id)) return fail("not_allowed", "Only the tied teams answer this one.");
  if (qs.status === "locked") return fail("too_late");
  // The strict lock: accepted only if now < locksAt. Nothing the client sends affects this.
  const now = r.now();
  if (s.timer.state === "running" && s.timer.locksAt !== null && now >= s.timer.locksAt) return fail("too_late");
  if (s.timer.state === "done") return fail("too_late");
  const value = validValue(a.value, ref);
  if (!value) return fail("bad_args", "That answer doesn't fit this question.");
  return { ok: true, team, ref, value, prev: r.answer(team.id, ref.q.id), now };
}

/** The same answer again changes nothing: answered without a write or a broadcast. */
export function repeatAnswer(c: Extract<AnswerCheck, { ok: true }>): CommandResult | null {
  return c.prev?.value && JSON.stringify(c.prev.value) === JSON.stringify(c.value) ? { ok: true, result: { receivedAt: c.prev.receivedAt } } : null;
}

export function answerSubmit(w: Work, actor: TeamActor, a: Record<string, unknown>): CommandResult {
  const c = answerCheck(w.read, actor, a);
  if (!c.ok) return c;
  const same = repeatAnswer(c);
  if (same) return same;
  const { team, ref, value, prev, now } = c;
  w.putAnswer({
    teamId: team.id, questionId: ref.q.id, value, receivedAt: now, changes: prev?.value ? prev.changes + 1 : 0,
    mark: "pending", markedBy: null, markedAt: null,
  });
  return { ok: true, result: { receivedAt: now } };
}
