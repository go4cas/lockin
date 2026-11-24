import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Not in the Deadlock: watching.
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...teamBase(), self: { id: "t-team0006", name: "Pub Fiction", colour: 6, rejoinCode: "W9QZ4B", jokerRound: 0, jokerAvailable: false, inSuddenDeath: false },
  standings: standings(6, 5),
  suddenDeath: suddenDeath("open"),
  lines: lines({ suddenDeath: "Deadlock. One question. No mercy." }),
} satisfies TeamView;
