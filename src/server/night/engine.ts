// The night engine (TECH-SPEC 7, 8, 11): the orchestrator of one open night. It owns the
// model, the one commit boundary (run: a unit of work, written in one transaction before
// anything is sent, rolled back on a refusal or a failed write), the scheduled jobs, restart
// recovery and the readonly selectors views use. Each command's work lives in its own module
// (code review LI-016):
//
//   commands.ts      the command table: handler, pre-check, coalescing
//   guards.ts        phase guards (where each command may run) and HostView.can
//   flow.ts          the night, rounds, questions, reveal, leaderboard, Quiz End
//   timer.ts         timer commands, the strict lock, scheduled jobs
//   marking.ts       automatic and host marks, accepted answers
//   sudden-death.ts  outcomes and the sd.* commands
//   teams.ts         names, joining and rejoining limits, move codes, host team commands
//   answers.ts       answers and the joker
//   work.ts          the Work and NightReader interfaces those modules use
//
// Views are built in views.ts from the selectors here.

import type { Database } from "bun:sqlite";
import type { QuizFile } from "../../shared/formats.ts";
import type { CommandName, ErrorCode, Flash, Lines } from "../../shared/protocol.ts";
import type { CopyPicker, Rules, StandingRow, SuddenDeathOutcome } from "../../shared/rules-api.ts";
import { sha256, type Clock } from "../auth.ts";
import type { CommandResult } from "../ws.ts";
import { upcomingRound } from "./answers.ts";
import { ENGINE_COMMANDS, isEngineCommand, type PrecheckContext } from "./commands.ts";
import { LOBBY_LINE_MS, naturalEnd } from "./flow.ts";
import { HOST_COMMANDS, blocked, type GuardReader } from "./guards.ts";
import { answerText as specAnswerText, indexQuestions, type QuestionRef } from "./quiz.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Sources, VenueInfo } from "./sources.ts";
import type { EngineState } from "./state.ts";
import { Dirty, answerKey, flush, loadOpenNight, type AnswerRec, type Model, type TeamRec } from "./store.ts";
import { needed as sdNeededFor, outcomes as sdOutcomes } from "./sudden-death.ts";
import { JoinGuard, JOIN_TRIES_TOTAL, type MoveCodes } from "./teams.ts";
import { TimerJobs, lockOpen } from "./timer.ts";
import { fail, OK, type Actor, type Bye, type ChangeEvent, type Vars, type Work } from "./work.ts";

// Re-exported so callers keep one import (the engine's public surface).
export { fail, MESSAGES, type Actor, type ChangeEvent } from "./work.ts";
export { HOST_COMMANDS, type EngineCommand } from "./guards.ts";
export { LOBBY_LINE_MS } from "./flow.ts";
export {
  TEAM_COLOURS, ROOM_ALPHABET, MOVE_CODE_TTL_MS, JOIN_TRIES, JOIN_TRIES_PER_IP, JOIN_TRIES_TOTAL, JOIN_PAUSE_MS,
  JOIN_KEY_LENGTH, cleanTeamName, teamNameKey, randomId,
} from "./teams.ts";

export const LAST_SECONDS_MS = 10_000;
export const FLASH_MS = 6_000;
export const COALESCE_MS = 100;
/** A timed change (the lock) that could not be saved is tried again this soon (SA-09). */
export const TIMER_RETRY_MS = 2_000;

export interface Presence { connected: boolean; lastSeenAt: number | null }

export interface EngineDeps {
  db: Database;
  clock: Clock;
  scheduler: Scheduler;
  sources: Sources;
  rules: Rules;
  copy: CopyPicker;
  /** Appends an answer accepted while marking to the quiz file (the quiz store, TECH-SPEC 5.2). */
  saveAcceptedAnswer: (quizId: string, questionId: string, text: string) => void | Promise<void>;
  publicUrl: string;
  log?: (message: string) => void;
}

const LINE_KEEP: Record<string, (keyof Lines)[]> = {
  idle: [], lobby: ["lobby"], round_intro: ["round", "question"], asking: ["round", "question", "locked"], marking: ["locked"],
  reveal: ["reveal"], leaderboard: ["leaderboard"], halftime: ["halftime"], sudden_death: ["suddenDeath"],
  ended: ["winner", "lastPlace", "goodbye"],
};

