import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// A picture question with the last 10 seconds line.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  question: question(4, { timer: timer.running(60, 8), answered: 5 }),
  lines: lines({ question: "Last chance… 8 seconds." }),
} satisfies DisplayView;
