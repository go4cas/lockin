// WebSocket protocol: envelope, commands and views (TECH-SPEC sections 7.1,
// 10.1, 10.3 and 10.4). Contract: changes only with Cas's agreement.

import type { AnswerSpec, HoldingPanel, Prize } from "./formats.ts";
import type { AnswerGroup, AnswerValue, StandingRow } from "./rules-api.ts";

// 7.1 Phases
export type Phase =
  | "idle"          // no night open (the display shows the venue's waiting screen)
  | "lobby"         // night open, before Quiz Start; holding page is a lobby sub-state (7.4)
  | "round_intro"   // round N is next; jokers can be played on it
  | "asking"        // round N's questions are being shown, answered and locked
  | "marking"       // round N is locked; host finishing marks
  | "reveal"        // round N's answers revealed one by one
  | "leaderboard"   // standings after round N
  | "halftime"      // break after the halftime round
  | "sudden_death"  // after the last round, deciding tied positions
  | "ended";        // Quiz End: winner, standings, goodbye

export const PHASES: readonly Phase[] = [
  "idle", "lobby", "round_intro", "asking", "marking", "reveal", "leaderboard", "halftime", "sudden_death", "ended",
];

// 10.1 Envelope
export const PROTOCOL = 1;
export type Role = "host" | "display" | "team";

export type ClientMsg =
  | { t: "hello"; protocol: 1; role: Role; token?: string }    // token: team device token, or the display's pairing token, if any
  | { t: "cmd"; id: number; name: CommandName; args: object }
  | { t: "ping"; c: number };                                  // c: client time

export type ServerMsg =
  | { t: "welcome"; protocol: 1; role: Role; serverNow: number; teamId: string | null }
  | { t: "state"; seq: number; serverNow: number; view: HostView | DisplayView | TeamView }
  | { t: "ack"; id: number; ok: true; result?: unknown }
  | { t: "ack"; id: number; ok: false; error: { code: ErrorCode; message: string } }
  | { t: "pong"; c: number; s: number }                        // s: server time
  | { t: "paired"; token: string }                             // display only: it was paired; keep the token and send it in every hello
  | { t: "bye"; reason: "moved" | "removed" | "night_closed" | "signed_out" | "protocol" };

export type CommandName =
  | "night.open" | "night.update" | "night.close" | "quiz.start" | "quiz.end"
  | "round.start" | "round.finish" | "round.next" | "question.next"
  | "timer.start" | "timer.pause" | "timer.resume" | "timer.add" | "lock"
  | "mark.group" | "mark.team" | "reveal.start" | "reveal.next" | "leaderboard.show"
  | "sd.start" | "sd.ask" | "sd.reveal" | "final.show"
  | "team.rename" | "team.remove" | "team.moveCode" | "night.newRoomCode"
  | "display.pair" | "display.unpair" | "display.unpairAll"
  | "team.join" | "team.rejoin" | "joker.play" | "answer.submit";

/**
 * The one command registry (code review LI-016, LI-019): who may send each command (7.2).
 * Keyed by every CommandName, so a new command that is left out fails typecheck.
 * `host`: needs a signed-in console; `team`: a phone. Displays send no commands.
 */
export const COMMANDS = {
  "night.open": { by: "host" }, "night.update": { by: "host" }, "night.close": { by: "host" },
  "quiz.start": { by: "host" }, "quiz.end": { by: "host" },
  "round.start": { by: "host" }, "round.finish": { by: "host" }, "round.next": { by: "host" }, "question.next": { by: "host" },
  "timer.start": { by: "host" }, "timer.pause": { by: "host" }, "timer.resume": { by: "host" }, "timer.add": { by: "host" }, "lock": { by: "host" },
  "mark.group": { by: "host" }, "mark.team": { by: "host" },
  "reveal.start": { by: "host" }, "reveal.next": { by: "host" }, "leaderboard.show": { by: "host" },
  "sd.start": { by: "host" }, "sd.ask": { by: "host" }, "sd.reveal": { by: "host" }, "final.show": { by: "host" },
  "team.rename": { by: "host" }, "team.remove": { by: "host" }, "team.moveCode": { by: "host" }, "night.newRoomCode": { by: "host" },
  "display.pair": { by: "host" }, "display.unpair": { by: "host" }, "display.unpairAll": { by: "host" },
  "team.join": { by: "team" }, "team.rejoin": { by: "team" }, "joker.play": { by: "team" }, "answer.submit": { by: "team" },
} as const satisfies Record<CommandName, { by: "host" | "team" }>;