export class Engine implements GuardReader {
  presence: (teamId: string) => Presence = () => ({ connected: false, lastSeenAt: null });
  onChange: (e: ChangeEvent) => void = () => {};

  /** The open night, or null when idle. Changed only inside a unit of work. */
  private model: Model | null = null;
  private questions = new Map<string, QuestionRef>();
  /** no_answer flashes, only in the view of the team concerned (10.4). Short-lived, not persisted. */
  private flashes = new Map<string, Flash>();
  /** One map for the night: the pre-check context holds it too, so it is refilled, never replaced. */
  private readonly moveCodes: MoveCodes = new Map();
  private readonly guard = new JoinGuard();
  private readonly timers: TimerJobs;
  private dirty = new Dirty();
  private byes: Bye[] = [];
  private post: (() => void)[] = [];
  private idleSeq = 1;
  private flashId: number;
  private lastSecondsFired: string | null = null;
  private lobbyLineAt = 0;
  private venueCache: { at: number; info: VenueInfo } | null = null;
  private recoverPending = false;
  /** The mutation side, used by handlers only inside run(). */
  private readonly work: Work;
  private readonly precheckContext: PrecheckContext;

  constructor(private d: EngineDeps) {
    this.flashId = d.clock.now();
    this.timers = new TimerJobs(d.scheduler);
    this.work = this.makeWork();
    this.precheckContext = {
      read: this,
      guard: this.guard,
      moveCodes: this.moveCodes,
      joinsPaused: () => {
        this.d.log?.(`Someone is guessing the room code: ${JOIN_TRIES_TOTAL} wrong codes in a minute. Joins by typed code are paused for a minute; the QR code still works.`);
        this.touch();   // the host sees the warning
      },
    };
  }

  // --- readonly selectors (views, routes, guards) -------------------------------------------

  /** The open night, or null when idle. Read it; never change it outside a command. */
  get m(): Model | null { return this.model; }
  get qIndex(): ReadonlyMap<string, QuestionRef> { return this.questions; }
  get teamFlash(): ReadonlyMap<string, Flash> { return this.flashes; }
  /** Joins by typed room code are paused until this server time (SA-01); 0 when not paused. */
  get joinPausedUntil(): number { return this.guard.pausedUntil; }

  now(): number { return this.d.clock.now(); }
  get publicUrl(): string { return this.d.publicUrl; }
  get seq(): number { return this.model ? this.model.state.seq : this.idleSeq; }
  get quiz(): QuizFile { return this.model!.night.quiz; }
  get state(): EngineState { return this.model!.state; }
  /** Marking, scoring and positions (src/server/rules), from the composition root. */
  get rules(): Rules { return this.d.rules; }

  venue(): VenueInfo {
    const now = this.now();
    if (!this.venueCache || now - this.venueCache.at > 2_000 || now < this.venueCache.at) {
      this.venueCache = { at: now, info: this.d.sources.venueInfo() };
    }
    return this.venueCache.info;
  }

  /** Active teams (not removed), in join order. */
  teams(): TeamRec[] {
    return this.model ? [...this.model.teams.values()].filter((t) => t.removedAt === null) : [];
  }

  answer(teamId: string, questionId: string): AnswerRec | undefined {
    return this.model?.answers.get(answerKey(teamId, questionId));
  }

  roundQuestions(r = this.state.round): QuizFile["rounds"][number]["questions"] {
    return this.quiz.rounds[r]?.questions ?? [];
  }

  isLastRound(r = this.state.round): boolean {
    return r === this.quiz.rounds.length - 1;
  }

  /** The question on screen while asking (the last one shown), or the open sudden-death question. */
  currentQuestionId(): string | null {
    if (!this.model) return null;
    const s = this.state;
    if (s.phase === "asking") return s.shown > 0 ? this.roundQuestions()[s.shown - 1]?.id ?? null : null;
    if (s.phase === "sudden_death") return s.sd?.current?.questionId ?? null;
    return null;
  }

