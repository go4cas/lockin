import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(4), started: true, teamCount: 30 }), flash: null,
  ...hostBase(),
  teams: hostTeams(30, { totals: true, offline: [12, 27] }),
  standings: standings(30, 4),
  can: { "round.next": true, "mark.team": true, "quiz.end": true },
  lines: lines(),
} satisfies HostView;
