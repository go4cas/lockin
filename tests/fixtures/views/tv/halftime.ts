import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "halftime", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...tvBase(),
  teams: chips(6),
  standings: standings(6),
  lines: lines({ halftime: "Halftime. Bar's open, brains are closed." }),
} satisfies TvView;