  /** Teams that may answer a question: every active team, or the tied teams for sudden death. */
  participants(questionId: string): string[] {
    const ref = this.questions.get(questionId);
    if (ref && ref.round === -1) {
      const row = this.model?.sd.find((r) => r.questionId === questionId);
      return row ? row.teamIds : [];
    }
    return this.teams().map((t) => t.id);
  }

  pendingIn(questionIds: string[]): number {
    let n = 0;
    for (const qid of questionIds) {
      if (this.state.questions[qid]?.status !== "locked") continue;
      for (const tid of this.participants(qid)) if (this.answer(tid, qid)?.mark === "pending") n++;
    }
    return n;
  }

  roundPending(r = this.state.round): number {
    return this.pendingIn(this.roundQuestions(r).map((q) => q.id));
  }

  /** Positions after rounds 0..upTo (8.3, 8.4), with sudden-death outcomes. */
  standingsRows(upTo: number, withSd = true): StandingRow[] {
    const rules = this.rules;
    const rounds = this.quiz.rounds.slice(0, upTo + 1).map((r) => ({ questionIds: r.questions.map((q) => q.id) }));
    const correct = new Set<string>();
    for (const a of this.model!.answers.values()) if (a.mark === "correct") correct.add(answerKey(a.teamId, a.questionId));
    const score = rules.score({ rounds, teams: this.teams().map((t) => ({ id: t.id, jokerRound: t.jokerRound })), correct });
    return rules.rank(score, withSd ? this.outcomes() : []);
  }

  /** Sudden-death outcomes so far, replayed from the sudden_deaths rows (8.5). */
  outcomes(): SuddenDeathOutcome[] {
    return sdOutcomes(this);
  }

  /** The next sudden-death position to decide, if any (only after the last round). */
  sdNeeded(): { position: number; teamIds: string[] } | null {
    if (!this.model) return null;
    return sdNeededFor(this, this.standingsRows(this.quiz.rounds.length - 1));
  }

  /** The round a joker can go on now, or null (P-04). */
  upcomingRound(): number | null {
    return upcomingRound(this);
  }

  /** True when Quiz End would be a normal finish (not early). */
  naturalEnd(): boolean {
    return naturalEnd(this);
  }

  /** Why a command can't run now (ignoring its args), or null if it can. */
  blocked(name: CommandName): ErrorCode | null {
    return isEngineCommand(name) ? blocked(this, name) : "wrong_phase";
  }

  can(): Partial<Record<CommandName, boolean>> {
    const out: Partial<Record<CommandName, boolean>> = {};
    for (const n of HOST_COMMANDS) out[n] = blocked(this, n) === null;
    return out;
  }

  /** Team id for a device token in the open night (11.1). */
  teamForToken(token: string): string | null {
    if (!this.model || this.model.night.status !== "open") return null;
    const h = sha256(token);
    for (const t of this.teams()) if (t.tokenHash === h) return t.id;
    return null;
  }

  specAnswerText(qid: string): string {
    const ref = this.questions.get(qid);
    return ref ? specAnswerText(ref.q.answer) : "";
  }

  // --- command entry point ----------------------------------------------------------------------

  command(actor: Actor, name: CommandName, args: Record<string, unknown>): CommandResult {
    this.ensureRecovered();
    if (!isEngineCommand(name)) return fail("wrong_phase");
    const b = blocked(this, name);
    if (b) return fail(b);
    const spec = ENGINE_COMMANDS[name];
    // SA-04 / LI-011: refusals and no-ops from phones are found here, before run() copies the night.
    if (actor.role === "team" && spec.precheck) {
      const early = spec.precheck(this.precheckContext, actor, args);
      if (early) return early;
    }
    return this.run(() => spec.run(this.work, actor, args, this), spec.coalesce ?? false);
  }

  // --- the unit of work (6.3) ---------------------------------------------------------------------

