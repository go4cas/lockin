// The engine's command table (code review LI-016): one entry per engine command, keyed by every
// EngineCommand so a new command that is left out fails typecheck. Each entry names its handler,
// an optional pre-check that runs before the unit of work (team commands, SA-04), and whether
// views may be coalesced after it. Who may send a command is in COMMANDS (src/shared/protocol.ts);
// where it may run is in guards.ts.

import type { CommandResult } from "../ws.ts";
import { answerCheck, answerSubmit, jokerCheck, jokerPlay, repeatAnswer } from "./answers.ts";
import {
  finalShow, leaderboardShow, nightClose, nightOpen, nightUpdate, questionNext, quizEnd, quizStart,
  revealNext, revealStart, roundFinish, roundNext, roundStart,
} from "./flow.ts";
import type { EngineCommand, GuardReader } from "./guards.ts";
import { markGroup, markTeam } from "./marking.ts";
import { sdAsk, sdReveal, sdStart } from "./sudden-death.ts";
import { joinPrecheck, newRoomCode, rejoinPrecheck, teamJoin, teamMoveCode, teamRejoin, teamRemove, teamRename, type JoinGuard, type MoveCodes } from "./teams.ts";
import { lockCmd, timerAdd, timerPause, timerResume, timerStart } from "./timer.ts";
import { fail, type Actor, type TeamActor, type Work } from "./work.ts";

/** What a pre-check may use: selectors and the in-memory limits (never the night's data). */
export interface PrecheckContext {
  read: GuardReader;
  guard: JoinGuard;
  moveCodes: MoveCodes;
  /** Typed joins were just paused (SA-01): log it and tell the host. */
  joinsPaused(): void;
}

export interface CommandSpec {
  run(w: Work, actor: Actor, args: Record<string, unknown>, read: GuardReader): CommandResult;
  /** Checks that change nothing, before the night is copied: a refusal or a no-op answer, else null. */
  precheck?(c: PrecheckContext, actor: TeamActor, args: Record<string, unknown>): CommandResult | null;
  /** Answer submissions only change counts elsewhere, so views may be coalesced (10.7). */
  coalesce?: boolean;
}

/** A team command: only a team actor may run it (the hub checks roles too). */
function team(fn: (w: Work, actor: TeamActor, args: Record<string, unknown>) => CommandResult): CommandSpec["run"] {
  return (w, actor, args) => (actor.role === "team" ? fn(w, actor, args) : fail("not_allowed"));
}

export const ENGINE_COMMANDS: { readonly [N in EngineCommand]: CommandSpec } = {
  "night.open": { run: (w, _a, args) => nightOpen(w, args) },
  "night.update": { run: (w, _a, args) => nightUpdate(w, args) },
  "night.close": { run: (w) => nightClose(w) },
  "quiz.start": { run: (w) => quizStart(w) },
  "quiz.end": { run: (w, _a, args) => quizEnd(w, args) },
  "round.start": { run: (w) => roundStart(w) },
  "round.finish": { run: (w) => roundFinish(w) },
  "round.next": { run: (w) => roundNext(w) },
  "question.next": { run: (w) => questionNext(w) },
  "timer.start": { run: (w) => timerStart(w) },
  "timer.pause": { run: (w) => timerPause(w) },
  "timer.resume": { run: (w) => timerResume(w) },
  "timer.add": { run: (w, _a, args) => timerAdd(w, args) },
  "lock": { run: (w) => lockCmd(w) },
  "mark.group": { run: (w, _a, args) => markGroup(w, args) },
  "mark.team": { run: (w, _a, args) => markTeam(w, args) },
  "reveal.start": { run: (w) => revealStart(w) },
  "reveal.next": { run: (w) => revealNext(w) },
  "leaderboard.show": { run: (w) => leaderboardShow(w) },
  "sd.start": { run: (w, _a, _args, read) => sdStart(w, read.sdNeeded()!) },
  "sd.ask": { run: (w, _a, _args, read) => sdAsk(w, () => read.sdNeeded()) },
  "sd.reveal": { run: (w) => sdReveal(w) },
  "final.show": { run: (w) => finalShow(w) },
  "team.rename": { run: (w, _a, args) => teamRename(w, args) },
  "team.remove": { run: (w, _a, args) => teamRemove(w, args) },
  "team.moveCode": { run: (w, _a, args) => teamMoveCode(w, args) },
  "night.newRoomCode": { run: (w) => newRoomCode(w) },
  "team.join": {
    run: team(teamJoin),
    precheck: (c, actor, args) => joinPrecheck(c.read, c.guard, actor, args, c.joinsPaused),
  },
  "team.rejoin": {
    run: team(teamRejoin),
    precheck: (c, actor, args) => rejoinPrecheck(c.read, c.guard, c.moveCodes, actor, args),
  },
  "joker.play": {
    run: team(jokerPlay),
    precheck: (c, actor, args) => { const r = jokerCheck(c.read, actor, args); return r.ok ? null : r; },
  },
  "answer.submit": {
    run: team(answerSubmit),
    precheck: (c, actor, args) => { const r = answerCheck(c.read, actor, args); return r.ok ? repeatAnswer(r) : r; },
    coalesce: true,
  },
};

export function isEngineCommand(name: string): name is EngineCommand {
  return Object.hasOwn(ENGINE_COMMANDS, name);
}
