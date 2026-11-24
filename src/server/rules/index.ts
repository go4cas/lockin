// B2 Rules: marking, scoring and positions (TECH-SPEC 8). Pure functions with
// no I/O and no dependency on the engine; B1 calls them through
// `app.services.rules` (the `Rules` contract in src/shared/rules-api.ts).

import type { App } from "../app.ts";
import type { Rules } from "../../shared/rules-api.ts";
import { autoMark, markClosest } from "./marking.ts";
import { leaderboardLine, rank, resolveSuddenDeath, score, suddenDeathNeeded } from "./standings.ts";
import { groupText, normalise, similarity } from "./text.ts";

export const rules: Rules = {
  normalise,
  similarity,
  autoMark,
  markClosest,
  groupText,
  score,
  rank,
  suddenDeathNeeded,
  resolveSuddenDeath,
  leaderboardLine,
};

export function register(app: App): void {
  app.services.rules = rules;
}