  /**
   * Runs a change. On success the change is written in one transaction before
   * anything is sent; on failure (or if the write fails) memory goes back to
   * the last written state.
   */
  private run(fn: () => CommandResult, coalesce = false): CommandResult {
    const backup = this.model ? structuredClone(this.model) : null;
    const backupFlash = new Map(this.flashes);
    const backupMove = new Map(this.moveCodes);
    this.dirty.clear();
    this.byes = [];
    this.post = [];
    const restore = () => {
      this.model = backup;
      this.questions = this.model ? indexQuestions(this.model.night.quiz) : new Map();
      this.flashes = backupFlash;
      this.moveCodes.clear();
      for (const [k, v] of backupMove) this.moveCodes.set(k, v);
      this.dirty.clear();
      this.byes = [];
      this.post = [];
    };
    let result: CommandResult;
    try {
      result = fn();
    } catch (e) {
      restore();
      throw e;
    }
    if (!result.ok) { restore(); return result; }
    if (this.model) {
      this.model.state.seq++;
      try {
        flush(this.d.db, this.model, this.dirty);
      } catch (e) {
        restore();
        throw e;
      }
    }
    this.dirty.clear();
    const post = this.post;
    this.post = [];
    for (const p of post) p();
    const byes = this.byes;
    this.byes = [];
    this.syncTimers();
    this.onChange({ coalesce, byes });
    return result;
  }

  /** The Work handed to handlers: live views of the engine's private state, valid inside run(). */
  private makeWork(): Work {
    const e = this;   // getters below read the current model, which run() may swap
    return {
      read: e,
      get m() { return e.model!; },
      get s() { return e.model!.state; },
      get quiz() { return e.quiz; },
      get rules() { return e.d.rules; },
      get dirty() { return e.dirty; },
      get sources() { return e.d.sources; },
      get publicUrl() { return e.d.publicUrl; },
      get teamFlash() { return e.flashes; },
      get moveCodes() { return e.moveCodes; },
      get guard() { return e.guard; },
      now: () => e.now(),
      log: (message) => e.d.log?.(message),
      saveAcceptedAnswer: (quizId, questionId, text) => e.d.saveAcceptedAnswer(quizId, questionId, text),
      venue: () => e.venue(),
      bye: (b) => { e.byes.push(b); },
      after: (fn) => { e.post.push(fn); },
      pick: (key, vars) => e.pick(key, vars),
      setLine: (slot, key, vars) => { e.state.lines[slot] = e.pick(key, vars); },
      flash: (key, teamId, vars) => e.flash(key, teamId, vars),
      setPhase: (phase) => e.setPhase(phase),
      putAnswer: (a) => {
        const key = answerKey(a.teamId, a.questionId);
        e.model!.answers.set(key, a);
        e.dirty.answers.add(key);
      },
      openNight: (m) => {
        m.state.seq = e.idleSeq + 1;
        e.model = m;
        e.questions = indexQuestions(m.night.quiz);
        e.flashes.clear();
        e.moveCodes.clear();
      },
      closeNight: () => {
        const seq = e.state.seq;
        e.post.push(() => {
          e.model = null;
          e.questions = new Map();
          e.flashes.clear();
          e.moveCodes.clear();
          e.idleSeq = seq + 1;
        });
      },
      setLobbyLineAt: (at) => { e.lobbyLineAt = at; },
    };
  }

  /** Bumps seq without a write, for changes that live only in memory (presence). */
  touch(hostOnly = true): void {
    if (this.model) this.model.state.seq++;
    else this.idleSeq++;
    this.onChange({ coalesce: false, byes: [], hostOnly });
  }

  /** The theme or venue settings changed: every screen gets a fresh view (new themeVersion). */
  venueChanged(): void {
    this.venueCache = null;
    this.touch(false);
  }

  // --- copy lines and flashes -------------------------------------------------------------------

  private pick(key: string, vars: Vars = {}): string | null {
    const res = this.d.copy.pick(key, { pub: this.venue().name, ...vars }, this.state.copyLast);
    if (!res) return null;
    this.state.copyLast[key] = res.index;
    return res.text;
  }

  private flash(key: Flash["key"], teamId: string | null, vars: Vars): Flash | null {
    const line = this.pick(key, vars);
    if (line === null) return null;
    this.flashId = Math.max(this.flashId + 1, this.now());
    return { id: this.flashId, key, line, teamId, at: this.now() };
  }

  private setPhase(phase: EngineState["phase"]): void {
    const s = this.state;
    s.phase = phase;
    const keep = LINE_KEEP[phase] ?? [];
    for (const k of Object.keys(s.lines)) if (!keep.includes(k as keyof Lines)) s.lines[k] = null;
  }