export const COMMAND_NAMES: readonly CommandName[] = Object.keys(COMMANDS) as CommandName[];

/** Commands a team connection may send (7.2); every other command needs a host connection. */
export const TEAM_COMMANDS: readonly CommandName[] = COMMAND_NAMES.filter((n) => COMMANDS[n].by === "team");

/** Empty args. */
type None = Record<string, never>;

/**
 * Arguments of each command (7.2), as page code sends them (LI-019). The server still parses
 * every argument at run time: these types describe the wire, they do not validate it.
 */
export interface CommandArgs {
  "night.open": { quizId: string; plannedStart?: number | null; prizes?: Prize[] };
  "night.update": { plannedStart?: number | null; prizes?: Prize[] };
  "night.close": None;
  "quiz.start": None;
  "quiz.end": { early?: boolean };
  "round.start": None;
  "round.finish": None;
  "round.next": None;
  "question.next": None;
  "timer.start": None;
  "timer.pause": None;
  "timer.resume": None;
  "timer.add": { seconds: 15 };
  "lock": None;
  "mark.group": { questionId: string; key: string; mark: "correct" | "wrong" };
  "mark.team": { questionId: string; teamId: string; mark: "correct" | "wrong" };
  "reveal.start": None;
  "reveal.next": None;
  "leaderboard.show": None;
  "sd.start": None;
  "sd.ask": None;
  "sd.reveal": None;
  "final.show": None;
  "team.rename": { teamId: string; name: string };
  "team.remove": { teamId: string };
  "team.moveCode": { teamId: string };
  "night.newRoomCode": None;
  "display.pair": { code: string };
  "display.unpair": { id: string };
  "display.unpairAll": None;
  "team.join": { roomCode: string; name: string; joinKey?: string };
  "team.rejoin": { code: string };
  "joker.play": { round: number };
  "answer.submit": { questionId: string; value: AnswerValue };
}

/** What a successful ack carries for each command (`undefined`: nothing). */
export interface CommandResults {
  "night.open": { nightId: string; roomCode: string };
  "night.update": undefined;
  "night.close": undefined;
  "quiz.start": undefined;
  "quiz.end": undefined;
  "round.start": undefined;
  "round.finish": undefined;
  "round.next": undefined;
  "question.next": undefined;
  "timer.start": undefined;
  "timer.pause": undefined;
  "timer.resume": undefined;
  "timer.add": undefined;
  "lock": undefined;
  "mark.group": undefined;
  "mark.team": undefined;
  "reveal.start": undefined;
  "reveal.next": undefined;
  "leaderboard.show": undefined;
  "sd.start": undefined;
  "sd.ask": undefined;
  "sd.reveal": undefined;
  "final.show": undefined;
  "team.rename": undefined;
  "team.remove": undefined;
  "team.moveCode": { code: string; url: string };
  "night.newRoomCode": { roomCode: string };
  "display.pair": { paired: number; ip: string; connectedFor: number; id: string };
  "display.unpair": { paired: number };
  "display.unpairAll": { unpaired: number };
  "team.join": { teamId: string; token: string; nightId: string };
  "team.rejoin": { teamId: string; token: string; nightId: string };
  "joker.play": undefined;
  "answer.submit": { receivedAt: number | null };
}

// Both maps cover exactly the command names (a compile-time check, LI-019).
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const COMMAND_MAPS_COMPLETE: Exactly<keyof CommandArgs, CommandName> & Exactly<keyof CommandResults, CommandName> = true;

/** A command's outcome on the server: the typed result, or a refusal with a plain-English message. */
export type CommandOutcome<N extends CommandName = CommandName> =
  | { ok: true; result?: CommandResults[N] }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** How a command fails in the browser: a server refusal, or the client's own `disconnected` / `timeout` (10.5, LI-001). */
export interface CommandError { code: ErrorCode | "disconnected" | "timeout"; message: string }

export type ErrorCode =
  | "not_allowed"      // wrong role
  | "wrong_phase" | "bad_args" | "not_found"
  | "room_code" | "name_taken" | "team_has_phone" | "joining_closed" | "night_full"
  | "bad_code" | "too_many_tries"
  | "too_late" | "question_closed"
  | "joker_used" | "joker_off" | "joker_wrong_round"
  | "quiz_not_ready" | "night_open" | "marks_pending" | "no_teams"
  | "server_error";

