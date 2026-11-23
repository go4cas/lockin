import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Deadlock: three teams tied for first, the question is open.
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...tvBase(),
  teams: chips(6),
  standings: standings(6, 5),
  suddenDeath: suddenDeath("open"),
  lines: lines({ suddenDeath: "Deadlock. One question. No mercy." }),
} satisfies TvView;
