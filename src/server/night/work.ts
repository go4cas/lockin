// The unit of work every engine command runs in (code review LI-016). The engine creates one
// per command inside run(), its single commit boundary: handlers change the open night only
// through a Work, which marks what to write (Dirty), queues byes and after-commit steps, and
// picks copy lines. If the handler refuses or throws, or the write fails, the engine puts memory
// back as it was; nothing here is sent or written before the commit.

import type { CopyPicker, Rules, StandingRow } from "../../shared/rules-api.ts";
import type { QuizFile } from "../../shared/formats.ts";
import type { ErrorCode, Flash, Lines } from "../../shared/protocol.ts";
import type { CommandResult } from "../ws.ts";
import type { QuestionRef } from "./quiz.ts";
import type { Sources, VenueInfo } from "./sources.ts";
import type { EngineState } from "./state.ts";
import type { AnswerRec, Dirty, Model, TeamRec } from "./store.ts";
import type { JoinGuard, MoveCodes } from "./teams.ts";

export type Vars = Parameters<CopyPicker["pick"]>[1];

/** `ip` is the client address (CF-Connecting-IP from the tunnel on loopback, SA-06); rejoin tries are limited per IP as well as per connection. */
export type Actor = { role: "host" } | { role: "team"; teamId: string | null; connId: number; ip?: string };
export type TeamActor = Extract<Actor, { role: "team" }>;

/** What the socket layer must do after a change. */
export interface ChangeEvent {
  /** Answer submissions only change counts elsewhere, so views may be coalesced (10.7). */
  coalesce: boolean;
  /** Connections to say bye to: every team connection bound to teamId (except `keepConn`). */
  byes: Bye[];
  /** Only the host view changed (team presence). */
  hostOnly?: boolean;
}
export interface Bye { teamId: string; reason: "moved" | "removed" | "night_closed"; keepConn?: number }

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

export type Refusal = { ok: false; error: { code: ErrorCode; message: string } };

export function fail(code: ErrorCode, message?: string): Refusal {
  return { ok: false, error: { code, message: message ?? MESSAGES[code] ?? "That can't be done right now." } };
}
export const OK: CommandResult = { ok: true };

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
export const len = (s: string) => [...s].length;

/**
 * What handlers and views may read about the open night (readonly selectors). The engine
 * implements it; views and routes get only this, never the mutation side.
 */
export interface NightReader {
  readonly m: Model | null;
  readonly qIndex: ReadonlyMap<string, QuestionRef>;
  readonly quiz: QuizFile;
  readonly state: EngineState;
  readonly rules: Rules;
  readonly publicUrl: string;
  now(): number;
  venue(): VenueInfo;
  teams(): TeamRec[];
  answer(teamId: string, questionId: string): AnswerRec | undefined;
  roundQuestions(r?: number): QuizFile["rounds"][number]["questions"];
  isLastRound(r?: number): boolean;
  currentQuestionId(): string | null;
  participants(questionId: string): string[];
  pendingIn(questionIds: string[]): number;
  roundPending(r?: number): number;
  /** Positions after rounds 0..upTo (8.3, 8.4), with sudden-death outcomes unless withSd is false. */
  standingsRows(upTo: number, withSd?: boolean): StandingRow[];
}

/** The mutation side, alive for one command (see the file comment). */
export interface Work {
  /** Selectors over the night as it is being changed. */
  readonly read: NightReader;
  /** The open night (only null for night.open, before it makes one). */
  readonly m: Model;
  readonly s: EngineState;
  readonly quiz: QuizFile;
  readonly rules: Rules;
  readonly dirty: Dirty;
  readonly sources: Sources;
  readonly publicUrl: string;
  readonly teamFlash: Map<string, Flash>;
  readonly moveCodes: MoveCodes;
  readonly guard: JoinGuard;
  now(): number;
  log(message: string): void;
  /** Appends an answer accepted while marking to the quiz file, after the commit. */
  saveAcceptedAnswer(quizId: string, questionId: string, text: string): void | Promise<void>;
  venue(): VenueInfo;
  /** Says bye to a team's phones once the change is written. */
  bye(b: Bye): void;
  /** Runs once the change is written (never on a refusal or a failed write). */
  after(fn: () => void): void;
  pick(key: string, vars?: Vars): string | null;
  setLine(slot: keyof Lines, key: string, vars?: Vars): void;
  flash(key: Flash["key"], teamId: string | null, vars: Vars): Flash | null;
  setPhase(phase: EngineState["phase"]): void;
  putAnswer(a: AnswerRec): void;
  /** night.open: the new night becomes the open one (written by this command). */
  openNight(m: Model): void;
  /** night.close: back to idle once the change is written. */
  closeNight(): void;
  /** When the lobby line next changes (lobby only, not persisted). */
  setLobbyLineAt(at: number): void;
}

/** One command's handler: parses its own arguments (they are untrusted) and changes the night through `w`. */
export type Handler = (w: Work, actor: Actor, args: Record<string, unknown>) => CommandResult;
