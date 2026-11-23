import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  standings: standings(6),
  can: { "round.next": true, "mark.team": true, "quiz.end": true },
  lines: lines({ leaderboard: "Quizteama Aguilera take the lead." }),
} satisfies HostView;
