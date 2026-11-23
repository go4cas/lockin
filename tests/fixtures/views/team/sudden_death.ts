import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// In the Deadlock: answering.
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...teamBase(), self: { ...{ id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false }, inSuddenDeath: true },
  standings: standings(6, 5),
  suddenDeath: suddenDeath("open"),
  answers: [],
  lines: lines({ suddenDeath: "Deadlock. One question. No mercy." }),
} satisfies TeamView;
