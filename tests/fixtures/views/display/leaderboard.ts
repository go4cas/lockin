import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  standings: standings(6),
  lines: lines({ leaderboard: "Quizteama Aguilera take the lead." }),
} satisfies DisplayView;
