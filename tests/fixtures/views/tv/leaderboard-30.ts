import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// 30 teams: 21 to 30 go on a second page.
export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(4), started: true, teamCount: 30 }), flash: null,
  ...tvBase(),
  teams: chips(30),
  standings: standings(30, 4),
  lines: lines(),
} satisfies TvView;