  // --- restart recovery (7.6) -------------------------------------------------------------------

  load(): void {
    const model = loadOpenNight(this.d.db);
    if (!model) return;
    this.model = model;
    this.questions = indexQuestions(model.night.quiz);
    if (model.state.phase === "lobby") this.lobbyLineAt = this.now() + LOBBY_LINE_MS;
    this.recover();
  }

  /** Locks a question whose timer ran out while the server was down, or reschedules the lock (7.6). */
  private recover(): void {
    const t = this.model?.state.timer;
    if (t && t.state === "running" && t.locksAt !== null && t.locksAt <= this.now()) {
      const at = t.locksAt;
      try {
        this.run(() => { lockOpen(this.work, at); return OK; });
      } catch (e) {
        // For example the database is busy: try again on the next command or view.
        this.recoverPending = true;
        this.d.log?.(`Restart recovery is waiting: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    this.syncTimers();
  }

  /** Finishes restart recovery if it could not finish at start. */
  ensureRecovered(): void {
    if (!this.recoverPending) return;
    this.recoverPending = false;
    this.recover();
  }

  stop(): void {
    this.timers.cancelAll();
  }

  // --- scheduled events (7.3, 10.4) -------------------------------------------------------------

  private syncTimers(): void {
    const s = this.model?.state;
    const t = s?.timer;
    const running = !!s && t!.state === "running" && t!.locksAt !== null;
    const locksAt = running ? t!.locksAt! : 0;
    this.timers.ensure("lock", running ? `lock:${locksAt}` : null, locksAt, () => this.fireLock(locksAt));
    const lastKey = running && s!.phase === "asking" ? `last:${locksAt}` : null;
    this.timers.ensure("last", lastKey !== null && lastKey !== this.lastSecondsFired ? lastKey : null, locksAt - LAST_SECONDS_MS,
      () => this.fireLastSeconds(lastKey!));
    const lobby = s?.phase === "lobby";
    this.timers.ensure("lobby", lobby ? `lobby:${this.lobbyLineAt}` : null, this.lobbyLineAt, () => this.fireLobbyLine());
    // Ended on a timer: send fresh views when the final standings show, so the host's `can` stays true.
    const fin = s?.phase === "ended" ? s.finalStandingsAt ?? null : null;
    this.timers.ensure("final", fin !== null && fin > this.now() ? `final:${fin}` : null, fin ?? 0, () => this.fireFinal());
  }

  private fireFinal(): void {
    this.timers.fired("final");
    if (this.model?.state.phase !== "ended") return;
    this.run(() => OK);
  }

  private fireLock(locksAt: number): void {
    this.timers.fired("lock");
    const t = this.model?.state.timer;
    if (!t || t.state !== "running" || t.locksAt !== locksAt) return;
    try {
      this.run(() => { lockOpen(this.work, locksAt); return OK; });
    } catch (e) {
      // SA-09: for example the disk is full or the database stayed busy. Memory went back to the
      // last saved state (the timer still running), so the lock is tried again until it saves.
      this.d.log?.(`The lock could not be saved; trying again in ${TIMER_RETRY_MS / 1000} s: ${e instanceof Error ? e.message : String(e)}`);
      this.timers.once(this.now() + TIMER_RETRY_MS, () => this.syncTimers());
    }
  }

  private fireLastSeconds(key: string): void {
    this.timers.fired("last");
    this.lastSecondsFired = key;
    if (!this.model || this.state.phase !== "asking" || this.state.timer.state !== "running") return;
    this.run(() => {
      const left = Math.max(1, Math.round((this.state.timer.locksAt! - this.now()) / 1000));
      this.work.setLine("question", "last_seconds", { seconds: left });
      return OK;
    });
  }

  private fireLobbyLine(): void {
    this.timers.fired("lobby");
    if (!this.model || this.state.phase !== "lobby") return;
    this.lobbyLineAt = this.now() + LOBBY_LINE_MS;
    this.run(() => { this.work.setLine("lobby", "lobby", { n: this.teams().length }); return OK; });
  }
}