// 10.3 Views
export interface Common {
  phase: Phase;
  venue: { name: string; themeVersion: string; teamColours: number };   // count of --team-N colours
  night: NightInfo | null;                                              // null when idle
  flash: Flash | null;                                                  // short-lived event line (10.4)
}

export interface NightInfo {
  id: string;
  roomCode: string;
  joinUrl: string;                 // publicUrl + "/j/" + roomCode + "-" + joinKey (D1: the key lets QR joins past the room code limits)
  quizTitle: string;
  plannedStart: number | null;
  holdingFrom: number | null;      // 7.4
  holdingPanels: HoldingPanel[];
  prizes: Prize[];
  roundCount: number;
  round: RoundInfo | null;         // current or upcoming round; null in lobby and ended
  joker: boolean;                  // quiz has the joker on
  lockMode: "question" | "round";
  teamCount: number;
  started: boolean;                // after Quiz Start
}
export interface RoundInfo { index: number; title: string; questionCount: number; isHalftimeRound: boolean; isLast: boolean }

export interface TeamChip { id: string; name: string; colour: number; jokerThisRound: boolean }

export interface QuestionPublic {
  id: string;
  roundIndex: number;              // -1 for sudden death
  number: number;                  // 1-based within the round, or the sudden-death question number
  text: string;
  image: string | null;            // "/media/q/<id>?v=<night and image version>" (LI-003)
  input:
    | { type: "text" }
    | { type: "choice"; options: string[] }
    | { type: "number" }
    | { type: "datetime"; precision: "year" | "date" | "time" };
  status: "open" | "locked";
  timer: TimerView;                // per-round mode: the round timer, same on every question
  answered: number;                // teams that have answered (count only)
  of: number;                      // teams that can answer
}
export interface TimerView {
  state: "idle" | "running" | "paused" | "done";
  durationMs: number;
  locksAt: number | null;          // server time; clients convert with their offset (10.6)
  remainingMs: number | null;      // when paused
}

export interface RevealItem {
  question: QuestionPublic;
  answerText: string;              // text: accepted[0]; choice: "B. Paris"; number/closest: value; datetime: formatted
  rightCount: number;
}

export interface Standings {
  round: number;                   // 0-based round these standings follow
  rows: (StandingRow & {
    name: string; colour: number; roundScore: number; jokerThisRound: boolean;
    prevPosition: number | null;   // position after the round before `round` (no sudden death); null after the first round. Drives the up/down/same arrow.
  })[];
}

export interface SuddenDeathPublic {
  position: number;
  teams: TeamChip[];               // still in it
  out: TeamChip[];                 // dropped out of this position
  questionNumber: number;          // 1-based for this position
  maxQuestions: number;
  question: QuestionPublic | null;
  status: "waiting" | "open" | "locked" | "revealed";
  rightIds: string[] | null;       // after reveal
  outcome: { position: number; teamIds: string[]; result: "won" | "shared" } | null;
}

export interface Lines {           // copy lines per screen slot (10.4); null = show no line
  lobby: string | null; round: string | null; question: string | null; locked: string | null;
  reveal: string | null; leaderboard: string | null; halftime: string | null;
  suddenDeath: string | null;      // sudden_death at the start, then sudden_death_again / _won / _shared after each reveal
  winner: string | null;           // winner, or winner_shared for a shared first place
  lastPlace: string | null; goodbye: string | null;
}

export interface DisplayView extends Common {
  role: "display";
  teams: TeamChip[];                         // joined teams, in join order
  question: QuestionPublic | null;           // asking: current question
  lockedMoment: { at: number; all: boolean } | null; // set when the current question or round locks
  reveal: RevealItem | null;
  standings: Standings | null;               // leaderboard, halftime, ended
  suddenDeath: SuddenDeathPublic | null;
  final: {                                   // ended
    winners: TeamChip[]; lastPlace: TeamChip[];
    standingsAt: number | null;              // server time the final standings replace the winner screen; null: waiting for the host's final.show
  } | null;
  lines: Lines;
  /** Set while this display is not paired: show only this code (everything else is the idle view). */
  pairing?: { code: string } | null;
}

export interface TeamSelf {
  id: string; name: string; colour: number;
  rejoinCode: string;
  jokerRound: number | null;
  jokerAvailable: boolean;                   // joker on, not used, and the upcoming round can take it
  inSuddenDeath: boolean;
}
export interface TeamAnswer { questionId: string; value: AnswerValue; receivedAt: number; counted: boolean }

