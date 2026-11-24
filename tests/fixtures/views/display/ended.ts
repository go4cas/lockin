import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "ended", venue: VENUE, night: night({ round: null, started: true }), flash: null,
  ...displayBase(),
  teams: chips(6),
  standings: standings(6, 5),
  final: { winners: chips(1), lastPlace: chips(6).slice(5), standingsAt: NOW + 15_000 },
  lines: lines({ winner: "Quizteama Aguilera, champions of The Example Arms!", lastPlace: "Pub Fiction: there's always next week.", goodbye: "Drink up, get home safe." }),
} satisfies DisplayView;
