import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "ended", venue: VENUE, night: night({ round: null, started: true }), flash: null,
  ...tvBase(),
  teams: chips(6),
  standings: standings(6, 5),
  final: { winners: chips(1), lastPlace: chips(6).slice(5) },
  lines: lines({ winner: "Quizteama Aguilera, champions of The Example Arms!", lastPlace: "Pub Fiction: there's always next week.", goodbye: "Drink up, get home safe." }),
} satisfies TvView;