export interface TeamView extends Common {
  role: "team";
  self: TeamSelf | null;                     // null on an unbound connection (join page)
  teams: TeamChip[];                         // lobby only; [] otherwise
  questions: QuestionPublic[];               // asking: per-question mode the current one; per-round mode every open or locked question this round
  answers: TeamAnswer[];                     // this team's answers for those questions
  standings: Standings | null;               // leaderboard, halftime, ended
  suddenDeath: SuddenDeathPublic | null;
  lines: Lines;
}

export interface HostTeam extends TeamChip {
  connected: boolean;
  lastSeenAt: number | null;
  jokerRound: number | null;
  answeredCurrent: boolean;
  total: number;
}
export interface QuestionHost extends QuestionPublic {
  answer: AnswerSpec;              // the full answer (H-08)
  note: string | null;
  answerText: string;
}
export interface MarkingQuestion {
  question: QuestionHost;
  groups: AnswerGroup[];           // text: grouped; other types: one group per distinct value, already marked
  noAnswer: string[];              // team ids with no answer (marked wrong)
  pending: number;                 // teams still pending on this question
}

export interface HostView extends Common {
  role: "host";
  teams: HostTeam[];
  round: { questions: QuestionHost[]; shown: number } | null;   // whole current round, for the host's script
  current: QuestionHost | null;                                 // asking: question on screen
  marking: { questions: MarkingQuestion[]; pendingTotal: number } | null; // asking (locked ones) and marking
  reveal: RevealItem | null;
  standings: Standings | null;               // live standings, always available after Quiz Start
  suddenDeath: (SuddenDeathPublic & { questionHost: QuestionHost | null; marking: MarkingQuestion | null }) | null;
  suddenDeathNeeded: { position: number; teamIds: string[] } | null;
  finalStandingsAt: number | null;           // ended: server time the display moves from the winner to the final standings (null: waiting for final.show, or not ended)
  can: Partial<Record<CommandName, boolean>>; // which commands are allowed now, to enable buttons
  lines: Lines;                              // what the display is showing, for the host's reference
  /** Display pairing: paired displays (stored), how many are connected now, and unpaired ones showing a code. */
  displays?: {
    paired: number; connected: number; waiting: number;
    /** SA-11: each stored pairing, oldest first, for "Unpair" on one display (display.unpair { id }). ip: where it is connected from now. */
    list?: { id: string; pairedAt: number; lastSeenAt: number; connected: boolean; ip: string | null }[];
    /** D5: displays connected now that are paired by a signed-in console's session (no stored token). */
    bySession?: number;
  };
  /** SA-01: server time until which joins by typed room code are paused because someone is guessing the code; absent or past when not paused. */
  joinPausedUntil?: number;
}

export type View = HostView | DisplayView | TeamView;

// 10.4 Flashes
export interface Flash {
  id: number;
  key: "team_joined" | "joker_played" | "no_answer";
  line: string;
  teamId: string | null;
  at: number;
}

/** A line slot with nothing in it, for building views. */
export function emptyLines(): Lines {
  return {
    lobby: null, round: null, question: null, locked: null, reveal: null, leaderboard: null,
    halftime: null, suddenDeath: null, winner: null, lastPlace: null, goodbye: null,
  };
}

// 9.2 History API (agreed with Cas 2026-11-24): the host console's dispute screen reads
// GET /api/history/:nightId for the open night too, so it can change marks on earlier rounds.
export interface HistoryListItem {
  id: string; quizTitle: string; openedAt: number; endedAt: number | null;
  teams: number;                   // number of teams
  winners: string[];               // team names in first place
}
export interface HistoryList { nights: HistoryListItem[] }
export interface HistoryDetail {
  night: { id: string; quizTitle: string; openedAt: number; endedAt: number | null; status: "open" | "ended" };
  standings: (StandingRow & { name: string })[];
  rounds: { index: number; title: string; questions: { id: string; number: number; text: string; answerText: string }[] }[]; // index -1, title "Deadlock": sudden-death questions asked, numbered 1.. in the order asked (agreed with B1)
  answers: { teamId: string; questionId: string; display: string; mark: "correct" | "wrong" | "pending"; noAnswer?: true }[]; // no row = no record; noAnswer = a record with no answer sent, display "" (LI-006)
}
