import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Per-round mode: the last question is shown and the round timer runs.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true, lockMode: "round" }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  question: question(5, { timer: timer.running(300, 185), answered: 3 }),
  lines: lines(),
} satisfies DisplayView;
