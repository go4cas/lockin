// Engine state persisted in `nights.state` (TECH-SPEC 7.5). The shape of
// EngineState is binding for persistence; B1 owns this file.

import type { Flash, Lines, Phase } from "../../shared/protocol.ts";

/** A copy line on a screen slot (10.4): the text the copy picker returned. TECH-SPEC 7.5 left `Line` undefined. */
export type Line = string;

/** 7.3 timer. Running: `locksAt` is a server time. Paused: `remainingMs` holds what is left. Done: `locksAt` is when it locked. */
export interface TimerState {
  state: "idle" | "running" | "paused" | "done";
  durationMs: number;
  locksAt: number | null;
  remainingMs: number | null;
}

export interface QuestionState {
  status: "hidden" | "open" | "locked";
  openedAt?: number;
  lockedAt?: number;
}

export interface SuddenDeathState {
  position: number;               // position being decided
  teamIds: string[];              // still in it
  asked: number;                  // questions asked for this position
  nextQuestion: number;           // index into quiz.suddenDeath across the night
  current: null | { questionId: string; status: "open" | "locked" | "revealed" };
  decided: { position: number; teamIds: string[]; outcome: "won" | "shared" }[];
}

export interface EngineState {
  phase: Phase;
  round: number;                    // 0-based current or upcoming round
  shown: number;                    // questions shown in this round so far
  questions: Record<string, QuestionState>;
  timer: TimerState;
  revealIndex: number;
  halftimeShown: boolean;
  sd: SuddenDeathState | null;
  copyLast: Record<string, number>; // last line index per pool (no repeats)
  lines: Record<string, Line | null>; // current line per screen slot (10.4), keyed like `Lines`
  flash: Flash | null;
  seq: number;                      // increases on every change
  /** Ended: server time the final standings replace the winner screen; null while waiting for the host's final.show. Absent before Quiz End. */
  finalStandingsAt?: number | null;
  /** D1: the join key in the QR code and join link (10 characters); absent on nights opened before it existed. */
  joinKey?: string;
}

export const LINE_SLOTS: readonly (keyof Lines)[] = [
  "lobby", "round", "question", "locked", "reveal", "leaderboard", "halftime", "suddenDeath", "winner", "lastPlace", "goodbye",
];

export function idleTimer(durationMs = 0): TimerState {
  return { state: "idle", durationMs, locksAt: null, remainingMs: null };
}

export function initialState(): EngineState {
  return {
    phase: "lobby",
    round: 0,
    shown: 0,
    questions: {},
    timer: idleTimer(),
    revealIndex: 0,
    halftimeShown: false,
    sd: null,
    copyLast: {},
    lines: {},
    flash: null,
    seq: 1,
  };
}
