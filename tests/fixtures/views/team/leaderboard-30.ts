import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(4), started: true, teamCount: 30 }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  standings: standings(30, 4),
  lines: lines(),
} satisfies TeamView;
