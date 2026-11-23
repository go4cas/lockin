import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Round 3 is next; this team has just played its joker on it.
export default {
  phase: "round_intro", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  lines: lines({ round: "Round 3. Heads together." }),
} satisfies TeamView;
