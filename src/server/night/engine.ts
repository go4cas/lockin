// The night engine (TECH-SPEC 7, 8, 11): phases, commands, the timer and the
// strict lock, marking and scoring through Rules, sudden death, Quiz End,
// write-through persistence and restart recovery. Views are built in views.ts.

import type { Database } from "bun:sqlite";
import { randomInt } from "node:crypto";
import type { Prize, Question, QuizFile } from "../../shared/formats.ts";
import { validDatetime } from "../../shared/formats.ts";
import type { CommandName, ErrorCode, Flash, Lines } from "../../shared/protocol.ts";
import type { AnswerValue, CopyPicker, Mark, Rules, StandingRow, SuddenDeathOutcome } from "../../shared/rules-api.ts";
import { CODE_ALPHABET, randomCode, randomToken, sha256, type Clock } from "../auth.ts";
import type { CommandResult } from "../ws.ts";
import { answerText as specAnswerText, halftimeRound, indexQuestions, isClosest, joinNames, timerSecondsOf, valueKey, type QuestionRef } from "./quiz.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Sources, VenueInfo } from "./sources.ts";
import { idleTimer, initialState, type EngineState } from "./state.ts";
import { Dirty, answerKey, flush, loadOpenNight, type AnswerRec, type Model, type TeamRec } from "./store.ts";

export const TEAM_COLOURS = 8;
export const ROOM_ALPHABET = "BCDFGHJKMNPQRSTVWXZ";
export const MOVE_CODE_TTL_MS = 10 * 60_000;
export const LOBBY_LINE_MS = 45_000;
export const LAST_SECONDS_MS = 10_000;
export const FLASH_MS = 6_000;
export const COALESCE_MS = 100;
const REJOIN_TRIES = 5;
/** Wrong rejoin tries a minute from one client IP, across all its connections. Higher than REJOIN_TRIES because a pub's phones often share one address. */
const REJOIN_TRIES_PER_IP = 10;
const MINUTE = 60_000;
/** Wrong room codes a minute (SA-01): per connection, per client IP, and from everyone together. */
export const JOIN_TRIES = 3;
export const JOIN_TRIES_PER_IP = 10;
export const JOIN_TRIES_TOTAL = 30;
/** How long joins by typed room code stay paused once JOIN_TRIES_TOTAL is reached (SA-01). */
export const JOIN_PAUSE_MS = 60_000;
/** Join key length (D1): 10 characters of the rejoin alphabet, about 50 bits. */
export const JOIN_KEY_LENGTH = 10;

export const MESSAGES: Partial<Record<ErrorCode, string>> = {
  not_allowed: "This screen cannot do that.",
  wrong_phase: "That can't be done right now.",
  bad_args: "That request was not understood.",
  not_found: "That could not be found.",
  room_code: "That room code isn't right. Check the code on the screen.",
  name_taken: "Another team already has that name.",
  team_has_phone: "This team already has a phone. If it died, ask for your team's rejoin code.",
  joining_closed: "The quiz has started, so new teams can't join. Ask the host.",
  night_full: "This quiz is full. Ask the host.",
  bad_code: "That code isn't right. Check it and try again.",
  too_many_tries: "Too many wrong codes. Wait a minute and try again.",
  too_late: "Too late, answers were locked.",
  question_closed: "That question isn't open.",
  joker_used: "You've already played your joker.",
  joker_off: "There's no joker in this quiz.",
  joker_wrong_round: "The joker can only go on the next round.",
  quiz_not_ready: "That quiz isn't ready yet. Open it in the library to see what's missing.",
  night_open: "A night is already open. Close it first.",
  marks_pending: "Some answers still need marking.",
  no_teams: "No teams have joined yet.",
  server_error: "Something went wrong on the server. Try again.",
};

export function fail(code: ErrorCode, message?: string): CommandResult {
  return { ok: false, error: { code, message: message ?? MESSAGES[code] ?? "That can't be done right now." } };
}
const OK: CommandResult = { ok: true };
type Refusal = { ok: false; error: { code: ErrorCode; message: string } };
const refuse = (code: ErrorCode, message?: string) => fail(code, message) as Refusal;

/** `ip` is the client address (CF-Connecting-IP behind the tunnel); rejoin tries are limited per IP as well as per connection. */
export type Actor = { role: "host" } | { role: "team"; teamId: string | null; connId: number; ip?: string };

/** What the socket layer must do after a change. */
export interface ChangeEvent {
  /** Answer submissions only change counts elsewhere, so views may be coalesced (10.7). */
  coalesce: boolean;
  /** Connections to say bye to: every team connection bound to teamId (except `keepConn`). */
  byes: { teamId: string; reason: "moved" | "removed" | "night_closed"; keepConn?: number }[];
  /** Only the host view changed (team presence). */
  hostOnly?: boolean;
}

export interface Presence { connected: boolean; lastSeenAt: number | null }

export interface EngineDeps {
  db: Database;
  clock: Clock;
  scheduler: Scheduler;
  sources: Sources;
  rules: () => Rules | undefined;
  copy: () => CopyPicker | undefined;
  saveAcceptedAnswer: () => ((quizId: string, questionId: string, text: string) => void | Promise<void>) | undefined;
  publicUrl: string;
  log?: (message: string) => void;
}

type Vars = Parameters<CopyPicker["pick"]>[1];

/** Host commands that `can` reports on (10.3 HostView.can). */
export const HOST_COMMANDS: readonly CommandName[] = [
  "night.open", "night.update", "night.close", "quiz.start", "quiz.end",
  "round.start", "round.finish", "round.next", "question.next",
  "timer.start", "timer.pause", "timer.resume", "timer.add", "lock",
  "mark.group", "mark.team", "reveal.start", "reveal.next", "leaderboard.show",
  "sd.start", "sd.ask", "sd.reveal", "final.show", "team.rename", "team.remove", "team.moveCode", "night.newRoomCode",
];

