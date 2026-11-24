// Marking (TECH-SPEC 8.2, H-10, H-13): automatic marks at the lock, the host's group and team
// marks, and accepted answers. Split from the engine (code review LI-016).

import type { AnswerValue, Mark } from "../../shared/rules-api.ts";
import type { CommandResult } from "../ws.ts";
import { isClosest, valueKey, type QuestionRef } from "./quiz.ts";
import type { AnswerRec } from "./store.ts";
import { fail, OK, type NightReader, type Work } from "./work.ts";

/** Auto-marks a question at its lock (8.2): no answer is wrong; closest questions are marked together. */
export function autoMarkAtLock(w: Work, qid: string, at: number): void {
  const rules = w.rules;
  const r = w.read;
  const spec = r.qIndex.get(qid)!.q.answer;
  const teamIds = r.participants(qid);
  const withValue = new Map<string, AnswerValue>();
  for (const tid of teamIds) {
    const a = r.answer(tid, qid);
    if (a?.value) withValue.set(tid, a.value);
  }
  const marks = isClosest(spec)
    ? rules.markClosest(spec, withValue, w.quiz.settings.closestScoring)
    : new Map([...withValue].map(([tid, v]) => [tid, rules.autoMark(spec, v)] as const));
  for (const tid of teamIds) {
    const a = r.answer(tid, qid);
    if (a?.markedBy === "host") continue;
    const mark: Mark = withValue.has(tid) ? (marks.get(tid) ?? "pending") : "wrong";
    w.putAnswer({
      teamId: tid, questionId: qid, value: a?.value ?? null, receivedAt: a?.receivedAt ?? null, changes: a?.changes ?? 0,
      mark, markedBy: mark === "pending" ? null : "auto", markedAt: mark === "pending" ? null : at,
    });
  }
}

function markable(r: NightReader, qid: unknown): QuestionRef | null {
  if (typeof qid !== "string") return null;
  const ref = r.qIndex.get(qid);
  if (!ref || r.state.questions[qid]?.status !== "locked") return null;
  return ref;
}

/**
 * A sudden-death question whose reveal is committed (its sudden_deaths row has rightIds) is final:
 * eliminations and outcomes were replayed from those rightIds, so its marks never change after
 * (code review LI-005). Checked on the persisted row, so it holds after later questions and restarts.
 */
function sdRevealed(r: NightReader, qid: unknown): boolean {
  return typeof qid === "string" && !!r.m?.sd.some((row) => row.questionId === qid && row.rightIds !== null);
}

function setMark(w: Work, teamId: string, qid: string, mark: Mark): void {
  const a = w.read.answer(teamId, qid);
  const from = a?.mark ?? "pending";
  if (from === mark && a?.markedBy === "host") return;
  if (from !== "pending" && from !== mark) w.dirty.markChanges.push({ teamId, questionId: qid, from, to: mark, at: w.now() });
  w.putAnswer({
    teamId, questionId: qid, value: a?.value ?? null, receivedAt: a?.receivedAt ?? null, changes: a?.changes ?? 0,
    mark, markedBy: "host", markedAt: w.now(),
  });
}

export function markGroup(w: Work, a: Record<string, unknown>): CommandResult {
  const r = w.read;
  if (sdRevealed(r, a.questionId)) return fail("wrong_phase", "That deadlock question has been revealed, so its marks can't change.");
  const ref = markable(r, a.questionId);
  if (!ref) return fail("not_found", "That question isn't locked yet.");
  if (typeof a.key !== "string" || (a.mark !== "correct" && a.mark !== "wrong")) return fail("bad_args");
  const qid = ref.q.id;
  const rules = w.rules;
  const spec = ref.q.answer;
  const members: AnswerRec[] = [];
  for (const tid of r.participants(qid)) {
    const ans = r.answer(tid, qid);
    if (!ans?.value) continue;
    const key = ans.value.type === "text" && spec.type === "text" ? rules.normalise(ans.value.text) : valueKey(ans.value);
    if (key === a.key) members.push(ans);
  }
  if (members.length === 0) return fail("not_found", "No answers match that group.");
  for (const ans of members) setMark(w, ans.teamId, qid, a.mark);
  if (a.mark === "correct" && spec.type === "text") {
    members.sort((x, y) => (x.receivedAt ?? 0) - (y.receivedAt ?? 0));
    const display = (members[0]!.value as { text: string }).text;
    if (!spec.accepted.some((t) => rules.normalise(t) === a.key)) {
      spec.accepted.push(display);
      w.dirty.night = true;
      const quizId = w.m.night.quizId;
      w.after(() => {
        Promise.resolve().then(() => w.saveAcceptedAnswer(quizId, qid, display))
          .catch((e) => w.log(`Saving an accepted answer failed: ${e instanceof Error ? e.message : String(e)}`));
      });
    }
    // other pending answers that now match an accepted answer
    for (const tid of r.participants(qid)) {
      const ans = r.answer(tid, qid);
      if (ans?.value && ans.mark === "pending" && rules.autoMark(spec, ans.value) === "correct") {
        w.putAnswer({ ...ans, mark: "correct", markedBy: "auto", markedAt: w.now() });
      }
    }
  }
  return OK;
}

export function markTeam(w: Work, a: Record<string, unknown>): CommandResult {
  const r = w.read;
  if (sdRevealed(r, a.questionId)) return fail("wrong_phase", "That deadlock question has been revealed, so its marks can't change.");
  const ref = markable(r, a.questionId);
  if (!ref) return fail("not_found", "That question isn't locked yet.");
  if (typeof a.teamId !== "string" || (a.mark !== "correct" && a.mark !== "wrong")) return fail("bad_args");
  if (!r.participants(ref.q.id).includes(a.teamId)) return fail("not_found", "That team isn't in this question.");
  setMark(w, a.teamId, ref.q.id, a.mark);
  return OK;
}
