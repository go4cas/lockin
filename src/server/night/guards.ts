// Phase guards (TECH-SPEC 7.2): why a command cannot run now, ignoring its arguments. One
// exhaustive switch over every engine command, so a new command must say where it is allowed
// (code review LI-016). HostView.can is built from the same function.

import type { CommandName, ErrorCode, Phase } from "../../shared/protocol.ts";
import { COMMANDS } from "../../shared/protocol.ts";
import type { DisplayCommand } from "../display/index.ts";
import { live as sdLive } from "./sudden-death.ts";
import type { NightReader } from "./work.ts";

/** The commands the engine runs (display pairing commands are the display module's). */
export type EngineCommand = Exclude<CommandName, DisplayCommand>;

const DISPLAY_ONLY = new Set<CommandName>(["display.pair", "display.unpair", "display.unpairAll"]);

/** Host commands that `can` reports on (10.3 HostView.can): every host command the engine runs. */
export const HOST_COMMANDS: readonly EngineCommand[] = (Object.keys(COMMANDS) as CommandName[])
  .filter((n): n is EngineCommand => COMMANDS[n].by === "host" && !DISPLAY_ONLY.has(n));

const MARK_PHASES = new Set<Phase>(["asking", "marking", "reveal", "leaderboard", "halftime", "round_intro", "sudden_death"]);
const JOKER_PHASES = new Set<Phase>(["lobby", "round_intro", "leaderboard", "halftime"]);

/** What the guards need beyond the readonly selectors. */
export interface GuardReader extends NightReader {
  /** The next sudden-death position to decide, if any (only after the last round). */
  sdNeeded(): { position: number; teamIds: string[] } | null;
}

/** Why a command can't run now (ignoring its args), or null if it can. */
export function blocked(r: GuardReader, name: EngineCommand): ErrorCode | null {
  const m = r.m;
  if (name === "night.open") return m ? "night_open" : null;
  if (!m) return name === "team.join" ? "room_code" : name === "team.rejoin" ? "bad_code" : "wrong_phase";
  const s = m.state;
  const p = s.phase;
  const perRound = r.quiz.settings.lockMode === "round";
  const qs = r.roundQuestions();
  const cur = r.currentQuestionId();
  const curStatus = cur ? s.questions[cur]?.status : undefined;
  const t = s.timer;
  switch (name) {
    case "night.update": case "team.rename": case "team.moveCode": case "team.rejoin":
      return null;
    case "night.newRoomCode": return p === "ended" ? "wrong_phase" : null;
    case "night.close": return p === "ended" || p === "lobby" ? null : "wrong_phase";
    case "quiz.start": return p !== "lobby" ? "wrong_phase" : r.teams().length === 0 ? "no_teams" : null;
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
      if (p === "sudden_death") {
        // Not once the question is revealed: locking would do nothing (review finding 12).
        const sdStatus = s.sd?.current?.status;
        return sdStatus === "open" || sdStatus === "locked" ? null : "wrong_phase";
      }
      if (p !== "asking") return "wrong_phase";
      return perRound ? (s.shown === qs.length ? null : "wrong_phase") : (s.shown > 0 ? null : "wrong_phase");
    case "round.finish":
      return p === "asking" && s.shown === qs.length && qs.every((q) => s.questions[q.id]?.status === "locked") ? null : "wrong_phase";
    case "mark.group": case "mark.team": return MARK_PHASES.has(p) ? null : "wrong_phase";
    case "reveal.start": return p !== "marking" ? "wrong_phase" : r.roundPending() > 0 ? "marks_pending" : null;
    case "reveal.next": return p === "reveal" ? null : "wrong_phase";
    case "leaderboard.show":
      if (p === "reveal") return null;
      return p !== "marking" ? "wrong_phase" : r.roundPending() > 0 ? "marks_pending" : null;
    case "round.next": return (p === "leaderboard" && !r.isLastRound()) || p === "halftime" ? null : "wrong_phase";
    case "sd.start":
      if (p !== "leaderboard" || !r.isLastRound() || r.quiz.suddenDeath.length === 0) return "wrong_phase";
      return r.sdNeeded() ? null : "wrong_phase";
    case "sd.ask": {
      if (p !== "sudden_death" || !s.sd) return "wrong_phase";
      if (s.sd.current && s.sd.current.status !== "revealed") return "wrong_phase";
      if (s.sd.nextQuestion >= r.quiz.suddenDeath.length) return "wrong_phase";
      return sdLive(r) || r.sdNeeded() ? null : "wrong_phase";
    }
    case "sd.reveal":
      if (p !== "sudden_death" || s.sd?.current?.status !== "locked") return "wrong_phase";
      return r.pendingIn([s.sd.current.questionId]) > 0 ? "marks_pending" : null;
    case "quiz.end":
      if (p === "idle" || p === "lobby" || p === "ended") return "wrong_phase";
      return null;   // a natural end or `early: true`; checked with the args
    case "final.show": {
      // Quiz End: the host moves the display from the winner to the final standings (venue afterWinner).
      const at = s.finalStandingsAt ?? null;
      return p === "ended" && (at === null || at > r.now()) ? null : "wrong_phase";
    }
    case "team.remove": return p === "lobby" ? null : "wrong_phase";
    case "team.join": return p === "lobby" ? null : p === "ended" ? "wrong_phase" : "joining_closed";
    case "joker.play": return JOKER_PHASES.has(p) ? null : "wrong_phase";
    case "answer.submit": return p === "asking" || p === "sudden_death" ? null : "wrong_phase";
    default: {
      const unhandled: never = name;
      return unhandled;
    }
  }
}
