// The timer and the strict lock (TECH-SPEC 7.3, S-04): timer commands, locking whatever is open,
// and the engine's scheduled jobs. Split from the engine (code review LI-016).

import type { CommandResult } from "../ws.ts";
import { timerSecondsOf } from "./quiz.ts";
import type { Scheduler } from "./scheduler.ts";
import { autoMarkAtLock } from "./marking.ts";
import { fail, OK, type Work } from "./work.ts";

export function timerStart(w: Work): CommandResult {
  const t = w.s.timer;
  let duration = t.durationMs;
  if (duration <= 0) {
    const cur = w.read.currentQuestionId();
    const ref = cur ? w.read.qIndex.get(cur) : undefined;
    duration = (ref ? timerSecondsOf(w.quiz, ref.q) : w.quiz.settings.timerSeconds) * 1000;
  }
  w.s.timer = { state: "running", durationMs: duration, locksAt: w.now() + duration, remainingMs: null };
  return OK;
}

export function timerPause(w: Work): CommandResult {
  const t = w.s.timer;
  w.s.timer = { state: "paused", durationMs: t.durationMs, locksAt: null, remainingMs: Math.max(0, t.locksAt! - w.now()) };
  return OK;
}

export function timerResume(w: Work): CommandResult {
  const t = w.s.timer;
  w.s.timer = { state: "running", durationMs: t.durationMs, locksAt: w.now() + (t.remainingMs ?? 0), remainingMs: null };
  return OK;
}

export function timerAdd(w: Work, a: Record<string, unknown>): CommandResult {
  if (a.seconds !== 15) return fail("bad_args", "Only 15 seconds can be added.");
  const t = w.s.timer;
  if (t.state === "running") w.s.timer = { ...t, durationMs: t.durationMs + 15_000, locksAt: t.locksAt! + 15_000 };
  else w.s.timer = { ...t, durationMs: t.durationMs + 15_000, remainingMs: (t.remainingMs ?? 0) + 15_000 };
  return OK;
}

export function lockCmd(w: Work): CommandResult {
  const cur = w.read.currentQuestionId();
  if (w.s.phase === "asking" && w.quiz.settings.lockMode === "question" && cur && w.s.questions[cur]?.status === "locked") return OK;
  if (w.s.phase === "sudden_death" && cur && w.s.questions[cur]?.status === "locked") return OK;
  lockOpen(w, w.now());
  return OK;
}

/** Locks whatever is open now (7.3): the current question, or every open question in per-round mode. */
export function lockOpen(w: Work, at: number): void {
  const s = w.s;
  const r = w.read;
  let ids: string[];
  if (s.phase === "sudden_death") ids = s.sd?.current && s.questions[s.sd.current.questionId]?.status === "open" ? [s.sd.current.questionId] : [];
  else if (s.phase === "asking") {
    if (w.quiz.settings.lockMode === "round") ids = r.roundQuestions().filter((q) => s.questions[q.id]?.status === "open").map((q) => q.id);
    else { const cur = r.currentQuestionId(); ids = cur && s.questions[cur]?.status === "open" ? [cur] : []; }
  } else ids = Object.keys(s.questions).filter((id) => s.questions[id]!.status === "open");
  if (s.timer.state !== "idle") s.timer = { state: "done", durationMs: s.timer.durationMs, locksAt: at, remainingMs: null };
  if (ids.length === 0) return;
  let all = true;
  for (const qid of ids) {
    s.questions[qid] = { ...s.questions[qid]!, status: "locked", lockedAt: at };
    for (const tid of r.participants(qid)) if (!r.answer(tid, qid)?.value) all = false;
    autoMarkAtLock(w, qid, at);
  }
  if (s.phase === "asking") {
    s.lines.locked = all ? w.pick("all_locked", { n: r.teams().length }) : w.pick("locked");
    if (w.quiz.settings.lockMode === "question") s.lines.question = null;
    // no_answer flashes, each only for the team concerned (10.4)
    const lastQ = ids[ids.length - 1]!;
    for (const tid of r.participants(lastQ)) {
      if (ids.some((qid) => !r.answer(tid, qid)?.value)) {
        const team = w.m.teams.get(tid)!;
        const f = w.flash("no_answer", tid, { team: team.name });
        if (f) w.teamFlash.set(tid, f);
      }
    }
  } else if (s.phase === "sudden_death" && s.sd?.current) {
    s.sd.current.status = "locked";
  }
}

/**
 * The engine's scheduled jobs by name ("lock", "last", "lobby", "final"), each with a key that
 * says what it is for. ensure() keeps a job whose key has not changed, so re-syncing after every
 * command never moves a timer.
 */
export class TimerJobs {
  private jobs = new Map<string, { key: string; handle: number }>();

  constructor(private scheduler: Scheduler) {}

  /** Schedules `fn` at `time` under `name` for `key`, replacing a job with another key; a null key cancels. */
  ensure(name: string, key: string | null, time: number, fn: () => void): void {
    const cur = this.jobs.get(name);
    if (cur && cur.key === key) return;
    if (cur) { this.scheduler.cancel(cur.handle); this.jobs.delete(name); }
    if (key !== null) this.jobs.set(name, { key, handle: this.scheduler.at(time, fn) });
  }

  /** A job has fired: forget it, so the next sync may schedule it again. */
  fired(name: string): void {
    this.jobs.delete(name);
  }

  /** Runs `fn` once at `time`, outside the named jobs (a retry). */
  once(time: number, fn: () => void): void {
    this.scheduler.at(time, fn);
  }

  cancelAll(): void {
    for (const j of this.jobs.values()) this.scheduler.cancel(j.handle);
    this.jobs.clear();
  }
}
