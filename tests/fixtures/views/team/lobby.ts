import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Joined, waiting for Quiz Start, with the joker still available.
export default {
  phase: "lobby", venue: VENUE, night: night(), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: null, jokerAvailable: true, inSuddenDeath: false },
  teams: chips(6),
  lines: lines({ lobby: "Grab a drink. Pick a silly name." }),
} satisfies TeamView;
