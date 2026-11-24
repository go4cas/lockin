import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Per-question mode, question 2 of round 3, timer running.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  question: question(2),
  lines: lines({ question: "Round 3. Heads together." }),
} satisfies DisplayView;
