import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "ended", venue: VENUE, night: night({ round: null, started: true }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  standings: standings(6, 5),
  lines: lines({ winner: "Quizteama Aguilera, champions of The Example Arms!", goodbye: "Drink up, get home safe." }),
} satisfies TeamView;
