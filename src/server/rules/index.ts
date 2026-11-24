// B2 Rules: marking, scoring and positions (TECH-SPEC 8). Pure functions with
// no I/O and no dependency on the engine; the composition root (services.ts)
// hands them to the engine as `app.services.rules` (the `Rules` contract in
// src/shared/rules-api.ts).

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