const MARK_PHASES = new Set(["asking", "marking", "reveal", "leaderboard", "halftime", "round_intro", "sudden_death"]);
const JOKER_PHASES = new Set(["lobby", "round_intro", "leaderboard", "halftime"]);
const LINE_KEEP: Record<string, (keyof Lines)[]> = {
  idle: [], lobby: ["lobby"], round_intro: ["round", "question"], asking: ["round", "question", "locked"], marking: ["locked"],
  reveal: ["reveal"], leaderboard: ["leaderboard"], halftime: ["halftime"], sudden_death: ["suddenDeath"],
  ended: ["winner", "lastPlace", "goodbye"],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const len = (s: string) => [...s].length;

export class Engine {
  /** The open night, or null when idle. */
  m: Model | null = null;
  qIndex = new Map<string, QuestionRef>();
  /** no_answer flashes, only in the view of the team concerned (10.4). Short-lived, not persisted. */
  teamFlash = new Map<string, Flash>();
  presence: (teamId: string) => Presence = () => ({ connected: false, lastSeenAt: null });
  onChange: (e: ChangeEvent) => void = () => {};

  private dirty = new Dirty();
  private byes: ChangeEvent["byes"] = [];
  private post: (() => void)[] = [];
  private idleSeq = 1;
  private flashId: number;
  private moveCodes = new Map<string, { teamId: string; expires: number }>();
  /** Wrong rejoin tries in the last minute, keyed `c:<connId>` and `ip:<address>`. */
  private rejoinTries = new Map<string, number[]>();
  /** Wrong room codes in the last minute (SA-01), keyed `c:<connId>`, `ip:<address>` and `all`. */
  private joinTries = new Map<string, number[]>();
  /** Joins by typed room code are paused until this server time (SA-01); 0 when not paused. */
  joinPausedUntil = 0;
  private jobs = new Map<string, { key: string; handle: number }>();
  private lastSecondsFired: string | null = null;
  private lobbyLineAt = 0;
  private venueCache: { at: number; info: VenueInfo } | null = null;

  constructor(private d: EngineDeps) {
    this.flashId = d.clock.now();
  }

  // --- basics ---------------------------------------------------------------

  now(): number { return this.d.clock.now(); }
  get publicUrl(): string { return this.d.publicUrl; }
  get seq(): number { return this.m ? this.m.state.seq : this.idleSeq; }
  get quiz(): QuizFile { return this.m!.night.quiz; }
  get state(): EngineState { return this.m!.state; }

  venue(): VenueInfo {
    const now = this.now();
    if (!this.venueCache || now - this.venueCache.at > 2_000 || now < this.venueCache.at) {
      this.venueCache = { at: now, info: this.d.sources.venueInfo() };
    }
    return this.venueCache.info;
  }

  rulesOrThrow(): Rules {
    const r = this.d.rules();
    if (!r) throw new Error("The marking rules (B2) are not installed.");
    return r;
  }
  rules(): Rules | undefined { return this.d.rules(); }

  /** Active teams (not removed), in join order. */
  teams(): TeamRec[] {
    return this.m ? [...this.m.teams.values()].filter((t) => t.removedAt === null) : [];
  }

  answer(teamId: string, questionId: string): AnswerRec | undefined {
    return this.m?.answers.get(answerKey(teamId, questionId));
  }

  roundQuestions(r = this.state.round): Question[] {
    return this.quiz.rounds[r]?.questions ?? [];
  }

  isLastRound(r = this.state.round): boolean {
    return r === this.quiz.rounds.length - 1;
  }

  /** The question on screen while asking (the last one shown), or the open sudden-death question. */
  currentQuestionId(): string | null {
    if (!this.m) return null;
    const s = this.state;
    if (s.phase === "asking") return s.shown > 0 ? this.roundQuestions()[s.shown - 1]?.id ?? null : null;
    if (s.phase === "sudden_death") return s.sd?.current?.questionId ?? null;
    return null;
  }

  /** Teams that may answer a question: every active team, or the tied teams for sudden death. */
  participants(questionId: string): string[] {
    const ref = this.qIndex.get(questionId);
    if (ref && ref.round === -1) {
      const row = this.m?.sd.find((r) => r.questionId === questionId);
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

  // --- scoring ----------------------------------------------------------------

  /** Positions after rounds 0..upTo (8.3, 8.4), with sudden-death outcomes. */
  standingsRows(upTo: number, withSd = true): StandingRow[] {
    const rules = this.rulesOrThrow();
    const rounds = this.quiz.rounds.slice(0, upTo + 1).map((r) => ({ questionIds: r.questions.map((q) => q.id) }));
    const correct = new Set<string>();
    for (const a of this.m!.answers.values()) if (a.mark === "correct") correct.add(answerKey(a.teamId, a.questionId));
    const score = rules.score({ rounds, teams: this.teams().map((t) => ({ id: t.id, jokerRound: t.jokerRound })), correct });
    return rules.rank(score, withSd ? this.outcomes() : []);
  }

  /** Sudden-death outcomes so far, replayed from the sudden_deaths rows (8.5). */
  outcomes(): SuddenDeathOutcome[] {
    if (!this.m) return [];
    const rules = this.rules();
    if (!rules) return [];
    const positions = [...new Set(this.m.sd.map((r) => r.position))];
    const out: SuddenDeathOutcome[] = [];
    for (const position of positions) {
      const decided = this.state.sd?.decided.find((x) => x.position === position);
      if (!decided) continue;
      const drops: string[][] = [];
      let order: string[][] | null = null;
      for (const row of this.m.sd.filter((r) => r.position === position)) {
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

  /** The next sudden-death position to decide, if any (only after the last round). */
  sdNeeded(): { position: number; teamIds: string[] } | null {
    if (!this.m || !this.rules()) return null;
    const rows = this.standingsRows(this.quiz.rounds.length - 1);
    return this.rulesOrThrow().suddenDeathNeeded(rows, this.quiz.settings.suddenDeathScope, this.outcomes());
  }

  /** True while the current sudden-death position is still being decided. */
  private sdLive(): boolean {
    const sd = this.state.sd;
    return !!sd && !sd.decided.some((x) => x.position === sd.position);
  }

  // --- copy lines and flashes -------------------------------------------------

  private pick(key: string, vars: Vars = {}): string | null {
    const picker = this.d.copy();
    if (!picker) return null;
    const res = picker.pick(key, { pub: this.venue().name, ...vars }, this.state.copyLast);
    if (!res) return null;
    this.state.copyLast[key] = res.index;
    return res.text;
  }

  private setLine(slot: keyof Lines, key: string, vars: Vars = {}): void {
    this.state.lines[slot] = this.pick(key, vars);
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

  // --- the mutation wrapper (6.3) ---------------------------------------------

  /**
   * Runs a change. On success the change is written in one transaction before
   * anything is sent; on failure (or if the write fails) memory goes back to
   * the last written state.
   */
  private run(fn: () => CommandResult, coalesce = false): CommandResult {
    const backup = this.m ? structuredClone(this.m) : null;
    const backupFlash = new Map(this.teamFlash);
    const backupMove = new Map(this.moveCodes);
    this.dirty.clear();
    this.byes = [];
    this.post = [];
    const restore = () => {
      this.m = backup;
      this.qIndex = this.m ? indexQuestions(this.m.night.quiz) : new Map();
      this.teamFlash = backupFlash;
      this.moveCodes = backupMove;
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
    if (this.m) {
      this.m.state.seq++;
      try {
        flush(this.d.db, this.m, this.dirty);
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

  /** Bumps seq without a write, for changes that live only in memory (presence). */
  touch(hostOnly = true): void {
    if (this.m) this.m.state.seq++;
    else this.idleSeq++;
    this.onChange({ coalesce: false, byes: [], hostOnly });
  }

  /** The theme or venue settings changed: every screen gets a fresh view (new themeVersion). */
  venueChanged(): void {
    this.venueCache = null;
    this.touch(false);
  }

  // --- restart recovery (7.6) -------------------------------------------------

  load(): void {
    const model = loadOpenNight(this.d.db);
    if (!model) return;
    this.m = model;
    this.qIndex = indexQuestions(model.night.quiz);
    if (model.state.phase === "lobby") this.lobbyLineAt = this.now() + LOBBY_LINE_MS;
    this.recover();
  }

  private recoverPending = false;

  /** Locks a question whose timer ran out while the server was down, or reschedules the lock (7.6). */
  private recover(): void {
    const t = this.m?.state.timer;
    if (t && t.state === "running" && t.locksAt !== null && t.locksAt <= this.now()) {
      const at = t.locksAt;
      try {
        this.run(() => { this.lockOpen(at); return OK; });
      } catch (e) {
        // For example the rules module is not installed yet: try again on the next command or view.
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
    for (const j of this.jobs.values()) this.d.scheduler.cancel(j.handle);
    this.jobs.clear();
  }

  // --- scheduled events (7.3, 10.4) -------------------------------------------

  private ensureJob(name: string, key: string | null, time: number, fn: () => void): void {
    const cur = this.jobs.get(name);
    if (cur && cur.key === key) return;
    if (cur) { this.d.scheduler.cancel(cur.handle); this.jobs.delete(name); }
    if (key !== null) this.jobs.set(name, { key, handle: this.d.scheduler.at(time, fn) });
  }

  private syncTimers(): void {
    const s = this.m?.state;
    const t = s?.timer;
    const running = !!s && t!.state === "running" && t!.locksAt !== null;
    const locksAt = running ? t!.locksAt! : 0;
    this.ensureJob("lock", running ? `lock:${locksAt}` : null, locksAt, () => this.fireLock(locksAt));
    const lastKey = running && s!.phase === "asking" ? `last:${locksAt}` : null;
    this.ensureJob("last", lastKey !== null && lastKey !== this.lastSecondsFired ? lastKey : null, locksAt - LAST_SECONDS_MS,
      () => this.fireLastSeconds(lastKey!));
    const lobby = s?.phase === "lobby";
    this.ensureJob("lobby", lobby ? `lobby:${this.lobbyLineAt}` : null, this.lobbyLineAt, () => this.fireLobbyLine());
    // Ended on a timer: send fresh views when the final standings show, so the host's `can` stays true.
    const fin = s?.phase === "ended" ? s.finalStandingsAt ?? null : null;
    this.ensureJob("final", fin !== null && fin > this.now() ? `final:${fin}` : null, fin ?? 0, () => this.fireFinal());
  }

  private fireFinal(): void {
    this.jobs.delete("final");
    if (this.m?.state.phase !== "ended") return;
    this.run(() => OK);
  }

  private fireLock(locksAt: number): void {
    this.jobs.delete("lock");
    const t = this.m?.state.timer;
    if (!t || t.state !== "running" || t.locksAt !== locksAt) return;
    this.run(() => { this.lockOpen(locksAt); return OK; });
  }

  private fireLastSeconds(key: string): void {
    this.jobs.delete("last");
    this.lastSecondsFired = key;
    if (!this.m || this.state.phase !== "asking" || this.state.timer.state !== "running") return;
    this.run(() => {
      const left = Math.max(1, Math.round((this.state.timer.locksAt! - this.now()) / 1000));
      this.setLine("question", "last_seconds", { seconds: left });
      return OK;
    });
  }

  private fireLobbyLine(): void {
    this.jobs.delete("lobby");
    if (!this.m || this.state.phase !== "lobby") return;
    this.lobbyLineAt = this.now() + LOBBY_LINE_MS;
    this.run(() => { this.setLine("lobby", "lobby", { n: this.teams().length }); return OK; });
  }

  // --- presence -----------------------------------------------------------------

  /** Team id for a device token in the open night (11.1). */
  teamForToken(token: string): string | null {
    if (!this.m || this.m.night.status !== "open") return null;
    const h = sha256(token);
    for (const t of this.teams()) if (t.tokenHash === h) return t.id;
    return null;
  }

  // --- what is allowed now -----------------------------------------------------

  /** Why a command can't run now (ignoring its args), or null if it can. */
  blocked(name: CommandName): ErrorCode | null {
    const m = this.m;
    if (name === "night.open") return m ? "night_open" : null;
    if (!m) return name === "team.join" ? "room_code" : name === "team.rejoin" ? "bad_code" : "wrong_phase";
    const s = m.state;
    const p = s.phase;
    const perRound = this.quiz.settings.lockMode === "round";
    const qs = this.roundQuestions();
    const cur = this.currentQuestionId();
    const curStatus = cur ? s.questions[cur]?.status : undefined;
    const t = s.timer;
    switch (name) {
      case "night.update": case "team.rename": case "team.moveCode": case "team.rejoin":
        return null;
      case "night.newRoomCode": return p === "ended" ? "wrong_phase" : null;
      case "night.close": return p === "ended" || p === "lobby" ? null : "wrong_phase";
      case "quiz.start": return p !== "lobby" ? "wrong_phase" : this.teams().length === 0 ? "no_teams" : null;
      case "round.start": return p === "round_intro" ? null : "wrong_phase";
      case "question.next":
        if (p !== "asking" || s.shown >= qs.length) return "wrong_phase";
        if (!perRound && s.shown > 0 && curStatus !== "locked") return "wrong_phase";
        return null;
      case "timer.start":
        if (t.state !== "idle") return "wrong_phase";
        if (p === "sudden_death") return curStatus === "open" ? null : "wrong_phase";
        if (p !== "asking") return "wrong_phase";
        if (perRound) return s.shown === qs.length && qs.some((q) => s.questions[q.id]?.status === "open") ? null : "wrong_phase";
        return curStatus === "open" ? null : "wrong_phase";
      case "timer.pause": return (p === "asking" || p === "sudden_death") && t.state === "running" ? null : "wrong_phase";
      case "timer.resume": return (p === "asking" || p === "sudden_death") && t.state === "paused" ? null : "wrong_phase";
      case "timer.add": return (p === "asking" || p === "sudden_death") && (t.state === "running" || t.state === "paused") ? null : "wrong_phase";
      case "lock":
        if (p === "sudden_death") return curStatus === "open" || curStatus === "locked" ? null : "wrong_phase";
        if (p !== "asking") return "wrong_phase";
        return perRound ? (s.shown === qs.length ? null : "wrong_phase") : (s.shown > 0 ? null : "wrong_phase");
      case "round.finish":
        return p === "asking" && s.shown === qs.length && qs.every((q) => s.questions[q.id]?.status === "locked") ? null : "wrong_phase";
      case "mark.group": case "mark.team": return MARK_PHASES.has(p) ? null : "wrong_phase";
      case "reveal.start": return p !== "marking" ? "wrong_phase" : this.roundPending() > 0 ? "marks_pending" : null;
      case "reveal.next": return p === "reveal" ? null : "wrong_phase";
      case "leaderboard.show":
        if (p === "reveal") return null;
        return p !== "marking" ? "wrong_phase" : this.roundPending() > 0 ? "marks_pending" : null;
      case "round.next": return (p === "leaderboard" && !this.isLastRound()) || p === "halftime" ? null : "wrong_phase";
      case "sd.start":
        if (p !== "leaderboard" || !this.isLastRound() || this.quiz.suddenDeath.length === 0 || !this.rules()) return "wrong_phase";
        return this.sdNeeded() ? null : "wrong_phase";
      case "sd.ask": {
        if (p !== "sudden_death" || !s.sd) return "wrong_phase";
        if (s.sd.current && s.sd.current.status !== "revealed") return "wrong_phase";
        if (s.sd.nextQuestion >= this.quiz.suddenDeath.length) return "wrong_phase";
        return this.sdLive() || this.sdNeeded() ? null : "wrong_phase";
      }
      case "sd.reveal":
        if (p !== "sudden_death" || s.sd?.current?.status !== "locked") return "wrong_phase";
        return this.pendingIn([s.sd.current.questionId]) > 0 ? "marks_pending" : null;
      case "quiz.end": {
        if (p === "idle" || p === "lobby" || p === "ended") return "wrong_phase";
        return null;   // a natural end or `early: true`; checked with the args
      }
      case "final.show": {
        // Quiz End: the host moves the display from the winner to the final standings (venue afterWinner).
        const at = s.finalStandingsAt ?? null;
        return p === "ended" && (at === null || at > this.now()) ? null : "wrong_phase";
      }
      case "team.remove": return p === "lobby" ? null : "wrong_phase";
      case "team.join": return p === "lobby" ? null : p === "ended" ? "wrong_phase" : "joining_closed";
      case "joker.play": return JOKER_PHASES.has(p) ? null : "wrong_phase";
      case "answer.submit": return p === "asking" || p === "sudden_death" ? null : "wrong_phase";
    }
    return "wrong_phase";
  }

  /** True when Quiz End would be a normal finish (not early). */
  naturalEnd(): boolean {
    if (!this.m) return false;
    const s = this.state;
    if (s.phase === "leaderboard" && this.isLastRound()) return true;
    if (s.phase === "sudden_death" && (!s.sd?.current || s.sd.current.status === "revealed")) return true;
    return false;
  }

  can(): Partial<Record<CommandName, boolean>> {
    const out: Partial<Record<CommandName, boolean>> = {};
    for (const n of HOST_COMMANDS) out[n] = this.blocked(n) === null;
    return out;
  }

  // --- command entry point --------------------------------------------------------

  command(actor: Actor, name: CommandName, args: Record<string, unknown>): CommandResult {
    this.ensureRecovered();
    const b = this.blocked(name);
    if (b) return fail(b);
    // SA-04 / LI-011: refusals and no-ops from phones are found here, before run() copies the night.
    const early = actor.role === "team" ? this.precheck(actor, name, args) : null;
    if (early) return early;
    const coalesce = name === "answer.submit";
    return this.run(() => this.exec(actor, name, args), coalesce);
  }

  private exec(actor: Actor, name: CommandName, a: Record<string, unknown>): CommandResult {
    switch (name) {
      case "night.open": return this.nightOpen(a);
      case "night.update": return this.nightUpdate(a);
      case "night.close": return this.nightClose();
      case "quiz.start": return this.quizStart();
      case "quiz.end": return this.quizEnd(a);
      case "round.start": return this.roundStart();
      case "round.finish": this.setPhase("marking"); return OK;
      case "round.next": return this.roundNext();
      case "question.next": return this.questionNext();
      case "timer.start": return this.timerStart();
      case "timer.pause": return this.timerPause();
      case "timer.resume": return this.timerResume();
      case "timer.add": return this.timerAdd(a);
      case "lock": return this.lockCmd();
      case "mark.group": return this.markGroup(a);
      case "mark.team": return this.markTeam(a);
      case "reveal.start": return this.revealStart();
      case "reveal.next": return this.revealNext();
      case "leaderboard.show": this.showLeaderboard(); return OK;
      case "sd.start": return this.sdStart();
      case "sd.ask": return this.sdAsk();
      case "sd.reveal": return this.sdReveal();
      case "final.show": this.state.finalStandingsAt = this.now(); return OK;
      case "team.rename": return this.teamRename(a);
      case "team.remove": return this.teamRemove(a);
      case "team.moveCode": return this.teamMoveCode(a);
      case "night.newRoomCode": return this.newRoomCode();
      case "team.join": return actor.role === "team" ? this.teamJoin(actor, a) : fail("not_allowed");
      case "team.rejoin": return actor.role === "team" ? this.teamRejoin(actor, a) : fail("not_allowed");
      case "joker.play": return actor.role === "team" ? this.jokerPlay(actor, a) : fail("not_allowed");
      case "answer.submit": return actor.role === "team" ? this.answerSubmit(actor, a) : fail("not_allowed");
    }
    return fail("bad_args");
  }

  // --- night ------------------------------------------------------------------------

  private parsePrizes(v: unknown): Prize[] | null {
    if (!Array.isArray(v) || v.length > 30) return null;
    const out: Prize[] = [];
    for (const p of v) {
      if (!isObj(p) || !isInt(p.place) || p.place < 1 || p.place > 100) return null;
      if (typeof p.text !== "string" || p.text.trim() === "" || len(p.text) > 80) return null;
      out.push({ place: p.place, text: p.text.trim() });
    }
    return out;
  }

  private parsePlannedStart(v: unknown): number | null | undefined {
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
    return undefined;
  }

  private nightOpen(a: Record<string, unknown>): CommandResult {
    if (typeof a.quizId !== "string") return fail("bad_args");
    let plannedStart: number | null = null;
    if (a.plannedStart !== undefined) {
      const ps = this.parsePlannedStart(a.plannedStart);
      if (ps === undefined) return fail("bad_args");
      plannedStart = ps;
    }
    let prizes = this.venue().venue.prizes;
    if (a.prizes !== undefined) {
      const p = this.parsePrizes(a.prizes);
      if (!p) return fail("bad_args", "Each prize needs a place and 1 to 80 characters of text.");
      prizes = p;
    }
    const load = this.d.sources.loadQuiz(a.quizId);
    if (!load.ok) {
      if (load.code === "not_found") return fail("not_found", "That quiz could not be found.");
      const first = load.problems[0]?.message;
      return fail("quiz_not_ready", first ? `That quiz isn't ready yet: ${first}` : undefined);
    }
    this.rulesOrThrow();
    const now = this.now();
    const d = new Date(now);
    const pad = (n: number) => String(n).padStart(2, "0");
    const id = `n-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}-${randomId(4)}`;
    let roomCode = "";
    for (let i = 0; i < 4; i++) roomCode += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    const state = initialState();
    state.seq = this.idleSeq + 1;
    state.joinKey = randomCode(JOIN_KEY_LENGTH);
    this.resetJoinLimits();
    this.m = {
      night: {
        id, quizId: load.quiz.id, quizTitle: load.quiz.title, quiz: load.quiz, roomCode, status: "open", openedAt: now,
        plannedStart, startedAt: null, endedAt: null, endReason: null, prizes,
      },
      teams: new Map(), answers: new Map(), sd: [], state,
    };
    this.qIndex = indexQuestions(load.quiz);
    this.teamFlash.clear();
    this.moveCodes.clear();
    this.dirty.nightNew = true;
    this.setPhase("lobby");
    this.setLine("lobby", "lobby", { n: 0 });
    this.lobbyLineAt = now + LOBBY_LINE_MS;
    return { ok: true, result: { nightId: id, roomCode } };
  }

  private nightUpdate(a: Record<string, unknown>): CommandResult {
    const n = this.m!.night;
    if (a.plannedStart !== undefined) {
      const ps = this.parsePlannedStart(a.plannedStart);
      if (ps === undefined) return fail("bad_args");
      n.plannedStart = ps;
    }
    if (a.prizes !== undefined) {
      const p = this.parsePrizes(a.prizes);
      if (!p) return fail("bad_args", "Each prize needs a place and 1 to 80 characters of text.");
      n.prizes = p;
    }
    this.dirty.night = true;
    return OK;
  }

  private nightClose(): CommandResult {
    const n = this.m!.night;
    if (this.state.phase === "lobby") {
      n.status = "ended";
      n.endReason = "early";
      n.endedAt = this.now();
    }
    this.dirty.night = true;
    for (const t of this.teams()) this.byes.push({ teamId: t.id, reason: "night_closed" });
    const seq = this.state.seq;
    this.post.push(() => {
      this.m = null;
      this.qIndex = new Map();
      this.teamFlash.clear();
      this.moveCodes.clear();
      this.idleSeq = seq + 1;
    });
    return OK;
  }

  private quizStart(): CommandResult {
    this.m!.night.startedAt = this.now();
    this.dirty.night = true;
    this.enterRoundIntro(0);
    return OK;
  }

  private enterRoundIntro(r: number): void {
    const s = this.state;
    s.round = r;
    s.shown = 0;
    s.revealIndex = 0;
    s.timer = idleTimer();
    this.setPhase("round_intro");
    const line = this.pick("round_start", { round: r + 1 });
    s.lines.round = line;
    s.lines.question = line;
  }

  // --- rounds and questions ------------------------------------------------------------

  private roundStart(): CommandResult {
    const s = this.state;
    for (const q of this.roundQuestions()) s.questions[q.id] = { status: "hidden" };
    s.shown = 0;
    s.timer = this.quiz.settings.lockMode === "round" ? idleTimer(this.quiz.settings.timerSeconds * 1000) : idleTimer();
    this.setPhase("asking");
    return OK;
  }

  private questionNext(): CommandResult {
    const s = this.state;
    const q = this.roundQuestions()[s.shown]!;
    s.shown++;
    s.questions[q.id] = { status: "open", openedAt: this.now() };
    s.lines.locked = null;
    if (this.quiz.settings.lockMode === "question") {
      s.timer = idleTimer(timerSecondsOf(this.quiz, q) * 1000);
      s.lines.question = null;
    } else if (s.shown === 1) {
      s.lines.question = null;
    }
    s.lines.round = null;
    return OK;
  }

  private timerStart(): CommandResult {
    const t = this.state.timer;
    let duration = t.durationMs;
    if (duration <= 0) {
      const cur = this.currentQuestionId();
      const ref = cur ? this.qIndex.get(cur) : undefined;
      duration = (ref ? timerSecondsOf(this.quiz, ref.q) : this.quiz.settings.timerSeconds) * 1000;
    }
    this.state.timer = { state: "running", durationMs: duration, locksAt: this.now() + duration, remainingMs: null };
    return OK;
  }

  private timerPause(): CommandResult {
    const t = this.state.timer;
    this.state.timer = { state: "paused", durationMs: t.durationMs, locksAt: null, remainingMs: Math.max(0, t.locksAt! - this.now()) };
    return OK;
  }

  private timerResume(): CommandResult {
    const t = this.state.timer;
    this.state.timer = { state: "running", durationMs: t.durationMs, locksAt: this.now() + (t.remainingMs ?? 0), remainingMs: null };
    return OK;
  }

  private timerAdd(a: Record<string, unknown>): CommandResult {
    if (a.seconds !== 15) return fail("bad_args", "Only 15 seconds can be added.");
    const t = this.state.timer;
    if (t.state === "running") this.state.timer = { ...t, durationMs: t.durationMs + 15_000, locksAt: t.locksAt! + 15_000 };
    else this.state.timer = { ...t, durationMs: t.durationMs + 15_000, remainingMs: (t.remainingMs ?? 0) + 15_000 };
    return OK;
  }

  private lockCmd(): CommandResult {
    const cur = this.currentQuestionId();
    if (this.state.phase === "asking" && this.quiz.settings.lockMode === "question" && cur && this.state.questions[cur]?.status === "locked") return OK;
    if (this.state.phase === "sudden_death" && cur && this.state.questions[cur]?.status === "locked") return OK;
    this.lockOpen(this.now());
    return OK;
  }

  /** Locks whatever is open now (7.3): the current question, or every open question in per-round mode. */
  private lockOpen(at: number): void {
    const s = this.state;
    let ids: string[];
    if (s.phase === "sudden_death") ids = s.sd?.current && s.questions[s.sd.current.questionId]?.status === "open" ? [s.sd.current.questionId] : [];
    else if (s.phase === "asking") {
      if (this.quiz.settings.lockMode === "round") ids = this.roundQuestions().filter((q) => s.questions[q.id]?.status === "open").map((q) => q.id);
      else { const cur = this.currentQuestionId(); ids = cur && s.questions[cur]?.status === "open" ? [cur] : []; }
    } else ids = Object.keys(s.questions).filter((id) => s.questions[id]!.status === "open");
    if (s.timer.state !== "idle") s.timer = { state: "done", durationMs: s.timer.durationMs, locksAt: at, remainingMs: null };
    if (ids.length === 0) return;
    let all = true;
    for (const qid of ids) {
      s.questions[qid] = { ...s.questions[qid]!, status: "locked", lockedAt: at };
      for (const tid of this.participants(qid)) if (!this.answer(tid, qid)?.value) all = false;
      this.autoMarkAtLock(qid, at);
    }
    if (s.phase === "asking") {
      s.lines.locked = all ? this.pick("all_locked", { n: this.teams().length }) : this.pick("locked");
      if (this.quiz.settings.lockMode === "question") s.lines.question = null;
      // no_answer flashes, each only for the team concerned (10.4)
      const lastQ = ids[ids.length - 1]!;
      for (const tid of this.participants(lastQ)) {
        if (ids.some((qid) => !this.answer(tid, qid)?.value)) {
          const team = this.m!.teams.get(tid)!;
          const f = this.flash("no_answer", tid, { team: team.name });
          if (f) this.teamFlash.set(tid, f);
        }
      }
    } else if (s.phase === "sudden_death" && s.sd?.current) {
      s.sd.current.status = "locked";
    }
  }

  /** Auto-marks a question at its lock (8.2): no answer is wrong; closest questions are marked together. */
  private autoMarkAtLock(qid: string, at: number): void {
    const rules = this.rulesOrThrow();
    const spec = this.qIndex.get(qid)!.q.answer;
    const teamIds = this.participants(qid);
    const withValue = new Map<string, AnswerValue>();
    for (const tid of teamIds) {
      const a = this.answer(tid, qid);
      if (a?.value) withValue.set(tid, a.value);
    }
    const marks = isClosest(spec)
      ? rules.markClosest(spec, withValue, this.quiz.settings.closestScoring)
      : new Map([...withValue].map(([tid, v]) => [tid, rules.autoMark(spec, v)] as const));
    for (const tid of teamIds) {
      const a = this.answer(tid, qid);
      if (a?.markedBy === "host") continue;
      const mark: Mark = withValue.has(tid) ? (marks.get(tid) ?? "pending") : "wrong";
      this.putAnswer({
        teamId: tid, questionId: qid, value: a?.value ?? null, receivedAt: a?.receivedAt ?? null, changes: a?.changes ?? 0,
        mark, markedBy: mark === "pending" ? null : "auto", markedAt: mark === "pending" ? null : at,
      });
    }
  }

  private putAnswer(a: AnswerRec): void {
    const key = answerKey(a.teamId, a.questionId);
    this.m!.answers.set(key, a);
    this.dirty.answers.add(key);
  }

  // --- marking (8.2, H-13) -------------------------------------------------------------

  private markable(qid: unknown): QuestionRef | null {
    if (typeof qid !== "string") return null;
    const ref = this.qIndex.get(qid);
    if (!ref || this.state.questions[qid]?.status !== "locked") return null;
    return ref;
  }

  /**
   * A sudden-death question whose reveal is committed (its sudden_deaths row has rightIds) is final:
   * eliminations and outcomes were replayed from those rightIds, so its marks never change after
   * (code review LI-005). Checked on the persisted row, so it holds after later questions and restarts.
   */
  private sdRevealed(qid: unknown): boolean {
    return typeof qid === "string" && !!this.m?.sd.some((r) => r.questionId === qid && r.rightIds !== null);
  }

  private setMark(teamId: string, qid: string, mark: Mark): void {
    const a = this.answer(teamId, qid);
    const from = a?.mark ?? "pending";
    if (from === mark && a?.markedBy === "host") return;
    if (from !== "pending" && from !== mark) this.dirty.markChanges.push({ teamId, questionId: qid, from, to: mark, at: this.now() });
    this.putAnswer({
      teamId, questionId: qid, value: a?.value ?? null, receivedAt: a?.receivedAt ?? null, changes: a?.changes ?? 0,
      mark, markedBy: "host", markedAt: this.now(),
    });
  }

  private markGroup(a: Record<string, unknown>): CommandResult {
    if (this.sdRevealed(a.questionId)) return fail("wrong_phase", "That deadlock question has been revealed, so its marks can't change.");
    const ref = this.markable(a.questionId);
    if (!ref) return fail("not_found", "That question isn't locked yet.");
    if (typeof a.key !== "string" || (a.mark !== "correct" && a.mark !== "wrong")) return fail("bad_args");
    const qid = ref.q.id;
    const rules = this.rulesOrThrow();
    const spec = ref.q.answer;
    const members: AnswerRec[] = [];
    for (const tid of this.participants(qid)) {
      const ans = this.answer(tid, qid);
      if (!ans?.value) continue;
      const key = ans.value.type === "text" && spec.type === "text" ? rules.normalise(ans.value.text) : valueKey(ans.value);
      if (key === a.key) members.push(ans);
    }
    if (members.length === 0) return fail("not_found", "No answers match that group.");
    for (const ans of members) this.setMark(ans.teamId, qid, a.mark);
    if (a.mark === "correct" && spec.type === "text") {
      members.sort((x, y) => (x.receivedAt ?? 0) - (y.receivedAt ?? 0));
      const display = (members[0]!.value as { text: string }).text;
      if (!spec.accepted.some((t) => rules.normalise(t) === a.key)) {
        spec.accepted.push(display);
        this.dirty.night = true;
        const save = this.d.saveAcceptedAnswer();
        const quizId = this.m!.night.quizId;
        this.post.push(() => {
          if (!save) { this.d.log?.(`No quiz store yet: accepted answer for ${qid} kept in the night's snapshot only.`); return; }
          Promise.resolve().then(() => save(quizId, qid, display))
            .catch((e) => this.d.log?.(`Saving an accepted answer failed: ${e instanceof Error ? e.message : String(e)}`));
        });
      }
      // other pending answers that now match an accepted answer
      for (const tid of this.participants(qid)) {
        const ans = this.answer(tid, qid);
        if (ans?.value && ans.mark === "pending" && rules.autoMark(spec, ans.value) === "correct") {
          this.putAnswer({ ...ans, mark: "correct", markedBy: "auto", markedAt: this.now() });
        }
      }
    }
    return OK;
  }

  private markTeam(a: Record<string, unknown>): CommandResult {
    if (this.sdRevealed(a.questionId)) return fail("wrong_phase", "That deadlock question has been revealed, so its marks can't change.");
    const ref = this.markable(a.questionId);
    if (!ref) return fail("not_found", "That question isn't locked yet.");
    if (typeof a.teamId !== "string" || (a.mark !== "correct" && a.mark !== "wrong")) return fail("bad_args");
    if (!this.participants(ref.q.id).includes(a.teamId)) return fail("not_found", "That team isn't in this question.");
    this.setMark(a.teamId, ref.q.id, a.mark);
    return OK;
  }

  // --- reveal, leaderboard, halftime ------------------------------------------------------

  private revealStart(): CommandResult {
    this.state.revealIndex = 0;
    this.setPhase("reveal");
    this.setLine("reveal", "reveal");
    return OK;
  }

  private revealNext(): CommandResult {
    const s = this.state;
    if (s.revealIndex + 1 >= this.roundQuestions().length) this.showLeaderboard();
    else s.revealIndex++;
    return OK;
  }

  private showLeaderboard(): void {
    this.setPhase("leaderboard");
    const r = this.state.round;
    const rules = this.rulesOrThrow();
    const after = this.standingsRows(r, false);
    const before = r > 0 ? this.standingsRows(r - 1, false) : null;
    const key = rules.leaderboardLine(before, after);
    if (!key) return;
    const name = (id: string) => this.m!.teams.get(id)?.name ?? "";
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
    this.setLine("leaderboard", key, vars);
  }

  private roundNext(): CommandResult {
    const s = this.state;
    if (s.phase === "leaderboard" && halftimeRound(this.quiz) === s.round && !s.halftimeShown) {
      s.halftimeShown = true;
      this.setPhase("halftime");
      this.setLine("halftime", "halftime");
      return OK;
    }
    this.enterRoundIntro(s.round + 1);
    return OK;
  }

  // --- sudden death (8.5, H-14) ------------------------------------------------------------

  private sdStart(): CommandResult {
    const need = this.sdNeeded()!;
    this.state.sd = { position: need.position, teamIds: need.teamIds, asked: 0, nextQuestion: 0, current: null, decided: [] };
    this.setPhase("sudden_death");
    this.setLine("suddenDeath", "sudden_death", { n: need.teamIds.length });
    return OK;
  }

  private sdAsk(): CommandResult {
    const s = this.state;
    const sd = s.sd!;
    if (!this.sdLive()) {
      const need = this.sdNeeded();
      if (!need) return fail("wrong_phase");
      sd.position = need.position;
      sd.teamIds = need.teamIds;
      sd.asked = 0;
      this.setLine("suddenDeath", "sudden_death", { n: need.teamIds.length });
    }
    const q = this.quiz.suddenDeath[sd.nextQuestion]!;
    sd.nextQuestion++;
    sd.asked++;
    sd.current = { questionId: q.id, status: "open" };
    s.questions[q.id] = { status: "open", openedAt: this.now() };
    s.timer = idleTimer(timerSecondsOf(this.quiz, q) * 1000);
    const seq = (this.m!.sd[this.m!.sd.length - 1]?.seq ?? 0) + 1;
    this.m!.sd.push({ seq, position: sd.position, teamIds: [...sd.teamIds], questionId: q.id, rightIds: null });
    this.dirty.sd.add(seq);
    return OK;
  }

  private sdReveal(): CommandResult {
    const s = this.state;
    const sd = s.sd!;
    const qid = sd.current!.questionId;
    const row = this.m!.sd.find((r) => r.questionId === qid)!;
    const rightIds = row.teamIds.filter((t) => this.answer(t, qid)?.mark === "correct");
    row.rightIds = rightIds;
    this.dirty.sd.add(row.seq);
    sd.current!.status = "revealed";
    const res = this.rulesOrThrow().resolveSuddenDeath(row.teamIds, rightIds);
    const name = (id: string) => this.m!.teams.get(id)?.name ?? "";
    if (res.winner) {
      sd.decided.push({ position: sd.position, teamIds: [res.winner], outcome: "won" });
      sd.teamIds = [res.winner];
      this.setLine("suddenDeath", "sudden_death_won", { team: name(res.winner) });
    } else if (sd.asked >= this.quiz.settings.suddenDeathMax || sd.nextQuestion >= this.quiz.suddenDeath.length) {
      sd.teamIds = res.remaining;
      sd.decided.push({ position: sd.position, teamIds: res.remaining, outcome: "shared" });
      this.setLine("suddenDeath", "sudden_death_shared", { team: joinNames(res.remaining.map(name)), n: res.remaining.length });
    } else {
      sd.teamIds = res.remaining;
      if (res.remaining.length === 1) {
        sd.decided.push({ position: sd.position, teamIds: res.remaining, outcome: "won" });
        this.setLine("suddenDeath", "sudden_death_won", { team: name(res.remaining[0]!) });
      } else this.setLine("suddenDeath", "sudden_death_again");
    }
    return OK;
  }

  // --- Quiz End (S-08) ---------------------------------------------------------------------

  private quizEnd(a: Record<string, unknown>): CommandResult {
    const early = a.early === true;
    if (!this.naturalEnd() && !early) return fail("wrong_phase", "The quiz isn't finished. End it early instead?");
    const s = this.state;
    if (Object.values(s.questions).some((q) => q.status === "open")) this.lockOpen(this.now());
    s.timer = idleTimer();
    const n = this.m!.night;
    const last = Math.min(Math.max(s.round, 0), this.quiz.rounds.length - 1);
    const rows = this.standingsRows(early ? last : this.quiz.rounds.length - 1);
    n.status = "ended";
    n.endedAt = this.now();
    n.endReason = this.naturalEnd() ? "finished" : "early";
    this.dirty.night = true;
    this.dirty.results = rows;
    this.setPhase("ended");
    const after = this.venue().venue.afterWinner;
    s.finalStandingsAt = after.mode === "host" ? null : n.endedAt + after.seconds * 1000;
    const name = (id: string) => this.m!.teams.get(id)?.name ?? "";
    const winners = rows.filter((r) => r.position === 1).map((r) => name(r.teamId));
    if (winners.length > 1) this.setLine("winner", "winner_shared", { team: joinNames(winners), n: winners.length });
    else if (winners.length === 1) this.setLine("winner", "winner", { team: winners[0] });
    const lastPos = Math.max(0, ...rows.map((r) => r.position));
    if (lastPos > 1) {
      const losers = rows.filter((r) => r.position === lastPos).map((r) => name(r.teamId));
      this.setLine("lastPlace", "last_place", { team: joinNames(losers), n: losers.length });
    }
    this.setLine("goodbye", "goodbye");
    return OK;
  }

  // --- teams (11) ---------------------------------------------------------------------------

  private cleanName(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const name = v.replace(/\s+/g, " ").trim();
    return len(name) >= 1 && len(name) <= 30 ? name : null;
  }

  private newRejoinCode(): string {
    const used = new Set([...this.m!.teams.values()].map((t) => t.rejoinCode));
    for (;;) { const c = randomCode(6); if (!used.has(c)) return c; }
  }

  private teamJoin(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult {
    const n = this.m!.night;
    if (!this.hasJoinKey(a) && !this.rightRoomCode(a)) return fail("room_code");
    const check = this.joinCheck(actor, a);
    if (!check.ok) return check;
    const name = check.name;
    const nameKey = name.toLowerCase();
    const used = new Map<number, number>();
    for (const t of this.teams()) used.set(t.colour, (used.get(t.colour) ?? 0) + 1);
    let colour = 1;
    for (let c = 1; c <= TEAM_COLOURS; c++) if ((used.get(c) ?? 0) < (used.get(colour) ?? 0)) colour = c;
    const token = randomToken();
    const team: TeamRec = {
      id: `t-${randomId(8)}`, name, nameKey, colour, tokenHash: sha256(token), rejoinCode: this.newRejoinCode(),
      jokerRound: null, joinedAt: this.now(), removedAt: null,
    };
    this.m!.teams.set(team.id, team);
    this.dirty.teams.add(team.id);
    this.state.flash = this.flash("team_joined", team.id, { team: name });
    this.setLine("lobby", "lobby", { n: this.teams().length });
    return { ok: true, result: { teamId: team.id, token, nightId: n.id } };
  }

  /** The team a rejoin or move code names, or null (no side effects). */
  private rejoinTarget(a: Record<string, unknown>): { team: TeamRec; code: string; viaMove: boolean } | null {
    const code = typeof a.code === "string" ? a.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]+$/.test(code) || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
    let team: TeamRec | undefined;
    const move = this.moveCodes.get(code);
    if (move && move.expires > this.now()) team = this.m!.teams.get(move.teamId);
    const viaMove = !!team;
    if (!team && code.length === 6) team = this.teams().find((t) => t.rejoinCode === code);
    return team && team.removedAt === null ? { team, code, viaMove } : null;
  }

  /** Recent tries in a limiter map, dropping ones older than a minute. */
  private recentTries(map: Map<string, number[]>, key: string, now: number): number[] {
    const list = (map.get(key) ?? []).filter((t) => t > now - MINUTE);
    if (list.length) map.set(key, list); else map.delete(key);
    return list;
  }

  /** Rejoin limits and code lookup, before run() (SA-04): a refusal here never copies the night. */
  private rejoinPrecheck(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult | null {
    const now = this.now();
    const connKey = `c:${actor.connId}`;
    const ipKey = actor.ip ? `ip:${actor.ip}` : null;
    if (this.recentTries(this.rejoinTries, connKey, now).length >= REJOIN_TRIES) return fail("too_many_tries");
    if (ipKey && this.recentTries(this.rejoinTries, ipKey, now).length >= REJOIN_TRIES_PER_IP) return fail("too_many_tries");
    if (this.rejoinTarget(a)) return null;
    this.pruneRejoinTries(now);
    for (const key of ipKey ? [connKey, ipKey] : [connKey]) this.rejoinTries.set(key, [...this.recentTries(this.rejoinTries, key, now), now]);
    return fail("bad_code");
  }

  private teamRejoin(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult {
    const target = this.rejoinTarget(a);
    if (!target) return fail("bad_code");   // the pre-check found it; kept for direct callers
    const { team, code } = target;
    if (target.viaMove) this.moveCodes.delete(code);
    const token = randomToken();
    team.tokenHash = sha256(token);
    team.rejoinCode = this.newRejoinCode();
    this.dirty.teams.add(team.id);
    this.byes.push({ teamId: team.id, reason: "moved", keepConn: actor.connId });
    return { ok: true, result: { teamId: team.id, token, nightId: this.m!.night.id } };
  }

  /** Drops keys with no try in the last minute once the map grows, so it cannot only grow (REVIEW finding 8). */
  private pruneRejoinTries(now: number): void {
    for (const map of [this.rejoinTries, this.joinTries]) {
      if (map.size < 1_000) continue;
      for (const [key, list] of map) if (!list.some((t) => t > now - MINUTE)) map.delete(key);
    }
  }

  // --- joining: room code limits and the join key (SA-01, D1) -------------------------------

  private rightRoomCode(a: Record<string, unknown>): boolean {
    return typeof a.roomCode === "string" && a.roomCode.trim().toUpperCase() === this.m!.night.roomCode;
  }

  /** True if the join carries this night's join key (from the QR code or join link). */
  private hasJoinKey(a: Record<string, unknown>): boolean {
    const key = this.state.joinKey;
    return !!key && typeof a.joinKey === "string" && a.joinKey.trim().toUpperCase() === key;
  }

  /** Checks on a join that need no change: a clean name, not already in a team, name free, room left. */
  private joinCheck(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): { ok: true; name: string } | Refusal {
    const name = this.cleanName(a.name);
    if (!name) return fail("bad_args", "Team names are 1 to 30 characters.") as Refusal;
    if (actor.teamId && this.m!.teams.get(actor.teamId)?.removedAt === null) return fail("bad_args", "This phone is already in a team.") as Refusal;
    const nameKey = name.toLowerCase();
    if (this.teams().some((t) => t.nameKey === nameKey)) return fail("team_has_phone") as Refusal;
    if (this.teams().length >= this.quiz.settings.maxTeams) return fail("night_full") as Refusal;
    return { ok: true, name };
  }

  /**
   * Room code limits (SA-01), before run(). A join with the night's join key skips them all:
   * that is how phones that scanned the QR code get in while someone is guessing. A typed
   * code is limited per connection, per IP and in total; while any limit applies, every
   * typed join answers too_many_tries, right code or not, so the answer says nothing about
   * the code.
   */
  private joinPrecheck(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult | null {
    if (!this.hasJoinKey(a)) {
      const now = this.now();
      const connKey = `c:${actor.connId}`;
      const ipKey = actor.ip ? `ip:${actor.ip}` : null;
      if (now < this.joinPausedUntil) return fail("too_many_tries");
      if (this.recentTries(this.joinTries, connKey, now).length >= JOIN_TRIES) return fail("too_many_tries");
      if (ipKey && this.recentTries(this.joinTries, ipKey, now).length >= JOIN_TRIES_PER_IP) return fail("too_many_tries");
      if (!this.rightRoomCode(a)) {
        this.pruneRejoinTries(now);
        for (const key of ipKey ? [connKey, ipKey, "all"] : [connKey, "all"]) this.joinTries.set(key, [...this.recentTries(this.joinTries, key, now), now]);
        if ((this.joinTries.get("all")?.length ?? 0) >= JOIN_TRIES_TOTAL) {
          this.joinPausedUntil = now + JOIN_PAUSE_MS;
          this.joinTries.delete("all");
          this.d.log?.(`Someone is guessing the room code: ${JOIN_TRIES_TOTAL} wrong codes in a minute. Joins by typed code are paused for a minute; the QR code still works.`);
          this.touch();   // the host sees the warning
        }
        return fail("room_code");
      }
    }
    const check = this.joinCheck(actor, a);
    return check.ok ? null : check;
  }

  private resetJoinLimits(): void {
    this.joinTries.clear();
    this.joinPausedUntil = 0;
  }

  /** New room code and join key for the open night, keeping the teams (D1): for a code that has leaked. */
  private newRoomCode(): CommandResult {
    const n = this.m!.night;
    let code = n.roomCode;
    while (code === n.roomCode) {
      code = "";
      for (let i = 0; i < 4; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    }
    n.roomCode = code;
    this.state.joinKey = randomCode(JOIN_KEY_LENGTH);
    this.dirty.night = true;
    this.post.push(() => this.resetJoinLimits());
    return { ok: true, result: { roomCode: code } };
  }

  /** Team command checks that change nothing, run before run() so a refusal never copies the night (SA-04). */
  private precheck(actor: Extract<Actor, { role: "team" }>, name: CommandName, a: Record<string, unknown>): CommandResult | null {
    switch (name) {
      case "team.join": return this.joinPrecheck(actor, a);
      case "team.rejoin": return this.rejoinPrecheck(actor, a);
      case "joker.play": { const c = this.jokerCheck(actor, a); return c.ok ? null : c; }
      case "answer.submit": {
        const c = this.answerCheck(actor, a);
        if (!c.ok) return c;
        // The same answer again changes nothing: answer it without a write or a broadcast.
        if (c.prev?.value && JSON.stringify(c.prev.value) === JSON.stringify(c.value)) return { ok: true, result: { receivedAt: c.prev.receivedAt } };
        return null;
      }
    }
    return null;
  }

  private activeTeam(id: unknown): TeamRec | null {
    if (typeof id !== "string") return null;
    const t = this.m!.teams.get(id);
    return t && t.removedAt === null ? t : null;
  }

  private teamRename(a: Record<string, unknown>): CommandResult {
    const team = this.activeTeam(a.teamId);
    if (!team) return fail("not_found", "That team could not be found.");
    const name = this.cleanName(a.name);
    if (!name) return fail("bad_args", "Team names are 1 to 30 characters.");
    const key = name.toLowerCase();
    if (this.teams().some((t) => t.id !== team.id && t.nameKey === key)) return fail("name_taken");
    team.name = name;
    team.nameKey = key;
    this.dirty.teams.add(team.id);
    return OK;
  }

  private teamRemove(a: Record<string, unknown>): CommandResult {
    const team = this.activeTeam(a.teamId);
    if (!team) return fail("not_found", "That team could not be found.");
    team.removedAt = this.now();
    team.tokenHash = null;
    // Free the name for a new team: name_key is unique per night (6.2), so a removed team's key gets its id appended.
    team.nameKey = `${team.nameKey}#${team.id}`;
    this.dirty.teams.add(team.id);
    this.byes.push({ teamId: team.id, reason: "removed" });
    this.setLine("lobby", "lobby", { n: this.teams().length });
    return OK;
  }

  private teamMoveCode(a: Record<string, unknown>): CommandResult {
    const team = this.activeTeam(a.teamId);
    if (!team) return fail("not_found", "That team could not be found.");
    const now = this.now();
    for (const [c, v] of this.moveCodes) if (v.expires <= now || v.teamId === team.id) this.moveCodes.delete(c);
    let code: string;
    do code = randomCode(8); while (this.moveCodes.has(code));
    this.moveCodes.set(code, { teamId: team.id, expires: now + MOVE_CODE_TTL_MS });
    return { ok: true, result: { code, url: `${this.d.publicUrl}/m/${code}` } };
  }

  /** The round a joker can go on now, or null (P-04). */
  upcomingRound(): number | null {
    if (!this.m) return null;
    const s = this.state;
    if (s.phase === "lobby") return 0;
    if (s.phase === "round_intro") return s.round;
    if (s.phase === "leaderboard" || s.phase === "halftime") return this.isLastRound() ? null : s.round + 1;
    return null;
  }

  private jokerCheck(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): Refusal | { ok: true; team: TeamRec; up: number } {
    const team = this.activeTeam(actor.teamId);
    if (!team) return refuse("not_allowed", "Join a team first.");
    if (!this.quiz.settings.joker) return refuse("joker_off");
    if (team.jokerRound !== null) return refuse("joker_used");
    if (!isInt(a.round)) return refuse("bad_args");
    const up = this.upcomingRound();
    if (up === null || a.round !== up) return refuse("joker_wrong_round");
    return { ok: true, team, up };
  }

  private jokerPlay(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult {
    const c = this.jokerCheck(actor, a);
    if (!c.ok) return c;
    const { team, up } = c;
    team.jokerRound = up;
    this.dirty.teams.add(team.id);
    this.state.flash = this.flash("joker_played", team.id, { team: team.name, round: up + 1 });
    return OK;
  }

  // --- answers (S-04) ------------------------------------------------------------------------

  private validValue(v: unknown, ref: QuestionRef): AnswerValue | null {
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

  private answerCheck(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>):
    Refusal | { ok: true; team: TeamRec; ref: QuestionRef; value: AnswerValue; prev: ReturnType<Engine["answer"]>; now: number } {
    const team = this.activeTeam(actor.teamId);
    if (!team) return refuse("not_allowed", "Join a team first.");
    if (typeof a.questionId !== "string") return refuse("bad_args");
    const ref = this.qIndex.get(a.questionId);
    const s = this.state;
    const qs = ref ? s.questions[ref.q.id] : undefined;
    if (!ref || !qs || qs.status === "hidden") return refuse("question_closed");
    if (s.phase === "asking" && ref.round !== s.round) return refuse("question_closed");
    if (s.phase === "sudden_death" && (ref.round !== -1 || s.sd?.current?.questionId !== ref.q.id)) return refuse("question_closed");
    if (!this.participants(ref.q.id).includes(team.id)) return refuse("not_allowed", "Only the tied teams answer this one.");
    if (qs.status === "locked") return refuse("too_late");
    // The strict lock: accepted only if now < locksAt. Nothing the client sends affects this.
    const now = this.now();
    if (s.timer.state === "running" && s.timer.locksAt !== null && now >= s.timer.locksAt) return refuse("too_late");
    if (s.timer.state === "done") return refuse("too_late");
    const value = this.validValue(a.value, ref);
    if (!value) return refuse("bad_args", "That answer doesn't fit this question.");
    return { ok: true, team, ref, value, prev: this.answer(team.id, ref.q.id), now };
  }

  private answerSubmit(actor: Extract<Actor, { role: "team" }>, a: Record<string, unknown>): CommandResult {
    const c = this.answerCheck(actor, a);
    if (!c.ok) return c;
    const { team, ref, value, prev, now } = c;
    if (prev?.value && JSON.stringify(prev.value) === JSON.stringify(value)) return { ok: true, result: { receivedAt: prev.receivedAt } };
    this.putAnswer({
      teamId: team.id, questionId: ref.q.id, value, receivedAt: now, changes: prev?.value ? prev.changes + 1 : 0,
      mark: "pending", markedBy: null, markedAt: null,
    });
    return { ok: true, result: { receivedAt: now } };
  }

  // --- views helpers used by views.ts -------------------------------------------------------

  specAnswerText(qid: string): string {
    const ref = this.qIndex.get(qid);
    return ref ? specAnswerText(ref.q.answer) : "";
  }
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randomId(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}
