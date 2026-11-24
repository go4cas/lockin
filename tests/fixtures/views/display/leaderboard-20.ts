import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// 20 teams: the most that fit on one screen (two columns of 10).
export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(3), started: true, teamCount: 20 }), flash: null,
  ...displayBase(),
  teams: chips(20),
  standings: standings(20, 3),
  lines: lines({ leaderboard: "Top two within a point. Squeaky bum time." }),
} satisfies DisplayView;
