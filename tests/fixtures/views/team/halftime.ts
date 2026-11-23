import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "halftime", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  standings: standings(6),
  lines: lines({ halftime: "Halftime. Bar's open, brains are closed." }),
} satisfies TeamView;
