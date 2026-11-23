import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Per-round mode: the last question is shown and the round timer runs.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true, lockMode: "round" }), flash: null,
  ...tvBase(),
  teams: chips(6, [1]),
  question: question(5, { timer: timer.running(300, 185), answered: 3 }),
  lines: lines(),
} satisfies TvView;
