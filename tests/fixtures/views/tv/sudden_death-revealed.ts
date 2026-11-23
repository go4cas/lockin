import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Deadlock decided: one team was right.
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...tvBase(),
  teams: chips(6),
  standings: standings(6, 5),
  suddenDeath: suddenDeath("revealed"),
  lines: lines({ suddenDeath: "Les Quizerables break the deadlock." }),
} satisfies TvView;
