// Marking, scoring and positions: the signatures B2 implements and B1 calls
// (TECH-SPEC section 8). Contract: changes only with Cas's agreement.

import type { AnswerSpec } from "./formats.ts";

export type AnswerValue =
  | { type: "text"; text: string }          // 1..100 chars after trim
  | { type: "choice"; index: number }
  | { type: "number"; value: number }       // used by "number" and "closest"
  | { type: "datetime"; value: string };    // same shape as the spec's value

export type Mark = "pending" | "correct" | "wrong";

export interface Rules {
  normalise(text: string): string;
  similarity(a: string, b: string): number;                    // 0..1
  autoMark(spec: AnswerSpec, value: AnswerValue): Mark;        // all types except closest scoring
  markClosest(spec: AnswerSpec, values: Map<string, AnswerValue>,
              scoring: "closest" | "range"): Map<string, Mark>; // teamId -> mark
  groupText(spec: AnswerSpec & { type: "text" },
            answers: { teamId: string; text: string; mark: Mark }[]): AnswerGroup[];
  score(input: ScoreInput): ScoreResult;
  rank(score: ScoreResult, sd: SuddenDeathOutcome[]): StandingRow[];
  suddenDeathNeeded(rows: StandingRow[], scope: "first" | "all",
                    done: SuddenDeathOutcome[]): { position: number; teamIds: string[] } | null;
  resolveSuddenDeath(teamIds: string[], rightIds: string[]):
    { winner: string | null; remaining: string[] };
  leaderboardLine(before: StandingRow[] | null, after: StandingRow[]):
    "tie_breaker" | "lead_change" | "close_race" | "big_climb" | null;   // priority order in 5.5
}

export interface AnswerGroup {
  key: string;                    // normalised text
  display: string;                // the first raw answer received in the group
  teamIds: string[];
  mark: Mark;                     // pending if the teams in it differ
  nearest: { accepted: string; similarity: number } | null;
}
export interface ScoreInput {
  rounds: { questionIds: string[] }[];
  teams: { id: string; jokerRound: number | null }[];
  correct: Set<string>;           // `${teamId}:${questionId}` marked correct
}
export interface ScoreResult {
  teams: { id: string; roundScores: number[]; total: number; roundWins: number }[];
}
export interface StandingRow {
  teamId: string; position: number; shared: boolean; total: number;
  roundScores: number[]; roundWins: number;
  decidedBy: "points" | "tie_breaker" | "sudden_death" | "shared";
}
export interface SuddenDeathOutcome { position: number; order: string[][] }   // groups, best first

// 8.6 Copy picker, implemented by B4
export interface CopyPicker {
  pick(key: string, vars: { team?: string; pub?: string; round?: number; n?: number; seconds?: number },
       last: Record<string, number>): { text: string; index: number } | null;
}
